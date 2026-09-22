// Live aircraft from adsb.lol (community ADS-B, no key, no credits).
// Polls one 250 nm circle around the map centre and keeps only what is inside BBOX.
// Routes (origin → destination) come from adsb.lol's routeset endpoint and are cached per callsign.
import https from 'node:https';
import { BBOX, CENTER, inBbox, log } from './bbox.js';

const URL = `https://api.adsb.lol/v2/lat/${CENTER.lat.toFixed(3)}/lon/${CENTER.lon.toFixed(3)}/dist/250`;
const HEADERS = { 'User-Agent': 'dk-live/0.1 (personal dashboard)' };
const SKIP_TYPES = new Set(['TWR', 'GND']); // ground stations / vehicles reported as "aircraft"

let cache = { updated: 0, aircraft: [] };

// adsb.lol throttles kept-alive connections far harder than fresh ones (Node's fetch pools
// and reuses them), so each poll opens its own TLS connection: agent:false = no pooling.
function getFresh(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: false, headers: { ...HEADERS, Accept: 'application/json' }, timeout: 20_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Backoff: 30 s, doubling to 5 min (or Retry-After if longer); reset on success.
// Logged once per episode + once on recovery, not on every failed poll.
let backoffUntil = 0;
let backoffMs = 0;
let failures = 0;
function fail(reason, retryAfterSec) {
  backoffMs = Math.min(backoffMs ? backoffMs * 2 : 30_000, 300_000);
  const wait = Math.max(backoffMs, (retryAfterSec || 0) * 1000);
  backoffUntil = Date.now() + wait;
  if (failures++ === 0) log('flights', `poll failed: ${reason}, backing off (${Math.round(wait / 1000)} s, doubling)`);
}

// Routes: adsbdb.com, one GET per callsign, max one per second, cached for the process lifetime.
const routes = new Map(); // callsign -> { from, to, fromName, toName } | null (looked up, unknown)
const routeQueue = [];
async function routeWorker() {
  const cs = routeQueue.shift();
  if (cs && !routes.has(cs)) {
    try {
      const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, { headers: HEADERS });
      if (res.status === 404 || res.status === 400) routes.set(cs, null); // unknown or malformed callsign: give up
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      else {
        const fr = (await res.json()).response?.flightroute;
        routes.set(
          cs,
          fr?.origin && fr?.destination
            ? { from: fr.origin.iata_code || fr.origin.icao_code, to: fr.destination.iata_code || fr.destination.icao_code, fromName: fr.origin.municipality || fr.origin.name, toName: fr.destination.municipality || fr.destination.name }
            : null
        );
      }
    } catch (err) {
      // network hiccup or 429/5xx: retry later, at the back of the queue
      log('flights', `route ${cs} failed:`, err.cause?.code ?? err.message);
      routeQueue.push(cs);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  setTimeout(routeWorker, 1000);
}
const CALLSIGN = /^[A-Z0-9]{3,8}$/; // anything else is noise from a misconfigured transponder
function queueRoutes(list) {
  for (const a of list) {
    if (!a.callsign || routes.has(a.callsign) || routeQueue.includes(a.callsign)) continue;
    if (!CALLSIGN.test(a.callsign)) routes.set(a.callsign, null);
    else routeQueue.push(a.callsign);
  }
}

async function poll() {
  if (Date.now() < backoffUntil) return;
  try {
    const res = await getFresh(URL);
    if (res.status !== 200) return fail(`HTTP ${res.status}`, Number(res.headers['retry-after']));
    const json = JSON.parse(res.body);
    if (failures) log('flights', `recovered after ${failures} failed poll(s)`);
    failures = 0;
    backoffMs = 0;
    const now = Date.now();
    const aircraft = (json.ac ?? [])
      .filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number' && inBbox(a.lat, a.lon))
      .filter((a) => !SKIP_TYPES.has(a.t))
      .map((a) => ({
        id: a.hex,
        callsign: (a.flight ?? '').trim() || null,
        reg: a.r ?? null,
        type: a.t ?? null,
        desc: a.desc ?? null, // e.g. "BOEING 737-800"
        operator: a.ownOp ?? null,
        category: a.category ?? null, // A1 light … A5 heavy, A7 rotorcraft
        lat: a.lat,
        lon: a.lon,
        alt: a.alt_baro === 'ground' ? 0 : a.alt_baro ?? null, // feet
        onGround: a.alt_baro === 'ground',
        gs: a.gs ?? null, // knots
        track: a.track ?? null,
        vr: a.baro_rate ?? null, // ft/min
        squawk: a.squawk ?? null,
        emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
        military: Boolean((a.dbFlags ?? 0) & 1),
        seen: now - Math.round((a.seen_pos ?? 0) * 1000),
      }));
    queueRoutes(aircraft);
    for (const a of aircraft) a.route = a.callsign ? routes.get(a.callsign) ?? null : null;
    cache = { updated: now, aircraft };
  } catch (err) {
    fail(err.cause?.code ?? err.code ?? err.message);
  }
}

let timer = null;
export function startFlights(intervalSec) {
  routeWorker();
  poll();
  setFlightsInterval(intervalSec);
  log('flights', `bbox`, BBOX);
}
export function setFlightsInterval(sec) {
  clearInterval(timer);
  timer = setInterval(poll, Math.max(10, sec) * 1000);
  log('flights', `polling adsb.lol every ${sec}s`);
}

export function getFlights() {
  return cache;
}
