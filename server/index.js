import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './bbox.js';
import { startFlights, getFlights, setFlightsInterval } from './flights.js';
import { startShips, getShips, setShipsKey } from './ships.js';
import { startOdin, getOdin, getOdinRaw, setKeepHours, setPages } from './odin.js';
import { startTraffic, getTraffic } from './traffic.js';
import { startWeather, getRadar, getLightning, setLightningKey } from './weather.js';
import { startTrains, getTrains, setTrainsKey } from './trains.js';
import { startAutobahn, getAutobahn } from './autobahn.js';
import { startWebcams, getAllWebcams, setWindyKey, windyImage } from './webcams.js';
import { startEnergy, getEnergy, setArea } from './energy.js';
import { startAirports, getAirports } from './airports.js';
import { aircraftPhoto, shipPhoto, setContact } from './photos.js';
import { forecast } from './forecast.js';
import { startPolice, getPolice, policeDetail } from './police.js';
import { stats as alarmStats, months as alarmMonths, csv as alarmCsv, setIgnore as setStatsIgnore } from './alarmstats.js';
import { getKey, setKey, onKeyChange, describeKeys, localOnly, isAdmin, PREFS, getPrefs, setPrefs, onPrefChange } from './settings.js';
import { getLines, getVisitors, recordVisit, forgetVisitors } from './logbook.js';
import { log as logLine } from './bbox.js';
import { setFlowKey, flowEnabled, flowTile } from './flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4200);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use((req, _res, next) => {
  recordVisit(req, isAdmin(req));
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0 }));

