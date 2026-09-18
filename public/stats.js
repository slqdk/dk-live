// 112 statistics panel: one month at a time, regions as columns, headlines as rows.
import { esc } from './app.js';

const REGIONS = ['Nordjylland', 'Midtjylland', 'Sydjylland', 'Fyn', 'Sjælland', 'Hovedstaden', 'Bornholm', 'Ukendt'];
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('da-DK', { month: 'long', year: 'numeric' });

export function initStats() {
  const panel = document.getElementById('stats');
  const body = document.getElementById('stats-body');
  const title = document.getElementById('stats-month');
  let month = null;

  for (const id of ['stats-open', 'stats-top', 'stats-count']) {
    document.getElementById(id)?.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) load();
    });
  }
  document.getElementById('stats-close').addEventListener('click', () => (panel.hidden = true));
  document.getElementById('stats-prev').addEventListener('click', () => step(-1));
  document.getElementById('stats-next').addEventListener('click', () => step(1));
  document.getElementById('stats-csv').addEventListener('click', () => window.open(`/api/stats/alarms.csv${month ? `?month=${month}` : ''}`, '_blank'));

  let months = [];
  function step(d) {
    const i = months.indexOf(month) + d;
    if (i >= 0 && i < months.length) {
      month = months[i];
      load();
    }
  }

  async function load() {
    body.innerHTML = '<p class="muted">Henter…</p>';
    const data = await (await fetch(`/api/stats/alarms${month ? `?month=${month}` : ''}`, { cache: 'no-store' })).json();
    month = data.month;
    months = data.months;
    title.textContent = monthName(month);
    document.getElementById('stats-prev').disabled = months.indexOf(month) <= 0;
    document.getElementById('stats-next').disabled = months.indexOf(month) >= months.length - 1;
    render(data);
  }

  function render(data) {
    if (!data.total) {
      body.innerHTML = '<p class="muted">Ingen alarmer logget i denne måned endnu.</p>';
      return;
    }
    const regions = REGIONS.filter((r) => r !== 'Ukendt' || data.regions[r]);
    const get = (r, h) => data.regions[r]?.headlines[h] ?? 0;
    const headlines = Object.entries(data.headlines).sort((a, b) => b[1] - a[1]);
    const from = data.from ? new Date(data.from).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }) : '';
    const cell = (n) => `<td class="n">${n || '<span class="zero">·</span>'}</td>`;
    const short = { Nordjylland: 'Nord', Midtjylland: 'Midt', Sydjylland: 'Syd', Fyn: 'Fyn', Sjælland: 'Sjæl.', Hovedstaden: 'Hovedst.', Bornholm: 'Bornh.', Ukendt: '?' };
    body.innerHTML = `
      <p class="muted">${data.total} alarmer siden ${from} · Eftersyn udeladt · fra 18. sep. tælles hele meldingen</p>
      <div class="tablewrap"><table>
        <thead><tr>${regions.map((r) => `<th title="${esc(r)}">${short[r] ?? esc(r)}</th>`).join('')}<th>I alt</th></tr></thead>
        <tbody>
          ${headlines.map(([h, n]) => `<tr class="head"><th colspan="${regions.length + 1}">${esc(h)}</th></tr>
            <tr class="nums">${regions.map((r) => cell(get(r, h))).join('')}<td class="n total">${n}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr class="head"><th colspan="${regions.length + 1}">I alt</th></tr>
          <tr class="nums">${regions.map((r) => `<td class="n total">${data.regions[r]?.total ?? 0}</td>`).join('')}<td class="n total">${data.total}</td></tr></tfoot>
      </table></div>`;
  }
}
