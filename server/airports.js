// Airports from OurAirports (public domain): airports, runways and frequencies, downloaded once
// and cached in server/cache. Live METAR for towered fields from aviationweather.gov (no key).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inBbox, log } from './bbox.js';

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache', 'airports.json');
const OA = 'https://davidmegginson.github.io/ourairports-data';
const AWC = 'https://aviationweather.gov/api/data/metar';
const UA = 'dk-live/0.1 (personal dashboard)';
const TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);
const REFRESH_DAYS = 30;

let airports = [];
let metars = new Map(); // icao -> parsed metar
let status = 'not started';

// Minimal CSV parser (RFC 4180 quoting)
function csv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function download() {
  const get = async (f) => {
    const res = await fetch(`${OA}/${f}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    return csv(await res.text());
  };
  const [ap, rw, fq] = await Promise.all([get('airports.csv'), get('runways.csv'), get('airport-frequencies.csv')]);
  const byId = new Map();
  for (const a of ap) {
    const lat = +a.latitude_deg, lon = +a.longitude_deg;
    if (!TYPES.has(a.type) || !inBbox(lat, lon)) continue;
    byId.set(a.id, {
      id: a.id,
      icao: a.gps_code || a.ident,
      iata: a.iata_code || null,
      name: a.name,
      type: a.type.replace('_airport', ''),
      lat, lon,
      elevationFt: a.elevation_ft ? +a.elevation_ft : null,
      municipality: a.municipality || null,
      country: a.iso_country,
      scheduled: a.scheduled_service === 'yes',
      website: a.home_link || null,
      wikipedia: a.wikipedia_link || null,
      runways: [],
      frequencies: [],
    });
  }
  for (const r of rw) {
    const a = byId.get(r.airport_ref);
    if (!a || r.closed === '1') continue;
    a.runways.push({
      ident: [r.le_ident, r.he_ident].filter(Boolean).join('/'),
      lengthM: r.length_ft ? Math.round(+r.length_ft * 0.3048) : null,
      widthM: r.width_ft ? Math.round(+r.width_ft * 0.3048) : null,
      surface: r.surface || null,
      lighted: r.lighted === '1',
    });
  }
  for (const f of fq) {
    const a = byId.get(f.airport_ref);
    if (a) a.frequencies.push({ type: f.type, desc: f.description || null, mhz: f.frequency_mhz });
  }
  airports = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ at: Date.now(), airports }));
  log('airports', `downloaded ${airports.length} airports from OurAirports, cached`);
}

async function load() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (Date.now() - c.at < REFRESH_DAYS * 86_400_000) {
      airports = c.airports;
      log('airports', `loaded ${airports.length} airports from cache`);
      return;
    }
  } catch {}
  try {
    await download();
  } catch (err) {
    log('airports', 'download failed:', err.cause?.code ?? err.message);
    if (!airports.length) setTimeout(load, 10 * 60_000);
  }
}

// METAR — only fields that plausibly report one (scheduled service or large/medium)
async function pollMetar() {
  const ids = airports.filter((a) => a.type !== 'small' || a.scheduled).map((a) => a.icao).filter((i) => /^[A-Z]{4}$/.test(i));
  if (!ids.length) return;
  try {
    const res = await fetch(`${AWC}?ids=${ids.join(',')}&format=json`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const next = new Map();
    for (const m of json) {
      next.set(m.icaoId, {
        raw: m.rawOb,
        time: m.reportTime ? Date.parse(`${m.reportTime}Z`) || Date.parse(m.reportTime) : null,
        tempC: m.temp ?? null,
        dewC: m.dewp ?? null,
        windDir: m.wdir ?? null,
        windKt: m.wspd ?? null,
        gustKt: m.wgst ?? null,
        visM: m.visib != null ? (typeof m.visib === 'string' ? m.visib : Math.round(m.visib * 1609)) : null,
        qnh: m.altim != null ? Math.round(m.altim) : null,
        wx: m.wxString ?? null,
        clouds: (m.clouds ?? []).map((c) => `${c.cover}${c.base != null ? ` ${c.base} ft` : ''}`).join(', ') || null,
        fltCat: m.fltCat ?? null,
      });
    }
    metars = next;
    status = `ok, ${airports.length} airports, ${metars.size} METARs`;
  } catch (err) {
    status = `metar failed: ${err.cause?.code ?? err.message}`;
    log('airports', status);
  }
}

export async function startAirports() {
  await load();
  status = `ok, ${airports.length} airports`;
  pollMetar();
  setInterval(pollMetar, 10 * 60_000);
  log('airports', 'polling METAR every 10 min');
}

export function getAirports() {
  return { status, airports: airports.map((a) => ({ ...a, metar: metars.get(a.icao) ?? null })) };
}
