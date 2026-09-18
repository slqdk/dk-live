import { subscribe } from './feed.js';
import { addShapeIcon, esc, loadPhoto, SmartPopup } from '../app.js';
import { prefs } from '../prefs.js';

const POLL_MS = 15_000;

// AIS ship type ranges → label (rough)
const typeName = (t) => {
  if (t == null || Number.isNaN(t)) return 'ukendt';
  if (t >= 60 && t <= 69) return 'Passager';
  if (t >= 70 && t <= 79) return 'Fragt';
  if (t >= 80 && t <= 89) return 'Tank';
  if (t === 30) return 'Fiskeri';
  if (t === 52) return 'Slæbebåd';
  if (t === 36 || t === 37) return 'Fritid';
  if (t >= 40 && t <= 49) return 'Højhastighed';
  if (t === 50 || t === 55) return 'Myndighed';
  return `Type ${t}`;
};

// AIS navigational status codes
const NAV = {
  0: 'Under gang (motor)', 1: 'Til ankers', 2: 'Ikke under kommando', 3: 'Begrænset manøvreevne',
  4: 'Begrænset af dybgang', 5: 'Fortøjet', 6: 'Grundstødt', 7: 'Fisker', 8: 'Under sejl',
  11: 'Slæbt / bugseret', 12: 'Skubber', 14: 'AIS-SART / nød', 15: 'Ukendt',
};
// Flag from the MMSI's first three digits (Maritime Identification Digits) — the ones seen here
const MID = {
  219: 'DK', 220: 'DK', 211: 'DE', 218: 'DE', 265: 'SE', 266: 'SE', 257: 'NO', 258: 'NO', 259: 'NO',
  244: 'NL', 245: 'NL', 246: 'NL', 230: 'FI', 231: 'FO', 232: 'GB', 233: 'GB', 234: 'GB', 235: 'GB',
  261: 'PL', 276: 'EE', 275: 'LV', 277: 'LT', 273: 'RU', 209: 'CY', 210: 'CY', 212: 'CY',
  229: 'MT', 248: 'MT', 249: 'MT', 256: 'MT', 255: 'PT (Madeira)', 304: 'AG', 305: 'AG',
  308: 'BS', 309: 'BS', 311: 'BS', 636: 'LR', 538: 'MH', 351: 'PA', 352: 'PA', 353: 'PA', 354: 'PA',
  370: 'PA', 371: 'PA', 372: 'PA', 373: 'PA', 374: 'PA', 477: 'HK', 563: 'SG', 564: 'SG', 565: 'SG', 566: 'SG',
  205: 'BE', 226: 'FR', 227: 'FR', 228: 'FR', 224: 'ES', 225: 'ES', 247: 'IT', 250: 'IE', 251: 'IS',
  271: 'TR', 314: 'BB', 319: 'KY', 341: 'KN', 375: 'VC', 376: 'VC', 377: 'VC', 378: 'VG', 503: 'AU',
  416: 'TW', 412: 'CN', 413: 'CN', 414: 'CN', 431: 'JP', 432: 'JP', 440: 'KR', 441: 'KR', 366: 'US', 367: 'US', 368: 'US', 369: 'US',
};
// MMSI classes that aren't ships (ITU-R M.585)
function kind(mmsi) {
  const m = String(mmsi);
  if (m.startsWith('111')) return 'sar';   // SAR aircraft — 111 MID xxx
  if (m.startsWith('99')) return 'aton';   // aids to navigation — 99 MID xxxx
  if (m.startsWith('98')) return 'ship';   // craft associated with a parent ship
  if (m.startsWith('970')) return 'sart';  // AIS-SART / MOB / EPIRB
  if (m.startsWith('972') || m.startsWith('974')) return 'sart';
  if (m.startsWith('00')) return 'coast';  // coast station
  return 'ship';
}
const KIND = { sar: 'SAR-helikopter/fly', aton: 'Sømærke', sart: 'Nødsender (AIS-SART)', coast: 'Kyststation', ship: null };
const flag = (mmsi) => {
  const m = String(mmsi);
  const mid = m.startsWith('111') || m.startsWith('99') || m.startsWith('98') ? m.slice(2, 5) : m.slice(0, 3);
  return MID[mid] ?? null;
};

