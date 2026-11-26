'use strict';
/* =========================================================
   Fotos mit GPS-Koordinaten auf der Karte
   - GPS + Aufnahmedatum aus den EXIF-Daten (Bibliothek exifr)
   - Fotos ohne GPS: aktuelle Position oder Tipp auf die Karte
   - Speicherung lokal im Gerät (IndexedDB), verkleinert
   ========================================================= */
(function () {
  const el = (id) => document.getElementById(id);
  const FULL_PX = 1600, THUMB_PX = 120;

  /* ---------- IndexedDB ---------- */
  const dbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open('outdoorNavi.photos', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function tx(mode, fn) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const t = db.transaction('photos', mode);
      const r = fn(t.objectStore('photos'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }
  const dbAll = () => tx('readonly', (s) => s.getAll());
  const dbPut = (p) => tx('readwrite', (s) => s.put(p));
  const dbDel = (id) => tx('readwrite', (s) => s.delete(id));

  /* ---------- Kartenebene ---------- */
  map.createPane('photos').style.zIndex = 620;
  const photoLayer = L.layerGroup().addTo(map);
  if (window.layerControl) layerControl.addOverlay(photoLayer, '📷 Fotos');
  const urls = new Map();   // id -> objectURLs, damit sie wieder freigegeben werden

  function addMarker(p) {
    const thumb = URL.createObjectURL(p.thumb);
    urls.set(p.id, [thumb]);
    const m = L.marker([p.lat, p.lng], {
      pane: 'photos', draggable: false,
      icon: L.divIcon({ className: '', html: `<div class="photo-marker"><img src="${thumb}" alt=""></div>`, iconSize: [46, 46], iconAnchor: [23, 23] })
    });
    m.photoId = p.id;
    m.bindPopup(() => popupContent(p, m), { maxWidth: 320, minWidth: 220, className: 'photo-popup', autoPanPaddingTopLeft: [10, 150], autoPanPaddingBottomRight: [10, 100] });
    m.on('popupclose', () => {
      const list = urls.get(p.id);
      if (list && list.length > 1) { URL.revokeObjectURL(list.pop()); }
    });
    photoLayer.addLayer(m);
    return m;
  }

  function popupContent(p, marker) {
    const full = URL.createObjectURL(p.image);
    urls.get(p.id).push(full);
    const box = document.createElement('div');
    const when = p.taken ? new Date(p.taken).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    box.innerHTML = `
      <a href="${full}" target="_blank" rel="noopener"><img class="photo-big" src="${full}" alt=""></a>
      <div class="photo-meta">${when ? '📅 ' + when + '<br>' : ''}📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
        ${p.source === 'exif' ? '' : '<br><small>(Position manuell/aktuell gesetzt)</small>'}</div>
      <div class="photo-actions">
        <button data-a="nav">🎯 Hinführen</button>
        <button data-a="move">✥ Verschieben</button>
        <button data-a="del" class="danger">🗑</button>
      </div>`;
    box.querySelector('[data-a=nav]').onclick = () => { map.closePopup(); setTarget(L.latLng(p.lat, p.lng)); };
    box.querySelector('[data-a=move]').onclick = () => {
      map.closePopup();
      marker.dragging.enable();
      toast('Foto an die neue Stelle ziehen');
      marker.once('dragend', async () => {
        marker.dragging.disable();
        const ll = marker.getLatLng();
        p.lat = ll.lat; p.lng = ll.lng; p.source = 'manual';
        await dbPut(p);
      });
    };
    box.querySelector('[data-a=del]').onclick = async () => {
      if (!confirm('Foto aus der App löschen? (Das Original auf deinem Gerät bleibt erhalten.)')) return;
      await dbDel(p.id);
      photoLayer.removeLayer(marker);
      (urls.get(p.id) || []).forEach((u) => URL.revokeObjectURL(u));
      urls.delete(p.id);
    };
    return box;
  }

  /* ---------- Bild verkleinern ---------- */
  async function resize(file, maxPx, quality) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close && bmp.close();
    return new Promise((r) => cv.toBlob(r, 'image/jpeg', quality));
  }

  /* ---------- Fotos hinzufügen ---------- */
  let placing = [];   // Fotos ohne GPS, die auf die Karte getippt werden sollen
  window.photoPlacing = false;

  async function importFiles(files, fromCamera) {
    let added = 0, noGps = 0, failed = 0, last = null;
    for (const file of files) {
      try {
        let lat = null, lng = null, taken = null;
        try {
          const g = await exifr.gps(file);
          if (g && isFinite(g.latitude) && isFinite(g.longitude) && !(g.latitude === 0 && g.longitude === 0)) { lat = g.latitude; lng = g.longitude; }
        } catch (e) { /* keine GPS-Daten */ }
        try {
          const ex = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
          const d = ex && (ex.DateTimeOriginal || ex.CreateDate);
          if (d instanceof Date && !isNaN(d)) taken = d.getTime();
        } catch (e) { /* kein Datum */ }

        const p = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: file.name, taken: taken || (fromCamera ? Date.now() : file.lastModified || null),
          image: await resize(file, FULL_PX, 0.85),
          thumb: await resize(file, THUMB_PX, 0.8),
          lat, lng, source: 'exif'
        };
        if (lat == null && fromCamera && lastFix) { p.lat = lastFix.p[0]; p.lng = lastFix.p[1]; p.source = 'gps'; }
        if (p.lat == null) { placing.push(p); noGps++; continue; }
        await dbPut(p); addMarker(p); added++; last = p;
      } catch (e) {
        console.error(e); failed++;
      }
    }
    if (last) map.setView([last.lat, last.lng], Math.max(map.getZoom(), 14));
    if (last) follow = false;
    let msg = added ? `${added} Foto${added > 1 ? 's' : ''} auf der Karte` : '';
    if (failed) msg += (msg ? ' · ' : '') + `${failed} nicht lesbar (Format?)`;
    if (msg) toast(msg);
    if (noGps) askPlacement();
  }

  function askPlacement() {
    if (!placing.length) { window.photoPlacing = false; el('photoPlace').hidden = true; return; }
    window.photoPlacing = true;
    el('photoPlaceText').textContent = `${placing.length} Foto${placing.length > 1 ? 's' : ''} ohne GPS-Daten: Tippe auf die Karte, um „${placing[0].name}“ zu platzieren.`;
    el('photoPlaceHere').disabled = !lastFix;
    el('photoPlace').hidden = false;
  }
  async function placeNext(lat, lng, source) {
    const p = placing.shift();
    if (!p) return;
    p.lat = lat; p.lng = lng; p.source = source;
    await dbPut(p); addMarker(p);
    askPlacement();
  }
  map.on('click', (e) => { if (window.photoPlacing) placeNext(e.latlng.lat, e.latlng.lng, 'manual'); });
  el('photoPlaceHere').onclick = () => { if (lastFix) placeNext(lastFix.p[0], lastFix.p[1], 'gps'); };
  el('photoPlaceSkip').onclick = () => { placing.shift(); askPlacement(); };

  el('photoInput').onchange = (e) => { el('menu').hidden = true; importFiles([...e.target.files], false); e.target.value = ''; };
  el('cameraInput').onchange = (e) => { el('menu').hidden = true; importFiles([...e.target.files], true); e.target.value = ''; };

  /* ---------- Start: gespeicherte Fotos laden ---------- */
  dbAll().then((list) => list.forEach(addMarker)).catch((e) => console.error('Fotos laden', e));
})();
