'use strict';
/* =========================================================
   Wetter (Open-Meteo, u. a. DWD-Modelle, kein Schlüssel nötig)
   1) Wetter-Kachel ⛅ → Fenster mit aktuellem Wetter am Standort,
      Stundenvorhersage (24 h) und 5-Tage-Vorhersage:
      Temperatur, Windrichtung/-stärke, Regenwahrscheinlichkeit.
      Letzter Stand bleibt offline lesbar.
   2) Ebene „Wetterkarte“: Hoch- (H) und Tiefdruckgebiete (T),
      Isobaren (Linien gleichen Luftdrucks, alle 4 hPa),
      Windpfeile und Temperaturen auf einem Raster über der Karte.
   ========================================================= */
(function () {
  const API = 'https://api.open-meteo.com/v1/forecast';
  const KEY = 'outdoorNavi.weather.v1';
  const MAPKEY = 'outdoorNavi.weatherMap';
  const REFRESH_MS = 15 * 60 * 1000;
  const el = (id) => document.getElementById(id);

  /* ---------- Hilfen ---------- */
  const WMO = {
    0: ['☀️', 'Klar'], 1: ['🌤', 'Überwiegend klar'], 2: ['⛅', 'Teilweise bewölkt'], 3: ['☁️', 'Bedeckt'],
    45: ['🌫', 'Nebel'], 48: ['🌫', 'Nebel mit Reif'],
    51: ['🌦', 'Leichter Nieselregen'], 53: ['🌦', 'Nieselregen'], 55: ['🌧', 'Starker Nieselregen'],
    56: ['🌧', 'Gefrierender Nieselregen'], 57: ['🌧', 'Gefrierender Nieselregen'],
    61: ['🌦', 'Leichter Regen'], 63: ['🌧', 'Regen'], 65: ['🌧', 'Starker Regen'],
    66: ['🌧', 'Gefrierender Regen'], 67: ['🌧', 'Gefrierender Regen'],
    71: ['🌨', 'Leichter Schneefall'], 73: ['🌨', 'Schneefall'], 75: ['❄️', 'Starker Schneefall'], 77: ['🌨', 'Schneegriesel'],
    80: ['🌦', 'Leichte Regenschauer'], 81: ['🌧', 'Regenschauer'], 82: ['⛈', 'Heftige Regenschauer'],
    85: ['🌨', 'Schneeschauer'], 86: ['🌨', 'Starke Schneeschauer'],
    95: ['⛈', 'Gewitter'], 96: ['⛈', 'Gewitter mit Hagel'], 99: ['⛈', 'Schweres Gewitter mit Hagel']
  };
  const wmo = (c) => WMO[c] || ['🌡', '–'];
  const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const compass = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  // Pfeil zeigt, wohin der Wind weht (Windrichtung = woher er kommt)
  const arrow = (deg, size = 16, color = 'currentColor') =>
    `<svg class="wx-arrow" width="${size}" height="${size}" viewBox="0 0 16 16" style="transform:rotate(${deg + 180}deg)"><path d="M8 1 13 12 8 9.5 3 12Z" fill="${color}"/></svg>`;
  const windColor = (v) => v < 12 ? '#4a7f5b' : v < 25 ? '#2f6fd6' : v < 40 ? '#e08a00' : v < 62 ? '#d6332a' : '#8b1a8b';
  const r0 = (v) => Math.round(v);
  const dayName = (iso, i) => i === 0 ? 'Heute' : i === 1 ? 'Morgen'
    : new Date(iso + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
  // Wetterlage aus dem Luftdruck auf Meereshöhe
  const situation = (p) => p >= 1025 ? ['H', 'Kräftiges Hoch – meist stabil und trocken']
    : p >= 1015 ? ['H', 'Hochdruckeinfluss – eher freundlich']
    : p > 1005 ? ['', 'Übergangsbereich – wechselhaft möglich']
    : p > 995 ? ['T', 'Tiefdruckeinfluss – Wolken und Regen wahrscheinlich']
    : ['T', 'Kräftiges Tief – Regen und Wind, evtl. Sturm'];

  /* =========================================================
     1) Wetter am Standort
     ========================================================= */
  let data = null;   // { j: API-Antwort, lat, lng, t }
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  let loading = false;

  function position() {
    if (typeof lastFix !== 'undefined' && lastFix) return { lat: lastFix.p[0], lng: lastFix.p[1], gps: true };
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng, gps: false };
  }

  async function refresh(force) {
    const pos = position();
    if (loading || !navigator.onLine) { render(); return; }
    const fresh = data && Date.now() - data.t < REFRESH_MS && haversine([data.lat, data.lng], [pos.lat, pos.lng]) < 5000;
    if (fresh && !force) { render(); return; }
    loading = true; render();
    try {
      const url = `${API}?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}`
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl'
        + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant'
        + '&forecast_days=5&timezone=auto&wind_speed_unit=kmh';
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      data = { j, lat: pos.lat, lng: pos.lng, gps: pos.gps, t: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    } catch (e) { if (!data) toast('Wetter konnte nicht geladen werden'); }
    loading = false;
    render();
  }

  function render() {
    const box = el('weather');
    if (box.hidden) return;
    const body = el('weatherBody');
    if (!data) { body.innerHTML = `<p class="hint">${loading ? 'Wetter wird geladen…' : navigator.onLine ? 'Noch keine Wetterdaten.' : 'Offline – noch keine Wetterdaten gespeichert.'}</p>`; return; }
    const { j } = data, c = j.current, h = j.hourly, d = j.daily;
    const [icon, text] = wmo(c.weather_code);
    // Index der aktuellen Stunde in der Stundenliste
    let hi = h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13));
    if (hi < 0) hi = 0;
    const rainNow = h.precipitation_probability[hi];
    const [sym, sit] = situation(c.pressure_msl);
    const ageMin = Math.round((Date.now() - data.t) / 60000);

    let html = `
      <div class="wx-now">
        <div class="wx-big">${icon}<b>${r0(c.temperature_2m)}°</b></div>
        <div class="wx-desc"><b>${text}</b><br><small>gefühlt ${r0(c.apparent_temperature)}° · Luftfeuchte ${c.relative_humidity_2m} %</small></div>
      </div>
      <div class="pi-row"><span>Wind</span><b>${arrow(c.wind_direction_10m, 18, windColor(c.wind_speed_10m))} aus ${compass(c.wind_direction_10m)} · ${r0(c.wind_speed_10m)} km/h<br><small>Böen ${r0(c.wind_gusts_10m)} km/h</small></b></div>
      <div class="pi-row"><span>Regenwahrscheinlichkeit<br><small>diese Stunde</small></span><b>💧 ${rainNow != null ? rainNow + ' %' : '–'}</b></div>
      <div class="pi-row"><span>Luftdruck (Meereshöhe)<br><small>${sit}</small></span><b>${sym ? `<span class="wx-ht ${sym === 'H' ? 'h' : 't'}">${sym}</span> ` : ''}${r0(c.pressure_msl)} hPa</b></div>
      <h3>Nächste 24 Stunden</h3>
      <div class="wx-hours">`;
    for (let i = hi; i < Math.min(hi + 24, h.time.length); i++) {
      html += `<div class="wx-h">
        <small>${i === hi ? 'jetzt' : h.time[i].slice(11, 13) + ' Uhr'}</small>
        <span class="wx-ic">${wmo(h.weather_code[i])[0]}</span>
        <b>${r0(h.temperature_2m[i])}°</b>
        <span class="wx-rain${h.precipitation_probability[i] >= 50 ? ' hi' : ''}">💧${h.precipitation_probability[i] ?? '–'}%</span>
        <span class="wx-wind">${arrow(h.wind_direction_10m[i], 14, windColor(h.wind_speed_10m[i]))}${r0(h.wind_speed_10m[i])}</span>
      </div>`;
    }
    html += `</div><h3>Nächste Tage</h3><ul class="wx-days">`;
    for (let i = 0; i < d.time.length; i++) {
      html += `<li>
        <span class="wx-dn">${dayName(d.time[i], i)}</span>
        <span class="wx-ic">${wmo(d.weather_code[i])[0]}</span>
        <span class="wx-t"><b>${r0(d.temperature_2m_max[i])}°</b> / ${r0(d.temperature_2m_min[i])}°</span>
        <span class="wx-rain${d.precipitation_probability_max[i] >= 50 ? ' hi' : ''}">💧${d.precipitation_probability_max[i] ?? '–'}%</span>
        <span class="wx-wind">${arrow(d.wind_direction_10m_dominant[i], 14, windColor(d.wind_speed_10m_max[i]))}${r0(d.wind_speed_10m_max[i])}</span>
      </li>`;
    }
    html += `</ul>
      <button id="wxMapBtn" class="${map.hasLayer(wxLayer) ? '' : 'primary'}">🌀 Wetterkarte ${map.hasLayer(wxLayer) ? 'ausblenden' : 'einblenden'} (Hoch/Tief, Wind)</button>
      <p class="hint">${data.gps ? 'Für deinen Standort' : 'Für die Kartenmitte (kein GPS)'} · Stand: vor ${ageMin < 1 ? 'weniger als 1' : ageMin} Min.${navigator.onLine ? '' : ' · offline – letzter bekannter Stand'}<br>
      Wind in km/h, Pfeil zeigt, wohin der Wind weht. Quelle: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (Wettermodelle u. a. DWD)</p>`;
    body.innerHTML = html;
    el('wxMapBtn').onclick = () => {
      if (map.hasLayer(wxLayer)) map.removeLayer(wxLayer); else { wxLayer.addTo(map); box.hidden = true; }
      render();
    };
  }

  function openPanel() {
    const box = el('weather');
    box.hidden = !box.hidden;
    if (!box.hidden) { el('legend').hidden = true; render(); refresh(false); }
  }
  el('weatherClose').onclick = () => { el('weather').hidden = true; };
  setInterval(() => { if (!el('weather').hidden) refresh(false); }, 60 * 1000);
  window.addEventListener('online', () => { if (!el('weather').hidden) refresh(true); });

  // Kachel auf der Karte (unter der Legenden-Kachel)
  const WeatherButton = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const b = L.DomUtil.create('button', 'legend-btn');
      b.type = 'button'; b.title = 'Wetter'; b.textContent = '⛅';
      L.DomEvent.disableClickPropagation(b);
      b.onclick = openPanel;
      return b;
    }
  });
  new WeatherButton().addTo(map);

  /* =========================================================
     2) Wetterkarte: Hoch/Tief, Isobaren, Wind, Temperatur
     ========================================================= */
  const N = 9;                 // Raster N×N Punkte
  const UP = 4;                // Verfeinerung für glatte Isobaren
  const STEP = 4;              // Isobarenabstand in hPa
  map.createPane('weather').style.zIndex = 450;
  const wxRenderer = L.svg({ pane: 'weather' });
  const wxLayer = L.layerGroup();
  layerControl.addOverlay(wxLayer, '🌀 Wetterkarte (Hoch/Tief, Wind)');

  let grid = null;             // { lat0, lon0, dLat, dLon, P, W, D, T, t }
  let gridLoading = false, lastFetch = 0, timer = null;

  // Rasterbereich: sichtbarer Ausschnitt, aber mindestens ~ 6° × 9° (sonst sind Hochs/Tiefs nicht erkennbar)
  function wantedArea() {
    const b = map.getBounds(), c = b.getCenter();
    let h = Math.min(Math.max((b.getNorth() - b.getSouth()) * 1.3, 6), 50);
    let w = Math.min(Math.max((b.getEast() - b.getWest()) * 1.3, 9), 80);
    let s = Math.max(c.lat - h / 2, -80), n = Math.min(c.lat + h / 2, 80);
    return { s, w: c.lng - w / 2, n, e: c.lng + w / 2 };
  }
  function gridFits(a) {
    if (!grid || Date.now() - grid.t > 30 * 60 * 1000) return false;
    const gs = grid.lat0, gn = grid.lat0 + grid.dLat * (N - 1), gw = grid.lon0, ge = grid.lon0 + grid.dLon * (N - 1);
    const inside = a.s >= gs - 0.01 && a.n <= gn + 0.01 && a.w >= gw - 0.01 && a.e <= ge + 0.01;
    const notTooCoarse = (a.n - a.s) > (gn - gs) * 0.45;   // stark hineingezoomt → feineres Raster laden
    return inside && notTooCoarse;
  }

  async function loadGrid() {
    if (!map.hasLayer(wxLayer)) return;
    const a = wantedArea();
    if (gridFits(a)) { draw(); return; }
    if (!navigator.onLine) { toast('Wetterkarte braucht Internet'); return; }
    if (gridLoading) return;
    const wait = 8000 - (Date.now() - lastFetch);   // Dienst schonen
    if (wait > 0) { clearTimeout(timer); timer = setTimeout(loadGrid, wait); return; }
    gridLoading = true; lastFetch = Date.now();
    const dLat = (a.n - a.s) / (N - 1), dLon = (a.e - a.w) / (N - 1);
    const lats = [], lons = [];
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      lats.push((a.s + i * dLat).toFixed(2));
      lons.push((((a.w + k * dLon) + 540) % 360 - 180).toFixed(2));
    }
    try {
      const url = `${API}?latitude=${lats.join(',')}&longitude=${lons.join(',')}`
        + '&current=pressure_msl,wind_speed_10m,wind_direction_10m,temperature_2m&wind_speed_unit=kmh';
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let arr = await res.json();
      if (!Array.isArray(arr)) arr = [arr];
      const P = [], W = [], D = [], T = [];
      for (let i = 0; i < N; i++) { P.push([]); W.push([]); D.push([]); T.push([]); }
      arr.forEach((o, idx) => {
        const i = Math.floor(idx / N), c = o.current;
        P[i].push(c.pressure_msl); W[i].push(c.wind_speed_10m); D[i].push(c.wind_direction_10m); T[i].push(c.temperature_2m);
      });
      grid = { lat0: a.s, lon0: a.w, dLat, dLon, P, W, D, T, t: Date.now() };
      draw();
    } catch (e) { toast('Wetterkarte konnte nicht geladen werden'); }
    gridLoading = false;
  }

  // Catmull-Rom-Interpolation → glatte Linien aus dem groben Raster
  const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  function refine(P) {
    const M = (N - 1) * UP + 1, at = (row, k) => row[Math.max(0, Math.min(N - 1, k))];
    const line = (row) => {
      const out = [];
      for (let x = 0; x < M; x++) {
        const k = Math.floor(x / UP), t = (x % UP) / UP;
        out.push(t === 0 ? at(row, k) : cr(at(row, k - 1), at(row, k), at(row, k + 1), at(row, k + 2), t));
      }
      return out;
    };
    const rows = P.map(line);                                       // N × M
    const F = Array.from({ length: M }, () => new Array(M));
    for (let x = 0; x < M; x++) {
      const col = line(rows.map((r) => r[x]));                      // M
      for (let y = 0; y < M; y++) F[y][x] = col[y];
    }
    return F;
  }

  // Marching Squares: Liniensegmente einer Druckstufe
  function contour(F, level, toLL) {
    const M = F.length, segs = [];
    const lerp = (a, b) => (level - a) / (b - a);
    for (let y = 0; y < M - 1; y++) for (let x = 0; x < M - 1; x++) {
      const a = F[y][x], b = F[y][x + 1], c = F[y + 1][x + 1], d = F[y + 1][x];
      const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const S = toLL(y, x + lerp(a, b)), E = toLL(y + lerp(b, c), x + 1), Nn = toLL(y + 1, x + lerp(d, c)), W = toLL(y + lerp(a, d), x);
      const add = (p, q) => segs.push([p, q]);
      switch (idx) {
        case 1: case 14: add(W, S); break;
        case 2: case 13: add(S, E); break;
        case 3: case 12: add(W, E); break;
        case 4: case 11: add(E, Nn); break;
        case 6: case 9: add(S, Nn); break;
        case 7: case 8: add(W, Nn); break;
        case 5: case 10: {
          const center = (a + b + c + d) / 4 >= level;
          if ((idx === 5) === center) { add(W, Nn); add(S, E); } else { add(W, S); add(E, Nn); }
          break;
        }
      }
    }
    return segs;
  }

  function draw() {
    wxLayer.clearLayers();
    if (!grid) return;
    const g = grid, F = refine(g.P);
    const toLL = (y, x) => [g.lat0 + y * g.dLat / UP, g.lon0 + x * g.dLon / UP];
    let min = Infinity, max = -Infinity;
    F.forEach((r) => r.forEach((v) => { if (v < min) min = v; if (v > max) max = v; }));

    // Isobaren
    for (let lv = Math.ceil(min / STEP) * STEP; lv <= max; lv += STEP) {
      const segs = contour(F, lv, toLL);
      if (!segs.length) continue;
      L.polyline(segs, { renderer: wxRenderer, color: '#3c4a8c', weight: lv % 20 === 0 ? 2.5 : 1.5, opacity: 0.85, interactive: false }).addTo(wxLayer);
      const m = segs[Math.floor(segs.length / 2)][0];
      L.marker(m, { pane: 'weather', interactive: false,
        icon: L.divIcon({ className: 'isobar-lbl', html: `<span>${lv}</span>`, iconSize: null }) }).addTo(wxLayer);
    }

    // Hoch- und Tiefdruckzentren (Extremwerte im Inneren des Rasters)
    for (let i = 1; i < N - 1; i++) for (let k = 1; k < N - 1; k++) {
      const v = g.P[i][k];
      let isMax = true, isMin = true, sum = 0;
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dk) continue;
        const u = g.P[i + di][k + dk]; sum += u;
        if (u >= v) isMax = false;
        if (u <= v) isMin = false;
      }
      if ((isMax || isMin) && Math.abs(v - sum / 8) > 0.3) {
        const hi = isMax;
        L.marker([g.lat0 + i * g.dLat, g.lon0 + k * g.dLon], { pane: 'weather', interactive: false,
          icon: L.divIcon({ className: 'wx-center ' + (hi ? 'h' : 't'), iconSize: [40, 44], iconAnchor: [20, 22],
            html: `<b>${hi ? 'H' : 'T'}</b><small>${Math.round(v)}</small>` }) }).addTo(wxLayer);
      }
    }

    // Wind und Temperatur an jedem Rasterpunkt
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      const w = g.W[i][k], dir = g.D[i][k], t = g.T[i][k], p = g.P[i][k];
      if (w == null) continue;
      const size = w < 12 ? 16 : w < 25 ? 20 : w < 40 ? 24 : 28;
      L.marker([g.lat0 + i * g.dLat, g.lon0 + k * g.dLon], { pane: 'weather',
        icon: L.divIcon({ className: 'wx-pt', iconSize: [44, 40], iconAnchor: [22, 14],
          html: `${arrow(dir, size, windColor(w))}<span>${Math.round(t)}°</span>` }) })
        .bindPopup(`<b>Wind aus ${compass(dir)}: ${Math.round(w)} km/h</b><br>Temperatur: ${t.toLocaleString('de-DE', { maximumFractionDigits: 1 })} °C<br>Luftdruck: ${Math.round(p)} hPa`)
        .addTo(wxLayer);
    }
  }

  map.on('moveend', () => { if (map.hasLayer(wxLayer)) { clearTimeout(timer); timer = setTimeout(loadGrid, 700); } });
  // layeradd/layerremove: gilt für die Ebenen-Auswahl und für den Knopf im Wetterfenster
  map.on('layeradd', (e) => {
    if (e.layer !== wxLayer) return;
    try { localStorage.setItem(MAPKEY, '1'); } catch (err) {}
    loadGrid();
    if (map.getZoom() > 7) toast('Wetterkarte: Zum Erkennen von Hoch und Tief herauszoomen');
    render();
  });
  map.on('layerremove', (e) => {
    if (e.layer !== wxLayer) return;
    try { localStorage.setItem(MAPKEY, '0'); } catch (err) {}
    render();
  });
  let on = false;
  try { on = localStorage.getItem(MAPKEY) === '1'; } catch (e) {}
  if (on) wxLayer.addTo(map);

  window.weatherMap = { layer: wxLayer, windColor };
})();
