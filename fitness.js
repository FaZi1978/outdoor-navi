'use strict';
/* =========================================================
   Fitnessdaten & Kalorienverbrauch (Schätzung)
   - Profil (Größe, Gewicht, Geschlecht, optional Alter, Aktivität)
     wird nur lokal auf dem Handy gespeichert.
   - Grundumsatz nach Mifflin-St Jeor → persönlicher Wert für 1 MET
     (kcal pro Stunde in Ruhe).
   - Belastung (MET) aus Geschwindigkeit und Steigung je Abschnitt:
     Gehen/Laufen nach den ACSM-Formeln, Rad nach Geschwindigkeit
     plus Hubarbeit bergauf.
   - Kalorien = Σ MET × (Grundumsatz / 24 h) × Dauer
   ========================================================= */
(function () {
  const KEY = 'outdoorNavi.fitness.v1';
  const el = (id) => document.getElementById(id);
  const ACT = {
    walk: 'Wandern / Gehen',
    run: 'Laufen / Joggen',
    bike: 'Radfahren',
    mtb: 'Mountainbike'
  };

  let profile = null;   // { height, weight, sex: 'm'|'w', age, activity }
  try { profile = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const valid = (p) => p && p.height >= 100 && p.height <= 250 && p.weight >= 25 && p.weight <= 300 && (p.sex === 'm' || p.sex === 'w');

  /* ---------- Berechnung ---------- */
  // Grundumsatz in kcal pro Tag (Mifflin-St Jeor); ohne Alter: 40 Jahre angenommen
  function bmr(p) {
    const base = 10 * p.weight + 6.25 * p.height - 5 * (p.age || 40);
    return p.sex === 'm' ? base + 5 : base - 161;
  }

  // Belastung in MET für Geschwindigkeit (km/h) und Steigung (0,05 = 5 %)
  function met(act, kmh, grade, weight) {
    const g = Math.max(0, Math.min(grade || 0, 0.3));   // bergab kaum Entlastung, Ausreißer kappen
    if (kmh < 0.8) return 1.3;                            // Stehen / kurze Rast
    const vm = kmh * 1000 / 60;                           // m/min
    const walk = () => (0.1 * vm + 1.8 * vm * g + 3.5) / 3.5;
    const run = () => (0.2 * vm + 0.9 * vm * g + 3.5) / 3.5;
    if (act === 'walk') {
      if (kmh > 25) return 1.3;                           // unplausibel (Auto/Bahn) → nicht als Sport zählen
      return kmh <= 8 ? walk() : run();
    }
    if (act === 'run') {
      if (kmh > 30) return 1.3;
      return kmh < 6.5 ? walk() : run();
    }
    // Rad: Grundwert nach Geschwindigkeit (Compendium of Physical Activities)
    if (kmh > 70) return 1.3;
    let m = kmh < 10 ? 3.5 : kmh < 16 ? 4 + (kmh - 10) * 0.45 : kmh < 19 ? 6.8 : kmh < 22 ? 8 : kmh < 25 ? 10 : kmh < 30 ? 12 : 15.8;
    if (act === 'mtb') m *= 1.15;                         // Gelände, Rollwiderstand
    // Hubarbeit bergauf: Leistung = Masse × g × v × Steigung, Wirkungsgrad ~24 %
    const mass = (weight || 75) + 12;                     // + Rad und Gepäck
    const watt = mass * 9.81 * (kmh / 3.6) * g / 0.24;
    m += (watt * 3.6 / 4.184) / (weight || 75);          // kcal/h pro kg ≈ MET
    return m;
  }

  // Kalorien für eine Punktliste [lat, lng, höhe, zeit, neuerAbschnitt]
  function calcKcal(points, opts) {
    const p = opts && opts.profile || profile;
    if (!valid(p) || !points || !points.length) return null;
    const act = (opts && opts.activity) || p.activity || 'walk';
    const perHour = bmr(p) / 24;                          // kcal pro Stunde = 1 MET
    let kcal = 0, s = 0, dist = 0;
    const flush = (i) => {
      const a = points[s], b = points[i];
      const dt = (b[3] - a[3]) / 3600000;
      if (dt <= 0) return;
      const kmh = dist / 1000 / dt;
      const grade = a[2] != null && b[2] != null && dist > 0 ? (b[2] - a[2]) / dist : 0;
      kcal += met(act, kmh, grade, p.weight) * perHour * dt;
    };
    for (let i = 1; i < points.length; i++) {
      if (points[i][4] === 1) {                           // nach Pause: neuer Abschnitt, Pause nicht zählen
        if (i - 1 > s) flush(i - 1);
        s = i; dist = 0; continue;
      }
      dist += haversine(points[i - 1], points[i]);
      // Abschnitte von mind. 50 m bzw. 2 Min. glätten GPS-Rauschen (v. a. bei der Höhe)
      if (dist >= 50 || points[i][3] - points[s][3] >= 120000 || i === points.length - 1) {
        flush(i); s = i; dist = 0;
      }
    }
    // Laufende Tour: Zeit seit dem letzten Punkt mitzählen
    if (opts && opts.tailMs > 0) kcal += met(act, opts.tailKmh || 0, 0, p.weight) * perHour * opts.tailMs / 3600000;
    return kcal;
  }

  function liveKcal() {
    if (!state.points.length) return valid(profile) ? 0 : null;
    const last = state.points[state.points.length - 1];
    const moving = state.running && !state.paused;
    const tailMs = moving ? Math.max(0, Date.now() - last[3]) : 0;
    const tailKmh = moving && lastFix && Date.now() - lastFix.t < 10000 ? lastFix.speedCalc * 3.6 : 0;
    return calcKcal(state.points, { tailMs, tailKmh });
  }

  /* ---------- Kachel während der Tour ---------- */
  const tile = el('kcalTile');
  function renderTile() {
    const show = state.running;
    tile.hidden = !show;
    if (!show) return;
    const k = liveKcal();
    tile.innerHTML = k == null ? '🔥 <small>Fitnessdaten<br>eintragen</small>'
      : `🔥 <b>${Math.round(k)}</b> <small>kcal</small>`;
    const pk = el('pkKcal');
    if (pk) pk.textContent = k == null ? '–' : Math.round(k);
  }
  tile.onclick = () => openPanel();
  setInterval(renderTile, 3000);
  renderTile();

  /* ---------- Eingabefenster ---------- */
  const panel = el('fitness');
  function openPanel() {
    el('menu').hidden = true;
    panel.hidden = false;
    const p = profile || {};
    el('fitHeight').value = p.height || '';
    el('fitWeight').value = p.weight || '';
    el('fitSex').value = p.sex || '';
    el('fitAge').value = p.age || '';
    el('fitAct').value = p.activity || 'walk';
    renderInfo();
  }
  function readForm() {
    const num = (id) => { const v = parseFloat(el(id).value.replace(',', '.')); return isFinite(v) ? v : null; };
    return { height: num('fitHeight'), weight: num('fitWeight'), sex: el('fitSex').value || null,
      age: num('fitAge'), activity: el('fitAct').value || 'walk' };
  }
  function renderInfo() {
    const p = readForm();
    const info = el('fitInfo');
    if (!valid(p)) { info.innerHTML = '<p class="hint">Bitte Größe (100–250 cm), Gewicht (25–300 kg) und Geschlecht eintragen.</p>'; return; }
    const bmi = p.weight / Math.pow(p.height / 100, 2);
    const k = state.points.length ? calcKcal(state.points, { profile: p }) : null;
    info.innerHTML = `
      <div class="pi-row"><span>BMI</span><b>${bmi.toFixed(1).replace('.', ',')}</b></div>
      <div class="pi-row"><span>Grundumsatz<br><small>${p.age ? '' : 'Alter nicht angegeben – 40 Jahre angenommen'}</small></span><b>${Math.round(bmr(p))} kcal/Tag</b></div>
      <div class="pi-row"><span>Beispiel: 1 Std. ${ACT[p.activity]}<br><small>${p.activity === 'walk' ? '5 km/h, eben' : p.activity === 'run' ? '10 km/h, eben' : '18 km/h, eben'}</small></span>
        <b>≈ ${Math.round(met(p.activity, p.activity === 'walk' ? 5 : p.activity === 'run' ? 10 : 18, 0, p.weight) * bmr(p) / 24)} kcal</b></div>
      ${k != null ? `<div class="pi-row"><span>${state.running ? 'Aktuelle Tour' : 'Letzte Tour'}</span><b>≈ ${Math.round(k)} kcal</b></div>` : ''}`;
  }
  ['fitHeight', 'fitWeight', 'fitSex', 'fitAge', 'fitAct'].forEach((id) => el(id).addEventListener('input', renderInfo));
  el('fitSave').onclick = () => {
    const p = readForm();
    if (!valid(p)) { toast('Bitte Größe, Gewicht und Geschlecht eintragen'); return; }
    profile = p;
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    panel.hidden = true;
    renderTile();
    toast('Fitnessdaten gespeichert');
  };
  el('fitClose').onclick = () => { panel.hidden = true; };
  el('btnFitness').onclick = openPanel;

  window.fitness = {
    calcKcal, liveKcal, activityName: (a) => ACT[a] || ACT.walk,
    profile: () => (valid(profile) ? profile : null)
  };
})();
