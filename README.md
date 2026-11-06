# Torque Deck: free OBD-II scanner in your browser

Torque Deck turns a cheap Bluetooth ELM327 adapter and your phone into a car dashboard and
code reader. It is a web app you install from the browser. It has no app store, no account,
no ads and no backend.

**Use it now:** https://obdii.bworldtools.com/index.html
(open it in Chrome on Android, then ⋮ → **Install app**).
The site's front page is a short tour, and there is a [trouble code guide](https://obdii.bworldtools.com/codes/)
with a page for each of 169 common check engine codes.
No adapter? Tap **Try demo car** to try every screen with a simulated car.

## What it does
- **Dashboard:** RPM gauge with redline, big speed readout, and tiles you can customize (tap a tile to change it), with sparklines, min/max and warning colors.
- **Trouble codes:** stored, pending and permanent codes with descriptions. Also freeze frame, a safe clear (with a confirmation), and a search link for causes and fixes.
- **Graph:** up to 3 sensors on separate scales, over 30 s to 10 min. Record a drive and export it as CSV.
- **Car tab:** VIN with an offline make/year/country decode, calibration ID, ECU name, and emissions readiness monitors with a "ready for inspection" verdict. Settings live here too.
- **Driving mode:** a full-screen board for a phone mount, with big high-contrast tiles. Add, move and resize tiles, and pick big-number, bar or gauge style. Presets: Daily, Towing, Performance, Economy, Minimal. Works in portrait and landscape, and has a red night mode and a red flash on danger readings. Editing is locked while the car is moving.
- **Map view (driving mode):** MapLibre GL map with 3D tilt, heading-up and a follow-the-car camera, with your chosen dials floating on top. The free vector maps (OpenFreeMap) include 3D buildings, and there are Esri satellite imagery and optional 3D terrain. In-app **Directions** uses OSRM for free routing. Add your own free TomTom key to get live traffic and traffic-aware routes.
- **Mods:** the top-selling US vehicles plus SEMA favorites, and popular accessories. Each card lists common mods, the brand tool that changes settings (FORScan, AlfaOBD, BimmerCode…) and one-tap checks: GPS speedometer check, battery and charging test, drain watch, fuel-trim, towing and economy monitors.
- **My mods (Mods tab):** save your own changes to the car (coding, parts, tunes, settings). Store the commands that apply and undo each one, or just mark a part installed or removed. Record a timed test each way, from 30 s to 5 min, on up to 4 sensors. A table then compares stock against modded, averaged over every run. Copy a mod to try new values, and export or import your mods as a file. Changes are confirmed first and blocked while the car is moving.
- **Terminal:** raw AT/OBD commands, quick buttons, module addressing, a **Command list** of 57 AT, OBD and UDS commands (tap one to put it in the box), and a copyable log. Opens after a one-time "use at your own discretion" agreement.
- **Full list:** https://obdii.bworldtools.com/features.html lists every sensor, command, tool, vehicle guide, option and theme.
- **My codes:** save commands you have verified for your own vehicle and run them with one tap. Nothing comes pre-loaded. Every run goes through the same confirmation as the terminal.
- **Themes:** 14 themes, including High Contrast Dark/Light, Colorblind Safe (Okabe-Ito), Daylight and Red Night. Text size and Reduce motion settings.
- **Stays connected:** remembers your adapter. If the link drops it reconnects on its own. Classic Bluetooth and USB adapters also reconnect by themselves when you come back to the app. Bluetooth LE adapters take one tap on **Reconnect**, and the list shows only your adapter.
- **Get an adapter (Mods → Scanners):** adapters that work with Torque Deck, plus popular all-in-one scanners that use their own app.
- **Parts for the fix:** each trouble code with a known usual part (for example O2 sensor, ignition coil, gas cap) gets a **Shop** link that searches Amazon for that part for your car. Accessory cards in Mods have Shop links too.
- **Extras:** trip computer, instant fuel economy, all-sensors view with raw hex, mirrored HUD mode for windshield reflection, screen wake lock, vibration alerts, and **Copy report** to paste into an AI chat or text to a mechanic.

