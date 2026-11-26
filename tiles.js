'use strict';
/* =========================================================
   Kacheln am rechten Rand (Ebenen, Satellit, Kamera, Wetter, Legende)
   sind versteckt und werden durch Wischen vom rechten Rand nach links
   eingeblendet. Ausblenden: nach rechts wischen, auf die Karte tippen
   oder automatisch nach 10 Sekunden ohne Bedienung.
   ========================================================= */
(function () {
  const bar = document.querySelector('.leaflet-top.leaflet-right');
  bar.classList.add('side-tiles');
  const edge = document.createElement('div');
  edge.id = 'tileEdge';
  edge.title = 'Nach links wischen: Kacheln einblenden';
  edge.innerHTML = '<span></span>';
  document.body.appendChild(edge);

  const AUTO_HIDE_MS = 10000;
  let open = false, hideTimer = null;

  function show() {
    open = true;
    bar.classList.add('open');
    edge.classList.add('hidden');
    armHide();
  }
  function hide() {
    open = false;
    clearTimeout(hideTimer);
    bar.classList.remove('open');
    edge.classList.remove('hidden');
    // aufgeklappte Ebenen-Auswahl wieder zuklappen
    const lc = bar.querySelector('.leaflet-control-layers-expanded');
    if (lc) lc.classList.remove('leaflet-control-layers-expanded');
  }
  function armHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // Nicht schließen, solange die Ebenen-Auswahl offen ist
      if (bar.querySelector('.leaflet-control-layers-expanded')) { armHide(); return; }
      hide();
    }, AUTO_HIDE_MS);
  }

  // Wischgeste erkennen (Touch und Maus)
  function swipe(target, dirSign, action) {
    let x0 = null, y0 = 0;
    target.addEventListener('pointerdown', (e) => {
      x0 = e.clientX; y0 = e.clientY;
      // Finger auch außerhalb des schmalen Randstreifens weiter verfolgen
      if (target === edge) try { target.setPointerCapture(e.pointerId); } catch (err) {}
    });
    target.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (dx * dirSign > 30 && Math.abs(dx) > Math.abs(dy)) { x0 = null; action(); }
    });
    ['pointerup', 'pointercancel'].forEach((t) => target.addEventListener(t, () => { x0 = null; }));
  }
  // Am Rand nach links wischen → einblenden (Antippen des Griffs geht auch)
  swipe(edge, -1, show);
  edge.addEventListener('click', show);
  edge.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });   // Karte nicht verschieben
  // Auf den Kacheln nach rechts wischen → ausblenden
  swipe(bar, 1, hide);
  // Bedienung der Kacheln hält sie offen
  ['pointerdown', 'click'].forEach((t) => bar.addEventListener(t, () => { if (open) armHide(); }));
  // Tippen auf die Karte blendet aus
  map.on('click', () => { if (open) hide(); });

  window.sideTiles = { show, hide };
})();
