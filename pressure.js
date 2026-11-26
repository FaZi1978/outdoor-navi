'use strict';
/* =========================================================
   Luftdruck
   Browser dürfen den Barometer-Sensor des Handys nicht auslesen.
   Daher: aktuelle Messwerte/Analysen von Open-Meteo (DWD- u. a.
   Wettermodelle) für die eigene Position, plus 3-Stunden-Tendenz.
   Offline: letzter Wert, der Druck am Standort wird über die
   GPS-Höhe weitergerechnet (barometrische Höhenformel).
   ========================================================= */
(function () {
  const API = 'https://api.open-meteo.com/v1/forecast';
  const KEY = 'outdoorNavi.pressure.v1';
  const REFRESH_MS = 10 * 60 * 1000;     // alle 10 Minuten
  const MOVE_M = 3000;                   // oder nach 3 km Ortswechsel
  const el = (id) => document.getElementById(id);

  let data = null;   // { msl, surface, trend, elevation, lat, lng, t }
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  let loading = false;

  // Druck auf Höhe h, ausgehend vom Bodendruck des Wettermodells auf dessen Geländehöhe
  // (berücksichtigt die tatsächliche Temperatur besser als die Standardatmosphäre; ca. 8,4 km Skalenhöhe)
  const pressureAt = (surface, elev, h) => surface * Math.exp(-(h - elev) / 8400);

  function position() {
    if (lastFix) return { lat: lastFix.p[0], lng: lastFix.p[1] };
    const c = map.getCenter();
    return map.getZoom() >= 9 ? { lat: c.lat, lng: c.lng } : null;
  }

  async function refresh(force) {
    const pos = position();
    if (!pos || loading || !navigator.onLine) { render(); return; }
    const old = data && Date.now() - data.t < REFRESH_MS && haversine([data.lat, data.lng], [pos.lat, pos.lng]) < MOVE_M;
    if (old && !force) { render(); return; }
    loading = true;
    try {
      const url = `${API}?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}`
        + '&current=pressure_msl,surface_pressure&hourly=pressure_msl&past_hours=3&forecast_hours=1&timezone=auto';
      const j = await (await fetch(url)).json();
      const msl = j.current.pressure_msl;
      const past = j.hourly.pressure_msl[0];
      data = {
        msl, surface: j.current.surface_pressure, elevation: j.elevation,
        trend: past != null ? msl - past : null,
        lat: pos.lat, lng: pos.lng, t: Date.now()
      };
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    } catch (e) { /* Netzfehler: alten Wert behalten */ }
    loading = false;
    render();
  }

  function trendInfo(d) {
    if (d == null) return { sym: '', text: 'keine Tendenz verfügbar', cls: '' };
    if (d <= -3) return { sym: '⇊', text: 'stark fallend – Wetterverschlechterung wahrscheinlich, evtl. Gewitter/Sturm', cls: 'p-warn' };
    if (d <= -1) return { sym: '↘', text: 'fallend – Wetter kann sich verschlechtern', cls: 'p-down' };
    if (d < 1) return { sym: '→', text: 'gleichbleibend – stabile Wetterlage', cls: '' };
    if (d < 3) return { sym: '↗', text: 'steigend – Wetter bessert sich', cls: 'p-up' };
    return { sym: '⇈', text: 'stark steigend – Wetterbesserung, oft windig', cls: 'p-up' };
  }

  function localPressure() {
    // Mit GPS-Höhe genauer als die Modellhöhe des Wetterdienstes
    const a = window.currentAltitude && currentAltitude();
    if (a && data) return { val: pressureAt(data.surface, data.elevation, a.h), src: (a.src === 'dem' ? 'Geländehöhe ' : 'GPS-Höhe ') + Math.round(a.h) + ' m' };
    if (data) return { val: data.surface, src: 'Geländehöhe ' + Math.round(data.elevation) + ' m' };
    return null;
  }

  const fmt = (v) => v.toFixed(0);
  const de1 = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  function render() {
    if (!data) { el('press').textContent = loading ? '…' : '–'; el('pressTrend').textContent = ''; return; }
    const tr = trendInfo(data.trend);
    el('press').textContent = fmt(data.msl);
    el('pressTrend').textContent = tr.sym;
    el('pressTrend').className = tr.cls;
    const ageMin = Math.round((Date.now() - data.t) / 60000);
    el('pressBox').classList.toggle('stale', ageMin > 60);

    if (!el('pressInfo').hidden) {
      const loc = localPressure();
      el('pressInfo').innerHTML = `
        <div class="pi-head"><b>Luftdruck</b><button class="icon small" id="pressClose" title="Schließen">✕</button></div>
        <div class="pi-row"><span>Auf Meereshöhe (wie im Wetterbericht)</span><b>${de1(data.msl)} hPa</b></div>
        ${loc ? `<div class="pi-row"><span>An deinem Standort<br><small>${loc.src}</small></span><b>${de1(loc.val)} hPa</b></div>` : ''}
        <div class="pi-row"><span>Tendenz (3 Std.)</span><b class="${tr.cls}">${tr.sym} ${data.trend != null ? (data.trend > 0 ? '+' : '') + de1(data.trend) + ' hPa' : '–'}</b></div>
        <p class="pi-text ${tr.cls}">${tr.text}</p>
        <p class="hint">Stand: vor ${ageMin < 1 ? 'weniger als 1' : ageMin} Min.${navigator.onLine ? '' : ' · offline – letzter bekannter Wert'}<br>
        Quelle: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (Wettermodelle u. a. DWD)</p>`;
      el('pressClose').onclick = (e) => { e.stopPropagation(); el('pressInfo').hidden = true; };
    }
  }

  el('pressBox').onclick = () => {
    el('pressInfo').hidden = !el('pressInfo').hidden;
    if (!el('pressInfo').hidden) refresh(false);
    render();
  };

  // Aktualisieren: beim Start, regelmäßig, beim ersten GPS-Fix, nach Ortswechsel, wenn wieder online
  let firstFix = false;
  setInterval(() => {
    if (lastFix && !firstFix) { firstFix = true; refresh(true); }
  }, 2000);
  setInterval(() => refresh(false), 60 * 1000);
  map.on('moveend', () => { if (!lastFix) refresh(false); });
  window.addEventListener('online', () => refresh(true));
  render();
  refresh(false);
})();
