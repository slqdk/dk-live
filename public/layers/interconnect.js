// Interconnectors: live MW on each cable from Energi Data Service (PowerSystemRightNow).
// Energinet sign convention: positive = import into Denmark (for DK1_DK2: flow DK2 → DK1).
import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';

const POLL_MS = 120_000;
// key (normalised field name) → cable: [Danish end, far end] — far end is where the cable
// leaves the map or lands abroad, so the line reads as "this way out".
const CABLES = {
  dk1de: { name: 'Jylland ↔ Tyskland', a: [9.29, 55.03], b: [9.55, 54.45], abroad: 'Tyskland' },
  dk1nl: { name: 'COBRAcable ↔ Holland', a: [8.7, 55.52], b: [7.7, 54.75], abroad: 'Holland' },
  dk1gb: { name: 'Viking Link ↔ Storbritannien', a: [9.05, 55.52], b: [7.6, 55.8], abroad: 'Storbritannien' },
  dk1no: { name: 'Skagerrak ↔ Norge', a: [9.6, 56.47], b: [8.45, 57.8], abroad: 'Norge' },
  dk1se: { name: 'Konti-Skan ↔ Sverige', a: [10.1, 57.07], b: [11.5, 57.45], abroad: 'Sverige' },
  dk1dk2: { name: 'Storebælt (DK1 ↔ DK2)', a: [10.48, 55.36], b: [11.3, 55.52], abroad: 'DK2' },
  greatbelt: { name: 'Storebælt (DK1 ↔ DK2)', a: [10.48, 55.36], b: [11.3, 55.52], abroad: 'DK2' },
  dk2de: { name: 'Kontek / Kriegers Flak ↔ Tyskland', a: [12.06, 55.45], b: [12.2, 54.3], abroad: 'Tyskland' },
  dk2se: { name: 'Øresund ↔ Sverige', a: [12.5, 55.85], b: [12.95, 55.95], abroad: 'Sverige' },
};
const norm = (k) => k.replace(/^Exchange_/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const bearing = ([lon1, lat1], [lon2, lat2]) => {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};
const mw = (v) => `${Math.round(Math.abs(v)).toLocaleString('da-DK')} MW`;

export class InterconnectLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    const s = 28;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(14, 3);
    ctx.lineTo(24, 22);
    ctx.lineTo(14, 17);
    ctx.lineTo(4, 22);
    ctx.closePath();
    ctx.fill();
    if (!map.hasImage('ic-arrow')) map.addImage('ic-arrow', ctx.getImageData(0, 0, s, s), { sdf: true, pixelRatio: 2 });

    map.addSource('ic-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('ic-mid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const color = ['case', ['get', 'import'], '#6fe3a0', '#ffb86b'];
    map.addLayer({
      id: 'ic-line',
      type: 'line',
      source: 'ic-lines',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': color, 'line-width': ['get', 'width'], 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] },
    });
    map.addLayer({
      id: 'ic-arrow',
      type: 'symbol',
      source: 'ic-mid',
      layout: {
        'icon-image': 'ic-arrow',
        'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'icon-color': color, 'text-color': color, 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });
    map.on('click', 'ic-arrow', (e) => this.popup(e));
    map.on('mouseenter', 'ic-arrow', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'ic-arrow', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/energy',
      POLL_MS,
      (data) => {
        const ex = data.now?.exchanges ?? {};
        const lines = [];
        const mids = [];
        const seen = new Set();
        for (const [k, v] of Object.entries(ex)) {
          const cab = CABLES[norm(k)];
          if (!cab || v == null || seen.has(cab.name)) continue;
          seen.add(cab.name);
          const imp = v > 0; // into Denmark (Storebælt: into DK1)
          const from = imp ? cab.b : cab.a;
          const to = imp ? cab.a : cab.b;
          const props = { name: cab.name, abroad: cab.abroad, mw: v, import: imp, width: 1.5 + Math.min(Math.abs(v), 2000) / 350 };
          lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [cab.a, cab.b] }, properties: props });
          mids.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [(cab.a[0] + cab.b[0]) / 2, (cab.a[1] + cab.b[1]) / 2] },
            properties: { ...props, rot: bearing(from, to), label: Math.abs(v) < 1 ? '0 MW' : mw(v) },
          });
        }
        this.count = mids.length;
        this.error = !mids.length && data.status === 'ok' ? 'elforbindelser: ingen Exchange_*-felter' : null;
        map.getSource('ic-lines').setData({ type: 'FeatureCollection', features: lines });
        map.getSource('ic-mid').setData({ type: 'FeatureCollection', features: mids });
      },
      (err) => (this.error = `elforbindelser: ${err.message}`)
    );
  }

  popup(e) {
    const p = e.features[0].properties;
    const v = Number(p.mw);
    const dk2 = p.abroad === 'DK2';
    const dir = Math.abs(v) < 1 ? 'ingen flow' : dk2 ? (v > 0 ? 'DK2 → DK1' : 'DK1 → DK2') : v > 0 ? `import fra ${p.abroad}` : `eksport til ${p.abroad}`;
    new SmartPopup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.name)}</h3>
        <dl><dt>Flow</dt><dd>${mw(v)} · ${esc(dir)}</dd></dl>
        <small style="color:var(--muted)">Kilde: Energi Data Service (Energinet) · linjen er skematisk</small></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['ic-line', 'ic-arrow']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
