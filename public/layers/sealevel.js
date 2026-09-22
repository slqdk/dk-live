// DMI tide gauges: water level in cm relative to DVR90 (≈ daily mean sea level).
import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';

const POLL_MS = 5 * 60_000;
// ≥ +100 forhøjet · ≥ +150 høj · ≥ +200 stormflodsniveau (Vestkysten) · ≤ −80 lavvande
const color = ['step', ['get', 'level'], '#5aa9ff', -80, '#8b97a8', 100, '#ffd24a', 150, '#ff9f43', 200, '#ff5c4d'];
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

export class SeaLevelLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    map.addSource('sealevel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'sealevel-dot',
      type: 'circle',
      source: 'sealevel',
      paint: {
        'circle-color': color,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 9, 7],
        'circle-stroke-color': '#1a2433',
        'circle-stroke-width': 1.5,
      },
    });
    map.addLayer({
      id: 'sealevel-label',
      type: 'symbol',
      source: 'sealevel',
      layout: {
        'text-field': ['step', ['zoom'], '', 6.5, ['get', 'label']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0.9, 0],
        'text-anchor': 'left',
        'text-optional': true,
      },
      paint: { 'text-color': color, 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });
    map.on('click', 'sealevel-dot', (e) => this.popup(e));
    map.on('mouseenter', 'sealevel-dot', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'sealevel-dot', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/sealevel',
      POLL_MS,
      (data) => {
        this.count = data.stations.length;
        this.error = data.status.startsWith('failed') ? `vandstand: ${data.status}` : null;
        map.getSource('sealevel').setData({
          type: 'FeatureCollection',
          features: data.stations.map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { ...s, label: `${signed(s.level)} cm` },
          })),
        });
      },
      (err) => (this.error = `vandstand: ${err.message}`)
    );
  }

  popup(e) {
    const p = e.features[0].properties;
    const lvl = Number(p.level);
    const note = lvl >= 200 ? 'stormflodsniveau' : lvl >= 150 ? 'høj vandstand' : lvl >= 100 ? 'forhøjet vandstand' : lvl <= -80 ? 'lavvande' : 'normal';
    const t = new Date(Number(p.time)).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    new SmartPopup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.name)}</h3>
        <dl>
          <dt>Vandstand</dt><dd>${signed(lvl)} cm (DVR90) · ${note}</dd>
          <dt>Målt</dt><dd>${t}</dd>
        </dl>
        <small style="color:var(--muted)">Kilde: DMI oceanObs · 0 cm ≈ middelvandstand</small>
        <a class="ext" href="https://www.dmi.dk/vandstand" target="_blank" rel="noopener">DMI vandstand ↗</a></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['sealevel-dot', 'sealevel-label']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
