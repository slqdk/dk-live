import { subscribe } from './feed.js';

const POLL_MS = 60_000;

export class LightningLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
  }

  async init() {
    const map = this.map;
    map.addSource('lightning', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'lightning-dot',
      type: 'circle',
      source: 'lightning',
      paint: {
        'circle-color': '#ffe066',
        'circle-radius': ['case', ['==', ['get', 'type'], 0], 4, 2.5],
        'circle-opacity': ['interpolate', ['linear'], ['get', 'ageMin'], 0, 1, 60, 0.25],
        'circle-blur': 0.3,
      },
    });
    subscribe(
      '/api/lightning',
      POLL_MS,
      (data) => {
        if (!data.enabled) return (this.count = 'ingen nøgle');
        this.count = data.strikes.length;
        this.error = data.status.startsWith('failed') ? `lyn: ${data.status}` : null;
        const now = Date.now();
        map.getSource('lightning').setData({
          type: 'FeatureCollection',
          features: data.strikes.map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: { type: s.type, ageMin: (now - s.time) / 60_000 },
          })),
        });
      },
      (err) => (this.error = `lyn: ${err.message}`)
    );
  }

  setVisible(on) {
    this.map.setLayoutProperty('lightning-dot', 'visibility', on ? 'visible' : 'none');
  }
}
