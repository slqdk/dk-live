// Navigational warnings (NW) and firing exercises (FE) from Nautisk Information (Niord).
import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';

const POLL_MS = 10 * 60_000;
const color = ['match', ['get', 'kind'], 'fe', '#ff5c7a', '#ff9f43'];
const dt = (t) => (t ? new Date(Number(t)).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

export class NavWarningsLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.byId = new Map();
  }

  async init() {
    const map = this.map;
    map.addSource('navwarn', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const poly = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
    const line = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']]];
    const point = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];
    map.addLayer({ id: 'navwarn-fill', type: 'fill', source: 'navwarn', filter: poly, paint: { 'fill-color': color, 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'navwarn-line', type: 'line', source: 'navwarn', filter: line, paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.85 } });
    map.addLayer({
      id: 'navwarn-dot',
      type: 'circle',
      source: 'navwarn',
      filter: point,
      paint: { 'circle-color': color, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.5, 10, 6], 'circle-stroke-color': '#1a2433', 'circle-stroke-width': 1.2 },
    });
    for (const id of ['navwarn-fill', 'navwarn-line', 'navwarn-dot']) {
      map.on('click', id, (e) => this.popup(e));
      map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
    }

    subscribe(
      '/api/navwarnings',
      POLL_MS,
      (data) => {
        this.count = data.warnings.length;
        this.error = data.status.startsWith('failed') ? `navigationsadvarsler: ${data.status}` : null;
        this.byId = new Map(data.warnings.map((w) => [String(w.id), w]));
        map.getSource('navwarn').setData({
          type: 'FeatureCollection',
          features: data.warnings.flatMap((w) => w.geometries.map((g) => ({ type: 'Feature', geometry: g, properties: { id: String(w.id), kind: w.kind } }))),
        });
      },
      (err) => (this.error = `navigationsadvarsler: ${err.message}`)
    );
  }

  popup(e) {
    // several warnings can overlap — show the first, list the others by title
    const ids = [...new Set(e.features.map((f) => f.properties.id))];
    const w = this.byId.get(ids[0]);
    if (!w) return;
    const period = [dt(w.from), dt(w.to)].filter(Boolean).join(' – ');
    const others = ids.slice(1, 4).map((id) => this.byId.get(id)?.title).filter(Boolean);
    new SmartPopup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(w.title)}</h3>
        <dl>
          <dt>Type</dt><dd>${w.kind === 'fe' ? 'Skydeøvelse' : 'Navigationsadvarsel'}${w.shortId ? ` · ${esc(w.shortId)}` : ''}</dd>
          ${w.area ? `<dt>Område</dt><dd>${esc(w.area)}</dd>` : ''}
          ${period ? `<dt>Gælder</dt><dd>${esc(period)}</dd>` : ''}
        </dl>
        ${w.details ? `<p class="navwarn-details">${esc(w.details.length > 280 ? w.details.slice(0, 280) + '…' : w.details)}</p>` : ''}
        ${others.length ? `<p class="muted" style="font-size:11px;margin:4px 0 0">Også her: ${others.map(esc).join(' · ')}</p>` : ''}
        <a class="ext" href="https://nautiskinformation.soefartsstyrelsen.dk/#/messages/map" target="_blank" rel="noopener">Nautisk Information ↗</a></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['navwarn-fill', 'navwarn-line', 'navwarn-dot']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
