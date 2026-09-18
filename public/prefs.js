// Adjustable settings shared by all layers. Loaded from the server before the map is built,
// updated live when the settings panel saves.
export const prefs = {};
export let schema = {};
const listeners = [];

export async function loadPrefs() {
  try {
    const d = await (await fetch('/api/config', { cache: 'no-store' })).json();
    schema = d.schema ?? {};
    Object.assign(prefs, Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, v.default])), d.prefs ?? {});
  } catch (err) {
    console.warn('prefs: using defaults', err);
  }
  return prefs;
}

export function applyPrefs(patch) {
  Object.assign(prefs, patch);
  listeners.forEach((fn) => fn(prefs, patch));
}

export function onPrefs(fn) {
  listeners.push(fn);
}

export const cap = (s) => {
  const max = prefs.labelMax ?? 25;
  return s && s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s ?? '';
};
