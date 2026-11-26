'use strict';
/* =========================================================
   Routenplaner – Routing über BRouter (brouter.de, OSM-Daten),
   Ortssuche über Nominatim (OpenStreetMap)
   ========================================================= */
(function () {
  const BROUTER = 'https://brouter.de/brouter';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const PLAN_KEY = 'outdoorNavi.plan.v1';
  const ROUTE_COLOR = '#1f6feb';

  const el = (id) => document.getElementById(id);
  let open = false;
  let waypoints = [];          // [{lat, lng}]
  let markers = [];
  let routeCoords = [];        // [[lat, lng, ele]]
  let routeCum = [];           // kumulierte Distanz je Punkt (m)
  let following = false;
  let reqCtl = null, reqTimer = null;

  const routeLine = L.polyline([], { color: ROUTE_COLOR, weight: 6, opacity: 0.85, interactive: false }).addTo(map);
  const routeCasing = L.polyline([], { color: '#fff', weight: 10, opacity: 0.7, interactive: false });
  routeCasing.addTo(map); routeLine.bringToFront();

  /* ---------- Speichern / Laden ---------- */
  // Die berechnete Route wird mitgespeichert, damit sie auch offline nach einem Neustart da ist
  let savedRoute = null;   // { sig, coords, props }
  const signature = () => el('plProfile').value + '|' + waypoints.map((w) => w.lat + ',' + w.lng).join(';');
  function savePlan() {
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify({ wp: waypoints, profile: el('plProfile').value, following, route: savedRoute }));
    } catch (e) {}
  }
  function loadPlan() {
    try {
      const s = JSON.parse(localStorage.getItem(PLAN_KEY));
      if (!s) return;
      if (s.profile) el('plProfile').value = s.profile;
      waypoints = s.wp || [];
      following = !!s.following;
      savedRoute = s.route || null;
    } catch (e) {}
  }
  window.getPlannedRoute = () => routeCoords;

  /* ---------- Panel ---------- */
  function setOpen(v) {
    open = v;
    el('planner').hidden = !v;
    el('menu').hidden = true;
    el('btnPlan').classList.toggle('primary', v);
    if (v) follow = false;
  }
  el('btnPlan').onclick = () => setOpen(!open);
  el('plClose').onclick = () => setOpen(false);

  /* ---------- Wegpunkte ---------- */
  map.on('click', (e) => { if (open && !window.photoPlacing) addWaypoint(e.latlng); });

  function addWaypoint(latlng, index) {
    const wp = { lat: +latlng.lat.toFixed(6), lng: +latlng.lng.toFixed(6) };
    if (index == null) waypoints.push(wp); else waypoints.splice(index, 0, wp);
    changed();
  }
  function drawMarkers() {
    markers.forEach((m) => map.removeLayer(m));
    markers = waypoints.map((wp, i) => {
      const cls = i === 0 ? 'start' : (i === waypoints.length - 1 && waypoints.length > 1 ? 'end' : '');
      const label = i === 0 ? 'A' : (cls === 'end' ? 'B' : String(i));
      const m = L.marker([wp.lat, wp.lng], {
        draggable: true, autoPan: true,
        icon: L.divIcon({ className: '', html: `<div class="wp-marker ${cls}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
      }).addTo(map);
      m.on('dragend', (ev) => { const p = ev.target.getLatLng(); waypoints[i] = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }; changed(); });
      m.on('click', () => { if (!open) { setOpen(true); return; } waypoints.splice(i, 1); changed(); });
      return m;
    });
  }
  function changed() {
    drawMarkers();
    savePlan();
    clearTimeout(reqTimer);
    reqTimer = setTimeout(calcRoute, 250);
  }

  el('plUndo').onclick = () => { if (waypoints.length) { waypoints.pop(); changed(); } };
  el('plClear').onclick = () => {
    if (waypoints.length > 2 && !confirm('Alle Wegpunkte löschen?')) return;
    waypoints = []; stopFollowing(); changed();
  };
  el('plFromMe').onclick = () => {
    if (!lastFix) return toast('Noch keine GPS-Position…');
    const me = { lat: lastFix.p[0], lng: lastFix.p[1] };
    if (waypoints.length && haversine([waypoints[0].lat, waypoints[0].lng], [me.lat, me.lng]) < 30) return;
    addWaypoint(me, 0);
  };
  el('plProfile').onchange = () => { savePlan(); calcRoute(); };

  /* ---------- Routing (BRouter) ---------- */
  async function calcRoute() {
    if (reqCtl) reqCtl.abort();
    if (waypoints.length < 2) { savedRoute = null; savePlan(); setRoute([], null); return; }
    if (savedRoute && savedRoute.sig === signature()) { setRoute(savedRoute.coords, savedRoute.props); return; }
    if (!navigator.onLine) {
      el('plHint').textContent = '📴 Offline: Neue Routen brauchen Internet. Gespeicherte Routen bleiben nutzbar.';
      setRoute([], null);
      return;
    }
    reqCtl = new AbortController();
    const lonlats = waypoints.map((w) => w.lng + ',' + w.lat).join('|');
    const url = `${BROUTER}?lonlats=${lonlats}&profile=${el('plProfile').value}&alternativeidx=0&format=geojson`;
    el('plHint').textContent = 'Route wird berechnet…';
    try {
      const res = await fetch(url, { signal: reqCtl.signal });
      const text = await res.text();
      if (!res.ok) throw new Error(text.trim().slice(0, 140) || res.status);
      const f = JSON.parse(text).features[0];
      const coords = f.geometry.coordinates.map((c) => [+c[1].toFixed(6), +c[0].toFixed(6), c[2]]);
      const props = { 'total-time': f.properties['total-time'] };
      savedRoute = { sig: signature(), coords, props };
      savePlan();
      setRoute(coords, props);
      el('plHint').textContent = 'Wegpunkte verschieben oder antippen zum Entfernen. Tipp auf die Karte fügt weitere hinzu.';
    } catch (e) {
      if (e.name === 'AbortError') return;
      el('plHint').textContent = navigator.onLine
        ? 'Keine Route gefunden: ' + e.message
        : '📴 Offline: Neue Routen brauchen Internet. Gespeicherte Routen bleiben nutzbar.';
      setRoute([], null);
    }
  }

  function setRoute(coords, props) {
    routeCoords = coords;
    routeCum = [0];
    for (let i = 1; i < coords.length; i++) routeCum.push(routeCum[i - 1] + haversine(coords[i - 1], coords[i]));
    const ll = coords.map((c) => [c[0], c[1]]);
    routeLine.setLatLngs(ll); routeCasing.setLatLngs(ll);

    if (!coords.length) {
      el('plStats').hidden = true; el('plProfileChart').hidden = true;
      if (waypoints.length < 2) el('plHint').textContent = waypoints.length ? 'Noch mindestens einen weiteren Punkt setzen.' : 'Tippe auf die Karte, um Wegpunkte zu setzen. Punkte lassen sich verschieben, ein Tipp auf einen Punkt entfernt ihn.';
      return;
    }
    // Auf- und Abstieg mit 5-m-Glättung (filtert Höhenrauschen)
    let up = 0, down = 0, ref = coords[0][2];
    coords.forEach((c) => {
      if (c[2] == null) return;
      if (ref == null) ref = c[2];
      if (c[2] - ref >= 5) { up += c[2] - ref; ref = c[2]; }
      else if (ref - c[2] >= 5) { down += ref - c[2]; ref = c[2]; }
    });
    const dist = routeCum[routeCum.length - 1];
    let hours;
    if (el('plProfile').value === 'hiking-mountain') {
      // Wanderzeit nach DIN 33466: 4 km/h, 300 Hm/h bergauf, 500 Hm/h bergab
      const tH = dist / 1000 / 4, tV = up / 300 + down / 500;
      hours = Math.max(tH, tV) + Math.min(tH, tV) / 2;
    } else {
      hours = (props && +props['total-time'] || 0) / 3600;
    }
    el('plDist').textContent = fmtDist(dist);
    el('plUp').textContent = Math.round(up) + ' m';
    el('plDown').textContent = Math.round(down) + ' m';
    el('plTime').textContent = Math.floor(hours) + ':' + String(Math.round((hours % 1) * 60)).padStart(2, '0') + ' h';
    el('plStats').hidden = false;
    drawProfile();
    if (following) updateNav();
  }

  /* ---------- Höhenprofil ---------- */
  function drawProfile() {
    const cv = el('plProfileChart');
    const pts = routeCoords.map((c, i) => [routeCum[i], c[2]]).filter((p) => p[1] != null);
    if (pts.length < 2) { cv.hidden = true; return; }
    cv.hidden = false;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const min = Math.min(...pts.map((p) => p[1])), max = Math.max(...pts.map((p) => p[1]));
    const span = Math.max(max - min, 20), total = pts[pts.length - 1][0] || 1;
    const padL = 38, padB = 4, padT = 6;
    const x = (d) => padL + (d / total) * (w - padL - 2);
    const y = (e) => padT + (1 - (e - min) / span) * (h - padT - padB);
    g.beginPath(); g.moveTo(x(0), h - padB);
    pts.forEach((p) => g.lineTo(x(p[0]), y(p[1])));
    g.lineTo(x(total), h - padB); g.closePath();
    g.fillStyle = 'rgba(31,111,235,0.22)'; g.fill();
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, x(p[0]), y(p[1])));
    g.strokeStyle = ROUTE_COLOR; g.lineWidth = 2; g.stroke();
    g.fillStyle = getComputedStyle(document.body).color; g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'top'; g.fillText(Math.round(max) + ' m', 0, padT - 2);
    g.textBaseline = 'bottom'; g.fillText(Math.round(min) + ' m', 0, h - padB + 2);
  }
  window.addEventListener('resize', () => { if (!el('plProfileChart').hidden) drawProfile(); });

  /* ---------- Ortssuche (Nominatim) ---------- */
  let searchTimer = null, searchCtl = null;
  el('plSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = el('plSearch').value.trim();
    if (q.length < 3) { el('plResults').hidden = true; return; }
    searchTimer = setTimeout(() => search(q), 600);   // Nominatim: max. 1 Anfrage/s
  });
  el('plSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); search(el('plSearch').value.trim()); } });
  async function search(q) {
    if (!q) return;
    if (!navigator.onLine) { toast('Ortssuche braucht Internet – tippe die Punkte auf der Karte.'); return; }
    if (searchCtl) searchCtl.abort();
    searchCtl = new AbortController();
    const c = map.getCenter();
    const url = `${NOMINATIM}?format=jsonv2&limit=6&accept-language=de&q=${encodeURIComponent(q)}`
      + `&viewbox=${c.lng - 2},${c.lat + 1.5},${c.lng + 2},${c.lat - 1.5}`;
    try {
      const list = await (await fetch(url, { signal: searchCtl.signal })).json();
      const ul = el('plResults'); ul.innerHTML = '';
      if (!list.length) { ul.innerHTML = '<li>Nichts gefunden</li>'; }
      list.forEach((r) => {
        const li = document.createElement('li');
        li.textContent = r.display_name;
        li.onclick = () => {
          const ll = L.latLng(+r.lat, +r.lon);
          addWaypoint(ll);
          map.setView(ll, Math.max(map.getZoom(), 13));
          el('plSearch').value = ''; ul.hidden = true;
        };
        ul.appendChild(li);
      });
      ul.hidden = false;
    } catch (e) { if (e.name !== 'AbortError') toast('Suche fehlgeschlagen'); }
  }

  /* ---------- Route folgen / Navigation ---------- */
  el('plGo').onclick = () => {
    if (routeCoords.length < 2) return toast('Erst eine Route planen.');
    following = true; savePlan();
    const end = routeCoords[routeCoords.length - 1];
    setTarget(L.latLng(end[0], end[1]));
    setOpen(false);
    follow = true;
    if (lastFix) map.setView([lastFix.p[0], lastFix.p[1]], Math.max(map.getZoom(), 15));
    toast('Navigation entlang der Route');
  };
  function stopFollowing() { following = false; savePlan(); }
  el('navClear').addEventListener('click', stopFollowing);

  // Restdistanz entlang der Route ab dem nächstgelegenen Routenpunkt (wird von app.js genutzt)
  window.routeRemaining = function (me) {
    if (!following || routeCoords.length < 2) return null;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = haversine(me, routeCoords[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { remaining: routeCum[routeCum.length - 1] - routeCum[best] + bestD, offRoute: bestD };
  };

  /* ---------- GPX-Export der geplanten Route ---------- */
  el('plGpx').onclick = () => {
    if (routeCoords.length < 2) return toast('Erst eine Route planen.');
    const pts = routeCoords.map((c) => `<trkpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}">${c[2] != null ? `<ele>${(+c[2]).toFixed(1)}</ele>` : ''}</trkpt>`).join('\n      ');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Outdoor Navi" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Geplante Route</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    a.download = 'route-' + new Date().toISOString().slice(0, 10) + '.gpx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  /* ---------- Start ---------- */
  loadPlan();
  if (waypoints.length) { drawMarkers(); calcRoute(); }
  if (following && waypoints.length) {
    const last = waypoints[waypoints.length - 1];
    setTarget(L.latLng(last.lat, last.lng));
  }
})();
