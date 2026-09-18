// Road incidents from Vejdirektoratet. The trafikkort.vejdirektoratet.dk map is backed by a
// public GeoJSON feed (no key). The feed is an append-only log of event versions, so we keep
// the newest version per featureId and drop suspended (ended) ones.
// Attribution: Kilde: Vejdirektoratet / trafikinfo.dk
import { inBbox, log } from './bbox.js';

const URL = 'https://storage.googleapis.com/trafikkort-data/geojson/big-screen-events.json';
const UA = 'dk-live/0.1 (personal dashboard)';

let cache = { updated: 0, status: 'not started', events: [] };

const TYPES = {
  Accident: 'uheld',
  VehicleObstruction: 'havari',
  GeneralObstruction: 'forhindring',
  RoadOrCarriagewayOrLaneManagement: 'spærring',
  AbnormalTraffic: 'kø',
  PoorEnvironmentConditions: 'vejr',
  Roadworks: 'vejarbejde',
  MaintenanceWorks: 'vejarbejde',
  ConstructionWorks: 'vejarbejde',
  PublicEvent: 'begivenhed',
  GeneralInstructionOrMessageToRoadUsers: 'info',
};

const stripHtml = (s) =>
  (s ?? '')
    .replace(/<periodDescription>.*?<\/periodDescription>/gs, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>\s*<p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim();

// "13-09-2026 kl. 15:45" → ms
function dkTime(s) {
  const m = (s ?? '').match(/(\d{2})-(\d{2})-(\d{4}) kl\. (\d{2}):(\d{2})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : null;
}

async function poll() {
  try {
    const res = await fetch(URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const collections = await res.json();
    const latest = new Map(); // featureId -> feature
    for (const fc of collections) {
      for (const f of fc.features ?? []) {
        const p = f.properties ?? {};
        if (p.duplicate === 'true') continue; // extra points along a route; the first point is enough
        const id = p.featureId;
        if (!id) continue;
        const prev = latest.get(id);
        if (!prev || (p.lastModifiedString ?? '') > (prev.properties.lastModifiedString ?? '')) {
          f._layer = fc.layerName;
          latest.set(id, f);
        }
      }
    }
    const now = Date.now();
    const events = [];
    for (const f of latest.values()) {
      const p = f.properties;
      if (p.suspended === 'true' || p.future === 'true' || p.visible === 'false') continue;
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (typeof lat !== 'number' || !inBbox(lat, lon)) continue;
      const end = dkTime(p.endPeriod);
      if (end && end < now - 10 * 60_000) continue; // expired but not yet marked suspended
      const cls = (p.TrafficMan2_Type ?? '').split('.').pop();
      events.push({
        id: p.featureId,
        title: p.title,
        header: stripHtml(p.header),
        text: stripHtml(p.description),
        kind: TYPES[cls] ?? 'info',
        blocking: p.subtype === 'blocking' || (f._layer ?? '').includes('roadblock') || (f._layer ?? '').includes('blocking'),
        source: p.kommune,
        begin: dkTime(p.beginPeriod),
        end,
        modified: dkTime(p.lastModified),
        lat,
        lon,
      });
    }
    events.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
    cache = { updated: now, status: `ok, ${events.length} events`, events };
  } catch (err) {
    cache.status = `failed: ${err.cause?.code ?? err.message}`;
    log('traffic', 'poll failed:', cache.status);
  }
}

export function startTraffic(intervalSec) {
  poll();
  setInterval(poll, intervalSec * 1000);
  log('traffic', `polling Vejdirektoratet every ${intervalSec}s`);
}

export function getTraffic() {
  return cache;
}
