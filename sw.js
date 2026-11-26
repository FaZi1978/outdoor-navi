// Service Worker: macht die App offline nutzbar
// - App-Dateien + Bibliotheken: sofort aus dem Cache, im Hintergrund aktualisieren
// - Kartenkacheln: Cache zuerst (auch die per „Offline-Karten“ geladenen), sonst Netz
const APP_CACHE = 'outdoor-app-v15';
const TILE_CACHE = 'outdoor-tiles-v2';     // muss zu offline.js passen
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
const APP_FILES = [
  './', './index.html', './style.css', './app.js', './route.js', './photos.js', './legend.js',
  './military.js', './offline.js', './pressure.js', './tours.js','./manifest.json', './icon.svg',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  LEAFLET + 'leaflet.css', LEAFLET + 'leaflet.js',
  LEAFLET + 'images/marker-icon.png', LEAFLET + 'images/marker-icon-2x.png', LEAFLET + 'images/marker-shadow.png',
  LEAFLET + 'images/layers.png', LEAFLET + 'images/layers-2x.png',
  'https://unpkg.com/leaflet.vectorgrid@1.3.0/dist/Leaflet.VectorGrid.bundled.js',
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js'
];

self.addEventListener('install', (e) => {
  // Einzeln laden, damit eine nicht erreichbare Datei nicht die ganze Installation scheitern lässt
  e.waitUntil(caches.open(APP_CACHE)
    .then((c) => Promise.all(APP_FILES.map((u) => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isTile = (url) => url.hostname.endsWith('tile.opentopomap.org') || url.hostname === 'geodienste.bfn.de'
  || (url.hostname === 'tiles.openfreemap.org' && url.pathname.endsWith('.pbf'))
  || (url.hostname === 'opentopomap.org' && url.pathname.startsWith('/img/legende/'));
const isApp = (url) => url.origin === self.location.origin || url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net';

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.hostname === 'tiles.openfreemap.org' && !url.pathname.endsWith('.pbf')) {
    // TileJSON der Sperrgebiete: Netz zuerst (Version ändert sich), offline aus dem Cache
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(TILE_CACHE).then((c) => c.put(e.request.url, copy)); }
      return res;
    }).catch(() => caches.match(e.request.url, { ignoreVary: true })));

  } else if (isTile(url)) {
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(e.request.url, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request.url, res.clone());
      return res;
    }));

  } else if (isApp(url)) {
    // Stale-while-revalidate: sofort antworten (wichtig bei schlechtem Empfang), danach aktualisieren
    e.respondWith(caches.open(APP_CACHE).then(async (c) => {
      const key = e.request.mode === 'navigate' ? './index.html' : e.request;
      const hit = await c.match(key, { ignoreSearch: e.request.mode === 'navigate' });
      const net = fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request.mode === 'navigate' ? './index.html' : e.request, res.clone());
        return res;
      }).catch(() => hit);
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }));
  }
});
