// Politi panel: latest Politi Update cases per district, expandable to the full timeline.
import { esc } from './app.js';
import { prefs } from './prefs.js';

const POLL_MS = 3 * 60_000;

export function initPolice() {
  const panel = document.getElementById('police');
  const list = document.getElementById('police-list');
  const filterEl = document.getElementById('police-filter');
  const btn = document.getElementById('police-open');
  let data = null;
  let filter = null; // district short name or 'Alle'
  const open = new Set();
  let timer = null;

  btn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return clearInterval(timer);
    load();
    timer = setInterval(load, POLL_MS);
  });
  document.getElementById('police-close').addEventListener('click', () => {
    panel.hidden = true;
    clearInterval(timer);
  });
  filterEl.addEventListener('change', () => {
    filter = filterEl.value;
    render();
  });

  async function load() {
    try {
      data = await (await fetch('/api/police', { cache: 'no-store' })).json();
      if (filter == null) filter = prefs.policeDistrict ?? 'Alle';
      renderFilter();
      render();
    } catch (err) {
      list.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    }
  }

  function renderFilter() {
    const opts = ['Alle', ...data.districts.map((d) => d.short)];
    filterEl.innerHTML = opts.map((o) => `<option ${o === filter ? 'selected' : ''}>${esc(o)}</option>`).join('');
  }

  const when = (t) => {
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    const yest = new Date(Date.now() - 86_400_000).toDateString() === d.toDateString();
    const hm = d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    return today ? hm : yest ? `i går ${hm}` : `${d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${hm}`;
  };

  function render() {
    if (!data) return;
    const short = Object.fromEntries(data.districts.map((d) => [d.id, d.short]));
    const cases = data.cases.filter((c) => filter === 'Alle' || short[c.district] === filter);
    if (!cases.length) {
      list.innerHTML = `<p class="muted">Ingen meddelelser de sidste 7 dage${filter !== 'Alle' ? ` fra ${esc(filter)}` : ''}.</p>`;
      return;
    }
    list.innerHTML = cases
      .map(
        (c) => `<li data-id="${c.id}" class="${open.has(c.id) ? 'open' : ''}">
          <button type="button" class="row">
            <span class="when">${when(c.last)}</span>
            <span class="kreds">${esc(short[c.district] ?? '')}</span>
            <span class="title">${esc(c.title)}</span>
            ${c.updates > 1 ? `<span class="n" title="${c.updates} opdateringer">${c.updates}</span>` : ''}
          </button>
          <div class="detail">${open.has(c.id) ? '<p class="muted">Henter…</p>' : ''}</div>
        </li>`
      )
      .join('');
    for (const id of open) fetchDetail(id);
  }

  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li || !e.target.closest('.row')) return;
    const id = li.dataset.id;
    if (open.has(id)) {
      open.delete(id);
      li.classList.remove('open');
      li.querySelector('.detail').innerHTML = '';
    } else {
      open.add(id);
      li.classList.add('open');
      li.querySelector('.detail').innerHTML = '<p class="muted">Henter…</p>';
      fetchDetail(id);
    }
  });

  async function fetchDetail(id) {
    const target = list.querySelector(`li[data-id="${id}"] .detail`);
    if (!target) return;
    try {
      const d = await (await fetch(`/api/police/${id}`)).json();
      if (d.error) throw new Error(d.error);
      target.innerHTML = `
        <ol class="timeline">${(d.updates.length ? d.updates : [{ time: null, text: 'Ingen tekst fundet – åbn meddelelsen.' }])
          .map((u) => `<li>${u.time ? `<span class="t">${when(u.time)}</span>` : ''}<p>${esc(u.text)}</p></li>`)
          .join('')}</ol>
        <a class="ext" href="${esc(d.url)}" target="_blank" rel="noopener">Åbn hos Via Ritzau ↗</a>`;
    } catch (err) {
      target.innerHTML = `<p class="err">${esc(err.message)}</p>`;
    }
  }
}
