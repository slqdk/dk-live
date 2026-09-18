// Settings panel: map, layers, data and API keys. Only usable from the server itself or from
// SETTINGS_ALLOW addresses; other devices see a friendly refusal.
import { esc } from './app.js';
import { prefs, schema, applyPrefs } from './prefs.js';

const GROUPS = [
  ['kort', 'Kort'],
  ['lag', 'Lag'],
  ['data', 'Data'],
  ['keys', 'API-nøgler'],
];

export function initSettings(map, BBOX) {
  const panel = document.getElementById('settings');
  const body = document.getElementById('settings-body');
  const tabs = document.getElementById('settings-tabs');
  let state = null; // { keys, prefs, schema } from the server
  let active = 'kort';

  document.getElementById('settings-open').addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) await load();
  });
  document.getElementById('settings-close').addEventListener('click', () => (panel.hidden = true));

  async function load() {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) {
      tabs.innerHTML = '';
      body.innerHTML = `<p class="status err">${esc(data.error ?? res.statusText)}</p>`;
      return;
    }
    state = data;
    renderTabs();
    render();
  }

  function renderTabs() {
    tabs.replaceChildren(
      ...GROUPS.map(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = id === active ? 'active' : '';
        b.addEventListener('click', () => {
          active = id;
          renderTabs();
          render();
        });
        return b;
      })
    );
  }

  function render() {
    if (active === 'keys') return renderKeys();
    const items = Object.entries(state.schema).filter(([, d]) => d.group === active);
    body.replaceChildren(...items.map(([id, d]) => control(id, d)));
    if (active === 'data') {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Indstillinger her gælder på serveren og dermed på alle enheder.';
      body.appendChild(note);
    }
  }

  function control(id, d) {
    const wrap = document.createElement('div');
    wrap.className = 'pref';
    const value = state.prefs[id];
    const label = document.createElement('label');
    label.textContent = d.label;
    label.htmlFor = `pref-${id}`;
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.className = 'row';
    wrap.appendChild(row);

    const status = document.createElement('div');
    status.className = 'status';

    const save = async (v, immediate = false) => {
      // preview locally right away, persist on the server (debounced for sliders)
      if (!d.server) applyPrefs({ [id]: v });
      clearTimeout(wrap._t);
      wrap._t = setTimeout(
        async () => {
          try {
            const r = await post({ prefs: { [id]: v } });
            state = r;
            if (d.server) applyPrefs({ [id]: r.prefs[id] });
            status.className = 'status ok';
            status.textContent = 'Gemt';
            setTimeout(() => (status.textContent = ''), 1500);
          } catch (err) {
            status.className = 'status err';
            status.textContent = err.message;
          }
        },
        immediate ? 0 : 400
      );
    };

    switch (d.type) {
      case 'range':
      case 'int': {
        const input = document.createElement('input');
        input.type = 'range';
        input.id = `pref-${id}`;
        input.min = d.min;
        input.max = d.max;
        input.step = d.step ?? 1;
        input.value = value ?? d.default;
        const out = document.createElement('output');
        out.textContent = fmt(input.value, d);
        input.addEventListener('input', () => {
          out.textContent = fmt(input.value, d);
          save(Number(input.value));
        });
        row.append(input, out);
        break;
      }
      case 'select': {
        const sel = document.createElement('select');
        sel.id = `pref-${id}`;
        for (const o of d.options) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          opt.selected = o === (value ?? d.default);
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => save(sel.value, true));
        row.appendChild(sel);
        break;
      }
      case 'text': {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `pref-${id}`;
        input.value = value ?? d.default ?? '';
        input.placeholder = 'f.eks. https://slq.dk eller navn@eksempel.dk';
        input.addEventListener('change', () => save(input.value, true));
        row.appendChild(input);
        break;
      }
      case 'bool': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `pref-${id}`;
        input.checked = Boolean(value ?? d.default);
        input.addEventListener('change', () => save(input.checked, true));
        row.appendChild(input);
        break;
      }
      case 'bounds': {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Gem nuværende udsnit';
        b.addEventListener('click', () => {
          const bb = map.getBounds();
          save([[bb.getWest(), bb.getSouth()], [bb.getEast(), bb.getNorth()]], true);
        });
        const r = document.createElement('button');
        r.type = 'button';
        r.textContent = 'Nulstil';
        r.addEventListener('click', () => save(null, true));
        const info = document.createElement('span');
        info.className = 'muted';
        info.textContent = value ? 'eget udsnit gemt' : 'hele kortet';
        row.append(b, r, info);
        break;
      }
    }
    wrap.appendChild(status);
    return wrap;
  }

  function fmt(v, d) {
    return d.type === 'int' ? String(Math.round(v)) : Number(v).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  }

  function renderKeys() {
    body.replaceChildren(
      ...state.keys.map((k) => {
        const wrap = document.createElement('div');
        wrap.className = 'key';
        wrap.innerHTML = `
          <label for="key-${k.id}">${esc(k.label)} <a href="${k.url}" target="_blank" rel="noopener">få nøgle ↗</a></label>
          <div class="row">
            <input id="key-${k.id}" type="password" autocomplete="off" spellcheck="false"
                   placeholder="${k.set ? `gemt ${esc(k.hint)}${k.fromEnv ? ' (fra .env)' : ''}` : 'indsæt nøgle'}" />
            <button type="button" data-save="${k.id}">Gem</button>
            ${k.set ? `<button type="button" data-clear="${k.id}" title="Fjern nøglen">Fjern</button>` : ''}
          </div>
          <div class="status"></div>`;
        wrap.addEventListener('click', async (e) => {
          const id = e.target.dataset.save ?? e.target.dataset.clear;
          if (!id) return;
          const input = wrap.querySelector('input');
          const status = wrap.querySelector('.status');
          const value = e.target.dataset.clear != null ? '' : input.value.trim();
          if (e.target.dataset.save != null && !value) return (status.textContent = 'Feltet er tomt.');
          status.className = 'status';
          status.textContent = 'Gemmer…';
          try {
            state = await post({ keys: { [id]: value } });
            renderKeys();
            const s = body.querySelector(`#key-${id}`).closest('.key').querySelector('.status');
            s.className = 'status ok';
            s.textContent = value ? 'Gemt — laget starter nu.' : 'Fjernet.';
          } catch (err) {
            status.className = 'status err';
            status.textContent = err.message;
          }
        });
        return wrap;
      })
    );
  }

  async function post(payload) {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }
}
