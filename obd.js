/* obd.js — OBD-II / ELM327 engine: BLE transport, simulator, parsers, PID + DTC decoding.
   Works in the browser (window.OBD) and in Node (module.exports) for testing. */
(function (root) {
  'use strict';

  // ---------- Known BLE layouts used by ELM327-style adapters ----------
  const BLE_SERVICES = [
    0xfff0, 0xffe0, 0x18f0, 0xffe5, 0xfee7, 0xbeef,
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',          // Vgate iCar Pro BLE / many clones
    '0000fff0-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',          // Microchip ISSC transparent UART
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',          // Nordic UART
    '0000ae30-0000-1000-8000-00805f9b34fb'
  ];

  // ---------- PID definitions (Mode 01) ----------
  // f(A,B,C,D) -> metric value. unit = metric unit. imp = [unit, convert]
  const C2F = v => v * 9 / 5 + 32, KMH2MPH = v => v * 0.621371, KPA2PSI = v => v * 0.145038, KM2MI = v => v * 0.621371;
  const PIDS = {
    '04': { name: 'Engine Load', short: 'Load', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '05': { name: 'Coolant Temp', short: 'Coolant', unit: '°C', min: -40, max: 130, f: a => a - 40, imp: ['°F', C2F, -40, 266] },
    '06': { name: 'Short Fuel Trim B1', short: 'STFT B1', unit: '%', min: -25, max: 25, f: a => (a - 128) * 100 / 128 },
    '07': { name: 'Long Fuel Trim B1', short: 'LTFT B1', unit: '%', min: -25, max: 25, f: a => (a - 128) * 100 / 128 },
    '08': { name: 'Short Fuel Trim B2', short: 'STFT B2', unit: '%', min: -25, max: 25, f: a => (a - 128) * 100 / 128 },
    '09': { name: 'Long Fuel Trim B2', short: 'LTFT B2', unit: '%', min: -25, max: 25, f: a => (a - 128) * 100 / 128 },
    '0A': { name: 'Fuel Pressure', short: 'Fuel Press', unit: 'kPa', min: 0, max: 765, f: a => a * 3, imp: ['psi', KPA2PSI, 0, 111] },
    '0B': { name: 'Intake Manifold Pressure', short: 'MAP', unit: 'kPa', min: 0, max: 255, f: a => a, imp: ['psi', KPA2PSI, 0, 37] },
    '0C': { name: 'Engine RPM', short: 'RPM', unit: 'rpm', min: 0, max: 8000, f: (a, b) => (a * 256 + b) / 4 },
    '0D': { name: 'Vehicle Speed', short: 'Speed', unit: 'km/h', min: 0, max: 240, f: a => a, imp: ['mph', KMH2MPH, 0, 150] },
    '0E': { name: 'Timing Advance', short: 'Timing', unit: '°', min: -64, max: 64, f: a => a / 2 - 64 },
    '0F': { name: 'Intake Air Temp', short: 'IAT', unit: '°C', min: -40, max: 100, f: a => a - 40, imp: ['°F', C2F, -40, 212] },
    '10': { name: 'Mass Air Flow', short: 'MAF', unit: 'g/s', min: 0, max: 300, f: (a, b) => (a * 256 + b) / 100 },
    '11': { name: 'Throttle Position', short: 'Throttle', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '14': { name: 'O2 B1S1 Voltage', short: 'O2 B1S1', unit: 'V', min: 0, max: 1.275, f: a => a / 200 },
    '15': { name: 'O2 B1S2 Voltage', short: 'O2 B1S2', unit: 'V', min: 0, max: 1.275, f: a => a / 200 },
    '18': { name: 'O2 B2S1 Voltage', short: 'O2 B2S1', unit: 'V', min: 0, max: 1.275, f: a => a / 200 },
    '19': { name: 'O2 B2S2 Voltage', short: 'O2 B2S2', unit: 'V', min: 0, max: 1.275, f: a => a / 200 },
    '1F': { name: 'Run Time Since Start', short: 'Run Time', unit: 's', min: 0, max: 7200, f: (a, b) => a * 256 + b },
    '21': { name: 'Distance with MIL On', short: 'MIL Dist', unit: 'km', min: 0, max: 1000, f: (a, b) => a * 256 + b, imp: ['mi', KM2MI, 0, 621] },
    '2C': { name: 'Commanded EGR', short: 'EGR', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '2E': { name: 'Commanded Evap Purge', short: 'Evap Purge', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '2F': { name: 'Fuel Level', short: 'Fuel', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '31': { name: 'Distance Since Codes Cleared', short: 'Since Clear', unit: 'km', min: 0, max: 5000, f: (a, b) => a * 256 + b, imp: ['mi', KM2MI, 0, 3100] },
    '33': { name: 'Barometric Pressure', short: 'Baro', unit: 'kPa', min: 0, max: 255, f: a => a, imp: ['psi', KPA2PSI, 0, 37] },
    '3C': { name: 'Catalyst Temp B1S1', short: 'Cat Temp', unit: '°C', min: 0, max: 1000, f: (a, b) => (a * 256 + b) / 10 - 40, imp: ['°F', C2F, 32, 1832] },
    '42': { name: 'Control Module Voltage', short: 'ECU Volt', unit: 'V', min: 10, max: 16, f: (a, b) => (a * 256 + b) / 1000 },
    '43': { name: 'Absolute Load', short: 'Abs Load', unit: '%', min: 0, max: 100, f: (a, b) => (a * 256 + b) * 100 / 255 },
    '44': { name: 'Commanded AFR (λ)', short: 'Lambda', unit: 'λ', min: 0.5, max: 1.5, f: (a, b) => (a * 256 + b) * 2 / 65536 },
    '45': { name: 'Relative Throttle', short: 'Rel Thr', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '46': { name: 'Ambient Air Temp', short: 'Ambient', unit: '°C', min: -40, max: 60, f: a => a - 40, imp: ['°F', C2F, -40, 140] },
    '47': { name: 'Throttle Position B', short: 'Thr B', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '49': { name: 'Accelerator Pedal D', short: 'Pedal', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '4C': { name: 'Commanded Throttle', short: 'Cmd Thr', unit: '%', min: 0, max: 100, f: a => a * 100 / 255 },
    '5C': { name: 'Engine Oil Temp', short: 'Oil Temp', unit: '°C', min: -40, max: 150, f: a => a - 40, imp: ['°F', C2F, -40, 302] },
    '5E': { name: 'Engine Fuel Rate', short: 'Fuel Rate', unit: 'L/h', min: 0, max: 50, f: (a, b) => (a * 256 + b) / 20, imp: ['gal/h', v => v * 0.264172, 0, 13] }
  };
  // Derived / adapter values
  const EXTRA = {
    'VBAT': { name: 'Battery Voltage (adapter)', short: 'Battery', unit: 'V', min: 10, max: 16 },
    'MPG': { name: 'Instant Fuel Economy', short: 'Economy', unit: 'L/100km', min: 0, max: 30, imp: ['mpg', v => v > 0 ? 235.215 / v : 0, 0, 60] }
  };

  // ---------- Common DTC descriptions (generic SAE) ----------
  const DTC_DB = {
    P0010: 'Intake camshaft actuator circuit (Bank 1)', P0011: 'Intake cam timing over-advanced / performance (Bank 1)',
    P0012: 'Intake cam timing over-retarded (Bank 1)', P0013: 'Exhaust camshaft actuator circuit (Bank 1)',
    P0014: 'Exhaust cam timing over-advanced / performance (Bank 1)', P0016: 'Crank/cam position correlation (Bank 1 Sensor A)',
    P0017: 'Crank/cam position correlation (Bank 1 Sensor B)', P0020: 'Intake camshaft actuator circuit (Bank 2)',
    P0021: 'Intake cam timing over-advanced / performance (Bank 2)', P0022: 'Intake cam timing over-retarded (Bank 2)',
    P0024: 'Exhaust/“B” camshaft timing over-advanced or system performance (Bank 2)', P0025: 'Camshaft “B” timing over-retarded (Bank 2)',
    P0030: 'HO2S heater control circuit (B1S1)', P0036: 'HO2S heater control circuit (B1S2)', P0037: 'HO2S heater circuit low (B1S2)',
    P0068: 'MAP/MAF – throttle position correlation', P0087: 'Fuel rail/system pressure too low', P0088: 'Fuel rail/system pressure too high',
    P0100: 'MAF circuit malfunction', P0101: 'MAF circuit range/performance', P0102: 'MAF circuit low input', P0103: 'MAF circuit high input',
    P0105: 'MAP circuit malfunction', P0106: 'MAP range/performance', P0107: 'MAP circuit low input', P0108: 'MAP circuit high input',
    P0110: 'Intake air temp circuit malfunction', P0112: 'IAT circuit low input', P0113: 'IAT circuit high input',
    P0115: 'Coolant temp circuit malfunction', P0116: 'Coolant temp range/performance', P0117: 'Coolant temp circuit low', P0118: 'Coolant temp circuit high',
    P0120: 'Throttle position sensor A circuit', P0121: 'TPS A range/performance', P0122: 'TPS A circuit low', P0123: 'TPS A circuit high',
    P0125: 'Insufficient coolant temp for closed-loop', P0128: 'Coolant thermostat below regulating temp',
    P0130: 'O2 sensor circuit (B1S1)', P0131: 'O2 sensor low voltage (B1S1)', P0132: 'O2 sensor high voltage (B1S1)', P0133: 'O2 sensor slow response (B1S1)',
    P0134: 'O2 sensor no activity (B1S1)', P0135: 'O2 sensor heater circuit (B1S1)', P0136: 'O2 sensor circuit (B1S2)', P0137: 'O2 sensor low voltage (B1S2)',
    P0138: 'O2 sensor high voltage (B1S2)', P0139: 'O2 sensor slow response (B1S2)', P0141: 'O2 sensor heater circuit (B1S2)',
    P0150: 'O2 sensor circuit (B2S1)', P0151: 'O2 sensor low voltage (B2S1)', P0153: 'O2 sensor slow response (B2S1)', P0155: 'O2 sensor heater circuit (B2S1)',
    P0156: 'O2 sensor circuit (B2S2)', P0161: 'O2 sensor heater circuit (B2S2)',
    P0171: 'System too lean (Bank 1)', P0172: 'System too rich (Bank 1)', P0174: 'System too lean (Bank 2)', P0175: 'System too rich (Bank 2)',
    P0191: 'Fuel rail pressure sensor range/performance', P0201: 'Injector circuit – cylinder 1', P0202: 'Injector circuit – cylinder 2',
    P0203: 'Injector circuit – cylinder 3', P0204: 'Injector circuit – cylinder 4', P0205: 'Injector circuit – cylinder 5', P0206: 'Injector circuit – cylinder 6',
    P0217: 'Engine over-temperature condition', P0218: 'Transmission over-temperature condition', P0219: 'Engine over-speed condition',
    P0220: 'Throttle position sensor B circuit', P0230: 'Fuel pump primary circuit',
    P0299: 'Turbo/supercharger underboost', P0300: 'Random/multiple cylinder misfire detected',
    P0301: 'Cylinder 1 misfire', P0302: 'Cylinder 2 misfire', P0303: 'Cylinder 3 misfire', P0304: 'Cylinder 4 misfire',
    P0305: 'Cylinder 5 misfire', P0306: 'Cylinder 6 misfire', P0307: 'Cylinder 7 misfire', P0308: 'Cylinder 8 misfire',
    P0325: 'Knock sensor 1 circuit (Bank 1)', P0327: 'Knock sensor 1 circuit low (Bank 1)', P0328: 'Knock sensor 1 circuit high (Bank 1)',
    P0335: 'Crankshaft position sensor A circuit', P0336: 'Crankshaft position sensor A range/performance',
    P0340: 'Camshaft position sensor A circuit (Bank 1)', P0341: 'Camshaft position sensor A range/performance (Bank 1)',
    P0345: 'Camshaft position sensor A circuit (Bank 2)', P0351: 'Ignition coil A primary/secondary circuit',
    P0352: 'Ignition coil B primary/secondary circuit', P0353: 'Ignition coil C primary/secondary circuit',
    P0354: 'Ignition coil D primary/secondary circuit', P0355: 'Ignition coil E primary/secondary circuit', P0356: 'Ignition coil F primary/secondary circuit',
    P0400: 'EGR flow malfunction', P0401: 'EGR flow insufficient', P0402: 'EGR flow excessive', P0404: 'EGR circuit range/performance',
    P0410: 'Secondary air injection system', P0411: 'Secondary air injection incorrect flow',
    P0420: 'Catalyst efficiency below threshold (Bank 1)', P0421: 'Warm-up catalyst efficiency below threshold (Bank 1)',
    P0430: 'Catalyst efficiency below threshold (Bank 2)', P0440: 'EVAP system malfunction', P0441: 'EVAP incorrect purge flow',
    P0442: 'EVAP small leak detected', P0443: 'EVAP purge control valve circuit', P0446: 'EVAP vent control circuit',
    P0449: 'EVAP vent valve/solenoid circuit', P0451: 'EVAP pressure sensor range/performance', P0452: 'EVAP pressure sensor low',
    P0453: 'EVAP pressure sensor high', P0455: 'EVAP large leak detected', P0456: 'EVAP very small leak detected',
    P0457: 'EVAP leak detected (fuel cap loose/off)', P0461: 'Fuel level sensor range/performance', P0480: 'Cooling fan 1 control circuit',
    P0491: 'Secondary air injection (Bank 1)', P0496: 'EVAP high purge flow', P0497: 'EVAP low purge flow',
    P0500: 'Vehicle speed sensor malfunction', P0505: 'Idle air control system', P0506: 'Idle RPM lower than expected', P0507: 'Idle RPM higher than expected',
    P0520: 'Oil pressure sensor/switch circuit', P0521: 'Oil pressure sensor range/performance', P0530: 'A/C refrigerant pressure sensor circuit',
    P0560: 'System voltage malfunction', P0562: 'System voltage low', P0563: 'System voltage high',
    P0600: 'Serial communication link', P0601: 'Control module memory checksum error', P0606: 'Control module processor fault',
    P0700: 'Transmission control system (check TCM codes)', P0705: 'Transmission range sensor circuit', P0715: 'Input/turbine speed sensor circuit',
    P0720: 'Output speed sensor circuit', P0730: 'Incorrect gear ratio', P0740: 'Torque converter clutch circuit',
    P0741: 'Torque converter clutch stuck off / performance', P0750: 'Shift solenoid A', P0755: 'Shift solenoid B', P0760: 'Shift solenoid C',
    P0780: 'Shift malfunction', P0841: 'Transmission fluid pressure sensor/switch A range',
    P1259: 'VTEC system malfunction (Honda)', P1456: 'EVAP leak – fuel tank side (Honda)', P1457: 'EVAP leak – canister side (Honda)',
    P2096: 'Post-catalyst fuel trim too lean (Bank 1)', P2097: 'Post-catalyst fuel trim too rich (Bank 1)',
    P2135: 'Throttle/pedal position sensor A/B correlation', P2138: 'Pedal position sensor D/E correlation',
    P2187: 'System too lean at idle (Bank 1)', P2188: 'System too rich at idle (Bank 1)', P2195: 'O2 sensor signal stuck lean (B1S1)',
    P2196: 'O2 sensor signal stuck rich (B1S1)', P2270: 'O2 sensor signal stuck lean (B1S2)', P2271: 'O2 sensor signal stuck rich (B1S2)',
    P2646: 'Rocker arm actuator A (VTEC) performance / stuck off', P2647: 'Rocker arm actuator A (VTEC) stuck on',
    U0001: 'High-speed CAN communication bus', U0073: 'Control module communication bus off', U0100: 'Lost communication with ECM/PCM',
    U0101: 'Lost communication with TCM', U0121: 'Lost communication with ABS module', U0140: 'Lost communication with body control module',
    U0155: 'Lost communication with instrument cluster'
  };

  function dtcDescription(code) {
    if (DTC_DB[code]) return DTC_DB[code];
    const sys = { P: 'Powertrain', C: 'Chassis', B: 'Body', U: 'Network' }[code[0]];
    const mfr = (code[1] === '1' || (code[0] === 'P' && code[1] === '3')) ? 'manufacturer-specific' : 'generic';
    return `${sys} code (${mfr}) — not in built-in list`;
  }

  // ---------- Hex helpers ----------
  const hexBytes = s => { const o = []; for (let i = 0; i + 1 < s.length; i += 2) o.push(parseInt(s.substr(i, 2), 16)); return o; };
  const isHex = s => /^[0-9A-F]+$/.test(s);

  /* Turn a raw ELM327 reply into an array of hex message strings.
     Handles: echo, SEARCHING..., spaces, multiple ECUs (one line each),
     and ISO 15765 multi-frame replies ("014" length line then "0:..." "1:..." lines). */
  function parseFrames(raw) {
    const out = { messages: [], errors: [], text: [] };
    const lines = String(raw).replace(/>/g, '').split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    let cur = null, need = 0;
    const flush = () => { if (cur !== null) { out.messages.push(need ? cur.slice(0, need * 2) : cur); cur = null; need = 0; } };
    for (let line of lines) {
      const up = line.toUpperCase();
      if (/SEARCHING|BUS INIT|^OK$|^AT/.test(up)) continue;
      if (/NO DATA|ERROR|UNABLE|STOPPED|\?|CAN ERROR|BUFFER FULL|NOT CONNECT|BUS BUSY|FB ERROR|DATA ERROR/.test(up)) { out.errors.push(up); continue; }
      const compact = up.replace(/\s+/g, '');
      const m = compact.match(/^([0-9A-F]):([0-9A-F]*)$/);
      if (m) { if (cur === null) cur = ''; cur += m[2]; if (need && cur.length >= need * 2) flush(); continue; }
      if (/^[0-9A-F]{3}$/.test(compact)) { flush(); cur = ''; need = parseInt(compact, 16); continue; }
      if (isHex(compact) && compact.length % 2 === 0) { flush(); out.messages.push(compact); continue; }
      out.text.push(line);
    }
    flush();
    return out;
  }

  /* Decode Mode 01 PID reply → number or null. */
  function decodePid(pid, raw) {
    const def = PIDS[pid]; if (!def) return null;
    const head = '41' + pid;
    for (const msg of parseFrames(raw).messages) {
      const i = msg.indexOf(head);
      if (i === 0 || (i > 0 && i % 2 === 0)) {
        const b = hexBytes(msg.slice(i + 4));
        if (!b.length) continue;
        return def.f(b[0] || 0, b[1] || 0, b[2] || 0, b[3] || 0);
      }
    }
    return null;
  }

  /* Supported PIDs bitmask from 0100/0120/0140... */
  function decodeSupported(base, raw) {
    const set = new Set();
    const head = '41' + base;
    for (const msg of parseFrames(raw).messages) {
      const i = msg.indexOf(head); if (i !== 0) continue;
      const b = hexBytes(msg.slice(4, 12));
      const start = parseInt(base, 16);
      b.forEach((byte, bi) => { for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) set.add((start + bi * 8 + bit + 1).toString(16).toUpperCase().padStart(2, '0')); });
    }
    return set;
  }

  function dtcFromBytes(a, b) {
    const sys = 'PCBU'[a >> 6];
    return sys + ((a >> 4) & 3) + (a & 0x0f).toString(16).toUpperCase() + (b >> 4).toString(16).toUpperCase() + (b & 0x0f).toString(16).toUpperCase();
  }

  /* Decode Mode 03/07/0A reply. isCan → first data byte is the DTC count. */
  function decodeDtcs(mode, raw, isCan) {
    const resp = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase();
    const codes = [];
    for (const msg of parseFrames(raw).messages) {
      if (!msg.startsWith(resp)) continue;
      let data = msg.slice(2);
      if (isCan) data = data.slice(2);
      const b = hexBytes(data);
      for (let i = 0; i + 1 < b.length; i += 2) {
        if (b[i] === 0 && b[i + 1] === 0) continue;
        const c = dtcFromBytes(b[i], b[i + 1]);
        if (!codes.includes(c)) codes.push(c);
      }
    }
    return codes;
  }

  /* Mode 09 text (VIN 02, Cal ID 04, ECU name 0A) */
  function decodeInfo(pid, raw) {
    const head = '49' + pid;
    let bytes = [];
    for (const msg of parseFrames(raw).messages) {
      const i = msg.indexOf(head); if (i !== 0) continue;
      // CAN: 49 02 01 <data...>; legacy: repeated "49 02 0n xx xx xx xx" lines
      bytes = bytes.concat(hexBytes(msg.slice(6)));
    }
    return bytes.filter(c => c >= 0x20 && c < 0x7f).map(c => String.fromCharCode(c)).join('').trim();
  }

  /* Mode 01 PID 01: MIL + readiness monitors */
  function decodeStatus(raw) {
    for (const msg of parseFrames(raw).messages) {
      if (!msg.startsWith('4101')) continue;
      const [A, B, C, D] = hexBytes(msg.slice(4, 12));
      const diesel = !!(B & 0x08);
      const mon = [];
      const add = (name, availBit, incBit, x, y) => { if (x & availBit) mon.push({ name, complete: !(y & incBit) }); };
      add('Misfire', 0x01, 0x10, B, B); add('Fuel System', 0x02, 0x20, B, B); add('Components', 0x04, 0x40, B, B);
      const names = diesel
        ? ['NMHC Catalyst', 'NOx/SCR', '—', 'Boost Pressure', '—', 'Exhaust Gas Sensor', 'PM Filter', 'EGR/VVT']
        : ['Catalyst', 'Heated Catalyst', 'EVAP System', 'Secondary Air', 'A/C Refrigerant', 'O2 Sensor', 'O2 Sensor Heater', 'EGR/VVT'];
      names.forEach((n, i) => { if (n !== '—') add(n, 1 << i, 1 << i, C, D); });
      return { mil: !!(A & 0x80), dtcCount: A & 0x7f, diesel, monitors: mon };
    }
    return null;
  }


  // ---------- VIN decoding (offline): make from WMI, model year from position 10 ----------
  const WMI = { '1HG': 'Honda', '2HG': 'Honda', '5FN': 'Honda', '5J6': 'Honda', '5KB': 'Honda', '19X': 'Honda', 'JHM': 'Honda', 'SHH': 'Honda',
    '19U': 'Acura', 'JH4': 'Acura', '5J8': 'Acura', '1FA': 'Ford', '1FT': 'Ford', '1FM': 'Ford', '1FD': 'Ford', '2FM': 'Ford', '3FA': 'Ford', 'WF0': 'Ford',
    '1G1': 'Chevrolet', '1GC': 'Chevrolet', '2G1': 'Chevrolet', '3GN': 'Chevrolet', '1GN': 'Chevrolet', '1GT': 'GMC', '1GK': 'GMC', '1G6': 'Cadillac', '1GY': 'Cadillac',
    '4T1': 'Toyota', '4T3': 'Toyota', '5TD': 'Toyota', '5TF': 'Toyota', 'JTD': 'Toyota', 'JTE': 'Toyota', 'JTM': 'Toyota', '2T1': 'Toyota', 'JTH': 'Lexus', '2T2': 'Lexus',
    '1N4': 'Nissan', '1N6': 'Nissan', '5N1': 'Nissan', 'JN1': 'Nissan', 'JN8': 'Nissan', '3N1': 'Nissan', '1C4': 'Chrysler/Jeep', '1C6': 'Ram', '1J4': 'Jeep', '2C3': 'Chrysler', '2C4': 'Chrysler', '1C3': 'Chrysler', '3C6': 'Ram',
    '5NP': 'Hyundai', 'KMH': 'Hyundai', 'KM8': 'Hyundai', '5XY': 'Kia', 'KNA': 'Kia', 'KND': 'Kia', '4S3': 'Subaru', '4S4': 'Subaru', 'JF1': 'Subaru', 'JF2': 'Subaru',
    'JM1': 'Mazda', 'JM3': 'Mazda', '3MZ': 'Mazda', 'WBA': 'BMW', 'WBS': 'BMW', '5UX': 'BMW', 'WDD': 'Mercedes-Benz', 'WDB': 'Mercedes-Benz', '4JG': 'Mercedes-Benz', 'W1K': 'Mercedes-Benz',
    'WVW': 'Volkswagen', '3VW': 'Volkswagen', '1VW': 'Volkswagen', 'WVG': 'Volkswagen', 'WAU': 'Audi', 'WA1': 'Audi', 'YV1': 'Volvo', 'YV4': 'Volvo', '5YJ': 'Tesla', '7SA': 'Tesla',
    'JA4': 'Mitsubishi', 'JA3': 'Mitsubishi', 'SAL': 'Land Rover', 'SAJ': 'Jaguar', 'ZFA': 'Fiat', 'ZAR': 'Alfa Romeo', 'WP0': 'Porsche', 'WP1': 'Porsche', 'KL1': 'Chevrolet (Korea)' };
  const COUNTRY = c => /[1-5]/.test(c) ? (c === '2' ? 'Canada' : c === '3' ? 'Mexico' : 'USA') : c === 'J' ? 'Japan' : c === 'K' ? 'South Korea' : c === 'W' ? 'Germany' : c === 'S' ? 'United Kingdom' : c === 'Y' ? 'Sweden/Finland' : c === 'Z' ? 'Italy' : c === 'L' ? 'China' : c === '7' ? 'New Zealand/USA' : '';
  function decodeVin(vin) {
    if (!vin || vin.length !== 17) return null;
    const yc = 'ABCDEFGHJKLMNPRSTVWXY123456789';
    const i = yc.indexOf(vin[9]);
    let year = null;
    if (i >= 0) { year = 1980 + i; if (/[A-Z]/.test(vin[6]) || year + 30 <= new Date().getFullYear() + 1) year += 30; if (year > new Date().getFullYear() + 1) year -= 30; }
    return { make: WMI[vin.slice(0, 3)] || null, year, country: COUNTRY(vin[0]) };
  }

  const PROTOCOLS = { '0': 'Auto', '1': 'SAE J1850 PWM', '2': 'SAE J1850 VPW', '3': 'ISO 9141-2', '4': 'ISO 14230-4 KWP (5-baud)',
    '5': 'ISO 14230-4 KWP (fast)', '6': 'ISO 15765-4 CAN 11-bit 500k', '7': 'ISO 15765-4 CAN 29-bit 500k',
    '8': 'ISO 15765-4 CAN 11-bit 250k', '9': 'ISO 15765-4 CAN 29-bit 250k', 'A': 'SAE J1939 CAN', 'B': 'User CAN 1', 'C': 'User CAN 2' };

  // ---------- Transports ----------
  class BleTransport {
    constructor() { this.dev = null; this.rx = null; this.tx = null; this.onData = null; this.onDisconnect = null; this.name = ''; }
    static supported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }
    async connect() {
      const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      this.dev = dev; this.name = dev.name || 'OBD adapter';
      dev.addEventListener('gattserverdisconnected', () => this.onDisconnect && this.onDisconnect());
      const server = await dev.gatt.connect();
      let services = [];
      try { services = await server.getPrimaryServices(); } catch (e) { throw new Error('Connected, but no known serial service was found. This adapter may not be an OBD BLE device.'); }
      let rx = null, tx = null;
      for (const s of services) {
        let chars = []; try { chars = await s.getCharacteristics(); } catch (e) { continue; }
        const n = chars.find(c => c.properties.notify || c.properties.indicate);
        const w = chars.find(c => c.properties.writeWithoutResponse || c.properties.write);
        if (n && w) { rx = n; tx = w; break; }
        if (!rx && n) rx = n; if (!tx && w) tx = w;
      }
      if (!rx || !tx) throw new Error('No readable/writable serial characteristic found on this adapter.');
      this.rx = rx; this.tx = tx;
      const dec = new TextDecoder();
      rx.addEventListener('characteristicvaluechanged', ev => this.onData && this.onData(dec.decode(ev.target.value)));
      await rx.startNotifications();
    }
    async write(str) {
      const data = new TextEncoder().encode(str);
      for (let i = 0; i < data.length; i += 20) {
        const chunk = data.slice(i, i + 20);
        if (this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
        else if (this.tx.writeValueWithResponse) await this.tx.writeValueWithResponse(chunk);
        else await this.tx.writeValue(chunk);
      }
    }
    async disconnect() { try { if (this.dev && this.dev.gatt.connected) this.dev.gatt.disconnect(); } catch (e) { } }
  }

  /* Classic Bluetooth (SPP/RFCOMM, paired in phone settings) or USB, via Web Serial.
     Android Chrome 138+ supports Bluetooth RFCOMM; desktop Chrome/Edge supports both. */
  const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
  class SerialTransport {
    constructor() { this.port = null; this.reader = null; this.onData = null; this.onDisconnect = null; this.name = 'Serial adapter'; this.closing = false; }
    static supported() { return typeof navigator !== 'undefined' && !!navigator.serial; }
    async connect() {
      let port;
      try { port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] }); }
      catch (e) { if (e.name === 'NotFoundError') throw e; port = await navigator.serial.requestPort(); }
      this.port = port;
      const info = port.getInfo ? port.getInfo() : {};
      this.name = info.bluetoothServiceClassId ? 'Bluetooth Classic adapter' : (info.usbVendorId ? 'USB adapter' : 'Serial adapter');
      await port.open({ baudRate: 38400 });
      this._readLoop();
    }
    async _readLoop() {
      const dec = new TextDecoder();
      try {
        while (this.port && this.port.readable && !this.closing) {
          this.reader = this.port.readable.getReader();
          try { for (;;) { const { value, done } = await this.reader.read(); if (done) break; if (value && this.onData) this.onData(dec.decode(value)); } }
          finally { this.reader.releaseLock(); }
        }
      } catch (e) { }
      if (!this.closing && this.onDisconnect) this.onDisconnect();
    }
    async write(str) { const w = this.port.writable.getWriter(); try { await w.write(new TextEncoder().encode(str)); } finally { w.releaseLock(); } }
    async disconnect() { this.closing = true; try { if (this.reader) await this.reader.cancel(); } catch (e) { } try { await this.port.close(); } catch (e) { } }
  }

  /* Simulated ELM327 + car so the whole app can be explored without hardware. */
  class SimTransport {
    constructor() { this.onData = null; this.onDisconnect = null; this.name = 'Demo Car (simulated)'; this.t = 0; this.dtcs = ['P0024', 'P0456']; this.pending = ['P0300']; this.headers = false; this.start = Date.now(); }
    static supported() { return true; }
    async connect() { await new Promise(r => setTimeout(r, 600)); }
    async disconnect() { }
    state() {
      const t = (Date.now() - this.start) / 1000;
      const cyc = (Math.sin(t / 7) + 1) / 2, jitter = Math.random();
      const speed = Math.max(0, 70 * cyc + 8 * Math.sin(t / 2.3));
      const throttle = 12 + 60 * Math.max(0, Math.sin(t / 3.1)) + jitter * 3;
      const rpm = 750 + speed * 32 + throttle * 18 + jitter * 40;
      return { t, speed, throttle, rpm, load: 18 + throttle * 0.7, maf: rpm * throttle / 2600 + 2.5,
        coolant: Math.min(91, 40 + t * 1.5), iat: 28 + cyc * 6, fuel: 62 - t / 300 };
    }
    respond(cmd) {
      const c = cmd.toUpperCase().replace(/\s+/g, '');
      const h = (n, len = 1) => Math.max(0, Math.min(Math.round(n), len === 1 ? 255 : 65535)).toString(16).toUpperCase().padStart(len * 2, '0');
      if (c === 'ATZ') return '\r\rELM327 v1.5\r\r>';
      if (c === 'ATI') return 'ELM327 v1.5\r\r>';
      if (c === 'ATRV') return (13.9 + Math.random() * 0.3).toFixed(1) + 'V\r\r>';
      if (c === 'ATDPN') return 'A6\r\r>';
      if (c === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)\r\r>';
      if (c.startsWith('AT')) return 'OK\r\r>';
      const s = this.state();
      const map = {
        '0100': '4100BF3FB813', '0120': '4120A007B015', '0140': '4140FED08514',
        '0101': '4101' + h(0x80 | this.dtcs.length) + '076504',
        '0104': '4104' + h(s.load * 2.55), '0105': '4105' + h(s.coolant + 40),
        '0106': '4106' + h(128 + (Math.random() - .5) * 10), '0107': '4107' + h(132),
        '0108': '4108' + h(128 + (Math.random() - .5) * 10), '0109': '4109' + h(124),
        '010B': '410B' + h(30 + s.throttle * 0.7), '010C': '410C' + h(s.rpm * 4, 2), '010D': '410D' + h(s.speed),
        '010E': '410E' + h((14 + s.throttle / 10 + 64) * 2), '010F': '410F' + h(s.iat + 40), '0110': '4110' + h(s.maf * 100, 2),
        '0111': '4111' + h(s.throttle * 2.55), '0114': '4114' + h(90 + 70 * Math.sin(s.t * 3)) + 'FF', '0115': '4115' + h(140) + 'FF',
        '011F': '411F' + h(s.t, 2), '0121': '41210000', '012F': '412F' + h(s.fuel * 2.55), '0131': '41310F3C', '0133': '413362',
        '0142': '4142' + h(14100 + Math.random() * 200, 2), '0146': '4146' + h(22 + 40), '0145': '4145' + h(s.throttle * 2.2),
        '0149': '4149' + h(s.throttle * 2.4), '014C': '414C' + h(s.throttle * 2.5), '015C': '415C' + h(s.coolant + 35), '0144': '41448000',
        '015E': '415E' + h(s.maf * 0.33 * 20, 2)
      };
      if (map[c]) return map[c] + '\r\r>';
      const enc = list => { const d = list.map(code => { const sys = 'PCBU'.indexOf(code[0]); const v = (sys << 14) | parseInt(code.slice(1), 16); return h(v, 2); }).join(''); return d; };
      if (c === '03') return '43' + h(this.dtcs.length) + enc(this.dtcs) + '\r\r>';
      if (c === '07') return '47' + h(this.pending.length) + enc(this.pending) + '\r\r>';
      if (c === '0A') return '4A00\r\r>';
      if (c === '04') { this.dtcs = []; this.pending = []; return '44\r\r>'; }
      if (c === '0902') return '014\r0:4902013148474C\r1:4D35383731384C\r2:4130303030303134\r\r>';
      if (c === '0904') return '013\r0:49040137383232\r1:5A4146492D4130\r2:30303030303030\r\r>';
      if (c === '090A') return '017\r0:490A0145434D00\r1:2D456E67696E65\r2:436F6E74726F6C\r\r>';
      if (c === '0202') return '420200' + enc(this.dtcs.slice(0, 1)) + '\r\r>';
      if (/^02[0-9A-F]{2}00$/.test(c)) { const r = map['01' + c.slice(2, 4)]; return r ? '42' + r.slice(2, 4) + '00' + r.slice(4) + '\r\r>' : 'NO DATA\r\r>'; }
      return 'NO DATA\r\r>';
    }
    async write(str) {
      const reply = this.respond(str.trim());
      setTimeout(() => this.onData && this.onData(reply), 25 + Math.random() * 35);
    }
  }

  // ---------- ELM327 session with serialized command queue ----------
  class Elm327 {
    constructor(transport, log) {
      this.t = transport; this.log = log || (() => { }); this.buf = ''; this.waiter = null; this.queue = Promise.resolve();
      this.delay = 0; this.lastRaw = {}; this.protocol = ''; this.protocolNum = ''; this.isCan = true; this.version = ''; this.supported = new Set();
      transport.onData = d => this._data(d);
    }
    _data(d) {
      this.buf += d;
      if (this.buf.includes('>') && this.waiter) { const r = this.buf; this.buf = ''; const w = this.waiter; this.waiter = null; w.resolve(r); }
    }
    send(cmd, timeout = 4000, quiet = false) {
      const run = () => new Promise((resolve, reject) => {
        this.buf = '';
        const timer = setTimeout(() => { this.waiter = null; const partial = this.buf; this.buf = ''; partial ? resolve(partial) : reject(new Error('Timeout: ' + cmd)); }, timeout);
        this.waiter = { resolve: r => { clearTimeout(timer); if (!quiet) this.log('rx', r.replace(/>/g, '').trim()); resolve(r); } };
        if (!quiet) this.log('tx', cmd);
        this.t.write(cmd + '\r').catch(e => { clearTimeout(timer); this.waiter = null; reject(e); });
      });
      const delayed = () => run().then(r => this.delay ? new Promise(ok => setTimeout(() => ok(r), this.delay)) : r);
      const p = this.queue.then(delayed, delayed);
      this.queue = p.catch(() => { });
      return p;
    }
    async init(protocol = '0') {
      const r = await this.send('ATZ', 6000).catch(() => '');
      this.version = (r.match(/ELM327\s*v?[\d.]+/i) || ['ELM327'])[0];
      for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATST64', 'ATSP' + protocol]) await this.send(c).catch(() => { });
      const s = await this.send('0100', 12000);
      const f = parseFrames(s);
      if (!f.messages.length) throw new Error('Adapter answered, but the car did not. Is the ignition ON? (' + (f.errors[0] || 'no data') + ')');
      this.supported = decodeSupported('00', s);
      for (const base of ['20', '40']) {
        if (!this.supported.has(base)) break;
        const r2 = await this.send('01' + base).catch(() => '');
        decodeSupported(base, r2).forEach(p => this.supported.add(p));
      }
      const dpn = (await this.send('ATDPN').catch(() => '')).replace(/[>\s]/g, '').replace(/^A/, '');
      this.protocolNum = dpn.slice(-1);
      this.protocol = PROTOCOLS[this.protocolNum] || 'Unknown';
      this.isCan = /[6-9ABC]/.test(this.protocolNum);
    }
    async readPid(pid) {
      if (pid === 'VBAT') { const r = await this.send('ATRV', 3000, true); const m = r.match(/(\d+(\.\d+)?)\s*V/i); return m ? parseFloat(m[1]) : null; }
      const raw = await this.send('01' + pid, 3000, true);
      this.lastRaw[pid] = parseFrames(raw).messages.join(' ') || raw.replace(/[>\r\n]+/g, ' ').trim();
      return decodePid(pid, raw);
    }
    async readDtcs() {
      const stored = decodeDtcs('03', await this.send('03', 8000), this.isCan);
      const pending = decodeDtcs('07', await this.send('07', 8000).catch(() => ''), this.isCan);
      const permanent = decodeDtcs('0A', await this.send('0A', 8000).catch(() => ''), this.isCan);
      return { stored, pending, permanent };
    }
    async clearDtcs() { const r = await this.send('04', 10000); return /44/.test(r.replace(/\s/g, '')); }
    async status() { return decodeStatus(await this.send('0101')); }
    async info() {
      const vin = decodeInfo('02', await this.send('0902', 8000).catch(() => ''));
      const cal = decodeInfo('04', await this.send('0904', 8000).catch(() => ''));
      const ecu = decodeInfo('0A', await this.send('090A', 8000).catch(() => ''));
      return { vin, cal, ecu };
    }
    async freezeFrame(pids) {
      const r = await this.send('0202').catch(() => '');
      let dtc = null;
      for (const m of parseFrames(r).messages) if (m.startsWith('4202')) { const b = hexBytes(m.slice(6)); if (b.length >= 2 && (b[0] || b[1])) dtc = dtcFromBytes(b[0], b[1]); }
      const values = {};
      for (const p of pids) {
        const raw = await this.send('02' + p + '00').catch(() => '');
        const fixed = parseFrames(raw).messages.map(m => m.startsWith('42' + p) ? '41' + p + m.slice(6) : m).join('\r');
        const v = decodePid(p, fixed); if (v !== null) values[p] = v;
      }
      return { dtc, values };
    }
  }

  const API = { decodeVin, SerialTransport, PIDS, EXTRA, DTC_DB, PROTOCOLS, BLE_SERVICES, dtcDescription, parseFrames, decodePid, decodeSupported, decodeDtcs, decodeInfo, decodeStatus, dtcFromBytes, BleTransport, SimTransport, Elm327 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.OBD = API;
})(typeof window !== 'undefined' ? window : globalThis);
