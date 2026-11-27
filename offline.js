'use strict';
/* =========================================================
   Offline-Karten
   Lädt die Kartenkacheln eines Gebiets (sichtbarer Ausschnitt oder
   Korridor entlang der geplanten Route) in den Gerätespeicher:
   OpenTopoMap, Schutzgebiete (BfN), militärische Sperrgebiete,
   Legendenbilder. Der Service Worker liefert sie dann ohne Netz aus.
   ========================================================= */
(function () {
  const TILE_CACHE = 'outdoor-tiles-v2';     // muss zu sw.js passen
  const META_KEY = 'outdoorNavi.offline.v1';
  const MIN_ZOOM = 6;
  const MAX_TILES = 20000;                   // Schutz vor versehentlich riesigen Downloads
  const PARALLEL = 6;
  const EST_BYTES = { otm: 32000, bfn: 6000, mil: 12000 };
  const el = (id) => document.getElementById(id);

  let areas = [];                            // gespeicherte Gebiete (Metadaten)
  let running = null;                        // { cancel: bool }
  const areaLayer = L.layerGroup();

  function loadMeta() { try { areas = JSON.parse(localStorage.getItem(META_KEY)) || []; } catch (e) { areas = []; } }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(areas)); } catch (e) {} }

  /* ---------- Kachel-URLs exakt wie Leaflet sie erzeugt ---------- */
  // Funktioniert auch für Ebenen, die gerade nicht angezeigt werden (z. B. Topokarte bei aktivem
  // Satellitenbild): der Kachelbereich (_globalTileRange) wird dafür passend zur Zoomstufe gesetzt.
  function leafletUrl(layer, x, y, z) {
    const m = layer._map, tz = layer._tileZoom, gr = layer._globalTileRange;
    layer._map = map; layer._tileZoom = z;
    layer._globalTileRange = layer._pxBoundsToTileRange(map.getPixelWorldBounds(z));
    const c = L.point(x, y); c.z = z;
    try {
      return layer.getTileUrl(c);
    } finally {
      layer._map = m; layer._tileZoom = tz; layer._globalTileRange = gr;
    }
  }

  /* ---------- Welche Kacheln gehören zum Gebiet? ---------- */
  function tilesForArea(area, tileSize, z) {
    const set = new Set();
    const maxIdx = Math.pow(2, z) * 256 / tileSize - 1;
    const clamp = (v) => Math.max(0, Math.min(maxIdx, v));
    if (area.type === 'bounds') {
      const nw = map.project(L.latLng(area.n, area.w), z), se = map.project(L.latLng(area.s, area.e), z);
      for (let x = clamp(Math.floor(nw.x / tileSize)); x <= clamp(Math.floor(se.x / tileSize)); x++)
        for (let y = clamp(Math.floor(nw.y / tileSize)); y <= clamp(Math.floor(se.y / tileSize)); y++) set.add(x + '/' + y);
    } else {
      // Korridor: Routenpunkte dicht abtasten, Puffer in Kacheln drumherum
      const lat = area.coords[0][0];
      const mPerPx = 156543.034 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
      const b = Math.max(1, Math.ceil(area.buffer / (mPerPx * tileSize)));
      let prev = null;
      area.coords.forEach((c) => {
        const p = map.project(L.latLng(c[0], c[1]), z);
        const pts = [p];
        if (prev) {
          const n = Math.ceil(prev.distanceTo(p) / (tileSize / 2));
          for (let i = 1; i < n; i++) pts.push(prev.add(p.subtract(prev).multiplyBy(i / n)));
        }
        pts.forEach((q) => {
          const tx = Math.floor(q.x / tileSize), ty = Math.floor(q.y / tileSize);
          for (let dx = -b; dx <= b; dx++) for (let dy = -b; dy <= b; dy++) set.add(clamp(tx + dx) + '/' + clamp(ty + dy));
        });
        prev = p;
      });
    }
    return set;
  }

  function buildJobs(area, maxZoom, withSchutz, withMil) {
    const jobs = [];
    for (let z = MIN_ZOOM; z <= maxZoom; z++) {
      tilesForArea(area, 256, z).forEach((k) => {
        const [x, y] = k.split('/').map(Number);
        jobs.push({ url: leafletUrl(otmLayer, x, y, z), kind: 'otm' });
        if (withMil && window.militaryTiles && z >= militaryTiles.minZoom && z <= militaryTiles.maxZoom) {
          jobs.push({ url: L.Util.template(militaryTiles.url, { x, y, z }), kind: 'mil' });
        }
      });
      if (withSchutz) {
        tilesForArea(area, 512, z).forEach((k) => {
          const [x, y] = k.split('/').map(Number);
          schutzLayers.forEach((lyr) => jobs.push({ url: leafletUrl(lyr, x, y, z), kind: 'bfn', noRef: true }));
        });
      }
    }
    // Legendenbilder + TileJSON der Sperrgebiete
    document.querySelectorAll('#legendBody img').forEach((img) => jobs.push({ url: img.src, kind: 'mil' }));
    if (withMil && window.militaryTiles) jobs.push({ url: militaryTiles.tilejson, kind: 'mil' });
    return jobs;
  }

  /* ---------- Gebiet aus der Auswahl ---------- */
  function currentArea() {
    if (el('offMode').value === 'route') {
      const coords = window.getPlannedRoute ? getPlannedRoute() : [];
      if (coords.length < 2) return null;
      const step = Math.max(1, Math.floor(coords.length / 1500));
      return { type: 'route', coords: coords.filter((c, i) => i % step === 0 || i === coords.length - 1).map((c) => [c[0], c[1]]), buffer: +el('offBuffer').value };
    }
    const b = map.getBounds();
    return { type: 'bounds', n: b.getNorth(), s: b.getSouth(), w: b.getWest(), e: b.getEast() };
  }
  function areaBounds(a) {
    return a.type === 'bounds' ? L.latLngBounds([a.s, a.w], [a.n, a.e]) : L.latLngBounds(a.coords).pad(0.05);
  }

  function estimate() {
    if (running) return;
    const a = currentArea();
    el('offBuffer').closest('label').hidden = el('offMode').value !== 'route';
    if (!a) { el('offEstimate').textContent = 'Erst im Routenplaner eine Route berechnen.'; el('offStart').disabled = true; return; }
    let jobs;
    try { jobs = buildJobs(a, +el('offZoom').value, el('offSchutz').checked, el('offMil').checked); }
    catch (e) { el('offEstimate').innerHTML = `<span class="warn">Berechnung fehlgeschlagen: ${e.message}</span>`; return; }
    const bytes = jobs.reduce((s, j) => s + EST_BYTES[j.kind], 0);
    const tooMany = jobs.length > MAX_TILES;
    el('offEstimate').innerHTML = `≈ <b>${jobs.length.toLocaleString('de-DE')}</b> Kacheln, ca. <b>${(bytes / 1e6).toFixed(0)} MB</b>`
      + (tooMany ? `<br><span class="warn">Zu groß (max. ${MAX_TILES.toLocaleString('de-DE')}). Bitte kleineren Ausschnitt oder geringere Detailstufe wählen.</span>` : '');
    el('offStart').disabled = tooMany;
  }

  /* ---------- Download ---------- */
  // Meldung direkt im Offline-Fenster (Hinweise unten wären vom Fenster verdeckt)
  function status(msg, warn) {
    const p = el('offProgress');
    p.hidden = false; p.textContent = msg;
    p.classList.toggle('warn', !!warn);
  }

  async function download() {
    if (running) return;
    try {
      await doDownload();
    } catch (e) {
      console.error('Offline-Download', e);
      running = null; setBusy(false);
      status('Download konnte nicht starten: ' + (e && e.message ? e.message : e), true);
    }
  }

  async function doDownload() {
    const area = currentArea();
    if (!area) { status('Erst im Routenplaner eine Route berechnen.', true); return; }
    const maxZoom = +el('offZoom').value;
    const jobs = buildJobs(area, maxZoom, el('offSchutz').checked, el('offMil').checked);
    if (jobs.length > MAX_TILES) { status('Gebiet zu groß – bitte kleineren Ausschnitt wählen.', true); return; }
    if (!('caches' in window)) { status('Dieser Browser kann keine Offline-Karten speichern. Bitte Chrome verwenden.', true); return; }
    if (!navigator.onLine) status('Hinweis: Das Handy meldet „offline“ – Versuch trotzdem…', true);
    // Dauerhaften Speicher anfragen, aber nicht darauf warten (kann je nach Browser hängen)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}

    const cache = await caches.open(TILE_CACHE);
    running = { cancel: false };
    let done = 0, failed = 0, bytes = 0, i = 0;
    setBusy(true);
    const update = () => {
      el('offBar').value = done / jobs.length;
      status(`${done.toLocaleString('de-DE')} / ${jobs.length.toLocaleString('de-DE')} Kacheln` + (failed ? ` · ${failed} Fehler` : ''), false);
    };
    async function worker() {
      while (i < jobs.length && !running.cancel) {
        const job = jobs[i++];
        try {
          const hit = await cache.match(job.url);
          if (!hit) {
            const res = await fetch(job.url, { mode: 'cors', referrerPolicy: job.noRef ? 'no-referrer' : 'strict-origin-when-cross-origin' });
            if (!res.ok) throw new Error(res.status);
            const blob = await res.clone().blob();
            bytes += blob.size;
            await cache.put(job.url, res);
          }
        } catch (e) {
          failed++;
          if (e && e.name === 'QuotaExceededError') { running.cancel = true; toast('Gerätespeicher voll – Download gestoppt.'); }
        }
        done++;
        if (done % 10 === 0 || done === jobs.length) update();
      }
    }
    update();
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    const cancelled = running.cancel;
    running = null;
    setBusy(false);

    if (done > 0) {
      const name = area.type === 'route' ? 'Route ' + new Date().toLocaleDateString('de-DE') : 'Ausschnitt ' + new Date().toLocaleDateString('de-DE');
      const b = areaBounds(area);
      areas.push({ id: Date.now(), name, maxZoom, tiles: done - failed, partial: cancelled,
        bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]], date: Date.now() });
      saveMeta();
    }
    const msg = cancelled ? 'Download abgebrochen – Teil gespeichert.'
      : failed === jobs.length ? 'Download fehlgeschlagen – keine Kachel geladen. Internetverbindung prüfen.'
      : `✔ Offline-Karte gespeichert (${(bytes / 1e6).toFixed(1)} MB neu)` + (failed ? `, ${failed} Kacheln fehlgeschlagen` : '');
    status(msg, cancelled || failed > 0);
    toast(msg);
    renderList(); renderUsage(); estimate();
  }

  function setBusy(b) {
    el('offStart').hidden = b; el('offCancel').hidden = !b;
    el('offBar').hidden = !b;
    if (b) el('offProgress').hidden = false;   // nach dem Download bleibt die Ergebnis-Meldung stehen
    ['offMode', 'offZoom', 'offSchutz', 'offMil', 'offBuffer'].forEach((id) => { el(id).disabled = b; });
  }

  /* ---------- Liste, Speicherplatz, Löschen ---------- */
  function renderList() {
    areaLayer.clearLayers();
    const ul = el('offList');
    ul.innerHTML = areas.length ? '' : '<li class="hint">Noch keine Offline-Karten gespeichert.</li>';
    areas.forEach((a) => {
      L.rectangle(a.bounds, { color: '#2f5d3a', weight: 2, dashArray: '6 6', fill: true, fillOpacity: 0.05, interactive: false }).addTo(areaLayer);
      const li = document.createElement('li');
      li.innerHTML = `<span><b>${a.name}</b><br><small>${a.tiles.toLocaleString('de-DE')} Kacheln · bis Zoom ${a.maxZoom}${a.partial ? ' · unvollständig' : ''}</small></span>`;
      const show = document.createElement('button'); show.textContent = 'Zeigen'; show.className = 'small-btn';
      show.onclick = () => { follow = false; map.fitBounds(a.bounds); };
      li.appendChild(show);
      ul.appendChild(li);
    });
  }
  async function renderUsage() {
    try {
      const est = await navigator.storage.estimate();
      el('offUsage').textContent = `Belegt: ${(est.usage / 1e6).toFixed(0)} MB von ca. ${(est.quota / 1e9).toFixed(1)} GB verfügbarem Speicher`;
    } catch (e) { el('offUsage').textContent = ''; }
  }
  el('offClear').onclick = async () => {
    if (!confirm('Alle gespeicherten Offline-Karten löschen? Ohne Internet werden die Karten dann nicht mehr angezeigt.')) return;
    await caches.delete(TILE_CACHE);
    areas = []; saveMeta(); renderList(); renderUsage();
    toast('Offline-Karten gelöscht');
  };

  /* ---------- Panel ---------- */
  function setOpen(v) {
    el('offline').hidden = !v;
    if (v) {
      el('menu').hidden = true;
      if (!el('planner').hidden) el('plClose').click();
      areaLayer.addTo(map); renderList(); renderUsage(); estimate();
    } else {
      map.removeLayer(areaLayer);
    }
  }
  el('btnOffline').onclick = () => setOpen(true);
  el('offClose').onclick = () => setOpen(false);
  el('offStart').onclick = download;
  el('offCancel').onclick = () => { if (running) running.cancel = true; };
  ['offMode', 'offZoom', 'offSchutz', 'offMil', 'offBuffer'].forEach((id) => el(id).addEventListener('change', estimate));
  map.on('moveend', () => { if (!el('offline').hidden) estimate(); });

  /* ---------- Online/Offline-Anzeige ---------- */
  // Offline: Karte nicht tiefer als die gespeicherte Detailstufe laden, sondern hochskalieren
  function applyNetState() {
    const off = !navigator.onLine;
    el('netState').hidden = !off;
    const maxStored = areas.reduce((m, a) => Math.max(m, a.maxZoom), 0);
    [otmLayer].concat(window.schutzLayers || []).forEach((lyr) => {
      if (!('_onlineNative' in lyr)) lyr._onlineNative = lyr.options.maxNativeZoom;   // Online-Standard merken
      const native = off && maxStored ? Math.min(maxStored, lyr._onlineNative || 99) : lyr._onlineNative;
      if (lyr.options.maxNativeZoom !== native) { lyr.options.maxNativeZoom = native; if (lyr._map) lyr.redraw(); }
    });
  }
  window.addEventListener('online', () => { applyNetState(); toast('Wieder online'); });
  window.addEventListener('offline', () => { applyNetState(); toast('📴 Offline – gespeicherte Karten werden genutzt'); });

  loadMeta();
  applyNetState();
})();
