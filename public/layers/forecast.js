import { SmartPopup, esc } from '../app.js';

// Click anywhere on the map (not on a marker) for the weather at that point.
// Open-Meteo, no key: current conditions, 15-min precipitation for 6 hours, hourly for 2 days.
const WMO = {
  0: ['Klart', '☀'], 1: ['Overvejende klart', '🌤'], 2: ['Delvist skyet', '⛅'], 3: ['Overskyet', '☁'],
  45: ['Tåge', '🌫'], 48: ['Rimtåge', '🌫'],
  51: ['Let støvregn', '🌦'], 53: ['Støvregn', '🌦'], 55: ['Kraftig støvregn', '🌧'],
  56: ['Isslag, let', '🌧'], 57: ['Isslag', '🌧'],
  61: ['Let regn', '🌦'], 63: ['Regn', '🌧'], 65: ['Kraftig regn', '🌧'],
  66: ['Isregn, let', '🌧'], 67: ['Isregn', '🌧'],
  71: ['Let snefald', '🌨'], 73: ['Snefald', '🌨'], 75: ['Kraftigt snefald', '❄'], 77: ['Snekorn', '🌨'],
  80: ['Regnbyger', '🌦'], 81: ['Byger', '🌧'], 82: ['Kraftige byger', '⛈'],
  85: ['Snebyger', '🌨'], 86: ['Kraftige snebyger', '❄'],
  95: ['Tordenvejr', '⛈'], 96: ['Torden med hagl', '⛈'], 99: ['Kraftig torden med hagl', '⛈'],
};
const COMPASS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'];

