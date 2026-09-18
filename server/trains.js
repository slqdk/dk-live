// Live train positions from Rejseplanen API 2.0 (journeypos). Free key for non-commercial use,
// 50,000 calls/month — one poll per minute stays well inside that.
// Get a key: https://labs.rejseplanen.dk (Adgang til data fra Labs).
import { BBOX, log } from './bbox.js';

const URL = 'https://www.rejseplanen.dk/api/journeypos';
const UA = 'dk-live/0.1 (personal dashboard)';

let cache = { enabled: false, updated: 0, status: 'no key', vehicles: [] };

// Rejseplanen "products" bitmask (same as API 1.0): 1 ICL, 2 IC, 4 RE, 8 Ø/Re-tog, 16 S-tog,
// 32 bus, 64 exp bus, 128 night bus, 256 telebus, 512 ferry, 1024 metro, 2048 letbane.
const TRAINS = 1 + 2 + 4 + 8 + 16 + 1024 + 2048;

async function poll(apiKey) {
  try {
    const params = new URLSearchParams({
      accessId: apiKey,
      format: 'json',
      llLat: BBOX.south,
      llLon: BBOX.west,
      urLat: BBOX.north,
      urLon: BBOX.east,
      products: TRAINS,
      maxJny: 500,
    });
    const res = await fetch(`${URL}?${params}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = json.JourneyPosList?.Journey ?? json.Journey ?? [];
    const vehicles = list
      .filter((j) => typeof j.lat === 'number' && typeof j.lon === 'number')
      .map((j) => {
        const prod = Array.isArray(j.Product) ? j.Product[0] : j.Product ?? {};
        return {
          id: j.id ?? j.jid ?? `${j.name}-${j.date}`,
          name: (j.name ?? prod.name ?? '').trim(),
          line: prod.line ?? prod.num ?? null,
          category: prod.catOutS ?? prod.catOut ?? null, // IC, ICL, RE, S, M …
          operator: prod.operator ?? null,
          direction: j.dirTxt ?? j.direction ?? null,
          delay: j.delay ?? null, // minutes, if present
          lat: j.lat,
          lon: j.lon,
          heading: j.direction ?? null,
          seen: Date.now(),
        };
      });
    cache = { enabled: true, updated: Date.now(), status: `ok, ${vehicles.length} vehicles`, vehicles };
  } catch (err) {
    cache.status = `failed: ${err.cause?.code ?? err.message}`;
    cache.enabled = true;
    log('trains', 'poll failed:', cache.status);
  }
}

let timer = null;
let interval = 60;

export function startTrains(apiKey, intervalSec) {
  interval = intervalSec;
  setTrainsKey(apiKey);
}

export function setTrainsKey(apiKey) {
  clearInterval(timer);
  cache = { enabled: false, updated: 0, status: 'no key', vehicles: [] };
  if (!apiKey) return log('trains', 'no REJSEPLANEN_API_KEY, layer disabled');
  poll(apiKey);
  timer = setInterval(() => poll(apiKey), interval * 1000);
  log('trains', `polling Rejseplanen every ${interval}s`);
}

export const getTrains = () => cache;
