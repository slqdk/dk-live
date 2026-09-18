import { subscribe } from './feed.js';
import { prefs } from '../prefs.js';

const POLL_MS = 5 * 60_000;
const STEP_MS = 600; // playback speed

// RainViewer composite radar: the newest frame by default, plus a player that steps through
// the past two hours (10-min frames) and the 30-min nowcast. Every frame is its own raster
// layer, added once and shown/hidden, so scrubbing is instant after the first pass.
export class RadarLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.visible = true;
    this.host = null;
    this.frames = []; // past + nowcast, oldest first
    this.index = -1; // currently shown frame
    this.timer = null;
    this.ctl = document.getElementById('radar-ctl');
  }

  async init() {
    this.initControls();
    subscribe(
      '/api/radar',
      POLL_MS,
      (data) => {
        this.error = data.status.startsWith('failed') ? `radar: ${data.status}` : null;
        if (!data.host || !data.frames?.length) return;
        this.host = data.host;
        const frames = [...data.frames, ...(data.nowcast ?? [])];
        const changed = frames.at(-1)?.path !== this.frames.at(-1)?.path;
        this.frames = frames;
        this.lastPast = data.frames.length - 1;
        if (changed && !this.timer) this.show(this.lastPast); // stay on "now" unless playing
        this.updateLabel();
        this.slider.max = this.frames.length - 1;
        if (!this.timer) this.slider.value = this.lastPast;
      },
      (err) => (this.error = `radar: ${err.message}`)
    );
    setInterval(() => this.updateLabel(), 30_000);
  }

  layerId = (i) => `radar-${this.frames[i].path.replace(/[^a-z0-9]/gi, '')}`;

  ensureLayer(i) {
    const id = this.layerId(i);
    if (this.map.getLayer(id)) return id;
    const layers = this.map.getStyle().layers;
    const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;
    this.map.addSource(id, { type: 'raster', tiles: [`${this.host}${this.frames[i].path}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256, maxzoom: 7, attribution: 'Radar © RainViewer' });
    this.map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 }, layout: { visibility: this.visible ? 'visible' : 'none' } }, firstSymbol);
    return id;
  }

  show(i) {
    if (i < 0 || i >= this.frames.length || !this.host) return;
    const id = this.ensureLayer(i);
    // preload neighbours so playback doesn't stall
    if (i + 1 < this.frames.length) this.ensureLayer(i + 1);
    for (const l of this.map.getStyle().layers) if (l.id.startsWith('radar-') && l.id !== id) this.map.setPaintProperty(l.id, 'raster-opacity', 0);
    this.map.setPaintProperty(id, 'raster-opacity', prefs.radarOpacity ?? 0.55);
    this.index = i;
    this.slider.value = i;
    this.updateLabel();
    // drop layers for frames that fell off the end of the feed
    const keep = new Set(this.frames.map((_, k) => this.layerId(k)));
    for (const l of this.map.getStyle().layers) if (l.id.startsWith('radar-') && !keep.has(l.id)) { this.map.removeLayer(l.id); this.map.removeSource(l.id); }
  }

  // One pass: oldest frame → newest → nowcast, then back to the newest real image.
  play() {
    if (this.timer) return; // already playing
    this.playBtn.disabled = true;
    for (let k = 0; k < this.frames.length; k++) this.ensureLayer(k);
    let i = 0;
    this.show(i);
    this.timer = setInterval(() => {
      i++;
      if (i >= this.frames.length) return this.stop();
      this.show(i);
    }, STEP_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.playBtn.disabled = false;
    this.show(this.lastPast);
  }

  updateLabel() {
    const f = this.frames[this.index];
    if (!f) return;
    const t = new Date(f.time).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    const ago = Math.round((Date.now() - f.time) / 60_000);
    const rel = f.nowcast ? `prognose +${-ago} min` : ago <= 0 ? 'nu' : `${ago} min siden`;
    this.count = `kl. ${t}`;
    this.label.innerHTML = `<b>${t}</b> · ${rel}`;
    this.label.classList.toggle('future', Boolean(f.nowcast));
    const latest = this.frames[this.lastPast];
    this.delay.textContent = latest ? `nyeste billede ${Math.round((Date.now() - latest.time) / 60_000)} min gammelt` : '';
  }

  initControls() {
    this.ctl.innerHTML = `
      <button id="radar-play" title="Afspil de sidste 2 timer + prognose">▶</button>
      <input id="radar-slider" type="range" min="0" max="0" value="0" step="1" aria-label="Radarbillede" />
      <span id="radar-label"></span>
      <span id="radar-delay" class="muted"></span>`;
    this.playBtn = this.ctl.querySelector('#radar-play');
    this.slider = this.ctl.querySelector('#radar-slider');
    this.label = this.ctl.querySelector('#radar-label');
    this.delay = this.ctl.querySelector('#radar-delay');
    this.playBtn.addEventListener('click', () => this.play());
    this.slider.addEventListener('input', () => {
      if (this.timer) { clearInterval(this.timer); this.timer = null; this.playBtn.disabled = false; }
      this.show(Number(this.slider.value));
    });
    this.ctl.hidden = !this.visible;
  }

  applyPrefs() {
    if (this.index >= 0) this.map.setPaintProperty(this.layerId(this.index), 'raster-opacity', prefs.radarOpacity ?? 0.55);
  }

  setVisible(on) {
    this.visible = on;
    this.ctl.hidden = !on;
    if (!on && this.timer) this.stop();
    for (const l of this.map.getStyle().layers) if (l.id.startsWith('radar-')) this.map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none');
  }
}
