// Politi Update: short operational messages from the 12 police districts + Rigspolitiet,
// published through Via Ritzau as RSS (links from politi.dk/aktuelt/faa-politi-update-som-rssfeed).
// One RSS item per update; items sharing a release id are one case with several updates.
// The update texts live on the release page and are fetched on demand when a case is expanded.
import * as cheerio from 'cheerio';
import { log } from './bbox.js';

const RSS = 'https://via.ritzau.dk/rss/short-messages/latest?publisherId=';
const UA = 'dk-live/0.1 (personal dashboard; polls every 5 min)';
const KEEP_DAYS = 7;

export const DISTRICTS = [
  { id: 90686, name: 'Syd- og Sønderjyllands Politi', short: 'Syd- og Sønderjylland' },
  { id: 90720, name: 'Sydøstjyllands Politi', short: 'Sydøstjylland' },
  { id: 90721, name: 'Østjyllands Politi', short: 'Østjylland' },
  { id: 90687, name: 'Midt- og Vestjyllands Politi', short: 'Midt- og Vestjylland' },
  { id: 13562880, name: 'Nordjyllands Politi', short: 'Nordjylland' },
  { id: 90797, name: 'Fyns Politi', short: 'Fyn' },
  { id: 90594, name: 'Sydsjællands og Lolland-Falsters Politi', short: 'Sydsjælland/L-F' },
  { id: 13562881, name: 'Midt- og Vestsjællands Politi', short: 'Midt- og Vestsjælland' },
  { id: 90719, name: 'Nordsjællands Politi', short: 'Nordsjælland' },
  { id: 90718, name: 'Københavns Vestegns Politi', short: 'Kbh. Vestegn' },
  { id: 90685, name: 'Københavns Politi', short: 'København' },
  { id: 90799, name: 'Bornholms Politi', short: 'Bornholm' },
  { id: 90752, name: 'Rigspolitiet', short: 'Rigspolitiet' },
  { id: 13562884, name: 'National enhed for Særlig Kriminalitet', short: 'NSK' },
];

let cases = []; // newest first
let status = 'not started';
const detailCache = new Map(); // releaseId -> { at, data }

async function pollOne(d) {
  const res = await fetch(`${RSS}${d.id}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text(), { xmlMode: true });
  const out = [];
  $('item').each((_, el) => {
    const link = $(el).find('link').text().trim();
    const m = link.match(/pressemeddelelse\/(\d+)/);
    if (!m) return;
    out.push({ releaseId: m[1], title: $(el).find('title').text().trim(), time: Date.parse($(el).find('pubDate').text()), link });
  });
  return out.map((i) => ({ ...i, district: d.id }));
}

async function poll() {
  const items = [];
  let failed = 0;
  for (const d of DISTRICTS) {
    try {
      items.push(...(await pollOne(d)));
    } catch (err) {
      failed++;
      log('police', `${d.short} failed:`, err.cause?.code ?? err.message);
    }
    await new Promise((r) => setTimeout(r, 400)); // be gentle
  }
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const byRelease = new Map();
  for (const i of items) {
    if (!Number.isFinite(i.time) || i.time < cutoff) continue;
    const c = byRelease.get(i.releaseId) ?? { id: i.releaseId, district: i.district, title: i.title, first: i.time, last: i.time, updates: 0 };
    c.first = Math.min(c.first, i.time);
    if (i.time >= c.last) { c.last = i.time; c.title = i.title; }
    c.updates++;
    byRelease.set(i.releaseId, c);
  }
  cases = [...byRelease.values()].sort((a, b) => b.last - a.last);
  status = `ok, ${cases.length} sager${failed ? `, ${failed} kredse fejlede` : ''}`;
}

// Full timeline for one case, parsed from the release page.
export async function policeDetail(releaseId) {
  if (!/^\d+$/.test(releaseId)) throw new Error('bad id');
  const hit = detailCache.get(releaseId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const url = `https://via.ritzau.dk/pressemeddelelse/${releaseId}?lang=da`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text())
    .replace(/<(br|\/p|\/div|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim();
  let text = $('body').text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  // Keep only the part between the title and the subscription box
  const start = text.indexOf(title);
  const stop = text.search(/Abonner på (myndigheds)?meddelelser|Flere meddelelser fra/);
  text = text.slice(start >= 0 ? start + title.length : 0, stop > 0 ? stop : undefined);
  // Split on the per-update timestamp: "19.8.2026 16:43:11 CEST | Sydøstjyllands Politi"
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) CES?T\s*\|\s*[^\n]*/g;
  const marks = [...text.matchAll(re)];
  const updates = marks
    .map((m, i) => {
      const body = text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).replace(/^\s*Del\s*$/m, '').trim();
      const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6]}`;
      return { time: new Date(iso).getTime(), text: body };
    })
    .filter((u) => u.text);
  const data = { id: releaseId, title, url: `https://via.ritzau.dk/pressemeddelelse/${releaseId}`, updates };
  detailCache.set(releaseId, { at: Date.now(), data });
  if (detailCache.size > 300) detailCache.delete(detailCache.keys().next().value);
  return data;
}

export function startPolice(intervalSec) {
  poll();
  setInterval(poll, intervalSec * 1000);
  log('police', `polling ${DISTRICTS.length} Politi Update feeds every ${intervalSec}s`);
}

export const getPolice = () => ({ status, districts: DISTRICTS, cases });
