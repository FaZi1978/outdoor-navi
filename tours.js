'use strict';
/* =========================================================
   Meine Touren
   - Jede beendete Aufzeichnung wird mit allen Daten gespeichert
     (IndexedDB, nur auf dem Gerät)
   - Zu jeder Tour wird ein Bild der Gesamtstrecke auf der
     Topokarte erzeugt
   - Liste nach Datum (neueste zuerst), Detailansicht je Tour
   ========================================================= */
(function () {
  const el = (id) => document.getElementById(id);
  const IMG_W = 800, IMG_H = 520;

  /* ---------- IndexedDB ---------- */
  const dbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open('outdoorNavi.tours', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tours', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function store(mode, fn) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const t = db.transaction('tours', mode);
      const r = fn(t.objectStore('tours'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }
  const allTours = () => store('readonly', (s) => s.getAll());
  const getTour = (id) => store('readonly', (s) => s.get(id));
  const putTour = (t) => store('readwrite', (s) => s.put(t));
  const delTour = (id) => store('readwrite', (s) => s.delete(id));

  /* ---------- Statistik ---------- */
  function computeStats(points, activeMs, maxSpeed, distance) {
    let up = 0, down = 0, ref = null, minE = Infinity, maxE = -Infinity;
    points.forEach((p) => {
      const e = p[2];
      if (e == null) return;
      minE = Math.min(minE, e); maxE = Math.max(maxE, e);
      if (ref == null) { ref = e; return; }
      // 10-m-Schwelle: GPS-Höhe schwankt stark
      if (e - ref >= 10) { up += e - ref; ref = e; } else if (ref - e >= 10) { down += ref - e; ref = e; }
    });
    const start = points[0][3], end = points[points.length - 1][3];
    return {
      distance, activeMs, totalMs: end - start,
      avg: activeMs > 0 ? distance / (activeMs / 1000) : 0,   // m/s
      maxSpeed: maxSpeed || 0,
      up: Math.round(up), down: Math.round(down),
      minEle: isFinite(minE) ? Math.round(minE) : null, maxEle: isFinite(maxE) ? Math.round(maxE) : null
    };
  }

  /* ---------- Tourbild: Strecke auf der Topokarte ---------- */
  function loadImg(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }
  async function makeTourImage(points) {
    const crs = L.CRS.EPSG3857, pad = 50;
    const lls = points.map((p) => L.latLng(p[0], p[1]));
    // größte Zoomstufe, bei der die ganze Strecke ins Bild passt
    let z = 16;
    for (; z > 3; z--) {
      const px = lls.map((ll) => crs.latLngToPoint(ll, z));
      const b = L.bounds(px);
      if (b.max.x - b.min.x <= IMG_W - 2 * pad && b.max.y - b.min.y <= IMG_H - 2 * pad) break;
    }
    const px = lls.map((ll) => crs.latLngToPoint(ll, z));
    const b = L.bounds(px);
    const ox = (b.min.x + b.max.x) / 2 - IMG_W / 2, oy = (b.min.y + b.max.y) / 2 - IMG_H / 2;

    const cv = document.createElement('canvas'); cv.width = IMG_W; cv.height = IMG_H;
    const g = cv.getContext('2d');
    g.fillStyle = '#eef0e8'; g.fillRect(0, 0, IMG_W, IMG_H);

    // Kartenkacheln (aus dem Offline-Speicher oder dem Netz)
    const jobs = [];
    for (let x = Math.floor(ox / 256); x <= Math.floor((ox + IMG_W) / 256); x++) {
      for (let y = Math.floor(oy / 256); y <= Math.floor((oy + IMG_H) / 256); y++) {
        const s = 'abc'[Math.abs(x + y) % 3];
        jobs.push(loadImg(`https://${s}.tile.opentopomap.org/${z}/${x}/${y}.png`).then((img) => {
          if (img) g.drawImage(img, x * 256 - ox, y * 256 - oy);
        }));
      }
    }
    const tiles = await Promise.all(jobs);
    void tiles;

    // Strecke (Abschnitte nach Pausen getrennt)
    const draw = (color, width) => {
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      points.forEach((p, i) => {
        const q = px[i];
        if (i === 0 || p[4]) g.moveTo(q.x - ox, q.y - oy); else g.lineTo(q.x - ox, q.y - oy);
      });
      g.stroke();
    };
    draw('rgba(255,255,255,0.9)', 9);
    draw('#d6332a', 5);
    const dot = (q, fill, label) => {
      g.beginPath(); g.arc(q.x - ox, q.y - oy, 11, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, q.x - ox, q.y - oy + 0.5);
    };
    dot(px[px.length - 1], '#1d241f', 'Z');
    dot(px[0], '#2f8a3a', 'S');

    // Namensnennung (Pflicht nach CC-BY-SA)
    g.font = '11px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom';
    const txt = '© OpenTopoMap (CC-BY-SA), © OpenStreetMap';
    const w = g.measureText(txt).width;
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(IMG_W - w - 10, IMG_H - 18, w + 10, 18);
    g.fillStyle = '#333'; g.fillText(txt, IMG_W - 5, IMG_H - 4);

    return new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.88));
  }

  /* ---------- Tour speichern (aufgerufen von app.js) ---------- */
  window.saveTour = async function (s) {
    try {
      const points = s.points.map((p) => p.slice());
      if (points.length < 2) return null;
      const start = s.startedAt || points[0][3];
      const end = s.endedAt || points[points.length - 1][3];
      const id = 'tour-' + start;
      if (await getTour(id)) return id;   // schon gespeichert
      const stats = computeStats(points, s.activeMs, s.maxSpeed, s.distance);
      let image = null;
      try { image = await makeTourImage(points); } catch (e) { console.error('Tourbild', e); }
      const d = new Date(start);
      const tour = {
        id, start, end, points, stats, image,
        name: 'Tour am ' + d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
      };
      await putTour(tour);
      if (!el('tours').hidden) renderList();
      return id;
    } catch (e) {
      console.error(e); toast('Tour konnte nicht gespeichert werden');
      return null;
    }
  };

  /* ---------- Formatierung ---------- */
  const kmh = (ms) => (ms * 3.6).toFixed(1).replace('.', ',') + ' km/h';
  const dur = (ms) => { const m = Math.round(ms / 60000); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h'; };
  const dateStr = (t) => new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Liste ---------- */
  const objUrls = [];
  const blobUrl = (b) => { const u = URL.createObjectURL(b); objUrls.push(u); return u; };
  function freeUrls() { while (objUrls.length) URL.revokeObjectURL(objUrls.pop()); }

  async function renderList() {
    freeUrls();
    const tours = (await allTours()).sort((a, b) => b.start - a.start);
    const total = tours.reduce((s, t) => s + t.stats.distance, 0);
    el('toursBody').innerHTML = `
      <p class="t-sum">${tours.length} Tour${tours.length === 1 ? '' : 'en'} · zusammen ${fmtKm(total, 1)} km</p>
      ${tours.length ? '' : '<p class="hint">Noch keine Touren gespeichert. Starte eine Aufzeichnung mit ▶ Start – beim Beenden (■ Stopp) wird die Tour hier abgelegt.</p>'}
      <ul class="t-list">${tours.map((t) => `
        <li data-id="${t.id}">
          ${t.image ? `<img src="${blobUrl(t.image)}" alt="">` : '<div class="t-noimg">🗺</div>'}
          <div class="t-txt">
            <b>${esc(t.name)}</b>
            <small>${dateStr(t.start)}, ${timeStr(t.start)} Uhr</small>
            <span>${fmtKm(t.stats.distance)} km · ${dur(t.stats.activeMs)} · Ø ${kmh(t.stats.avg)}</span>
          </div>
        </li>`).join('')}</ul>`;
    el('toursBody').querySelectorAll('.t-list li').forEach((li) => { li.onclick = () => openDetail(li.dataset.id); });
    el('toursTitle').textContent = 'Meine Touren';
    el('toursBack').hidden = true;
  }

  /* ---------- Detailansicht ---------- */
  let shownLayer = null, shownId = null;

  async function openDetail(id) {
    const t = await getTour(id);
    if (!t) return renderList();
    freeUrls();
    const s = t.stats;
    // Fotos, die während der Tour aufgenommen wurden
    let photos = [];
    try { photos = (await photoStore.all()).filter((p) => p.taken && p.taken >= t.start - 60000 && p.taken <= t.end + 60000); } catch (e) {}
    const imgUrl = t.image ? blobUrl(t.image) : null;
    el('toursTitle').textContent = 'Tour';
    el('toursBack').hidden = false;
    el('toursBody').innerHTML = `
      <div class="t-name"><b id="tName">${esc(t.name)}</b><button class="small-btn" id="tRename" title="Umbenennen">✎</button></div>
      <p class="t-date">${dateStr(t.start)} · ${timeStr(t.start)} – ${timeStr(t.end)} Uhr</p>
      ${imgUrl ? `<img class="t-image" id="tImage" src="${imgUrl}" alt="Gesamtstrecke der Tour" title="Antippen zum Vergrößern">` : ''}
      <div class="t-stats">
        <div><span>Strecke</span><b>${fmtKm(s.distance)} km</b></div>
        <div><span>In Bewegung</span><b>${dur(s.activeMs)}</b></div>
        <div><span>Gesamtzeit</span><b>${dur(s.totalMs)}</b></div>
        <div><span>Ø Geschwindigkeit</span><b>${kmh(s.avg)}</b></div>
        <div><span>Höchstgeschw.</span><b>${s.maxSpeed ? kmh(s.maxSpeed) : '–'}</b></div>
        <div><span>Aufstieg</span><b>↗ ${s.up} m</b></div>
        <div><span>Abstieg</span><b>↘ ${s.down} m</b></div>
        <div><span>Höhe min / max</span><b>${s.minEle != null ? s.minEle + ' / ' + s.maxEle + ' m' : '–'}</b></div>
      </div>
      <canvas id="tProfile" height="80"></canvas>
      ${photos.length ? `<h4>Fotos dieser Tour (${photos.length})</h4><div class="t-photos">${photos.map((p) => `<img data-pid="${p.id}" src="${blobUrl(p.thumb)}" alt="">`).join('')}</div>` : ''}
      <div class="pl-buttons">
        <button id="tShow" class="primary">${shownId === t.id ? 'Von Karte entfernen' : '🗺 Auf Karte zeigen'}</button>
        <button id="tGpx">GPX</button>
        <button id="tShare">Bild teilen</button>
      </div>
      <button id="tDel" class="danger">Tour löschen</button>`;

    drawProfile(el('tProfile'), t.points);
    if (imgUrl) el('tImage').onclick = () => openImage(imgUrl);
    el('toursBody').querySelectorAll('.t-photos img').forEach((img) => {
      img.onclick = () => photoStore.openViewer(img.dataset.pid, photos.map((p) => p.id));
    });
    el('tRename').onclick = async () => {
      const n = prompt('Name der Tour:', t.name);
      if (n && n.trim()) { t.name = n.trim(); await putTour(t); el('tName').textContent = t.name; }
    };
    el('tShow').onclick = () => {
      if (shownId === t.id) { hideOnMap(); el('tShow').textContent = '🗺 Auf Karte zeigen'; return; }
      showOnMap(t);
    };
    el('tGpx').onclick = () => exportGpx(t);
    el('tShare').onclick = () => shareImage(t);
    el('tDel').onclick = async () => {
      if (!confirm(`„${t.name}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
      if (shownId === t.id) hideOnMap();
      await delTour(t.id); toast('Tour gelöscht'); renderList();
    };
  }

  function drawProfile(cv, points) {
    const pts = []; let d = 0;
    points.forEach((p, i) => { if (i) d += haversine(points[i - 1], p); if (p[2] != null) pts.push([d, p[2]]); });
    if (pts.length < 2) { cv.hidden = true; return; }
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = cv.clientHeight || 80;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const min = Math.min(...pts.map((p) => p[1])), max = Math.max(...pts.map((p) => p[1]));
    const span = Math.max(max - min, 20), total = pts[pts.length - 1][0] || 1, padL = 40;
    const x = (v) => padL + (v / total) * (w - padL - 2), y = (e) => 6 + (1 - (e - min) / span) * (h - 22);
    g.beginPath(); g.moveTo(x(0), h - 16); pts.forEach((p) => g.lineTo(x(p[0]), y(p[1]))); g.lineTo(x(total), h - 16); g.closePath();
    g.fillStyle = 'rgba(214,51,42,0.18)'; g.fill();
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, x(p[0]), y(p[1])));
    g.strokeStyle = '#d6332a'; g.lineWidth = 2; g.stroke();
    g.fillStyle = getComputedStyle(document.body).color; g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'top'; g.fillText(Math.round(max) + ' m', 0, 2);
    g.textBaseline = 'bottom'; g.fillText(Math.round(min) + ' m', 0, h - 14);
    g.fillText('0', padL, h); g.textAlign = 'right'; g.fillText(fmtKm(total, 1) + ' km', w - 2, h);
  }

  function showOnMap(t) {
    hideOnMap();
    const segs = []; let cur = [];
    t.points.forEach((p) => { if (p[4] && cur.length) { segs.push(cur); cur = []; } cur.push([p[0], p[1]]); });
    segs.push(cur);
    shownLayer = L.layerGroup([
      L.polyline(segs, { color: '#fff', weight: 9, opacity: 0.8, interactive: false }),
      L.polyline(segs, { color: '#e8590c', weight: 5, opacity: 0.95, interactive: false }),
      L.circleMarker(segs[0][0], { radius: 8, color: '#fff', weight: 3, fillColor: '#2f8a3a', fillOpacity: 1 }).bindTooltip('Start'),
      L.circleMarker(cur[cur.length - 1], { radius: 8, color: '#fff', weight: 3, fillColor: '#1d241f', fillOpacity: 1 }).bindTooltip('Ziel')
    ]).addTo(map);
    shownId = t.id;
    setOpen(false);
    follow = false;
    map.fitBounds(L.latLngBounds(t.points.map((p) => [p[0], p[1]])), { paddingTopLeft: [20, 160], paddingBottomRight: [20, 100] });
    toast(`„${t.name}“ wird angezeigt (orange)`);
  }
  function hideOnMap() { if (shownLayer) map.removeLayer(shownLayer); shownLayer = null; shownId = null; }

  function exportGpx(t) {
    let seg = '';
    const segs = [];
    t.points.forEach((p) => {
      if (p[4] && seg) { segs.push(seg); seg = ''; }
      seg += `<trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}">${p[2] != null ? `<ele>${(+p[2]).toFixed(1)}</ele>` : ''}<time>${new Date(p[3]).toISOString()}</time></trkpt>\n`;
    });
    segs.push(seg);
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Outdoor Navi" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${esc(t.name)}</name>
${segs.map((s) => `    <trkseg>\n${s}    </trkseg>`).join('\n')}
  </trk>
</gpx>`;
    download(new Blob([gpx], { type: 'application/gpx+xml' }), fileBase(t) + '.gpx');
  }
  const fileBase = (t) => 'tour-' + new Date(t.start).toISOString().slice(0, 10) + '-' + fmtKm(t.stats.distance, 1).replace(',', '_') + 'km';
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function shareImage(t) {
    if (!t.image) return toast('Für diese Tour gibt es kein Bild.');
    const file = new File([t.image], fileBase(t) + '.jpg', { type: 'image/jpeg' });
    const text = `${t.name}: ${fmtKm(t.stats.distance)} km, ${dur(t.stats.activeMs)}, ↗ ${t.stats.up} m`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: t.name, text }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    download(t.image, file.name);   // Fallback: Bild speichern
  }

  // Tourbild bildschirmfüllend (einfach, mit Schließen per Tipp)
  function openImage(url) {
    const ov = document.createElement('div');
    ov.className = 't-full';
    ov.innerHTML = `<img src="${url}" alt=""><button class="v-btn v-close" title="Schließen">✕</button>`;
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  }

  /* ---------- Panel ---------- */
  function setOpen(v) {
    el('tours').hidden = !v;
    if (v) { el('menu').hidden = true; renderList(); } else freeUrls();
  }
  el('btnTours').onclick = () => setOpen(true);
  el('toursClose').onclick = () => setOpen(false);
  el('toursBack').onclick = renderList;

  /* ---------- Beim Start: bereits beendete, noch nicht gespeicherte Tour sichern ---------- */
  if (!state.running && state.points.length >= 2 && !state.savedId) {
    window.saveTour(state).then((id) => { if (id) { state.savedId = id; save(); } });
  }
})();
