// Navigational warnings + firing exercises from the Danish Niord system (Nautisk Information,
// public REST API, no key): https://docs.niord.org/public-api/api.html
// Domains: niord-nw = navigational warnings, niord-fe = firing exercises (local warnings).
import { BBOX, log } from './bbox.js';

const UA = 'dk-live/0.1 (personal dashboard)';
// Niord moved from Søfartsstyrelsen to Beredskabsstyrelsen; try the known hosts in order and
// stick to the first that answers. NIORD_BASE in .env overrides.
const BASES = [process.env.NIORD_BASE, 'https://niord.dma.dk', 'https://nautiskinformation.soefartsstyrelsen.dk'].filter(Boolean);
let base = null;

let cache = { updated: 0, status: 'not started', warnings: [] };

const strip = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const desc = (descs, key) => (descs ?? []).find((d) => d.lang === 'da')?.[key] ?? (descs ?? [])[0]?.[key] ?? null;

// every coordinate pair of a GeoJSON geometry
function* coordsOf(g) {
  if (!g) return;
  if (g.type === 'GeometryCollection') for (const x of g.geometries ?? []) yield* coordsOf(x);
  else {
    const walk = function* (c) {
      if (typeof c?.[0] === 'number') yield c;
      else for (const x of c ?? []) yield* walk(x);
    };
    yield* walk(g.coordinates);
  }
}
const touchesBbox = (g) => {
  for (const [lon, lat] of coordsOf(g)) if (lat >= BBOX.south - 0.5 && lat <= BBOX.north + 0.5 && lon >= BBOX.west - 0.5 && lon <= BBOX.east + 0.5) return true;
  return false;
};

async function fetchFrom(b) {
  const q = 'domain=niord-nw&domain=niord-fe&lang=da&dateFormat=UNIX_EPOCH';
  const res = await fetch(`${b}/rest/public/v1/messages?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('unexpected response');
  return json;
}

async function poll() {
  try {
    let list = null;
    let lastErr = null;
    for (const b of base ? [base] : BASES) {
      try {
        list = await fetchFrom(b);
        if (base !== b) log('niord', `using ${b}`);
        base = b;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!list) {
      base = null; // re-probe all hosts next time
      throw lastErr ?? new Error('no host');
    }
    const warnings = [];
    for (const m of list) {
      const features = [];
      const details = [];
      for (const part of m.parts ?? []) {
        for (const f of part.geometry?.features ?? []) if (f.geometry && touchesBbox(f.geometry)) features.push(f.geometry);
        const d = strip(desc(part.descs, 'details'));
        if (d) details.push(d);
      }
      if (!features.length) continue;
      warnings.push({
        id: m.id,
        shortId: m.shortId ?? null,
        // firing exercises: own message series (…-fe) or "skydning" in the title
        kind: /(^|-)fe($|-)/i.test(m.messageSeries?.seriesId ?? '') || /skyd/i.test(desc(m.descs, 'title') ?? '') ? 'fe' : 'nw',
        title: desc(m.descs, 'title') ?? m.shortId ?? 'Advarsel',
        area: desc(m.areas?.[0]?.descs, 'name'),
        details: details.join('\n\n').slice(0, 600),
        from: m.publishDateFrom ?? m.eventDateFrom ?? null,
        to: m.publishDateTo ?? m.eventDateTo ?? null,
        geometries: features,
      });
    }
    cache = { updated: Date.now(), status: `ok, ${warnings.length} advarsler`, warnings };
  } catch (err) {
    cache.status = `failed: ${err.cause?.code ?? err.message}`;
    log('niord', 'poll failed:', cache.status);
  }
}

export function startNiord(intervalSec) {
  poll();
  setInterval(poll, intervalSec * 1000);
  log('niord', `polling navigationsadvarsler every ${intervalSec}s`);
}
export const getNiord = () => cache;
