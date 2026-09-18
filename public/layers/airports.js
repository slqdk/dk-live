import { subscribe } from './feed.js';
import { addShapeIcon, esc, SmartPopup } from '../app.js';
import { prefs } from '../prefs.js';

const POLL_MS = 10 * 60_000;
const NEAR_KM = 15; // aircraft within this radius count as "near"
const GROUND_KM = 4; // on-ground aircraft within this radius count as "at the airport"

const SURFACE = { ASP: 'asfalt', ASPH: 'asfalt', CON: 'beton', CONC: 'beton', GRS: 'græs', GRASS: 'græs', GRE: 'grus', GRV: 'grus', GRAVEL: 'grus', TURF: 'græs', 'ASPH-G': 'asfalt/græs', PEM: 'asfalt', BIT: 'asfalt', UNK: 'ukendt', WATER: 'vand' };
const FREQ = { TWR: 'Tårn', APP: 'Approach', GND: 'Ground', ATIS: 'ATIS', AFIS: 'AFIS', CTAF: 'CTAF', UNIC: 'Unicom', DEP: 'Departure', RDO: 'Radio', CLD: 'Clearance', DEL: 'Delivery', APRON: 'Apron', 'A/G': 'Air/Ground' };
const FLTCAT = { VFR: 'VFR – godt flyvevejr', MVFR: 'MVFR – marginalt', IFR: 'IFR – lavt skydække/sigt', LIFR: 'LIFR – meget lavt' };

