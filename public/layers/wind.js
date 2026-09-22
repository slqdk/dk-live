// DMI weather stations: arrow pointing downwind, coloured by 10-min mean wind speed.
import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';

const POLL_MS = 5 * 60_000;
const DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];
const compass = (d) => (d == null ? '' : DIRS[Math.round(d / 22.5) % 16]);
// DMI wind classes (m/s): let/jævn · frisk · hård · kuling · stormende kuling · storm
const BEAUFORT = [[5.5, 'let til jævn vind'], [10.8, 'frisk vind'], [13.9, 'hård vind'], [17.2, 'kuling'], [20.8, 'hård kuling'], [24.5, 'stormende kuling'], [32.7, 'storm'], [Infinity, 'orkan']];
const klass = (v) => BEAUFORT.find(([max]) => v < max)[1];
const fmt = (v, d = 0) => (v == null ? '–' : v.toLocaleString('da-DK', { maximumFractionDigits: d, minimumFractionDigits: d }));

export class WindLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    // white arrow as SDF so MapLibre can colour it per feature; points up (= blowing north)
    const s = 32;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.lineTo(25, 15);
    ctx.lineTo(19, 14);
    ctx.lineTo(19, 30);
    ctx.lineTo(13, 30);
    ctx.lineTo(13, 14);
    ctx.lineTo(7, 15);
    ctx.closePath();
    ctx.fill();
    if (!map.hasImage('wind-arrow')) map.addImage('wind-arrow', ctx.getImageData(0, 0, s, s), { sdf: true, pixelRatio: 2 });

    map.addSource('wind', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const color = ['step', ['get', 'speed'], '#8fb8de', 5.5, '#6fe3a0', 10.8, '#ffd24a', 13.9, '#ff9f43', 17.2, '#ff5c4d', 24.5, '#e056fd'];
    map.addLayer({
      id: 'wind-arrow',
      type: 'symbol',
      source: 'wind',
      layout: {
        'icon-image': 'wind-arrow',
        'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1.1],
        'text-field': ['step', ['zoom'], '', 7, ['get', 'label']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'icon-color': color, 'icon-halo-color': 'rgba(0,0,0,0.6)', 'icon-halo-width': 1, 'text-color': color, 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });
    map.on('click', 'wind-arrow', (e) => this.popup(e));
    map.on('mouseenter', 'wind-arrow', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'wind-arrow', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/wind',
      POLL_MS,
      (data) => {
        this.count = data.stations.length;
        this.error = data.status.startsWith('failed') ? `vind: ${data.status}` : null;
        map.getSource('wind').setData({
          type: 'FeatureCollection',
          features: data.stations.map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: {
              ...s,
              rot: s.dir == null ? 0 : (s.dir + 180) % 360, // arrow shows where the wind goes
              label: `${fmt(s.speed)}${s.gust != null ? ` (${fmt(s.gust)})` : ''}`,
            },
          })),
        });
      },
      (err) => (this.error = `vind: ${err.message}`)
    );
  }

  popup(e) {
    const p = e.features[0].properties;
    const dir = p.dir === 'null' || p.dir == null ? null : Number(p.dir);
    const gust = p.gust === 'null' || p.gust == null ? null : Number(p.gust);
    const temp = p.temp === 'null' || p.temp == null ? null : Number(p.temp);
    const t = new Date(Number(p.time)).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    new SmartPopup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.name)}</h3>
        <dl>
          <dt>Vind</dt><dd>${fmt(Number(p.speed), 1)} m/s ${dir != null ? `fra ${compass(dir)} (${Math.round(dir)}°)` : ''} · ${klass(Number(p.speed))}</dd>
          ${gust != null ? `<dt>Vindstød</dt><dd>${fmt(gust, 1)} m/s</dd>` : ''}
          ${temp != null ? `<dt>Temperatur</dt><dd>${fmt(temp, 1)} °C</dd>` : ''}
          <dt>Målt</dt><dd>${t}</dd>
        </dl>
        <small style="color:var(--muted)">Kilde: DMI metObs · middelvind 10 min, stød = maks. 10 min</small></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    this.map.setLayoutProperty('wind-arrow', 'visibility', on ? 'visible' : 'none');
  }
}
