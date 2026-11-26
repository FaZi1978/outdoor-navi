'use strict';
/* =========================================================
   Wetter (Open-Meteo, u. a. DWD-Modelle, kein Schlüssel nötig)
   1) Wetter-Kachel ⛅ → Fenster mit aktuellem Wetter am Standort,
      Stundenvorhersage (24 h) und 5-Tage-Vorhersage:
      Temperatur, Windrichtung/-stärke, Regenwahrscheinlichkeit.
      Letzter Stand bleibt offline lesbar.
   2) Ebene „Wetterkarte“: Hoch- (H) und Tiefdruckgebiete (T),
      Isobaren (Linien gleichen Luftdrucks, alle 4 hPa),
      Windpfeile und Temperaturen auf einem Raster über der Karte.
   ========================================================= */
(function () {
  const API = 'https://api.open-meteo.com/v1/forecast';
  const KEY = 'outdoorNavi.weather.v1';
  const MAPKEY = 'outdoorNavi.weatherMap';
  const REFRESH_MS = 15 * 60 * 1000;
  const el = (id) => document.getElementById(id);

  /* ---------- Hilfen ---------- */
  const WMO = {
    0: ['☀️', 'Klar'], 1: ['🌤', 'Überwiegend klar'], 2: ['⛅', 'Teilweise bewölkt'], 3: ['☁️', 'Bedeckt'],
    45: ['🌫', 'Nebel'], 48: ['🌫', 'Nebel mit Reif'],
    51: ['🌦', 'Leichter Nieselregen'], 53: ['🌦', 'Nieselregen'], 55: ['🌧', 'Starker Nieselregen'],
    56: ['🌧', 'Gefrierender Nieselregen'], 57: ['🌧', 'Gefrierender Nieselregen'],
    61: ['🌦', 'Leichter Regen'], 63: ['🌧', 'Regen'], 65: ['🌧', 'Starker Regen'],
    66: ['🌧', 'Gefrierender Regen'], 67: ['🌧', 'Gefrierender Regen'],
    71: ['🌨', 'Leichter Schneefall'], 73: ['🌨', 'Schneefall'], 75: ['❄️', 'Starker Schneefall'], 77: ['🌨', 'Schneegriesel'],
    80: ['🌦', 'Leichte Regenschauer'], 81: ['🌧', 'Regenschauer'], 82: ['⛈', 'Heftige Regenschauer'],
    85: ['🌨', 'Schneeschauer'], 86: ['🌨', 'Starke Schneeschauer'],
    95: ['⛈', 'Gewitter'], 96: ['⛈', 'Gewitter mit Hagel'], 99: ['⛈', 'Schweres Gewitter mit Hagel']
  };
  const wmo = (c) => WMO[c] || ['🌡', '–'];
  const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const compass = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  // Pfeil zeigt, wohin der Wind weht (Windrichtung = woher er kommt)
  const arrow = (deg, size = 16, color = 'currentColor') =>
    `<svg class="wx-arrow" width="${size}" height="${size}" viewBox="0 0 16 16" style="transform:rotate(${deg + 180}deg)"><path d="M8 1 13 12 8 9.5 3 12Z" fill="${color}"/></svg>`;
  const windColor = (v) => v < 12 ? '#4a7f5b' : v < 25 ? '#2f6fd6' : v < 40 ? '#e08a00' : v < 62 ? '#d6332a' : '#8b1a8b';
  const r0 = (v) => Math.round(v);
  const dayName = (iso, i) => i === 0 ? 'Heute' : i === 1 ? 'Morgen'
    : new Date(iso + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
  // Wetterlage aus dem Luftdruck auf Meereshöhe
  const situation = (p) => p >= 1025 ? ['H', 'Kräftiges Hoch – meist stabil und trocken']
    : p >= 1015 ? ['H', 'Hochdruckeinfluss – eher freundlich']
    : p > 1005 ? ['', 'Übergangsbereich – wechselhaft möglich']
    : p > 995 ? ['T', 'Tiefdruckeinfluss – Wolken und Regen wahrscheinlich']
    : ['T', 'Kräftiges Tief – Regen und Wind, evtl. Sturm'];

  /* =========================================================
     1) Wetter am Standort
     ========================================================= */
  let data = null;   // { j: API-Antwort, lat, lng, t }
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  let loading = false;

  function position() {
    if (typeof lastFix !== 'undefined' && lastFix) return { lat: lastFix.p[0], lng: lastFix.p[1], gps: true };
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng, gps: false };
  }

  async function refresh(force) {
    const pos = position();
    if (loading || !navigator.onLine) { render(); return; }
    const fresh = data && Date.now() - data.t < REFRESH_MS && haversine([data.lat, data.lng], [pos.lat, pos.lng]) < 5000;
    if (fresh && !force) { render(); return; }
    loading = true; render();
    try {
      const url = `${API}?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lng.toFixed(3)}`
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl'
        + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant'
        + '&forecast_days=5&timezone=auto&wind_speed_unit=kmh';
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      data = { j, lat: pos.lat, lng: pos.lng, gps: pos.gps, t: Date.now() };
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    } catch (e) { if (!data) toast('Wetter konnte nicht geladen werden'); }
    loading = false;
    render();
  }

  function render() {
    const box = el('weather');
    if (box.hidden) return;
    const body = el('weatherBody');
    if (!data) { body.innerHTML = `<p class="hint">${loading ? 'Wetter wird geladen…' : navigator.onLine ? 'Noch keine Wetterdaten.' : 'Offline – noch keine Wetterdaten gespeichert.'}</p>`; return; }
    const { j } = data, c = j.current, h = j.hourly, d = j.daily;
    const [icon, text] = wmo(c.weather_code);
    // Index der aktuellen Stunde in der Stundenliste
    let hi = h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13));
    if (hi < 0) hi = 0;
    const rainNow = h.precipitation_probability[hi];
    const [sym, sit] = situation(c.pressure_msl);
    const ageMin = Math.round((Date.now() - data.t) / 60000);

    let html = `
      <div class="wx-now">
        <div class="wx-big">${icon}<b>${r0(c.temperature_2m)}°</b></div>
        <div class="wx-desc"><b>${text}</b><br><small>gefühlt ${r0(c.apparent_temperature)}° · Luftfeuchte ${c.relative_humidity_2m} %</small></div>
      </div>
      <div class="pi-row"><span>Wind</span><b>${arrow(c.wind_direction_10m, 18, windColor(c.wind_speed_10m))} aus ${compass(c.wind_direction_10m)} · ${r0(c.wind_speed_10m)} km/h<br><small>Böen ${r0(c.wind_gusts_10m)} km/h</small></b></div>
      <div class="pi-row"><span>Regenwahrscheinlichkeit<br><small>diese Stunde</small></span><b>💧 ${rainNow != null ? rainNow + ' %' : '–'}</b></div>
      <div class="pi-row"><span>Luftdruck (Meereshöhe)<br><small>${sit}</small></span><b>${sym ? `<span class="wx-ht ${sym === 'H' ? 'h' : 't'}">${sym}</span> ` : ''}${r0(c.pressure_msl)} hPa</b></div>
      <h3>Nächste 24 Stunden</h3>
      <div class="wx-hours">`;
    for (let i = hi; i < Math.min(hi + 24, h.time.length); i++) {
      html += `<div class="wx-h">
        <small>${i === hi ? 'jetzt' : h.time[i].slice(11, 13) + ' Uhr'}</small>
        <span class="wx-ic">${wmo(h.weather_code[i])[0]}</span>
        <b>${r0(h.temperature_2m[i])}°</b>
        <span class="wx-rain${h.precipitation_probability[i] >= 50 ? ' hi' : ''}">💧${h.precipitation_probability[i] ?? '–'}%</span>
        <span class="wx-wind">${arrow(h.wind_direction_10m[i], 14, windColor(h.wind_speed_10m[i]))}${r0(h.wind_speed_10m[i])}</span>
      </div>`;
    }
    html += `</div><h3>Nächste Tage</h3><ul class="wx-days">`;
    for (let i = 0; i < d.time.length; i++) {
      html += `<li>
        <span class="wx-dn">${dayName(d.time[i], i)}</span>
        <span class="wx-ic">${wmo(d.weather_code[i])[0]}</span>
        <span class="wx-t"><b>${r0(d.temperature_2m_max[i])}°</b> / ${r0(d.temperature_2m_min[i])}°</span>
        <span class="wx-rain${d.precipitation_probability_max[i] >= 50 ? ' hi' : ''}">💧${d.precipitation_probability_max[i] ?? '–'}%</span>
        <span class="wx-wind">${arrow(d.wind_direction_10m_dominant[i], 14, windColor(d.wind_speed_10m_max[i]))}${r0(d.wind_speed_10m_max[i])}</span>
      </li>`;
    }
    html += `</ul>
      <button id="wxMapBtn" class="${map.hasLayer(wxLayer) ? '' : 'primary'}">🌧 Wetterradar ${map.hasLayer(wxLayer) ? 'ausblenden' : 'einblenden'}</button>
      <p class="hint">${data.gps ? 'Für deinen Standort' : 'Für die Kartenmitte (kein GPS)'} · Stand: vor ${ageMin < 1 ? 'weniger als 1' : ageMin} Min.${navigator.onLine ? '' : ' · offline – letzter bekannter Stand'}<br>
      Wind in km/h, Pfeil zeigt, wohin der Wind weht. Quelle: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a> (Wettermodelle u. a. DWD)</p>`;
    body.innerHTML = html;
    el('wxMapBtn').onclick = () => {
      if (map.hasLayer(wxLayer)) map.removeLayer(wxLayer); else { wxLayer.addTo(map); box.hidden = true; }
      render();
    };
  }

  function openPanel() {
    const box = el('weather');
    box.hidden = !box.hidden;
    if (!box.hidden) { el('legend').hidden = true; render(); refresh(false); }
  }
  el('weatherClose').onclick = () => { el('weather').hidden = true; };
  setInterval(() => { if (!el('weather').hidden) refresh(false); }, 60 * 1000);
  window.addEventListener('online', () => { if (!el('weather').hidden) refresh(true); });

  // Kachel auf der Karte (unter der Legenden-Kachel)
  const WeatherButton = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const b = L.DomUtil.create('button', 'legend-btn');
      b.type = 'button'; b.title = 'Wetter'; b.textContent = '⛅';
      L.DomEvent.disableClickPropagation(b);
      b.onclick = openPanel;
      return b;
    }
  });
  new WeatherButton().addTo(map);

  /* =========================================================
     2) Wetterradar (Deutscher Wetterdienst, Niederschlagsradar)
        1 km Auflösung, alle 5 Minuten neu, Deutschland + Grenzgebiete.
        Animation: letzte Stunde + Vorhersage bis 2 Stunden.
     ========================================================= */
  const WMS = 'https://maps.dwd.de/geoserver/dwd/wms';
  const CAPS = 'https://maps.dwd.de/geoserver/dwd/Niederschlagsradar/ows?service=WMS&version=1.3.0&request=GetCapabilities';
  const RADARKEY = 'outdoorNavi.radar';
  map.createPane('radar').style.zIndex = 390;   // über der Karte, unter Schutzgebieten/Markern
  const wxLayer = L.layerGroup();
  layerControl.addOverlay(wxLayer, '🌧 Wetterradar (DWD)');
  try { localStorage.removeItem('outdoorNavi.weatherMap'); } catch (e) {}   // alte Wetterkarte

  const bar = el('radarBar'), slider = el('radarSlider'), playBtn = el('radarPlay'), label = el('radarTime');
  let frames = [], layers = [], idx = 0, nowIdx = 0, refMs = 0;
  let playing = true, anim = null, reloadTimer = null, loadingTimes = false;

  async function loadTimes() {
    let ref = null, end = null;
    try {
      const txt = await (await fetch(CAPS)).text();
      const r = /name="REFERENCE_TIME" default="([^"]+)"/.exec(txt);
      const t = /name="time"[^>]*>[^<]*?\/([^/<]+)\/PT/.exec(txt);
      if (r) ref = Date.parse(r[1]);
      if (t) end = Date.parse(t[1]);
    } catch (e) { /* unten Ersatzwert */ }
    if (!ref) {   // Fallback: letzte volle 5 Minuten minus Verarbeitungszeit
      ref = Math.floor((Date.now() - 10 * 60000) / 300000) * 300000;
      end = ref;
    }
    const list = [];
    for (let m = -60; m <= 0; m += 10) list.push(ref + m * 60000);
    for (let m = 15; m <= 120; m += 15) if (!end || ref + m * 60000 <= end) list.push(ref + m * 60000);
    return { ref, list };
  }

  function clearFrames() {
    layers.forEach((l) => wxLayer.removeLayer(l));
    layers = []; frames = [];
  }

  async function start() {
    if (!navigator.onLine) { toast('Wetterradar braucht Internet'); return; }
    if (loadingTimes) return;
    loadingTimes = true;
    const { ref, list } = await loadTimes();
    loadingTimes = false;
    if (!map.hasLayer(wxLayer)) return;
    if (ref === refMs && layers.length) return;           // nichts Neues
    const keepPlaying = playing;
    clearFrames();
    refMs = ref; frames = list; nowIdx = list.indexOf(ref);
    layers = list.map((t) => L.tileLayer.wms(WMS, {
      layers: 'dwd:Niederschlagsradar', styles: '', format: 'image/png', transparent: true, version: '1.3.0',
      time: new Date(t).toISOString(), tileSize: 512, pane: 'radar', opacity: 0, maxZoom: 19,
      attribution: 'Radar: © <a href="https://www.dwd.de" target="_blank" rel="noopener">Deutscher Wetterdienst</a>'
    }));
    slider.max = list.length - 1;
    bar.hidden = false;
    // Zuerst nur das aktuelle Bild laden (sofort sichtbar), danach die übrigen Zeitpunkte
    const mine = layers;
    layers[nowIdx].addTo(wxLayer);
    show(nowIdx);
    setPlaying(false);
    preloading = true; showLoading();
    layers[nowIdx].once('load', () => {
      if (layers !== mine) return;
      let left = layers.length - 1;
      const done = () => {
        if (layers !== mine || --left > 0) return;
        preloading = false; show(idx);
        if (keepPlaying) setPlaying(true);
      };
      layers.forEach((l, i) => { if (i !== nowIdx) { l.once('load', done); l.addTo(wxLayer); } });
      if (left === 0) done();
    });
  }
  let preloading = false;
  function showLoading() { if (preloading) label.innerHTML += ' <small>· lädt Animation…</small>'; }

  function show(i) {
    if (!layers.length) return;
    if (layers[idx]) layers[idx].setOpacity(0);
    idx = i;
    layers[idx].setOpacity(0.75);
    slider.value = idx;
    const t = frames[idx], diff = Math.round((t - refMs) / 60000);
    const hhmm = new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    label.innerHTML = `<b>${hhmm}</b> ${diff === 0 ? 'jetzt' : diff < 0 ? `vor ${-diff} Min.` : `<span class="fc">Vorhersage +${diff} Min.</span>`}`;
    showLoading();
  }

  function step() {
    if (idx >= layers.length - 1) { show(0); return; }
    show(idx + 1);
  }
  function setPlaying(p) {
    playing = p;
    clearInterval(anim);
    playBtn.textContent = p ? '⏸' : '▶';
    playBtn.title = p ? 'Anhalten' : 'Abspielen';
    if (p) anim = setInterval(() => { if (idx === layers.length - 1) { clearInterval(anim); setTimeout(() => { if (playing) { show(0); setPlaying(true); } }, 1200); } else step(); }, 700);
  }
  playBtn.onclick = () => { if (preloading) { toast('Animation lädt noch…'); return; } setPlaying(!playing); };
  slider.oninput = () => { setPlaying(false); show(+slider.value); };
  el('radarNow').onclick = () => { setPlaying(false); show(nowIdx); };

  function stop() {
    clearInterval(anim); clearInterval(reloadTimer);
    clearFrames(); refMs = 0; preloading = false; playing = true;
    bar.hidden = true;
  }

  // layeradd/layerremove: gilt für die Ebenen-Auswahl und für den Knopf im Wetterfenster
  map.on('layeradd', (e) => {
    if (e.layer !== wxLayer) return;
    try { localStorage.setItem(RADARKEY, '1'); } catch (err) {}
    start();
    clearInterval(reloadTimer);
    reloadTimer = setInterval(start, 5 * 60 * 1000);   // neue Radarbilder alle 5 Minuten
    render();
  });
  map.on('layerremove', (e) => {
    if (e.layer !== wxLayer) return;
    try { localStorage.setItem(RADARKEY, '0'); } catch (err) {}
    stop();
    render();
  });
  window.addEventListener('online', () => { if (map.hasLayer(wxLayer)) start(); });
  let on = false;
  try { on = localStorage.getItem(RADARKEY) === '1'; } catch (e) {}
  if (on) wxLayer.addTo(map);
})();
