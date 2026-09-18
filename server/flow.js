// Traffic flow from TomTom as vector tiles (free developer key, 2,500 tile requests/day).
// Each road segment carries road_category and traffic_level (current speed / free-flow speed),
// so the client can draw only motorways and colour them. Proxied so the key stays here;
// tiles cached in memory for a minute.
import { log } from './bbox.js';

const TAGS = '[traffic_level,traffic_road_coverage,road_category,road_subcategory]';
let key = null;
const cache = new Map(); // "z/x/y" -> { buf, at }
const TTL = 60_000;

export function setFlowKey(k) {
  key = k || null;
  cache.clear();
  log('flow', key ? 'TomTom traffic flow enabled' : 'no TOMTOM_API_KEY, layer disabled');
}

export const flowEnabled = () => Boolean(key);

export async function flowTile(z, x, y) {
  if (!key) return null;
  const id = `${z}/${x}/${y}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.buf;
  const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.pbf?key=${key}&tags=${TAGS}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
    log('flow', `tile ${id} → HTTP ${res.status}: ${body}`);
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  cache.set(id, { buf, at: Date.now() });
  if (cache.size > 2000) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  return buf;
}
