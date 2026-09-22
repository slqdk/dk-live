// Rain radar from RainViewer (public, keyless: past 2 h, 10 min frames, max zoom 7).
// Lightning from DMI (open API, no key needed: https://www.dmi.dk/friedata/dokumentation/lightning-data-api).
import { BBOX, log } from './bbox.js';

const RV_URL = 'https://api.rainviewer.com/public/weather-maps.json';
// DMI moved to opendataapi.dmi.dk in Dec 2025; the old dmigw.govcloud.dk host retired
// 30 June 2026. The new endpoint is open — a key is sent only if one is configured.
const DMI_URL = 'https://opendataapi.dmi.dk/v2/lightningdata/collections/observation/items';
const UA = 'dk-live/0.1 (personal dashboard)';

let radar = { updated: 0, status: 'not started', host: null, frames: [] };
let lightning = { enabled: false, updated: 0, status: 'no key', strikes: [] };

async function pollRadar() {
  try {
    const res = await fetch(RV_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    radar = {
      updated: Date.now(),
      status: `ok, ${json.radar?.past?.length ?? 0} frames`,
      host: json.host,
      frames: (json.radar?.past ?? []).map((f) => ({ time: f.time * 1000, path: f.path, nowcast: false })),
      nowcast: (json.radar?.nowcast ?? []).map((f) => ({ time: f.time * 1000, path: f.path, nowcast: true })),
    };
  } catch (err) {
    radar.status = `failed: ${err.cause?.code ?? err.message}`;
    log('radar', 'poll failed:', radar.status);
  }
}

async function pollLightning(apiKey) {
  try {
    const since = new Date(Date.now() - 60 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
    const q = new URLSearchParams({
      bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`,
      datetime: `${since}/..`,
      limit: '5000',
    });
    if (apiKey) q.set('api-key', apiKey);
    const res = await fetch(`${DMI_URL}?${q}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      log('lightning', `HTTP ${res.status}: ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`);
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    lightning = {
      enabled: true,
      updated: Date.now(),
      status: `ok, ${json.features?.length ?? 0} strikes last hour`,
      strikes: (json.features ?? [])
        .filter((f) => f.geometry?.coordinates?.length === 2)
        .map((f) => ({
          lon: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          time: Date.parse(f.properties.observed),
          type: Number(f.properties.type), // 0 = cloud-to-ground, 1 = cloud-to-cloud
          amp: f.properties.amp,
        })),
    };
  } catch (err) {
    lightning.status = `failed: ${err.cause?.code ?? err.message}`;
    log('lightning', 'poll failed:', lightning.status);
  }
}

let lightningTimer = null;

export function startWeather(dmiKey) {
  pollRadar();
  setInterval(pollRadar, 5 * 60_000);
  log('radar', 'polling RainViewer every 5 min');
  setLightningKey(dmiKey);
}

export function setLightningKey(dmiKey) {
  clearInterval(lightningTimer);
  lightning = { enabled: true, updated: 0, status: 'starter…', strikes: [] };
  pollLightning(dmiKey);
  lightningTimer = setInterval(() => pollLightning(dmiKey), 2 * 60_000);
  log('lightning', `polling DMI every 2 min${dmiKey ? ' (med nøgle)' : ' (uden nøgle)'}`);
}

export const getRadar = () => radar;
export const getLightning = () => lightning;
