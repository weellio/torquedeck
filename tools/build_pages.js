/* Builds the static marketing/SEO pages from the app's own data:
     home.html (landing page, served at "/"), codes/index.html, codes/<code>.html (one per known code),
     sitemap.xml, robots.txt.
   Run after changing DTC_DB, shop.js or the copy below:   node tools/build_pages.js
   The app itself (index.html) stays build-free. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OBD = require(path.join(ROOT, 'obd.js'));
const SHOP = require(path.join(ROOT, 'shop.js'));
const { guidance, systemOf } = require('./code_content.js');

const SITE = 'https://obdii.bworldtools.com';
const GITHUB = 'https://github.com/weellio/torquedeck';
const TODAY = new Date().toISOString().slice(0, 10);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const DB = OBD.DTC_DB;
const CODES = Object.keys(DB).sort();
const slug = c => c.toLowerCase() + '.html';

function head({ title, desc, url, depth = 0, jsonld = [] }) {
  const up = depth ? '../' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#0b0d10">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Torque Deck">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/img/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${up}icon-192.png">
<link rel="apple-touch-icon" href="${up}icon-192.png">
<link rel="manifest" href="${up}manifest.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${up}site.css">
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="${up || './'}"><i></i>TORQUE DECK</a>
  <nav><a href="${up}#features">Features</a><a href="${up}#adapters">Adapters</a><a href="${up}codes/">Trouble codes</a><a href="${up}#faq">FAQ</a><a href="${GITHUB}">GitHub</a></nav>
  <a class="btn primary small" href="${up}index.html">Open the app</a>
</div></header>`;
}
function foot(depth = 0) {
  const up = depth ? '../' : '';
  return `<footer><div class="wrap">
  <div>Torque Deck is free and open-source (MIT) · <a href="${GITHUB}">Source on GitHub</a> · <a href="${up}codes/">Trouble code list</a></div>
  <div>${esc(SHOP.DISCLOSURE)}</div>
</div></footer>
<script>if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('${up}sw.js').catch(()=>{});</script>
</body>
</html>
`;
}
const shopBtn = part => `<a class="btn" rel="sponsored noopener" target="_blank" href="${SHOP.partUrl(part, '')}">Shop ${esc(SHOP.partLabel(part))} on Amazon ↗</a>`;
// shorten at a word boundary
const short = (s, n) => { s = s.split(/[(–]/)[0].trim(); if (s.length <= n) return s; return s.slice(0, s.lastIndexOf(' ', n)) + '…'; };

// ---------- landing page ----------
const POPULAR = ['P0300', 'P0420', 'P0171', 'P0455', 'P0442', 'P0128', 'P0301', 'P0401', 'P0440', 'P0174', 'P0430', 'P0456'].filter(c => DB[c]);
const FAQ = [
  ['Is Torque Deck really free?', 'Yes. There is no subscription, no account and no ads. It is open-source under the MIT license. Some links to adapters and parts are Amazon affiliate links, which help keep it free.'],
  ['What do I need?', 'A Bluetooth OBD2 adapter (ELM327 type, often about $20) and a phone or computer with Chrome. Plug the adapter into the port under the dashboard, turn the ignition on, open Torque Deck and tap Connect.'],
  ['Does it work on iPhone?', 'Yes, with a Bluetooth LE adapter, in the free Bluefy browser. Apple does not let Safari or Chrome on iPhone use Bluetooth. Classic Bluetooth adapters cannot be used from any iPhone browser.'],
  ['Which cars does it work with?', 'Any car or light truck with an OBD2 port: gasoline cars sold in the US from 1996, and most cars sold in Europe from 2001 (petrol) and 2004 (diesel).'],
  ['Can it clear the check engine light?', 'Yes. It reads stored, pending and permanent codes and can clear them after you fix the problem. Clearing a code does not fix the cause, and the light comes back if the fault is still there.'],
  ['Do I need to install anything?', 'No. It runs in the browser. You can add it to your home screen (Chrome menu → Install app) so it opens full-screen like a normal app, and it works offline.'],
  ['Is my data private?', 'Everything stays on your phone. Torque Deck has no server and no account. It only goes online for map tiles, routes and the optional VIN lookup.']
];

function landing() {
  const works = SHOP.SCANNERS.filter(s => s.works);
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Torque Deck', applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Android, Windows, macOS, ChromeOS, iOS (Bluefy)', url: SITE + '/', image: SITE + '/img/og.jpg',
      description: 'Free OBD2 scanner web app for Bluetooth ELM327 adapters: live engine data, trouble codes, graphs and a driving dashboard.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, license: 'https://opensource.org/licenses/MIT' },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  ];
  return head({ title: 'Torque Deck: Free OBD2 Scanner App for Bluetooth ELM327 Adapters', url: SITE + '/', jsonld,
    desc: 'Free OBD2 scanner that runs in your browser. Read and clear check engine codes, see live engine data, graph sensors and use a big driving dashboard. No app store, no account.' }) + `
<section class="hero"><div class="wrap">
  <div>
    <h1>Your car's computer, <em>on your phone.</em> Free.</h1>
    <p class="lead">Plug a cheap Bluetooth OBD2 adapter into your car. Torque Deck reads check engine codes, shows live engine data, graphs sensors and turns your phone into a big driving dashboard. No app store, no account, no ads.</p>
    <div class="btns"><a class="btn primary" href="index.html">Open the app</a><a class="btn" href="index.html#demo">Try the demo car</a></div>
    <p class="works">Works in Chrome on Android, Windows, Mac and ChromeOS, and in Bluefy on iPhone.</p>
  </div>
  <div class="phone"><img src="img/shot-dash.webp" width="390" height="844" alt="Torque Deck dashboard with RPM gauge, speed and live sensor tiles"></div>
</div></section>

<section><div class="wrap">
  <div class="shots">
    <figure><img src="img/shot-codes.webp" loading="lazy" width="390" height="844" alt="Trouble codes with descriptions and repair links"><figcaption>Read and clear codes</figcaption></figure>
    <figure><img src="img/shot-drive.webp" loading="lazy" width="390" height="844" alt="Driving mode with big tiles for speed, RPM, coolant and battery"><figcaption>Driving mode</figcaption></figure>
    <figure><img src="img/shot-map.webp" loading="lazy" width="390" height="844" alt="3D map view with live engine dials"><figcaption>Map with live dials</figcaption></figure>
    <figure><img src="img/shot-graph.webp" loading="lazy" width="390" height="844" alt="Live graph of RPM, speed and throttle"><figcaption>Live graphs and logs</figcaption></figure>
  </div>
</div></section>

<section class="alt" id="features"><div class="wrap">
  <h2>Everything a $100 scan app does</h2>
  <p class="sub">Without a subscription, and without handing your data to anyone.</p>
  <div class="grid">
    ${[['⚠️', 'Check engine codes', 'Stored, pending and permanent codes in plain English, freeze frame data, and a safe clear with a confirmation.'],
      ['📈', 'Live data and graphs', 'Up to 3 sensors on one graph, from 30 seconds to 10 minutes. Record a drive and export it to Excel as CSV.'],
      ['🚗', 'Driving mode', 'A full-screen board for a phone mount, portrait or landscape. Big tiles, gauges, presets and a red night mode.'],
      ['🗺️', 'Map with dials', '3D map with your engine readings floating on top, follow-the-car camera and free directions.'],
      ['✅', 'Inspection check', 'Emissions readiness monitors with a simple "ready for inspection" answer before you go to the test station.'],
      ['🔋', 'Battery and charging test', 'Checks the battery at rest and the alternator while running, plus a drain watch for parked cars.'],
      ['🔧', 'Mods guide', 'Common mods for the best-selling trucks and SUVs, and checks like a GPS speedometer test after a tire change.'],
      ['🔒', 'Private and offline', 'No account and no server. Install it to your home screen and it works without signal.']]
      .map(([i, t, d]) => `<div class="card"><div class="ic">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('\n    ')}
  </div>
</div></section>

<section><div class="wrap">
  <h2>How it works</h2>
  <p class="sub">About two minutes from opening the box to live data.</p>
  <div class="steps">
    <div class="card"><h3>Plug in the adapter</h3><p>The OBD2 port is under the dashboard, near your knees on the driver's side.</p></div>
    <div class="card"><h3>Turn the ignition on</h3><p>Key on or engine running. Classic Bluetooth adapters get paired in phone settings first (PIN 1234 or 0000).</p></div>
    <div class="card"><h3>Open Torque Deck and tap Connect</h3><p>Pick your adapter from the list. Next time, it reconnects for you.</p></div>
  </div>
</div></section>

<section class="alt" id="adapters"><div class="wrap">
  <h2>Which adapter to get</h2>
  <p class="sub">Any Bluetooth LE ELM327 adapter works on every phone. Classic Bluetooth adapters work on Android and computers. These are good picks.</p>
  <div class="grid">
    ${works.map(s => `<div class="card pick"><div class="row"><h3>${esc(s.name)}</h3><span class="pill ${s.best ? 'ok' : 'blue'}">${s.best ? 'Best pick' : esc(s.conn)}</span></div><p>${esc(s.what)}</p><a class="btn${s.best ? ' primary' : ''}" rel="sponsored noopener" target="_blank" href="${s.url}">${/\/s\?k=/.test(s.url) ? 'Search on Amazon' : 'View on Amazon'} ↗</a></div>`).join('\n    ')}
  </div>
  <div class="tablewrap" style="margin-top:22px"><table>
    <tr><th>Adapter type</th><th>Android (Chrome)</th><th>Computer (Chrome/Edge)</th><th>iPhone</th></tr>
    <tr><td>Bluetooth LE</td><td>✅</td><td>✅</td><td>✅ in Bluefy</td></tr>
    <tr><td>Classic Bluetooth</td><td>✅ Chrome 138+</td><td>✅</td><td>❌</td></tr>
    <tr><td>USB</td><td>—</td><td>✅</td><td>❌</td></tr>
  </table></div>
  <p class="disc">Scanners like BlueDriver and FIXD only work with their own apps, not Torque Deck. ${esc(SHOP.DISCLOSURE)}</p>
</div></section>

<section id="codes"><div class="wrap">
  <h2>Look up a trouble code</h2>
  <p class="sub">What it means, what usually causes it, and whether it's safe to keep driving.</p>
  <form class="lookup" id="lookup"><input id="code" placeholder="e.g. P0420" maxlength="5" autocomplete="off" aria-label="Trouble code"><button class="btn primary" type="submit">Look up</button></form>
  <div class="chips">${POPULAR.map(c => `<a class="chip" href="codes/${slug(c)}">${c}<small>${esc(short(DB[c], 30))}</small></a>`).join('')}</div>
  <p style="margin-top:16px"><a href="codes/">See all ${CODES.length} codes →</a></p>
</div></section>

<section class="alt" id="faq"><div class="wrap narrow">
  <h2>Questions</h2>
  ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n  ')}
</div></section>

<section><div class="wrap" style="text-align:center">
  <h2>Try it now, no adapter needed</h2>
  <p class="sub" style="margin:0 auto 22px">The demo car runs every screen with a simulated engine.</p>
  <div class="btns" style="justify-content:center"><a class="btn primary" href="index.html#demo">Try the demo car</a><a class="btn" href="${GITHUB}">View the source</a></div>
</div></section>
<script>
const KNOWN = ${JSON.stringify(CODES)};
document.getElementById('lookup').onsubmit = e => {
  e.preventDefault();
  const c = document.getElementById('code').value.trim().toUpperCase();
  location.href = KNOWN.includes(c) ? 'codes/' + c.toLowerCase() + '.html' : 'codes/?q=' + encodeURIComponent(c);
};
</script>
` + foot(0);
}

// ---------- one page per code ----------
function related(code) {
  const sys = systemOf(code), n = parseInt(code.slice(1), 16);
  return CODES.filter(c => c !== code && c[0] === code[0] && systemOf(c) === sys)
    .sort((a, b) => Math.abs(parseInt(a.slice(1), 16) - n) - Math.abs(parseInt(b.slice(1), 16) - n)).slice(0, 10).sort();
}
function codePage(code) {
  const desc = DB[code], g = guidance(code, desc), sys = systemOf(code), part = SHOP.partFor(code, desc);
  const generic = /^P0|^P2|^U0/.test(code), brand = (desc.match(/\(([A-Z][a-z]+)\)\s*$/) || [])[1];
  const url = `${SITE}/codes/${slug(code)}`;
  const title = `${code} Code: ${cap(desc)} | Causes and Fixes`;
  const metaDesc = `${code} means ${desc.replace(/\.$/, '')}. Common causes, whether it is safe to drive, and how to check it yourself with a free OBD2 app.`.slice(0, 300);
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Torque Deck', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Trouble codes', item: SITE + '/codes/' },
      { '@type': 'ListItem', position: 3, name: code, item: url }] },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
      { '@type': 'Question', name: `What does ${code} mean?`, acceptedAnswer: { '@type': 'Answer', text: `${code}: ${desc}. It is a ${sys.toLowerCase()} code.` } },
      { '@type': 'Question', name: `What causes ${code}?`, acceptedAnswer: { '@type': 'Answer', text: g.causes.join('; ') + '.' } },
      { '@type': 'Question', name: `Can I drive with ${code}?`, acceptedAnswer: { '@type': 'Answer', text: g.drive } }] }
  ];
  return head({ title, desc: metaDesc, url, depth: 1, jsonld }) + `
<main class="wrap narrow article">
  <div class="crumbs"><a href="../">Torque Deck</a> › <a href="./">Trouble codes</a> › ${code}</div>
  <div class="codehead">
    <div class="code">${code}</div>
    <h1>${esc(cap(desc))}</h1>
    <div class="meta"><span class="pill blue">${esc(sys)}</span><span class="pill">${generic ? 'Generic code (all makes)' : brand ? brand + '-specific code' : 'Manufacturer-specific code'}</span></div>
  </div>

  <h2>What ${code} means</h2>
  <p>Your car's computer set <b>${code}</b>: ${esc(desc)}. It belongs to the <b>${esc(sys.toLowerCase())}</b> group of codes.
  ${generic ? 'It is a generic code, so it means the same thing on every make.' : 'Manufacturers use codes in this range for their own meanings, so check that the description matches your car.'}
  The check engine light usually comes on once the fault has been seen on two drives in a row. Until then it shows up as a <b>pending</b> code.</p>

  <div class="callout warn"><p><b>Can I keep driving?</b> ${esc(g.drive)}</p></div>

  <h2>Common causes</h2>
  <ul>${g.causes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
  <p>Fix the cheapest, most likely cause first. Clearing the code without a repair only turns the light off until the fault comes back.</p>

  <h2>Check it yourself</h2>
  <p>${esc(g.check)}</p>
  <p>Torque Deck reads ${code} with a cheap Bluetooth OBD2 adapter. It also shows the freeze frame (engine conditions at the moment the code set) and the live data you need to narrow it down.</p>
  <div class="btns"><a class="btn primary" href="../index.html">Open Torque Deck</a><a class="btn" href="../#adapters">Which adapter to get</a></div>

  ${part ? `<h2>Parts</h2><p>Parts most often replaced for ${code}: <b>${esc(SHOP.partLabel(part))}</b>. Confirm the cause first, and match the part to your exact engine.</p><div class="btns">${shopBtn(part)}</div><p class="disc">${esc(SHOP.DISCLOSURE)}</p>` : ''}

  <h2>Related codes</h2>
  <div class="related">${related(code).map(c => `<a class="chip" href="${slug(c)}">${c}</a>`).join('')}</div>
  <p class="disc" style="margin-top:28px">This page explains what the code usually means. It is not a diagnosis of your car. When in doubt, ask a mechanic.</p>
</main>
` + foot(1);
}

// ---------- code index ----------
function codeIndex() {
  const groups = {};
  CODES.forEach(c => (groups[systemOf(c)] = groups[systemOf(c)] || []).push(c));
  const order = Object.keys(groups).sort((a, b) => CODES.indexOf(groups[a][0]) - CODES.indexOf(groups[b][0]));
  return head({ title: `OBD2 Trouble Codes: ${CODES.length} Check Engine Codes Explained | Torque Deck`, url: SITE + '/codes/', depth: 1,
    desc: `Plain-English meanings for ${CODES.length} common OBD2 check engine codes: P0300 misfire, P0420 catalyst, P0171 lean and more. Causes, urgency, and how to check them free.` }) + `
<main class="wrap article">
  <div class="crumbs"><a href="../">Torque Deck</a> › Trouble codes</div>
  <div class="codehead"><h1 style="font:700 clamp(30px,5vw,44px)/1.1 var(--num)">OBD2 trouble codes explained</h1>
  <p class="sub">${CODES.length} common check engine codes: what they mean, what usually causes them, and whether it is safe to drive.</p></div>
  <form class="lookup" id="lookup"><input id="code" placeholder="Filter, e.g. P04 or misfire" autocomplete="off" aria-label="Filter codes"></form>
  ${order.map(gname => `<section style="padding:18px 0" data-g><h2>${esc(gname)}</h2><div class="codelist">${groups[gname].map(c => `<a href="${slug(c)}" data-k="${esc((c + ' ' + DB[c]).toLowerCase())}"><b>${c}</b><span>${esc(cap(DB[c]))}</span></a>`).join('')}</div></section>`).join('\n  ')}
  <p id="none" class="sub" style="display:none">No code in this list matches. Read it with <a href="../index.html">Torque Deck</a> to see what your car reports.</p>
</main>
<script>
const box = document.getElementById('code');
function filter() {
  const q = box.value.trim().toLowerCase(); let shown = 0;
  document.querySelectorAll('.codelist a').forEach(a => { const ok = !q || a.dataset.k.includes(q); a.style.display = ok ? '' : 'none'; if (ok) shown++; });
  document.querySelectorAll('[data-g]').forEach(s => { s.style.display = [...s.querySelectorAll('a')].some(a => a.style.display !== 'none') ? '' : 'none'; });
  document.getElementById('none').style.display = shown ? 'none' : '';
}
box.oninput = filter;
document.getElementById('lookup').onsubmit = e => e.preventDefault();
const q = new URLSearchParams(location.search).get('q'); if (q) { box.value = q; filter(); }
</script>
` + foot(1);
}

// ---------- write ----------
fs.mkdirSync(path.join(ROOT, 'codes'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'home.html'), landing());
fs.writeFileSync(path.join(ROOT, 'codes', 'index.html'), codeIndex());
CODES.forEach(c => fs.writeFileSync(path.join(ROOT, 'codes', slug(c)), codePage(c)));
const urls = [SITE + '/', SITE + '/index.html', SITE + '/codes/', ...CODES.map(c => `${SITE}/codes/${slug(c)}`)];
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`home.html + codes/index.html + ${CODES.length} code pages + sitemap (${urls.length} urls)`);
