'use strict';
/* Guest Wi-Fi hardware: which radios and network ports this Pi has, and which
   ones the guest network should use.

   Read by pitchtribe-portal-apply (as root, via the CLI at the bottom) and by
   its tests. Everything comes from /sys/class/net, so it needs no extra tools.

   The guest network is a bridge (br-guest) with up to two members:
   - a Wi-Fi radio running the access point: the Pi's built-in Wi-Fi, or a USB
     Wi-Fi adapter with external aerials (e.g. an Alfa), which reaches further;
   - a wired port for ceiling/wall access points: a USB Ethernet adapter, with
     the access points plugged into it through a PoE switch.
   The Pi's own Ethernet (eth0) is the internet uplink and is never used. */

const fs = require('node:fs');
const path = require('node:path');

const BRIDGE = 'br-guest';

function read(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
function real(p) {
  try { return fs.realpathSync(p); } catch { return ''; }
}

/** USB product name for a network device, e.g. "802.11ac NIC" or "AX USB 10/100/1000 LAN". */
function usbProduct(devDir) {
  // The net device's "device" is the USB interface (…/1-1:1.0); its parent is the USB device.
  for (const dir of [devDir, path.dirname(devDir)]) {
    const product = read(path.join(dir, 'product'));
    if (product) {
      const maker = read(path.join(dir, 'manufacturer'));
      return maker && !product.toLowerCase().includes(maker.toLowerCase()) ? `${maker} ${product}` : product;
    }
  }
  return '';
}

/**
 * Lists the physical network devices.
 * @returns {{ name, kind: 'wifi'|'ethernet', bus: 'usb'|'builtin', driver, product, mac, up, carrier }[]}
 */
function detect({ sysRoot = '/sys' } = {}) {
  const netDir = path.join(sysRoot, 'class', 'net');
  let names = [];
  try { names = fs.readdirSync(netDir).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    const dir = path.join(netDir, name);
    const devDir = real(path.join(dir, 'device'));
    if (!devDir) continue; // lo, bridges, tunnels, VLANs: not hardware
    const wifi = fs.existsSync(path.join(dir, 'wireless')) || fs.existsSync(path.join(dir, 'phy80211'));
    if (!wifi && read(path.join(dir, 'type')) !== '1') continue; // not Ethernet-like
    const usb = devDir.split(path.sep).some((p) => /^usb\d+$/.test(p));
    out.push({
      name,
      kind: wifi ? 'wifi' : 'ethernet',
      bus: usb ? 'usb' : 'builtin',
      driver: path.basename(real(path.join(devDir, 'driver'))) || '',
      product: usb ? usbProduct(devDir) : '',
      mac: read(path.join(dir, 'address')),
      up: read(path.join(dir, 'operstate')) === 'up',
      carrier: read(path.join(dir, 'carrier')) === '1',
    });
  }
  return out;
}

/**
 * Picks the guest network's members from the settings and the hardware.
 * @param {{ radio?: 'auto'|'builtin'|'usb'|'off', accessPoints?: boolean }} settings
 * @param {ReturnType<typeof detect>} hw
 * @param {{ uplink?: string }} [opts]
 * @returns {{ wifi: object|null, wired: object|null, problems: string[] }}
 */
function choose(settings, hw, { uplink = 'eth0' } = {}) {
  const radio = settings.radio || 'auto';
  const problems = [];
  const builtinWifi = hw.find((d) => d.kind === 'wifi' && d.bus === 'builtin');
  const usbWifi = hw.find((d) => d.kind === 'wifi' && d.bus === 'usb');

  let wifi = null;
  if (radio === 'auto') wifi = usbWifi || builtinWifi || null;
  else if (radio === 'usb') wifi = usbWifi || null;
  else if (radio === 'builtin') wifi = builtinWifi || null;
  if (radio === 'usb' && !usbWifi) problems.push('No USB Wi-Fi adapter found. Plug it into one of the Pi’s blue USB 3 ports.');
  if ((radio === 'builtin' || radio === 'auto') && !wifi) problems.push('This Pi has no Wi-Fi radio that can be used.');

  let wired = null;
  if (settings.accessPoints) {
    // A USB Ethernet adapter, never the uplink. Prefer one with a cable in.
    const ports = hw.filter((d) => d.kind === 'ethernet' && d.name !== uplink && d.bus === 'usb');
    wired = ports.find((d) => d.carrier) || ports[0] || null;
    if (!wired) problems.push('No USB network adapter found for the access points. Plug it into one of the Pi’s blue USB 3 ports.');
  }
  if (!hw.some((d) => d.name === uplink)) problems.push(`The Pi’s network port (${uplink}) is missing, so guests can’t reach the internet.`);
  return { wifi, wired, problems };
}

/** Status file the dashboard shows under Guest Wi-Fi → Hardware. */
function status(settings, hw, choice, now = new Date()) {
  return {
    checkedAt: now.toISOString(),
    devices: hw.map(({ name, kind, bus, driver, product, carrier }) => ({ name, kind, bus, driver, product, carrier })),
    wifi: choice.wifi ? choice.wifi.name : null,
    wired: choice.wired ? choice.wired.name : null,
    problems: choice.problems,
  };
}

module.exports = { BRIDGE, detect, choose, status };

/* CLI for portal-apply.sh:
     node portal-hw.js shell <portal-network.json> [status.json]
   prints WIFI_IF=… and WIRED_IF=… for eval, and writes the status file. */
if (require.main === module) {
  const [cmd, confFile, statusFile] = process.argv.slice(2);
  if (cmd !== 'shell' || !confFile) {
    console.error('usage: portal-hw.js shell <portal-network.json> [status.json]');
    process.exit(2);
  }
  const settings = JSON.parse(fs.readFileSync(confFile, 'utf8'));
  const hw = detect({ sysRoot: process.env.SYS_ROOT || '/sys' });
  const choice = choose(settings, hw, { uplink: process.env.PORTAL_UPLINK || 'eth0' });
  if (statusFile) {
    fs.writeFileSync(`${statusFile}.tmp`, `${JSON.stringify(status(settings, hw, choice), null, 2)}\n`);
    fs.renameSync(`${statusFile}.tmp`, statusFile);
  }
  const safe = (s) => (/^[A-Za-z0-9_.:-]*$/.test(s) ? s : '');
  console.log(`WIFI_IF=${safe(choice.wifi ? choice.wifi.name : '')}`);
  console.log(`WIRED_IF=${safe(choice.wired ? choice.wired.name : '')}`);
  for (const p of choice.problems) console.error(`warning: ${p}`);
}
