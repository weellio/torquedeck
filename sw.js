// Offline cache for the APP SHELL ONLY. Map tiles, routing and other cross-origin
// requests pass straight through — the service worker must never intercept them,
// or MapLibre's tiles/styles/fonts can fail.
const CACHE = 'torque-deck-v16';
const SHELL = ['./', './index.html', './app.js', './obd.js', './mods.js', './maplibre-gl.js', './maplibre-gl.css', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Only handle same-origin requests (the app's own files). Let everything else
  // (map tiles, OpenFreeMap styles, OSRM/TomTom, Google Fonts) go to the network untouched.
  let url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
