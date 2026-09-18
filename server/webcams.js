// One webcam list from three sources:
//  - Autobahn GmbH roadside cameras (server/autobahn.js, no key)
//  - Windy Webcams API v3 (free key, non-commercial, attribution "webcams by Windy")
//  - Your own list in data/webcams-dk.json
// Windy image URLs carry a token that expires after 10 min on the free tier, so the list is
// fetched hourly without images and a fresh image URL is fetched per camera on click.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX, CENTER, inBbox, log } from './bbox.js';
import { getWebcams as getAutobahnCams } from './autobahn.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CUSTOM_FILE = path.join(ROOT, 'data', 'webcams-dk.json');
const WINDY = 'https://api.windy.com/webcams/api/v3';
const UA = 'dk-live/0.1 (personal dashboard)';

let key = null;
let windyCams = [];
let windyStatus = 'no key';
let timer = null;
let custom = [];

function loadCustom() {
  try {
    const j = JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8'));
    custom = (j.webcams ?? [])
      .filter((c) => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon) && (c.image || c.link))
      .map((c, i) => ({ id: `custom-${i}`, source: 'egen', name: c.name, lat: c.lat, lon: c.lon, image: c.image ?? null, link: c.link ?? null, note: c.note ?? null }));
    log('webcams', `loaded ${custom.length} own cameras from data/webcams-dk.json`);
  } catch (err) {
    log('webcams', 'data/webcams-dk.json not loaded:', err.message);
  }
}

async function windyGet(pathAndQuery) {
  const res = await fetch(`${WINDY}${pathAndQuery}`, { headers: { 'x-windy-api-key': key, 'User-Agent': UA } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} ${body}`);
  }
  return res.json();
}

async function pollWindy() {
  if (!key) return;
  try {
    // Windy caps nearby-radius at 250 km; two circles (north/south) cover the whole box.
    // Paginated 50 at a time. No images here — they expire.
    const circles = [
      [BBOX.north - 1.1, CENTER.lon],
      [BBOX.south + 1.1, CENTER.lon],
    ];
    const found = new Map();
    for (const [lat, lon] of circles) for (let offset = 0; offset < 2000; offset += 50) {
      const j = await windyGet(`/webcams?nearby=${lat.toFixed(3)},${lon.toFixed(3)},250&limit=50&offset=${offset}&include=location,categories,player,urls`);
      for (const w of j.webcams ?? []) {
        const lat = w.location?.latitude, lon = w.location?.longitude;
        if (!Number.isFinite(lat) || !inBbox(lat, lon)) continue;
        if (w.status && w.status !== 'active') continue;
        found.set(w.webcamId, {
          id: `windy-${w.webcamId}`,
          windyId: w.webcamId,
          source: 'windy',
          name: w.title,
          lat, lon,
          city: w.location?.city ?? null,
          country: w.location?.country ?? null,
          categories: (w.categories ?? []).map((c) => c.name),
          link: w.urls?.detail ?? w.player?.day ?? null,
          updated: w.lastUpdatedOn ? Date.parse(w.lastUpdatedOn) : null,
        });
      }
      if (!j.webcams?.length || offset + 50 >= (j.total ?? 0)) break;
    }
    windyCams = [...found.values()];
    windyStatus = `ok, ${windyCams.length} Windy cameras`;
    log('webcams', windyStatus);
  } catch (err) {
    windyStatus = `windy failed: ${err.cause?.code ?? err.message}`;
    log('webcams', windyStatus);
  }
}

export function setWindyKey(k) {
  key = k || null;
  clearInterval(timer);
  windyCams = [];
  if (!key) {
    windyStatus = 'no key';
    return log('webcams', 'no WINDY_API_KEY, Windy cameras disabled');
  }
  pollWindy();
  timer = setInterval(pollWindy, 60 * 60_000);
}

// Fresh, tokenised image URL for one Windy camera (called when a popup opens)
export async function windyImage(windyId) {
  if (!key) return null;
  const j = await windyGet(`/webcams/${windyId}?include=images,player`);
  const img = j.images?.current ?? {};
  return { image: img.preview ?? img.thumbnail ?? null, live: j.player?.live ?? null, day: j.player?.day ?? null };
}

export function startWebcams(windyKey) {
  loadCustom();
  fs.watchFile(CUSTOM_FILE, { interval: 5000 }, loadCustom);
  setWindyKey(windyKey);
}

export function getAllWebcams() {
  const de = getAutobahnCams();
  const items = [
    ...de.items.map((c) => ({ ...c, source: 'autobahn', name: `${c.road} · ${c.title}` })),
    ...windyCams,
    ...custom,
  ];
  return { status: `autobahn: ${de.status}; windy: ${windyStatus}; egne: ${custom.length}`, items };
}
