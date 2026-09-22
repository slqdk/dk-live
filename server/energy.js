// Danish power system from Energinet's Energi Data Service (no key).
// PowerSystemRightNow: 1-minute SCADA snapshot (wind, solar, central/local production, CO2,
// interconnector flows). DayAheadPrices: hourly spot price for DK1.
// Kilde: Energi Data Service (Energinet)
import { log } from './bbox.js';

const BASE = 'https://api.energidataservice.dk/dataset';
const UA = 'dk-live/0.1 (personal dashboard)';
let AREA = 'DK1'; // DK1 = Jutland/Funen, DK2 = Zealand
let started = false;
export function setArea(a) {
  AREA = a;
  if (started) poll();
}

let cache = { updated: 0, status: 'not started', now: null, price: null, prices: [] };

const pick = (rec, ...names) => {
  for (const n of names) {
    const key = Object.keys(rec).find((k) => k.toLowerCase() === n.toLowerCase());
    if (key != null && rec[key] != null) return rec[key];
  }
  return null;
};

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function pollNow() {
  const data = await json(`${BASE}/PowerSystemRightNow?start=now-PT10M&sort=Minutes1UTC%20DESC&limit=1`);
  const r = data.records?.[0];
  if (!r) throw new Error('no records');
  const offshore = pick(r, 'OffshoreWindPower', 'OffshorewindPower', 'OffshoreWindGe100MW_MWh') ?? 0;
  const onshore = pick(r, 'OnshoreWindPower', 'OnshorewindPower') ?? 0;
  return {
    time: Date.parse(`${pick(r, 'Minutes1DK', 'Minutes5DK', 'Minutes1UTC')}Z`) || Date.now(),
    offshoreWind: offshore,
    onshoreWind: onshore,
    wind: offshore + onshore,
    solar: pick(r, 'SolarPower', 'SolarPowerSelfConMWh') ?? 0,
    central: pick(r, 'ProductionGe100MW', 'ProductionGe100MW_MWh') ?? 0,
    local: pick(r, 'ProductionLt100MW', 'ProductionLt100MW_MWh') ?? 0,
    co2: pick(r, 'CO2Emission'),
    exchangeSum: pick(r, 'Exchange_Sum'),
    exchangeDE: pick(r, 'Exchange_DK1_DE'),
    exchangeNO: pick(r, 'Exchange_DK1_NO'),
    exchangeSE: pick(r, 'Exchange_DK1_SE'),
    exchangeNL: pick(r, 'Exchange_DK1_NL'),
    exchangeGB: pick(r, 'Exchange_DK1_GB'),
    // every interconnector in the snapshot, e.g. { Exchange_DK2_DE: -410, ... } (MW)
    exchanges: Object.fromEntries(Object.entries(r).filter(([k, v]) => /^Exchange_/i.test(k) && !/sum/i.test(k) && typeof v === 'number')),
  };
}

// Every published hour from the start of today until the feed runs out — day-ahead prices for
// tomorrow appear around 13:00 Danish time, so this covers "the rest of today plus tomorrow".
async function pollPrices() {
  const filter = encodeURIComponent(JSON.stringify({ PriceArea: [AREA] }));
  const data = await json(`${BASE}/DayAheadPrices?start=now-P1D&end=now%2BP2D&filter=${filter}&sort=TimeDK%20ASC&limit=200`);
  return (data.records ?? [])
    .map((r) => ({
      time: Date.parse(`${pick(r, 'TimeDK', 'HourDK')}Z`),
      // DKK/MWh → DKK/kWh (raw spot, before tariffs, afgifter and moms)
      dkk: Math.round(((pick(r, 'DayAheadPriceDKK', 'SpotPriceDKK') ?? 0) / 1000) * 1000) / 1000,
    }))
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
}

async function poll() {
  try {
    const [now, prices] = await Promise.all([pollNow(), pollPrices()]);
    const t = Date.now();
    // Prices are quarter-hourly; snap "now" to the slot we are in.
    const slot = new Date(t).setMinutes(Math.floor(new Date(t).getMinutes() / 15) * 15, 0, 0);
    const current = prices.find((p) => p.time === slot) ?? prices.filter((p) => p.time <= t).at(-1) ?? null;
    const ahead = prices.filter((p) => p.time >= (current?.time ?? slot));
    cache = { updated: t, status: 'ok', area: AREA, now, price: current, prices: ahead };
  } catch (err) {
    cache.status = `failed: ${err.cause?.code ?? err.message}`;
    log('energy', 'poll failed:', cache.status);
  }
}

export function startEnergy(intervalSec) {
  started = true;
  poll();
  setInterval(poll, intervalSec * 1000);
  log('energy', `polling Energi Data Service every ${intervalSec}s`);
}

export const getEnergy = () => cache;
