import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';
import { cap } from '../prefs.js';

const POLL_MS = 120_000;
const COLORS = { melding: '#ff7a45', spærring: '#ffb300', vejarbejde: '#9aa5b5' };

export class AutobahnLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    map.addSource('autobahn', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'autobahn-dot',
      type: 'circle',
      source: 'autobahn',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['get', 'blocked'], 7, 5],
        'circle-stroke-color': '#1a2433',
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: 'autobahn-hit',
      type: 'circle',
      source: 'autobahn',
      paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
    });
    map.addLayer({
      id: 'autobahn-label',
      type: 'symbol',
      source: 'autobahn',
      minzoom: 7,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 10, 12],
        'text-offset': [0.8, 0],
        'text-anchor': 'left',
        'text-max-width': 16,
        'text-line-height': 1.15,
        'text-optional': true,
        'symbol-sort-key': ['case', ['get', 'blocked'], 0, 1],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#1a2433', 'text-halo-width': 1.3 },
    });

    map.on('click', 'autobahn-hit', (e) => this.popup(e));
    map.on('mouseenter', 'autobahn-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'autobahn-hit', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/autobahn',
      POLL_MS,
      (data) => {
        this.last = data;
        this.count = data.items.length;
        this.error = data.status.startsWith('failed') ? `autobahn: ${data.status}` : null;
        map.getSource('autobahn').setData(this.toGeo(data));
      },
      (err) => (this.error = `autobahn: ${err.message}`)
    );
  }

  toGeo(data) {
    return {
      type: 'FeatureCollection',
      features: data.items.map((ev) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ev.lon, ev.lat] },
        properties: { ...ev, color: COLORS[ev.kind] ?? COLORS.vejarbejde, label: `${ev.road} · ${cap(ev.subtitle || ev.title)}` },
      })),
    };
  }
  applyPrefs() {
    if (this.last) this.map.getSource('autobahn').setData(this.toGeo(this.last));
  }

  popup(e) {
    const p = e.features[0].properties;
    new SmartPopup({ offset: 10, maxWidth: '340px' })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.road)} · ${esc(p.title)}</h3>
        ${p.subtitle && p.subtitle !== 'null' ? `<p style="margin:0 0 4px;color:var(--muted)">${esc(p.subtitle)}</p>` : ''}
        <p style="margin:0;white-space:pre-line">${esc(p.text)}</p>
        ${p.blocked === 'true' || p.blocked === true ? '<p style="margin:6px 0 0;color:var(--traffic)">Spærret</p>' : ''}</div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['autobahn-dot', 'autobahn-hit', 'autobahn-label']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
