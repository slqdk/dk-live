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
    // Only fire when the click didn't hit a marker layer
    map.on('click', (e) => {
      if (!this.enabled) return;
      const hits = map.queryRenderedFeatures(e.point).filter((f) => /^(flights|military|ships|airports|webcams|alarms|traffic|autobahn|trains|lightning)-/.test(f.layer.id));
      if (hits.length) return;
      this.show(e.lngLat);
    });
    this.count = 'klik på kortet';
  }

  async show(lngLat) {
    const popup = new SmartPopup({ offset: 6, maxWidth: '360px' })
      .setLngLat(lngLat)
      .setHTML('<div class="popup forecast"><h3>Vejr her</h3><p class="muted">Henter…</p></div>')
      .addTo(this.map);
    try {
      const d = await (await fetch(`/api/forecast?lat=${lngLat.lat.toFixed(4)}&lon=${lngLat.lng.toFixed(4)}`)).json();
      if (d.error) throw new Error(d.error);
      popup.setHTML(this.render(d));
      popup.getElement().querySelector('[data-tab]')?.closest('.tabs')?.addEventListener('click', (e) => {
        const t = e.target.dataset.tab;
        if (!t) return;
        const root = popup.getElement();
        for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === t);
        for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t;
        popup.fit();
      });
    } catch (err) {
      popup.setHTML(`<div class="popup forecast"><h3>Vejr her</h3><p class="err">${esc(err.message)}</p></div>`);
    }
  }

  render(d) {
    const c = d.current ?? {};
    const [txt, icon] = wmo(c.weather_code);
    const rain = d.minutely.filter((m) => Date.parse(m.time) >= Date.now() - 900_000).slice(0, 24);
    const rainMax = Math.max(0.4, ...rain.map((m) => m.precipitation ?? 0));
    const soon = rain.find((m) => (m.precipitation ?? 0) > 0.05);
    const nextRain = soon ? `Nedbør fra ca. ${hhmm(soon.time)}` : 'Ingen nedbør de næste 6 timer';

    const hours = d.hourly.filter((h) => Date.parse(h.time) >= Date.now() - 1800_000).slice(0, 24);
    const hMax = Math.max(0.4, ...hours.map((h) => h.precipitation ?? 0));

    const bar = (v, max, cls) => `<span class="track"><span class="fill ${cls}" style="height:${Math.max(2, ((v ?? 0) / max) * 100)}%"></span></span>`;

    return `<div class="popup forecast">
      <h3>${icon} ${esc(txt)}</h3>
      <div class="now">
        <div class="temp">${num(c.temperature_2m, '°C', 1)}</div>
        <dl>
          <dt>Føles som</dt><dd>${num(c.apparent_temperature, '°C', 1)}</dd>
          <dt>Vind</dt><dd>${num(c.wind_speed_10m, 'm/s', 1)} ${dir(c.wind_direction_10m)}${c.wind_gusts_10m ? ` · stød ${num(c.wind_gusts_10m, 'm/s', 1)}` : ''}</dd>
          <dt>Skyer</dt><dd>${num(c.cloud_cover, '%')}</dd>
          <dt>Tryk</dt><dd>${num(c.pressure_msl, 'hPa')}</dd>
        </dl>
      </div>
      <p class="lead">${esc(nextRain)}</p>
      <div class="tabs">
        <button type="button" data-tab="min" class="active">6 timer</button>
        <button type="button" data-tab="hour">24 timer</button>
        <button type="button" data-tab="days">3 dage</button>
      </div>
      <div data-pane="min" class="chart">
        ${rain.map((m) => `<span class="col" title="${hhmm(m.time)} · ${num(m.precipitation, 'mm', 1)}">${bar(m.precipitation, rainMax, 'rain')}<i>${m.time.slice(14, 16) === '00' ? hhmm(m.time) : ''}</i></span>`).join('')}
      </div>
      <div data-pane="hour" class="chart" hidden>
        ${hours.map((h) => `<span class="col" title="${hhmm(h.time)} · ${num(h.temperature_2m, '°C', 1)} · ${num(h.precipitation, 'mm', 1)} · ${h.precipitation_probability ?? 0} %">${bar(h.precipitation, hMax, 'rain')}<b>${h.temperature_2m != null ? Math.round(h.temperature_2m) : ''}</b><i>${['00', '06', '12', '18'].includes(h.time.slice(11, 13)) ? hhmm(h.time) : ''}</i></span>`).join('')}
      </div>
      <div data-pane="days" hidden>
        <table class="days">${d.daily
          .map((day) => {
            const [t, i] = wmo(day.weather_code);
            const name = new Date(day.time).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
            return `<tr><th>${name}</th><td>${i} ${esc(t)}</td><td class="n">${Math.round(day.temperature_2m_min)}/${Math.round(day.temperature_2m_max)}°</td><td class="n">${num(day.precipitation_sum, 'mm', 1)}</td><td class="n">${day.precipitation_probability_max ?? 0} %</td></tr>`;
          })
          .join('')}</table>
      </div>
      <div class="links"><span class="muted">Open-Meteo · ${d.elevation != null ? `${Math.round(d.elevation)} m o.h.` : ''}</span></div>
    </div>`;
  }

  setVisible(on) {
    this.enabled = on;
    this.count = on ? 'klik på kortet' : 'fra';
  }
}
