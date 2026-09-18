// Persistent 112 statistics. Every alarm the poller sees is appended once to
// server/cache/alarm-log.json (compact rows), and counts are aggregated on request:
// per month → per region → per headline. Headline = the message before the first dash
// ("Bygn.brand-Villa/Rækkehus" → "Bygn.brand"). Configurable ignore list (default: Eftersyn).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './bbox.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache', 'alarm-log.json');

let rows = []; // [id, time, region, headline, station, beredskab, message]
const ids = new Set();
let saveTimer = null;
let ignore = ['Eftersyn'];

try {
  rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const r of rows) ids.add(r[0]);
  log('alarmstats', `loaded ${rows.length} logged alarms`);
} catch {}

export function setIgnore(list) {
  ignore = list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function headline(message) {
  return (message ?? '').split(/\s*-\s*/)[0].trim();
}

// Region from the station's position. Coarse but reliable enough for counting.
export function region(lat, lon, beredskab = '') {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    if (lon > 14.5) return 'Bornholm';
    if (lon > 11.0) return lat > 55.55 && lon > 12.15 ? 'Hovedstaden' : 'Sjælland';
    // Fyn vs Jutland along Lillebælt: Middelfart 9.73 vs Fredericia 9.76 at the narrow point;
    // Als (down to 10.05) is Jutland, Ærø (from 10.2) is Fyn.
    const fyn = (lat < 55.53 && lon > 9.70 && !(lat < 55.08 && lon < 10.12)) || (lat >= 55.53 && lat < 55.65 && lon > 9.85);
    if (fyn) return 'Fyn';
    if (lat > 56.6) return 'Nordjylland';
    if (lat > 55.85) return 'Midtjylland';
    return 'Sydjylland';
  }
  const b = beredskab.toLowerCase();
  if (/bornholm/.test(b)) return 'Bornholm';
  if (/hovedstadens|beredskab øst|tårnby|dragør|frederiksborg|nordsjælland|helsingør|gentofte|lyngby/.test(b)) return 'Hovedstaden';
  if (/sjælland|slagelse|lolland|falster|roskilde|køge|greve|næstved|vordingborg|holbæk|kalundborg|odsherred|lejre|sorø|ringsted|faxe|stevns|solrød/.test(b)) return 'Sjælland';
  if (/fyn|odense|langeland|ærø|assens|svendborg|nyborg|middelfart|faaborg|kerteminde/.test(b)) return 'Fyn';
  if (/nordjyll|aalborg|hjørring|frederikshavn|thisted|mors|mariagerfjord|vesthimmerland|jammerbugt|brønderslev|rebild|læsø/.test(b)) return 'Nordjylland';
  if (/midtjy|østjyll|nordvestjyll|beredskab & sikkerhed|midtvest|sydøstjyll|horsens|hedensted|silkeborg|ikast|herning|viborg|skive|lemvig|struer|holstebro|randers|aarhus|djurs|favrskov|skanderborg|odder|samsø/.test(b)) return 'Midtjylland';
  if (/sønderjyll|sydvestjy|trekant|vejle|sønderborg|esbjerg|varde|vejen|billund|kolding|fredericia|haderslev|aabenraa|tønder|fanø/.test(b)) return 'Sydjylland';
  return 'Ukendt';
}

export function record(alarms) {
  let added = 0;
  for (const a of alarms) {
    if (ids.has(a.id)) continue;
    const h = headline(a.message);
    if (!h || ignore.includes(h.toLowerCase())) { ids.add(a.id); continue; }
    ids.add(a.id);
    rows.push([a.id, a.time, region(a.lat, a.lon, a.beredskab), h, a.station, a.beredskab, (a.message ?? '').replace(/\s+/g, ' ').trim()]);
    added++;
  }
  // Rows logged before their station was geocoded: fix the region once coordinates exist
  for (const a of alarms) {
    if (!Number.isFinite(a.lat)) continue;
    const r = rows.find((x) => x[0] === a.id && x[2] === 'Ukendt');
    if (r) { r[2] = region(a.lat, a.lon, a.beredskab); added++; }
  }
  if (added) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(rows));
    }, 2000);
  }
  return added;
}

const monthKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function months() {
  return [...new Set(rows.map((r) => monthKey(r[1])))].sort();
}

export function stats(month, detailed = true) {
  const inMonth = rows.filter((r) => monthKey(r[1]) === month);
  const regions = {};
  const headlines = {};
  let total = 0;
  for (const [, , reg, hl, , , msg] of inMonth) {
    const h = detailed ? msg || hl : hl;
    regions[reg] ??= { total: 0, headlines: {} };
    regions[reg].total++;
    regions[reg].headlines[h] = (regions[reg].headlines[h] ?? 0) + 1;
    headlines[h] = (headlines[h] ?? 0) + 1;
    total++;
  }
  const first = inMonth.length ? Math.min(...inMonth.map((r) => r[1])) : null;
  return { month, total, from: first, regions, headlines, months: months() };
}

export function csv(month) {
  const sel = month ? rows.filter((r) => monthKey(r[1]) === month) : rows;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return ['tid;region;kategori;melding;station;beredskab', ...sel.map((r) => [new Date(r[1]).toISOString(), r[2], r[3], r[6] ?? r[3], r[4], r[5]].map(esc).join(';'))].join('\n');
}