app.get('/api/flights', (_req, res) => res.json(getFlights()));
app.get('/api/ships', (_req, res) => res.json(getShips()));
app.get('/api/odin', (_req, res) => res.json(getOdin()));
app.get('/api/odin/raw', (_req, res) => res.json(getOdinRaw()));
app.get('/api/traffic', (_req, res) => res.json(getTraffic()));
app.get('/api/radar', (_req, res) => res.json(getRadar()));
app.get('/api/lightning', (_req, res) => res.json(getLightning()));
app.get('/api/trains', (_req, res) => res.json(getTrains()));
app.get('/api/autobahn', (_req, res) => res.json(getAutobahn()));
app.get('/api/webcams', (_req, res) => res.json(getAllWebcams()));
app.get('/api/webcams/windy/:id', async (req, res) => {
  try {
    const r = await windyImage(req.params.id);
    if (!r) return res.status(404).json({ error: 'no Windy key' });
    res.set('Cache-Control', 'no-store').json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.get('/api/energy', (_req, res) => res.json(getEnergy()));
app.get('/api/airports', (_req, res) => res.json(getAirports()));
app.get('/api/police', (_req, res) => res.set('Cache-Control', 'no-store').json(getPolice()));
app.get('/api/police/:id', async (req, res) => {
  try {
    res.json(await policeDetail(req.params.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.get('/api/forecast', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300').json(await forecast(Number(req.query.lat), Number(req.query.lon)));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.get('/api/stats/alarms', (req, res) => {
  const list = alarmMonths();
  const month = req.query.month ?? list.at(-1) ?? new Date().toISOString().slice(0, 7);
  res.set('Cache-Control', 'no-store').json(alarmStats(month, getPrefs().statsDetailed));
});
app.get('/api/stats/alarms.csv', (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="112-${req.query.month ?? 'alle'}.csv"`).send('\ufeff' + alarmCsv(req.query.month));
});
app.get('/api/photo/aircraft/:hex', async (req, res) => res.set('Cache-Control', 'public, max-age=3600').json((await aircraftPhoto(req.params.hex, req.query.reg, req.query.type)) ?? {}));
app.get('/api/photo/ship/:mmsi', async (req, res) => res.set('Cache-Control', 'public, max-age=3600').json((await shipPhoto(req.params.mmsi, req.query.name)) ?? {}));
app.get('/api/flow', (_req, res) => res.json({ enabled: flowEnabled() }));
app.get('/api/flow/:z/:x/:y.pbf', async (req, res) => {
  try {
    const buf = await flowTile(+req.params.z, +req.params.x, +req.params.y);
    if (!buf) return res.status(404).end();
    res.set('Content-Type', 'application/x-protobuf').set('Cache-Control', 'public, max-age=60').send(buf);
  } catch (err) {
    res.status(502).type('text').send(`TomTom: ${err.message} — see the server log for the reason`);
  }
});
// Public: every client needs the prefs to render. Keys never go here.
app.get('/api/whoami', (req, res) => res.json({ admin: isAdmin(req) }));
app.get('/api/logs', localOnly, (req, res) => res.set('Cache-Control', 'no-store').json({ ...getLines(Number(req.query.since) || 0), visitors: getVisitors() }));
app.post('/api/logs/forget-visitors', localOnly, (_req, res) => {
  forgetVisitors();
  logLine('logbook', 'visitor list cleared');
  res.json({ ok: true });
});
app.get('/api/config', (_req, res) => res.json({ prefs: getPrefs(), schema: PREFS }));
// Owner only: keys + prefs editing
app.get('/api/settings', localOnly, (_req, res) => res.json({ keys: describeKeys(), prefs: getPrefs(), schema: PREFS }));
app.post('/api/settings', localOnly, (req, res) => {
  try {
    const { keys = {}, prefs = {} } = req.body ?? {};
    for (const [id, value] of Object.entries(keys)) setKey(id, value);
    if (Object.keys(prefs).length) setPrefs(prefs);
    res.json({ keys: describeKeys(), prefs: getPrefs(), schema: PREFS });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/health', (_req, res) =>
  res.json({
    flights: getFlights().aircraft.length,
    ships: getShips().enabled ? getShips().ships.length : 'disabled',
    odin: getOdin().status,
    traffic: getTraffic().status,
    radar: getRadar().status,
    lightning: getLightning().status,
    trains: getTrains().status,
    autobahn: getAutobahn().status,
    webcams: getAllWebcams().status,
    energy: getEnergy().status,
    airports: getAirports().status,
    police: getPolice().status,
  })
);

startFlights(getPrefs().flightsPoll ?? Number(process.env.FLIGHTS_POLL ?? 15));
startShips(getKey('AISSTREAM_API_KEY'));
startOdin(Number(process.env.ODIN_POLL ?? 90));
startTraffic(Number(process.env.TRAFFIC_POLL ?? 180));
startWeather(getKey('DMI_LIGHTNING_KEY'));
startTrains(getKey('REJSEPLANEN_API_KEY'), Number(process.env.TRAINS_POLL ?? 60));
startAutobahn(Number(process.env.AUTOBAHN_POLL ?? 300));
startWebcams(getKey('WINDY_API_KEY'));
setArea(getPrefs().priceArea);
setKeepHours(getPrefs().alarmKeepHours);
setPages(getPrefs().alarmPages);
startEnergy(Number(process.env.ENERGY_POLL ?? 120));
startAirports();
startPolice(Number(process.env.POLICE_POLL ?? 300));

onPrefChange('flightsPoll', setFlightsInterval);
onPrefChange('alarmKeepHours', setKeepHours);
onPrefChange('alarmPages', setPages);
onPrefChange('priceArea', setArea);
setContact(getPrefs().contact);
setStatsIgnore(getPrefs().statsIgnore.split(','));
onPrefChange('statsIgnore', (v) => setStatsIgnore(v.split(',')));
onPrefChange('contact', setContact);
onKeyChange('AISSTREAM_API_KEY', setShipsKey);
onKeyChange('REJSEPLANEN_API_KEY', setTrainsKey);
onKeyChange('DMI_LIGHTNING_KEY', setLightningKey);
setFlowKey(getKey('TOMTOM_API_KEY'));
onKeyChange('TOMTOM_API_KEY', setFlowKey);
onKeyChange('WINDY_API_KEY', setWindyKey);

app.listen(PORT, HOST, () => log('server', `http://${HOST}:${PORT}`));
