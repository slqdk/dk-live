// Photos for popups.
//  Aircraft: Planespotters.net public API by ICAO hex (free; photographer credit + link required).
//  Ships:    Wikimedia Commons search by name (free, CC-licensed; may match a namesake).
// Results cached in memory for a day; misses cached for an hour.
import { log } from './bbox.js';

let contact = '';
export function setContact(c) {
  contact = (c ?? '').trim();
  log('photos', contact ? `Planespotters enabled, contact ${contact}` : 'no contact set — aircraft photos disabled (⚙ → Data → Kontakt)');
}
const ua = () => `dk-live/0.1 (${contact || 'no contact set'})`;
const UA = 'dk-live/0.1 (personal dashboard)';
const HIT_TTL = 24 * 3600_000, MISS_TTL = 3600_000;
const cache = new Map(); // key -> { at, value }

// Planespotters asks for gentle use: at most one request per second.
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1000;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

function remember(key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 5000) for (const [k, v] of cache) if (Date.now() - v.at > HIT_TTL) cache.delete(k);
  return value;
}
function cached(key) {
  const c = cache.get(key);
  if (!c) return undefined;
  if (Date.now() - c.at > (c.value ? HIT_TTL : MISS_TTL)) return undefined;
  return c.value;
}

export async function aircraftPhoto(hex, reg, type) {
  if (!contact) return null;
  const key = `ac:${hex}`;
  const c = cached(key);
  if (c !== undefined) return c;
  const tryUrl = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': ua(), Accept: 'application/json' } });
    if (res.status === 404) {
      log('photos', `${hex} → 404 (unknown to Planespotters)`);
      return null;
    }
    if (!res.ok) {
      log('photos', `${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
      throw new Error(`HTTP ${res.status}`);
    }
    const j = await res.json();
    const p = j.photos?.[0];
    if (!p) {
      log('photos', `${hex} → 200 but no photos: ${JSON.stringify(j).slice(0, 160)}`);
      return null;
    }
    log('photos', `${hex} → photo by ${p.photographer ?? '?'}`);
    return {
      thumb: p.thumbnail_large?.src ?? p.thumbnail?.src ?? null,
      link: p.link ?? null,
      credit: p.photographer ?? null,
      source: 'Planespotters.net',
    };
  };
  let photo = null;
  try {
    await throttle();
    const q = new URLSearchParams();
    if (reg) q.set('reg', reg);
    if (type) q.set('icaoType', type);
    photo = await tryUrl(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex.toUpperCase())}${q.size ? `?${q}` : ''}`);
  } catch (err) {
    log('photos', `aircraft ${hex} failed:`, err.cause?.code ?? err.message);
    return null; // don't cache an error as "no photo"
  }
  return remember(key, photo);
}

export async function shipPhoto(mmsi, name) {
  const key = `ship:${mmsi}`;
  const c = cached(key);
  if (c !== undefined) return c;
  let photo = null;
  const clean = (name ?? '').trim();
  if (clean.length >= 3) {
    try {
      const q = `"${clean}" (ship OR vessel OR ferry OR færge OR skib) filetype:bitmap`;
      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrlimit=5&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=480&format=json&origin=*`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const j = await res.json();
        const pages = Object.values(j.query?.pages ?? {});
        // prefer a file whose title actually contains the ship name
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9æøå]/g, '');
        const want = norm(clean);
        const pick = pages.find((p) => norm(p.title).includes(want)) ?? null;
        const ii = pick?.imageinfo?.[0];
        if (ii) {
          const meta = ii.extmetadata ?? {};
          photo = {
            thumb: ii.thumburl ?? ii.url,
            link: ii.descriptionurl ?? null,
            credit: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim() || null,
            license: meta.LicenseShortName?.value ?? null,
            source: 'Wikimedia Commons',
            uncertain: true,
          };
        }
      }
    } catch {}
  }
  return remember(key, photo);
}
