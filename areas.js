'use strict';
/* =========================================================
   Antippen von Schutzgebieten und Sperrgebieten → Info-Fenster
   - Schutzgebiete: amtliche Sachdaten des Bundesamts für Naturschutz
     (WMS GetFeatureInfo): Art, Name, Fläche, Jahr, Verordnung,
     bei Biosphärenreservaten auch die Zone (Kern/Pflege/Entwicklung).
   - Militärische Sperrgebiete: Treffer wird direkt an der gezeichneten
     Fläche erkannt; die genaue Art (Truppenübungsplatz, Kaserne …)
     wird aus OpenStreetMap (Overpass) nachgeladen, wenn erreichbar.
   ========================================================= */
(function () {
  const BFN = 'https://geodienste.bfn.de/ogc/wms/schutzgebiet';
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // BfN-Ebene → Darstellung; Reihenfolge der Anzeige: NSG, Biosphäre, LSG
  const KIND = {
    Naturschutzgebiete: { title: 'Naturschutzgebiet (NSG)', color: '#db1414', order: 1,
      rule: 'Strengster Flächenschutz: Wege nicht verlassen, Hunde an die Leine, nichts pflücken oder entnehmen, kein Feuer, kein Zelten. Genaue Regeln stehen in der Verordnung.' },
    Biosphaerenreservate: { title: 'Biosphärenreservat', color: '#8f33c7', order: 2,
      rule: 'UNESCO-Modellregion für Mensch und Natur. Regeln hängen von der Zone ab.' },
    Landschaftsschutzgebiete: { title: 'Landschaftsschutzgebiet (LSG)', color: '#1a9e33', order: 3,
      rule: 'Schützt Landschaftsbild und Erholungswert. Betreten ist meist erlaubt; Veränderungen der Landschaft sind verboten.' }
  };
  const ZONE = {
    Kernzone: 'Kernzone – Natur bleibt sich selbst überlassen, Betreten oft nur auf Wegen oder gar nicht erlaubt',
    Pflegezone: 'Pflegezone – schützt Kulturlandschaft, Wege nicht verlassen',
    Entwicklungszone: 'Entwicklungszone – Lebens- und Wirtschaftsraum, kaum Einschränkungen'
  };
  const MIL = {
    training_area: 'Truppenübungsplatz', barracks: 'Kaserne', danger_area: 'Gefahrenbereich (z. B. Schießgebiet)',
    range: 'Schießplatz', airfield: 'Militärflugplatz', ammunition: 'Munitionsdepot', naval_base: 'Marinestützpunkt',
    base: 'Militärstützpunkt', bunker: 'Bunker', checkpoint: 'Kontrollpunkt', office: 'Militärische Dienststelle',
    obstacle_course: 'Hindernisbahn', trench: 'Schützengraben', depot: 'Depot'
  };

  /* ---------- Schutzgebiete: Sachdaten vom BfN ---------- */
  async function bfnInfo(latlng) {
    const visible = (window.schutzLayers || []).filter((l) => map.hasLayer(l)).map((l) => l.wmsParams.layers);
    if (!visible.length) return [];
    const layers = visible.includes('Biosphaerenreservate') ? [...visible, 'Biosphaerenreservate_Zonierung'] : visible;
    const d = 0.0004 * Math.pow(2, Math.max(0, 14 - map.getZoom()));   // Suchfenster passend zur Zoomstufe
    const bbox = [latlng.lat - d, latlng.lng - d, latlng.lat + d, latlng.lng + d].join(',');
    const url = `${BFN}?service=WMS&version=1.3.0&request=GetFeatureInfo&styles=&crs=EPSG:4326&width=101&height=101&i=50&j=50`
      + `&layers=${layers.join(',')}&query_layers=${layers.join(',')}&bbox=${bbox}&info_format=application/geo%2Bjson&feature_count=10`;
    const res = await fetch(url, { referrerPolicy: 'no-referrer' });
    const j = await res.json();
    return j.features || [];
  }

  function bfnHtml(features) {
    const zones = {};
    features.filter((f) => f.layerName === 'Biosphaerenreservate_Zonierung')
      .forEach((f) => { zones[f.properties.BFN_ID] = f.properties.ZONIERUNG; });
    return features.filter((f) => KIND[f.layerName])
      .sort((a, b) => KIND[a.layerName].order - KIND[b.layerName].order)
      .map((f) => {
        const k = KIND[f.layerName], p = f.properties;
        const ha = parseFloat(p.FLAECHE);
        const link = p.LEG_LINK && /^https?:/.test(p.LEG_LINK.trim()) ? p.LEG_LINK.trim() : null;
        const zone = zones[p.BFN_ID];
        const facts = [
          isFinite(ha) ? `${ha.toLocaleString('de-DE', { maximumFractionDigits: 0 })} ha` : null,
          p.JAHR && p.JAHR !== 'Null' ? `seit ${esc(p.JAHR)}` : null,
          p.BL ? esc(p.BL) : null,
          p.IUCN_KAT && p.IUCN_KAT.trim() ? `IUCN ${esc(p.IUCN_KAT)}` : null
        ].filter(Boolean).join(' · ');
        return `<div class="ai-item">
          <div class="ai-kind"><span class="ai-dot" style="background:${k.color}"></span>${k.title}</div>
          <b>${esc(p.NAME)}</b>
          ${zone ? `<div class="ai-zone">${esc(ZONE[zone] || zone)}</div>` : ''}
          ${facts ? `<small>${facts}</small>` : ''}
          <p>${k.rule}</p>
          ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Verordnung / Details ↗</a>` : ''}
        </div>`;
      }).join('');
  }

  /* ---------- Sperrgebiete: Treffer an der gezeichneten Fläche ---------- */
  function militaryHit(latlng) {
    const lyr = window.militaryLayer;
    if (!lyr || !window.militaryGroup || !map.hasLayer(window.militaryGroup) || map.getZoom() < 9) return false;
    const z = lyr._tileZoom;
    if (z == null) return false;
    const ts = lyr.getTileSize().x;
    const pt = map.project(latlng, z);
    const tx = Math.floor(pt.x / ts), ty = Math.floor(pt.y / ts);
    const tile = lyr._tiles && lyr._tiles[`${tx}:${ty}:${z}`];
    const cv = tile && tile.el;
    if (!cv || !cv.getContext) return false;
    const sc = cv.width / ts;
    const px = Math.floor((pt.x - tx * ts) * sc), py = Math.floor((pt.y - ty * ts) * sc);
    try {
      const data = cv.getContext('2d').getImageData(Math.max(0, px - 1), Math.max(0, py - 1), 3, 3).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 20) return true;
    } catch (e) {}
    return false;
  }

  // Genaue Art aus OpenStreetMap (Overpass) – Server sind oft ausgelastet, daher kurz und mit Ausweichservern
  async function militaryDetails(latlng) {
    const q = `[out:json][timeout:10];is_in(${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)})->.a;(area.a[landuse=military];area.a[military];);out tags;`;
    for (const ep of OVERPASS) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 7000);
      try {
        const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const j = await res.json();
        return j.elements || [];
      } catch (e) { clearTimeout(timer); }
    }
    return null;   // kein Server erreichbar
  }

  function militaryHtml(latlng, els) {
    const osm = `https://www.openstreetmap.org/query?lat=${latlng.lat.toFixed(5)}&lon=${latlng.lng.toFixed(5)}`;
    let body;
    if (els === undefined) body = '<small class="ai-load">Genaue Art wird geladen…</small>';
    else if (els && els.length) {
      body = els.map((e) => {
        const t = e.tags || {};
        const kind = MIL[t.military] || (t.military ? t.military : 'Militärisches Gelände');
        return `<b>${esc(t.name || kind)}</b>${t.name ? `<small>${esc(kind)}</small>` : ''}`
          + (t.operator ? `<small>Betreiber: ${esc(t.operator)}</small>` : '');
      }).join('');
    } else body = '<small>Genaue Art derzeit nicht abrufbar (OpenStreetMap-Server ausgelastet).</small>';
    return `<div class="ai-item">
      <div class="ai-kind"><span class="ai-dot" style="background:#000"></span>Militärisches Sperrgebiet</div>
      ${body}
      <p>Betreten verboten bzw. nur auf freigegebenen Wegen. Bei Übungsbetrieb Lebensgefahr (Schießen, Blindgänger) – Warnschilder und Absperrungen beachten.</p>
      <a href="${osm}" target="_blank" rel="noopener">In OpenStreetMap ansehen ↗</a>
    </div>`;
  }

  /* ---------- Antippen ---------- */
  let seq = 0;
  map.on('click', async (e) => {
    if (window.plannerOpen || window.photoPlacing) return;               // Tipp gehört Routenplaner / Fotos
    if (window.tilesClosedAt && Date.now() - window.tilesClosedAt < 400) return;   // Tipp hat nur Kacheln geschlossen
    const my = ++seq;
    const mil = militaryHit(e.latlng);
    const anySchutz = (window.schutzLayers || []).some((l) => map.hasLayer(l));
    if (!mil && !anySchutz) return;
    if (!navigator.onLine && !mil) return;

    let schutzHtml = '', milEls;
    const popup = L.popup({ maxWidth: 300, autoPanPaddingTopLeft: [10, 170], autoPanPaddingBottomRight: [10, 100], className: 'area-pop' });
    const draw = () => {
      const html = (mil ? militaryHtml(e.latlng, milEls) : '') + schutzHtml;
      if (!html) return;
      popup.setLatLng(e.latlng).setContent(html);
      if (!map.hasLayer(popup)) popup.openOn(map);
    };
    if (mil) draw();

    const jobs = [];
    if (anySchutz && navigator.onLine) {
      jobs.push(bfnInfo(e.latlng).then((f) => { if (my === seq) { schutzHtml = bfnHtml(f); draw(); } }).catch(() => {}));
    }
    if (mil) {
      if (!navigator.onLine) { milEls = null; draw(); }
      else jobs.push(militaryDetails(e.latlng).then((els) => { if (my === seq) { milEls = els; draw(); } }));
    }
    await Promise.all(jobs);
  });
})();
