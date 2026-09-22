// DMI observations (open API, no key): https://www.dmi.dk/friedata/dokumentation/apis
//   metObs   — weather stations: wind speed/direction, 10-min max gust, temperature
//   oceanObs — tide gauges: sea level in cm relative to DVR90
// Both are OGC API - Features on opendataapi.dmi.dk; observations carry the station position,
// station names come from the station collection (refreshed daily).
import { BBOX, log } from './bbox.js';

const BASE = 'https://opendataapi.dmi.dk/v2';
const UA = 'dk-live/0.1 (personal dashboard)';
const BB = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
const MET_PARAMS = ['wind_speed', 'wind_dir', 'wind_max', 'temp_dry'];

let wind = { updated: 0, status: 'not started', stations: [] };
let sea = { updated: 0, status: 'not started', stations: [] };
const names = { metObs: new Map(), oceanObs: new Map() };
const namesLoaded = { metObs: 0, oceanObs: 0 };

async function items(api, collection, params) {
  const q = new URLSearchParams({ bbox: BB, limit: '10000', ...params });
  const res = await fetch(`${BASE}/${api}/collections/${collection}/items?${q}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${api}/${collection} HTTP ${res.status}`);
  return (await res.json()).features ?? [];
}

async function loadNames(api) {
  if (Date.now() - namesLoaded[api] < 24 * 3600_000) return;
  try {
    const list = await items(api, 'station', { status: 'Active' });
    for (const f of list) if (f.properties?.stationId) names[api].set(f.properties.stationId, f.properties.name);
    namesLoaded[api] = Date.now();
  } catch (err) {
    log('dmi', `${api} station list failed:`, err.cause?.code ?? err.message);
  }
}

// latest value per station for one parameter
function latest(features) {
  const out = new Map();
  for (const f of features) {
    const p = f.properties ?? {};
    const t = Date.parse(p.observed);
    const prev = out.get(p.stationId);
    if (!prev || t > prev.time) out.set(p.stationId, { value: p.value, time: t, coords: f.geometry?.coordinates });
  }
  return out;
}

async function pollWind() {
  try {
    await loadNames('metObs');
    const results = await Promise.all(MET_PARAMS.map((id) => items('metObs', 'observation', { parameterId: id, period: 'latest-hour' }).then(latest)));
    const [speed, dir, gust, temp] = results;
    const stations = [];
    for (const [id, s] of speed) {
      if (!s.coords || s.value == null) continue;
      stations.push({
        id,
        name: names.metObs.get(id) ?? id,
        lon: s.coords[0],
        lat: s.coords[1],
        time: s.time,
        speed: s.value, // m/s, 10-min mean
        dir: dir.get(id)?.value ?? null, // degrees, direction the wind comes FROM
        gust: gust.get(id)?.value ?? null, // m/s, max 3-s gust in the last 10 min
        temp: temp.get(id)?.value ?? null, // °C
      });
    }
    wind = { updated: Date.now(), status: `ok, ${stations.length} stationer`, stations };
  } catch (err) {
    wind.status = `failed: ${err.cause?.code ?? err.message}`;
    log('dmi', 'metObs poll failed:', wind.status);
  }
}

async function pollSea() {
  try {
    await loadNames('oceanObs');
    const lvl = latest(await items('oceanObs', 'observation', { parameterId: 'sealev_dvr', period: 'latest-day' }));
    const cutoff = Date.now() - 3 * 3600_000; // drop gauges that have gone quiet
    const stations = [];
    for (const [id, s] of lvl) {
      if (!s.coords || s.value == null || s.time < cutoff) continue;
      stations.push({ id, name: names.oceanObs.get(id) ?? id, lon: s.coords[0], lat: s.coords[1], time: s.time, level: s.value });
    }
    sea = { updated: Date.now(), status: `ok, ${stations.length} vandstandsmålere`, stations };
  } catch (err) {
    sea.status = `failed: ${err.cause?.code ?? err.message}`;
    log('dmi', 'oceanObs poll failed:', sea.status);
  }
}

export function startDmiObs() {
  pollWind();
  pollSea();
  setInterval(pollWind, 10 * 60_000);
  setInterval(pollSea, 10 * 60_000);
  log('dmi', 'polling metObs (vind) + oceanObs (vandstand) every 10 min');
}

export const getWind = () => wind;
export const getSeaLevel = () => sea;
