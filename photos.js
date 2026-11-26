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
      <div class="photo-wrap" title="Antippen für Vollbild"><img class="photo-big" src="${full}" alt=""><span class="photo-zoom">⛶</span></div>
      <div class="photo-meta">${when ? '📅 ' + when + '<br>' : ''}📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}
        ${p.source === 'exif' ? '' : '<br><small>(Position manuell/aktuell gesetzt)</small>'}</div>
      <div class="photo-actions">
        <button data-a="nav">🎯 Hinführen</button>
        <button data-a="move">✥ Verschieben</button>
        <button data-a="del" class="danger">🗑</button>
      </div>`;
    box.querySelector('.photo-wrap').onclick = () => openViewer(p.id);
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

  /* ---------- Vollbild-Ansicht ----------
     Wischen = nächstes/voriges Foto, zwei Finger / Mausrad = zoomen,
     Doppeltipp = 2,5-fach zoomen, ziehen = verschieben (wenn gezoomt) */
  const viewer = document.createElement('div');
  viewer.id = 'viewer'; viewer.hidden = true;
  viewer.innerHTML = `
    <div class="v-stage"><img alt=""></div>
    <button class="v-btn v-close" title="Schließen (Esc)">✕</button>
    <button class="v-btn v-prev" title="Voriges Foto">‹</button>
    <button class="v-btn v-next" title="Nächstes Foto">›</button>
    <div class="v-bar">
      <span class="v-info"></span>
      <button class="v-map">📍 Auf Karte</button>
      <button class="v-nav">🎯 Hinführen</button>
    </div>`;
  document.body.appendChild(viewer);
  const vImg = viewer.querySelector('img'), vStage = viewer.querySelector('.v-stage');
  let vList = [], vIdx = 0, vUrl = null;
  let sc = 1, panX = 0, panY = 0;
  const pointers = new Map();
  let gesture = null, lastTap = 0;

  function applyTransform(anim) {
    vImg.style.transition = anim ? 'transform .2s' : 'none';
    vImg.style.transform = `translate(${panX}px, ${panY}px) scale(${sc})`;
  }
  function resetZoom(anim) { sc = 1; panX = 0; panY = 0; applyTransform(anim); }
  // Zoomen um einen Punkt (Bildschirmkoordinaten), Verschiebung begrenzen
  function zoomAt(newSc, cx, cy, anim) {
    newSc = Math.min(6, Math.max(1, newSc));
    const r = vStage.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2, oy = cy - r.top - r.height / 2;
    panX = ox - (ox - panX) * (newSc / sc); panY = oy - (oy - panY) * (newSc / sc);
    sc = newSc; clampPan(); applyTransform(anim);
  }
  function clampPan() {
    if (sc <= 1) { panX = 0; panY = 0; return; }
    const r = vStage.getBoundingClientRect();
    const w = vImg.offsetWidth * sc, h = vImg.offsetHeight * sc;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
    panX = Math.max(-mx, Math.min(mx, panX)); panY = Math.max(-my, Math.min(my, panY));
  }

  async function openViewer(id) {
    vList = (await dbAll()).sort((a, b) => (a.taken || 0) - (b.taken || 0));
    vIdx = Math.max(0, vList.findIndex((x) => x.id === id));
    map.closePopup();
    viewer.hidden = false;
    show();
  }
  function show() {
    const p = vList[vIdx];
    if (!p) return closeViewer();
    if (vUrl) URL.revokeObjectURL(vUrl);
    vUrl = URL.createObjectURL(p.image);
    vImg.src = vUrl;
    resetZoom(false);
    const when = p.taken ? new Date(p.taken).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    viewer.querySelector('.v-info').textContent = `${vIdx + 1} / ${vList.length}${when ? ' · ' + when : ''}`;
    viewer.querySelector('.v-prev').hidden = vIdx === 0;
    viewer.querySelector('.v-next').hidden = vIdx === vList.length - 1;
  }
  function step(d) { const n = vIdx + d; if (n >= 0 && n < vList.length) { vIdx = n; show(); } }
  function closeViewer() {
    viewer.hidden = true;
    if (vUrl) { URL.revokeObjectURL(vUrl); vUrl = null; }
    vImg.removeAttribute('src');
  }

  viewer.querySelector('.v-close').onclick = closeViewer;
  viewer.querySelector('.v-prev').onclick = () => step(-1);
  viewer.querySelector('.v-next').onclick = () => step(1);
  viewer.querySelector('.v-map').onclick = () => {
    const p = vList[vIdx]; closeViewer(); follow = false;
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16));
  };
  viewer.querySelector('.v-nav').onclick = () => { const p = vList[vIdx]; closeViewer(); setTarget(L.latLng(p.lat, p.lng)); };
  document.addEventListener('keydown', (e) => {
    if (viewer.hidden) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
  vStage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(sc * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX, e.clientY); }, { passive: false });

  vStage.addEventListener('pointerdown', (e) => {
    try { vStage.setPointerCapture(e.pointerId); } catch (err) { /* nicht kritisch */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), sc };
    } else if (pointers.size === 1) {
      gesture = { type: 'drag', x: e.clientX, y: e.clientY, panX, panY, moved: false, t: Date.now() };
    }
  });
  vStage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomAt(gesture.sc * Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (gesture.type === 'drag') {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) gesture.moved = true;
      if (sc > 1) { panX = gesture.panX + dx; panY = gesture.panY + dy; clampPan(); applyTransform(false); }
      else { vImg.style.transition = 'none'; vImg.style.transform = `translateX(${dx}px)`; }   // Wischen andeuten
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === 'drag' && pointers.size === 0) {
      const dx = e.clientX - gesture.x;
      if (sc <= 1 && gesture.moved) {
        if (dx < -60 && vIdx < vList.length - 1) step(1);
        else if (dx > 60 && vIdx > 0) step(-1);
        else resetZoom(true);
      } else if (!gesture.moved) {
        const now = Date.now();
        if (now - lastTap < 300) { zoomAt(sc > 1 ? 1 : 2.5, e.clientX, e.clientY, true); lastTap = 0; }   // Doppeltipp
        else {
          lastTap = now;
          // Einfacher Tipp neben das Bild schließt die Ansicht
          const r = vImg.getBoundingClientRect();
          const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
          if (sc <= 1 && outside) setTimeout(() => { if (lastTap === now) closeViewer(); }, 300);
        }
      }
    }
    if (pointers.size < 2 && gesture && gesture.type === 'pinch') {
      if (sc < 1.05) resetZoom(true);
      const rest = [...pointers.values()][0];
      gesture = rest ? { type: 'drag', x: rest.x, y: rest.y, panX, panY, moved: true } : null;
    } else if (pointers.size === 0) gesture = null;
  }
  vStage.addEventListener('pointerup', endPointer);
  vStage.addEventListener('pointercancel', endPointer);
  window.addEventListener('resize', () => { if (!viewer.hidden) { clampPan(); applyTransform(false); } });

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
