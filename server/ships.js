// Live vessels from AISStream (free key). One websocket subscription for the bbox;
// positions are kept in memory and served as a snapshot.
import WebSocket from 'ws';
import { BBOX, log } from './bbox.js';

const STALE_MS = 15 * 60 * 1000;
const ships = new Map(); // mmsi -> record
let ws = null;
let enabled = false;

function connect(apiKey) {
  ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[BBOX.south, BBOX.west], [BBOX.north, BBOX.east]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      })
    );
    log('ships', 'connected to AISStream');
  });

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const meta = msg.MetaData ?? {};
    const mmsi = meta.MMSI;
    if (!mmsi) return;
    const rec = ships.get(mmsi) ?? { id: mmsi, name: null, type: null, dest: null, firstSeen: Date.now() };

    if (msg.MessageType === 'PositionReport') {
      const p = msg.Message.PositionReport;
      rec.name = (meta.ShipName ?? '').trim() || rec.name;
      rec.lat = meta.latitude;
      rec.lon = meta.longitude;
      rec.cog = p.Cog ?? null;
      rec.sog = p.Sog ?? null; // knots
      rec.heading = p.TrueHeading === 511 ? null : p.TrueHeading;
      rec.navStatus = p.NavigationalStatus ?? null;
      rec.rot = p.RateOfTurn === -128 || p.RateOfTurn == null ? null : p.RateOfTurn; // °/min encoded
      rec.seen = Date.now();
    } else if (msg.MessageType === 'ShipStaticData') {
      const s = msg.Message.ShipStaticData;
      rec.name = (s.Name ?? '').trim() || rec.name;
      rec.type = s.Type ?? rec.type;
      rec.dest = (s.Destination ?? '').trim() || rec.dest;
      rec.imo = s.ImoNumber || rec.imo || null;
      rec.callsign = (s.CallSign ?? '').trim() || rec.callsign || null;
      const d = s.Dimension ?? {};
      if (d.A != null) {
        rec.length = (d.A ?? 0) + (d.B ?? 0) || null;
        rec.beam = (d.C ?? 0) + (d.D ?? 0) || null;
      }
      rec.draught = s.MaximumStaticDraught || rec.draught || null;
      const e = s.Eta ?? {};
      rec.eta = e.Month && e.Day ? { month: e.Month, day: e.Day, hour: e.Hour, minute: e.Minute } : rec.eta ?? null;
    }
    ships.set(mmsi, rec);
  });

  ws.on('close', () => {
    if (apiKey !== currentKey) return;
    log('ships', 'socket closed, reconnecting in 10 s');
    setTimeout(() => apiKey === currentKey && connect(apiKey), 10_000);
  });
  ws.on('error', (err) => log('ships', 'socket error:', err.message));
}

let currentKey = null;

export function startShips(apiKey) {
  setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [k, v] of ships) if (!v.seen || v.seen < cutoff) ships.delete(k);
  }, 60_000);
  setShipsKey(apiKey);
}

export function setShipsKey(apiKey) {
  currentKey = apiKey;
  if (ws) {
    ws.removeAllListeners('close');
    ws.close();
    ws = null;
  }
  ships.clear();
  if (!apiKey) {
    enabled = false;
    return log('ships', 'no AISSTREAM_API_KEY, layer disabled');
  }
  enabled = true;
  connect(apiKey);
}

export function getShips() {
  return {
    enabled,
    updated: Date.now(),
    ships: [...ships.values()].filter((s) => typeof s.lat === 'number'),
  };
}
