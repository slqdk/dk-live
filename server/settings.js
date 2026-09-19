// API keys, editable from the app. Stored in server/cache/settings.json (owner-only, git-ignored);
// values from .env / the environment are used as defaults. Only requests from localhost may
// read or change them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './bbox.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache');
const FILE = path.join(DIR, 'settings.json');
const PREFS_FILE = path.join(DIR, 'prefs.json');

// Adjustable settings. `server: true` ones are applied on the server; the rest in the browser.
// Groups: kort, lag, data. Types: range, int, select, bool, bounds.
export const PREFS = {
  animations: { group: 'kort', label: 'Animationer (glidende fly, pulserende alarmer) – bruger mere strøm', type: 'bool', default: false },
  popupPan: { group: 'kort', label: 'Flyt kortet så popups er helt synlige (kun på stor skærm)', type: 'bool', default: true },
  landBrightness: { group: 'kort', label: 'Lysstyrke på land', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
  homeView: { group: 'kort', label: 'Startudsnit', type: 'bounds', default: null },
  planeScale: { group: 'lag', label: 'Fly – ikonstørrelse', type: 'range', min: 0.5, max: 2.5, step: 0.1, default: 1 },
  shipScale: { group: 'lag', label: 'Skibe – ikonstørrelse', type: 'range', min: 0.5, max: 2.5, step: 0.1, default: 1 },
  trainScale: { group: 'lag', label: 'Tog – ikonstørrelse', type: 'range', min: 0.5, max: 2.5, step: 0.1, default: 1 },
  webcamScale: { group: 'lag', label: 'Webcams – ikonstørrelse', type: 'range', min: 0.3, max: 2.5, step: 0.1, default: 1 },
  airportScale: { group: 'lag', label: 'Lufthavne – ikonstørrelse', type: 'range', min: 0.5, max: 2.5, step: 0.1, default: 1 },
  flowWidth: { group: 'lag', label: 'Trafiktæthed – linjebredde', type: 'range', min: 0.3, max: 3, step: 0.1, default: 1 },
  radarOpacity: { group: 'lag', label: 'Regnradar – gennemsigtighed', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.55 },
  labelMax: { group: 'lag', label: 'Etiketter – max tegn', type: 'int', min: 10, max: 60, default: 25 },
  labelZoom: { group: 'lag', label: 'Vis flynavne fra zoom', type: 'range', min: 5, max: 10, step: 0.5, default: 7 },
  alarmFreshMin: { group: 'lag', label: '112 – "ny" i minutter (pulserer)', type: 'int', min: 5, max: 120, default: 20 },
  alarmKeepHours: { group: 'data', label: '112 – vis alarmer fra de sidste timer', type: 'int', min: 3, max: 48, default: 24, server: true },
  alarmPages: { group: 'data', label: '112 – hent sider à 25 alarmer', type: 'int', min: 1, max: 8, default: 3, server: true },
  flightsPoll: { group: 'data', label: 'Fly – hent hvert (sek.)', type: 'int', min: 10, max: 120, default: 15, server: true },
  priceArea: { group: 'data', label: 'Elområde', type: 'select', options: ['DK1', 'DK2'], default: 'DK1', server: true },
  layers: { group: 'hidden', label: 'Synlige lag', type: 'json', default: null },
  hourlyPrices: { group: 'data', label: 'Elpriser pr. time (i stedet for kvarter)', type: 'bool', default: false },
  statsDetailed: { group: 'data', label: '112-statistik – vis hele meldingen (ellers kun kategori før bindestregen)', type: 'bool', default: true, server: true },
  statsIgnore: { group: 'data', label: '112-statistik – ignorér kategorier (kommasepareret)', type: 'text', max: 300, default: 'Eftersyn', server: true },
  contact: { group: 'data', label: 'Kontakt til API-udbydere (URL eller e-mail — kræves af Planespotters)', type: 'text', max: 200, default: '', server: true },
};

let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch {}
const prefListeners = new Map();

export function getPref(id) {
  return id in prefs ? prefs[id] : PREFS[id]?.default;
}
export function getPrefs() {
  return Object.fromEntries(Object.keys(PREFS).map((id) => [id, getPref(id)]));
}
export function onPrefChange(id, fn) {
  prefListeners.set(id, fn);
}
function validate(id, value) {
  const d = PREFS[id];
  if (!d) throw new Error(`unknown setting ${id}`);
  if (value === null || value === undefined) return null;
  switch (d.type) {
    case 'range':
    case 'int': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${id}: not a number`);
      const c = Math.min(d.max, Math.max(d.min, n));
      return d.type === 'int' ? Math.round(c) : Math.round(c * 1000) / 1000;
    }
    case 'select':
      if (!d.options.includes(value)) throw new Error(`${id}: invalid option`);
      return value;
    case 'bool':
      return Boolean(value);
    case 'text':
      return String(value).trim().slice(0, d.max ?? 200);
    case 'json':
      return value && typeof value === 'object' ? value : null;
    case 'bounds': {
      const b = value;
      if (!Array.isArray(b) || b.length !== 2 || !b.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new Error(`${id}: bad bounds`);
      return b;
    }
    default:
      return value;
  }
}
export function setPrefs(patch) {
  for (const [id, value] of Object.entries(patch)) {
    const v = validate(id, value);
    if (v === null) delete prefs[id];
    else prefs[id] = v;
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  for (const id of Object.keys(patch)) prefListeners.get(id)?.(getPref(id));
  log('settings', `prefs updated: ${Object.keys(patch).join(', ')}`);
}

export const KEYS = [
  { id: 'AISSTREAM_API_KEY', label: 'AISStream (skibe)', url: 'https://aisstream.io' },
  { id: 'REJSEPLANEN_API_KEY', label: 'Rejseplanen (tog)', url: 'https://labs.rejseplanen.dk' },
  { id: 'DMI_LIGHTNING_KEY', label: 'DMI (lyn) – valgfri, API\'et er åbent', url: 'https://opendatadocs.dmi.govcloud.dk/en/Authentication' },
  { id: 'TOMTOM_API_KEY', label: 'TomTom (trafiktæthed)', url: 'https://developer.tomtom.com' },
  { id: 'WINDY_API_KEY', label: 'Windy Webcams (webcams DK)', url: 'https://api.windy.com/keys' },
];

let stored = {};
try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

const listeners = new Map(); // key id -> fn(value)

export function getKey(id) {
  return (stored[id] ?? process.env[id] ?? '').trim() || null;
}

export function onKeyChange(id, fn) {
  listeners.set(id, fn);
}

export function setKey(id, value) {
  if (!KEYS.some((k) => k.id === id)) throw new Error(`unknown key ${id}`);
  stored[id] = (value ?? '').trim();
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
  log('settings', `${id} ${stored[id] ? 'updated' : 'cleared'}`);
  listeners.get(id)?.(getKey(id));
}

export function describeKeys() {
  return KEYS.map((k) => {
    const v = getKey(k.id);
    return { ...k, set: Boolean(v), hint: v ? `••••${v.slice(-4)}` : '', fromEnv: !stored[k.id] && Boolean(process.env[k.id]) };
  });
}

// Which clients may read/change keys: loopback always, plus SETTINGS_ALLOW (IPv4 CIDRs).
const ALLOW = (process.env.SETTINGS_ALLOW ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((cidr) => {
    const [ip, bits = '32'] = cidr.split('/');
    const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return { net: ip4(ip) & mask, mask };
  });

function ip4(ip) {
  const m = ip.replace(/^::ffff:/, '').match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0 : null;
}

export function isAdmin(req) {
  const ip = req.socket.remoteAddress ?? '';
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return true;
  const n = ip4(ip);
  return n != null && ALLOW.some((a) => (n & a.mask) === a.net);
}

export function localOnly(req, res, next) {
  if (isAdmin(req)) return next();
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  res.status(403).json({ error: `kun muligt fra hjemmenetværket (din adresse: ${ip})` });
}
