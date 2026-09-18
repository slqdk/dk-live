import { subscribe } from './feed.js';
import { prefs } from '../prefs.js';

// TomTom traffic flow as vector tiles: only motorways and trunk roads, coloured by
// traffic_level (current speed ÷ free-flow speed). Off by default — the free key is limited
// to 2,500 tiles/day.
const SOURCE_LAYER = 'Traffic flow';

export class FlowLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.visible = false;
  }

  async init() {
    const map = this.map;
    // Above every basemap line (roads, casings), below the basemap labels that follow them.
    const layers = map.getStyle().layers;
    const lastLine = layers.map((l) => l.type).lastIndexOf('line');
    const beforeId = layers[lastLine + 1]?.id;
    map.addSource('flow', {
      type: 'vector',
      tiles: [`${location.origin}/api/flow/{z}/{x}/{y}.pbf`],
      minzoom: 5,
      maxzoom: 14,
      attribution: 'Traffic © TomTom',
    });
    map.addLayer(
      {
        id: 'flow',
        type: 'line',
        source: 'flow',
        'source-layer': SOURCE_LAYER,
        filter: ['in', ['get', 'road_category'], ['literal', ['motorway', 'trunk']]],
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'step', ['coalesce', ['get', 'traffic_level'], 1],
            '#c0392b', 0.35, // near standstill
            '#ff5c4d', 0.6,  // heavy
            '#ffb300', 0.85, // slow
            '#4ade80',       // free flow
          ],
          'line-width': this.widthExpr(),
          'line-opacity': 1,
        },
      },
      beforeId
    );
    subscribe('/api/flow', 5 * 60_000, (d) => (this.count = d.enabled ? '' : 'ingen nøgle'), (err) => (this.error = `flow: ${err.message}`));
  }

  widthExpr() {
    const k = prefs.flowWidth ?? 1;
    const w = (mw, tr) => ['case', ['==', ['get', 'road_category'], 'motorway'], mw * k, tr * k];
    return ['interpolate', ['exponential', 1.4], ['zoom'], 5, w(3, 2), 8, w(5, 3.5), 11, w(9, 6), 14, w(14, 9)];
  }
  applyPrefs() {
    this.map.setPaintProperty('flow', 'line-width', this.widthExpr());
  }

  setVisible(on) {
    this.visible = on;
    this.map.setLayoutProperty('flow', 'visibility', on ? 'visible' : 'none');
  }
}
