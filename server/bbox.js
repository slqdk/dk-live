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
