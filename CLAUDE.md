# Torque Deck — project guide for Claude Code

Installable OBD-II diagnostic **PWA** for Bluetooth ELM327 adapters. Plain HTML/CSS/JS,
**no build step, no framework, no bundler**. Hosted at https://odbii.bworldtools.com (spelled odbii; obdii does not resolve).
Public repo: https://github.com/weellio/torquedeck (MIT) — never commit `.env`.
Keep it dependency-free and vanilla — do not introduce React/Vite/TypeScript/webpack.

## Run & test locally
- Serve over HTTP on **localhost** (localhost counts as a secure context, so Web Bluetooth,
  Web Serial, geolocation and the service worker all work on desktop Chrome/Edge):
  `python -m http.server 5512`  →  open http://localhost:5512 (5512 is this project's registered port)
- Phones can't reach your localhost — to test on a phone, deploy to the HTTPS host.
- No hardware needed: the **Demo car** button (`#wDemo`) runs a full simulated ELM327
  (`SimTransport` in obd.js) so every screen works offline.

## Files
- **index.html** — all markup + all CSS (single `<style>`). Bottom nav tabs: Dash, Codes,
  Graph, Car, Mods, Terminal. Also the full-screen Driving mode + map overlay DOM, and modals.
- **app.js** — all UI logic, one big IIFE. Settings object `S` persisted to `localStorage`
  under key `td.settings` (saved codes under `td.codes`, VIN cache under `td.vin.<VIN>`).
  Contains: dashboard/tiles, gauge, graph, codes/DTC UI, Car/info, Mods tab, Terminal + My
  codes, themes, Driving mode (tiles grid + MapLibre map), directions/traffic, Help/credits.
- **obd.js** — the engine, usable in browser (`window.OBD`) and Node (`module.exports`):
  - transports: `BleTransport` (Web Bluetooth LE), `SerialTransport` (Web Serial — classic
    BT/USB), `SimTransport` (demo car).
  - `Elm327` — serialized command queue; `init()`, `readPid()`, `readDtcs()`, `clearDtcs()`,
    `status()`, `info()`, `freezeFrame()`.
  - `PIDS`, `EXTRA`, `DTC_DB`, `dtcDescription()`, parsers (`parseFrames`, `decodePid`,
    `decodeDtcs`, …), and `decodeVin()`.
- **mods.js** — `window.MODS`: `V` (vehicles), `A` (accessories), `TOOLS`, `MAKE_TOOL`.
- **maplibre-gl.js / maplibre-gl.css** — vendored MapLibre GL JS. **Do not edit**; replace
  wholesale to upgrade.
- **sw.js** — service worker. Caches the app shell only. **Must stay same-origin** (it
  deliberately does NOT intercept cross-origin map tiles / routing APIs).
- **manifest.json**, **icon-192.png**, **icon-512.png** — PWA install.

## Conventions
- Helpers in app.js: `$`/`$$` (query), `sheet()`/`closeSheet()` (bottom-sheet modals),
  `confirmSheet()`, `toast()`, `esc()`, `save()`.
- `S` holds all settings; change defaults where `S = Object.assign({…}, S)`.
- **Themes** are CSS custom properties (`--bg`, `--accent`, …). JS/canvas colors read them
  via `cssVar('--x')`; after any theme or redline change call the relevant re-render
  (`applyTheme`, `buildGauge`, `drawChart`).
- **Map**: MapLibre GL. Styles live in `MAPSTYLES` — Dark/Streets/Light are free no-key
  **OpenFreeMap vector** styles (3D buildings), Satellite is Esri raster. 3D terrain uses the
  free AWS Terrarium DEM. "Tiles loaded" is detected via the map `data` event (a real tile);
  the dark overlay is `showMapFallback()`/`hideMapFallback()` — only shows on genuine failure.

## Hard constraints / gotchas
- Secure context (HTTPS or localhost) is **required** for Bluetooth, Serial, geolocation, SW.
- Keep all map/routing providers **free and keyless** by default: OpenFreeMap (vector tiles),
  Esri (satellite), AWS Terrarium (terrain), OSRM public server (routing). TomTom is **optional**
  — the user pastes their own key (`S.map.tomtom`) to unlock live traffic + traffic-aware routing.
- Esri tile URLs are `{z}/{y}/{x}`; OSM/most others are `{z}/{x}/{y}`.
- The service worker must never intercept cross-origin requests (that once greyed out the map).
- **Every deploy: bump the `CACHE` version in sw.js** (e.g. `torque-deck-vN`) or phones serve
  a stale cached build. Then hard-refresh.

## Safety rules — keep enforced, do not weaken
- No vehicle **key / immobilizer programming** (not possible with a generic ELM327, and it's
  theft-enabling). Don't add it.
- The Terminal confirms any **write/reset/routine/security/clear** command before sending, and
  is gated behind a one-time "use at your own discretion" agreement. Keep both.
- Never add features to defeat **emissions or safety** systems. "My codes" stores only
  user-supplied, user-verified commands.

## Deploy (odbii.bworldtools.com, Hostinger)
`python deploy.py` bumps the sw.js cache version and uploads the app files + `.htaccess` over
FTPS (creds in `.env`, which is gitignored). `python deploy.py --list` is read-only. The FTP login
dir IS the web root; never cwd to `torquedeck_FTP_ROOT`. Hostinger presents a `*.hstgr.io`
cert, so deploy.py verifies the chain and that cert name instead of the hostname.
Then hard-refresh on the phone.

## Layout rules (mobile)
- Driving board: 4 columns portrait, 8 landscape (same board as two halves). `fitDrive()`
  stretches the used rows to fill the screen and scrolls only below 58px rows.
- Short landscape (`max-height:540px`) has its own block at the end of the `<style>`: compact
  nav, gauge beside tiles, map controls in a row, route panel on the left.
- Map overlays sit 36px up to clear the OSM attribution; `--rp`/`--rpw` (set by a
  ResizeObserver on `#dRoutePanel`) move them out of the route panel's way.
- Re-check layout with Playwright at 390x844, 360x740, 375x667, 844x390, 740x360, 568x320.
