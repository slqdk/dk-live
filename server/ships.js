// Live vessels from AISStream (free key). One websocket subscription for the bbox;
// positions are kept in memory and served as a snapshot.
import WebSocket from 'ws';
import { BBOX, log } from './bbox.js';

const STALE_MS = 15 * 60 * 1000;
// AISStream sometimes stops sending without closing the socket (half-open), and it reports
// a bad key / overload as a JSON {error} message followed by a close. Both used to leave the
// layer silently empty; now a watchdog kills a socket that has been quiet for 90 s and
// reconnects with backoff (10 s → 5 min), and every server-side error is logged.
const SILENCE_MS = 90_000;
const ships = new Map(); // mmsi -> record
let ws = null;
let enabled = false;
let lastMsg = 0;
let retryMs = 10_000;
let lastError = null;
let watchdog = null;

function scheduleReconnect(apiKey, why) {
  if (apiKey !== currentKey) return;
  log('ships', `${why}, reconnecting in ${Math.round(retryMs / 1000)} s`);
  setTimeout(() => apiKey === currentKey && connect(apiKey), retryMs);
  retryMs = Math.min(retryMs * 2, 300_000);
}

function connect(apiKey) {
  const sock = new WebSocket('wss://stream.aisstream.io/v0/stream');
  ws = sock;
  lastMsg = Date.now(); // give the handshake the same 90 s grace

  clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (ws !== sock) return clearInterval(watchdog);
    if (Date.now() - lastMsg > SILENCE_MS) {
      lastError = `ingen data i ${Math.round((Date.now() - lastMsg) / 1000)} s`;
      log('ships', `no messages for ${Math.round((Date.now() - lastMsg) / 1000)} s, dropping socket`);
      clearInterval(watchdog);
      sock.terminate(); // fires 'close' → scheduleReconnect
    } else if (sock.readyState === WebSocket.OPEN) sock.ping();
  }, 30_000);

  ws.on('open', () => {
    sock.send(
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
    if (msg.error) {
      lastError = String(msg.error);
      return log('ships', 'AISStream error:', lastError);
    }
    lastMsg = Date.now();
    if (lastError || retryMs > 10_000) {
      if (lastError) log('ships', 'data flowing again');
      lastError = null;
      retryMs = 10_000;
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

  ws.on('close', (code, reason) => {
    if (ws !== sock) return;
    clearInterval(watchdog);
    const r = reason?.toString().trim();
    scheduleReconnect(apiKey, `socket closed (${code}${r ? ` ${r}` : ''})`);
  });
  ws.on('error', (err) => {
    lastError = err.message;
    log('ships', 'socket error:', err.message);
  });
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
    const old = ws;
    ws = null; // its close handler sees ws !== sock and stays quiet
    old.terminate();
  }
  clearInterval(watchdog);
  retryMs = 10_000;
  lastError = null;
  ships.clear();
  if (!apiKey) {
    enabled = false;
    return log('ships', 'no AISSTREAM_API_KEY, layer disabled');
  }
  enabled = true;
  connect(apiKey);
}

export function getShips() {
  const quiet = enabled && Date.now() - lastMsg > SILENCE_MS;
  return {
    enabled,
    status: !enabled ? 'disabled' : lastError || quiet ? `failed: ${lastError ?? 'ingen data'}` : 'ok',
    lastMessage: lastMsg || null,
    updated: Date.now(),
    ships: [...ships.values()].filter((s) => typeof s.lat === 'number'),
  };
}