## Which adapters and phones work
| Adapter type | Android Chrome | Desktop Chrome/Edge | iPhone |
|---|---|---|---|
| Bluetooth LE (BLE) | ✅ Web Bluetooth | ✅ | ✅ in the **Bluefy** browser only |
| Bluetooth Classic (SPP): pair in phone settings first | ✅ Chrome 138+ (Web Serial) | ✅ | ❌ not possible |
| USB | — | ✅ | ❌ |

Tips:
- Close the adapter's own app first. An adapter talks to one app at a time.
- If live data is slow or drops out, set **Car → Polling speed → Gentle**.
- To clear codes, turn the ignition ON with the engine OFF.

## Affiliate links
Shop links go to Amazon. As an Amazon Associate, Torque Deck earns from qualifying purchases. This keeps the app free. The links never change what the app shows you about your car.

## Privacy
Everything runs on your phone. Settings, saved codes and logs stay in your browser's local
storage. The app only goes online to load map tiles, routes (OSRM, or TomTom if you add a key),
and the NHTSA VIN lookup when you tap it.

## Safety
- Torque Deck reads and monitors. It does not program keys or immobilizers, and it will not
  help defeat emissions or safety systems.
- The terminal asks you to confirm any write, reset, routine, security or clear command before
  it sends it.
- Don't use the terminal while driving. You are responsible for what you send. The software
  comes with no warranty (see [LICENSE](LICENSE)).

## Run it yourself
Plain HTML, CSS and JavaScript. No build step, no framework, no dependencies to install.

```
python -m http.server 5512
```
Then open http://localhost:5512. Localhost counts as a secure context, so Bluetooth, Serial,
GPS and the offline cache all work in desktop Chrome or Edge.

Engine quick test (Node, no browser):
```
node -e "const O=require('./obd.js'); console.log(O.decodePid('0C','410C1AF8'), O.decodeVin('1HGLM58718LA00000'))"
```

## Host your own copy
Bluetooth needs HTTPS. Any static host works.

**GitHub Pages (free, about 2 minutes):** fork this repo → Settings → Pages → Deploy from
branch → `main` / root. Then open `https://<you>.github.io/torquedeck/` on your phone.
Cloudflare Pages, Netlify, or a folder on your own domain work too.

On every deploy, bump the `CACHE` version in `sw.js` so phones pick up the new build.
On Apache, `dot-htaccess.txt` (renamed `.htaccess`) makes `/` show the landing page. Without it,
`/` opens the app directly, which is fine too.

## Files
| File | What it is |
|---|---|
| `index.html` | All markup and CSS |
| `app.js` | UI logic: dashboard, codes, graph, car, mods, terminal, themes, driving mode, map |
| `obd.js` | ELM327 engine: Bluetooth LE / Serial / demo transports, parsers, PIDs, trouble codes. Works in the browser and Node |
| `mods.js` | Vehicle and accessory guide data |
| `shop.js` | Adapter picks, trouble-code to part mapping, Amazon links (Associates tag) |
| `sw.js` | Offline cache for the app files only (never intercepts map tiles) |
| `home.html`, `features.html`, `codes/`, `sitemap.xml`, `robots.txt` | Landing page and trouble-code pages. **Generated**: edit `tools/build_pages.js` / `tools/code_content.js`, then run `node tools/build_pages.js` |
| `site.css`, `img/` | Styles and screenshots for the landing and code pages |
| `maplibre-gl.js/.css` | Bundled MapLibre GL JS v4.7.1 (BSD-3) |
| `manifest.json`, icons | Install as an app |
| `dot-htaccess.txt` | Optional Apache config (HTTPS redirect + headers). Rename to `.htaccess` |
| `deploy.py` | The maintainer's FTPS upload script. Reads credentials from a local `.env` that is not committed |

## Credits
Car tab → **Help & about** → **Open-source credits** lists the services the app relies on:
MapLibre, OpenFreeMap, OpenStreetMap, Esri, AWS terrain tiles, OSRM, TomTom and NHTSA.
OpenFreeMap hosts the free maps. If the map view is useful to you, consider donating to them.

## Contributing
Issues and pull requests are welcome. Please keep it dependency-free vanilla JS (no build
step), and keep the safety rules above intact.

## License
[MIT](LICENSE). Free to use, change and share.
