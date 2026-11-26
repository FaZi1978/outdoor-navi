'use strict';

/* ---------- Einstellungen ---------- */
const MAX_ACCURACY_M = 35;   // ungenauere GPS-Fixes ignorieren
const MIN_STEP_M = 4;        // kleinere Bewegungen = GPS-Rauschen
const STORE_KEY = 'outdoorNavi.v1';

/* ---------- Karte (OpenTopoMap) ---------- */
const map = L.map('map', { zoomControl: true }).setView([51.1657, 10.4515], 6);
// crossOrigin: Kacheln werden als normale (nicht „opake“) Antworten geladen – wichtig für den Offline-Speicher
const otmLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  subdomains: 'abc',
  crossOrigin: true,
  attribution: 'Karte: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Daten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM'
}).addTo(map);
window.otmLayer = otmLayer;

/* ---------- Schutzgebiete (Bundesamt für Naturschutz, amtliche Daten) ---------- */
// Reihenfolge = Zeichenreihenfolge: LSG unten, Biosphärenreservate, NSG oben
const BFN_WMS = 'https://geodienste.bfn.de/ogc/wms/schutzgebiet';
const SCHUTZ = [
  { key: 'lsg', layer: 'Landschaftsschutzgebiete', label: 'Landschaftsschutzgebiete (LSG)', color: '#1a9e33' },
  { key: 'bio', layer: 'Biosphaerenreservate', label: 'Biosphärenreservate', color: '#8f33c7' },
  { key: 'nsg', layer: 'Naturschutzgebiete', label: 'Naturschutzgebiete (NSG)', color: '#db1414' }
];
const overlays = {};
SCHUTZ.forEach((s, i) => {
  map.createPane('sg-' + s.key).style.zIndex = 300 + i;   // über der Topo-Karte, unter dem Track
  const lyr = L.tileLayer.wms(BFN_WMS, {
    layers: s.layer, styles: '', format: 'image/png', transparent: true, version: '1.3.0',
    tileSize: 512, zoomOffset: 0, opacity: 0.85, maxZoom: 17,
    pane: 'sg-' + s.key, className: 'sg-' + s.key,
    referrerPolicy: 'no-referrer',   // BfN-Server blockt Anfragen mit fremdem Referer
    crossOrigin: true,
    attribution: 'Schutzgebiete: © <a href="https://www.bfn.de">BfN</a>'
  });
  lyr.addTo(map);
  s.tileLayer = lyr;
  overlays[`<span class="swatch" style="color:${s.color}"></span>${s.label}`] = lyr;
});
const layerControl = L.control.layers(null, overlays, { position: 'topright', collapsed: true }).addTo(map);
window.layerControl = layerControl;
window.schutzLayers = SCHUTZ.map((s) => s.tileLayer);

const $ = (id) => document.getElementById(id);
const trackLine = L.polyline([], { color: '#d6332a', weight: 5, opacity: 0.85 }).addTo(map);
const posMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="pos-marker"></div>', iconSize: [18, 18] }) });
const accCircle = L.circle([0, 0], { radius: 0, weight: 1, color: '#1e7cf2', fillOpacity: 0.1 });
let routeLayer = null;
let targetMarker = null, targetLine = null, target = null;

/* ---------- Zustand ---------- */
let state = {
  running: false, paused: false,
  points: [],          // [lat, lng, ele, t]
  distance: 0,         // Meter dieser Tour
  activeMs: 0,         // Zeit ohne Pausen
  resumedAt: null,     // Zeitstempel letzter Start/Fortsetzen
  allTime: 0           // Meter aller Touren
};
let lastFix = null;    // letzter GPS-Fix (auch ohne Aufzeichnung)
let follow = true;
let wakeLock = null;

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) state = Object.assign(state, s);
  } catch (e) {}
}

