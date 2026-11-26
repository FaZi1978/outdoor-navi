'use strict';
/* =========================================================
   Taschenmodus
   Web-Apps bekommen bei ausgeschaltetem Display kein GPS mehr
   (Sperre von Android/iOS). Deshalb: Display bleibt an (Wake Lock),
   zeigt aber nur Schwarz – auf OLED-Displays sind schwarze Pixel aus
   und verbrauchen kaum Strom. Berührungen sind gesperrt;
   Entsperren durch 1,5 s Gedrückthalten.
   Zusätzlich: Warnung, wenn das Display während einer Aufzeichnung
   doch ausgeschaltet war (Lücke im Track).
   ========================================================= */
(function () {
  const el = (id) => document.getElementById(id);
  const box = el('pocket');
  const HOLD_MS = 1500;
  let active = false, tick = null, shift = 0;

  async function enter() {
    active = true;
    el('menu').hidden = true;
    box.hidden = false;
    await requestWakeLock();
    // Vollbild blendet Status- und Navigationsleiste aus (ganz schwarz)
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
    update();
    tick = setInterval(update, 1000);
    if (!state.running) toast('Hinweis: Es läuft keine Aufzeichnung');
  }

  function leave() {
    active = false;
    box.hidden = true;
    clearInterval(tick);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    if (!state.running || state.paused) releaseWakeLock();
  }

  // Werte aus der Hauptanzeige übernehmen; Text wandert langsam (schont das Display)
  function update() {
    el('pkSpeed').textContent = el('speedNow').textContent;
    el('pkDist').textContent = el('distTotal').textContent;
    el('pkTime').textContent = el('time').textContent;
    const fresh = lastFix && Date.now() - lastFix.t < 15000;
    el('pkGps').textContent = !state.running ? 'keine Aufzeichnung' : state.paused ? 'pausiert'
      : fresh ? `GPS ±${Math.round(lastFix.acc)} m` : 'GPS sucht…';
    el('pkGps').className = fresh && state.running && !state.paused ? '' : 'warn';
    if (Date.now() / 60000 > shift + 1) {
      shift = Date.now() / 60000;
      el('pkInfo').style.transform = `translate(${Math.round(Math.random() * 40 - 20)}px, ${Math.round(Math.random() * 80 - 40)}px)`;
    }
  }

  // Entsperren: Knopf gedrückt halten
  const unlock = el('pkUnlock');
  let holdTimer = null;
  const startHold = (e) => {
    e.preventDefault();
    unlock.classList.add('holding');
    holdTimer = setTimeout(() => { unlock.classList.remove('holding'); leave(); }, HOLD_MS);
  };
  const stopHold = () => { clearTimeout(holdTimer); unlock.classList.remove('holding'); };
  unlock.addEventListener('pointerdown', startHold);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => unlock.addEventListener(t, stopHold));
  // Alle anderen Berührungen schlucken (Hosentasche)
  ['click', 'pointerdown', 'touchstart', 'touchmove', 'wheel', 'contextmenu'].forEach((t) =>
    box.addEventListener(t, (e) => { if (!unlock.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } }, { passive: false }));
  // Zurück-Taste von Android beendet sonst ggf. die App – im Taschenmodus ignorieren
  window.addEventListener('popstate', () => { if (active) history.pushState(null, ''); });

  el('btnPocket').onclick = () => { history.pushState(null, ''); enter(); };

  /* ---------- Display trotzdem aus? → Lücke melden ---------- */
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = state.running && !state.paused ? Date.now() : null;
    } else {
      if (active) requestWakeLock();
      if (hiddenAt && Date.now() - hiddenAt > 30000) {
        const min = Math.round((Date.now() - hiddenAt) / 60000);
        toast(`Display war ${min < 1 ? 'kurz' : min + ' Min.'} aus – in dieser Zeit kein GPS, Strecke als Luftlinie ergänzt. Tipp: ☰ → 🌙 Taschenmodus`, 7000);
      }
      hiddenAt = null;
    }
  });

  window.pocketMode = { enter, leave, isActive: () => active };
})();
