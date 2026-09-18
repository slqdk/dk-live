import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';
import { cap } from '../prefs.js';

const POLL_MS = 60_000;
const COLORS = {
  uheld: '#ff7a45',
  spærring: '#ffb300',
  kø: '#ffb300',
  havari: '#f0c060',
  forhindring: '#f0c060',
  vejr: '#8fd3ff',
  vejarbejde: '#9aa5b5',
  begivenhed: '#b58cff',
  info: '#9aa5b5',
};

export class TrafficLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.events = [];
  }

  async init() {
    const map = this.map;
    map.addSource('traffic', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'traffic-dot',
      type: 'circle',
      source: 'traffic',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['case', ['get', 'blocking'], 7, 5],
        'circle-stroke-color': '#1a2433',
        'circle-stroke-width': 1.5,
      },
    });
    // Invisible, larger target so the dots are easy to hit
    map.addLayer({
      id: 'traffic-hit',
      type: 'circle',
      source: 'traffic',
      paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
    });
    map.addLayer({
      id: 'traffic-label',
      type: 'symbol',
      source: 'traffic',
      layout: {
        'text-field': ['step', ['zoom'], ['get', 'title'], 8, ['get', 'label2']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 12],
        'text-offset': [0.8, 0],
        'text-anchor': 'left',
        'text-max-width': 16,
        'text-line-height': 1.15,
        'text-optional': true,
        'symbol-sort-key': ['case', ['get', 'blocking'], 0, 1],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#1a2433', 'text-halo-width': 1.3 },
    });

    map.on('click', 'traffic-hit', (e) => this.popup(e));
    map.on('mouseenter', 'traffic-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'traffic-hit', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/traffic',
      POLL_MS,
      (data) => {
        this.last = data;
        this.events = data.events;
        this.count = data.events.length;
        this.error = data.status.startsWith('failed') ? `trafik: ${data.status}` : null;
        map.getSource('traffic').setData(this.toGeo(data));
      },
      (err) => (this.error = `trafik: ${err.message}`)
    );
  }

  toGeo(data) {
    return {
      type: 'FeatureCollection',
      features: data.events.map((ev) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ev.lon, ev.lat] },
        properties: {
          ...ev,
          color: COLORS[ev.kind] ?? COLORS.info,
          title: cap(ev.title),
          label2: `${cap(ev.title)}\n${cap(ev.header.replace(/^[^-]+-\s*/, '').split(' mellem ')[0])}`,
        },
      })),
    };
  }

  applyPrefs() {
    if (this.last) this.map.getSource('traffic').setData(this.toGeo(this.last));
  }

  popup(e) {
    const p = e.features[0].properties;
    const t = (ms) => (ms && ms !== 'null' ? new Date(Number(ms)).toLocaleString('da-DK', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : '–');
    new SmartPopup({ offset: 10, maxWidth: '340px' })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.header)}</h3>
        <p style="margin:0 0 6px;white-space:pre-line">${esc(p.text)}</p>
        <dl>
          <dt>Start</dt><dd>${t(p.begin)}</dd>
          <dt>Forventet slut</dt><dd>${t(p.end)}</dd>
          <dt>Opdateret</dt><dd>${t(p.modified)}</dd>
          <dt>Kilde</dt><dd>${esc(p.source)}</dd>
        </dl></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['traffic-dot', 'traffic-hit', 'traffic-label']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

