'use strict';
/* =========================================================
   Militärische Sperrgebiete (schwarz)
   Daten: OpenStreetMap (landuse=military, z. B. Truppenübungsplätze,
   Kasernen, Munitionsdepots) über die kostenlosen Vektor-Kacheln
   von OpenFreeMap. Sichtbar ab Zoomstufe 9.
   ========================================================= */
(function () {
  const TILEJSON = 'https://tiles.openfreemap.org/planet';   // liefert die aktuelle Kachel-URL
  const STYLE = { fill: true, fillColor: '#000', fillOpacity: 0.28, color: '#000', weight: 2, opacity: 0.9 };

  map.createPane('military').style.zIndex = 305;   // über den Schutzgebieten, unter Track/Route
  map.getPane('military').style.pointerEvents = 'none';

  // Platzhalter, damit die Ebene sofort in der Ebenen-Auswahl steht
  const group = L.layerGroup().addTo(map);
  if (window.layerControl) layerControl.addOverlay(group, '<span class="swatch" style="color:#000"></span>Militärische Sperrgebiete');

  fetch(TILEJSON)
    .then((r) => r.json())
    .then((tj) => {
      // Alle Kachel-Ebenen ausblenden, nur Militärflächen zeichnen
      const styles = {};
      (tj.vector_layers || []).forEach((l) => { styles[l.id] = []; });
      styles.landuse = (p) => (p.class === 'military' ? STYLE : []);
      const layer = L.vectorGrid.protobuf(tj.tiles[0], {
        rendererFactory: L.canvas.tile,
        vectorTileLayerStyles: styles,
        pane: 'military',
        interactive: false,
        minZoom: 9,
        maxNativeZoom: 14,   // darüber werden die Kacheln vergrößert
        maxZoom: 19,
        attribution: 'Sperrgebiete: © <a href="https://openfreemap.org">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      });
      group.addLayer(layer);
      window.militaryTiles = { url: tj.tiles[0], tilejson: TILEJSON, minZoom: 9, maxZoom: 14 };
    })
    .catch(() => toast('Militärische Sperrgebiete konnten nicht geladen werden (offline?)'));
})();
