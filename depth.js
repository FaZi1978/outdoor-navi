'use strict';
/* =========================================================
   Gewässertiefen (Meere)
   Daten: EMODnet Bathymetry (EU, amtlich, ca. 115-m-Raster) –
   alle europäischen Meere inkl. Nord- und Ostsee.
   Eigene Farbgebung per SLD: nur Wasser wird eingefärbt (nach
   Tiefe abgestuft), Land bleibt durchsichtig. Dazu Tiefenlinien.
   Antippen des Wassers zeigt die Tiefe an dieser Stelle.
   Binnenseen sind nicht enthalten (keine freie, bundesweite Quelle).
   ========================================================= */
(function () {
  const WMS = 'https://ows.emodnet-bathymetry.eu/wms';
  const KEY = 'outdoorNavi.depth';

  // Farbstufen [Tiefe in m (negativ), Farbe] – fein gestuft im flachen Bereich (Nord-/Ostsee)
  const RAMP = [
    [-5000, '#031a3d'], [-500, '#06285a'], [-100, '#0b3d75'], [-50, '#145a96'], [-30, '#2378b5'],
    [-20, '#3a9bd0'], [-10, '#6fc3e3'], [-5, '#a6dcef'], [-2, '#d4f1f9']
  ];
  window.depthRamp = RAMP;
  const sld = '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">'
    + '<NamedLayer><Name>emodnet:mean</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer><ColorMap type="ramp">'
    + RAMP.map(([q, c]) => `<ColorMapEntry color="${c}" quantity="${q}" opacity="1"/>`).join('')
    + '<ColorMapEntry color="#ffffff" quantity="0" opacity="0"/><ColorMapEntry color="#ffffff" quantity="9000" opacity="0"/>'
    + '</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>';

  map.createPane('depth').style.zIndex = 250;   // über der Grundkarte, unter Schutzgebieten
  const attribution = 'Wassertiefen: © <a href="https://emodnet.ec.europa.eu/en/bathymetry">EMODnet Bathymetry</a>';
  const fill = L.tileLayer.wms(WMS, {
    layers: 'emodnet:mean', styles: '', sld_body: sld, format: 'image/png', transparent: true,
    version: '1.3.0', tileSize: 512, opacity: 0.7, maxZoom: 19, pane: 'depth', crossOrigin: true, attribution
  });
  const contours = L.tileLayer.wms(WMS, {
    layers: 'emodnet:contours', styles: '', format: 'image/png', transparent: true,
    version: '1.3.0', tileSize: 512, maxZoom: 19, pane: 'depth', crossOrigin: true
  });
  const depthLayer = L.layerGroup([fill, contours]);
  layerControl.addOverlay(depthLayer, '🌊 Gewässertiefen (Meere)');

  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (on) depthLayer.addTo(map);
  map.on('overlayadd overlayremove', (e) => {
    if (e.layer !== depthLayer) return;
    on = e.type === 'overlayadd';
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (err) {}
    if (on) toast('Wassertiefen eingeblendet – Wasser antippen zeigt die Tiefe');
  });

  /* ---------- Tiefe an einer Stelle abfragen ---------- */
  let req = null;
  map.on('click', async (e) => {
    if (!map.hasLayer(depthLayer) || window.photoPlacing) return;
    if (!document.getElementById('planner').hidden) return;   // Routenplaner nutzt Klicks selbst
    if (!navigator.onLine) { toast('Tiefenabfrage braucht Internet'); return; }
    const p = L.CRS.EPSG3857.project(e.latlng), r = 20;   // kleiner Ausschnitt um den Punkt
    const url = `${WMS}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=emodnet:mean&query_layers=emodnet:mean`
      + `&styles=&crs=EPSG:3857&bbox=${p.x - r},${p.y - r},${p.x + r},${p.y + r}&width=3&height=3&i=1&j=1&info_format=application/json`;
    const popup = L.popup({ autoPanPaddingTopLeft: [10, 150], autoPanPaddingBottomRight: [10, 100] })
      .setLatLng(e.latlng).setContent('🌊 Tiefe wird abgefragt…').openOn(map);
    if (req) req.abort();
    req = new AbortController();
    try {
      const j = await (await fetch(url, { signal: req.signal })).json();
      const f = j.features && j.features[0];
      const d = f && f.properties && f.properties.Depth;
      if (d != null && isFinite(d) && d < 0) {
        popup.setContent(`<b>🌊 Wassertiefe: ${(-d).toLocaleString('de-DE', { maximumFractionDigits: 1 })} m</b>`
          + '<br><small>Mittlere Tiefe im ca. 115-m-Raster (EMODnet).<br>Nicht für die Navigation von Booten geeignet.</small>');
      } else {
        popup.setContent('Hier keine Tiefendaten.<br><small>Enthalten sind nur Meere – Binnenseen und Flüsse nicht.</small>');
      }
    } catch (err) {
      if (err.name !== 'AbortError') popup.setContent('Tiefe konnte nicht abgefragt werden.');
    }
  });
})();
