'use strict';

/* ---------- Einstellungen ---------- */
const MAX_ACCURACY_M = 35;   // ungenauere GPS-Fixes ignorieren
const MIN_STEP_M = 4;        // kleinere Bewegungen = GPS-Rauschen
const STORE_KEY = 'outdoorNavi.v1';

/* ---------- Karte (OpenTopoMap) ---------- */
const map = L.map('map', { zoomControl: true }).setView([51.1657, 10.4515], 6);
// Flüssiges Wischen: Kacheln schon während der Bewegung laden (Leaflet wartet auf Handys sonst,
// bis die Bewegung ganz vorbei ist → weiße Flächen) und ringsum mehr Reserve vorhalten.
const SMOOTH = { updateWhenIdle: false, keepBuffer: 4 };
// Grobe Unterlage: dieselbe Karte 2 Zoomstufen gröber (1024-px-Kacheln = 16× weniger Kacheln).
// Ist sofort da und füllt Lücken unscharf, bis die scharfen Kacheln geladen sind.
const underlay = (url, opts) => L.tileLayer(url, Object.assign({
  tileSize: 1024, zoomOffset: -2, minNativeZoom: 2, updateWhenIdle: false, keepBuffer: 2, zIndex: 0
}, opts));

// crossOrigin: Kacheln werden als normale (nicht „opake“) Antworten geladen – wichtig für den Offline-Speicher
const OTM_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const otmLayer = L.tileLayer(OTM_URL, Object.assign({
  maxZoom: 19, maxNativeZoom: 17,   // ab Zoom 18 (nur für Satellit sinnvoll) wird die Topokarte vergrößert
  subdomains: 'abc',
  crossOrigin: true, zIndex: 1,
  attribution: 'Karte: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · Daten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende, SRTM'
}, SMOOTH));
window.otmLayer = otmLayer;
const otmUnder = underlay(OTM_URL, { maxZoom: 19, maxNativeZoom: 17, subdomains: 'abc', crossOrigin: true });
const topoBase = L.layerGroup([otmUnder, otmLayer]);

/* ---------- Satellitenbild (Esri World Imagery) + Straßen und Ortsnamen ---------- */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const satLayer = L.layerGroup([
  underlay(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 19 }),
  L.tileLayer(ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', Object.assign({
    maxZoom: 19, maxNativeZoom: 19, zIndex: 1,
    attribution: 'Satellitenbild: © Esri, Maxar, Earthstar Geographics u. a.'
  }, SMOOTH)),
  L.tileLayer(ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.7 }),
  L.tileLayer(ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })
]);
window.baseLayers = { topo: topoBase, sat: satLayer };
const BASE_KEY = 'outdoorNavi.base';
let baseName = 'topo';
try { if (localStorage.getItem(BASE_KEY) === 'sat') baseName = 'sat'; } catch (e) {}
if (baseName === 'sat' && !navigator.onLine) baseName = 'topo';   // Satellit braucht Internet
baseLayers[baseName].addTo(map);

/* ---------- Schutzgebiete (Bundesamt für Naturschutz, amtliche Daten) ---------- */
// Reihenfolge = Zeichenreihenfolge: LSG unten, Biosphärenreservate, NSG oben
const BFN_WMS = 'https://geodienste.bfn.de/ogc/wms/schutzgebiet';
const SCHUTZ = [
  { key: 'lsg', layer: 'Landschaftsschutzgebiete', label: 'Landschaftsschutzgebiete (LSG)', color: '#1a9e33' },
  { key: 'bio', layer: 'Biosphaerenreservate', label: 'Biosphärenreservate', color: '#8f33c7' },
  { key: 'nsg', layer: 'Naturschutzgebiete', label: 'Naturschutzgebiete (NSG)', color: '#db1414' }
];
/* Ein-/Ausschalten der Ebenen merken (gilt nach Neustart der App weiter) */
const OVL_KEY = 'outdoorNavi.overlays.v1';
let ovlState = {};
try { ovlState = JSON.parse(localStorage.getItem(OVL_KEY)) || {}; } catch (e) {}
// Soll die Ebene beim Start sichtbar sein? Ohne gespeicherte Wahl: Standard (an)
window.overlayWanted = (key, def = true) => (key in ovlState ? !!ovlState[key] : def);
// Künftige Änderungen (Ebenen-Auswahl) speichern
window.trackOverlay = (layer, key) => {
  const store = (on) => { ovlState[key] = on; try { localStorage.setItem(OVL_KEY, JSON.stringify(ovlState)); } catch (e) {} };
  map.on('layeradd', (e) => { if (e.layer === layer) store(true); });
  map.on('layerremove', (e) => { if (e.layer === layer) store(false); });
};