/* ---------- Geometrie ---------- */
function haversine(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const toR = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
  const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const fmtKm = (m, d = 2) => (m / 1000).toFixed(d).replace('.', ',');
const fmtDist = (m) => m < 1000 ? Math.round(m) + ' m' : fmtKm(m, m < 10000 ? 2 : 1) + ' km';

/* ---------- GPS ---------- */
function onPosition(pos) {
  const c = pos.coords;
  const p = [c.latitude, c.longitude, c.altitude, pos.timestamp];
  const prev = lastFix;
  lastFix = { p, acc: c.accuracy, speed: c.speed, t: pos.timestamp };

  // Momentangeschwindigkeit: GPS-Wert bevorzugen, sonst aus letzter Strecke berechnen
  let speed = (c.speed != null && !isNaN(c.speed)) ? c.speed : null;
  if (speed == null && prev && pos.timestamp > prev.t) {
    speed = haversine(prev.p, p) / ((pos.timestamp - prev.t) / 1000);
  }
  lastFix.speedCalc = (speed != null && c.accuracy <= MAX_ACCURACY_M) ? speed : 0;

  if (!map.hasLayer(posMarker)) { posMarker.addTo(map); accCircle.addTo(map); map.setView([p[0], p[1]], 15); }
  posMarker.setLatLng([p[0], p[1]]);
  accCircle.setLatLng([p[0], p[1]]).setRadius(c.accuracy);
  if (follow) map.panTo([p[0], p[1]], { animate: true });

  if (state.running && !state.paused && c.accuracy <= MAX_ACCURACY_M) {
    const last = state.points[state.points.length - 1];
    if (!last || state.gapNext) {
      // nach Pause: Strecke während der Pause nicht mitzählen
      state.gapNext = false;
      state.points.push(p); trackLine.addLatLng([p[0], p[1]]);
    } else {
      const d = haversine(last, p);
      if (d >= Math.max(MIN_STEP_M, c.accuracy * 0.5)) {
        state.distance += d; state.allTime += d;
        state.points.push(p); trackLine.addLatLng([p[0], p[1]]);
        save();
      }
    }
  }
  updateNav();
  render();
}
function onPosError(err) {
  const msg = { 1: 'Standortzugriff verweigert – bitte in den Browser-Einstellungen erlauben.', 2: 'Position nicht verfügbar.', 3: 'GPS-Zeitüberschreitung.' }[err.code] || err.message;
  toast(msg);
}
if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(onPosition, onPosError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
} else {
  toast('Dieses Gerät unterstützt kein GPS/Geolocation.');
}

/* ---------- Anzeige ---------- */
function activeMs() {
  return state.activeMs + (state.running && !state.paused && state.resumedAt ? Date.now() - state.resumedAt : 0);
}
function render() {
  const ms = activeMs();
  const now = (state.running && !state.paused && lastFix && Date.now() - lastFix.t < 10000) ? lastFix.speedCalc * 3.6 : 0;
  const avg = ms > 0 ? (state.distance / 1000) / (ms / 3600000) : 0;
  $('speedNow').textContent = (now < 0.5 ? 0 : now).toFixed(1).replace('.', ',');
  $('speedAvg').textContent = avg.toFixed(1).replace('.', ',');
  $('distTotal').textContent = fmtKm(state.distance);
  $('distAll').textContent = fmtKm(state.allTime, 1);
  const s = Math.floor(ms / 1000);
  $('time').textContent = [s / 3600, (s % 3600) / 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
  if (lastFix) {
    $('alt').textContent = lastFix.p[2] != null ? Math.round(lastFix.p[2]) : '–';
    $('gpsAcc').textContent = '±' + Math.round(lastFix.acc) + ' m';
  }
  $('btnStart').hidden = state.running && !state.paused;
  $('btnStart').textContent = state.paused ? '▶ Weiter' : '▶ Start';
  $('btnPause').hidden = !state.running || state.paused;
  $('btnStop').hidden = !state.running;
}
setInterval(render, 1000);

/* ---------- Aufzeichnung ---------- */
$('btnStart').onclick = () => {
  if (!state.running) {
    const keepAll = state.allTime;
    state = { running: true, paused: false, points: [], distance: 0, activeMs: 0, resumedAt: Date.now(), allTime: keepAll };
    trackLine.setLatLngs([]);
    toast('Aufzeichnung gestartet');
  } else {
    state.paused = false; state.resumedAt = Date.now(); state.gapNext = true;
    toast('Fortgesetzt');
  }
  follow = true; requestWakeLock(); save(); render();
};
$('btnPause').onclick = () => {
  state.activeMs = activeMs(); state.paused = true; state.resumedAt = null;
  save(); render(); toast('Pausiert');
};
$('btnStop').onclick = () => {
  if (!confirm('Tour beenden? Die Werte bleiben angezeigt, bis du eine neue Tour startest.')) return;
  state.activeMs = activeMs(); state.running = false; state.paused = false; state.resumedAt = null;
  releaseWakeLock(); save(); render();
  toast('Tour beendet: ' + fmtDist(state.distance));
};

/* Bildschirm während der Aufzeichnung wach halten */
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.running && !state.paused) requestWakeLock();
});