export class ShipsLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    addShapeIcon(map, 'ship', '#5fd3b0', (ctx, s) => {
      // pointed bow, flat stern — reads as a hull at small sizes
      const u = s / 32;
      ctx.beginPath();
      ctx.moveTo(0, -12 * u);
      ctx.lineTo(6 * u, -2 * u);
      ctx.lineTo(6 * u, 10 * u);
      ctx.lineTo(-6 * u, 10 * u);
      ctx.lineTo(-6 * u, -2 * u);
      ctx.closePath();
    }, 32);
    addShapeIcon(map, 'ship-anchored', '#5fd3b0', (ctx, s) => {
      ctx.beginPath();
      ctx.arc(0, 0, s / 5, 0, Math.PI * 2);
    }, 20);
    // SAR helicopter: rotor cross on a body
    addShapeIcon(map, 'ship-sar', '#ff8a5c', (ctx, s) => {
      const u = s / 32;
      ctx.beginPath();
      ctx.roundRect(-4 * u, -6 * u, 8 * u, 14 * u, 3 * u);
      ctx.rect(-12 * u, -1 * u, 24 * u, 2 * u);
      ctx.rect(-1 * u, -12 * u, 2 * u, 24 * u);
      ctx.rect(-5 * u, 9 * u, 10 * u, 2 * u);
    }, 32);
    // navigation aid: small diamond
    addShapeIcon(map, 'ship-aton', '#8fd3ff', (ctx, s) => {
      const u = s / 32;
      ctx.beginPath();
      ctx.moveTo(0, -7 * u); ctx.lineTo(6 * u, 0); ctx.lineTo(0, 7 * u); ctx.lineTo(-6 * u, 0); ctx.closePath();
    }, 18);
    // distress beacon: filled red circle with ring
    addShapeIcon(map, 'ship-sart', '#ff5c4d', (ctx, s) => {
      ctx.beginPath();
      ctx.arc(0, 0, s / 4, 0, Math.PI * 2);
    }, 22);

    map.addSource('ships', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'ships-icon',
      type: 'symbol',
      source: 'ships',
      layout: {
        'icon-image': ['match', ['get', 'kind'], 'sar', 'ship-sar', 'aton', 'ship-aton', 'sart', 'ship-sart', 'coast', 'ship-aton', ['case', ['<', ['get', 'sog'], 0.5], 'ship-anchored', 'ship']],
        'icon-size': this.sizeExpr(),
        'icon-rotate': ['get', 'iconRot'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['step', ['zoom'], ['case', ['==', ['get', 'kind'], 'sar'], ['get', 'name'], ''], 8.5, ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': ['match', ['get', 'kind'], 'sar', '#ff8a5c', 'aton', '#8fd3ff', 'sart', '#ff5c4d', '#5fd3b0'], 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });

    map.on('click', 'ships-icon', (e) => this.popup(e));
    map.on('mouseenter', 'ships-icon', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'ships-icon', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/ships',
      POLL_MS,
      (data) => {
        if (!data.enabled) {
          this.count = 'ingen nøgle';
          return;
        }
        this.count = data.ships.length;
        this.error = null;
        map.getSource('ships').setData({
          type: 'FeatureCollection',
          features: data.ships.map((s) => ({
            type: 'Feature',
            id: s.id,
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { ...s, kind: kind(s.id), name: s.name || (kind(s.id) === 'sar' ? 'SAR' : ''), sog: s.sog ?? 0, rot: s.rot, iconRot: s.heading ?? s.cog ?? 0, eta: s.eta ? JSON.stringify(s.eta) : null },
          })),
        });
      },
      (err) => (this.error = `skibe: ${err.message}`)
    );
  }

  sizeExpr() {
    const k = prefs.shipScale ?? 1;
    return ['interpolate', ['linear'], ['zoom'], 5, 0.8 * k, 9, 1.1 * k, 12, 1.5 * k];
  }
  applyPrefs() {
    this.map.setLayoutProperty('ships-icon', 'icon-size', this.sizeExpr());
  }

  popup(e) {
    const p = e.features[0].properties;
    const nz = (v) => (v != null && v !== 'null' && v !== '' && v !== 'undefined' ? v : null);
    const sog = nz(p.sog) ? Number(p.sog) : null;
    const ago = Math.round((Date.now() - Number(p.seen)) / 60_000);
    const eta = nz(p.eta) ? JSON.parse(p.eta) : null;
    const etaTxt = eta ? `${String(eta.day).padStart(2, '0')}/${String(eta.month).padStart(2, '0')} ${String(eta.hour ?? 0).padStart(2, '0')}:${String(eta.minute ?? 0).padStart(2, '0')}` : null;
    const k = kind(p.id);
    const rows = [
      ['Klasse', KIND[k]],
      ['Status', k === 'ship' ? NAV[Number(p.navStatus)] ?? null : null],
      ['Type', k === 'ship' ? typeName(nz(p.type) == null ? null : Number(p.type)) : null],
      ['Flag', flag(p.id)],
      ['Fart', sog != null ? `${sog.toFixed(1)} kn (${Math.round(sog * 1.852)} km/t)` : null],
      ['Kurs', nz(p.cog) ? `${Math.round(p.cog)}°${nz(p.heading) && Math.abs(p.heading - p.cog) > 5 ? ` · stævn ${Math.round(p.heading)}°` : ''}` : null],
      ['Drej', nz(p.rot) && Number(p.rot) !== 0 ? `${Number(p.rot) > 0 ? 'styrbord' : 'bagbord'}` : null],
      ['Destination', nz(p.dest)],
      ['ETA', etaTxt],
      ['Størrelse', nz(p.length) ? `${p.length} × ${p.beam ?? '?'} m` : null],
      ['Dybgang', nz(p.draught) ? `${Number(p.draught).toFixed(1)} m` : null],
      ['Kaldesignal', nz(p.callsign)],
      ['IMO', nz(p.imo) && Number(p.imo) > 0 ? p.imo : null],
      ['MMSI', p.id],
      ['Set', ago < 1 ? 'nu' : `for ${ago} min siden`],
    ].filter(([, v]) => v != null);
    const popup = new SmartPopup({ offset: 12, maxWidth: '340px' })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.name || (KIND[k] ?? `MMSI ${p.id}`))}</h3><div class="photo"></div>
        <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>
        <a class="ext" href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${p.id}" target="_blank" rel="noopener">MarineTraffic ↗</a></div>`
      )
      .addTo(this.map);
    if (p.name && k === 'ship') loadPhoto(popup, `/api/photo/ship/${p.id}?name=${encodeURIComponent(p.name)}`);
  }

  setVisible(on) {
    this.map.setLayoutProperty('ships-icon', 'visibility', on ? 'visible' : 'none');
  }
}