const overlays = {};
SCHUTZ.forEach((s, i) => {
  map.createPane('sg-' + s.key).style.zIndex = 300 + i;   // über der Topo-Karte, unter dem Track
  const lyr = L.tileLayer.wms(BFN_WMS, {
    layers: s.layer, styles: '', format: 'image/png', transparent: true, version: '1.3.0',
    tileSize: 512, zoomOffset: 0, opacity: 0.85, maxZoom: 19, updateWhenIdle: false,
    pane: 'sg-' + s.key, className: 'sg-' + s.key,
    referrerPolicy: 'no-referrer',   // BfN-Server blockt Anfragen mit fremdem Referer
    crossOrigin: true,
    attribution: 'Schutzgebiete: © <a href="https://www.bfn.de">BfN</a>'
  });
  if (overlayWanted('sg-' + s.key)) lyr.addTo(map);
  trackOverlay(lyr, 'sg-' + s.key);
  s.tileLayer = lyr;
  overlays[`<span class="swatch" style="color:${s.color}"></span>${s.label}`] = lyr;
});
const layerControl = L.control.layers(
  { '🗺 Topokarte': topoBase, '🛰 Satellitenbild': satLayer }, overlays,
  { position: 'topright', collapsed: true }
).addTo(map);
window.layerControl = layerControl;
window.schutzLayers = SCHUTZ.map((s) => s.tileLayer);

/* Kartenart umschalten (Knopf auf der Karte und Ebenen-Auswahl) */
function setBase(name, quiet) {
  if (name === 'sat' && !navigator.onLine) { toast('Satellitenbilder brauchen Internet.'); return; }
  const other = name === 'sat' ? 'topo' : 'sat';
  if (map.hasLayer(baseLayers[other])) map.removeLayer(baseLayers[other]);
  if (!map.hasLayer(baseLayers[name])) baseLayers[name].addTo(map);
  baseLayers[name].bringToBack && baseLayers[name].bringToBack();
}
map.on('baselayerchange', (e) => {
  baseName = e.layer === satLayer ? 'sat' : 'topo';
  try { localStorage.setItem(BASE_KEY, baseName); } catch (err) {}
  const btn = document.querySelector('.base-btn');
  if (btn) { btn.textContent = baseName === 'sat' ? '🗺' : '🛰'; btn.title = baseName === 'sat' ? 'Topokarte zeigen' : 'Satellitenbild zeigen'; }
});
const BaseButton = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const b = L.DomUtil.create('button', 'legend-btn base-btn');
    b.type = 'button';
    b.textContent = baseName === 'sat' ? '🗺' : '🛰';
    b.title = baseName === 'sat' ? 'Topokarte zeigen' : 'Satellitenbild zeigen';
    L.DomEvent.disableClickPropagation(b);
    b.onclick = () => {
      const next = baseName === 'sat' ? 'topo' : 'sat';
      if (next === 'sat' && !navigator.onLine) { toast('Satellitenbilder brauchen Internet.'); return; }
      setBase(next);
      map.fire('baselayerchange', { layer: baseLayers[next], name: next });
      // Ebenen-Auswahl synchron halten
      layerControl._update && layerControl._update();
    };
    return b;
  }
});
map.addControl(new BaseButton());
window.addEventListener('offline', () => {
  if (baseName === 'sat') { setBase('topo'); map.fire('baselayerchange', { layer: topoBase }); layerControl._update(); toast('📴 Offline – zurück zur Topokarte (Satellitenbilder brauchen Internet)'); }
});

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

