// Live power panel for DK1 (Jutland/Funen): production snapshot plus every remaining
// day-ahead price hour, as a bar chart down the left side.
import { prefs, onPrefs } from './prefs.js';

const POLL_MS = 120_000;
let lastData = null;

const mw = (v) => (v == null ? '–' : `${Math.round(v).toLocaleString('da-DK')} MW`);
const kr = (v) => v.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (t) => new Date(t).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
const dayName = (t) => {
  const d = new Date(t);
  const today = new Date();
  const diff = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return 'I dag';
  if (diff === 1) return 'I morgen';
  return new Date(t).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' });
};

export function initEnergy() {
  const el = document.getElementById('energy');
  const toggle = document.querySelector('[data-layer="energy"] input');
  const openBtn = document.getElementById('energy-open');
  const mobile = () => window.matchMedia('(max-width: 640px)').matches;
  const sync = () => {
    el.hidden = !toggle.checked;
    openBtn.hidden = !toggle.checked;
  };
  toggle.addEventListener('change', sync);
  sync();
  // Phone: the panel is behind the "⚡ El" button and opens as an overlay
  openBtn.addEventListener('click', () => {
    el.classList.toggle('mobile-open');
    el.classList.remove('collapsed');
  });
  // Header: collapses on desktop, closes the overlay on a phone
  el.addEventListener('click', (e) => {
    if (!e.target.closest('header')) return;
    if (mobile()) el.classList.remove('mobile-open');
    else el.classList.toggle('collapsed');
  });

  onPrefs((_, patch) => {
    if ('hourlyPrices' in patch && lastData) render(el, lastData);
  });
  const tick = async () => {
    try {
      const data = await (await fetch('/api/energy', { cache: 'no-store' })).json();
      lastData = data.now ? data : null;
      render(el, lastData, data.status);
    } catch (err) {
      render(el, null, err.message);
    }
  };
  tick();
  setInterval(tick, POLL_MS);
}

function render(el, data, error) {
  if (!data) {
    el.innerHTML = `<header><h2>Strøm DK1</h2></header><p class="err">${error ?? 'ingen data'}</p>`;
    return;
  }
  const n = data.now;
  const green = n.wind + n.solar;
  const total = green + n.central + n.local;
  const share = total > 0 ? Math.round((green / total) * 100) : null;
  const flow = n.exchangeSum == null ? '–' : `${n.exchangeSum > 0 ? 'import' : 'eksport'} ${mw(Math.abs(n.exchangeSum))}`;

  el.innerHTML = `
    <header>
      <h2>Strøm ${data.area ?? 'DK1'}</h2>
      <button id="energy-collapse" aria-label="Fold sammen"><span class="chev">▾</span></button>
    </header>
    <dl class="mix">
      <dt>Vind</dt><dd>${mw(n.wind)}</dd>
      <dt>Sol</dt><dd>${mw(n.solar)}</dd>
      <dt>Kraftværk</dt><dd>${mw(n.central + n.local)}</dd>
      <dt>Grøn andel</dt><dd>${share == null ? '–' : `${share} %`}</dd>
      <dt>CO₂</dt><dd>${n.co2 == null ? '–' : `${Math.round(n.co2)} g/kWh`}</dd>
      <dt>Udveksling</dt><dd>${flow}</dd>
    </dl>
    ${priceChart(data)}
    <footer>Spotpris uden afgifter, tariffer og moms · Energi Data Service</footer>`;
}

function priceChart(data) {
  let prices = data.prices ?? [];
  if (prefs.hourlyPrices) {
    const byHour = new Map();
    for (const p of prices) {
      const h = new Date(p.time).setMinutes(0, 0, 0);
      const b = byHour.get(h) ?? { time: h, sum: 0, n: 0 };
      b.sum += p.dkk;
      b.n++;
      byHour.set(h, b);
    }
    prices = [...byHour.values()].map((b) => ({ time: b.time, dkk: b.sum / b.n }));
  }
  if (!prices.length) return '<p class="err">Ingen priser endnu</p>';
  const values = prices.map((p) => p.dkk);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - Math.min(min, 0), 1);
  const nowSlot = prefs.hourlyPrices ? new Date().setMinutes(0, 0, 0) : data.price?.time ?? new Date().setMinutes(Math.floor(new Date().getMinutes() / 15) * 15, 0, 0);
  const cheapest = prices.reduce((a, b) => (b.dkk < a.dkk ? b : a));

  let lastDay = null;
  const rows = prices
    .map((p) => {
      const width = Math.max(((p.dkk - Math.min(min, 0)) / span) * 100, 1.5);
      const cls = [
        p.time === nowSlot ? 'now' : '',
        p.time === cheapest.time ? 'cheap' : '',
        p.dkk < 0 ? 'neg' : '',
      ].filter(Boolean).join(' ');
      const day = dayName(p.time);
      const header = day !== lastDay ? `<li class="day">${day}</li>` : '';
      lastDay = day;
      return `${header}
        <li class="bar ${cls}">
          <span class="t">${hhmm(p.time)}</span>
          <span class="track"><span class="fill" style="width:${width}%"></span></span>
          <span class="p">${kr(p.dkk)}</span>
        </li>`;
    })
    .join('');

  const current = data.price ? `${kr(data.price.dkk)} kr/kWh` : '–';
  return `
    <div class="prices">
      <div class="head">
        <span>Spotpris <em>kr/kWh</em></span>
        <strong>${current}</strong>
      </div>
      <ol>${rows}</ol>
      <p class="cheapest">Billigst ${dayName(cheapest.time).toLowerCase()} ${hhmm(cheapest.time)} · ${kr(cheapest.dkk)} kr</p>
    </div>`;
}
