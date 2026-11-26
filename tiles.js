'use strict';
/* =========================================================
   Versteckte Kacheln, per Wischgeste einblenden
   - rechts (Ebenen, Satellit, Kamera, Wetter, Legende):
     vom rechten Rand nach links wischen
   - oben (Momentan, Durchschnitt, Gesamt, Zeile mit Zeit/Höhe/…):
     vom oberen Rand nach unten wischen
   Ausblenden: in Gegenrichtung wischen, auf die Karte tippen
   oder automatisch nach 10 Sekunden ohne Bedienung.
   Den Griff am Rand antippen blendet ebenfalls ein.
   ========================================================= */
(function () {
  const AUTO_HIDE_MS = 10000;
  const drawers = [];

  // Wischgeste erkennen (Touch und Maus); axis 'x' oder 'y', sign = Richtung (+1 / -1)
  function swipe(target, axis, sign, action, capture) {
    let p0 = null;
    target.addEventListener('pointerdown', (e) => {
      p0 = { x: e.clientX, y: e.clientY };
      // Finger auch außerhalb des schmalen Randstreifens weiter verfolgen
      if (capture) try { target.setPointerCapture(e.pointerId); } catch (err) {}
    });
    target.addEventListener('pointermove', (e) => {
      if (!p0) return;
      const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
      const main = axis === 'x' ? dx : dy, cross = axis === 'x' ? dy : dx;
      if (main * sign > 30 && Math.abs(main) > Math.abs(cross)) { p0 = null; action(); }
    });
    ['pointerup', 'pointercancel'].forEach((t) => target.addEventListener(t, () => { p0 = null; }));
  }

  function drawer({ panel, cls, edgeId, axis, openSign, keepOpen }) {
    panel.classList.add(cls);
    const edge = document.createElement('div');
    edge.id = edgeId; edge.className = 'drawer-edge';
    edge.innerHTML = '<span></span>';
    document.body.appendChild(edge);
    let open = false, timer = null;

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (keepOpen && keepOpen()) arm(); else hide(); }, AUTO_HIDE_MS);
    };
    function show() { open = true; panel.classList.add('open'); edge.classList.add('hidden'); arm(); }
    function hide() {
      open = false; clearTimeout(timer);
      panel.classList.remove('open'); edge.classList.remove('hidden');
    }
    swipe(edge, axis, openSign, show, true);
    edge.addEventListener('click', show);
    edge.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });   // Karte nicht verschieben
    swipe(panel, axis, -openSign, hide, false);
    ['pointerdown', 'click'].forEach((t) => panel.addEventListener(t, () => { if (open) arm(); }));
    const d = { show, hide, isOpen: () => open };
    drawers.push(d);
    return d;
  }

  /* ---------- rechts: Kartenkacheln ---------- */
  const right = document.querySelector('.leaflet-top.leaflet-right');
  const rightDrawer = drawer({
    panel: right, cls: 'side-tiles', edgeId: 'tileEdge', axis: 'x', openSign: -1,
    keepOpen: () => !!right.querySelector('.leaflet-control-layers-expanded')   // Ebenen-Auswahl offen
  });
  const hideRight = rightDrawer.hide;
  rightDrawer.hide = () => {
    hideRight();
    const lc = right.querySelector('.leaflet-control-layers-expanded');
    if (lc) lc.classList.remove('leaflet-control-layers-expanded');
  };

  /* ---------- oben: Statistik-Kacheln ---------- */
  const topDrawer = drawer({
    panel: document.getElementById('stats'), cls: 'top-tiles', edgeId: 'statsEdge', axis: 'y', openSign: 1
  });

  // Tippen auf die Karte blendet alles aus
  map.on('click', () => drawers.forEach((d) => { if (d.isOpen()) d.hide(); }));

  window.sideTiles = rightDrawer;
  window.topTiles = topDrawer;
})();
