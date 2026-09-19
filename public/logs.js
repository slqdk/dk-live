// Admin panel: server log and visitor register. Only reachable from the admin network.
import { esc } from './app.js';

const POLL_MS = 4000;

export function initLogs() {
  const panel = document.getElementById('logs');
  const body = document.getElementById('logs-body');
  const tabs = document.getElementById('logs-tabs');
  let tab = 'log';
  let since = 0;
  let lines = [];
  let visitors = [];
  let timer = null;
  let paused = false;

  document.getElementById('logs-open').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return stop();
    tick();
    timer = setInterval(tick, POLL_MS);
  });
  document.getElementById('logs-close').addEventListener('click', () => {
    panel.hidden = true;
    stop();
  });
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  tabs.addEventListener('click', (e) => {
    const t = e.target.dataset.tab;
    if (!t) return;
    tab = t;
    render();
  });

  async function tick() {
    try {
      const d = await (await fetch(`/api/logs?since=${since}`, { cache: 'no-store' })).json();
      if (d.error) {
        body.innerHTML = `<p class="status err">${esc(d.error)}</p>`;
        return stop();
      }
      since = d.last;
      lines = [...lines, ...d.lines].slice(-600);
      visitors = d.visitors;
      render();
    } catch {}
  }

  function render() {
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === tab);
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    body.innerHTML = tab === 'log' ? renderLog() : renderVisitors();
    if (tab === 'log' && atBottom && !paused) body.scrollTop = body.scrollHeight;
    body.querySelector('#forget-visitors')?.addEventListener('click', async () => {
      if (!confirm('Slet listen over besøgende?')) return;
      await fetch('/api/logs/forget-visitors', { method: 'POST' });
      tick();
    });
  }

  const hhmmss = (t) => new Date(t).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function renderLog() {
    if (!lines.length) return '<p class="muted">Ingen linjer endnu.</p>';
    return `<ol class="loglines">${lines
      .map((l) => {
        const bad = /failed|error|HTTP [45]\d\d|disabled/i.test(l.text);
        return `<li class="${bad ? 'bad' : ''}"><span class="t">${hhmmss(l.t)}</span><span class="s">${esc(l.scope)}</span><span class="m">${esc(l.text)}</span></li>`;
      })
      .join('')}</ol>`;
  }

  function renderVisitors() {
    if (!visitors.length) return '<p class="muted">Ingen besøgende registreret.</p>';
    const ago = (t) => {
      const m = Math.round((Date.now() - t) / 60_000);
      if (m < 1) return 'nu';
      if (m < 60) return `${m} min siden`;
      const h = Math.round(m / 60);
      return h < 24 ? `${h} t siden` : `${Math.round(h / 24)} d siden`;
    };
    const dt = (t) => new Date(t).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `
      <table class="visitors">
        <thead><tr><th>Adresse</th><th>Enhed</th><th>Sidevisninger</th><th>Kald</th><th>Først set</th><th>Sidst</th></tr></thead>
        <tbody>${visitors
          .map(
            (v) => `<tr class="${v.online ? 'online' : ''}">
              <td>${v.online ? '<span class="dot"></span>' : ''}${esc(v.ip)}${v.admin ? ' <span class="badge">admin</span>' : ''}</td>
              <td>${esc(v.device)}</td>
              <td class="n">${v.pages}</td>
              <td class="n">${v.requests}</td>
              <td>${dt(v.first)}</td>
              <td>${ago(v.last)}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table>
      <p class="muted">${visitors.filter((v) => v.online).length} online nu · <button id="forget-visitors" class="link">slet listen</button></p>`;
  }
}