/* ---------- Karte folgen ---------- */
map.on('dragstart', () => { follow = false; });
$('btnCenter').onclick = () => {
  follow = true;
  if (lastFix) map.setView([lastFix.p[0], lastFix.p[1]], Math.max(map.getZoom(), 15));
  else toast('Noch keine GPS-Position…');
};

/* ---------- Navigation zu einem Ziel ---------- */
map.on('contextmenu', (e) => setTarget(e.latlng));
function setTarget(latlng) {
  target = [latlng.lat, latlng.lng];
  if (targetMarker) targetMarker.setLatLng(latlng);
  else targetMarker = L.marker(latlng, { draggable: true }).addTo(map).on('drag', (ev) => { target = [ev.latlng.lat, ev.latlng.lng]; updateNav(); });
  if (!targetLine) targetLine = L.polyline([], { color: '#b23a2e', dashArray: '6 8', weight: 3 }).addTo(map);
  $('navBox').hidden = false;
  updateNav();
}
function updateNav() {
  if (!target) return;
  if (!lastFix) { $('navDist').textContent = 'warte auf GPS'; return; }
  const me = lastFix.p;
  const d = haversine(me, target), b = bearing(me, target);
  const r = window.routeRemaining ? window.routeRemaining(me) : null;
  $('navDist').textContent = r
    ? fmtDist(r.remaining) + ' entlang Route' + (r.offRoute > 50 ? ' ⚠ ' + fmtDist(r.offRoute) + ' abseits' : '')
    : fmtDist(d);
  $('navDir').textContent = DIRS[Math.round(b / 45) % 8] + ' (' + Math.round(b) + '°)';
  $('navArrow').style.transform = 'rotate(' + (b - 90) + 'deg)';
  targetLine.setLatLngs([[me[0], me[1]], target]);
  if (d < 20) toast('🎯 Ziel erreicht!');
}
$('navClear').onclick = () => {
  target = null; $('navBox').hidden = true;
  if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
  if (targetLine) { map.removeLayer(targetLine); targetLine = null; }
};

/* ---------- Menü: GPX ---------- */
$('btnMenu').onclick = () => { $('menu').hidden = !$('menu').hidden; };
map.on('click', () => { $('menu').hidden = true; });

$('btnGpxExport').onclick = () => {
  if (state.points.length < 2) return toast('Noch kein Track aufgezeichnet.');
  const pts = state.points.map((p) =>
    `<trkpt lat="${p[0].toFixed(7)}" lon="${p[1].toFixed(7)}">${p[2] != null ? `<ele>${p[2].toFixed(1)}</ele>` : ''}<time>${new Date(p[3]).toISOString()}</time></trkpt>`).join('\n      ');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Outdoor Navi" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Tour ${new Date(state.points[0][3]).toLocaleString('de-DE')}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = 'tour-' + new Date(state.points[0][3]).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.gpx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('menu').hidden = true;
};

$('gpxInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
  const nodes = [...xml.querySelectorAll('trkpt, rtept')];
  if (!nodes.length) return toast('Keine Punkte in der GPX-Datei gefunden.');
  const latlngs = nodes.map((n) => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))]);
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.polyline(latlngs, { color: '#6a3fb5', weight: 5, opacity: 0.7 }).addTo(map);
  let len = 0; for (let i = 1; i < latlngs.length; i++) len += haversine(latlngs[i - 1], latlngs[i]);
  follow = false; map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  toast('Route geladen: ' + fmtDist(len));
  $('menu').hidden = true; e.target.value = '';
};
$('btnRouteClear').onclick = () => { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } $('menu').hidden = true; };
$('btnResetAll').onclick = () => {
  if (!confirm('Summe aller Touren auf 0 setzen?')) return;
  state.allTime = state.distance; save(); render(); $('menu').hidden = true;
};

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

/* ---------- Start ---------- */
load();
if (state.points.length) trackLine.setLatLngs(state.points.map((p) => [p[0], p[1]]));
if (state.running && !state.paused) { state.resumedAt = state.resumedAt || Date.now(); requestWakeLock(); }
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
