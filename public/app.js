import { FlightsLayer } from './layers/flights.js';
import { ShipsLayer } from './layers/ships.js';
import { AlarmsLayer } from './layers/alarms.js';
import { TrafficLayer } from './layers/traffic.js';
import { RadarLayer } from './layers/radar.js';
import { LightningLayer } from './layers/lightning.js';
import { TrainsLayer } from './layers/trains.js';
import { AutobahnLayer } from './layers/autobahn.js';
import { WebcamsLayer } from './layers/webcams.js';
import { FlowLayer } from './layers/flow.js';
import { AirportsLayer } from './layers/airports.js';
import { initEnergy } from './energy.js';
import { initSettings } from './settings.js';
import { initStats } from './stats.js';
import { prefs, loadPrefs, onPrefs } from './prefs.js';

// Keep in sync with server/bbox.js
export const BBOX = [[7.5, 53.3], [13.0, 57.9]];
const PAD = 1.5; // how far past the bbox the user may pan

await loadPrefs();
const homeBounds = () => prefs.homeView ?? BBOX;

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark', // free, no key
  bounds: homeBounds(),
  fitBoundsOptions: { padding: 20 },
  maxBounds: [[BBOX[0][0] - PAD, BBOX[0][1] - PAD], [BBOX[1][0] + PAD, BBOX[1][1] + PAD]],
  minZoom: 4.5,
  maxZoom: 17,
  fadeDuration: 0, // no label cross-fades → fewer continuous redraws
  refreshExpiredTiles: false,
  attributionControl: { compact: true },
});
window.map = map; // handy for debugging in the console
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

const statusEl = document.querySelector('[data-status]');
const status = (text, err = false) => {
  statusEl.textContent = text;
  statusEl.parentElement.classList.toggle('err', err);
};

map.on('load', async () => {
  applyTheme(map, prefs.landBrightness);
  // Order matters: earlier layers draw underneath later ones.
  const layers = {
    radar: new RadarLayer(map),
    flow: new FlowLayer(map),
    lightning: new LightningLayer(map),
    traffic: new TrafficLayer(map),
    autobahn: new AutobahnLayer(map),
    webcams: new WebcamsLayer(map),
    trains: new TrainsLayer(map),
    ships: new ShipsLayer(map),
    alarms: new AlarmsLayer(map),
    // reads the aircraft lists lazily (at popup time), so the reference is fine before they exist
    airports: new AirportsLayer(map, () => [...layers.flights.aircraft, ...layers.military.aircraft]),
    flights: new FlightsLayer(map, { military: false }),
    military: new FlightsLayer(map, { military: true }),
  };
  for (const l of Object.values(layers)) await l.init();

  onPrefs((p, patch) => {
    for (const l of Object.values(layers)) l.applyPrefs?.(p, patch);
    if ('landBrightness' in patch) applyTheme(map, p.landBrightness);
  });

  // Toggles — remembered per browser
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('dk-live-layers') ?? '{}'); } catch {}
  document.querySelectorAll('.layer').forEach((row) => {
    const key = row.dataset.layer;
    const input = row.querySelector('input');
    if (key in saved) input.checked = saved[key];
    if (layers[key]) layers[key].setVisible(input.checked);
    input.addEventListener('change', (e) => {
      layers[key]?.setVisible(e.target.checked);
      saved[key] = e.target.checked;
      localStorage.setItem('dk-live-layers', JSON.stringify(saved));
    });
  });

  // Counts + status
  const counts = Object.fromEntries([...document.querySelectorAll('[data-count]')].map((el) => [el.dataset.count, el]));
  setInterval(() => {
    for (const [k, el] of Object.entries(counts)) el.textContent = layers[k]?.count ?? '–';
    const fails = Object.values(layers).filter((l) => l.error).map((l) => l.error);
    status(fails.length ? fails[0] : `opdateret ${new Date().toLocaleTimeString('da-DK')}`, fails.length > 0);
  }, 2000);

  // Recent alarms live in the Beredskabsalarmer panel; the count in Datalag opens it too
  const countEl = document.querySelector('[data-layer="alarms"] .count');
  countEl.id = 'stats-count';
  countEl.addEventListener('click', (e) => e.preventDefault());
  layers.alarms.onUpdate = (alarms) => renderAlarmList(alarms, document.getElementById('recent-alarms'));

  initEnergy();
  initSettings(map, BBOX);
  initStats();
  document.getElementById('stats-count').addEventListener('click', (e) => e.preventDefault(), true);

  const layersMenu = document.getElementById('layers');
  const layersToggle = document.getElementById('layers-toggle');
  layersToggle.addEventListener('click', () => {
    const open = layersMenu.hidden;
    layersMenu.hidden = !open;
    layersToggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#layers-menu') && !layersMenu.hidden) {
      layersMenu.hidden = true;
      layersToggle.setAttribute('aria-expanded', 'false');
    }
  });
  document.getElementById('reset').addEventListener('click', () => map.fitBounds(homeBounds(), { padding: 20, duration: 900 }));
});

