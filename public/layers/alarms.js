import { subscribe } from './feed.js';
import { esc, SmartPopup } from '../app.js';
import { cap, prefs } from '../prefs.js';

const POLL_MS = 60_000;

export class AlarmsLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.alarms = [];
    this.onUpdate = null;
  }

  async init() {
    const map = this.map;
    map.addSource('alarms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // pulse ring (fresh alarms only)
    map.addLayer({
      id: 'alarms-pulse',
      type: 'circle',
      source: 'alarms',
      filter: ['get', 'fresh'],
      paint: { 'circle-color': '#ff5c4d', 'circle-opacity': 0.25, 'circle-radius': 10, 'circle-blur': 0.6 },
    });
    map.addLayer({
      id: 'alarms-dot',
      type: 'circle',
      source: 'alarms',
      paint: {
        'circle-color': '#ff5c4d',
        'circle-radius': ['case', ['get', 'fresh'], 6, 4],
        'circle-opacity': ['interpolate', ['linear'], ['get', 'ageMin'], 0, 1, 180, 0.9, 1440, 0.35],
        'circle-stroke-color': '#121a26',
        'circle-stroke-width': 1.5,
      },
    });

    map.addLayer({
      id: 'alarms-hit',
      type: 'circle',
      source: 'alarms',
      paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
    });
    map.addLayer({
      id: 'alarms-label',
      type: 'symbol',
      source: 'alarms',
      layout: {
        'text-field': ['step', ['zoom'], ['get', 'label1'], 8, ['get', 'label2']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 12],
        'text-offset': [0.8, 0],
        'text-anchor': 'left',
        'text-max-width': 14,
        'text-line-height': 1.15,
        'text-optional': true,
        'symbol-sort-key': ['get', 'ageMin'], // newest wins when labels collide
      },
      paint: { 'text-color': '#ff8a7e', 'text-halo-color': '#1a2433', 'text-halo-width': 1.3 },
    });

    map.on('click', 'alarms-hit', (e) => this.popup(e));
    map.on('mouseenter', 'alarms-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'alarms-hit', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/odin',
      POLL_MS,
      (data) => {
        this.alarms = data.alarms;
        this.count = data.alarms.length;
        this.error = data.status.startsWith('failed') ? `112: ${data.status}` : null;
        this.render();
        this.onUpdate?.(this.alarms);
      },
      (err) => (this.error = `112: ${err.message}`)
    );
    setInterval(() => this.render(), 30_000);

    this.setPulse(prefs.animations);
  }

  render() {
    const now = Date.now();
    // Several alarms at the same station: fan them out slightly so all are clickable
    const perStation = new Map();
    const features = this.alarms
      .filter((a) => a.lat)
      .map((a) => {
        const n = perStation.get(a.station) ?? 0;
        perStation.set(a.station, n + 1);
        const ageMin = (now - a.time) / 60_000;
        const off = n * 0.004;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [a.lon + off, a.lat + off * 0.6] },
          properties: { ...a, ageMin, fresh: ageMin < (prefs.alarmFreshMin ?? 20), label1: cap(a.message), label2: `${cap(a.message)}\n${cap(`${a.station} · ${hhmm(a.time)}`)}` },
        };
      });
    this.map.getSource('alarms').setData({ type: 'FeatureCollection', features });
  }

  applyPrefs(_, patch) {
    if ('animations' in patch) this.setPulse(patch.animations);
    this.render();
    this.onUpdate?.(this.alarms);
  }

  // Pulse = a paint-property change 8×/s, only when enabled and the page is visible.
  // Off: a static, slightly larger halo marks fresh alarms instead.
  setPulse(on) {
    clearInterval(this.pulseTimer);
    this.pulseTimer = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!on || reduced) return this.map.setPaintProperty('alarms-pulse', 'circle-radius', 13);
    let t = 0;
    this.pulseTimer = setInterval(() => {
      if (document.hidden) return;
      t += 0.35;
      this.map.setPaintProperty('alarms-pulse', 'circle-radius', 10 + 8 * Math.abs(Math.sin(t)));
    }, 125);
  }

  popup(e) {
    const p = e.features[0].properties;
    const t = new Date(Number(p.time)).toLocaleString('da-DK', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
    new SmartPopup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup"><h3>${esc(p.message)}</h3>
        <dl>
          <dt>Tid</dt><dd>${t}</dd>
          <dt>Station</dt><dd>${esc(p.station)}</dd>
          <dt>Beredskab</dt><dd>${esc(p.beredskab)}</dd>
        </dl>
        <small style="color:var(--muted)">Kilde: www.odin.dk/112puls · position = brandstation, ikke hændelsen</small></div>`
      )
      .addTo(this.map);
  }

  setVisible(on) {
    for (const id of ['alarms-pulse', 'alarms-dot', 'alarms-hit', 'alarms-label']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

const hhmm = (t) => new Date(t).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
