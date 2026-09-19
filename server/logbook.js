// In-memory log buffer and visitor register, both readable only from the admin network.
// The log mirrors everything log() writes to the console; visitors are aggregated per IP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache', 'visitors.json');
const MAX_LINES = 800;

const lines = [];
let seq = 0;
const visitors = new Map(); // ip -> record
let saveTimer = null;

try {
  for (const v of JSON.parse(fs.readFileSync(FILE, 'utf8'))) visitors.set(v.ip, v);
} catch {}

export function addLine(scope, args) {
  lines.push({
    n: ++seq,
    t: Date.now(),
    scope,
    text: args
      .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(' '),
  });
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function getLines(since = 0) {
  return { lines: since ? lines.filter((l) => l.n > since) : lines.slice(-300), last: seq };
}

const clean = (ip) => (ip ?? '').replace(/^::ffff:/, '');

export function recordVisit(req, isAdmin) {
  const ip = clean(req.socket.remoteAddress);
  if (!ip) return;
  const now = Date.now();
  const isPage = !req.path.startsWith('/api/');
  const v = visitors.get(ip) ?? { ip, first: now, last: now, pages: 0, requests: 0, ua: '', admin: false };
  v.last = now;
  v.requests++;
  if (isPage) v.pages++;
  v.admin = isAdmin;
  const ua = req.get('user-agent') ?? '';
  if (ua && ua !== v.ua) v.ua = ua;
  visitors.set(ip, v);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify([...visitors.values()]));
    } catch {}
  }, 10_000);
}

// Rough device name from the user agent — enough to tell the phone from the PC.
function device(ua) {
  if (!ua) return 'ukendt';
  if (/bot|curl|wget|python|node/i.test(ua)) return 'script/bot';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '?';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '?';
  return `${os} · ${br}`;
}

export function getVisitors() {
  const now = Date.now();
  return [...visitors.values()]
    .map((v) => ({ ...v, device: device(v.ua), online: now - v.last < 90_000 }))
    .sort((a, b) => b.last - a.last);
}

export function forgetVisitors() {
  visitors.clear();
  try { fs.unlinkSync(FILE); } catch {}
}
