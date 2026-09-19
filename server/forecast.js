// Point forecast from Open-Meteo (free, no key, ~10k calls/day for non-commercial use).
// Returns the current conditions, 15-minute precipitation for the next few hours and an
// hourly series for the next two days. Cached per rounded coordinate for 10 minutes.
// Kilde: Open-Meteo.com, data fra DWD ICON / ECMWF / DMI m.fl.
import { inBbox, log } from './bbox.js';

const URL = 'https://api.open-meteo.com/v1/forecast';
const UA = 'dk-live/0.1 (personal dashboard)';
const TTL = 10 * 60_000;
const cache = new Map(); // "lat,lon" -> { at, data }

const CURRENT = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day'];
const MIN15 = ['precipitation', 'weather_code'];
const HOURLY = ['temperature_2m', 'precipitation', 'precipitation_probability', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'cloud_cover'];
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max', 'sunrise', 'sunset'];

export async function forecast(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('bad coordinates');
  if (!inBbox(lat, lon)) throw new Error('uden for kortet');
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(','),
    minutely_15: MIN15.join(','),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    forecast_days: '3',
    forecast_minutely_15: '24', // 6 hours
    timezone: 'Europe/Copenhagen',
    wind_speed_unit: 'ms',
  });
  const res = await fetch(`${URL}?${q}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    log('forecast', `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    throw new Error(`HTTP ${res.status}`);
  }
  const j = await res.json();
  const series = (block, fields) =>
    (block?.time ?? []).map((t, i) => Object.fromEntries([['time', t], ...fields.map((f) => [f, block[f]?.[i] ?? null])]));
  const data = {
    lat: j.latitude,
    lon: j.longitude,
    elevation: j.elevation,
    updated: Date.now(),
    current: j.current ?? null,
    minutely: series(j.minutely_15, MIN15),
    hourly: series(j.hourly, HOURLY),
    daily: series(j.daily, DAILY),
  };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  return data;
}
