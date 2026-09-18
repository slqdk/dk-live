# DK live

Live map of Denmark and northern Germany — flights, ships and 112 alarms on a dark
2D map with clickable regions. Runs locally; nothing leaves your machine except
requests to the public data sources.

## Run

```
npm install
cp .env.example .env      # optional: add AISSTREAM_API_KEY for ships
npm run dev
```

Open http://127.0.0.1:4200

Node 20+ is fine. No build step — `public/` is served as-is.

## What's in it

| Layer | Source | Key | Notes |
| --- | --- | --- | --- |
| Fly / Militærfly | adsb.lol | none | 10 s polls, dead-reckoned between polls. Military = adsb.lol `dbFlags` bit 0 |
| Skibe | AISStream | free | Websocket held open server-side, snapshot served to the browser |
| 112-alarmer | odin.dk/112puls | none | Scraped every 90 s. Plotted at the **responding fire station** (OSM), not the incident |
| Trafik | Vejdirektoratet (trafikkort GeoJSON feed) | none | Incidents, roadblocks, queues on state roads, ~3 min cadence. Webcams no longer exist — Vejdirektoratet removed them |
| Tog | Rejseplanen API 2.0 `journeypos` | free | Live train positions in the bbox, 1/min. Buses excluded via `products` mask in `server/trains.js` |
| Autobahn | verkehr.autobahn.de (Autobahn GmbH) | none | Warnings, closures and roadworks on 14 north-German motorways |
| Webcams | Autobahn GmbH + Windy Webcams API + `data/webcams-dk.json` | Windy: free | German motorway cameras (no key), Danish/other public cameras via Windy (key, attribution required), plus your own list. Off by default |
| Strøm DK1 | Energi Data Service (Energinet) | none | Wind/solar/central production, CO2 intensity, spot price, interconnector flow |
| Trafiktæthed | TomTom Traffic Flow tiles | free | Green/amber/red road colouring, proxied through the server. Off by default, 2,500 tiles/day on the free tier |
| Lufthavne | OurAirports + aviationweather.gov METAR | none | Runways, frequencies, live weather, aircraft on ground / nearby / inbound from the flight layers |
| Regnradar | RainViewer public API | none | Composite radar, latest frame, max native zoom 7 |
| Lyn | DMI lightningdata | free | Strikes in the last hour |
| Basemap | OpenFreeMap dark | none | Vector tiles, MapLibre GL |

## First-run checklist for 112

1. Open http://127.0.0.1:4200/api/odin/raw and look at `rows`.
2. If the columns are not `time, beredskab, station, message`, change `COLS` in `server/odin.js`.
3. Alarms whose station name didn't match an OSM fire station appear greyed in the list
   and not on the map. Improve `norm()` / add manual overrides in `geocode()` as you see them.
4. Attribution "Kilde: www.odin.dk/112puls" is required by Beredskabsstyrelsen and is shown
   in the list and popups. Don't lower `ODIN_POLL` below ~60 s.

## 112 statistics

Every alarm the poller sees is logged once to `server/cache/alarm-log.json` (id, time, region,
headline, station, beredskab). Open the 112 list → **Statistik** for a month-by-month table:
regions as columns, headlines as rows. `CSV` downloads the month's raw rows. The headline is the
message before the first dash; categories in ⚙ → Data → "112-statistik – ignorér" are skipped
(default: Eftersyn). The log lives in the Docker volume, so it survives rebuilds.

## Adding a layer

Server: a module in `server/` that polls/streams and exposes `getX()`; one route in `server/index.js`.
Client: a class in `public/layers/` with `init()`, `setVisible(on)`, `count`, `error`; register it in
`public/app.js` and add a row in `index.html`. Use `subscribe()` from `layers/feed.js` for polling.

Candidates: Vejdirektoratet webcams and incidents, DMI radar, Rejseplanen trains,
Energinet grid data, CelesTrak satellites (copy the SGP4 module from gods-eye-view).

## Running it on the LAN

`HOST=0.0.0.0` (now the default) exposes it on every interface. Open TCP 4200 in the firewall,
then http://<server-ip>:4200 from any device on the network. The API-key panel only answers to
loopback plus the CIDRs in `SETTINGS_ALLOW` — everything else gets the data but can't touch keys.

## Proxmox / Docker

```
docker compose up -d --build
```

`compose.yml` builds the image, maps port 4200, keeps keys and the geocode cache in a named
volume, and restarts on boot. Edit `SETTINGS_ALLOW` to your LAN before the first start.

Fresh Proxmox host without Docker yet: create a Debian 12 LXC (unprivileged is fine, 1 CPU / 512 MB is
plenty, enable *nesting* under Options → Features), then inside it:

```
apt update && apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
git clone <your repo> /opt/dk-live && cd /opt/dk-live
docker compose up -d --build
```

Update later with `git pull && docker compose up -d --build`. Logs: `docker compose logs -f`.