const km = (a, b) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export class AirportsLayer {
  constructor(map, getAircraft) {
    this.map = map;
    this.getAircraft = getAircraft; // () => aircraft[] from the flight layers
    this.count = null;
    this.error = null;
    this.airports = [];
  }

  async init() {
    const map = this.map;
    // Conventional airport badge: filled circle with an aircraft silhouette (nose up)
    const badge = (bg, fg) => (ctx, s) => {
      const u = s / 32;
      ctx.beginPath();
      ctx.arc(0, 0, 14 * u, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.2 * u;
      ctx.stroke();
      // aircraft
      const k = 0.62;
      ctx.beginPath();
      ctx.moveTo(0, -12 * u * k);
      ctx.lineTo(2.2 * u * k, -3 * u * k);
      ctx.lineTo(13 * u * k, 3 * u * k);
      ctx.lineTo(13 * u * k, 5.5 * u * k);
      ctx.lineTo(2 * u * k, 2.5 * u * k);
      ctx.lineTo(1.4 * u * k, 8.5 * u * k);
      ctx.lineTo(5 * u * k, 11 * u * k);
      ctx.lineTo(5 * u * k, 12.5 * u * k);
      ctx.lineTo(0, 11 * u * k);
      ctx.lineTo(-5 * u * k, 12.5 * u * k);
      ctx.lineTo(-5 * u * k, 11 * u * k);
      ctx.lineTo(-1.4 * u * k, 8.5 * u * k);
      ctx.lineTo(-2 * u * k, 2.5 * u * k);
      ctx.lineTo(-13 * u * k, 5.5 * u * k);
      ctx.lineTo(-13 * u * k, 3 * u * k);
      ctx.lineTo(-2.2 * u * k, -3 * u * k);
      ctx.closePath();
      ctx.fillStyle = fg;
      ctx.fill();
      // leave the shared helper nothing to draw
      ctx.beginPath();
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.strokeStyle = 'rgba(0,0,0,0)';
    };
    addShapeIcon(map, 'airport-large', '#e6ebf2', badge('#e6ebf2', '#1a2433'), 34);
    addShapeIcon(map, 'airport-small', '#8b97a8', badge('#4a5665', '#e6ebf2'), 26);

    map.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'airports-icon',
      type: 'symbol',
      source: 'airports',
      layout: {
        'icon-image': ['case', ['==', ['get', 'type'], 'small'], 'airport-small', 'airport-large'],
        'icon-size': this.sizeExpr(),
        'icon-allow-overlap': true,
        'text-field': ['step', ['zoom'], ['case', ['==', ['get', 'type'], 'large'], ['get', 'code'], ''], 7.5, ['get', 'code'], 9.5, ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
        'symbol-sort-key': ['match', ['get', 'type'], 'large', 0, 'medium', 1, 2],
      },
      paint: { 'text-color': '#cdd6e4', 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });
    // small fields only from zoom 8 so the overview isn't a carpet of grey circles
    map.setFilter('airports-icon', ['any', ['!=', ['get', 'type'], 'small'], ['>=', ['zoom'], 8]]);
    map.addLayer({
      id: 'airports-hit',
      type: 'circle',
      source: 'airports',
      paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
    });
    map.on('click', 'airports-hit', (e) => this.popup(e));
    map.on('mouseenter', 'airports-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'airports-hit', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/airports',
      POLL_MS,
      (data) => {
        this.airports = data.airports;
        this.count = data.airports.length;
        this.error = data.status.includes('failed') ? `lufthavne: ${data.status}` : null;
        map.getSource('airports').setData({
          type: 'FeatureCollection',
          features: data.airports.map((a) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
            properties: { id: a.id, type: a.type, code: a.iata ?? a.icao, name: a.name },
          })),
        });
      },
      (err) => (this.error = `lufthavne: ${err.message}`)
    );
  }

  sizeExpr() {
    const k = prefs.airportScale ?? 1;
    return ['interpolate', ['linear'], ['zoom'], 5, 0.55 * k, 9, 0.9 * k, 12, 1.2 * k];
  }
  applyPrefs() {
    this.map.setLayoutProperty('airports-icon', 'icon-size', this.sizeExpr());
  }

  popup(e) {
    const a = this.airports.find((x) => x.id === e.features[0].properties.id);
    if (!a) return;
    const aircraft = this.getAircraft?.() ?? [];
    const near = aircraft.map((f) => ({ f, d: km(a, f) })).filter((x) => x.d <= NEAR_KM);
    const onGround = near.filter((x) => x.f.onGround && x.d <= GROUND_KM);
    const airborne = near.filter((x) => !x.f.onGround).sort((x, y) => x.d - y.d);
    const codes = [a.iata, a.icao].filter(Boolean);
    const inbound = aircraft.filter((f) => f.route && codes.includes(f.route.to) && !f.onGround);
    const outbound = aircraft.filter((f) => f.route && codes.includes(f.route.from) && !f.onGround);

    const m = a.metar;
    const wind = m && m.windDir != null ? `${m.windDir === 'VRB' ? 'variabel' : `${m.windDir}°`} ${m.windKt ?? 0} kt${m.gustKt ? ` (stød ${m.gustKt})` : ''}` : null;
    const vis = m && m.visM != null ? (typeof m.visM === 'string' ? m.visM : m.visM >= 9999 ? '≥10 km' : `${(m.visM / 1000).toFixed(1)} km`) : null;
    const age = m?.time ? `${Math.round((Date.now() - m.time) / 60_000)} min` : null;

    const fl = (x) => `${esc(x.f.callsign ?? x.f.reg ?? x.f.id)} (${x.d.toFixed(0)} km${x.f.alt != null && !x.f.onGround ? `, ${Math.round(x.f.alt * 0.3048)} m` : ''})`;
    const rows = [
      ['Kode', codes.join(' / ')],
      ['Type', { large: 'stor lufthavn', medium: 'mellemstor', small: 'flyveplads' }[a.type]],
      ['By', a.municipality],
      ['Højde', a.elevationFt != null ? `${Math.round(a.elevationFt * 0.3048)} m` : null],
      ['Rutefly', a.scheduled ? 'ja' : 'nej'],
      ['Baner', a.runways.length ? a.runways.map((r) => `${r.ident}${r.lengthM ? ` ${r.lengthM} m` : ''}${r.surface ? ` ${SURFACE[r.surface.toUpperCase()] ?? r.surface.toLowerCase()}` : ''}${r.lighted ? ' · lys' : ''}`).join('<br>') : null, true],
      ['Frekvenser', a.frequencies.length ? a.frequencies.map((f) => `${FREQ[f.type] ?? f.type} ${f.mhz}`).join('<br>') : null, true],
      ['På jorden', onGround.length ? onGround.map(fl).join('<br>') : aircraft.length ? 'ingen set' : null, true],
      ['I luften nær', airborne.length ? airborne.slice(0, 6).map(fl).join('<br>') + (airborne.length > 6 ? `<br>+${airborne.length - 6} mere` : '') : null, true],
      ['På vej hertil', inbound.length ? inbound.map((f) => `${esc(f.callsign)} fra ${esc(f.route.from)}`).join('<br>') : null, true],
      ['Afgået herfra', outbound.length ? outbound.map((f) => `${esc(f.callsign)} til ${esc(f.route.to)}`).join('<br>') : null, true],
    ];
    const weather = m
      ? [
          ['Vejr', m.fltCat ? FLTCAT[m.fltCat] ?? m.fltCat : null],
          ['Vind', wind],
          ['Sigt', vis],
          ['Skyer', m.clouds],
          ['Fænomen', m.wx],
          ['Temp / dug', m.tempC != null ? `${m.tempC} °C / ${m.dewC ?? '–'} °C` : null],
          ['QNH', m.qnh != null ? `${m.qnh} hPa` : null],
          ['METAR', `<code>${esc(m.raw)}</code>${age ? ` <span class="muted">(${age})</span>` : ''}`, true],
        ]
      : [];
    const dl = (list) => list.filter(([, v]) => v != null && v !== '').map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(String(v))}</dd>`).join('');
    const links = [a.website && `<a class="ext" href="${esc(a.website)}" target="_blank" rel="noopener">Hjemmeside ↗</a>`, a.wikipedia && `<a class="ext" href="${esc(a.wikipedia)}" target="_blank" rel="noopener">Wikipedia ↗</a>`, `<a class="ext" href="https://www.flightradar24.com/airport/${esc((a.iata ?? a.icao).toLowerCase())}" target="_blank" rel="noopener">Flightradar24 ↗</a>`].filter(Boolean).join(' · ');

    new SmartPopup({ offset: 12, maxWidth: '360px' })
      .setLngLat([a.lon, a.lat])
      .setHTML(
        `<div class="popup airport"><h3>${esc(a.name)}</h3><dl>${dl(rows)}</dl>
        ${weather.length ? `<h4>Vejr nu</h4><dl>${dl(weather)}</dl>` : ''}
        <div class="links">${links}</div></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['airports-icon', 'airports-hit']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
