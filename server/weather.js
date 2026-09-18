// Rain radar from RainViewer (public, keyless: past 2 h, 10 min frames, max zoom 7).
// Lightning from DMI (optional, free key from https://dmiapi.govcloud.dk).
import { BBOX, log } from './bbox.js';

const RV_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const DMI_URL = 'https://dmigw.govcloud.dk/v2/lightningdata/collections/observation/items';
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
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const url = `${DMI_URL}?bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}&datetime=${since}/..&limit=5000&api-key=${apiKey}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    lightning = {
      enabled: true,
      updated: Date.now(),
      status: `ok, ${json.features?.length ?? 0} strikes last hour`,
      strikes: (json.features ?? []).map((f) => ({
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        time: Date.parse(f.properties.observed),
        type: f.properties.type, // 0 = cloud-to-ground, 1 = cloud-to-cloud
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
  lightning = { enabled: false, updated: 0, status: 'no key', strikes: [] };
  if (!dmiKey) return log('lightning', 'no DMI_LIGHTNING_KEY, layer disabled');
  pollLightning(dmiKey);
  lightningTimer = setInterval(() => pollLightning(dmiKey), 2 * 60_000);
  log('lightning', 'polling DMI every 2 min');
}

export const getRadar = () => radar;
export const getLightning = () => lightning;
