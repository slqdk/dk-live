import { subscribe } from './feed.js';
import { addShapeIcon, esc, SmartPopup } from '../app.js';
import { prefs } from '../prefs.js';

const POLL_MS = 15 * 60_000;
const COLOR = { autobahn: '#b58cff', windy: '#e0a3ff', egen: '#ffd24a' };

// Webcams from three sources (German motorways, Windy, your own list) in one layer.
// Images load when the popup opens: Autobahn stills get a cache-buster, Windy needs a fresh
// tokenised URL from the server, own cameras use whatever URL you gave them.
export class WebcamsLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.items = [];
  }

  async init() {
    const map = this.map;
    const camera = (ctx, s) => {
      const u = s / 32;
      ctx.beginPath();
      ctx.roundRect(-8 * u, -5 * u, 11 * u, 10 * u, 1.5 * u);
      ctx.moveTo(4 * u, -1 * u);
      ctx.lineTo(9 * u, -5 * u);
      ctx.lineTo(9 * u, 5 * u);
      ctx.lineTo(4 * u, 1 * u);
      ctx.closePath();
    };
    for (const [src, color] of Object.entries(COLOR)) addShapeIcon(map, `webcam-${src}`, color, camera, 22);

    map.addSource('webcams', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'webcams-icon',
      type: 'symbol',
      source: 'webcams',
      layout: {
        'icon-image': ['concat', 'webcam-', ['get', 'source']],
        'icon-size': this.sizeExpr(),
        'icon-allow-overlap': true,
        'text-field': ['step', ['zoom'], '', 9, ['get', 'label']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
        'symbol-sort-key': ['match', ['get', 'source'], 'egen', 0, 'windy', 1, 2],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#1a2433', 'text-halo-width': 1.2 },
    });
    map.addLayer({
      id: 'webcams-hit',
      type: 'circle',
      source: 'webcams',
      paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
    });

    map.on('click', 'webcams-hit', (e) => this.popup(e));
    map.on('mouseenter', 'webcams-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'webcams-hit', () => (map.getCanvas().style.cursor = ''));

    subscribe(
      '/api/webcams',
      POLL_MS,
      (data) => {
        this.items = data.items;
        this.count = data.items.length;
        this.error = /failed/.test(data.status) ? `webcam: ${data.status}` : null;
        map.getSource('webcams').setData({
          type: 'FeatureCollection',
          features: data.items.map((c) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
            properties: { id: c.id, source: c.source, color: COLOR[c.source], label: c.source === 'autobahn' ? `${c.road} ${c.subtitle || ''}`.trim() : c.name },
          })),
        });
      },
      (err) => (this.error = `webcam: ${err.message}`)
    );
  }

  sizeExpr() {
    const k = prefs.webcamScale ?? 1;
    return ['interpolate', ['linear'], ['zoom'], 5, 0.6 * k, 9, 0.9 * k, 12, 1.2 * k];
  }
  applyPrefs() {
    this.map.setLayoutProperty('webcams-icon', 'icon-size', this.sizeExpr());
  }

  async popup(e) {
    const c = this.items.find((x) => x.id === e.features[0].properties.id);
    if (!c) return;
    const popup = new SmartPopup({ offset: 10, maxWidth: '380px' }).setLngLat([c.lon, c.lat]).addTo(this.map);
    const meta = [c.city, c.country].filter(Boolean).join(', ');
    const credit = { autobahn: 'Autobahn GmbH', windy: 'webcams by Windy', egen: 'egen kilde' }[c.source];
    const shell = (body) =>
      `<div class="popup"><h3>${esc(c.name)}</h3>${meta ? `<p class="muted" style="margin:0 0 4px">${esc(meta)}</p>` : ''}${body}
       ${c.note ? `<p class="muted" style="margin:4px 0 0">${esc(c.note)}</p>` : ''}
       <div class="links"><span class="muted">${credit}</span>${c.link ? ` · <a class="ext" href="${esc(c.link)}" target="_blank" rel="noopener">Åbn ↗</a>` : ''}</div></div>`;

    let image = c.image ?? null;
    let live = null;
    if (c.source === 'autobahn' && image) image = `${image}${image.includes('?') ? '&' : '?'}t=${Date.now()}`;
    if (c.source === 'windy') {
      popup.setHTML(shell('<p class="muted">Henter billede…</p>'));
      try {
        const r = await (await fetch(`/api/webcams/windy/${c.windyId}`)).json();
        image = r.image ?? null;
        live = r.live ?? r.day ?? null;
      } catch {}
    }
    const img = image ? `<img src="${esc(image)}" alt="${esc(c.name)}" class="cam" loading="lazy" />` : '<p class="muted">Ingen stillbillede – åbn kameraet via linket.</p>';
    const liveLink = live ? `<a class="ext" href="${esc(live)}" target="_blank" rel="noopener">Se live / dagens time-lapse ↗</a>` : '';
    popup.setHTML(shell(`${img}${liveLink}`));
    popup.getElement()?.querySelector('img.cam')?.addEventListener('load', () => popup.fit(), { once: true });
  }

  setVisible(on) {
    for (const id of ['webcams-icon', 'webcams-hit']) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
