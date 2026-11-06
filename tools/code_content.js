/* Plain-English guidance for the trouble-code pages, matched to a code's description.
   First match wins. drive = how urgent it is. check = what to look at in Torque Deck.
   Keep it general and conservative: these pages explain, a mechanic diagnoses. */
const T = (re, causes, drive, check) => ({ re, causes, drive, check });

const SOON = 'Usually safe to drive for now, but get it checked soon. Left alone it can lower fuel economy, fail an emissions test or lead to a bigger repair.';
const SAFE = 'Usually safe to drive. The car may run normally, but it will not pass an emissions test until this is fixed.';
const STOP = 'Fix this before driving much further. It can damage the engine or other parts.';

const TOPICS = [
  T(/rocker arm|vtec/, ['Low or dirty engine oil (VTEC runs on oil pressure)', 'Clogged VTEC solenoid screen or leaking gasket', 'Failed VTEC solenoid or oil pressure switch', 'Wiring or connector problem at the solenoid'],
    SOON, 'Check the oil level first. Then watch RPM and load on the Graph tab while accelerating.'),
  T(/random\/multiple cylinder misfire/, ['Worn spark plugs or a failing ignition coil', 'Vacuum leak (cracked hose, intake gasket)', 'Low fuel pressure or dirty injectors', 'Low compression or a valve problem', 'Bad gas'],
    'If the check engine light is flashing, slow down and stop driving soon. A bad misfire sends unburned fuel into the catalytic converter and can destroy it.', 'Read the freeze frame to see RPM and load when it set. Watch fuel trims: high positive trims point to a vacuum leak or fuel delivery.'),
  T(/misfire/, ['Worn spark plug in that cylinder', 'Failing ignition coil (swap it with another cylinder to see if the misfire moves)', 'Clogged or leaking fuel injector', 'Low compression in that cylinder'],
    'If the check engine light is flashing, slow down and stop driving soon. A bad misfire can overheat and ruin the catalytic converter.', 'Clear the code, swap the coil with a neighbouring cylinder, drive, and read codes again. If the cylinder number follows the coil, the coil is bad.'),
  T(/ignition coil/, ['Failed ignition coil', 'Damaged coil connector or wiring', 'Blown fuse or bad coil power supply', 'Engine computer driver fault (rare)'],
    'Usually causes a misfire. If the engine shakes or the light flashes, stop driving soon.', 'Read codes for a matching misfire code (P030x). Check the connector on that coil.'),
  T(/injector/, ['Failed fuel injector', 'Broken injector wiring or connector', 'Blown injector fuse or relay', 'Engine computer driver fault (rare)'],
    SOON, 'Look for a misfire code on the same cylinder. Watch fuel trims on the Graph tab.'),
  T(/heater/, ['Failed heater element inside the oxygen sensor', 'Blown fuse for the O2 sensor heater', 'Damaged wiring or connector (often near the hot exhaust)'],
    SAFE, 'The heater only matters while the engine warms up. Check the fuse first, then the sensor connector.'),
  T(/catalyst/, ['Worn-out catalytic converter', 'Failing downstream (after-cat) oxygen sensor', 'Exhaust leak near the oxygen sensors', 'An old misfire or oil burning that damaged the converter'],
    SAFE, 'Fix any misfire codes first. On the Graph tab, the downstream O2 sensor should stay fairly steady. If it switches as fast as the upstream one, the converter is not storing oxygen.'),
  T(/o2 sensor|ho2s|oxygen sensor/, ['Ageing or contaminated oxygen sensor', 'Exhaust leak in front of the sensor', 'Wiring or connector damage', 'A real fuel mixture problem the sensor is reporting'],
    SOON, 'Graph the O2 sensor voltage and short-term fuel trim. A healthy upstream sensor switches quickly between about 0.1 and 0.9 V.'),
  T(/too lean|stuck lean/, ['Vacuum leak (cracked hose, PCV, intake gasket)', 'Dirty or failing MAF sensor', 'Weak fuel pump or clogged fuel filter', 'Exhaust leak before the upstream O2 sensor'],
    SOON, 'Watch long-term fuel trim. Above about +10% means the computer is adding a lot of fuel. If trim drops at higher RPM, a vacuum leak is likely.'),
  T(/too rich|stuck rich/, ['Leaking fuel injector', 'Stuck-open EVAP purge valve', 'Dirty MAF sensor reading too high', 'High fuel pressure or a bad pressure regulator'],
    SOON, 'Watch fuel trims: large negative trims mean the computer is pulling fuel out.'),
  T(/\bmaf\b|mass air ?flow/, ['Dirty MAF sensor (often fixed with MAF cleaner)', 'Air leak between the MAF and the throttle body', 'Damaged wiring or connector', 'Failed MAF sensor'],
    SOON, 'Graph MAF at idle and while revving. Readings that jump around or stay flat while RPM rises point to the sensor.'),
  T(/\bmap\b|manifold absolute/, ['Cracked or disconnected MAP sensor vacuum hose', 'Failed MAP sensor', 'Wiring or connector problem'],
    SOON, 'Engine off, ignition on, MAP should read close to the outside air pressure (about 100 kPa at sea level).'),
  T(/\biat\b|intake air temp/, ['Failed intake air temperature sensor', 'Unplugged or damaged connector', 'Wiring short or open'],
    SAFE, 'On a cold start, IAT and coolant temperature should read about the same.'),
  T(/transmission over-temp/, ['Low or old transmission fluid', 'Heavy towing or hauling, or long climbs in hot weather', 'Blocked or missing transmission cooler', 'Torque converter slipping'],
    'Pull over and let the transmission cool. Driving it hot burns the fluid and damages the clutches inside.', 'Ease off, avoid towing until it is checked, and check the fluid level and smell (burnt smell = overheated).'),
  T(/thermostat|insufficient coolant/, ['Thermostat stuck open', 'Low coolant level', 'Faulty coolant temperature sensor'],
    SAFE, 'Graph coolant temperature on a cold start. It should climb steadily to about 190–220 °F (88–104 °C) and stay there.'),
  T(/over-temp/, ['Low coolant or a leak', 'Cooling fan not running', 'Stuck thermostat', 'Clogged radiator or failing water pump'],
    'Stop driving if the temperature gauge is high. An overheating engine can warp the head or blow the head gasket.', 'Watch coolant temperature on the dashboard. Check the coolant level only once the engine is cold.'),
  T(/coolant temp/, ['Failed coolant temperature sensor', 'Damaged connector or wiring', 'Low coolant leaving the sensor in air'],
    SOON, 'Compare coolant temperature with intake air temperature on a cold start. They should be close.'),
  T(/knock sensor/, ['Failed knock sensor', 'Damaged wiring (often under the intake manifold)', 'Real engine knock from low-octane fuel or carbon build-up'],
    SOON, 'Watch timing advance on the Graph tab. If it keeps dropping under load, the computer is pulling timing to protect the engine.'),
  T(/crank\/cam position correlation/, ['Stretched timing chain or worn guides', 'Timing belt or chain jumped a tooth', 'Faulty cam or crank position sensor', 'Variable valve timing solenoid stuck'],
    'Get this checked soon. A badly stretched chain can jump time and damage the engine.', 'A rattle from the front of the engine on cold start is a classic timing chain sign. Check the oil level and condition too.'),
  T(/crankshaft position/, ['Failed crankshaft position sensor', 'Damaged reluctor ring', 'Wiring or connector problem'],
    'The engine can stall or refuse to start. Get it fixed before a long trip.', 'If the RPM reading drops to zero or jumps while driving, the crank sensor signal is cutting out.'),
  T(/camshaft position/, ['Failed camshaft position sensor', 'Wiring or connector problem', 'Timing chain stretch', 'Low or dirty oil affecting cam timing'],
    SOON, 'Check the oil level. Look for timing codes (P0016–P0019) set at the same time.'),
  T(/cam|oil control|valve timing/, ['Low or dirty engine oil (variable valve timing runs on oil pressure)', 'Sticking variable valve timing (VVT) solenoid', 'Worn cam phaser', 'Stretched timing chain'],
    SOON, 'Check the oil level and when it was last changed first. This is often fixed by an oil change and a VVT solenoid.'),
  T(/fuel rail\/system pressure too high/, ['Faulty fuel pressure regulator', 'Failing fuel rail pressure sensor', 'Blocked fuel return line'],
    SOON, 'Watch fuel rail pressure (if your car reports it) at idle and under load.'),
  T(/fuel rail\/system pressure too low|fuel pump/, ['Weak fuel pump', 'Clogged fuel filter', 'Faulty fuel pressure regulator', 'Low fuel level on a hot day'],
    'Low fuel pressure can make the engine stall or hesitate. Get it checked before a long drive.', 'Fill the tank first. Watch fuel trims: they climb when the engine is starved of fuel.'),
  T(/fuel (rail )?pressure sensor/, ['Failed fuel rail pressure sensor', 'Wiring or connector problem', 'A real fuel pressure problem'],
    SOON, 'Compare the pressure reading at idle with the value in your service manual.'),
  T(/oil pressure/, ['Low oil level', 'Failed oil pressure sensor or switch', 'Worn oil pump or engine bearings'],
    'Check the oil level right away. Real low oil pressure destroys an engine quickly.', 'Check the dipstick before anything else.'),
  T(/cooling fan/, ['Failed cooling fan motor', 'Bad fan relay or fuse', 'Wiring or connector problem'],
    'Watch the temperature gauge, especially in traffic. Stop if it climbs.', 'Watch coolant temperature at idle. The fan should switch on before about 225 °F (107 °C).'),
  T(/(input|turbine|output) speed sensor/, ['Failed transmission speed sensor', 'Wiring or connector problem', 'Low transmission fluid'],
    'Shifting may be harsh or the transmission may go into limp mode. Get it checked soon.', 'Read codes again after a drive to see if it comes back.'),
  T(/transmission fluid pressure/, ['Low or old transmission fluid', 'Failed pressure sensor or switch', 'Internal transmission wear'],
    'Get it checked soon to avoid transmission damage.', 'Check the fluid level and colour if your car has a dipstick.'),
  T(/throttle body|throttle actuator/, ['Dirty throttle body', 'Failed electronic throttle motor', 'Wiring or connector problem'],
    'The car may go into limp mode with low power. Get it fixed soon.', 'Watch throttle position while pressing the pedal. It should rise smoothly.'),
  T(/\btps\b|throttle.*position|pedal position/, ['Failed throttle or pedal position sensor', 'Dirty throttle body', 'Wiring or connector problem'],
    'The car may go into limp mode with low power. Get it fixed soon.', 'Watch throttle position on the Graph tab while slowly pressing the pedal. Jumps or dropouts point to the sensor.'),
  T(/\begr\b/, ['Carbon-clogged EGR valve or passages', 'Failed EGR valve', 'Cracked EGR vacuum hose'],
    SOON, 'A rough idle together with an EGR code often means the valve is stuck open.'),
  T(/secondary air/, ['Failed secondary air pump', 'Stuck check valve', 'Blown fuse or bad relay'],
    SAFE, 'This system only runs for a minute or so after a cold start.'),
  T(/evap pressure sensor|tank pressure/, ['Failed fuel tank (EVAP) pressure sensor', 'Wiring or connector problem at the sensor', 'Blocked EVAP vent line affecting the reading'],
    SAFE, 'Run the EVAP readiness monitor on the Car tab after a repair. It needs a few drives to complete.'),
  T(/fuel cap|gas cap|very small leak|small leak/, ['Loose, worn or wrong gas cap', 'Cracked EVAP hose', 'Leaking purge or vent valve', 'Leaking filler neck'],
    SAFE, 'Tighten the gas cap until it clicks, or replace it, then drive a few days. The code often clears by itself.'),
  T(/purge/, ['Stuck EVAP purge valve', 'Wiring or connector problem', 'Cracked purge hose'],
    SAFE, 'A purge valve stuck open can make the car hard to start right after refuelling.'),
  T(/vent/, ['Stuck or blocked EVAP vent valve', 'Spider webs or dirt in the vent filter', 'Wiring problem'],
    SAFE, 'If the pump clicks off early when refuelling, the vent side is a likely suspect.'),
  T(/evap/, ['Loose or worn gas cap', 'Leaking EVAP hose or valve', 'Failed fuel tank pressure sensor'],
    SAFE, 'Start with the gas cap. Then read the EVAP readiness monitor on the Car tab.'),
  T(/fuel level/, ['Faulty fuel level sending unit', 'Wiring or connector problem'],
    SAFE, 'Compare the fuel level reading with the dashboard gauge after filling up.'),
  T(/pcv/, ['Stuck PCV valve', 'Cracked PCV hose'],
    SAFE, 'A cracked PCV hose often shows up as a lean code too.'),
  T(/idle/, ['Dirty throttle body or idle air control valve', 'Vacuum leak', 'Failed idle air control valve'],
    SOON, 'Watch RPM at idle with the A/C off and on.'),
  T(/transmission range/, ['Misadjusted or failed transmission range sensor', 'Wiring or connector problem'],
    'The car may not start in Park or may shift oddly. Get it checked.', 'Check whether the car starts in Neutral and in Park.'),
  T(/shift solenoid|torque converter|gear ratio|shift malfunction/, ['Low or old transmission fluid', 'Failed shift or torque converter solenoid', 'Wiring problem', 'Internal transmission wear'],
    'Get it checked soon. Driving a slipping transmission makes the damage worse.', 'Check the fluid. Note when it happens (cold or hot, which gear) to help a shop.'),
  T(/transmission/, ['Low or old transmission fluid', 'A transmission sensor or solenoid fault', 'Transmission overheating from towing or heavy loads'],
    'Get it checked soon. Transmission problems get expensive when ignored.', 'Many transmission faults store more detail in the transmission module. A brand scan tool can read those.'),
  T(/vehicle speed sensor|wheel speed/, ['Failed speed sensor', 'Damaged wiring or connector', 'Dirty or damaged tone ring'],
    'ABS and traction control may stop working. Drive gently until it is fixed.', 'Run the GPS speedometer check in Mods to compare the car’s speed with GPS.'),
  T(/a\/c|refrigerant/, ['Low refrigerant', 'Failed A/C pressure sensor', 'Wiring or connector problem'],
    SAFE, 'The A/C may not blow cold. Safe to drive.'),
  T(/system voltage|battery/, ['Weak or old battery', 'Failing alternator', 'Loose or corroded battery terminals'],
    'A weak charging system can leave you stranded. Test the battery and alternator soon.', 'Run the Battery & charging test in Mods. Running voltage should be about 13.7–14.7 V.'),
  T(/turbo|boost/, ['Boost leak (cracked intercooler hose or loose clamp)', 'Sticking wastegate or boost control solenoid', 'Worn turbocharger'],
    'Power will be low. Avoid hard acceleration until it is checked.', 'Graph boost (MAP) while accelerating to see whether it reaches normal levels.'),
  T(/over-speed/, ['Engine was revved past its limit', 'Faulty crank position signal'],
    'Usually just a record that the engine over-revved. Read codes again after normal driving.', 'Clear the code and see if it returns.'),
  T(/control module|processor|checksum|serial communication/, ['Engine computer software or internal fault', 'Poor ground or low battery voltage', 'Water damage to the computer'],
    'Get it checked. Start by making sure the battery and grounds are good.', 'Run the Battery & charging test first. Low voltage can cause false module codes.')
];

