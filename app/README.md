# PitchTribe signage app

Self-hosted digital signage for clubs, in the spirit of [Anthias](https://anthias.screenly.io/).
One Node.js server runs on a Raspberry Pi. It has two parts:

- **Dashboard** (`/admin/`): a mobile-friendly web app where club volunteers upload content,
  build playlists, set timings and manage screens.
- **Player** (`/player/?screen=<id>`): the full-screen page each TV shows. On a Pi it runs in a
  Chromium kiosk that starts on boot.

## Features

| Area | What you get |
| --- | --- |
| **Content library** | Drag-and-drop upload of images (JPG/PNG/GIF/WebP/SVG) and videos (MP4/WebM/MOV), plus built-in slide types: **notices** (5 colour themes), **menu boards** (sections, prices, notes, *sold out*), **fixture lists** (past games hide themselves, countdown to the next one) and **web pages**. |
| **Playlists** | Drag to reorder (or up/down on phones), per-item duration, on/off toggle, a scrolling ticker, a clock overlay and a live preview. |
| **Timings** | Per-item start/end dates, days of the week and a daily time window, including windows that run past midnight (e.g. 18:00–01:00). Presets cover Weekdays, Weekends, Lunch, Evenings and Today only. Each item shows a status badge: *Live now*, *Scheduled*, *Off-hours* or *Expired*. |
| **Screens** | Screens register themselves on first connect. From the dashboard you can rename a screen, assign its playlist, rotate it for portrait mounting, see whether it's online and its resolution, flash its name with **Identify**, or **Reload** it remotely. |
| **Live scores** | Fixtures, live scores and results from the built-in [`signage-server`](../signage-server/README.md) sports engine (Premier League, Championship, SPFL, Champions League, NFL, NBA). Choose leagues in **Settings → Sports feeds**, then add **Live scores** slides to any playlist. Scores refresh every minute while matches are live and are pushed straight to screens. The engine's display page, JSON API and MCP endpoint are served at `/feeds`. |
| **Widgets** | From the same engine: **clock** (digital, analogue or countdown to kick-off), **weather** for your ground (Open-Meteo, no API key), **jokes** with a punchline reveal, club-spirit **phrases**, **Did you know?** trivia, a multiple-choice **quiz** with an answer reveal, **this day / week / month in sporting history** (optionally with general history from Wikipedia), and **spot the ball**. For spot the ball you mark the ball on your own photo; screens show a grid and a blurred patch, and reveal the answer at the time you choose. The answer isn't sent to screens before then. Jokes, phrases, trivia, quizzes and history are bundled, so they work offline. You can add your own lines, and a fresh selection is picked each day. |
| **Live updates** | Changes reach screens within about a second over Server-Sent Events, with a 60 s heartbeat poll as a fallback. |
| **Resilience** | Screens evaluate schedules locally and cache the last playlist, so they keep playing if the server restarts or the network drops. |
| **Security** | One admin password (scrypt), signed HttpOnly SameSite=Strict session cookies, a CSRF header check, login rate limiting and strict CSP. Uploaded files are served sandboxed. |

## Run it

```bash
cd app
npm ci                 # also links ../signage-server
npm start              # http://localhost:8080/admin/  (PORT, HOST, DATA_DIR, MAX_UPLOAD_MB)
npm test
```

Open the dashboard and create the admin password; a starter playlist with a welcome notice is
set up for you. Then open `http://<server>:8080/player/?screen=bar-tv` on any screen.
It appears under **Screens**, already playing the default playlist.

## Install on a Raspberry Pi

On Raspberry Pi OS Bookworm (Lite is fine), on a Pi 4 or Pi 5:

```bash
sudo apt-get install -y git
git clone https://github.com/pitchtribe/pitchtribe-display pitchtribe
sudo pitchtribe/deploy/install.sh
```

This installs Node 22, the server as `pitchtribe.service` on port 80 (data in `/var/lib/pitchtribe`),
and `pitchtribe-kiosk.service`, which is Chromium inside the `cage` Wayland kiosk on HDMI.
It also sets up mDNS so the dashboard is at `http://<hostname>.local`. Each Pi's screen id is
its hostname.

Running several screens? Install the full stack on one Pi (the hub). On every other Pi, install
only the kiosk and point it at the hub:

```bash
sudo PITCHTRIBE_SERVER=http://clubhouse.local pitchtribe/deploy/install.sh
```

Use `PITCHTRIBE_NO_KIOSK=1` for a headless server. Re-run the installer to upgrade; your data is kept.

## How it works

```
app/
  server.js               entry point
  lib/app.js              Express app: auth, dashboard API, player API, static files
  lib/store.js            JSON-file database (atomic writes) in DATA_DIR/db.json
  lib/hub.js              Server-Sent Events push to screens
  lib/auth.js             password hashing, signed session cookies, login limiter
  lib/validate.js         input sanitisers
  public/admin/           dashboard SPA (vanilla JS, no build step)
  public/player/          kiosk player
  public/shared/          schedule + text-format parsers, shared by server, dashboard and player
  lib/feeds.js            embeds ../signage-server (sports + widgets) and mounts it at /feeds
signage-server/           the engine (sports + widgets): a dependency of app/ (file:../signage-server), also runs standalone
deploy/                   Raspberry Pi installer, systemd units, kiosk launcher
```

Uploads go to `DATA_DIR/media/` under random file names and are cached as immutable.
To back up, copy `DATA_DIR`.

### API overview

| Method & path | Purpose |
| --- | --- |
| `GET /api/player/:screenId/manifest` | Screen's playlist (registers the screen; no login, LAN only) |
| `GET /api/player/:screenId/events` | SSE stream: `changed`, `identify`, `reload` |
| `POST /api/auth/setup` · `login` · `logout` | First-run setup and sessions |
| `GET /api/state` | Everything the dashboard needs |
| `POST /api/assets/upload` | Raw-body media upload (`Content-Type`, `X-Filename`) |
| `POST/PATCH/DELETE /api/assets[/:id]` | Notices, menus, fixtures, web pages, and media settings |
| `POST/PUT/DELETE /api/playlists[/:id]` | Playlists with items and timings |
| `PATCH/DELETE /api/screens/:id`, `POST /api/screens/:id/command` | Screen settings, identify and reload |
| `PUT /api/settings/sports`, `POST /api/sports/refresh` | Sports feed settings and manual refresh |
| `PUT /api/settings/widgets`, `GET /api/geocode?q=` | Weather location, Wikipedia on/off, place search |
| `GET /feeds/display`, `/feeds/api/*`, `/feeds/api/widgets/:kind` · `POST /feeds/mcp` | The engine's routes (POST needs its bearer token or a dashboard session) |

All dashboard calls need the session cookie, and every mutation also needs the `X-PitchTribe: 1` header.
