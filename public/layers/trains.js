import { subscribe } from './feed.js';
import { addShapeIcon, esc, SmartPopup } from '../app.js';
import { prefs } from '../prefs.js';

const POLL_MS = 60_000;

export class TrainsLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    addShapeIcon(map, 'train', '#7fb3ff', (ctx, s) => {
      const u = s / 32;
      ctx.beginPath();
      ctx.roundRect(-7 * u, -5 * u, 14 * u, 10 * u, 2 * u);
    }, 24);
    addShapeIcon(map, 'train-s', '#ff6b6b', (ctx, s) => {
      const u = s / 32;
      ctx.beginPath();
      ctx.roundRect(-7 * u, -5 * u, 14 * u, 10 * u, 2 * u);
    }, 24);

    map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'trains-icon',
      type: 'symbol',
      source: 'trains',
      layout: {
        'icon-image': ['case', ['==', ['get', 'category'], 'S'], 'train-s', 'train'],
        'icon-size': this.sizeExpr(),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['step', ['zoom'], '', 7, ['get', 'name'], 9, ['get', 'label2']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-line-height': 1.15,
        'text-optional': true,
      },
      paint: { 'text-color': '#a9c9ff', 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });

    map.on('click', 'trains-icon', (e) => this.popup(e));
    map.on('mouseenter', 'trains-icon', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'trains-icon', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/trains',
      POLL_MS,
      (data) => {
        if (!data.enabled) return (this.count = 'ingen nøgle');
        this.count = data.vehicles.length;
        this.error = data.status.startsWith('failed') ? `tog: ${data.status}` : null;
        map.getSource('trains').setData({
          type: 'FeatureCollection',
          features: data.vehicles.map((v) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
            properties: { ...v, label2: `${v.name}\n→ ${v.direction ?? ''}${v.delay ? ` · +${v.delay} min` : ''}` },
          })),
        });
      },
      (err) => (this.error = `tog: ${err.message}`)
    );
  }

  sizeExpr() {
    const k = prefs.trainScale ?? 1;
    return ['interpolate', ['linear'], ['zoom'], 5, 0.7 * k, 9, 1.0 * k, 12, 1.3 * k];
  }
  applyPrefs() {
    this.map.setLayoutProperty('trains-icon', 'icon-size', this.sizeExpr());
  }

  popup(e) {
    const p = e.features[0].properties;
    const nz = (v) => (v != null && v !== 'null' && v !== '' ? v : '–');
    new SmartPopup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.name)}</h3>
        <dl>
          <dt>Retning</dt><dd>${esc(nz(p.direction))}</dd>
          <dt>Type</dt><dd>${esc(nz(p.category))}</dd>
          <dt>Operatør</dt><dd>${esc(nz(p.operator))}</dd>
          <dt>Forsinkelse</dt><dd>${p.delay && p.delay !== 'null' ? `${p.delay} min` : 'til tiden / ukendt'}</dd>
        </dl></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    this.map.setLayoutProperty('trains-icon', 'visibility', on ? 'visible' : 'none');
  }
}
