/* shop.js — adapter picks and Amazon parts links (window.SHOP).
   Links carry the Torque Deck Amazon Associates tag. No prices or product images are shown:
   Amazon's rules only allow those through its own API. */
(function (root) {
  'use strict';
  const TAG = 'bworld03-20';
  const DISCLOSURE = 'As an Amazon Associate, Torque Deck earns from qualifying purchases.';

  const search = q => 'https://www.amazon.com/s?k=' + encodeURIComponent(String(q).replace(/\s+/g, ' ').trim()) + '&tag=' + TAG;

  // works: true = tested type that Torque Deck can talk to. conn = how it connects.
  const SCANNERS = [
    { name: 'OBDLink CX', conn: 'Bluetooth LE', works: true, best: true,
      what: 'Small, fast Bluetooth LE adapter. Works on Android, computers and iPhone (in the Bluefy browser). Made for BMW/Mini coding, reads any 1996+ car.',
      url: 'https://link.amazon/B0fXKJNpk' },
    { name: 'OBDLink MX+', conn: 'Classic Bluetooth', works: true,
      what: 'Professional-grade adapter with extra Ford, GM, Toyota and Honda data. Works on Android (Chrome 138+) and Windows. Not on iPhone with Torque Deck.',
      url: 'https://link.amazon/B01ujNK8e' },
    { name: 'Veepeak OBDCheck BLE+', conn: 'Bluetooth LE', works: true, budget: true,
      what: 'Budget Bluetooth LE adapter. Works on Android, computers and iPhone (Bluefy).',
      url: search('Veepeak OBDCheck BLE+') },
    { name: 'Vgate iCar Pro BLE 4.0', conn: 'Bluetooth LE', works: true, budget: true,
      what: 'Budget Bluetooth LE adapter with a power switch, so it can stay plugged in.',
      url: search('Vgate iCar Pro Bluetooth 4.0 BLE OBD2') },
    { name: 'BlueDriver Pro', conn: 'Own app', works: false,
      what: 'All-in-one scanner with repair reports and ABS/airbag codes. Works only with the BlueDriver app, not Torque Deck.',
      url: 'https://link.amazon/B0dgT4BYA' },
    { name: 'FIXD', conn: 'Own app', works: false,
      what: 'Simple code reader with plain-English results and maintenance reminders. Made for the FIXD app, not Torque Deck.',
      url: 'https://link.amazon/B095sbUdr' },
    { name: 'V011 Bluetooth 5.4 scanner', conn: 'Own app', works: false,
      what: 'Low-cost scanner that comes with its own app. Not tested with Torque Deck.',
      url: 'https://link.amazon/B01eCgBjZ' }
  ];

  // Trouble code description -> the part people usually shop for. First match wins.
  const PART_RULES = [
    [/rocker arm|vtec/, 'VTEC solenoid'],
    [/misfire/, 'ignition coil spark plugs'],
    [/ignition coil/, 'ignition coil'],
    [/injector/, 'fuel injector'],
    [/(o2|ho2s|oxygen) sensor.*\(b\ds1\)|heater.*\(b\ds1\)/, 'upstream oxygen sensor'],
    [/(o2|ho2s|oxygen) sensor.*\(b\ds2\)|heater.*\(b\ds2\)/, 'downstream oxygen sensor'],
    [/\bo2\b|ho2s|oxygen/, 'oxygen sensor'],
    [/catalyst/, 'catalytic converter'],
    [/\bmaf\b|mass air ?flow/, 'mass air flow sensor'],
    [/\bmap\b|manifold absolute/, 'MAP sensor'],
    [/\biat\b|intake air temp/, 'intake air temperature sensor'],
    [/thermostat/, 'thermostat'],
    [/coolant temp/, 'coolant temperature sensor'],
    [/knock sensor/, 'knock sensor'],
    [/crankshaft position/, 'crankshaft position sensor'],
    [/camshaft position/, 'camshaft position sensor'],
    [/crank\/cam position correlation/, 'timing chain kit'],
    [/cam(shaft)?\W+(\W?b\W+)?(timing|actuator)|intake cam|exhaust cam|oil control/, 'variable valve timing solenoid'],
    [/fuel rail\/system pressure too high/, 'fuel pressure regulator'],
    [/fuel rail\/system pressure too low/, 'fuel pump'],
    [/oil pressure sensor/, 'oil pressure sensor'],
    [/cooling fan/, 'radiator cooling fan'],
    [/(input|turbine|output) speed sensor/, 'transmission speed sensor'],
    [/transmission fluid pressure sensor/, 'transmission fluid pressure sensor'],
    [/throttle body|throttle actuator/, 'throttle body'],
    [/\btps\b|throttle.*position|pedal position/, 'throttle position sensor'],
    [/\begr\b/, 'EGR valve'],
    [/secondary air/, 'secondary air injection pump'],
    [/fuel cap|gas cap/, 'gas cap'],
    [/purge/, 'EVAP purge valve'],
    [/vent/, 'EVAP vent valve'],
    [/evap.*pressure sensor/, 'fuel tank pressure sensor'],
    [/evap.*leak/, 'gas cap'],
    [/fuel rail pressure sensor|fuel pressure sensor/, 'fuel rail pressure sensor'],
    [/fuel (rail|system) pressure|fuel pump/, 'fuel pump'],
    [/fuel level/, 'fuel level sending unit'],
    [/pcv/, 'PCV valve'],
    [/idle (air|rpm|control)/, 'idle air control valve'],
    [/transmission range/, 'transmission range sensor'],
    [/shift solenoid/, 'transmission shift solenoid'],
    [/torque converter/, 'torque converter clutch solenoid'],
    [/transmission.*(temp|over-temp)/, 'transmission fluid'],
    [/vehicle speed sensor/, 'vehicle speed sensor'],
    [/wheel speed/, 'ABS wheel speed sensor'],
    [/a\/c refrigerant|refrigerant pressure/, 'AC pressure switch'],
    [/system voltage|battery/, 'car battery']
  ];
  function partFor(code, desc) {
    if (!code || /^U/i.test(code)) return null;            // network codes: no single part to buy
    const d = String(desc || '').toLowerCase();
    for (const [re, part] of PART_RULES) if (re.test(d)) return part;
    return null;
  }
  const partUrl = (part, vehicle) => search((vehicle ? vehicle + ' ' : '') + part);

  const ACCESSORY = { tires: 'leveling kit', led: 'LED headlight bulbs', battery: 'car battery', aux: 'LED light bar',
    intake: 'cold air intake', exhaust: 'cat-back exhaust', tuner: 'performance tuner programmer', tow: 'trailer brake controller',
    remote: 'remote start', dashcam: 'hardwire dash cam', stereo: 'Apple CarPlay stereo', aero: 'roof rack', cluster: 'digital gauge cluster', hud: 'head up display' };
  const accessoryUrl = (id, vehicle) => ACCESSORY[id] ? search((vehicle ? vehicle + ' ' : '') + ACCESSORY[id]) : null;

  const api = { TAG, DISCLOSURE, SCANNERS, partFor, partUrl, accessoryUrl, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SHOP = api;
})(typeof window !== 'undefined' ? window : globalThis);
