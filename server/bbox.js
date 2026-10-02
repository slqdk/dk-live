// The area shown in the app. Change here and in public/app.js (BBOX) together.
export const BBOX = { west: 7.5, south: 53.3, east: 13.0, north: 57.9 };

export const CENTER = {
  lat: (BBOX.south + BBOX.north) / 2,
  lon: (BBOX.west + BBOX.east) / 2,
};

export function inBbox(lat, lon) {
  return lat >= BBOX.south && lat <= BBOX.north && lon >= BBOX.west && lon <= BBOX.east;
}

import { addLine } from './logbook.js';

export function log(scope, ...args) {
  console.log(new Date().toISOString().slice(11, 19), `[${scope}]`, ...args);
  addLine(scope, args);
}

// Danish wall-clock time ("02-10-2026 08:51" as shown by Danish sources) → epoch ms.
// The container runs in UTC, so new Date(y, m, d, h, mi) would read it as UTC and put every
// event 1–2 h in the future. Resolve the Europe/Copenhagen offset (CET/CEST) explicitly.
const cphFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Copenhagen', timeZoneName: 'shortOffset' });
const cphOffsetMin = (ms) => {
  const tz = cphFmt.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 60;
};
export function copenhagenTime(year, month, day, hour = 0, minute = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let t = wall - cphOffsetMin(wall) * 60_000;
  const off2 = cphOffsetMin(t); // second pass settles the DST-switch hours
  t = wall - off2 * 60_000;
  return t;
}
