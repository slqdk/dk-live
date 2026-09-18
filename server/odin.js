// 112 alarms from Beredskabsstyrelsen's ODIN 112-puls, read via beredskabsinfo.dk which
// republishes the feed as a plain HTML table (odin.dk itself is unreliable).
// Kilde: www.odin.dk/112puls — attribution is required when displaying the data.
//
// Table columns: "Tidspunkt" | "Brandvæsen og station" | "Melding"
//   14-09-2026 10:23 | TrekantBrand     Station  Kolding | Bygn.brand-Gård
//
// Coordinates: the incident address is not public, so we place the alarm at the responding
// station — first by matching OSM fire stations (Overpass), then by geocoding the station
// name as a place via Nominatim. Both are cached on disk in server/cache/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { BBOX, log } from './bbox.js';
import { record } from './alarmstats.js';

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache');
const STATIONS_FILE = path.join(CACHE_DIR, 'fire-stations.json');
const GEOCODE_FILE = path.join(CACHE_DIR, 'geocode.json');

const SOURCE_URL = 'https://www.beredskabsinfo.dk/112-puls/';
let PAGES = 3; // 25 rows per page
export function setPages(n) {
  PAGES = n;
  if (started) poll();
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
let KEEP_HOURS = 24;
let started = false;
export function setKeepHours(h) {
  KEEP_HOURS = h;
  if (started) poll();
}
const UA = 'dk-live/0.1 (personal dashboard; polls every 90 s)';

let alarms = [];
let rawRows = [];
let stations = [];
let geocodeCache = {}; // normalized station name -> {lat, lon, matched} | null
let lastStatus = 'not started';
const geocodeQueue = [];

fs.mkdirSync(CACHE_DIR, { recursive: true });
try { geocodeCache = JSON.parse(fs.readFileSync(GEOCODE_FILE, 'utf8')); } catch {}

// "Falck Haderslev" → "Haderslev", "Vojens+Gram" → "Vojens", "Slagelse BV" → "Slagelse"
const cleanStation = (s) =>
  s
    .replace(/^falck[\s-]*/i, '')
    .replace(/^st\.\s*/i, '')
    .split(/[+\/]/)[0]
    .replace(/\s+(bv|brands?|st\.?)$/i, '')
    .replace(/\s*-\s*.*$/, '') // "Åsum - Odense" → "Åsum"
    .trim();
const norm = (s) => cleanStation(s).toLowerCase().replace(/[^a-zæøå0-9]/g, '');

// --- station coordinates -------------------------------------------------------------
async function loadStations() {
  try {
    stations = JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8'));
    log('odin', `loaded ${stations.length} fire stations from cache`);
    return;
  } catch {}
  const q = `[out:json][timeout:60];node["amenity"="fire_station"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});out;`;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': UA } });
      const text = await res.text();
      if (!res.ok || !text.trim().startsWith('{')) throw new Error(`HTTP ${res.status}, non-JSON body`);
      stations = (JSON.parse(text).elements ?? [])
        .filter((e) => e.tags?.name)
        .map((e) => ({ name: e.tags.name, key: e.tags.name.toLowerCase().replace(/brandstation|brandvæsen|beredskab|station/g, '').replace(/[^a-zæøå0-9]/g, ''), lat: e.lat, lon: e.lon }));
      fs.writeFileSync(STATIONS_FILE, JSON.stringify(stations));
      log('odin', `loaded ${stations.length} fire stations from OSM via ${new URL(url).host}, cached`);
      regeocode();
      return;
    } catch (err) {
      log('odin', `fire stations from ${new URL(url).host} failed:`, err.cause?.code ?? err.message);
    }
  }
  log('odin', 'no fire stations yet, retrying in 10 min');
  setTimeout(loadStations, 10 * 60_000);
}

// Station names that aren't place names
const ALIAS = {
  hovedbrandstationen: { lat: 55.6733, lon: 12.5697, matched: 'Hovedbrandstationen, København' },
};

function geocode(stationName) {
  const key = norm(stationName);
  if (!key) return null;
  if (key in ALIAS) return ALIAS[key];
  if (key in geocodeCache) return geocodeCache[key];
  const hit = stations.find((s) => s.key === key) ?? stations.find((s) => s.key.startsWith(key) || key.startsWith(s.key));
  if (hit) return (geocodeCache[key] = { lat: hit.lat, lon: hit.lon, matched: hit.name });
  if (!geocodeQueue.includes(key)) geocodeQueue.push(key); // ask Nominatim later
  return null;
}

// Nominatim fallback: one request per 1.5 s, results cached forever.
async function geocodeWorker() {
  const key = geocodeQueue.shift();
  if (key && !(key in geocodeCache)) {
    const name = alarms.find((a) => norm(a.station) === key)?.station ?? key;
    const q = `${cleanStation(name)}, Denmark`;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=dk&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const [hit] = await res.json();
      geocodeCache[key] = hit ? { lat: +hit.lat, lon: +hit.lon, matched: hit.display_name.split(',')[0] } : null;
      fs.writeFileSync(GEOCODE_FILE, JSON.stringify(geocodeCache));
      if (hit) regeocode();
    } catch (err) {
      log('odin', `geocode "${q}" failed:`, err.cause?.code ?? err.message);
      geocodeQueue.push(key);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  setTimeout(geocodeWorker, 1500);
}

function regeocode() {
  for (const a of alarms) if (!a.lat) Object.assign(a, geocode(a.station) ?? {});
}

// --- the alarm list ---------------------------------------------------------------
function parseTime(text) {
  const m = text.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : null;
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length >= 3 && /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/.test(cells[0])) rows.push(cells);
  });
  return rows;
}

async function poll() {
  try {
    const rows = [];
    for (let p = 1; p <= PAGES; p++) {
      const url = p === 1 ? SOURCE_URL : `${SOURCE_URL}?puls_page=${p}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows.push(...parsePage(await res.text()));
    }
    rawRows = rows;
    const cutoff = Date.now() - KEEP_HOURS * 3600_000;
    const seen = new Set();
    const next = [];
    for (const [when, who, message] of rows) {
      const time = parseTime(when);
      if (!time || time < cutoff) continue;
      const [beredskab, station = ''] = who.split(/\s*Station\s*/);
      const rec = { time, beredskab: beredskab.trim(), station: station.trim(), message: message.trim() };
      rec.id = `${time}-${norm(rec.station)}-${rec.message.slice(0, 24)}`;
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      Object.assign(rec, geocode(rec.station) ?? {});
      next.push(rec);
    }
    next.sort((a, b) => b.time - a.time);
    alarms = next;
    record(alarms);
    lastStatus = `ok, ${alarms.length} alarms (${alarms.filter((a) => a.lat).length} geocoded, ${geocodeQueue.length} pending)`;
  } catch (err) {
    lastStatus = `failed: ${err.cause?.code ?? err.message}`;
    log('odin', 'poll failed:', lastStatus);
  }
}

export function startOdin(intervalSec) {
  poll();
  setInterval(poll, intervalSec * 1000);
  loadStations(); // not awaited — alarms show up before coordinates do
  geocodeWorker();
  log('odin', `polling beredskabsinfo.dk every ${intervalSec}s`);
}

export function getOdin() {
  return { status: lastStatus, source: 'Kilde: www.odin.dk/112puls via beredskabsinfo.dk', alarms };
}

export function getOdinRaw() {
  return { status: lastStatus, rows: rawRows.slice(0, 30), stations: stations.length, geocoded: Object.keys(geocodeCache).length, pending: geocodeQueue };
}
