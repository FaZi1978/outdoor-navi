'use strict';
/* =========================================================
   Kartenlegende
   - App-eigene Darstellungen (Schutzgebiete, Track, Route, Fotos …)
   - Kartenzeichen von OpenTopoMap (Original-Legendenbilder von opentopomap.org)
   ========================================================= */
(function () {
  const OTM = 'https://opentopomap.org/img/legende/';

  // Eigene Symbole als kleines Inline-SVG bzw. HTML
  const line = (color, w, dash, casing) => `<svg width="44" height="14" viewBox="0 0 44 14">${casing ? `<line x1="2" y1="7" x2="42" y2="7" stroke="${casing}" stroke-width="${w + 4}" stroke-linecap="round"/>` : ''}<line x1="2" y1="7" x2="42" y2="7" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;
  const area = (color) => `<span class="swatch big" style="color:${color}"></span>`;

  const APP = [
    [area('#db1414'), 'Naturschutzgebiet (NSG)'],
    [area('#1a9e33'), 'Landschaftsschutzgebiet (LSG)'],
    [area('#8f33c7'), 'Biosphärenreservat'],
    ['<span class="swatch big solid" style="color:#000"></span>', 'Militärisches Sperrgebiet (ab Zoomstufe 9)'],
    ...Object.values(window.hutTypes || {}).map((t, i) => [
      `<div class="hut-icon" style="background:${t.color};margin:auto"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 8 8 2.5 14 8" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="M4 7.5V13.5H12V7.5" fill="${i === 2 ? 'none' : '#fff'}" stroke="#fff" stroke-width="1.8"/></svg></div>`,
      t.label + (i === 2 ? '<br><small>ab Zoom 9 als Punkt, ab Zoom 12 als Symbol</small>' : '')]),
    ['<div class="pos-marker" style="margin:auto"></div>', 'Deine Position (Kreis = GPS-Genauigkeit)'],
    [line('#d6332a', 5), 'Aufgezeichneter Track'],
    [line('#1f6feb', 6, null, '#fff'), 'Geplante Route'],
    ['<div class="wp-marker start" style="margin:auto">A</div>', 'Start der Route'],
    ['<div class="wp-marker" style="margin:auto">1</div>', 'Zwischenpunkt'],
    ['<div class="wp-marker end" style="margin:auto">B</div>', 'Ziel der Route'],
    [line('#b23a2e', 3, '6 8'), 'Luftlinie zum Navigationsziel'],
    [line('#6a3fb5', 5), 'Geladene GPX-Route'],
    ['<div class="photo-marker legend-photo">📷</div>', 'Foto (antippen zum Öffnen)'],
    [`<span class="radar-ramp"></span>`,
      'Wetterradar: Niederschlag in mm/h<br><small>türkis = leicht · grün/gelb = mäßig · rot = stark · violett/blau = Unwetter<br>grau = keine Radardaten</small>']
  ];

  // [Datei, Bezeichnung] – aus der offiziellen OpenTopoMap-Legende
  const OTM_SECTIONS = [
    ['Straßen & Wege', [
      ['autobahn.png', 'Autobahn, Bundesstraße'], ['landstrasse.png', 'Landstraße'],
      ['normalestrasse.png', 'Kreisstraße, Ortsstraße'], ['strassenimbau', 'Straße im Bau'],
      ['service.png', 'Erschließungsweg'], ['track_grade1.png', 'Geteerter, gepflasterter Feldweg'],
      ['track_grade2.png', 'Kiesweg, Feldweg, Radweg'], ['track_grade34.png', 'Feldweg, teils weiche Oberfläche'],
      ['track_grade5.png', 'Unbefestigter Feldweg'], ['fussweg_t12.png', 'Fußweg'],
      ['fussweg_t34.png', 'Schwieriger Weg (SAC T3–T4)'], ['fussweg_t56.png', 'Sehr schwieriger Weg (SAC T5–T6), Klettersteig'],
      ['bobsleigh.png', 'Bobbahn'], ['toboggan.png', 'Sommerrodelbahn']
    ]],
    ['Flächen', [
      ['laubwald.png', 'Laubwald'], ['nadelwald.png', 'Nadelwald'], ['mischwald.png', 'Mischwald'],
      ['gehoelz.png', 'Gehölz'], ['wiese.png', 'Wiese'], ['sumpf.png', 'Sumpf'], ['moor.png', 'Moor'],
      ['roehricht.png', 'Röhricht'], ['watt.png', 'Watt'], ['sand.png', 'Strand, Sand'], ['geroell.png', 'Geröll'],
      ['wein.png', 'Weinanbau'], ['friedhof.png', 'Friedhof'], ['schrebergarten.png', 'Schrebergärten'],
      ['sperrgebiet.png', 'Sperrgebiet'], ['bergbau.png', 'Bergbau, Steinbruch']
    ]],
    ['Linien', [
      ['stromleitung.png', 'Stromleitung'], ['seilbahn.png', 'Seilbahn'], ['boeschung.png', 'Böschung'],
      ['deich.png', 'Deich'], ['zaun.png', 'Zaun'], ['hecke.png', 'Hecke']
    ]],
    ['Natur & Gelände', [
      ['gipfel.png', 'Gipfel'], ['gipfelkreuz.png', 'Gipfelkreuz'], ['sattel.png', 'Sattel'],
      ['quelle.png', 'Quelle'], ['hoehle.png', 'Höhleneingang'], ['doline.png', 'Doline'],
      ['laubbaum.png', 'Markanter Laubbaum'], ['nadelbaum.png', 'Markanter Nadelbaum']
    ]],
    ['Wandern & Freizeit', [
      ['aussichtspunkt.png', 'Aussichtspunkt'], ['aussichtsturm.png', 'Aussichtsturm'],
      ['huette.png', 'Hütte'], ['huette_bewirtschaftet.png', 'Hütte (bewirtschaftet)'], ['unterstand.png', 'Unterstand'],
      ['camping.png', 'Campingplatz'], ['badestelle.png', 'Schwimmbad, Badestelle'],
      ['sportplatz.png', 'Sportplatz'], ['stadion.png', 'Stadion']
    ]],
    ['Gebäude & Bauwerke', [
      ['kirche.png', 'Kirche'], ['kapelle.png', 'Kapelle'], ['kreuz.png', 'Kreuz'], ['wegkreuz.png', 'Wegkreuz'],
      ['burg.png', 'Burg, Festung'], ['burgruine.png', 'Burgruine, Ruine'], ['schloss.png', 'Schloss'],
      ['schlossruine.png', 'Schlossruine'], ['denkmal.png', 'Denkmal, Monument'], ['huegelgrab.png', 'Hügelgrab'],
      ['turm.png', 'Turm'], ['wasserturm.png', 'Wasserturm'], ['sendeturm.png', 'Fernmeldeturm, Sendeturm'],
      ['mobilfunkmast.png', 'Mobilfunkmast'], ['leuchtturm', 'Leuchtturm'], ['muehle.png', 'Mühle'],
      ['bergwerk.png', 'Bergwerk'], ['bergwerk_stillgelegt.png', 'Bergwerk (stillgelegt)']
    ]],
    ['Energie', [
      ['kraftwerk.png', 'Kraftwerk'], ['photovoltaikanlage.png', 'Photovoltaikanlage'],
      ['windkraftanlage.png', 'Windkraftanlage'], ['schornstein.png', 'Schornstein']
    ]]
  ];

  const row = (sym, label) => `<li><span class="lg-sym">${sym}</span><span class="lg-label">${label}</span></li>`;
  let html = `<h3>In dieser App</h3><ul>${APP.map(([s, l]) => row(s, l)).join('')}</ul>`;
  OTM_SECTIONS.forEach(([title, items]) => {
    html += `<h3>${title}</h3><ul>${items.map(([f, l]) => row(`<img src="${OTM}${f}" alt="" loading="lazy">`, l)).join('')}</ul>`;
  });
  html += '<p class="hint">Die Zeichen gelten für die Topokarte. Im Satellitenbild werden nur Straßen und Ortsnamen eingeblendet.</p>';
  html += '<p class="hint">Kartenzeichen: Legende von <a href="https://opentopomap.org/about#legende" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA). Höhenlinien sind braun, Gewässer blau, Siedlungen grau.</p>';

  const panel = document.getElementById('legend');
  document.getElementById('legendBody').innerHTML = html;

  // Suchfeld: Einträge filtern
  const search = document.getElementById('legendSearch');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    panel.querySelectorAll('#legendBody ul').forEach((ul) => {
      let any = false;
      ul.querySelectorAll('li').forEach((li) => {
        const hit = !q || li.textContent.toLowerCase().includes(q);
        li.hidden = !hit; any = any || hit;
      });
      ul.hidden = !any; ul.previousElementSibling.hidden = !any;
    });
  });

  // Knopf auf der Karte (oben rechts, unter der Ebenen-Auswahl)
  const LegendButton = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const b = L.DomUtil.create('button', 'legend-btn');
      b.type = 'button'; b.title = 'Legende'; b.textContent = 'ⓘ';
      L.DomEvent.disableClickPropagation(b);
      b.onclick = toggle;
      return b;
    }
  });
  map.addControl(new LegendButton());

  function toggle(show) {
    const v = typeof show === 'boolean' ? show : panel.hidden;
    panel.hidden = !v;
    if (v) { document.getElementById('menu').hidden = true; }
  }
  document.getElementById('legendClose').onclick = () => toggle(false);
})();