// Alarm list ----------------------------------------------------------
function renderAlarmList(alarms, ol) {
  ol.replaceChildren(
    ...alarms.slice(0, 60).map((a) => {
      const li = document.createElement('li');
      if (!a.lat) li.className = 'nogeo';
      const t = new Date(a.time).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
      li.innerHTML = `<span class="when">${t}</span><span class="where">${esc(a.station)}</span><span class="what">${esc(a.message)}</span>`;
      if (a.lat) li.addEventListener('click', () => map.flyTo({ center: [a.lon, a.lat], zoom: 11, duration: 900 }));
      return li;
    })
  );
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One popup at a time, always fully on screen.
// Opening closes the previous one; after content renders (and again when a photo arrives)
// the map is nudged so the popup clears the edges and the panels that overlay the map.
let openPopup = null;
export class SmartPopup extends maplibregl.Popup {
  constructor(options = {}) {
    super({ closeOnClick: true, maxWidth: '340px', ...options });
    this.on('close', () => { if (openPopup === this) openPopup = null; });
  }
  addTo(map) {
    if (openPopup && openPopup !== this) openPopup.remove();
    openPopup = this;
    super.addTo(map);
    this.fit();
    return this;
  }
  setHTML(html) {
    super.setHTML(html);
    if (this._map) this.fit();
    return this;
  }
  fit() {
    const map = this._map;
    if (!map) return;
    // Phone: the popup is a fixed bottom sheet (see style.css), nothing to fit.
    if (window.innerWidth <= 640 || prefs.popupPan === false) return;
    requestAnimationFrame(() => {
      const el = this.getElement();
      if (!el || !this._map) return;
      const r = el.getBoundingClientRect();
      const c = map.getContainer().getBoundingClientRect();
      const pad = 10;
      const visible = (id) => {
        const n = document.getElementById(id);
        if (!n || n.hidden) return null;
        const b = n.getBoundingClientRect();
        return b.width && b.height ? b : null;
      };
      const mobile = window.innerWidth <= 640;
      const energy = visible('energy');
      const settings = visible('settings');
      // free area for the popup
      let left = c.left + pad, right = c.right - pad, top = c.top + 60, bottom = c.bottom - pad;
      if (energy && !mobile) left = Math.max(left, energy.right + pad);
      if (energy && mobile) top = Math.max(top, energy.bottom + pad);
      if (settings) right = Math.min(right, settings.left - pad);
      // if the free area is narrower than the popup, ignore the panels and use the container
      if (right - left < r.width) { left = c.left + pad; right = c.right - pad; }
      let dx = 0, dy = 0;
      if (r.left < left) dx = left - r.left;
      else if (r.right > right) dx = right - r.right;
      if (r.top < top) dy = top - r.top;
      else if (r.bottom > bottom) dy = bottom - r.bottom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([-dx, -dy], { duration: 250 });
    });
  }
}

// Fetch a photo for an open popup and slot it in under the title (silently skips if none).
export async function loadPhoto(popup, url) {
  try {
    const r = await (await fetch(url)).json();
    const slot = popup.getElement()?.querySelector('.photo');
    if (!slot || !r.thumb) return;
    const credit = [r.credit && `© ${esc(r.credit)}`, r.license, r.source].filter(Boolean).join(' · ');
    slot.innerHTML = `<a href="${esc(r.link ?? r.thumb)}" target="_blank" rel="noopener"><img src="${esc(r.thumb)}" alt="" loading="lazy" /></a>
      <div class="credit">${credit}${r.uncertain ? ' · <span title="Fundet på navn – kan være et andet skib med samme navn">navnematch</span>' : ''}</div>`;
    const img = slot.querySelector('img');
    img.addEventListener('load', () => popup.fit?.(), { once: true });
  } catch {}
}

// Shared icon helper: draws a shape into a canvas and registers it with the map.
export function addShapeIcon(map, name, color, draw, size = 32) {
  if (map.hasImage(name)) return;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.5;
  draw(ctx, size);
  ctx.fill();
  ctx.stroke();
  map.addImage(name, ctx.getImageData(0, 0, size, size), { pixelRatio: 1.25 });
}

// Basemap theme: OpenFreeMap "dark" is near-black everywhere. Lift land, deepen water,
// brighten roads — closer to Google Maps dark mode. Layer ids come from the style, so
// match by pattern and skip anything that doesn't fit.
function applyTheme(map, brightness = 0.5) {
  // brightness 0..1 → shift every override's lightness by −20 … +20 points
  const delta = (brightness - 0.5) * 40;
  const adj = (hex) => {
    let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, sat = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    l = Math.min(1, Math.max(0, l + delta / 100));
    const f = (n) => { const k = (n + h * 12) % 12; const a = sat * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  const set = (id, prop, val) => { try { map.setPaintProperty(id, prop, typeof val === 'string' && val.startsWith('#') && !prop.startsWith('text') ? adj(val) : val); } catch {} };
  for (const l of map.getStyle().layers) {
    const id = l.id.toLowerCase();
    if (l.type === 'background') set(l.id, 'background-color', '#2f3b4c');
    if (l.type === 'fill' && id.includes('water')) set(l.id, 'fill-color', '#15263c');
    if (l.type === 'fill' && (id.includes('park') || id.includes('wood') || id.includes('grass') || id.includes('forest'))) set(l.id, 'fill-color', '#2f4540');
    if (l.type === 'fill' && (id.includes('residential') || id.includes('urban') || id.includes('building'))) set(l.id, 'fill-color', '#3a4758');
    if (l.type === 'line' && id.includes('boundary')) { set(l.id, 'line-color', '#7f92ad'); set(l.id, 'line-opacity', 0.9); }
    if (l.type === 'line' && id.includes('casing')) continue;
    if (l.type === 'line' && (id.includes('motorway') || id.includes('trunk'))) set(l.id, 'line-color', '#5f7a9c');
    else if (l.type === 'line' && (id.includes('primary') || id.includes('secondary'))) set(l.id, 'line-color', '#4b5d74');
    else if (l.type === 'line' && (id.includes('highway') || id.includes('road') || id.includes('minor'))) set(l.id, 'line-color', '#404e60');
    if (l.type === 'line' && id.includes('rail')) set(l.id, 'line-color', '#55607a');
    if (l.type === 'symbol') { set(l.id, 'text-color', '#dbe4f0'); set(l.id, 'text-halo-color', '#1a2433'); }
  }
}

