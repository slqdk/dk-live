import { subscribe } from './feed.js';
import { addShapeIcon, esc, loadPhoto, SmartPopup } from '../app.js';
import { prefs } from '../prefs.js';

const POLL_MS = 10_000;
const MAX_EXTRAP_S = 90; // stop moving an aircraft that hasn't reported for this long
const KN_TO_MS = 0.514444;
const M_PER_DEG_LAT = 111_320;

export class FlightsLayer {
  constructor(map, { military }) {
    this.map = map;
    this.military = military;
    this.id = military ? 'military' : 'flights';
    this.color = military ? '#5aa9ff' : '#ffd24a';
    this.aircraft = [];
    this.count = null;
    this.error = null;
    this.visible = true;
  }

  async init() {
    const map = this.map;
    addShapeIcon(map, `${this.id}-plane`, this.color, (ctx, s) => {
      // simple plane silhouette pointing up
      const u = s / 32;
      ctx.beginPath();
      ctx.moveTo(0, -12 * u);
      ctx.lineTo(2.2 * u, -3 * u);
      ctx.lineTo(13 * u, 3 * u);
      ctx.lineTo(13 * u, 5.5 * u);
      ctx.lineTo(2 * u, 2.5 * u);
      ctx.lineTo(1.4 * u, 8.5 * u);
      ctx.lineTo(5 * u, 11 * u);
      ctx.lineTo(5 * u, 12.5 * u);
      ctx.lineTo(0, 11 * u);
      ctx.lineTo(-5 * u, 12.5 * u);
      ctx.lineTo(-5 * u, 11 * u);
      ctx.lineTo(-1.4 * u, 8.5 * u);
      ctx.lineTo(-2 * u, 2.5 * u);
      ctx.lineTo(-13 * u, 5.5 * u);
      ctx.lineTo(-13 * u, 3 * u);
      ctx.lineTo(-2.2 * u, -3 * u);
      ctx.closePath();
    });

    map.addSource(this.id, { type: 'geojson', data: empty() });
    map.addLayer({
      id: `${this.id}-icon`,
      type: 'symbol',
      source: this.id,
      layout: {
        'icon-image': `${this.id}-plane`,
        'icon-size': this.sizeExpr(),
        'icon-rotate': ['get', 'track'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': this.labelExpr(),
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-line-height': 1.15,
        'text-offset': [0, 1.4],
        'text-justify': 'center',
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'icon-opacity': ['case', ['get', 'onGround'], 0.5, 1],
        'text-color': this.color,
        'text-halo-color': '#1a2433',
        'text-halo-width': 1.2,
      },
    });

    map.on('click', `${this.id}-icon`, (e) => this.popup(e));
    map.on('mouseenter', `${this.id}-icon`, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', `${this.id}-icon`, () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/flights',
      POLL_MS,
      (data) => {
        this.aircraft = data.aircraft.filter((a) => a.military === this.military);
        this.count = this.aircraft.length;
        this.error = null;
      },
      (err) => (this.error = `fly: ${err.message}`)
    );

    this.setTicker(prefs.animations);
    document.addEventListener('visibilitychange', () => !document.hidden && this.render());
  }

  // Dead reckoning cadence. Once a second is plenty at country zoom (an airliner moves ~230 m/s);
  // "animations" makes it 4×/s for smooth motion when zoomed in. Nothing runs while hidden.
  setTicker(smooth) {
    clearInterval(this.ticker);
    this.ticker = setInterval(() => {
      if (!this.visible || document.hidden || !this.aircraft.length) return;
      this.render();
    }, smooth ? 250 : 1000);
  }

  sizeExpr() {
    const k = prefs.planeScale ?? 1;
    return ['interpolate', ['linear'], ['zoom'], 5, 0.75 * k, 9, 1.1 * k, 12, 1.5 * k];
  }
  labelExpr() {
    const z = prefs.labelZoom ?? 7;
    return ['step', ['zoom'], '', z, ['get', 'label'], z + 1.5, ['get', 'label2']];
  }
  applyPrefs(_, patch) {
    if ('animations' in patch) this.setTicker(patch.animations);
    this.map.setLayoutProperty(`${this.id}-icon`, 'icon-size', this.sizeExpr());
    this.map.setLayoutProperty(`${this.id}-icon`, 'text-field', this.labelExpr());
  }

  render() {
    const now = Date.now();
    const features = this.aircraft.map((a) => {
      let { lat, lon } = a;
      const dt = Math.min((now - a.seen) / 1000, MAX_EXTRAP_S);
      if (!a.onGround && a.gs && a.track != null && dt > 0) {
        const d = a.gs * KN_TO_MS * dt;
        const rad = (a.track * Math.PI) / 180;
        lat += (d * Math.cos(rad)) / M_PER_DEG_LAT;
        lon += (d * Math.sin(rad)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
      }
      return {
        type: 'Feature',
        id: a.id,
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { ...a, track: a.track ?? 0, label: model(a), label2: label2(a), route: a.route ? JSON.stringify(a.route) : null },
      };
    });
    this.map.getSource(this.id).setData({ type: 'FeatureCollection', features });
  }

  popup(e) {
    const p = e.features[0].properties;
    const onGround = p.onGround === 'true' || p.onGround === true;
    const route = p.route ? JSON.parse(p.route) : null;
    const nz = (v) => v != null && v !== 'null' && v !== '' ? v : null;
    const vr = nz(p.vr) ? Number(p.vr) : 0;
    const climb = vr > 200 ? ' ↑' : vr < -200 ? ' ↓' : '';
    const rows = [
      ['Fly', [nz(p.desc), nz(p.type) && `(${p.type})`].filter(Boolean).join(' ') || '–'],
      ['Operatør', nz(p.operator) ?? '–'],
      ['Reg.', nz(p.reg) ?? '–'],
      ['Rute', route ? `${route.from} → ${route.to}` : '–'],
      ['', route ? `${esc(route.fromName ?? '')} → ${esc(route.toName ?? '')}` : null],
      ['Højde', onGround ? 'på jorden' : nz(p.alt) ? `${m(Number(p.alt))} (${p.alt} ft)${climb}` : '–'],
      ['Stig/fald', nz(p.vr) && !onGround ? `${Math.round(vr * 0.00508 * 60)} m/min` : null],
      ['Fart', nz(p.gs) ? `${Math.round(p.gs * 1.852)} km/t` : '–'],
      ['Kurs', nz(p.track) ? `${Math.round(p.track)}°` : '–'],
      ['Kategori', p.category in CAT ? CAT[p.category] : nz(p.category)],
      ['Squawk', nz(p.squawk) ?? '–'],
      ['Nødsignal', nz(p.emergency)],
      ['ICAO', p.id],
    ].filter(([, v]) => v != null);
    const title = `${esc(p.callsign || p.reg || p.id)}${p.military === 'true' || p.military === true ? ' · militær' : ''}`;
    const popup = new SmartPopup({ offset: 12, maxWidth: '340px' })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="popup"><h3>${title}</h3><div class="photo"></div><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`)
      .addTo(this.map);
    const q = new URLSearchParams();
    if (p.reg && p.reg !== 'null') q.set('reg', p.reg);
    if (p.type && p.type !== 'null') q.set('type', p.type);
    loadPhoto(popup, `/api/photo/aircraft/${encodeURIComponent(p.id)}?${q}`);
  }

  setVisible(on) {
    this.visible = on;
    this.map.setLayoutProperty(`${this.id}-icon`, 'visibility', on ? 'visible' : 'none');
  }
}

const empty = () => ({ type: 'FeatureCollection', features: [] });

const m = (ft) => `${Math.round(ft * 0.3048)} m`;

// A readable model from what adsb.lol gives us: desc is "BOEING 737-800", "AIRBUS A-320",
// "LOCKHEED MARTIN F-16C"; t is the ICAO type code (B738, A320, F16). Prefer the model number
// out of desc, fall back to the type code.
const MODEL = [
  [/\b(?:F|MIG|SU|EF)[- ]?(\d{1,3})[A-Z]{0,3}\b/i, (x) => `${x[0].match(/^[A-Za-z]+/)[0].toUpperCase()}-${x[1]}`],
  [/\bA-?(3\d{2}|2\d{2}|400M?)\b/i, (x) => `A${x[1].toUpperCase()}`],
  [/\b7(\d)7-?(\d{1,3})?\b/, (x) => `7${x[1]}7${x[2] ? `-${x[2]}` : ''}`],
  [/\bC-?(\d{2,3}[A-Z]?)\b/i, (x) => `C-${x[1].toUpperCase()}`],
  [/\b(CRJ|ERJ|EMB|MD|DC|ATR|BAE|SAAB)[- ]?(\d{2,4})\b/i, (x) => `${x[1].toUpperCase()}-${x[2]}`],
];
// ICAO type designator -> readable model, for the aircraft where adsb.lol has no description.
// Only the codes that actually show up over Denmark; anything else falls through to the code.
const TYPE = {
  A19N: 'A319neo', A20N: 'A320neo', A21N: 'A321neo',
  A318: 'A318', A319: 'A319', A320: 'A320', A321: 'A321',
  A332: 'A330-200', A333: 'A330-300', A338: 'A330-800neo', A339: 'A330-900neo',
  A342: 'A340-200', A343: 'A340-300', A345: 'A340-500', A346: 'A340-600',
  A359: 'A350-900', A35K: 'A350-1000', A388: 'A380',
  A400: 'A400M', A124: 'An-124', A225: 'An-225',
  B37M: '737 MAX 7', B38M: '737 MAX 8', B39M: '737 MAX 9', B3XM: '737 MAX 10',
  B733: '737-300', B734: '737-400', B735: '737-500', B736: '737-600',
  B737: '737-700', B738: '737-800', B739: '737-900',
  B741: '747-100', B744: '747-400', B748: '747-8', B74F: '747F',
  B752: '757-200', B753: '757-300', B762: '767-200', B763: '767-300', B764: '767-400',
  B772: '777-200', B77L: '777-200LR', B773: '777-300', B77W: '777-300ER', B77F: '777F',
  B788: '787-8', B789: '787-9', B78X: '787-10',
  E170: 'E170', E75L: 'E175', E75S: 'E175', E190: 'E190', E195: 'E195',
  E290: 'E190-E2', E295: 'E195-E2', E135: 'ERJ-135', E145: 'ERJ-145',
  CRJ2: 'CRJ200', CRJ7: 'CRJ700', CRJ9: 'CRJ900', CRJX: 'CRJ1000',
  AT43: 'ATR 42', AT45: 'ATR 42', AT72: 'ATR 72', AT75: 'ATR 72', AT76: 'ATR 72-600',
  DH8A: 'Dash 8', DH8C: 'Dash 8', DH8D: 'Dash 8 Q400',
  SB20: 'Saab 2000', SF34: 'Saab 340',
  MD11: 'MD-11', MD82: 'MD-82', MD83: 'MD-83', MD88: 'MD-88', MD90: 'MD-90',
  BCS1: 'A220-100', BCS3: 'A220-300',
  C17: 'C-17', C130: 'C-130', C30J: 'C-130J', C295: 'C-295', C560: 'Citation V',
  F16: 'F-16', F16C: 'F-16C', F35: 'F-35', F35A: 'F-35A', F18: 'F/A-18', EUFI: 'Eurofighter',
  A139: 'AW139', EC35: 'EC135', EC45: 'EC145', H60: 'UH-60', S92: 'S-92', MH60: 'MH-60',
  K35R: 'KC-135', KC30: 'A330 MRTT', A332MRTT: 'A330 MRTT', E3TF: 'E-3 AWACS', P8: 'P-8',
  GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'G650', GL5T: 'Global 5000', GLEX: 'Global Express',
  C25A: 'CJ2', C25B: 'CJ3', C25C: 'CJ4', C68A: 'Citation Latitude', E55P: 'Phenom 300',
  PC12: 'PC-12', PC24: 'PC-24', TBM9: 'TBM 900', SR22: 'SR22', C172: 'Cessna 172', C182: 'Cessna 182',
  P28A: 'PA-28', DA40: 'DA40', DA42: 'DA42', DV20: 'Katana', C152: 'Cessna 152',
};

function model(a) {
  const byType = a.type && TYPE[a.type.toUpperCase()];
  if (byType) return byType;
  const d = a.desc ?? '';
  for (const [re, fmt] of MODEL) {
    const hit = d.match(re);
    if (hit) return fmt(hit);
  }
  if (d) {
    // strip the manufacturer and keep the rest, e.g. "PILATUS PC-12" -> "PC-12"
    const rest = d.split(/\s+/).slice(1).join(' ').trim();
    if (rest) return rest.length > 12 ? rest.slice(0, 12) : rest;
  }
  return a.type ?? a.callsign ?? a.reg ?? '';
}
function label2(a) {
  const line1 = model(a);
  if (a.onGround) return `${line1}\npå jorden`;
  const bits = [a.callsign, a.alt != null ? m(a.alt) : null, a.route ? `${a.route.from}→${a.route.to}` : null].filter(Boolean);
  return `${line1}\n${bits.join(' · ')}`;
}
const CAT = { A0: null, B0: null, C0: null, A1: 'let', A2: 'lille', A3: 'stor', A4: 'B757-klasse', A5: 'tung', A6: 'højtydende', A7: 'helikopter', B1: 'svævefly', B2: 'ballon', B4: 'ultralet', B6: 'drone' };
