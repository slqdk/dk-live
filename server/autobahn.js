// German motorway data from the Autobahn GmbH open API (verkehr.autobahn.de, no key).
// One request per road per service; only the roads that reach into our bbox are polled.
// Kilde: Autobahn GmbH des Bundes (bund.dev)
import { inBbox, log } from './bbox.js';

const BASE = 'https://verkehr.autobahn.de/o/autobahn';
const UA = 'dk-live/0.1 (personal dashboard)';

// Motorways in or near Schleswig-Holstein / Hamburg.
const ROADS = ['A7', 'A1', 'A20', 'A21', 'A23', 'A24', 'A25', 'A26', 'A210', 'A215', 'A226', 'A252', 'A255', 'A261'];
const SERVICES = { warning: 'melding', closure: 'spærring', roadworks: 'vejarbejde' };

let events = { updated: 0, status: 'not started', items: [] };
let webcams = { updated: 0, status: 'not started', items: [] };

const num = (v) => (typeof v === 'string' ? parseFloat(v) : v);
const text = (d) => (Array.isArray(d) ? d.filter(Boolean).join('\n') : d ?? '').replace(/\s*\n\s*/g, '\n').trim();

async function get(road, service) {
  const res = await fetch(`${BASE}/${road}/services/${service}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json[service] ?? json[Object.keys(json)[0]] ?? [];
}

// Run jobs a few at a time so we don't hammer the API.
async function pool(jobs, size = 4) {
  const out = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length) {
        const job = queue.shift();
        try {
          out.push(...(await job()));
        } catch (err) {
          log('autobahn', `${job.label} failed:`, err.cause?.code ?? err.message);
        }
      }
    })
  );
  return out;
}

async function pollEvents() {
  const jobs = [];
  for (const road of ROADS) {
    for (const service of Object.keys(SERVICES)) {
      const job = async () =>
        (await get(road, service))
          .map((e) => {
            const lat = num(e.coordinate?.lat);
            const lon = num(e.coordinate?.long);
            if (!Number.isFinite(lat) || !inBbox(lat, lon)) return null;
            return {
              id: e.identifier ?? `${road}-${service}-${lat},${lon}`,
              road,
              kind: SERVICES[service],
              title: (e.title || e.subtitle || road).trim(),
              subtitle: (e.subtitle ?? '').trim(),
              text: text(e.description),
              blocked: e.isBlocked === 'true' || e.isBlocked === true,
              future: e.future === true || e.future === 'true',
              start: e.startTimestamp ? Date.parse(e.startTimestamp) : null,
              lat,
              lon,
            };
          })
          .filter(Boolean);
      job.label = `${road}/${service}`;
      jobs.push(job);
    }
  }
  const items = (await pool(jobs)).filter((e) => !e.future);
  const seen = new Set();
  const unique = items.filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
  events = { updated: Date.now(), status: `ok, ${unique.length} events`, items: unique };
}

async function pollWebcams() {
  const jobs = ROADS.map((road) => {
    const job = async () =>
      (await get(road, 'webcam'))
        .map((c) => {
          const lat = num(c.coordinate?.lat);
          const lon = num(c.coordinate?.long);
          if (!Number.isFinite(lat) || !inBbox(lat, lon)) return null;
          return {
            id: c.identifier ?? `${road}-${lat},${lon}`,
            road,
            title: (c.title || c.subtitle || road).trim(),
            subtitle: (c.subtitle ?? '').trim(),
            operator: c.operator ?? null,
            image: c.imageurl ?? null,
            link: c.linkurl ?? null,
            lat,
            lon,
          };
        })
        .filter(Boolean);
    job.label = `${road}/webcam`;
    return job;
  });
  const items = (await pool(jobs)).filter((c) => c.image);
  webcams = { updated: Date.now(), status: `ok, ${items.length} webcams`, items };
}

export function startAutobahn(intervalSec) {
  const run = async (fn, name) => {
    try {
      await fn();
    } catch (err) {
      log('autobahn', `${name} failed:`, err.cause?.code ?? err.message);
    }
  };
  run(pollEvents, 'events');
  run(pollWebcams, 'webcams');
  setInterval(() => run(pollEvents, 'events'), intervalSec * 1000);
  setInterval(() => run(pollWebcams, 'webcams'), 30 * 60_000); // camera list rarely changes
  log('autobahn', `polling ${ROADS.length} roads every ${intervalSec}s`);
}

export const getAutobahn = () => events;
export const getWebcams = () => webcams;