/* ---------- Höhe ----------
   Browser liefern die GPS-Höhe je nach Gerät über dem Ellipsoid (Android: in Deutschland
   ca. 45–50 m zu hoch) oder über dem Meer (iPhone) – und mit ±10–30 m Messfehler.
   Lösung: Online gilt die Geländehöhe aus dem Copernicus-Höhenmodell (Open-Meteo).
   Dabei lernt die App die Abweichung des Handys (GPS − Gelände) und korrigiert damit
   die GPS-Höhe auch offline. */
const ELEV_KEY = 'outdoorNavi.elev.v1';
const elev = { samples: [], dem: null, smooth: null };   // dem: { lat, lng, h, t }
try { elev.samples = JSON.parse(localStorage.getItem(ELEV_KEY)) || []; } catch (e) {}
let elevBusy = false;
function elevOffset() {
  if (elev.samples.length < 2) return null;
  const s = elev.samples.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];   // Median = robust gegen Ausreißer
}
// GPS-Höhe (roh) -> Höhe über dem Meeresspiegel
function correctAlt(raw) {
  if (raw == null || isNaN(raw)) return null;
  const off = elevOffset();
  return off == null ? raw : raw - off;
}
async function lookupTerrain(lat, lng, rawAlt, altAcc) {
  if (elevBusy || !navigator.onLine) return;
  const d = elev.dem;
  if (d && haversine([d.lat, d.lng], [lat, lng]) < 40 && Date.now() - d.t < 5 * 60000) return;
  elevBusy = true;
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}`)).json();
    const h = j.elevation && j.elevation[0];
    if (h != null && isFinite(h)) {
      elev.dem = { lat, lng, h, t: Date.now() };
      // Abweichung nur aus guten Messungen lernen
      if (rawAlt != null && (altAcc == null || altAcc <= 25)) {
        elev.samples.push(Math.round((rawAlt - h) * 10) / 10);
        if (elev.samples.length > 25) elev.samples.shift();
        try { localStorage.setItem(ELEV_KEY, JSON.stringify(elev.samples)); } catch (e) {}
      }
      render();
    }
  } catch (e) { /* offline / Fehler: GPS-Höhe verwenden */ }
  elevBusy = false;
}
// Angezeigte Höhe: Gelände (online, in der Nähe) – sonst korrigierte, geglättete GPS-Höhe
function currentAltitude() {
  if (!lastFix) return null;
  const d = elev.dem;
  if (d && haversine([d.lat, d.lng], lastFix.p) < 60 && Date.now() - d.t < 10 * 60000) return { h: d.h, src: 'dem' };
  if (elev.smooth != null) return { h: elev.smooth, src: elevOffset() != null ? 'gps' : 'raw' };
  return null;
}
window.currentAltitude = currentAltitude;

/* ---------- GPS ---------- */
function onPosition(pos) {
  const c = pos.coords;
  const alt = correctAlt(c.altitude);
  const p = [c.latitude, c.longitude, alt != null ? Math.round(alt * 10) / 10 : null, pos.timestamp];
  const prev = lastFix;
  lastFix = { p, acc: c.accuracy, speed: c.speed, t: pos.timestamp, rawAlt: c.altitude };
  if (alt != null) elev.smooth = elev.smooth == null ? alt : elev.smooth + 0.25 * (alt - elev.smooth);
  if (c.accuracy <= 30) lookupTerrain(c.latitude, c.longitude, c.altitude, c.altitudeAccuracy);

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
    // Höchstgeschwindigkeit (unplausible GPS-Sprünge über 150 km/h ignorieren)
    if (lastFix.speedCalc > (state.maxSpeed || 0) && lastFix.speedCalc < 42) state.maxSpeed = lastFix.speedCalc;
    const last = state.points[state.points.length - 1];
    if (!last || state.gapNext) {
      // nach Pause: Strecke während der Pause nicht mitzählen; 5. Feld = Beginn eines neuen Abschnitts
      if (last) p.push(1);
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
    const a = currentAltitude();
    // „≈“ = GPS-Höhe noch ohne Abgleich mit dem Höhenmodell (ungenau)
    $('alt').textContent = a ? (a.src === 'raw' ? '≈' : '') + Math.round(a.h) : '–';
    $('alt').title = a ? { dem: 'Geländehöhe (Höhenmodell)', gps: 'GPS-Höhe, korrigiert', raw: 'GPS-Höhe, noch nicht abgeglichen' }[a.src] : '';
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
    // Vorherige Tour sichern, falls das noch nicht passiert ist
    if (state.points.length >= 2 && !state.savedId && window.saveTour) saveTour(JSON.parse(JSON.stringify(state)));
    const keepAll = state.allTime;
    state = { running: true, paused: false, points: [], distance: 0, activeMs: 0, maxSpeed: 0, startedAt: Date.now(), resumedAt: Date.now(), allTime: keepAll };
    trackLine.setLatLngs([]);
    toast('Aufzeichnung gestartet – Display nicht ausschalten, für die Tasche: ☰ → 🌙 Taschenmodus', 6000);
  } else {
    state.paused = false; state.resumedAt = Date.now(); state.gapNext = true;
    toast('Fortgesetzt');
  }
  follow = true; requestWakeLock(); save(); render();
  if (window.topTiles) topTiles.show();   // Statistik-Kacheln oben automatisch einblenden
};
$('btnPause').onclick = () => {
  state.activeMs = activeMs(); state.paused = true; state.resumedAt = null;
  save(); render(); toast('Pausiert');
};
$('btnStop').onclick = () => {
  state.activeMs = activeMs(); state.running = false; state.paused = false; state.resumedAt = null;
  state.endedAt = Date.now();
  releaseWakeLock(); save(); render();
  if (state.points.length >= 2 && window.saveTour) {
    toast('Tour beendet: ' + fmtDist(state.distance) + ' – wird gespeichert…');
    saveTour(state).then((id) => { if (id) { state.savedId = id; save(); toast('Tour gespeichert – siehe ☰ → Meine Touren'); } });
  } else {
    toast('Tour beendet: ' + fmtDist(state.distance) + ' (zu kurz zum Speichern)');
  }
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
function toast(msg, ms) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3000);
}

/* ---------- Start ---------- */
load();
if (state.points.length) trackLine.setLatLngs(state.points.map((p) => [p[0], p[1]]));
if (state.running && !state.paused) { state.resumedAt = state.resumedAt || Date.now(); requestWakeLock(); }
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Knopf „App aktualisieren“: App-Speicher leeren (Kartenkacheln, Fotos und Touren bleiben) und frisch laden
  document.getElementById('btnUpdate').onclick = async () => {
    if (state.running && !confirm('Eine Aufzeichnung läuft. Trotzdem neu laden?')) return;
    try {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) if (k.startsWith('outdoor-app')) await caches.delete(k);
      // Auch den Browser-Cache der eigenen Dateien auffrischen
      const own = [...document.querySelectorAll('script[src], link[rel=stylesheet]')]
        .map((n) => n.src || n.href).filter((u) => u.startsWith(location.origin));
      await Promise.all(['sw.js', ...own].map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
    } catch (e) { /* trotzdem neu laden */ }
    location.replace(location.pathname + '?v=' + Date.now());
  };
  // updateViaCache 'none': sw.js selbst immer frisch prüfen
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update()).catch(() => {});
  // Neue Version installiert -> Seite einmal neu laden, damit sie sofort sichtbar ist
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    // Während einer Aufzeichnung nicht stören – neue Version kommt beim nächsten Öffnen
    if (state.running) return;
    reloaded = true;
    location.reload();
  });
}