const wmo = (c) => WMO[c] ?? ['–', ''];
const dir = (d) => (d == null ? '' : COMPASS[Math.round(d / 22.5) % 16]);
const hhmm = (iso) => iso.slice(11, 16);
// Rain (bars, left axis in mm) and optionally temperature (line, right axis) as one SVG.
// Scale snaps to a readable step so a 0,1 mm drizzle doesn't look like a downpour.
const STEPS = [0.5, 1, 2, 5, 10, 20, 50];
function chart(rows, { step, labelEvery, temp = false }) {
  if (!rows.length) return '<p class="muted">Ingen data.</p>';
  const W = 520, H = 120, padL = 44, padR = temp ? 30 : 8, padT = 12, padB = 20;
  const iw = W - padL - padR, ih = H - padT - padB;
  const rainMax = Math.max(...rows.map((r) => r.precipitation ?? 0));
  const top = STEPS.find((v) => v >= rainMax * 1.15) ?? STEPS.at(-1);
  const bw = iw / rows.length;
  const x = (i) => padL + i * bw;
  const yRain = (v) => padT + ih - Math.min(1, (v ?? 0) / top) * ih;

  const temps = rows.map((r) => r.temperature_2m).filter((v) => v != null);
  const tMin = temps.length ? Math.min(...temps) : 0;
  const tMax = temps.length ? Math.max(...temps) : 1;
  const tSpan = Math.max(1, tMax - tMin);
  const yTemp = (v) => padT + ih - ((v - tMin) / tSpan) * (ih * 0.8) - ih * 0.1;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = padT + ih - f * ih;
      const label = f === 0.25 || f === 0.75 ? '' : f === 1 ? `${String(+(top).toFixed(2)).replace('.', ',')} mm` : f === 0 ? '0' : String(+(top * f).toFixed(2)).replace('.', ',');
      return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="grid${f === 0 ? ' base' : ''}" />
        ${label ? `<text x="${padL - 6}" y="${y + 4}" class="ax" text-anchor="end">${label}</text>` : ''}`;
    })
    .join('');

  const bars = rows
    .map((r, i) => {
      const v = r.precipitation ?? 0;
      const y = yRain(v);
      const h = padT + ih - y;
      const prob = r.precipitation_probability;
      return `<g class="bar"><title>${hhmm(r.time)} · ${v.toFixed(1).replace('.', ',')} mm${prob != null ? ` · ${prob} %` : ''}${r.temperature_2m != null ? ` · ${r.temperature_2m.toFixed(1).replace('.', ',')} °C` : ''}</title>
        <rect x="${x(i) + bw * 0.12}" y="${padT}" width="${bw * 0.76}" height="${ih}" class="hit" />
        ${v > 0 ? `<rect x="${x(i) + bw * 0.12}" y="${y}" width="${bw * 0.76}" height="${Math.max(1.5, h)}" rx="1" class="rain" />` : ''}</g>`;
    })
    .join('');

  const line = temp && temps.length
    ? `<polyline class="temp" points="${rows.map((r, i) => (r.temperature_2m == null ? '' : `${(x(i) + bw / 2).toFixed(1)},${yTemp(r.temperature_2m).toFixed(1)}`)).filter(Boolean).join(' ')}" />
       <text x="${W - padR + 4}" y="${yTemp(rows.at(-1).temperature_2m) + 4}" class="ax temp">${Math.round(rows.at(-1).temperature_2m)}°</text>`
    : '';

  const labels = rows
    .map((r, i) => (i % labelEvery === 0 ? `<text x="${x(i) + bw / 2}" y="${H - 5}" class="ax" text-anchor="middle">${hhmm(r.time)}</text>` : ''))
    .join('');

  const dry = rainMax === 0 ? `<text x="${padL + iw / 2}" y="${padT + ih / 2 + 4}" class="dry" text-anchor="middle">ingen nedbør</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" class="fchart" preserveAspectRatio="none">${grid}${bars}${line}${dry}${labels}
</svg>`;
}

const num = (v, unit, dec = 0) => (v == null ? '–' : `${v.toFixed(dec).replace('.', ',')} ${unit}`);

export class ForecastLayer {
  constructor(map) {
    this.map = map;
    this.count = null;
    this.error = null;
    this.enabled = true;
  }

  async init() {
    const map = this.map;
    this.btn = document.getElementById('weather-open');
    this.hint = document.getElementById('weather-hint');

    // Button: show the weather where the map is centred. Press again (or the hint) to pick a spot.
    this.btn.addEventListener('click', () => {
      if (this.picking) return this.setPicking(false);
      this.show(map.getCenter());
    });
    this.hint.addEventListener('click', () => this.setPicking(false));
    this.btn.addEventListener('dblclick', () => this.setPicking(true));

    // Pick mode is also reachable from the popup itself
    map.on('click', (e) => {
      if (!this.picking) return;
      this.setPicking(false);
      this.show(e.lngLat);
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && this.setPicking(false));
  }

  setPicking(on) {
    this.picking = on;
    this.hint.hidden = !on;
    this.btn.classList.toggle('active', on);
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
  }

  async show(lngLat) {
    const popup = new SmartPopup({ offset: 6, maxWidth: '560px', className: 'forecast-popup' })
      .setLngLat(lngLat)
      .setHTML('<div class="popup forecast"><h3>Vejr</h3><p class="muted">Henter…</p></div>')
      .addTo(this.map);
    try {
      const d = await (await fetch(`/api/forecast?lat=${lngLat.lat.toFixed(4)}&lon=${lngLat.lng.toFixed(4)}`)).json();
      if (d.error) throw new Error(d.error);
      popup.setHTML(this.render(d));
      popup.getElement().querySelector('.pick')?.addEventListener('click', () => {
        popup.remove();
        this.setPicking(true);
      });
      popup.getElement().querySelector('[data-tab]')?.closest('.tabs')?.addEventListener('click', (e) => {
        const t = e.target.dataset.tab;
        if (!t) return;
        const root = popup.getElement();
        for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === t);
        for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t;
        popup.fit();
      });
    } catch (err) {
      popup.setHTML(`<div class="popup forecast"><h3>Vejr</h3><p class="err">${esc(err.message)}</p></div>`);
    }
  }

  render(d) {
    const c = d.current ?? {};
    const [txt, icon] = wmo(c.weather_code);
    const rain = d.minutely.filter((m) => Date.parse(m.time) >= Date.now() - 900_000).slice(0, 24);
    const soon = rain.find((m) => (m.precipitation ?? 0) > 0.05);
    const nextRain = soon ? `Nedbør fra ca. ${hhmm(soon.time)}` : 'Ingen nedbør de næste 6 timer';
    const hours = d.hourly.filter((h) => Date.parse(h.time) >= Date.now() - 1800_000).slice(0, 24);
    const coords = `${Math.abs(d.lat).toFixed(3)}° ${d.lat >= 0 ? 'N' : 'S'}, ${Math.abs(d.lon).toFixed(3)}° ${d.lon >= 0 ? 'Ø' : 'V'}`;

    const gust = c.wind_gusts_10m ? ` (${num(c.wind_gusts_10m, '', 0).trim()})` : '';
    return `<div class="popup forecast">
      <h3>${icon} ${esc(d.place ?? 'Vejr her')}</h3>
      <div class="now">
        <span class="temp">${c.temperature_2m != null ? `${c.temperature_2m.toFixed(1).replace('.', ',')}°` : '–'}</span>
        <span class="desc">${esc(txt)}<br><span class="muted">føles ${num(c.apparent_temperature, '°', 0).replace(' °', '°')}</span></span>
        <span class="stat" title="Vind (stød) og retning">💨 ${c.wind_speed_10m != null ? c.wind_speed_10m.toFixed(0) : '–'}${gust} m/s ${dir(c.wind_direction_10m)}</span>
        <span class="stat" title="Skydække">☁ ${num(c.cloud_cover, '%')}</span>
        <span class="stat" title="Lufttryk">${num(c.pressure_msl, 'hPa')}</span>
      </div>
      <div class="bar">
        <span class="lead">${esc(nextRain)}</span>
        <div class="tabs">
          <button type="button" data-tab="min" class="active">6 t</button>
          <button type="button" data-tab="hour">24 t</button>
          <button type="button" data-tab="days">3 d</button>
        </div>
      </div>
      <div data-pane="min">${chart(rain, { step: 15, labelEvery: 4 })}</div>
      <div data-pane="hour" hidden>${chart(hours, { step: 60, labelEvery: 3, temp: true })}</div>
      <div data-pane="days" hidden>
        <table class="days">${d.daily
          .map((day) => {
            const [t, i] = wmo(day.weather_code);
            const name = new Date(day.time).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
            return `<tr><th>${name}</th><td>${i} ${esc(t)}</td><td class="n">${Math.round(day.temperature_2m_min)}/${Math.round(day.temperature_2m_max)}°</td><td class="n">${num(day.precipitation_sum, 'mm', 1)}</td><td class="n">${day.precipitation_probability_max ?? 0} %</td></tr>`;
          })
          .join('')}</table>
      </div>
      <div class="foot"><button type="button" class="pick">Vælg andet sted</button><span class="muted">${coords} · Open-Meteo</span></div>
    </div>`;
  }

  setVisible(on) {
    this.enabled = on;
    document.getElementById('weather-open').hidden = !on;
    if (!on) this.setPicking(false);
  }
}
