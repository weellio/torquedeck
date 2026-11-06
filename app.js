/* app.js — Torque Deck UI */
(() => {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const { PIDS, EXTRA } = OBD;

  // ---------- settings ----------
  const DEF = { units: 'imp', proto: '0', red: 6500, wake: '1', speed: 'normal',
    tiles: ['05', 'VBAT', '04', '11', '0F', 'MPG', '06', '07'], graph: ['0C', '0D', '11'], alerts: true, autoRe: '1', lastConn: null };
  let S = DEF;
  try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem('td.settings') || '{}')); } catch (e) { }
  const save = () => { try { localStorage.setItem('td.settings', JSON.stringify(S)); } catch (e) { } };

  // Warning / danger thresholds (metric). Tiles turn amber/red; optional alert toast + vibrate.
  const LIMITS = { '05': { warn: 105, bad: 112, label: 'Coolant hot' }, '5C': { warn: 125, bad: 135, label: 'Oil temp high' },
    'VBAT': { low: 12.0, lowBad: 11.6, warn: 14.9, bad: 15.3, label: 'Battery voltage' }, '42': { low: 12.0, lowBad: 11.6, warn: 14.9, bad: 15.3, label: 'ECU voltage' },
    '06': { absWarn: 15, absBad: 22, label: 'Short fuel trim B1' }, '07': { absWarn: 10, absBad: 18, label: 'Long fuel trim B1' },
    '08': { absWarn: 15, absBad: 22, label: 'Short fuel trim B2' }, '09': { absWarn: 10, absBad: 18, label: 'Long fuel trim B2' },
    '0C': { warnFn: () => S.red, label: 'Over redline' } };
  function level(pid, v) {
    const L = LIMITS[pid]; if (!L || v == null) return 0;
    if (L.absBad != null) return Math.abs(v) >= L.absBad ? 2 : Math.abs(v) >= L.absWarn ? 1 : 0;
    if (L.warnFn) return v >= L.warnFn() ? 2 : 0;
    if (L.lowBad != null && v <= L.lowBad && v > 3) return 2; if (L.low != null && v <= L.low && v > 3) return 1;
    return v >= L.bad ? 2 : v >= L.warn ? 1 : 0;
  }

  // ---------- state ----------
  let customHeader = false;
  let elm = null, transport = null, connected = false, demo = false, polling = false, wakeLock = null;
  const data = {};               // pid -> {v, min, max, hist:[[t,v]]}
  let lastStatus = null, lastCodes = null, lastFF = null, lastInfo = null, lastVin = null;
  let rec = null;
  const extraPoll = new Set();      // sensors a tool sheet needs right now                // {rows:[], cols:[]}
  const trip = { start: 0, dist: 0, fuel: 0, lastT: 0, maxSpd: 0 };
  const alerted = {};
  let cmdCount = 0, rateT = performance.now();

  const cssCache = {};
  const cssVar = n => cssCache[n] || (cssCache[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888');
  function withAlpha(c, al) { const m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; return c + Math.round(al * 255).toString(16).padStart(2, '0'); }
  const meta = pid => PIDS[pid] || EXTRA[pid] || { name: pid, short: pid, unit: '', min: 0, max: 100 };
  const imp = () => S.units === 'imp';
  function conv(pid, v) {
    const m = meta(pid);
    if (v == null || isNaN(v)) return { v: null, unit: imp() && m.imp ? m.imp[0] : m.unit, min: m.min, max: m.max };
    if (imp() && m.imp) return { v: m.imp[1](v), unit: m.imp[0], min: m.imp[2], max: m.imp[3] };
    return { v, unit: m.unit, min: m.min, max: m.max };
  }
  function fmt(v, pid) {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (pid === '0C' || pid === '1F' || pid === '21' || pid === '31' || a >= 1000) return Math.round(v).toLocaleString();
    if (pid === '14' || pid === '15' || pid === '18' || pid === '19' || pid === '44') return v.toFixed(3);
    if (a < 100) return v.toFixed(1);
    return Math.round(v).toString();
  }

  // ---------- UI helpers ----------
  let toastT;
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
  let sheetClose = null;
  function sheet(html, onMount, onClose) { if (sheetClose) { const f = sheetClose; sheetClose = null; f(); } $('#sheet').innerHTML = html; $('#scrim').classList.add('open'); sheetClose = onClose || null; onMount && onMount($('#sheet')); }
  function closeSheet() { $('#scrim').classList.remove('open'); if (sheetClose) { const f = sheetClose; sheetClose = null; f(); } }
  $('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeSheet(); });
  function confirmSheet(title, body, okLabel, danger) {
    return new Promise(res => sheet(`<h3>${title}</h3><p class="muted" style="line-height:1.5">${body}</p>
      <div class="row" style="margin-top:16px"><button class="grow" data-x="0">Cancel</button><button class="grow ${danger ? 'danger' : 'primary'}" data-x="1">${okLabel}</button></div>`,
      el => el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { closeSheet(); res(b.dataset.x === '1'); })));
  }
  async function copyText(txt, label) {
    try { await navigator.clipboard.writeText(txt); toast(label + ' copied'); }
    catch (e) { sheet(`<h3>${label}</h3><p class="small muted">Select all and copy:</p><textarea style="width:100%;height:50vh;font:12px ui-monospace,monospace;background:#06080a;color:#cfd8e0;border:1px solid var(--line);border-radius:10px;padding:8px">${txt.replace(/</g, '&lt;')}</textarea>`); }
  }
  function download(name, text, type = 'text/csv') {
    try {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    } catch (e) { copyText(text, name); }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- nav ----------
  let view = 'dash';
  function show(v) {
    if (v === 'term' && !termOk()) { openGate(); return; }
    view = v;
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v));
    $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    if (v === 'graph') { sizeChart(); drawChart(); }
    if (v === 'term') { renderCodes(); $('#term').scrollTop = 1e9; }
    if (v === 'mods') renderMods();
  }
  $$('nav button').forEach(b => b.onclick = () => show(b.dataset.v));

  // ---------- terminal log ----------
  const termLines = [];
  function log(kind, text) {
    const line = { kind, text, t: new Date() }; termLines.push(line); if (termLines.length > 600) termLines.shift();
    const d = document.createElement('div'); d.className = kind;
    d.textContent = (kind === 'tx' ? '> ' : kind === 'sys' ? '# ' : '') + text;
    const term = $('#term'); term.appendChild(d); while (term.childNodes.length > 600) term.firstChild.remove();
    if (view === 'term') term.scrollTop = 1e9;
  }

  // ---------- gauge ----------
  const G = { cx: 150, cy: 140, r: 118, a0: 150, sweep: 240 };
  const polar = (deg, r) => [G.cx + r * Math.cos(deg * Math.PI / 180), G.cy + r * Math.sin(deg * Math.PI / 180)];
  function arc(a1, a2, r) { const [x1, y1] = polar(a1, r), [x2, y2] = polar(a2, r); return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; }
  let gMax = 8000;
  function buildGauge() {
    gMax = Math.max(6000, Math.ceil((+S.red + 1000) / 1000) * 1000);
    const redA = G.a0 + G.sweep * (+S.red / gMax);
    let ticks = '';
    for (let k = 0; k <= gMax; k += 500) {
      const a = G.a0 + G.sweep * k / gMax, major = k % 1000 === 0;
      const [x1, y1] = polar(a, G.r - 14), [x2, y2] = polar(a, G.r - (major ? 26 : 20));
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${k >= S.red ? 'var(--bad)' : 'var(--faint)'}" stroke-width="${major ? 2.4 : 1.2}" stroke-linecap="round"/>`;
      if (major) { const [tx, ty] = polar(a, G.r - 40); ticks += `<text x="${tx}" y="${ty + 4}" font-size="12" font-weight="600" style="fill:var(--dim);font-family:var(--num)" text-anchor="middle">${k / 1000}</text>`; }
    }
    $('#gauge').setAttribute('viewBox', '0 0 300 215');
    $('#gauge').innerHTML = `
      <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" style="stop-color:var(--accent2)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <path d="${arc(G.a0, G.a0 + G.sweep, G.r)}" style="stroke:var(--line)" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="${arc(redA, G.a0 + G.sweep, G.r)}" style="stroke:color-mix(in srgb,var(--bad) 35%,transparent)" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path id="gArc" d="" stroke="url(#gg)" stroke-width="12" fill="none" stroke-linecap="round" filter="url(#glow)"/>
      ${ticks}`;
  }
  let shownRpm = 0;
  function setGauge(rpm) {
    shownRpm += ((rpm || 0) - shownRpm) * 0.5;
    const f = Math.max(0, Math.min(1, shownRpm / gMax));
    $('#gArc').setAttribute('d', f > 0.002 ? arc(G.a0, G.a0 + G.sweep * f, G.r) : '');
    $('#gArc').style.stroke = rpm >= S.red ? 'var(--bad)' : 'url(#gg)';
  }

  // ---------- tiles ----------
  function renderTiles() {
    const box = $('#tiles'); box.innerHTML = '';
    S.tiles.forEach((pid, i) => {
      const el = document.createElement('div'); el.className = 'tile'; el.dataset.pid = pid; el.dataset.i = i;
      const m = meta(pid);
      el.innerHTML = `<div class="lbl"><span>${esc(m.short)}</span><span class="st"></span></div><div class="val">—<small></small></div><div class="bar"><b></b></div><div class="mm"></div><canvas></canvas>`;
      el.onclick = () => pickPid(i);
      box.appendChild(el);
    });
    const add = document.createElement('div'); add.className = 'tile addtile'; add.textContent = '+ Add tile'; add.onclick = () => pickPid(S.tiles.length); box.appendChild(add);
    updateTiles(true);
  }
  function supportedHas(pid) { return !elm || !elm.supported.size || EXTRA[pid] || elm.supported.has(pid); }
  function updateTiles() {
    $$('#tiles .tile[data-pid]').forEach(el => {
      const pid = el.dataset.pid, d = data[pid], c = conv(pid, d && d.v);
      const sup = supportedHas(pid);
      el.classList.toggle('unsup', !sup);
      el.querySelector('.val').innerHTML = (sup ? fmt(c.v, pid) : 'n/a') + `<small>${sup ? esc(c.unit) : ''}</small>`;
      const lv = d ? level(pid, d.v) : 0;
      el.style.borderColor = lv === 2 ? 'var(--bad)' : lv === 1 ? 'var(--warn)' : '';
      el.querySelector('.st').textContent = !sup ? 'not supported' : lv === 2 ? '⚠' : '';
      const span = c.max - c.min, f = c.v == null ? 0 : Math.max(0, Math.min(1, (c.v - c.min) / span));
      el.querySelector('.bar b').style.width = (f * 100) + '%';
      el.querySelector('.bar b').style.background = lv === 2 ? 'var(--bad)' : lv === 1 ? 'var(--warn)' : '';
      if (d && d.min != null) { const x = [conv(pid, d.min).v, conv(pid, d.max).v].sort((p, q) => p - q); el.querySelector('.mm').textContent = `min ${fmt(x[0], pid)} · max ${fmt(x[1], pid)}`; }
      spark(el.querySelector('canvas'), d);
    });
  }
  function spark(cv, d) {
    if (!d || d.hist.length < 2) return;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    const dpr = devicePixelRatio || 1; if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const now = performance.now(), pts = d.hist.filter(p => now - p[0] < 30000); if (pts.length < 2) return;
    let lo = Infinity, hi = -Infinity; pts.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }); if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    ctx.beginPath(); pts.forEach((p, i) => { const x = w - (now - p[0]) / 30000 * w, y = h - 4 - (p[1] - lo) / (hi - lo) * (h - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    const ac = cssVar('--accent'); ctx.strokeStyle = ac; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(w - (now - pts[0][0]) / 30000 * w, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, withAlpha(ac, .33)); g.addColorStop(1, withAlpha(ac, 0)); ctx.fillStyle = g; ctx.fill();
  }
  function allPidList() {
    const list = Object.keys(EXTRA).concat(Object.keys(PIDS));
    return list.sort((a, b) => (supportedHas(b) - supportedHas(a)));
  }
  function pickPid(i) {
    const cur = S.tiles[i];
    const opts = allPidList().map(p => `<div class="opt ${p === cur ? 'sel' : ''}" data-p="${p}"><span>${esc(meta(p).name)}</span><small>${supportedHas(p) ? esc(conv(p, null).unit) : 'not supported'}</small></div>`).join('');
    sheet(`<h3>${cur ? 'Change tile' : 'Add tile'}</h3><p class="small muted">Sensors your car reports are listed first.</p>${cur ? '<button class="danger" id="rmTile" style="width:100%;margin:6px 0 8px">Remove this tile</button>' : ''}${opts}`, el => {
      el.querySelectorAll('.opt').forEach(o => o.onclick = () => { S.tiles[i] = o.dataset.p; save(); closeSheet(); renderTiles(); });
      const rm = el.querySelector('#rmTile'); if (rm) rm.onclick = () => { S.tiles.splice(i, 1); save(); closeSheet(); renderTiles(); };
    });
  }
  $('#editTiles').onclick = () => pickPid(S.tiles.length);
  $('#resetMM').onclick = () => { Object.values(data).forEach(d => { d.min = d.max = d.v; }); trip.start = performance.now(); trip.dist = trip.fuel = 0; trip.maxSpd = 0; updateTiles(); renderTrip(); toast('Min/max and trip reset'); };

  // ---------- trip ----------
  function renderTrip() {
    const el = $('#tripCard'); if (!el) return;
    const mins = trip.start ? (performance.now() - trip.start) / 60000 : 0;
    const distU = imp() ? trip.dist * 0.621371 : trip.dist, fuelU = imp() ? trip.fuel * 0.264172 : trip.fuel;
    const econ = trip.fuel > 0.01 && trip.dist > 0.1 ? (imp() ? (trip.dist * 0.621371) / (trip.fuel * 0.264172) : trip.fuel / trip.dist * 100) : null;
    const avg = mins > 0 ? distU / (mins / 60) : 0;
    el.innerHTML = [['Time', Math.floor(mins) + ':' + String(Math.floor(mins * 60 % 60)).padStart(2, '0')], ['Distance', distU.toFixed(1) + (imp() ? ' mi' : ' km')],
      ['Avg speed', avg.toFixed(0) + (imp() ? ' mph' : ' km/h')], ['Top speed', (imp() ? trip.maxSpd * 0.621371 : trip.maxSpd).toFixed(0)],
      ['Fuel used', fuelU.toFixed(2) + (imp() ? ' gal' : ' L')], ['Avg economy', econ == null ? '—' : econ.toFixed(1) + (imp() ? ' mpg' : ' L/100')]]
      .map(([k, v]) => `<div><div class="small muted">${k}</div><div style="font-family:var(--num);font-size:22px;font-weight:700">${v}</div></div>`).join('');
  }

  // ---------- record value ----------
  function put(pid, v) {
    if (v == null || isNaN(v)) return;
    const now = performance.now();
    let d = data[pid]; if (!d) d = data[pid] = { v, min: v, max: v, hist: [] };
    d.v = v; d.min = Math.min(d.min, v); d.max = Math.max(d.max, v);
    d.hist.push([now, v]); while (d.hist.length && now - d.hist[0][0] > 610000) d.hist.shift();
    const lv = level(pid, v);
    if (S.alerts && lv === 2 && (!alerted[pid] || now - alerted[pid] > 60000)) {
      alerted[pid] = now; toast('⚠ ' + (LIMITS[pid].label || meta(pid).name) + ': ' + fmt(conv(pid, v).v, pid) + ' ' + conv(pid, v).unit, 4000);
      try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch (e) { }
    }
  }

  // ---------- polling ----------
  const SPEEDS = { fast: 0, normal: 20, gentle: 150 };
  async function pollLoop() {
    if (polling) return; polling = true;
    let rr = 0;
    while (polling && connected && !customHeader) {
      const fast = ['0C', '0D'];
      const want = new Set(S.tiles.concat(S.graph).concat(view === 'sens' ? [] : []));
      if (want.has('MPG')) { want.add('10'); want.add('0D'); }
      if (rec) rec.extra.forEach(p => want.add(p));
      extraPoll.forEach(p => want.add(p));
      if (driveOn) S.drive.widgets.forEach(w => { if (w.kind === 'pid') want.add(w.pid); });
      want.delete('MPG'); fast.forEach(p => want.delete(p));
      const slow = [...want].filter(p => supportedHas(p));
      const batch = fast.filter(p => supportedHas(p)).concat(slow.length ? [slow[rr++ % slow.length], slow[rr++ % slow.length]] : []);
      for (const pid of [...new Set(batch)]) {
        if (!polling || !connected) break;
        try { put(pid, await elm.readPid(pid)); cmdCount++; elm.fails = 0; }
        catch (e) { elm.fails = (elm.fails || 0) + 1; if (elm.fails > 6) { lost('Adapter stopped responding'); break; } }
      }
      derive();
      if (rec) recordRow();
      await new Promise(r => setTimeout(r, 5));
    }
    polling = false;
  }
  function derive() {
    const now = performance.now(), spd = data['0D'] && data['0D'].v, maf = data['10'] && data['10'].v;
    let lph = null;
    if (data['5E'] && now - data['5E'].hist.at(-1)[0] < 3000) lph = data['5E'].v;
    else if (maf != null) lph = maf * 3600 / (14.7 * 745);         // gasoline stoich, g/L
    if (lph != null && spd != null) put('MPG', spd > 3 ? Math.min(40, lph / spd * 100) : null);
    if (spd != null) {
      if (!trip.start) { trip.start = now; trip.lastT = now; }
      const dt = (now - trip.lastT) / 3600000; trip.lastT = now;
      if (dt > 0 && dt < 0.01) { trip.dist += spd * dt; if (lph != null) trip.fuel += lph * dt; }
      trip.maxSpd = Math.max(trip.maxSpd, spd);
    }
  }

  // ---------- render loop ----------
  let lastTile = 0;
  function frame(t) {
    if (connected) {
      const rpm = data['0C'] && data['0C'].v, spd = conv('0D', data['0D'] && data['0D'].v);
      setGauge(rpm);
      $('#spd').textContent = spd.v == null ? '—' : Math.round(spd.v);
      $('#spdU').textContent = spd.unit;
      $('#rpmV').textContent = rpm == null ? '—' : Math.round(rpm).toLocaleString();
      if (hud) { $('#hudSpd').textContent = spd.v == null ? '—' : Math.round(spd.v); $('#hudU').textContent = spd.unit; $('#hudRpm').textContent = rpm == null ? '' : Math.round(rpm) + ' rpm'; }
      if (t - lastTile > 250) {
        lastTile = t;
        if (view === 'dash') { updateTiles(); renderTrip(); }
        if (view === 'graph') { drawChart(); updateChips(); }
        if (view === 'sens') renderSensors();
      }
      if (t - rateT > 1000) { $('#rate').textContent = (cmdCount * 1000 / (t - rateT)).toFixed(1) + ' reads/s'; cmdCount = 0; rateT = t; }
    }
    requestAnimationFrame(frame);
  }

  // ---------- connect ----------
  function setStatus(state, text) {
    $('#dot').className = state; $('#connInfo').textContent = text;
    $('#connBtn').textContent = state === 'on' ? 'Disconnect' : state === 'busy' ? 'Cancel' : S.lastConn ? 'Reconnect' : 'Connect';
    $('#connBtn').className = state === 'on' || state === 'busy' ? '' : 'primary';
  }
  function chooseConnection() {
    const ble = OBD.BleTransport.supported(), ser = OBD.SerialTransport.supported();
    if (!ble && !ser) return compatSheet();
    const L = S.lastConn;
    sheet(`<h3>Connect adapter</h3><p class="small muted" style="line-height:1.5">Plug the adapter into the port under the dash and turn the ignition <b>ON</b>. Not sure which type yours is? Try Bluetooth LE first. If it's not listed, pair it in your phone's Bluetooth settings (PIN is usually 1234 or 0000) and use Classic.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
        ${L ? `<button class="primary" id="cRe">Reconnect ${esc(L.name)}</button>` : ''}
        <button class="${L ? '' : 'primary'}" id="cBle" ${ble ? '' : 'disabled'}>Bluetooth LE adapter</button>
        <button id="cSer" ${ser ? '' : 'disabled'}>Bluetooth Classic (paired) / USB</button>
        <button class="ghost" id="cDemo">Demo car (no adapter)</button>
        <button class="ghost small" id="cShop">Don't have an adapter? See which ones work</button>
      </div>${!ser ? '<p class="small muted" style="margin-top:10px">Classic Bluetooth needs Chrome 138+ on Android, or Chrome/Edge on a computer.</p>' : ''}`, el => {
      const re = el.querySelector('#cRe'); if (re) re.onclick = () => { closeSheet(); reconnect(true); };
      el.querySelector('#cShop').onclick = scannerSheet;
      el.querySelector('#cBle').onclick = () => { closeSheet(); connect('ble'); };
      el.querySelector('#cSer').onclick = () => { closeSheet(); connect('serial'); };
      el.querySelector('#cDemo').onclick = () => { closeSheet(); connect('demo'); };
    });
  }
  function compatSheet() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    sheet(`<h3>Bluetooth isn't available here</h3><p class="muted" style="line-height:1.55">${ios
      ? 'iPhone Safari and Chrome on iOS don’t allow websites to use Bluetooth. Open this app in the free <b>Bluefy</b> browser from the App Store. It supports Bluetooth LE adapters. (Classic-Bluetooth adapters can’t be used from any iPhone browser.)'
      : 'This browser doesn’t support Web Bluetooth. Use <b>Chrome on Android</b> (or Chrome/Edge on a computer). The page must be served over HTTPS.'}</p>
      <button class="primary" style="width:100%;margin-top:10px" id="cDemo2">Explore with demo car</button>`, el => el.querySelector('#cDemo2').onclick = () => { closeSheet(); connect('demo'); });
  }
  // opts: { device | port } reconnect without a picker · { name } one-adapter picker ·
  //       quiet: no error sheet (background retries) · resume: keep the trip running · label: status text
  let connecting = false, wantLive = false, retryT = null, retries = 0;
  async function connect(kind, opts = {}) {
    if (connecting) return false;
    connecting = true; clearTimeout(retryT);
    try {
      transport = kind === 'demo' ? new OBD.SimTransport() : kind === 'serial' ? new OBD.SerialTransport() : new OBD.BleTransport();
      demo = kind === 'demo';
      setStatus('busy', opts.label || 'Pairing…');
      await transport.connect(opts);
      transport.onDisconnect = () => lost('Adapter disconnected');
      setStatus('busy', 'Talking to ' + transport.name + '…');
      log('sys', 'Connected to ' + transport.name);
      elm = new OBD.Elm327(transport, log);
      elm.delay = SPEEDS[S.speed] || 0;
      setStatus('busy', 'Waking up the car…');
      await elm.init(S.proto);
      connected = true; wantLive = true; retries = 0;
      if (!demo) rememberConn(kind);
      log('sys', `${elm.version} · ${elm.protocol} · ${elm.supported.size} PIDs supported`);
      setStatus('on', `${transport.name} · ${elm.protocol}`);
      $('#welcome').style.display = 'none'; $('#dash').style.display = '';
      renderTiles(); renderAdapter(); requestWake();
      Object.keys(data).forEach(k => delete data[k]);
      if (!opts.resume) { trip.start = 0; trip.dist = trip.fuel = trip.maxSpd = 0; }
      pollLoop();
      refreshStatus();
      if (!lastVin) elm.info().then(i => { lastInfo = i; lastVin = i.vin; renderInfo(); renderAdapter(); decodeNhtsa(i.vin, true); }).catch(() => { });
      return true;
    } catch (e) {
      connected = false; setStatus('', 'Not connected');
      try { transport && transport.disconnect(); } catch (_) { }
      if (opts.quiet) { log('sys', 'Reconnect failed: ' + (e && e.message)); return false; }
      if (e && (e.name === 'NotFoundError' || /cancel/i.test(e.message))) return false;
      log('sys', 'Error: ' + (e && e.message));
      const classic = kind === 'ble' && /service|characteristic|GATT|Unsupported/i.test(e.message);
      sheet(`<h3>Couldn't connect</h3><p class="muted" style="line-height:1.5">${esc(e.message || e)}</p>
        ${classic ? '<p class="small muted" style="line-height:1.5">This adapter may be <b>Classic Bluetooth</b>. Pair it in your phone settings, then choose “Bluetooth Classic (paired)”.</p>' : ''}
        <p class="small muted" style="line-height:1.5">Checklist: ignition ON · adapter LED lit · not connected to the old app at the same time · try again.</p>
        <div class="row" style="margin-top:8px"><button class="grow" id="errOther">Choose a different adapter</button><button class="primary grow" id="errOk">OK</button></div>`, el => {
        el.querySelector('#errOk').onclick = closeSheet;
        el.querySelector('#errOther').onclick = () => { closeSheet(); chooseConnection(); };
      });
      return false;
    } finally { connecting = false; updateReconnectUI(); renderAdapter(); }
  }
  // ---------- remember the adapter and reconnect to it ----------
  const autoOn = () => S.autoRe !== '0';
  function rememberConn(kind) {
    const t = transport;
    S.lastConn = { kind, name: t.name, id: (t.dev && t.dev.id) || null, info: t.port && t.port.getInfo ? Object.assign({}, t.port.getInfo()) : null };
    save();
  }
  // Without a tap we can only reopen adapters the browser still remembers; with a tap we can
  // also open the Bluetooth picker filtered to the remembered adapter.
  async function reconnect(userTap) {
    const L = S.lastConn; if (!L || connected || connecting) return false;
    const T = L.kind === 'serial' ? OBD.SerialTransport : OBD.BleTransport;
    if (!T.supported()) return false;
    const base = { quiet: !userTap, resume: true, label: 'Reconnecting to ' + L.name + '…' };
    const found = L.kind === 'serial' ? await T.remembered(L.info) : await T.remembered(L.id, L.name);
    if (found) return connect(L.kind, Object.assign(base, L.kind === 'serial' ? { port: found } : { device: found }));
    if (!userTap) return false;
    return connect(L.kind, Object.assign(base, L.kind === 'ble' ? { name: L.name } : {}));
  }
  function scheduleRetry() {
    clearTimeout(retryT);
    if (document.hidden || retries >= 4) return;          // the visibility handler picks it up later
    retryT = setTimeout(async () => { retries++; if (!(await reconnect(false)) && !connected) scheduleRetry(); }, [1500, 4000, 8000, 15000][retries]);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || connected || connecting || !autoOn() || !S.lastConn || !wantLive) return;
    retries = 0; reconnect(false).then(ok => { if (!ok && !connected) scheduleRetry(); });
  });
  function updateReconnectUI() {
    const L = S.lastConn, b = $('#wReconnect');
    if (b) { b.style.display = L && !connected ? '' : 'none'; b.textContent = L ? 'Reconnect ' + L.name : ''; }
    $('#wConnect').classList.toggle('primary', !L);
    $('#wConnect').textContent = L ? 'Connect a different adapter' : 'Connect adapter';
    if (!connected && !connecting) $('#connBtn').textContent = L ? 'Reconnect' : 'Connect';
  }
  function forgetAdapter() { S.lastConn = null; wantLive = false; save(); updateReconnectUI(); renderAdapter(); toast('Adapter forgotten'); }
  function lost(msg) {
    if (!connected) return;
    connected = false; polling = false; setStatus('', 'Disconnected');
    log('sys', msg); releaseWake();
    if (autoOn() && wantLive && !demo && S.lastConn) { toast(msg + '. Reconnecting…', 3000); retries = 0; scheduleRetry(); }
    else toast(msg, 4000);
    updateReconnectUI(); renderAdapter();
  }
  async function disconnect() {
    polling = false; connected = false; wantLive = false; clearTimeout(retryT);
    try { await transport.disconnect(); } catch (e) { }
    setStatus('', 'Not connected'); log('sys', 'Disconnected'); releaseWake(); renderAdapter();
  }
  $('#connBtn').onclick = () => { if (connected || $('#dot').className === 'busy') disconnect(); else if (S.lastConn) reconnect(true); else chooseConnection(); };
  $('#wConnect').onclick = chooseConnection;
  $('#wReconnect').onclick = () => reconnect(true);
  $('#wShop').onclick = () => scannerSheet();
  $('#wDemo').onclick = () => connect('demo');
  const need = () => { if (!connected) { toast('Connect first'); return false; } return true; };

  // ---------- wake lock ----------
  async function requestWake() { if (S.wake !== '1' || !('wakeLock' in navigator)) return; try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { } }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) { } wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && connected) requestWake(); });

  // ---------- codes ----------
  function badge() {
    const n = lastCodes ? lastCodes.stored.length + lastCodes.pending.length : (lastStatus ? lastStatus.dtcCount : 0);
    $('#codeBadge').style.display = n ? '' : 'none'; $('#codeBadge').textContent = n;
    const mil = lastStatus && lastStatus.mil;
    $('#milChip').style.display = mil ? 'block' : 'none';
    $('#milCard').classList.toggle('on', !!mil);
    if (lastStatus) { $('#milTitle').textContent = mil ? 'Check engine light is ON' : 'Check engine light is off'; $('#milSub').textContent = `${lastStatus.dtcCount} confirmed code${lastStatus.dtcCount === 1 ? '' : 's'} reported by the ECU`; }
  }
  async function refreshStatus() { try { lastStatus = await elm.status(); badge(); renderMonitors(); } catch (e) { } }
  const make = () => vehName();
  $('#readCodes').onclick = async () => {
    if (!need()) return;
    const b = $('#readCodes'); b.innerHTML = '<span class="spin"></span> Reading…'; b.disabled = true;
    try {
      lastCodes = await elm.readDtcs(); await refreshStatus();
      const all = [...lastCodes.stored.map(c => [c, 'stored']), ...lastCodes.pending.filter(c => !lastCodes.stored.includes(c)).map(c => [c, 'pending']), ...lastCodes.permanent.map(c => [c, 'permanent'])];
      let shopped = false;
      $('#dtcList').innerHTML = all.length ? all.map(([c, k]) => {
        const desc = OBD.dtcDescription(c), part = SHOP.partFor(c, desc); if (part) shopped = true;
        return `<div class="dtc"><div class="code">${c}</div><div class="grow"><div><span class="tag ${k}">${k}</span></div>
        <div style="margin:5px 0 4px">${esc(desc)}</div><div class="dlinks"><a target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(c + ' ' + make() + ' causes fix')}">Search causes &amp; fixes ↗</a>${part ? `<a target="_blank" rel="noopener sponsored" href="${SHOP.partUrl(part, make())}">Shop ${esc(part)} ↗</a>` : ''}</div></div></div>`;
      }).join('') + (shopped ? `<div class="small muted" style="padding:10px 2px 0">${SHOP.DISCLOSURE}</div>` : '')
        : '<div class="empty" style="color:var(--ok)">✓ No trouble codes stored or pending.</div>';
      renderCombined([...new Set(all.map(x => x[0]))]);
      badge(); log('sys', `Codes: stored ${lastCodes.stored.join(',') || 'none'} · pending ${lastCodes.pending.join(',') || 'none'} · permanent ${lastCodes.permanent.join(',') || 'none'}`);
    } catch (e) { toast('Read failed: ' + e.message); }
    b.textContent = 'Read codes'; b.disabled = false;
  };
  // ---------- combined analysis: several codes often share one root cause ----------
  const has = (codes, re) => codes.filter(c => re.test(c));
  const COMBOS = [
    { test: c => has(c, /^P017[14]$/).length === 2, title: 'Lean on both banks (P0171 + P0174)', why: 'Both sides of the engine lean at once points to something they share: a vacuum leak (intake gasket, PCV hose), a dirty or failing MAF sensor, low fuel pressure (pump or filter), or an exhaust leak before the O2 sensors.' },
    { test: c => has(c, /^P017[25]$/).length === 2, title: 'Rich on both banks (P0172 + P0175)', why: 'A shared cause is likely: a faulty MAF, leaking injectors or a stuck fuel-pressure regulator, or a stuck-open purge valve.' },
    { test: c => has(c, /^P01(71|74)$/).length && has(c, /^P030\d$/).length, title: 'Lean code + misfire', why: 'A misfire alongside a lean code is very often caused by a vacuum leak or low fuel delivery, not by plugs or coils.' },
    { test: c => has(c, /^P010[0-3]$/).length && has(c, /^P017[1245]$/).length, title: 'MAF code + fuel trim code', why: 'The MAF reading is probably throwing off the fuel calculation. Cleaning or replacing the MAF often fixes both.' },
    { test: c => has(c, /^P00(1[0-9]|2[0-5])$/).length >= 2, title: 'Several cam-timing (VVT) codes', why: 'Multiple VVT codes usually point to engine oil (low level, wrong viscosity, overdue change), VVT solenoids or their screens, or a stretched timing chain or worn tensioner. Check oil level and condition first.' },
    { test: c => has(c, /^P00(1[0-9]|2[0-5])$/).length && has(c, /^P03(35|4[0-9])$/).length, title: 'Cam timing + crank/cam sensor', why: 'Timing codes together with position-sensor codes raise the chance of a timing chain/belt problem or a slipped tone ring, not just a bad sensor.' },
    { test: c => has(c, /^P03\d\d$/).length >= 3, title: 'Misfires on several cylinders', why: 'Multiple-cylinder misfires suggest a shared cause: vacuum leak, fuel pressure, EGR flow, a failing coil pack or wiring, or contaminated fuel, rather than one plug.' },
    { test: c => has(c, /^P04[2-3][0-9]$/).length && has(c, /^P030\d$/).length, title: 'Catalyst code + misfire', why: 'Fix the misfire first. Misfires overheat and damage the catalytic converter, and the cat code may clear once the misfire is gone.' },
    { test: c => has(c, /^P04[4-5]\d$|^P14(5[0-9])$/).length >= 2, title: 'Several EVAP codes', why: 'Usually one leak or valve: a loose or worn gas cap, a cracked EVAP hose, or a bad purge or vent valve. Start with the gas cap.' },
    { test: c => has(c, /^P00(3[0-9]|5[0-9]|6[0-4])$|^P01(3|4|5|6)[15]$/).length >= 2, title: 'Several O2 heater circuits', why: 'Multiple heater circuits failing together often means a blown fuse or a shared wiring/ground problem, not several bad sensors.' },
    { test: c => has(c, /^U\d/).length >= 2, title: 'Several network (U) codes', why: 'Lost communication with several modules usually means low battery voltage, a bad ground, or a damaged CAN wire or connector, not failed modules.' },
    { test: c => has(c, /^P056[0-3]$/).length && c.length >= 3, title: 'Voltage code + other codes', why: 'Low or unstable system voltage can set false codes all over the car. Test the battery and alternator before chasing the others.' },
    { test: c => has(c, /^P0(12[0-3]|22[0-3]|2135)$/).length >= 2, title: 'Several throttle position codes', why: 'Points to the throttle body unit or its connector and wiring rather than separate sensors.' }
  ];
  function renderCombined(codes) {
    let box = $('#comboCard');
    if (!box) { $('#dtcList').insertAdjacentHTML('afterend', '<div id="comboWrap"><h2>Look at them together</h2><div class="card" id="comboCard"></div></div>'); box = $('#comboCard'); }
    $('#comboWrap').style.display = codes.length >= 2 ? '' : 'none';
    if (codes.length < 2) return;
    const veh = vehName();
    const q = `${codes.join(' ')} ${veh} together common cause`.replace(/\s+/g, ' ').trim();
    const hints = COMBOS.filter(h => h.test(codes));
    const prompt = `My ${veh || 'car'} has these OBD-II codes at the same time: ${codes.map(c => c + ' (' + OBD.dtcDescription(c) + ')').join(', ')}. ` +
      `Could they share one root cause? Rank the most likely shared causes, and give the order to check things, cheapest and easiest first.`;
    box.innerHTML = `<div class="small muted" style="line-height:1.5;margin-bottom:10px">Several codes at once often share <b style="color:var(--text)">one root cause</b>. Search them as a set instead of one at a time.</div>
      <div style="font-family:var(--num);font-size:20px;font-weight:700;letter-spacing:.5px;margin-bottom:12px">${codes.join(' · ')}</div>
      ${hints.length ? `<div style="margin-bottom:12px">${hints.map(h => `<div style="border-left:3px solid var(--warn);padding:6px 0 6px 10px;margin-bottom:8px"><div style="font-weight:600">${esc(h.title)}</div><div class="small muted" style="line-height:1.5;margin-top:3px">${esc(h.why)}</div></div>`).join('')}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px">
        <a class="btnlink primary" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(q)}">Search all ${codes.length} codes together ↗</a>
        <div class="row" style="gap:8px">
          <a class="btnlink grow" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(codes.join(' ') + ' ' + veh)}">YouTube ↗</a>
          <a class="btnlink grow" target="_blank" rel="noopener" href="https://www.reddit.com/search/?q=${encodeURIComponent(codes.join(' ') + ' ' + veh)}">Reddit ↗</a>
          <a class="btnlink grow" target="_blank" rel="noopener" href="https://claude.ai/new?q=${encodeURIComponent(prompt)}">Ask Claude ↗</a>
        </div>
      </div>`;
  }

  $('#clearCodes').onclick = async () => {
    if (!need()) return;
    const ok = await confirmSheet('Clear trouble codes?', 'This turns off the check engine light and erases stored codes and freeze-frame data. It also <b>resets emissions readiness monitors</b>, so the car may fail an inspection until you’ve driven it enough to re-run them (often 50–100 miles of mixed driving).<br><br>Best done with the <b>ignition ON, engine OFF</b>. Clearing doesn’t fix the underlying problem.', 'Clear codes', true);
    if (!ok) return;
    try { const r = await elm.clearDtcs(); toast(r ? 'Codes cleared' : 'ECU did not confirm. Try with engine off'); lastCodes = null; lastFF = null; renderCombined([]); $('#dtcList').innerHTML = '<div class="empty">Cleared. Read again to confirm.</div>'; await refreshStatus(); }
    catch (e) { toast('Clear failed: ' + e.message); }
  };
  const FF_PIDS = ['04', '05', '06', '07', '08', '09', '0B', '0C', '0D', '0E', '0F', '11'];
  $('#ffCard').addEventListener('click', async e => {
    if (e.target.id !== 'readFF' || !need()) return;
    e.target.innerHTML = '<span class="spin"></span> Reading…';
    try {
      lastFF = await elm.freezeFrame(FF_PIDS);
      const rows = Object.entries(lastFF.values);
      $('#ffCard').innerHTML = !rows.length && !lastFF.dtc ? '<div class="empty">No freeze frame stored.<br><br><button id="readFF">Read again</button></div>'
        : `<div class="small muted" style="margin-bottom:10px">Captured when <b style="color:var(--text)">${lastFF.dtc || 'a code'}</b> set</div><dl class="kv">${rows.map(([p, v]) => { const c = conv(p, v); return `<dt>${esc(meta(p).name)}</dt><dd>${fmt(c.v, p)} ${esc(c.unit)}</dd>`; }).join('')}</dl><div style="margin-top:12px"><button id="readFF">Refresh</button></div>`;
    } catch (err) { toast('Freeze frame failed'); e.target.textContent = 'Read freeze frame'; }
  });

  // ---------- info / readiness ----------
  // NHTSA vPIC decode (free, no key). Cached per VIN so it works offline after the first time.
  let nhtsa = null;
  const NHTSA_FIELDS = [['Model', 'Model'], ['Trim', 'Trim'], ['Series', 'Series'], ['BodyClass', 'Body'], ['DriveType', 'Drive'],
    ['DisplacementL', 'Engine (L)'], ['EngineCylinders', 'Cylinders'], ['EngineModel', 'Engine code'], ['FuelTypePrimary', 'Fuel'],
    ['TransmissionStyle', 'Transmission'], ['PlantCity', 'Plant'], ['PlantCountry', 'Plant country']];
  function cachedNhtsa(vin) { try { return JSON.parse(localStorage.getItem('td.vin.' + vin) || 'null'); } catch (e) { return null; } }
  async function decodeNhtsa(vin, quiet) {
    if (!vin || vin.length !== 17) return null;
    const c = cachedNhtsa(vin); if (c) { nhtsa = c; renderInfo(); return c; }
    try {
      const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json');
      const j = await r.json(), row = j && j.Results && j.Results[0];
      if (!row || !row.Make) throw new Error(row && row.ErrorText || 'No match');
      nhtsa = row; try { localStorage.setItem('td.vin.' + vin, JSON.stringify(row)); } catch (e) { }
      renderInfo(); return row;
    } catch (e) {
      if (!quiet) toast('Couldn’t reach NHTSA from here. Use “NHTSA site” (VIN gets copied).', 4500);
      return null;
    }
  }
  // Best vehicle name for searches: "2008 Honda Odyssey" when known
  function vehName() {
    if (nhtsa && nhtsa.Make) return [nhtsa.ModelYear, cap(nhtsa.Make), nhtsa.Model].filter(Boolean).join(' ');
    const v = OBD.decodeVin(lastVin); return v ? [v.year, v.make].filter(Boolean).join(' ') : '';
  }
  const cap = s => String(s).toLowerCase().replace(/\b\w/g, m => m.toUpperCase());
  function renderInfo() {
    if (!lastInfo) return;
    const v = OBD.decodeVin(lastInfo.vin);
    if (lastInfo.vin && !nhtsa) nhtsa = cachedNhtsa(lastInfo.vin);
    const n = nhtsa && nhtsa.VIN === lastInfo.vin ? nhtsa : (nhtsa && !nhtsa.VIN ? nhtsa : null);
    let rows = `<dt>VIN</dt><dd>${esc(lastInfo.vin || '—')}</dd>`;
    if (n) {
      rows += `<dt>Vehicle</dt><dd><b>${esc([n.ModelYear, cap(n.Make), n.Model].filter(Boolean).join(' '))}</b></dd>`;
      NHTSA_FIELDS.forEach(([k, l]) => { if (n[k] && n[k] !== 'Not Applicable' && k !== 'Model') rows += `<dt>${l}</dt><dd>${esc(k === 'DisplacementL' ? (+n[k]).toFixed(1) : n[k])}</dd>`; });
    } else if (v) rows += `<dt>Make</dt><dd>${esc(v.make || 'Unknown')}</dd><dt>Model year</dt><dd>${v.year || '—'}</dd><dt>Built in</dt><dd>${esc(v.country || '—')}</dd>`;
    rows += `<dt>Calibration</dt><dd>${esc(lastInfo.cal || '—')}</dd><dt>ECU</dt><dd>${esc(lastInfo.ecu || '—')}</dd>`;
    $('#vehInfo').innerHTML = rows;
    const ok = lastInfo.vin && lastInfo.vin.length === 17;
    $('#vinDecode').style.display = ok && !n ? '' : 'none';
    $('#vinLink').style.display = ok ? '' : 'none';
    const name = vehName();
    if (name) $('#connInfo').textContent = `${name} · ${elm ? elm.protocol : ''}`;
    if (lastCodes) renderCombined([...new Set([...lastCodes.stored, ...lastCodes.pending, ...lastCodes.permanent])]);
  }
  $('#vinDecode').onclick = async () => { const b = $('#vinDecode'); b.innerHTML = '<span class="spin"></span>'; await decodeNhtsa(lastVin); b.textContent = 'Decode VIN'; };
  // The NHTSA decoder page can't be pre-filled by URL, so copy the VIN first, then open the page.
  $('#vinLink').onclick = () => { if (lastVin) { try { navigator.clipboard.writeText(lastVin).then(() => toast('VIN copied. Paste it on the NHTSA page')); } catch (e) { } } };
  $('#readInfo').onclick = async () => { if (!need()) return; $('#readInfo').innerHTML = '<span class="spin"></span>'; try { lastInfo = await elm.info(); lastVin = lastInfo.vin; renderInfo(); decodeNhtsa(lastVin, true); } catch (e) { toast('Info read failed'); } $('#readInfo').textContent = 'Read vehicle info'; };
  function renderMonitors() {
    if (!lastStatus) return;
    const inc = lastStatus.monitors.filter(m => !m.complete).length;
    const ready = inc <= 1 && !lastStatus.mil;
    $('#monCard').innerHTML = `<div class="row" style="margin-bottom:8px"><b class="${ready ? 'ok' : 'no'}" style="font-size:16px">${ready ? '✓ Likely ready for inspection' : '✗ Not ready yet'}</b></div>
      <div class="small muted" style="margin-bottom:8px">${lastStatus.mil ? 'Check engine light is on. ' : ''}${inc} incomplete. Most US programs allow 1 incomplete on 2001+ gas vehicles.</div>
      ${lastStatus.monitors.map(m => `<div class="mon"><span>${m.name}</span><span class="${m.complete ? 'ok' : 'no'}">${m.complete ? 'Complete' : 'Incomplete'}</span></div>`).join('')}
      <div style="margin-top:12px"><button id="readMon">Refresh</button></div>`;
  }
  $('#monCard').addEventListener('click', e => { if (e.target.id === 'readMon' && need()) refreshStatus(); });
  function renderAdapter() {
    const L = S.lastConn, kindName = { ble: 'Bluetooth LE', serial: 'Classic Bluetooth / USB' };
    $('#adInfo').innerHTML = (!elm || !connected ? '<dt>Status</dt><dd>Not connected</dd>' : `<dt>Device</dt><dd>${esc(transport.name)}</dd><dt>Chip</dt><dd>${esc(elm.version)}</dd><dt>Protocol</dt><dd>${esc(elm.protocol)}</dd><dt>Supported PIDs</dt><dd>${elm.supported.size}</dd>`)
      + (L ? `<dt>Remembered</dt><dd>${esc(L.name)} · ${kindName[L.kind] || L.kind}</dd>` : '');
    const b = $('#adBtns'); if (!b) return;
    b.innerHTML = `${L && !connected ? '<button class="primary grow" id="adRe">Reconnect</button>' : ''}<button class="grow" id="adShop">Get an adapter</button>${L ? '<button class="ghost grow" id="adForget">Forget adapter</button>' : ''}`;
    const re = $('#adRe'); if (re) re.onclick = () => reconnect(true);
    $('#adShop').onclick = scannerSheet;
    const fg = $('#adForget'); if (fg) fg.onclick = forgetAdapter;
  }

  // ---------- all sensors view (inside Car tab overlay) ----------
  function openSensors() {
    if (!need()) return;
    const list = [...elm.supported].filter(p => PIDS[p]);
    S._sens = list; view = 'sens';
    sheet(`<h3>All sensors</h3><p class="small muted">Every live value your ECU reports, with raw hex. Scanning cycles through them.</p><div id="sensList"></div>`);
    const prevTiles = S.tiles;
    sensScan(list);
    const obs = new MutationObserver(() => { if (!$('#scrim').classList.contains('open')) { view = 'dash'; sensStop = true; obs.disconnect(); show('dash'); } });
    obs.observe($('#scrim'), { attributes: true });
  }
  let sensStop = false;
  async function sensScan(list) {
    sensStop = false;
    const wasPolling = polling; polling = false;
    await new Promise(r => setTimeout(r, 300));
    while (!sensStop && connected) {
      for (const p of list) { if (sensStop || !connected) break; try { put(p, await elm.readPid(p)); } catch (e) { } renderSensors(); }
    }
    if (connected && wasPolling) pollLoop();
  }
  function renderSensors() {
    const box = $('#sensList'); if (!box) return;
    box.innerHTML = (S._sens || []).map(p => { const c = conv(p, data[p] && data[p].v); return `<div class="mon"><span>${esc(meta(p).name)}<br><small style="color:var(--faint);font-family:ui-monospace,monospace">${esc(elm.lastRaw[p] || '')}</small></span><span style="font-family:var(--num);font-size:18px;font-weight:700">${fmt(c.v, p)} <small class="muted">${esc(c.unit)}</small></span></div>`; }).join('');
  }

  // ---------- diagnostic report (for a mechanic or an AI) ----------
  function report() {
    const v = OBD.decodeVin(lastVin), L = [];
    L.push('OBD-II DIAGNOSTIC REPORT — ' + new Date().toLocaleString());
    if (lastVin) L.push(`Vehicle: ${vehName()}${nhtsa && nhtsa.DisplacementL ? ' ' + (+nhtsa.DisplacementL).toFixed(1) + 'L' : ''}${nhtsa && nhtsa.EngineCylinders ? ' ' + nhtsa.EngineCylinders + '-cyl' : ''}  VIN ${lastVin}`);
    if (elm) L.push(`Protocol: ${elm.protocol}  Adapter: ${elm.version}`);
    if (lastStatus) L.push(`Check engine light: ${lastStatus.mil ? 'ON' : 'off'}  Confirmed DTC count: ${lastStatus.dtcCount}`);
    if (lastCodes) {
      L.push('', 'TROUBLE CODES');
      [['Stored', lastCodes.stored], ['Pending', lastCodes.pending], ['Permanent', lastCodes.permanent]].forEach(([k, a]) => L.push(`  ${k}: ${a.length ? a.map(c => c + ' (' + OBD.dtcDescription(c) + ')').join('; ') : 'none'}`));
      const allc = [...new Set([...lastCodes.stored, ...lastCodes.pending, ...lastCodes.permanent])];
      const hs = COMBOS.filter(h => h.test(allc));
      if (hs.length) { L.push('', 'CODE COMBINATIONS THAT OFTEN SHARE A CAUSE'); hs.forEach(h => L.push('  ' + h.title + ': ' + h.why)); }
    } else L.push('', 'TROUBLE CODES: not read yet');
    if (lastFF && Object.keys(lastFF.values).length) { L.push('', 'FREEZE FRAME (' + (lastFF.dtc || '?') + ')'); Object.entries(lastFF.values).forEach(([p, val]) => { const c = conv(p, val); L.push(`  ${meta(p).name}: ${fmt(c.v, p)} ${c.unit}`); }); }
    if (lastStatus) { L.push('', 'READINESS MONITORS'); lastStatus.monitors.forEach(m => L.push(`  ${m.name}: ${m.complete ? 'complete' : 'INCOMPLETE'}`)); }
    const live = Object.keys(data).filter(p => data[p].v != null);
    if (live.length) { L.push('', 'LIVE DATA (current / min / max this session)'); live.forEach(p => { const c = conv(p, data[p].v); const x = [conv(p, data[p].min).v, conv(p, data[p].max).v].sort((m, n) => m - n); L.push(`  ${meta(p).name}: ${fmt(c.v, p)} / ${fmt(x[0], p)} / ${fmt(x[1], p)} ${c.unit}`); }); }
    return L.join('\n');
  }

  // ---------- graph ----------
  const COLORS = [], seriesColors = () => [cssVar('--accent'), cssVar('--blue'), cssVar('--ok')];
  const cv = $('#chart');
  function sizeChart() { const dpr = devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; }
  window.addEventListener('resize', () => { if (view === 'graph') sizeChart(); });
  function updateChips() {
    const COLORS = seriesColors();
    $('#gChips').innerHTML = S.graph.map((p, i) => { const c = conv(p, data[p] && data[p].v); return `<div class="chip"><i style="background:${COLORS[i]}"></i>${esc(meta(p).short)} <b>${fmt(c.v, p)}</b> <span class="muted">${esc(c.unit)}</span></div>`; }).join('');
  }
  function drawChart() {
    const ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1, w = cv.width / dpr, h = cv.height / dpr; if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const win = +$('#gWin').value * 1000, now = performance.now();
    const COLORS = seriesColors();
    ctx.strokeStyle = cssVar('--line'); ctx.lineWidth = 1; ctx.font = '10px Inter'; ctx.fillStyle = cssVar('--faint');
    for (let i = 1; i < 4; i++) { const y = h * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let i = 0; i <= 6; i++) { const x = w * i / 6; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke(); ctx.fillText('-' + Math.round(win / 1000 * (1 - i / 6)) + 's', Math.min(x + 2, w - 24), h - 3); }
    S.graph.forEach((p, i) => {
      const d = data[p]; if (!d) return;
      const pts = d.hist.filter(q => now - q[0] < win).map(q => [q[0], conv(p, q[1]).v]); if (pts.length < 2) return;
      let lo = Infinity, hi = -Infinity; pts.forEach(q => { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
      ctx.beginPath(); pts.forEach((q, j) => { const x = w - (now - q[0]) / win * w, y = (h - 18) - (q[1] - lo) / (hi - lo) * (h - 26) + 4; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = COLORS[i]; ctx.fillText(fmt(hi - pad, p), 4 + i * 58, 12); ctx.fillText(fmt(lo + pad, p), 4 + i * 58, h - 20);
    });
  }
  $('#gWin').onchange = drawChart;
  $('#gPick').onclick = () => {
    sheet(`<h3>Graph sensors</h3><p class="small muted">Pick up to 3. Each line gets its own scale.</p>${allPidList().map(p => `<div class="opt ${S.graph.includes(p) ? 'sel' : ''}" data-p="${p}"><span>${esc(meta(p).name)}</span><small>${S.graph.includes(p) ? '✓' : supportedHas(p) ? '' : 'not supported'}</small></div>`).join('')}`, el => {
      el.querySelectorAll('.opt').forEach(o => o.onclick = () => {
        const p = o.dataset.p, i = S.graph.indexOf(p);
        if (i >= 0) S.graph.splice(i, 1); else { if (S.graph.length >= 3) S.graph.shift(); S.graph.push(p); }
        save(); closeSheet(); updateChips(); drawChart();
      });
    });
  };

  // ---------- recording ----------
  function recordRow() {
    const now = Date.now(); if (rec.rows.length && now - rec.rows.at(-1)[0] < 200) return;
    const cols = rec.cols; rec.rows.push([now, ...cols.map(p => data[p] ? conv(p, data[p].v).v : '')]);
    $('#recCount').textContent = rec.rows.length;
  }
  $('#recBtn').onclick = () => {
    if (!rec) {
      if (!need()) return;
      const cols = [...new Set(['0C', '0D'].concat(S.tiles, S.graph))].filter(p => supportedHas(p));
      rec = { cols, extra: cols, rows: [] };
      $('#recBtn').textContent = '■ Stop & export'; $('#recInd').style.display = 'flex'; toast('Recording started');
    } else {
      const r = rec; rec = null; $('#recBtn').textContent = '● Record log'; $('#recInd').style.display = 'none';
      if (!r.rows.length) return toast('Nothing recorded');
      const head = ['time', ...r.cols.map(p => `${meta(p).name} (${conv(p, 1).unit})`)];
      const csv = [head.join(','), ...r.rows.map(row => [new Date(row[0]).toISOString(), ...row.slice(1).map(v => v === '' || v == null ? '' : (+v).toFixed(3))].join(','))].join('\n');
      download(`drive-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, csv);
    }
  };

  // ---------- HUD (mirrored windshield display) ----------
  let hud = false;
  function toggleHud() {
    hud = !hud;
    let el = $('#hud');
    if (hud && !el) {
      el = document.createElement('div'); el.id = 'hud';
      el.style.cssText = 'position:fixed;inset:0;background:#000;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:scaleY(-1);color:#3fff8a;font-family:Rajdhani,sans-serif';
      el.innerHTML = '<div id="hudSpd" style="font-size:42vw;font-weight:700;line-height:.85">—</div><div id="hudU" style="font-size:7vw;letter-spacing:.4em"></div><div id="hudRpm" style="font-size:8vw;color:#ffb020;margin-top:2vh"></div><div style="position:absolute;bottom:4vh;font-size:12px;color:#335;transform:scaleY(-1)">tap to exit HUD</div>';
      el.onclick = toggleHud; document.body.appendChild(el);
      try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); } catch (e) { }
    } else if (!hud && el) { el.remove(); try { document.fullscreenElement && document.exitFullscreen(); } catch (e) { } }
  }

  // ---------- extra dash/car controls injected ----------
  function injectExtras() {
    const dash = $('#dash');
    const tripH = document.createElement('div');
    tripH.innerHTML = `<h2>Trip</h2><div class="card" id="tripCard" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"></div>
      <div class="row" style="margin-top:12px;gap:8px"><button class="grow primary" id="driveBtn">Driving mode</button><button class="grow" id="hudBtn">HUD</button><button class="grow" id="sensBtn">All sensors</button><button class="grow" id="repBtn">Copy report</button></div>`;
    dash.appendChild(tripH);
    $('#hudBtn').onclick = () => { if (need()) toggleHud(); };
    $('#driveBtn').onclick = () => openDrive();
    $('#sensBtn').onclick = openSensors;
    $('#repBtn').onclick = () => copyText(report(), 'Diagnostic report');
    // codes tab report button
    const cb = document.createElement('div'); cb.className = 'row'; cb.style.marginTop = '14px';
    cb.innerHTML = '<button class="grow" id="repBtn2">Copy full report (paste into Claude or text to your mechanic)</button>';
    $('#v-codes').appendChild(cb); $('#repBtn2').onclick = () => copyText(report(), 'Diagnostic report');
    // settings additions
    const set = $('#sWake').closest('.card');
    set.insertAdjacentHTML('beforeend', `<div class="row" style="justify-content:space-between;padding:6px 0"><span>Polling speed</span><select id="sSpeed"><option value="fast">Fast</option><option value="normal">Normal</option><option value="gentle">Gentle (old/cheap adapters)</option></select></div>
      <div class="row" style="justify-content:space-between;padding:6px 0"><span>Warning alerts</span><select id="sAlerts"><option value="1">On</option><option value="0">Off</option></select></div>
      <div class="row" style="justify-content:space-between;padding:6px 0"><span>Auto-reconnect adapter</span><select id="sAutoRe"><option value="1">On</option><option value="0">Off</option></select></div>`);
    // terminal extras
    $('#v-term').insertAdjacentHTML('beforeend', '<div class="row" style="margin-top:10px"><button class="grow ghost small" id="copyLog">Copy log</button><button class="grow ghost small" id="clrLog">Clear</button></div>');
    const hb = $('#helpBtn'); if (hb) hb.onclick = helpSheet;
    const cbtn = $('#creditsBtn'); if (cbtn) cbtn.onclick = creditsSheet;
    $('#copyLog').onclick = () => copyText(termLines.map(l => `${l.t.toISOString()} ${l.kind.toUpperCase()} ${l.text}`).join('\n'), 'Log');
    $('#clrLog').onclick = () => { termLines.length = 0; $('#term').innerHTML = ''; };
  }

  // ---------- terminal ----------
  const QUICK = ['ATI', 'ATRV', 'ATDP', '0100', '010C', '0101', '03', '07', '0902', 'ATZ'];
  $('#quick').innerHTML = QUICK.map(c => `<button data-c="${c}">${c}</button>`).join('');
  $('#quick').onclick = e => { const c = e.target.dataset.c; if (c) termSend(c); };
  $('#termForm').onsubmit = e => { e.preventDefault(); const c = $('#termIn').value.trim(); if (c) { termSend(c); $('#termIn').value = ''; } };
  // Commands that can change state on the car (UDS/KWP writes, routines, resets, security, clears) or the adapter.
  const RISKY = [
    [/^(04|14)/, 'clears trouble codes / diagnostic data'],
    [/^2E/, 'WRITES a value into a module (Write Data By Identifier)'],
    [/^3B/, 'WRITES a value into a module (KWP write)'],
    [/^31/, 'starts a ROUTINE in a module (can move parts, relearn or erase)'],
    [/^2F/, 'takes CONTROL of an output (actuator test)'],
    [/^27/, 'requests SECURITY access (used before writes)'],
    [/^11/, 'RESETS a module'],
    [/^10(02|03|2|3|4|5|6|40|60)$/, 'switches a module into a programming/extended session'],
    [/^(34|35|36|37)/, 'is a FLASH / memory transfer command'],
    [/^28/, 'disables module COMMUNICATION'],
    [/^85/, 'changes DTC recording settings'],
    [/^ATPP|^ATBRD|^ATPB/, 'changes the ADAPTER’s stored settings']
  ];
  async function termSend(c) {
    if (!elm || !connected) { log('sys', 'Not connected'); return; }
    const raw = c.toUpperCase().replace(/\s+/g, '');
    const hit = RISKY.find(([re]) => re.test(raw));
    if (hit && !(await confirmSheet('Risky command', `<b>${esc(c.toUpperCase())}</b> ${hit[1]}.<br><br>Only send this if you know exactly what it does for <b>this</b> vehicle and module. Ignition on, engine off, battery healthy, never while driving.`, 'Send anyway', true))) { log('sys', 'Cancelled ' + c); return; }
    const restore = /^ATSH7DF$|^ATSHDB33F1$|^ATD$|^ATZ$/.test(raw);
    if (!restore && /^ATSH|^ATCRA|^ATCP|^ATSP|^ATTP|^ATCF|^ATCM/.test(raw)) setCustomHeader(true);
    try { await elm.send(c.toUpperCase(), 10000); } catch (e) { log('sys', e.message); }
    if (restore && customHeader) restoreNormal();
  }
  function setCustomHeader(on) {
    customHeader = on; $('#termBar').classList.toggle('on', on);
    if (on) { polling = false; log('sys', 'Custom addressing: live polling paused'); }
  }
  async function restoreNormal() {
    if (!elm || !connected) { setCustomHeader(false); return; }
    $('#termRestore').innerHTML = '<span class="spin"></span>';
    try { await elm.init(S.proto); log('sys', 'Adapter re-initialized: normal OBD mode'); } catch (e) { log('sys', 'Re-init failed: ' + e.message); }
    $('#termRestore').textContent = 'Restore normal';
    setCustomHeader(false); pollLoop();
  }
  $('#termRestore').onclick = restoreNormal;
  $('#quick').insertAdjacentHTML('afterend', `<div class="small muted" style="margin:-2px 0 6px">Module addressing (11-bit CAN). This <b>pauses live data</b> until you restore.</div>
    <div class="quick" id="quick2"><button data-c="ATSH7E0">Engine 7E0</button><button data-c="ATSH7E1">Trans 7E1</button><button data-c="ATSH7DF">Broadcast 7DF</button><button data-c="22F190">22 F190 (VIN DID)</button></div>`);
  $('#quick2').onclick = e => { const c = e.target.dataset.c; if (c) termSend(c); };
  // My Codes panel under the terminal
  $('#v-term').insertAdjacentHTML('beforeend', '<div id="codesWrap"><div class="row" style="justify-content:space-between;margin:16px 0 8px"><h2 style="margin:0">My codes</h2><button class="primary small" id="addCode">+ New code</button></div><div id="codesList"></div><div class="note">Commands you verified for your own vehicle, saved to run with one tap. Same risks as the terminal apply.</div></div>');
  $('#addCode').onclick = () => editCodeSheet(null);
  $('#codesList').addEventListener('click', e => { const r = e.target.closest('[data-run]'), ed = e.target.closest('[data-edit]'); if (ed) { const c = loadCodes().find(x => x.id === ed.dataset.edit); if (c) editCodeSheet(c); } else if (r) { const c = loadCodes().find(x => x.id === r.dataset.run); if (c) runCode(c); } });

  // ---------- terminal discretion gate ----------
  function termOk() { try { if (localStorage.getItem('td.termOk') === '1') return true; } catch (e) { } return !!window.__termOk; }
  function openGate() { $('#gateChk').checked = false; $('#gateYes').disabled = true; $('#gate').classList.add('open'); }
  $('#gateChk').onchange = () => { $('#gateYes').disabled = !$('#gateChk').checked; };
  $('#gateNo').onclick = () => $('#gate').classList.remove('open');
  $('#gateYes').onclick = () => { try { localStorage.setItem('td.termOk', '1'); } catch (e) { } window.__termOk = true; $('#gate').classList.remove('open'); show('term'); };
  $('#termInfo').onclick = () => { $('#gateChk').checked = true; $('#gateYes').disabled = false; $('#gate').classList.add('open'); };

  // ---------- settings ----------
  function initSettings() {
    $('#sProto').innerHTML = Object.entries(OBD.PROTOCOLS).filter(([k]) => /[0-9]/.test(k)).map(([k, v]) => `<option value="${k}">${k === '0' ? 'Auto-detect' : v}</option>`).join('');
    const bind = (id, key, after) => { const el = $(id); el.value = S[key] === true ? '1' : S[key] === false ? '0' : S[key]; el.onchange = () => { S[key] = key === 'alerts' ? el.value === '1' : el.value; save(); after && after(); }; };
    bind('#sUnits', 'units', () => { renderTiles(); updateChips(); renderTrip(); });
    bind('#sProto', 'proto'); bind('#sRed', 'red', buildGauge); bind('#sWake', 'wake', () => S.wake === '1' ? connected && requestWake() : releaseWake());
    bind('#sSpeed', 'speed', () => { if (elm) elm.delay = SPEEDS[S.speed]; }); bind('#sAlerts', 'alerts'); bind('#sAutoRe', 'autoRe');
  }

  // ---------- tools used by the Mods guide ----------
  function graphPreset(pids, win, label) {
    S.graph = pids.slice(0, 3); save();
    if (win) { const sel = $('#gWin'); if (![...sel.options].some(o => o.value == win)) sel.insertAdjacentHTML('beforeend', `<option value="${win}">${win / 60} min</option>`); sel.value = win; }
    show('graph'); updateChips(); toast(label + ': graphing ' + pids.map(p => meta(p).short).join(', '));
    if (!connected) toast('Connect the adapter to start ' + label.toLowerCase(), 3500);
  }
  // GPS vs OBD speed: the standard way to verify speedometer calibration after a tire change.
  function speedoCheck() {
    if (!('geolocation' in navigator)) return toast('GPS isn’t available in this browser');
    let watch = null, samples = [];
    sheet(`<h3>Speedometer check</h3><p class="small muted" style="line-height:1.5">Compares the speed your car reports with GPS. Drive steadily on a straight, level road above 30 mph. A passenger should hold the phone.</p>
      <div class="row" style="gap:10px;margin:14px 0"><div class="card grow" style="text-align:center"><div class="small muted">Car (OBD)</div><div class="bigread" id="spObd" style="font-size:48px">—</div></div>
      <div class="card grow" style="text-align:center"><div class="small muted">GPS</div><div class="bigread" id="spGps" style="font-size:48px;color:var(--blue)">—</div></div></div>
      <div class="verdict" id="spVerdict">Waiting for GPS fix…</div><div class="small muted" id="spDetail" style="text-align:center;line-height:1.5"></div>
      <div class="toolbox"><b>Reading it:</b> if the car reads <b>lower</b> than GPS, your tires are bigger than the car thinks. Raise the tire size in your brand tool (or lower it if it reads high), then re-check. Aim for within 1–2 mph. The dash needle may differ slightly from the OBD value.</div>
      <button style="width:100%;margin-top:12px" id="spReset">Reset average</button>`, el => {
      el.querySelector('#spReset').onclick = () => { samples = []; };
      watch = navigator.geolocation.watchPosition(pos => {
        const g = pos.coords.speed; // m/s
        const gk = g == null || g < 0 ? null : g * 3.6, obd = data['0D'] && data['0D'].v;
        const u = imp() ? 'mph' : 'km/h', cv = v => imp() ? v * 0.621371 : v;
        $('#spGps').textContent = gk == null ? '—' : Math.round(cv(gk));
        $('#spObd').textContent = obd == null ? '—' : Math.round(cv(obd));
        if (gk != null && obd != null && gk > 40 && pos.coords.accuracy < 30) samples.push(obd / gk); if (samples.length > 120) samples.shift();
        if (samples.length >= 5) {
          const r = samples.reduce((x, y) => x + y, 0) / samples.length, pct = (r - 1) * 100, at60 = 60 * (1 - r);
          $('#spVerdict').innerHTML = Math.abs(pct) < 2 ? '<span class="ok">✓ Speedometer is accurate</span>' : `<span class="no">Car reads ${Math.abs(pct).toFixed(1)}% ${pct < 0 ? 'LOW' : 'HIGH'}</span>`;
          $('#spDetail').textContent = `At a true 60 ${u}, the car shows about ${(60 * r).toFixed(1)}. Based on ${samples.length} readings. ${pct < -2 ? 'Odometer is under-counting miles too.' : pct > 2 ? 'Odometer is over-counting miles.' : ''}`;
        } else $('#spVerdict').textContent = gk == null ? 'Waiting for GPS speed…' : 'Drive steadily above 25 mph to collect readings…';
      }, err => { $('#spVerdict').innerHTML = '<span class="no">GPS unavailable: ' + esc(err.message) + '</span>'; }, { enableHighAccuracy: true, maximumAge: 0 });
    }, () => { if (watch != null) navigator.geolocation.clearWatch(watch); });
  }
  function chargeTest() {
    extraPoll.add('VBAT');
    let t = setInterval(upd, 300);
    function upd() {
      const v = data['VBAT'] && data['VBAT'].v, rpm = data['0C'] && data['0C'].v, running = rpm > 400;
      const el = $('#chV'); if (!el) return;
      el.textContent = v == null ? '—' : v.toFixed(2) + ' V';
      let verdict = '—', cls = '';
      if (v != null) {
        if (!running) { if (v >= 12.6) { verdict = 'Battery fully charged'; cls = 'ok'; } else if (v >= 12.4) { verdict = 'Battery OK (~75%)'; cls = 'ok'; } else if (v >= 12.2) { verdict = 'Battery low (~50%). Charge it'; cls = 'no'; } else { verdict = 'Battery weak or discharged'; cls = 'no'; } }
        else { if (v >= 13.6 && v <= 14.8) { verdict = 'Charging normally'; cls = 'ok'; } else if (v > 14.8) { verdict = 'Overcharging. Check the regulator'; cls = 'no'; } else if (v >= 13.0) { verdict = 'Low-ish charge (normal for smart charging systems at cruise)'; cls = 'no'; } else { verdict = 'Not charging. Check the alternator and belt'; cls = 'no'; } }
      }
      $('#chVerdict').innerHTML = `<span class="${cls}">${verdict}</span>`;
      $('#chMode').textContent = rpm == null ? 'Engine state unknown' : running ? 'Engine running' : 'Engine off';
    }
    sheet(`<h3>Battery &amp; charging test</h3><div class="small muted" id="chMode" style="text-align:center;margin-top:8px"></div>
      <div class="bigread" id="chV" style="margin:8px 0">—</div><div class="verdict" id="chVerdict"></div>
      <div class="mitem" style="margin-top:12px"><b>1 · Engine off</b><p>Let the car sit 30+ min. 12.6 V+ is full, 12.4 V is fine, under 12.2 V needs charging or testing.</p></div>
      <div class="mitem"><b>2 · Engine running</b><p>Should read 13.6–14.8 V at idle. Many newer cars use smart charging and may show 12.8–13.2 V at cruise. That's normal.</p></div>
      <div class="mitem"><b>3 · Load test</b><p>Turn on headlights, blower on high, rear defrost and any light bars or winch. Running voltage should stay above about 13.2 V.</p></div>`, null,
      () => { clearInterval(t); extraPoll.delete('VBAT'); });
    upd();
  }
  function econTest() {
    let runs = []; try { runs = JSON.parse(localStorage.getItem('td.econ') || '[]'); } catch (e) { }
    const cur = () => { const econ = trip.fuel > 0.01 && trip.dist > 0.1 ? (imp() ? (trip.dist * 0.621371) / (trip.fuel * 0.264172) : trip.fuel / trip.dist * 100) : null; return { econ, dist: imp() ? trip.dist * 0.621371 : trip.dist }; };
    const u = imp() ? 'mpg' : 'L/100km';
    const render = el => {
      const c = cur();
      el.querySelector('#ecNow').innerHTML = c.econ == null ? 'Drive a few miles to measure…' : `<b style="font-family:var(--num);font-size:30px">${c.econ.toFixed(1)}</b> ${u} over ${c.dist.toFixed(1)} ${imp() ? 'mi' : 'km'}`;
      el.querySelector('#ecRuns').innerHTML = runs.length ? runs.map(r => `<div class="mon"><span>${esc(r.label)}<br><small class="muted">${esc(r.date)} · ${r.dist.toFixed(1)} ${imp() ? 'mi' : 'km'}</small></span><b>${r.econ.toFixed(1)} ${u}</b></div>`).join('') : '<div class="small muted">No saved runs yet.</div>';
    };
    sheet(`<h3>Fuel economy A/B test</h3><p class="small muted" style="line-height:1.5">Drive the same route, at the same speeds, once <b>with</b> the accessory and once <b>without</b>. Reset the trip at the start of each run.</p>
      <div class="card" id="ecNow" style="text-align:center;margin:10px 0"></div>
      <div class="row" style="gap:8px"><button class="grow" id="ecReset">Reset trip / start run</button></div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="grow primary" id="ecA">Save: with accessory</button><button class="grow" id="ecB">Save: without</button></div>
      <h2>Saved runs</h2><div id="ecRuns"></div><button class="ghost small" id="ecClr" style="margin-top:8px">Clear saved runs</button>`, el => {
      render(el); const iv = setInterval(() => render(el), 1000); el._iv = iv;
      el.querySelector('#ecReset').onclick = () => { trip.start = performance.now(); trip.dist = trip.fuel = trip.maxSpd = 0; toast('Trip reset. Start driving'); render(el); };
      const saveRun = label => { const c = cur(); if (c.econ == null) return toast('Not enough distance yet'); runs.push({ label, econ: c.econ, dist: c.dist, date: new Date().toLocaleDateString() }); try { localStorage.setItem('td.econ', JSON.stringify(runs)); } catch (e) { } render(el); };
      el.querySelector('#ecA').onclick = () => saveRun('With accessory'); el.querySelector('#ecB').onclick = () => saveRun('Without');
      el.querySelector('#ecClr').onclick = () => { runs = []; try { localStorage.removeItem('td.econ'); } catch (e) { } render(el); };
    }, () => { clearInterval($('#sheet')._iv); });
    if (!S.tiles.includes('MPG')) { S.tiles.push('MPG'); save(); renderTiles(); }
  }
  const ACTIONS = {
    speedo: { n: 'Speedometer check', d: 'Your speed vs GPS: % error', run: speedoCheck },
    charge: { n: 'Battery & charging', d: 'Live voltage with pass/fail', run: chargeTest },
    drain: { n: 'Parasitic drain watch', d: 'Battery voltage trend, engine off', run: () => graphPreset(['VBAT'], 600, 'Drain watch') },
    trims: { n: 'Fuel-trim watch', d: 'Short/long trims + MAF', run: () => graphPreset(['06', '07', '10'], 180, 'Fuel-trim watch') },
    perf: { n: 'Performance monitor', d: 'Timing (knock), intake temp, RPM', run: () => graphPreset(['0E', '0F', '0C'], 60, 'Performance monitor') },
    tow: { n: 'Towing monitor', d: 'Coolant, engine load, intake temp', run: () => graphPreset(['05', '04', '0F'], 600, 'Towing monitor') },
    econ: { n: 'Economy A/B test', d: 'Measure an accessory’s mpg cost', run: econTest },
    codes: { n: 'Read codes', d: 'Check for faults after install', run: () => { show('codes'); if (connected) $('#readCodes').click(); } },
    ready: { n: 'Emissions readiness', d: 'Inspection-ready check', run: () => { show('info'); if (connected) refreshStatus(); } },
    hud: { n: 'HUD mode', d: 'Windshield reflection display', run: () => { if (need()) toggleHud(); } },
    term: { n: 'Terminal', d: 'Raw commands (at your discretion)', run: () => show('term') }
  };

  // ---------- Mods tab ----------
  let modSeg = 'veh', openCard = null;
  $('#modSeg').onclick = e => { const s = e.target.dataset.s; if (!s) return; modSeg = s; $$('#modSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === s)); renderMods(); };
  $('#modSearch').oninput = () => renderMods();
  const isMine = v => { const n = vehName(); return !!n && v.match.test(n); };
  const guide = (veh, what, tool) => 'https://www.google.com/search?q=' + encodeURIComponent(`${veh} ${what} ${tool || ''} how to`);
  function actBtns(list) { return `<div class="acts">${list.map(a => ACTIONS[a] ? `<button class="act" data-act="${a}"><span class="an">${ACTIONS[a].n}</span><span class="ad">${ACTIONS[a].d}</span></button>` : '').join('')}</div>`; }
  function vehCard(v, mine) {
    const T = MODS.TOOLS[v.tool] || MODS.TOOLS.other;
    const BADGE = { f150: 'F', silverado: 'SLV', rav4: 'RAV4', crv: 'CR-V', ram: 'RAM', sierra: 'GMC', modely: 'Y', camry: 'CAM', tacoma: 'TAC', equinox: 'EQX', wrangler: 'JL', bronco: 'BRO', mustang: 'MUS', gladiator: 'JT', '4runner': '4R', supra: 'GR', z: 'Z', tahoe: 'THO', challenger: 'CHL', camaro: 'CMR' };
    const initials = BADGE[v.id] || v.name.slice(0, 3);
    return `<div class="mcard ${openCard === v.id ? 'open' : ''} ${mine ? 'mine' : ''}" data-id="${v.id}">
      <div class="mhead"><div class="ic" style="font-size:${initials.length > 3 ? 13 : 16}px">${esc(initials)}</div><div><div class="t">${esc(v.name)}</div><div class="s"><span class="pill">${esc(v.rank)}</span>${v.both ? '<span class="pill both">Top seller + SEMA pick</span>' : ''}${mine ? '<span class="pill mine">Your vehicle</span>' : ''}<span class="pill">${esc(T.name)}</span></div></div>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div>
      <div class="mbody"><div><div class="minner">
        <div class="small muted" style="margin:2px 0 4px;font-weight:600;letter-spacing:.4px">POPULAR MODS</div>
        ${v.mods.map(([t, d]) => `<div class="mitem"><b>${esc(t)}</b><p>${esc(d)}</p><a target="_blank" rel="noopener" href="${guide(v.name, t, T.name)}">Find a guide ↗</a></div>`).join('')}
        <div class="small muted" style="margin:14px 0 0;font-weight:600;letter-spacing:.4px">DO IT WITH TORQUE DECK</div>${actBtns(v.actions)}
        <div class="toolbox"><b>To change settings: ${esc(T.name)}.</b> ${esc(T.note)}</div>
      </div></div></div></div>`;
  }
  function accCard(a) {
    const veh = vehName();
    return `<div class="mcard ${openCard === a.id ? 'open' : ''}" data-id="${a.id}">
      <div class="mhead"><div class="ic">${a.icon}</div><div><div class="t">${esc(a.name)}</div><div class="s"><span class="pill">${a.actions.map(x => ACTIONS[x].n).slice(0, 2).join(' · ')}</span></div></div>
      <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div>
      <div class="mbody"><div><div class="minner">
        <p style="margin:0 0 6px;font-size:13.5px;line-height:1.5">${esc(a.why)}</p>
        ${a.tips.map(t => `<div class="mitem"><p>${esc(t)}</p></div>`).join('')}
        <div class="small muted" style="margin:14px 0 0;font-weight:600;letter-spacing:.4px">DO IT WITH TORQUE DECK</div>${actBtns(a.actions)}
        <a class="btnlink" style="margin-top:6px" target="_blank" rel="noopener" href="${guide(veh || '', a.name, '')}">Find install guides${veh ? ' for your ' + esc(veh) : ''} ↗</a>
        ${SHOP.accessoryUrl(a.id, veh) ? `<a class="btnlink" style="margin-top:8px" target="_blank" rel="noopener sponsored" href="${SHOP.accessoryUrl(a.id, veh)}">Shop on Amazon ↗</a>` : ''}
      </div></div></div></div>`;
  }
  function myCarCard() {
    const n = vehName(); if (!n) return '';
    if (MODS.V.some(v => isMine(v))) return '';
    const make = (nhtsa && nhtsa.Make || (OBD.decodeVin(lastVin) || {}).make || '').toLowerCase();
    const T = MODS.TOOLS[MODS.MAKE_TOOL[make] || 'other'];
    return `<div class="mcard mine open" data-id="mine"><div class="mhead"><div class="ic">★</div><div><div class="t">Your ${esc(n)}</div><div class="s"><span class="pill mine">Connected vehicle</span><span class="pill">${esc(T.name)}</span></div></div></div>
      <div class="mbody"><div><div class="minner">${actBtns(['codes', 'ready', 'charge', 'trims', 'speedo', 'econ'])}
      <div class="toolbox"><b>To change settings: ${esc(T.name)}.</b> ${esc(T.note)}</div>
      <a class="btnlink" style="margin-top:8px" target="_blank" rel="noopener" href="${guide(n, 'hidden features customization', T.name)}">Find customizations for your ${esc(n)} ↗</a></div></div></div></div>`;
  }
  // ---------- adapter picks (affiliate) ----------
  function scannerHtml() {
    const card = x => `<div class="scan${x.works ? '' : ' own'}"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px"><b>${esc(x.name)}</b>
        <span class="row" style="gap:4px;flex:none">${x.best ? '<span class="pill mine">Best pick</span>' : ''}${x.budget ? '<span class="pill">Budget</span>' : ''}<span class="pill ${x.works ? 'both' : ''}">${esc(x.conn)}</span></span></div>
      <p>${esc(x.what)}</p><a class="btnlink${x.works ? ' primary' : ''}" target="_blank" rel="noopener sponsored" href="${x.url}">${/\/s\?k=/.test(x.url) ? 'Search on Amazon' : 'View on Amazon'} ↗</a></div>`;
    return `<div class="shophead">WORKS WITH TORQUE DECK</div><div class="scangrid">${SHOP.SCANNERS.filter(x => x.works).map(card).join('')}</div>
      <div class="shophead">ALL-IN-ONE SCANNERS · USE THEIR OWN APP</div><div class="scangrid">${SHOP.SCANNERS.filter(x => !x.works).map(card).join('')}</div>
      <p class="small muted" style="margin:12px 2px 0">${SHOP.DISCLOSURE}</p>`;
  }
  function scannerSheet() {
    sheet(`<h3>Get an adapter</h3><p class="small muted" style="line-height:1.5">Any Bluetooth LE ELM327 adapter works on every phone. Classic Bluetooth ones work on Android (Chrome 138+). Plug it in under the dash, turn the ignition on, then tap Connect.</p>${scannerHtml()}`);
  }
  function renderMods() {
    const q = $('#modSearch').value.trim().toLowerCase();
    const hay = o => JSON.stringify(o).toLowerCase();
    let html = '';
    if (q) {
      const vs = MODS.V.filter(v => hay([v.name, v.mods, v.rank, (MODS.TOOLS[v.tool] || {}).name]).includes(q)), as = MODS.A.filter(a => hay([a.name, a.why, a.tips]).includes(q));
      html = vs.map(v => vehCard(v, isMine(v))).join('') + as.map(accCard).join('');
      if (!html) html = '<div class="empty">Nothing matched. Try “tires”, “battery” or a model name.</div>';
    } else if (modSeg === 'shop') {
      html = `<p class="small muted" style="margin:6px 2px 4px;line-height:1.5">Torque Deck works with Bluetooth LE ELM327 adapters on any phone, and Classic Bluetooth ones on Android.</p>` + scannerHtml();
    } else if (modSeg === 'acc') {
      html = MODS.A.map(accCard).join('');
    } else {
      const list = MODS.V.slice().sort((a, b) => isMine(b) - isMine(a));
      html = myCarCard() + list.map(v => vehCard(v, isMine(v))).join('');
    }
    $('#modList').innerHTML = html;
  }
  $('#modList').addEventListener('click', e => {
    const act = e.target.closest('[data-act]'); if (act) { e.stopPropagation(); ACTIONS[act.dataset.act].run(); return; }
    const head = e.target.closest('.mhead'); if (!head) return;
    const card = head.parentElement, id = card.dataset.id;
    const wasOpen = card.classList.contains('open');
    $$('#modList .mcard.open').forEach(c => { if (c !== card) c.classList.remove('open'); });
    card.classList.toggle('open', !wasOpen); openCard = wasOpen ? null : id;
    if (!wasOpen) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 320);
  });

  // ---------- DRIVING MODE: full-screen, glanceable, user-arranged board ----------
  const DRIVE_DEF = { night: false, widgets: [
    { id: 'w1', kind: 'pid', pid: '0D', style: 'num', w: 4, h: 2 },
    { id: 'w2', kind: 'pid', pid: '0C', style: 'bar', w: 4, h: 1 },
    { id: 'w3', kind: 'pid', pid: '05', style: 'num', w: 2, h: 1 },
    { id: 'w4', kind: 'pid', pid: 'VBAT', style: 'num', w: 2, h: 1 },
    { id: 'w5', kind: 'pid', pid: 'MPG', style: 'num', w: 2, h: 1 },
    { id: 'w6', kind: 'clock', w: 2, h: 1 }] };
  const DRIVE_PRESETS = {
    'Daily driver': DRIVE_DEF.widgets,
    'Towing': [{ kind: 'pid', pid: '0D', style: 'num', w: 2, h: 2 }, { kind: 'pid', pid: '05', style: 'gauge', w: 2, h: 2 }, { kind: 'pid', pid: '04', style: 'bar', w: 4, h: 1 }, { kind: 'pid', pid: '0F', style: 'num', w: 2, h: 1 }, { kind: 'pid', pid: 'VBAT', style: 'num', w: 2, h: 1 }],
    'Performance': [{ kind: 'pid', pid: '0C', style: 'gauge', w: 4, h: 2 }, { kind: 'pid', pid: '0D', style: 'num', w: 2, h: 1 }, { kind: 'pid', pid: '0E', style: 'num', w: 2, h: 1 }, { kind: 'pid', pid: '0F', style: 'num', w: 2, h: 1 }, { kind: 'pid', pid: '11', style: 'bar', w: 2, h: 1 }],
    'Economy': [{ kind: 'pid', pid: 'MPG', style: 'num', w: 4, h: 2 }, { kind: 'pid', pid: '0D', style: 'num', w: 2, h: 1 }, { kind: 'trip', w: 2, h: 1 }, { kind: 'pid', pid: '2F', style: 'bar', w: 4, h: 1 }],
    'Minimal': [{ kind: 'pid', pid: '0D', style: 'num', w: 4, h: 3 }, { kind: 'clock', w: 4, h: 1 }]
  };
  if (!S.drive) S.drive = JSON.parse(JSON.stringify(DRIVE_DEF));
  let driveOn = false, driveEdit = false, wid = Date.now();
  const SPECIAL = { clock: 'Clock', trip: 'Trip distance', mil: 'Check engine status' };
  const wName = w => w.kind === 'pid' ? meta(w.pid).short : SPECIAL[w.kind];
  const movingFast = () => { const s = data['0D'] && data['0D'].v; return connected && !demo && s != null && s > 8; };

  function openDrive() {
    let el = $('#drive');
    if (!el) {
      el = document.createElement('div'); el.id = 'drive';
      el.innerHTML = `<div class="dtop"><button id="dExit" aria-label="Exit">✕</button><span id="dStat" class="grow"></span>
        <div class="dseg" id="dModeSeg"><button data-dm="tiles" class="on">Tiles</button><button data-dm="map">Map</button></div><button id="dNav">🧭</button><button id="dTheme">🎨</button><button id="dNight">☾</button><button id="dEdit">Edit</button></div>
        <div class="dedit" id="dEditBar"><button id="dAdd">+ Add</button><button id="dPreset">Layouts</button><span class="grow small muted">Drag to move · corner to resize · tap for options</span><button class="primary" id="dDone">Done</button></div>
        <div class="dgrid" id="dGrid"></div>
        <div id="dMapWrap"><div id="dMap"></div>
          <div id="dMapFallback"><div style="max-width:320px;text-align:center;line-height:1.5"></div></div>
          <div id="dOverlay"><div id="ovPrimary"></div><div id="ovDials"></div></div>
          <div id="dGpsMiss">Waiting for GPS\u2026</div>
          <button id="dRecenter">Re-center</button>
          <div id="dMapCtl"><button id="dZoomIn">+</button><button id="dZoomOut">\u2212</button><button id="dCompass" title="Reset north"><span class="ci">\u25B2</span></button><button id="d3D" title="Tilt 3D">3D</button><button id="dHeadUp" title="Heading up">H\u2191</button><button id="dMapOpts">Dials</button><button id="dDir">Directions</button></div>
          <div id="dDirHint">Tap your destination on the map</div>
          <div id="dRoutePanel"><div id="dRouteSum"></div><div id="dRouteSteps"></div></div>
        </div>`;
      document.body.appendChild(el);
      $('#dExit').onclick = closeDrive;
      $('#dEdit').onclick = () => { if (movingFast()) return toast('Pull over to edit the layout'); setEdit(true); };
      $('#dDone').onclick = () => setEdit(false);
      $('#dNight').onclick = () => { S.drive.night = !S.drive.night; save(); el.classList.toggle('night', S.drive.night); };
      $('#dAdd').onclick = () => widgetSheet(null);
      $('#dPreset').onclick = presetSheet;
      $('#dTheme').onclick = () => themeSheet();
      $('#dNav').onclick = mapsSheet;
      $('#dModeSeg').onclick = e => { const m = e.target.dataset.dm; if (m) setDriveMode(m); };
      $('#dRecenter').onclick = recenter;
      $('#dZoomIn').onclick = () => map && map.zoomIn();
      $('#dZoomOut').onclick = () => map && map.zoomOut();
      $('#dCompass').onclick = resetNorth;
      $('#d3D').onclick = () => setPitch3D(!(S.map.pitch >= 20));
      $('#dHeadUp').onclick = () => setHeadingUp(!S.map.headingUp);
      $('#dMapOpts').onclick = mapDialsSheet;
      $('#dDir').onclick = startDirections;
      bindGrid();
      new ResizeObserver(fitDrive).observe($('#dGrid'));
      const rp = $('#dRoutePanel'), wrap = $('#dMapWrap');
      new ResizeObserver(() => {
        const on = rp.offsetHeight > 0, side = on && rp.offsetWidth < wrap.clientWidth * 0.6;
        wrap.style.setProperty('--rp', on && !side ? rp.offsetHeight + 12 + 'px' : '0px');
        wrap.style.setProperty('--rpw', side ? rp.offsetWidth + 10 + 'px' : '0px');
        wrap.classList.toggle('routing', on && (side || !rp.classList.contains('min')));
      }).observe(rp);
    }
    el.classList.toggle('night', !!S.drive.night);
    el.classList.add('open'); driveOn = true; setEdit(false); setDriveMode('tiles'); renderDrive(); requestWake();
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); } catch (e) { }
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('any').catch(() => { }); } catch (e) { }
    if (!connected) toast('Not connected: tiles will fill in once the adapter connects', 3500);
  }
  function closeDrive() { driveOn = false; setEdit(false); stopGeo(); $('#drive').classList.remove('open'); try { document.fullscreenElement && document.exitFullscreen(); } catch (e) { } }
  function setEdit(on) { driveEdit = on; const el = $('#drive'); if (el) el.classList.toggle('editing', on); fitDrive(); }

  // Portrait is a 4-column board. Landscape is 8 columns, so the same board sits as two
  // side-by-side halves instead of leaving empty rows.
  function layoutDims() { return { cols: innerWidth > innerHeight ? 8 : 4 }; }
  // Stretch the rows that are actually used to fill the screen; scroll only if tiles
  // would get shorter than MIN_ROW.
  const GRID_GAP = 8, MIN_ROW = 58;
  function fitDrive() {
    const g = $('#dGrid'); if (!g || !driveOn) return;
    const H = g.clientHeight; if (!H) return;
    g.style.gridAutoRows = '10px';
    const top = g.getBoundingClientRect().top - g.scrollTop;
    let bottom = 0; g.querySelectorAll('.dw').forEach(c => { bottom = Math.max(bottom, c.getBoundingClientRect().bottom - top); });
    const used = Math.max(1, Math.round((bottom + GRID_GAP) / (10 + GRID_GAP)));
    const rowH = Math.max(MIN_ROW, Math.floor((H - (used - 1) * GRID_GAP) / used));
    g.style.gridAutoRows = rowH + 'px';
    g.classList.toggle('scroll', used * rowH + (used - 1) * GRID_GAP > H + 1);
  }
  function renderDrive() {
    const g = $('#dGrid'); if (!g) return;
    const { cols } = layoutDims();
    g.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    g.innerHTML = S.drive.widgets.map(w => {
      const W = Math.min(w.w, cols);
      return `<div class="dw ${w.style || ''}" data-id="${w.id}" style="grid-column:span ${W};grid-row:span ${w.h}">
        <div class="dl">${esc(wName(w))}</div><div class="dv"><span class="n">—</span><span class="u"></span></div>
        ${w.style === 'bar' ? '<div class="dbar"><b></b></div>' : ''}${w.style === 'gauge' ? '<svg class="dg" viewBox="0 0 100 60"><path d="M10 55 A40 40 0 0 1 90 55" class="tr"/><path d="" class="fl"/></svg>' : ''}
        <button class="dx" data-x="1">✕</button><div class="dr" data-r="1"></div></div>`;
    }).join('');
    fitDrive();
    updateDrive(true);
  }
  function updateDrive() {
    if (!driveOn) return;
    let alarm = false;
    S.drive.widgets.forEach(w => {
      const el = document.querySelector(`.dw[data-id="${w.id}"]`); if (!el) return;
      let n = '—', u = '', f = 0, lv = 0;
      if (w.kind === 'clock') { const d = new Date(); n = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, ''); u = d.getHours() < 12 ? 'AM' : 'PM'; }
      else if (w.kind === 'trip') { n = (imp() ? trip.dist * 0.621371 : trip.dist).toFixed(1); u = imp() ? 'mi' : 'km'; }
      else if (w.kind === 'mil') { const on = lastStatus && lastStatus.mil; n = lastStatus ? (on ? 'CHECK' : 'OK') : '—'; u = lastStatus && on ? lastStatus.dtcCount + ' codes' : ''; lv = on ? 1 : 0; }
      else {
        const d = data[w.pid], c = conv(w.pid, d && d.v);
        n = c.v == null ? '—' : (w.pid === '0D' || w.pid === '0C' ? Math.round(c.v).toLocaleString() : fmt(c.v, w.pid)); u = c.unit;
        f = c.v == null ? 0 : Math.max(0, Math.min(1, (c.v - c.min) / (c.max - c.min)));
        lv = d ? level(w.pid, d.v) : 0; if (lv === 2) alarm = true;
      }
      el.querySelector('.n').textContent = n; el.querySelector('.u').textContent = u;
      el.classList.toggle('warn', lv === 1); el.classList.toggle('bad', lv === 2);
      const bar = el.querySelector('.dbar b'); if (bar) bar.style.width = (f * 100) + '%';
      const fl = el.querySelector('.dg .fl');
      if (fl) { const a = Math.PI * (1 - f), x = 50 + 40 * Math.cos(a), y = 55 - 40 * Math.sin(a); fl.setAttribute('d', f > 0.005 ? `M10 55 A40 40 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}` : ''); }
    });
    $('#drive').classList.toggle('alarm', alarm);
    const stT = connected ? (customHeader ? 'Live data paused' : 'Live') : 'Not connected', st = $('#dStat');
    if (st.dataset.t !== stT) { st.dataset.t = stT; st.innerHTML = `●<span class="dst"> ${stT}</span>`; }
    $('#dStat').style.color = connected ? 'var(--ok)' : 'var(--faint)';
  }
  window.addEventListener('resize', () => { if (driveOn) renderDrive(); });

  // drag to move, corner to resize, tap for options (edit mode only)
  function bindGrid() {
    const g = $('#dGrid'); let drag = null;
    g.addEventListener('pointerdown', e => {
      if (!driveEdit) return;
      const card = e.target.closest('.dw'); if (!card) return;
      if (e.target.dataset.x) { S.drive.widgets = S.drive.widgets.filter(w => w.id !== card.dataset.id); save(); renderDrive(); return; }
      const w = S.drive.widgets.find(x => x.id === card.dataset.id), r = card.getBoundingClientRect();
      const { cols } = layoutDims(), gr = g.getBoundingClientRect();
      const cellW = (gr.width + 8) / cols, cellH = parseFloat(getComputedStyle(g).gridAutoRows) + 8 || r.height / w.h;
      drag = { card, w, mode: e.target.dataset.r ? 'resize' : 'move', x0: e.clientX, y0: e.clientY, r, cellW, cellH, cols, moved: false };
      card.setPointerCapture(e.pointerId); e.preventDefault();
    });
    g.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
      if (!drag.moved) return;
      if (drag.mode === 'resize') {
        const nw = Math.max(1, Math.min(drag.cols, Math.round((drag.r.width + dx + 8) / drag.cellW)));
        const nh = Math.max(1, Math.min(4, Math.round((drag.r.height + dy + 8) / drag.cellH)));
        if (nw !== drag.w.w || nh !== drag.w.h) { drag.w.w = nw; drag.w.h = nh; drag.card.style.gridColumn = `span ${nw}`; drag.card.style.gridRow = `span ${nh}`; }
      } else {
        drag.card.style.transform = `translate(${dx}px,${dy}px) scale(1.03)`; drag.card.classList.add('lift');
        drag.card.style.pointerEvents = 'none';
        const over = document.elementFromPoint(e.clientX, e.clientY); drag.card.style.pointerEvents = '';
        const tgt = over && over.closest('.dw');
        $$('.dw.target').forEach(x => x.classList.remove('target'));
        if (tgt && tgt !== drag.card) { tgt.classList.add('target'); drag.target = tgt; } else drag.target = null;
      }
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null;
      $$('.dw.target').forEach(x => x.classList.remove('target'));
      if (!d.moved) { widgetSheet(d.w); return; }
      if (d.mode === 'move' && d.target) {
        const arr = S.drive.widgets, from = arr.indexOf(d.w), to = arr.findIndex(x => x.id === d.target.dataset.id);
        arr.splice(from, 1); arr.splice(to, 0, d.w);
      }
      save(); renderDrive();
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  }
  function widgetSheet(w) {
    const isNew = !w; const cur = w || { kind: 'pid', pid: '05', style: 'num', w: 2, h: 1 };
    const sizes = [['S', 2, 1], ['Wide', 4, 1], ['M', 2, 2], ['L', 4, 2], ['XL', 4, 3]];
    const styles = [['num', 'Big number'], ['bar', 'Number + bar'], ['gauge', 'Gauge']];
    const opts = [...Object.keys(SPECIAL).map(k => ['@' + k, SPECIAL[k], true]), ...allPidList().map(p => [p, meta(p).name, supportedHas(p)])];
    const curKey = cur.kind === 'pid' ? cur.pid : '@' + cur.kind;
    sheet(`<h3>${isNew ? 'Add a tile' : 'Tile options'}</h3>
      <div class="small muted" style="margin:10px 0 6px">SIZE</div><div class="seg" id="wsSize">${sizes.map(([l, a, b]) => `<button data-w="${a}" data-h="${b}" class="${cur.w === a && cur.h === b ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="small muted" style="margin:12px 0 6px">STYLE</div><div class="seg" id="wsStyle">${styles.map(([k, l]) => `<button data-s="${k}" class="${(cur.style || 'num') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="small muted" style="margin:12px 0 2px">SHOW</div>
      ${opts.map(([k, l, sup]) => `<div class="opt ${k === curKey ? 'sel' : ''}" data-k="${k}"><span>${esc(l)}</span><small>${k === curKey ? '✓' : sup ? '' : 'not supported'}</small></div>`).join('')}
      <div class="row" style="margin-top:14px">${isNew ? '' : '<button class="danger grow" id="wsDel">Remove tile</button>'}<button class="primary grow" id="wsOk">${isNew ? 'Add tile' : 'Done'}</button></div>`, el => {
      el.querySelectorAll('#wsSize button').forEach(b => b.onclick = () => { cur.w = +b.dataset.w; cur.h = +b.dataset.h; el.querySelectorAll('#wsSize button').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelectorAll('#wsStyle button').forEach(b => b.onclick = () => { cur.style = b.dataset.s; el.querySelectorAll('#wsStyle button').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelectorAll('.opt').forEach(o => o.onclick = () => {
        const k = o.dataset.k; if (k[0] === '@') { cur.kind = k.slice(1); delete cur.pid; } else { cur.kind = 'pid'; cur.pid = k; }
        el.querySelectorAll('.opt').forEach(x => { x.classList.toggle('sel', x === o); x.querySelector('small').textContent = x === o ? '✓' : ''; });
      });
      const del = el.querySelector('#wsDel'); if (del) del.onclick = () => { S.drive.widgets = S.drive.widgets.filter(x => x !== w); save(); closeSheet(); renderDrive(); };
      el.querySelector('#wsOk').onclick = () => { if (isNew) { cur.id = 'w' + (++wid); S.drive.widgets.push(cur); } save(); closeSheet(); renderDrive(); };
    });
  }
  function presetSheet() {
    sheet(`<h3>Layouts</h3><p class="small muted">Start from a preset, then tweak it. This replaces your current board.</p>
      ${Object.keys(DRIVE_PRESETS).map(k => `<div class="opt" data-k="${esc(k)}"><span>${esc(k)}</span><small>${DRIVE_PRESETS[k].map(wName).join(' · ')}</small></div>`).join('')}`, el => {
      el.querySelectorAll('.opt').forEach(o => o.onclick = () => { S.drive.widgets = JSON.parse(JSON.stringify(DRIVE_PRESETS[o.dataset.k])).map(w => Object.assign(w, { id: 'w' + (++wid) })); save(); closeSheet(); renderDrive(); });
    });
  }
  setInterval(updateDrive, 250);
  setInterval(updateMapOverlay, 250);
  ACTIONS.drive = { n: 'Driving mode', d: 'Big glanceable dashboard for a phone mount', run: openDrive };

  // ---------- THEMES ----------
  // Original themes: practical (contrast, daylight, colorblind-safe) and era-inspired looks.
  const T = (o) => Object.assign({ onaccent: '#ffffff', termbg: o.bg, dbg: o.bg, dcard: o.panel, num: "'Rajdhani',system-ui,sans-serif" }, o);
  const THEMES = {
    torque: T({ name: 'Torque', desc: 'Default · dark with orange', bg: '#0b0d10', panel: '#13171c', panel2: '#1a1f26', line: '#252c35', text: '#e8edf2', dim: '#8a96a3', faint: '#55606c', accent: '#ff6a1a', accent2: '#ffb020', ok: '#2fd27a', warn: '#ffb020', bad: '#ff4d4d', blue: '#3fa9ff', onaccent: '#140800', termbg: '#06080a', dbg: '#000000', dcard: '#0c0f13' }),
    midnight: T({ name: 'Midnight', desc: 'Deep navy · cool blue', bg: '#070b14', panel: '#0d1424', panel2: '#131c30', line: '#1f2a44', text: '#e6eefc', dim: '#8796b5', faint: '#4f5d7a', accent: '#3fa9ff', accent2: '#7cc4ff', ok: '#35d49a', warn: '#ffc24d', bad: '#ff5c6c', blue: '#a78bfa', onaccent: '#04121f', dbg: '#03060c' }),
    racing: T({ name: 'Racing Green', desc: 'British green · lime', bg: '#07100b', panel: '#0d1a13', panel2: '#13241a', line: '#1e3628', text: '#e9f5ee', dim: '#86a593', faint: '#4f6b5b', accent: '#2fd27a', accent2: '#b6f36b', ok: '#7ee0ff', warn: '#ffc24d', bad: '#ff5c5c', blue: '#4cc3ff', onaccent: '#03140a', dbg: '#030805' }),
    carbon: T({ name: 'Carbon Red', desc: 'Race car · black & red', bg: '#0a0a0b', panel: '#141416', panel2: '#1c1c1f', line: '#2a2a2e', text: '#f1f1f3', dim: '#9a9aa2', faint: '#5d5d64', accent: '#e10600', accent2: '#ff5a36', ok: '#3ad37a', warn: '#ffb020', bad: '#ff2b2b', blue: '#5aa9ff', dbg: '#000000' }),
    vfd: T({ name: '80s Digital', desc: 'Glowing teal segment display', bg: '#020807', panel: '#06110f', panel2: '#0a1a17', line: '#123029', text: '#6cf7d8', dim: '#2fae95', faint: '#1b6a5b', accent: '#39f5c8', accent2: '#9dfcf0', ok: '#39f5c8', warn: '#f5d33a', bad: '#ff4f4f', blue: '#6cc8ff', onaccent: '#001a14', dbg: '#000403', num: "'Share Tech Mono',ui-monospace,monospace", glow: 1 }),
    amber: T({ name: 'Amber CRT', desc: 'Retro amber terminal', bg: '#0b0700', panel: '#140d02', panel2: '#1d1404', line: '#33230a', text: '#ffb641', dim: '#b37a22', faint: '#6b4a16', accent: '#ffb641', accent2: '#ffd37a', ok: '#ffd37a', warn: '#ff8c1a', bad: '#ff4d2e', blue: '#ffcf70', onaccent: '#1a0f00', dbg: '#060400', num: "'Share Tech Mono',ui-monospace,monospace", glow: 1 }),
    synth: T({ name: 'Synthwave', desc: 'Neon pink & cyan', bg: '#0d0519', panel: '#170a2b', panel2: '#20103a', line: '#34195a', text: '#fbe9ff', dim: '#b48bd1', faint: '#6e4f8e', accent: '#ff2bd6', accent2: '#29e7ff', ok: '#39ffb0', warn: '#ffd23f', bad: '#ff3d6e', blue: '#29e7ff', onaccent: '#1a0020', dbg: '#07020e', num: "'Orbitron',system-ui,sans-serif", glow: 1 }),
    stealth: T({ name: 'Stealth', desc: 'Monochrome · minimal', bg: '#050505', panel: '#0f0f0f', panel2: '#171717', line: '#262626', text: '#ededed', dim: '#9b9b9b', faint: '#5e5e5e', accent: '#d9d9d9', accent2: '#a6a6a6', ok: '#bdbdbd', warn: '#ffd166', bad: '#ff6b6b', blue: '#cfcfcf', onaccent: '#000000', dbg: '#000000' }),
    rednight: T({ name: 'Red Night', desc: 'All-red · protects night vision', bg: '#000000', panel: '#0a0302', panel2: '#120504', line: '#2a0c08', text: '#ff4a2e', dim: '#a8301e', faint: '#5c1a10', accent: '#ff3b1f', accent2: '#ff6a4d', ok: '#ff7a5c', warn: '#ff9a40', bad: '#ff1a1a', blue: '#ff6a4d', onaccent: '#000000', dbg: '#000000', dcard: '#070201' }),
    daylight: T({ name: 'Daylight', desc: 'Light · readable in sun', bg: '#eef1f5', panel: '#ffffff', panel2: '#f2f4f7', line: '#d3d9e1', text: '#0f1419', dim: '#4f5b68', faint: '#8792a0', accent: '#e4570b', accent2: '#f29100', ok: '#15803d', warn: '#b45309', bad: '#d62828', blue: '#1565c0', termbg: '#f7f9fb', dbg: '#e9edf2', dcard: '#ffffff' }),
    arctic: T({ name: 'Arctic', desc: 'Light · icy blue', bg: '#e8f1f8', panel: '#f8fbfe', panel2: '#edf4fa', line: '#c9d9e8', text: '#0b2236', dim: '#45627d', faint: '#7f97ad', accent: '#0077b6', accent2: '#00a6d6', ok: '#0f8a5f', warn: '#b45309', bad: '#c62828', blue: '#5b4bc4', termbg: '#f4f8fc', dbg: '#e3edf6', dcard: '#ffffff' }),
    hcdark: T({ name: 'High Contrast Dark', desc: 'Max contrast · bold borders', bg: '#000000', panel: '#000000', panel2: '#121212', line: '#ffffff', text: '#ffffff', dim: '#ffffff', faint: '#d0d0d0', accent: '#ffe600', accent2: '#ffe600', ok: '#00ff66', warn: '#ffe600', bad: '#ff4040', blue: '#4dd2ff', onaccent: '#000000', dbg: '#000000', dcard: '#000000', hc: 1 }),
    hclight: T({ name: 'High Contrast Light', desc: 'Black on white · bold borders', bg: '#ffffff', panel: '#ffffff', panel2: '#f0f0f0', line: '#000000', text: '#000000', dim: '#000000', faint: '#333333', accent: '#0033cc', accent2: '#0033cc', ok: '#006b2e', warn: '#8a5a00', bad: '#c00000', blue: '#0033cc', dbg: '#ffffff', dcard: '#ffffff', hc: 1 }),
    cvd: T({ name: 'Colorblind Safe', desc: 'Okabe-Ito palette · no red/green reliance', bg: '#0b0d10', panel: '#14171c', panel2: '#1b2027', line: '#2a313b', text: '#eef1f4', dim: '#9aa5b1', faint: '#5f6b78', accent: '#E69F00', accent2: '#F0E442', ok: '#56B4E9', warn: '#F0E442', bad: '#D55E00', blue: '#CC79A7', onaccent: '#1a1000', dbg: '#000000', dcard: '#0d1014' })
  };
  const VARMAP = { bg: '--bg', panel: '--panel', panel2: '--panel2', line: '--line', text: '--text', dim: '--dim', faint: '--faint', accent: '--accent', accent2: '--accent2', ok: '--ok', warn: '--warn', bad: '--bad', blue: '--blue', onaccent: '--onaccent', termbg: '--termbg', dbg: '--dbg', dcard: '--dcard', num: '--num' };
  function applyTheme(key) {
    const th = THEMES[key] || THEMES.torque, root = document.documentElement;
    Object.entries(VARMAP).forEach(([k, v]) => root.style.setProperty(v, th[k]));
    root.classList.toggle('hc', !!th.hc);
    root.classList.toggle('glow', !!th.glow);
    root.classList.toggle('nomotion', !!S.noMotion);
    const scale = S.textScale || 1; ['header', 'main', 'nav'].forEach(sel => { const el = $(sel); if (el) el.style.zoom = scale; });
    const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = th.bg;
    Object.keys(cssCache).forEach(k => delete cssCache[k]);
    S.theme = key; save();
    const tb = $('#thBtn'); if (tb) tb.textContent = '🎨 ' + th.name;
    try { buildGauge(); updateChips(); drawChart(); if (typeof renderDrive === 'function' && driveOn) renderDrive(); } catch (e) { }
  }
  function themeSheet() {
    const card = (k, th) => `<button class="thc ${S.theme === k ? 'on' : ''}" data-t="${k}" style="background:${th.panel};border-color:${th.line};color:${th.text}">
      <div class="sw">${['accent', 'accent2', 'ok', 'warn', 'bad'].map(c => `<i style="background:${th[c]}"></i>`).join('')}</div>
      <div class="big" style="font-family:${th.num.replace(/"/g, "'")};color:${th.text}${th.glow ? `;text-shadow:0 0 10px ${th.accent}` : ''}">88<span style="font-size:13px;color:${th.dim}"> mph</span></div>
      <div class="nm">${esc(th.name)}</div><div class="ds">${esc(th.desc)}</div></button>`;
    sheet(`<h3>Themes</h3><p class="small muted">Applies everywhere, including driving mode. Tap to preview instantly.</p>
      <div class="small muted" style="margin:12px 0 6px">TEXT SIZE</div><div class="seg" id="thSize">${[[1, 'Normal'], [1.12, 'Large'], [1.25, 'X-Large']].map(([v, l]) => `<button data-z="${v}" class="${(S.textScale || 1) == v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="small muted" style="margin:12px 0 6px">MOTION</div><div class="seg" id="thMotion"><button data-m="0" class="${!S.noMotion ? 'on' : ''}">Animations on</button><button data-m="1" class="${S.noMotion ? 'on' : ''}">Reduce motion</button></div>
      <div class="small muted" style="margin:14px 0 0">ACCESSIBILITY</div><div class="thgrid">${['hcdark', 'hclight', 'cvd', 'daylight'].map(k => card(k, THEMES[k])).join('')}</div>
      <div class="small muted" style="margin:14px 0 0">STYLES</div><div class="thgrid">${Object.keys(THEMES).filter(k => !['hcdark', 'hclight', 'cvd', 'daylight'].includes(k)).map(k => card(k, THEMES[k])).join('')}</div>`, el => {
      el.querySelectorAll('.thc').forEach(b => b.onclick = () => { applyTheme(b.dataset.t); el.querySelectorAll('.thc').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelectorAll('#thSize button').forEach(b => b.onclick = () => { S.textScale = +b.dataset.z; save(); applyTheme(S.theme); el.querySelectorAll('#thSize button').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelectorAll('#thMotion button').forEach(b => b.onclick = () => { S.noMotion = b.dataset.m === '1'; save(); applyTheme(S.theme); el.querySelectorAll('#thMotion button').forEach(x => x.classList.toggle('on', x === b)); });
    });
  }
  // entry points: settings row, header brand long-press-free button, driving mode bar
  (function () {
    const set = $('#sUnits').closest('.card');
    set.insertAdjacentHTML('afterbegin', `<div class="row" style="justify-content:space-between;padding:6px 0"><span>Theme</span><button id="thBtn">🎨 ${esc((THEMES[S.theme] || THEMES.torque).name)}</button></div>`);
    $('#thBtn').onclick = themeSheet;
    const dash = $('#editTiles'); dash.insertAdjacentHTML('afterend', '<button class="ghost small" id="thBtn2">🎨 Theme</button>'); $('#thBtn2').onclick = themeSheet;
  })();
  ACTIONS.theme = { n: 'Themes', d: 'Colors, contrast, text size', run: themeSheet };


  // ---------- MY CODES: user-saved commands, per vehicle, run with one tap ----------
  // The app never ships write values for specific cars. You supply a command you've verified
  // (from a community guide or your brand tool), label it, and save it here. Same guards as the terminal.
  function loadCodes() { try { return JSON.parse(localStorage.getItem('td.codes') || '[]'); } catch (e) { return []; } }
  function saveCodes(a) { try { localStorage.setItem('td.codes', JSON.stringify(a)); } catch (e) { } }
  const vehLabel = () => vehName() || 'Any vehicle';
  function parseCmds(text) { return text.split(/[\n;]+/).map(s => s.trim()).filter(Boolean); }

  // Run a saved sequence: ONE combined confirmation, then send each line in order.
  async function runCode(code) {
    if (!elm || !connected) { toast('Connect first'); return; }
    const risky = code.cmds.filter(c => RISKY.find(([re]) => re.test(c.toUpperCase().replace(/\s+/g, ''))));
    const ok = await confirmSheet('Run “' + esc(code.name) + '”?',
      `On <b>${esc(code.veh)}</b>, this sends ${code.cmds.length} command${code.cmds.length === 1 ? '' : 's'}:<br><code style="display:block;background:var(--termbg);padding:8px;border-radius:8px;margin:8px 0;font:12px ui-monospace,monospace;color:var(--text)">${code.cmds.map(esc).join('<br>')}</code>` +
      (risky.length ? '<b style="color:var(--warn)">This includes commands that write to or reset a module.</b> ' : '') +
      'Only run this if you verified it for <b>this exact vehicle</b>. Ignition on, engine off, parked, battery healthy.',
      'Run it', true);
    if (!ok) return;
    log('sys', '▶ Running "' + code.name + '"');
    let paused = false;
    for (const c of code.cmds) {
      const raw = c.toUpperCase().replace(/\s+/g, '');
      if (/^ATSH|^ATCRA|^ATCP|^ATSP|^ATTP|^ATCF|^ATCM/.test(raw)) { setCustomHeader(true); paused = true; }
      try { await elm.send(c.toUpperCase(), 10000); } catch (e) { log('sys', 'Stopped: ' + e.message); toast('Stopped on error: ' + c); break; }
      await new Promise(r => setTimeout(r, 120));
    }
    log('sys', '■ Done "' + code.name + '"');
    toast('Ran "' + code.name + '". Check the log.');
    if (paused) { await restoreNormal(); }
  }

  function editCodeSheet(existing) {
    const c = existing || { name: '', cmds: [], note: '', veh: vehLabel() };
    sheet(`<h3>${existing ? 'Edit code' : 'New custom code'}</h3>
      <p class="small muted" style="line-height:1.5">Save a command you've verified for your vehicle. One command per line; they run top to bottom. Use the Terminal to test it first.</p>
      <div class="small muted" style="margin:12px 0 4px">NAME</div><input id="ccName" style="width:100%" placeholder="e.g. Fold mirrors on lock" value="${esc(c.name)}">
      <div class="small muted" style="margin:12px 0 4px">FOR VEHICLE</div><input id="ccVeh" style="width:100%" value="${esc(c.veh)}">
      <div class="small muted" style="margin:12px 0 4px">COMMAND(S) — one per line</div>
      <textarea id="ccCmds" style="width:100%;height:96px;background:var(--termbg);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:10px;font:13px ui-monospace,monospace" placeholder="ATSH7E0&#10;22F190" spellcheck="false">${esc(c.cmds.join('\n'))}</textarea>
      <div class="small muted" style="margin:12px 0 4px">NOTE (optional)</div><input id="ccNote" style="width:100%" placeholder="what it does, where you got it" value="${esc(c.note || '')}">
      <div class="note" style="margin-top:12px">You're responsible for what you save and run. A wrong value can disable a module. Don't use this to defeat emissions or safety systems, or to program keys.</div>
      <div class="row" style="margin-top:14px">${existing ? '<button class="danger" id="ccDel">Delete</button>' : ''}<button class="grow" id="ccTest">Test in terminal</button><button class="primary grow" id="ccSave">Save</button></div>`, el => {
      const read = () => ({ name: el.querySelector('#ccName').value.trim() || 'Untitled', veh: el.querySelector('#ccVeh').value.trim() || 'Any vehicle', cmds: parseCmds(el.querySelector('#ccCmds').value), note: el.querySelector('#ccNote').value.trim() });
      el.querySelector('#ccSave').onclick = () => {
        const d = read(); if (!d.cmds.length) return toast('Add at least one command');
        const all = loadCodes();
        if (existing) Object.assign(existing, d); else all.push(Object.assign(d, { id: 'c' + Date.now() }));
        saveCodes(existing ? all.map(x => x.id === existing.id ? existing : x) : all);
        closeSheet(); renderCodes();
      };
      el.querySelector('#ccTest').onclick = () => { const d = read(); if (!d.cmds.length) return toast('Nothing to test'); closeSheet(); $('#termIn').value = d.cmds[0]; show('term'); toast('Sending first line to test…'); if (connected) termSend(d.cmds[0]); };
      const del = el.querySelector('#ccDel'); if (del) del.onclick = () => { saveCodes(loadCodes().filter(x => x.id !== existing.id)); closeSheet(); renderCodes(); };
    });
  }
  function renderCodes() {
    const box = $('#codesList'); if (!box) return;
    const all = loadCodes(), here = vehLabel();
    const mine = all.filter(c => c.veh === here), others = all.filter(c => c.veh !== here);
    const row = c => `<div class="ccrow"><div class="grow" data-run="${c.id}"><div style="font-weight:600">${esc(c.name)}</div><div class="small muted">${esc(c.veh)}${c.note ? ' · ' + esc(c.note) : ''} · ${c.cmds.length} cmd</div></div><button class="small" data-edit="${c.id}">Edit</button><button class="primary small" data-run="${c.id}">Run</button></div>`;
    box.innerHTML = (all.length ? (mine.length ? `<div class="small muted" style="margin:4px 0 6px">FOR ${esc(here.toUpperCase())}</div>` + mine.map(row).join('') : '') + (others.length ? `<div class="small muted" style="margin:12px 0 6px">OTHER VEHICLES</div>` + others.map(row).join('') : '')
      : '<div class="empty">No saved codes yet. Save commands you use often, like enabling a feature or reading a module, so they\'re one tap next time.</div>');
  }
  ACTIONS.codes2 = { n: 'My codes', d: 'Saved commands for your car', run: () => { show('term'); setTimeout(() => $('#codesWrap').scrollIntoView({ behavior: 'smooth' }), 100); } };

  // ---------- MAPS launcher (driving mode) ----------
  function mapsSheet() {
    const apps = [['Google Maps', 'https://www.google.com/maps'], ['Waze', 'https://waze.com/ul'], ['Apple Maps', 'https://maps.apple.com/'], ['Live traffic (Google)', 'https://www.google.com/maps/@?api=1&map_action=map&layer=traffic']];
    sheet(`<h3>Open navigation</h3><p class="small muted" style="line-height:1.5">Opens your maps app in a new tab. Set your destination before you drive. On a phone mount, many people run navigation in a separate app and keep this on the other screen.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">${apps.map(([n, u]) => `<a class="btnlink" target="_blank" rel="noopener" href="${u}">${esc(n)} ↗</a>`).join('')}</div>`);
  }


  // ---------- DRIVING MODE · MAP VIEW (MapLibre GL: tilt, rotate, heading-up) ----------
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const OFM = 'https://tiles.openfreemap.org/styles/';
  // OpenFreeMap vector styles (free, no key, no limits) include 3D building data. Esri raster for satellite.
  const MAPSTYLES = {
    dark: { name: 'Dark', styleUrl: OFM + 'dark', vector: true },
    streets: { name: 'Streets', styleUrl: OFM + 'liberty', vector: true },
    light: { name: 'Light', styleUrl: OFM + 'positron', vector: true },
    satellite: { name: 'Satellite', url: ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Tiles © Esri', max: 19 }
  };
  const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const EMPTY_FC = { type: 'FeatureCollection', features: [] };
  let map = null, carMarker = null, destMarkerM = null, driveMode = 'tiles', geoWatch = null, tileOK = false, lastFix = null, picking = false, trafficOn = false;
  if (!S.map) S.map = {};
  S.map = Object.assign({ dials: ['0C', '05', 'VBAT'], primary: '0D', opacity: 0.82, style: 'dark', follow: true, headingUp: false, pitch: 0, tomtom: '', traffic: false, buildings: true, terrain: false, autoZoom: true }, S.map);

  function isPreview() { const h = location.hostname || ''; return h.endsWith('claude.ai') || h.includes('claudeusercontent') || h.includes('anthropic') || location.protocol === 'about:'; }
  function showMapFallback(custom) {
    const el = $('#dMapFallback'); if (!el) return; el.style.display = 'flex';
    el.querySelector('div').innerHTML = custom || (isPreview()
      ? 'The map can’t load in this in-chat preview (it blocks cross-site requests). It works once the app is on your own site. Your dials still work on top.'
      : 'Map didn’t load. Check your connection, or try another style in <b>Dials → Map style</b>.');
  }
  function hideMapFallback() { const el = $('#dMapFallback'); if (el) el.style.display = 'none'; }
  function setDriveMode(m) {
    driveMode = m;
    $('#drive').classList.toggle('mapmode', m === 'map');
    $$('#dModeSeg button').forEach(b => b.classList.toggle('on', b.dataset.dm === m));
    if (m === 'map') startMap(); else { stopGeo(); fitDrive(); }
  }
  function baseSource(st) { return { type: 'raster', tiles: [st.url], tileSize: 256, attribution: st.attr, maxzoom: st.max }; }
  function buildStyle(k) {
    const st = MAPSTYLES[k] || MAPSTYLES.dark;
    if (st.styleUrl) return st.styleUrl;
    return { version: 8, sources: { base: baseSource(st) }, layers: [{ id: 'base', type: 'raster', source: 'base' }] };
  }
  function apply3DBuildings() {
    if (!map.getSource('openmaptiles')) return;                 // only on vector styles
    if (!S.map.buildings) { if (map.getLayer('3d-buildings')) map.removeLayer('3d-buildings'); return; }
    if (map.getLayer('3d-buildings')) return;
    map.addLayer({ id: '3d-buildings', source: 'openmaptiles', 'source-layer': 'building', type: 'fill-extrusion', minzoom: 14,
      paint: { 'fill-extrusion-color': S.map.style === 'light' ? '#c7ccd4' : '#39404c',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.65 } });
  }
  function applyTerrain() {
    try {
      if (S.map.terrain) { if (!map.getSource('dem')) map.addSource('dem', { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain © Mapzen/AWS' }); map.setTerrain({ source: 'dem', exaggeration: 1.2 }); }
      else map.setTerrain(null);
    } catch (e) { }
  }
  function addRouteLayers() {
    if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: EMPTY_FC });
    if (!map.getLayer('route-casing')) map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#000', 'line-width': 10, 'line-opacity': 0.5 } });
    if (!map.getLayer('route-line')) map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': cssVar('--accent'), 'line-width': 6 } });
  }
  function applyTraffic() {
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer('traffic')) { map.removeLayer('traffic'); map.removeSource('traffic'); }
    if (S.map.traffic && hasKey()) {
      map.addSource('traffic', { type: 'raster', tiles: ['https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=' + encodeURIComponent(S.map.tomtom.trim())], tileSize: 256 });
      map.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', paint: { 'raster-opacity': 0.85 } });
    }
  }
  function reAddLayers() { addRouteLayers(); applyTraffic(); apply3DBuildings(); applyTerrain(); }
  function carEl() { const d = document.createElement('div'); d.className = 'carfix'; d.innerHTML = '<div class="cf"></div>'; return d; }
  function pinEl() { const d = document.createElement('div'); d.className = 'destpin'; d.innerHTML = '<div class="dp"></div>'; return d; }

  function startMap() {
    hideMapFallback(); tileOK = false;
    if (!window.maplibregl) { showMapFallback('Map library didn’t load.'); renderOverlay(); return; }
    if (!map) {
      try {
        map = new maplibregl.Map({ container: 'dMap', style: buildStyle(S.map.style), center: [-98.35, 39.5], zoom: 3, pitch: S.map.pitch || 0, bearing: 0, attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true, maxPitch: 70 });
      } catch (e) { showMapFallback('This browser can’t run the map (WebGL is needed). Your dials still work.'); renderOverlay(); return; }
      map.on('load', () => { reAddLayers(); carMarker = new maplibregl.Marker({ element: carEl(), rotationAlignment: 'map' }).setLngLat([-98.35, 39.5]).addTo(map); });
      map.on('styledata', () => { if (map.isStyleLoaded()) reAddLayers(); });
      map.on('data', e => { if (e.dataType === 'source' && e.tile) { tileOK = true; hideMapFallback(); } });   // a real tile loaded
      map.on('error', () => { if (!tileOK && !map.loaded()) showMapFallback(); });
      map.on('dragstart', () => { if (S.map.follow) { S.map.follow = false; save(); $('#dRecenter').classList.add('show'); } });
      map.on('rotate', () => { const c = $('#dCompass .ci'); if (c) c.style.transform = `rotate(${-map.getBearing()}deg)`; });
      map.on('click', e => onMapTap(e.lngLat));
    } else { reAddLayers(); }
    setTimeout(() => { if (map) map.resize(); }, 70);
    setTimeout(() => { if (!tileOK && (!map || !map.loaded())) showMapFallback(); }, 9000);
    startGeo(); renderOverlay();
  }
  function setMapStyle(k) { S.map.style = k; save(); if (map) map.setStyle(buildStyle(k)); }
  function toggleTraffic(on) {
    if (on && !hasKey()) { toast('Add a TomTom key first (Dials → Traffic & routing)'); return; }
    S.map.traffic = on; save(); applyTraffic();
  }
  function setPitch3D(on) { S.map.pitch = on ? 55 : 0; save(); if (map) map.easeTo({ pitch: S.map.pitch, duration: 500 }); $('#d3D') && $('#d3D').classList.toggle('on', on); }
  function setHeadingUp(on) {
    S.map.headingUp = on; save(); $('#dHeadUp') && $('#dHeadUp').classList.toggle('on', on);
    if (on) { S.map.follow = true; save(); $('#dRecenter').classList.remove('show'); if (S.map.pitch < 20) setPitch3D(true); }
    else if (map) map.easeTo({ bearing: 0, duration: 500 });
  }
  function resetNorth() { if (map) map.easeTo({ bearing: 0, pitch: 0, duration: 500 }); S.map.headingUp = false; S.map.pitch = 0; save(); $('#dHeadUp') && $('#dHeadUp').classList.remove('on'); $('#d3D') && $('#d3D').classList.remove('on'); }
  function recenter() { S.map.follow = true; save(); if (lastFix && map) map.easeTo({ center: [lastFix.longitude, lastFix.latitude], zoom: Math.max(map.getZoom(), 16), duration: 500 }); $('#dRecenter').classList.remove('show'); }

  function startGeo() {
    if (geoWatch != null || !('geolocation' in navigator)) { if (!('geolocation' in navigator)) $('#dGpsMiss').style.display = 'block'; return; }
    geoWatch = navigator.geolocation.watchPosition(pos => {
      lastFix = pos.coords; const lng = pos.coords.longitude, lat = pos.coords.latitude, hd = pos.coords.heading;
      if (carMarker) { carMarker.setLngLat([lng, lat]); if (hd != null && !isNaN(hd)) carMarker.setRotation(hd); }
      $('#dGpsMiss').style.display = 'none';
      if (map && S.map.follow) {
        const opts = { center: [lng, lat], pitch: S.map.pitch, duration: 900 };
        if (S.map.headingUp && hd != null && !isNaN(hd)) { opts.bearing = hd; opts.offset = [0, map.getContainer().clientHeight * 0.22]; }
        const spd = data['0D'] && data['0D'].v;              // km/h
        opts.zoom = (S.map.autoZoom && spd != null) ? Math.max(14.5, Math.min(17.5, 17.5 - spd / 18)) : Math.max(map.getZoom(), 16);
        map.easeTo(opts);
      }
    }, err => { $('#dGpsMiss').style.display = 'block'; $('#dGpsMiss').textContent = 'GPS: ' + err.message; }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
  }
  function stopGeo() { if (geoWatch != null) { try { navigator.geolocation.clearWatch(geoWatch); } catch (e) { } geoWatch = null; } }

  function renderOverlay() {
    const ov = $('#dOverlay'); if (!ov) return;
    ov.style.setProperty('--ovop', S.map.opacity);
    const chip = (pid, big) => { const c = conv(pid, data[pid] && data[pid].v); const v = c.v == null ? '—' : (pid === '0D' || pid === '0C' ? Math.round(c.v).toLocaleString() : fmt(c.v, pid)); const lv = data[pid] ? level(pid, data[pid].v) : 0; return `<div class="ovt ${big ? 'big' : ''} ${lv === 2 ? 'bad' : lv === 1 ? 'warn' : ''}"><div class="ovl">${esc(meta(pid).short)}</div><div class="ovv">${v}<span>${esc(c.unit)}</span></div></div>`; };
    $('#ovPrimary').innerHTML = chip(S.map.primary, true);
    $('#ovDials').innerHTML = S.map.dials.map(p => chip(p, false)).join('');
  }
  function updateMapOverlay() { if (driveOn && driveMode === 'map') renderOverlay(); }

  function mapDialsSheet() {
    sheet(`<h3>Map &amp; overlay</h3>
      <div class="small muted" style="margin:10px 0 6px">MAP STYLE</div><div class="seg" id="mapStyle">${Object.keys(MAPSTYLES).map(k => `<button data-s="${k}" class="${S.map.style === k ? 'on' : ''}">${MAPSTYLES[k].name}</button>`).join('')}</div>
      <div class="small muted" style="margin:14px 0 6px">OVERLAY TRANSPARENCY</div><input type="range" id="mapOp" min="0.35" max="1" step="0.01" value="${S.map.opacity}" style="width:100%">
      <div class="row" style="gap:8px;margin:12px 0"><button class="grow" id="mapFollow">${S.map.follow ? '✓ ' : ''}Follow me</button><button class="grow" id="mapTraffic">${S.map.traffic ? '✓ ' : ''}Traffic</button></div>
      <div class="row" style="gap:8px;margin:12px 0"><button class="grow" id="mapBld">${S.map.buildings ? '✓ ' : ''}3D buildings</button><button class="grow" id="mapTerr">${S.map.terrain ? '✓ ' : ''}3D terrain</button><button class="grow" id="mapAZ">${S.map.autoZoom ? '✓ ' : ''}Auto-zoom</button></div>
      <div class="small muted" style="margin:12px 0 6px">BIG DIAL</div><div class="seg" id="mapPrim">${['0D', '0C', '05', 'MPG'].map(p => `<button data-p="${p}" class="${S.map.primary === p ? 'on' : ''}">${esc(meta(p).short)}</button>`).join('')}</div>
      <div class="small muted" style="margin:12px 0 6px">SMALL DIALS (up to 4) — tap to toggle</div>
      <div id="mapDialOpts">${allPidList().filter(p => supportedHas(p)).map(p => `<div class="opt ${S.map.dials.includes(p) ? 'sel' : ''}" data-p="${p}"><span>${esc(meta(p).name)}</span><small>${S.map.dials.includes(p) ? '✓' : ''}</small></div>`).join('')}</div>
      <div class="small muted" style="margin:16px 0 6px">TRAFFIC &amp; ROUTING — TOMTOM KEY (optional)</div>
      <input id="mapKey" style="width:100%" placeholder="paste your TomTom API key" value="${esc(S.map.tomtom || '')}" autocomplete="off" spellcheck="false">
      <div class="small muted" style="line-height:1.5;margin-top:6px">A free TomTom key adds a <b>live traffic</b> layer, <b>traffic-aware directions</b> and address search. Without a key, Directions still works via OSRM (no live traffic). Get one at developer.tomtom.com — no credit card.</div>`, el => {
      el.querySelectorAll('#mapStyle button').forEach(b => b.onclick = () => { setMapStyle(b.dataset.s); el.querySelectorAll('#mapStyle button').forEach(x => x.classList.toggle('on', x === b)); });
      el.querySelector('#mapOp').oninput = e => { S.map.opacity = +e.target.value; save(); renderOverlay(); };
      el.querySelector('#mapFollow').onclick = () => { S.map.follow = !S.map.follow; save(); el.querySelector('#mapFollow').innerHTML = (S.map.follow ? '✓ ' : '') + 'Follow me'; if (S.map.follow) recenter(); };
      el.querySelector('#mapTraffic').onclick = () => { toggleTraffic(!S.map.traffic); el.querySelector('#mapTraffic').innerHTML = (S.map.traffic ? '✓ ' : '') + 'Traffic'; };
      el.querySelector('#mapBld').onclick = () => { S.map.buildings = !S.map.buildings; save(); apply3DBuildings(); el.querySelector('#mapBld').innerHTML = (S.map.buildings ? '✓ ' : '') + '3D buildings'; if (S.map.buildings && S.map.pitch < 20) setPitch3D(true); };
      el.querySelector('#mapTerr').onclick = () => { S.map.terrain = !S.map.terrain; save(); applyTerrain(); el.querySelector('#mapTerr').innerHTML = (S.map.terrain ? '✓ ' : '') + '3D terrain'; if (S.map.terrain && S.map.pitch < 20) setPitch3D(true); };
      el.querySelector('#mapAZ').onclick = () => { S.map.autoZoom = !S.map.autoZoom; save(); el.querySelector('#mapAZ').innerHTML = (S.map.autoZoom ? '✓ ' : '') + 'Auto-zoom'; };
      el.querySelectorAll('#mapPrim button').forEach(b => b.onclick = () => { S.map.primary = b.dataset.p; save(); el.querySelectorAll('#mapPrim button').forEach(x => x.classList.toggle('on', x === b)); renderOverlay(); });
      el.querySelectorAll('#mapDialOpts .opt').forEach(o => o.onclick = () => { const p = o.dataset.p, i = S.map.dials.indexOf(p); if (i >= 0) S.map.dials.splice(i, 1); else { if (S.map.dials.length >= 4) return toast('Up to 4 small dials'); S.map.dials.push(p); } save(); o.classList.toggle('sel'); o.querySelector('small').textContent = S.map.dials.includes(p) ? '✓' : ''; renderOverlay(); });
      el.querySelector('#mapKey').onchange = e => { S.map.tomtom = e.target.value.trim(); save(); toast(hasKey() ? 'TomTom key saved' : 'Key cleared'); };
    });
  }

  // ---------- NAVIGATION & TRAFFIC ----------
  const hasKey = () => !!(S.map.tomtom && S.map.tomtom.trim());
  const capW = s => s.charAt(0).toUpperCase() + s.slice(1);
  function osrmStep(st) {
    const m = st.maneuver || {}, t = m.type || '', mod = (m.modifier || '').replace('uturn', 'U-turn'), nm = st.name ? (' onto ' + st.name) : '';
    if (t === 'depart') return 'Start' + (st.name ? (' on ' + st.name) : '');
    if (t === 'arrive') return 'Arrive at destination';
    if (t === 'turn') return 'Turn ' + mod + nm;
    if (t === 'continue' || t === 'new name') return 'Continue' + nm;
    if (t === 'merge') return 'Merge ' + mod + nm;
    if (t === 'on ramp') return 'Take the ramp' + (mod ? ' ' + mod : '') + nm;
    if (t === 'off ramp') return 'Take the exit' + (mod ? ' ' + mod : '') + nm;
    if (t === 'fork') return 'Keep ' + mod + nm;
    if (t === 'end of road') return 'Turn ' + mod + nm;
    if (t === 'roundabout' || t === 'rotary') return 'Enter the roundabout' + (m.exit ? ', exit ' + m.exit : '') + nm;
    return capW(t || 'Continue') + nm;
  }
  const fmtDist = m => imp() ? (m < 160 ? Math.round(m / 0.3048) + ' ft' : (m / 1609.34).toFixed(m < 16093 ? 1 : 0) + ' mi') : (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');
  const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

  function startDirections() { if (!map) return; if (hasKey()) { searchSheet(); return; } picking = true; toast('Tap your destination on the map'); $('#dDirHint').style.display = 'block'; }
  function onMapTap(ll) { if (picking) { picking = false; $('#dDirHint').style.display = 'none'; setDestination(ll.lat, ll.lng); } }
  function setDestination(lat, lng, label) {
    if (destMarkerM) destMarkerM.remove();
    destMarkerM = new maplibregl.Marker({ element: pinEl() }).setLngLat([lng, lat]).addTo(map);
    if (label) destMarkerM.setPopup(new maplibregl.Popup().setText(label));
    computeRoute(lat, lng);
  }
  async function computeRoute(dlat, dlng) {
    $('#dDirHint').style.display = 'none'; picking = false;
    if (!lastFix) { toast('Waiting for your GPS location…'); return; }
    const a = [lastFix.latitude, lastFix.longitude], b = [dlat, dlng];
    $('#dRoutePanel').style.display = 'block'; $('#dRoutePanel').classList.remove('min'); $('#dRouteSum').innerHTML = '<span class="spin"></span> Finding route…'; $('#dRouteSteps').innerHTML = '';
    try {
      let line, dist, dur, delay = null, steps = [];
      if (hasKey()) {
        const u = `https://api.tomtom.com/routing/1/calculateRoute/${a[0]},${a[1]}:${b[0]},${b[1]}/json?key=${encodeURIComponent(S.map.tomtom.trim())}&traffic=true&instructionsType=text`;
        const j = await (await fetch(u)).json();
        const r = j.routes && j.routes[0]; if (!r) throw new Error((j.error && j.error.description) || 'No route');
        line = r.legs.flatMap(l => l.points).map(p => [p.longitude, p.latitude]);
        dist = r.summary.lengthInMeters; dur = r.summary.travelTimeInSeconds; delay = r.summary.trafficDelayInSeconds;
        steps = ((r.guidance && r.guidance.instructions) || []).map(i => ({ text: i.message || capW((i.maneuver || '').toLowerCase().replace(/_/g, ' ')), dist: i.routeOffsetInMeters }));
      } else {
        const u = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true`;
        const j = await (await fetch(u)).json();
        const r = j.routes && j.routes[0]; if (!r) throw new Error('No route (demo server may be busy)');
        line = r.geometry.coordinates; dist = r.distance; dur = r.duration;
        steps = r.legs.flatMap(l => l.steps).map(s => ({ text: osrmStep(s), dist: s.distance }));
      }
      if (map.getSource('route')) map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: line } });
      S.map.follow = false; save();
      const bnds = line.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
      map.fitBounds(bnds, { padding: 60, pitch: 0, bearing: 0, duration: 700 });
      $('#dRouteSum').innerHTML = `<button id="dRouteMin" class="chevbtn">▾</button><b>${fmtDur(dur)}</b> · ${fmtDist(dist)}${delay > 60 ? ` · <span class="no">+${Math.round(delay / 60)} min traffic</span>` : hasKey() ? ' · traffic clear' : ''}<button id="dRouteClr">Clear</button>`;
      $('#dRouteClr').onclick = clearRoute; $('#dRouteMin').onclick = () => $('#dRoutePanel').classList.toggle('min');
      $('#dRouteSteps').innerHTML = steps.filter(s => s.text).map(s => `<div class="rstep"><span>${esc(s.text)}</span><small>${s.dist ? fmtDist(s.dist) : ''}</small></div>`).join('');
      if (!hasKey()) $('#dRouteSteps').insertAdjacentHTML('beforeend', '<div class="rstep" style="opacity:.6"><small style="white-space:normal">ETA has no live traffic.</small></div>');
    } catch (e) {
      $('#dRouteSum').innerHTML = 'Couldn’t get a route: ' + esc(e.message) + ' <button id="dRouteClr">Close</button>';
      $('#dRouteClr').onclick = clearRoute;
    }
  }
  function clearRoute() { if (map && map.getSource('route')) map.getSource('route').setData(EMPTY_FC); if (destMarkerM) { destMarkerM.remove(); destMarkerM = null; } $('#dRoutePanel').style.display = 'none'; }

  function searchSheet() {
    sheet(`<h3>Where to?</h3><p class="small muted">Search an address or place (TomTom), or tap the map.</p>
      <input id="navQ" style="width:100%;margin-top:8px" placeholder="123 Main St, or a place name" autocomplete="off">
      <div id="navResults" style="margin-top:10px"></div>
      <button id="navTap" style="width:100%;margin-top:10px">Pick on the map instead</button>`, el => {
      const q = el.querySelector('#navQ'); q.focus();
      let timer; q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => doSearch(q.value.trim(), el), 350); };
      el.querySelector('#navTap').onclick = () => { closeSheet(); picking = true; toast('Tap your destination'); $('#dDirHint').style.display = 'block'; };
    });
  }
  async function doSearch(query, el) {
    if (query.length < 3) { el.querySelector('#navResults').innerHTML = ''; return; }
    el.querySelector('#navResults').innerHTML = '<div class="small muted"><span class="spin"></span> Searching…</div>';
    try {
      const near = lastFix ? `&lat=${lastFix.latitude}&lon=${lastFix.longitude}` : '';
      const u = `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${encodeURIComponent(S.map.tomtom.trim())}&limit=6${near}`;
      const j = await (await fetch(u)).json();
      const rs = j.results || [];
      el.querySelector('#navResults').innerHTML = rs.length ? rs.map(r => `<div class="opt" data-lat="${r.position.lat}" data-lon="${r.position.lon}"><span>${esc((r.poi && r.poi.name ? r.poi.name + ' — ' : '') + (r.address && r.address.freeformAddress || ''))}</span></div>`).join('') : '<div class="small muted">No matches.</div>';
      el.querySelectorAll('#navResults .opt').forEach(o => o.onclick = () => { closeSheet(); setDestination(+o.dataset.lat, +o.dataset.lon, o.textContent); });
    } catch (e) { el.querySelector('#navResults').innerHTML = '<div class="small no">Search failed: ' + esc(e.message) + '</div>'; }
  }

  // ---------- HELP & CREDITS ----------
  function helpSheet() {
    sheet(`<h3>Help &amp; quick start</h3>
      <div class="hsec"><b>1 · Connect</b><p>Plug the adapter in and turn the ignition on, then tap <b>Connect</b>. Bluetooth LE adapters connect directly; cheap Classic adapters pair in your phone's Bluetooth settings first (PIN 1234 or 0000). No adapter? Tap <b>Try demo car</b> to explore everything, or see which adapters work under <b>Mods → Scanners</b>.</p></div>
      <div class="hsec"><b>Staying connected</b><p>Torque Deck remembers your adapter. Classic Bluetooth and USB adapters reconnect on their own when you come back to the app. Bluetooth LE adapters reconnect with one tap on <b>Reconnect</b>; the list shows only your adapter. Turn this off under Car → Settings → Auto-reconnect.</p></div>
      <div class="hsec"><b>2 · Dashboard</b><p>Live gauge, speed and tiles. Tap any tile to change the sensor. Tiles turn amber/red and buzz on problems like overheating or bad battery voltage.</p></div>
      <div class="hsec"><b>3 · Codes</b><p>Read stored, pending and permanent trouble codes with descriptions and freeze-frame data. "Look at them together" searches multiple codes as a set, since several at once often share one cause. Clear turns off the light (with a warning first).</p></div>
      <div class="hsec"><b>4 · Graph &amp; logging</b><p>Plot up to 3 sensors; record a drive and export a CSV.</p></div>
      <div class="hsec"><b>5 · Driving mode</b><p>Full-screen board for a phone mount — add/move/resize tiles, pick a theme, night mode. Switch to <b>Map</b> for a tilt/rotate map with your dials floating on top. <b>H↑</b> is the follow-the-car view. <b>Directions</b> draws a route; add a free TomTom key for live traffic.</p></div>
      <div class="hsec"><b>6 · Mods &amp; My codes</b><p>Mods lists popular vehicles and accessories with in-app checks. The Terminal (at your own discretion) sends raw commands; save ones you've verified under <b>My codes</b>.</p></div>
      <div class="hrow"><button class="grow primary" id="helpCredits">Open-source credits &amp; licenses →</button></div>
      <div class="note" style="margin-top:12px">Provided as-is, with no warranty. You are responsible for anything you send to your vehicle. Don't use it to disable emissions or safety systems, and never operate the terminal while driving.</div>`, el => {
      el.querySelector('#helpCredits').onclick = () => { closeSheet(); setTimeout(creditsSheet, 50); };
    });
  }
  function creditsSheet() {
    const C = [
      ['MapLibre GL JS', 'The 3D map engine (tilt, rotate, vector rendering). Free & open-source, BSD-3.', 'https://maplibre.org', null],
      ['OpenFreeMap', 'The free Dark / Streets / Light vector maps and 3D buildings — no API key, no limits. Run by one person on donations; please consider donating to keep it alive.', 'https://openfreemap.org', 'Donate to OpenFreeMap'],
      ['OpenStreetMap', 'The underlying map and road data. © OpenStreetMap contributors (ODbL).', 'https://www.openstreetmap.org/copyright', null],
      ['OpenMapTiles', 'The vector-tile schema behind the OpenFreeMap styles.', 'https://openmaptiles.org', null],
      ['Esri', 'Satellite imagery tiles (the Satellite map style). © Esri.', 'https://www.esri.com', null],
      ['AWS Open Data · Mapzen Terrarium', 'Free global elevation tiles that power 3D terrain.', 'https://registry.opendata.aws/terrain-tiles/', null],
      ['OSRM', 'Free routing for in-app Directions (no key). Community demo server — please use it lightly.', 'https://project-osrm.org', null],
      ['TomTom (optional)', 'If you add your own key: live traffic, traffic-aware routing and address search.', 'https://developer.tomtom.com', null],
      ['NHTSA vPIC', 'Free US VIN decoding (make, model, year, engine).', 'https://vpic.nhtsa.dot.gov', null],
      ['Torque Deck', 'Free and open-source (MIT). Report a bug, suggest a feature or host your own copy.', 'https://github.com/weellio/torquedeck', null]
    ];
    sheet(`<h3>Open-source credits</h3><p class="small muted" style="line-height:1.5">This app stands on free, open tools and data. Thank you to everyone who builds and hosts them.</p>
      ${C.map(([n, d, u, donate]) => `<div class="hsec"><b>${esc(n)}</b><p>${esc(d)}</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">${u ? `<a href="${u}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, ''))} ↗</a>` : ''}${donate ? `<a class="hdonate" href="${u}" target="_blank" rel="noopener">♥ ${esc(donate)} ↗</a>` : ''}</div></div>`).join('')}
      <div class="note" style="margin-top:12px"><b>Map tiles and routing come from these services, not from Torque Deck.</b> Please respect their usage policies. OpenFreeMap in particular is donation-supported — <a href="https://openfreemap.org" target="_blank" rel="noopener">openfreemap.org</a> — a small donation helps keep the free maps running.</div>`);
  }

  // ---------- boot ----------
  function compatNote() {
    const ble = OBD.BleTransport.supported(), ser = OBD.SerialTransport.supported(), ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    $('#compatNote').innerHTML = ble || ser
      ? `<b>Ready.</b> ${ble ? 'Bluetooth LE ✓' : 'Bluetooth LE ✗'} · ${ser ? 'Classic Bluetooth/USB ✓' : 'Classic Bluetooth ✗ (needs Chrome 138+)'}<br>Close the adapter’s original app first. An adapter only talks to one app at a time.`
      : ios ? '<b>On iPhone?</b> Safari can’t use Bluetooth. Open this page in the free <b>Bluefy</b> browser (BLE adapters only). The demo works anywhere.'
        : '<b>Heads up:</b> this browser has no Bluetooth access. Use Chrome on Android. The demo car works anywhere.';
  }
  applyTheme(S.theme || 'torque'); injectExtras(); initSettings(); buildGauge(); renderTiles(); compatNote(); updateChips();
  updateReconnectUI(); renderAdapter();
  if (autoOn() && S.lastConn) reconnect(false);
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__td = { connect, data, report };
})();