const NETWORK = { causes: ['Low battery voltage', 'Loose connector or damaged wiring on the network', 'The module that stopped talking has failed or lost power', 'Water in a connector'],
  drive: 'Depends on which module dropped out. If warning lights for ABS, airbags or the gauge cluster are on, get it checked soon.',
  check: 'Run the Battery & charging test in Mods first. Network codes often follow a weak battery or a jump start.' };
const FALLBACK = { causes: ['A failed sensor or part in the system named above', 'Damaged wiring or a loose connector', 'Less often, the engine computer itself'],
  drive: SOON, check: 'Read the freeze frame to see the conditions when the code set, then search for your exact vehicle.' };

// SAE code ranges -> the system a code belongs to
function systemOf(code) {
  const L = code[0], n = parseInt(code.slice(1, 3), 10), d = code[1];
  if (L === 'U') return 'Network communication';
  if (L === 'B') return 'Body';
  if (L === 'C') return 'Chassis';
  if (code.slice(1, 2) === '2' && /^P2[0-9]/.test(code)) {
    if (/^P21|^P22/.test(code)) return 'Fuel and air metering';
    if (/^P23/.test(code)) return 'Ignition system';
    if (/^P24|^P25/.test(code)) return 'Emission controls';
    if (/^P26/.test(code)) return 'Engine computer and outputs';
    if (/^P27/.test(code)) return 'Transmission';
    return 'Powertrain';
  }
  if (n <= 2) return 'Fuel and air metering';
  if (n === 3) return 'Ignition system and misfire';
  if (n === 4) return 'Emission controls';
  if (n === 5) return 'Speed, idle and auxiliary inputs';
  if (n === 6) return 'Engine computer and outputs';
  if (n >= 7 && n <= 9) return 'Transmission';
  return d === '1' ? 'Manufacturer-specific' : 'Powertrain';
}
function guidance(code, desc) {
  if (/^U/.test(code)) return NETWORK;
  const d = String(desc).toLowerCase();
  for (const t of TOPICS) if (t.re.test(d)) return t;
  return FALLBACK;
}
module.exports = { guidance, systemOf };
