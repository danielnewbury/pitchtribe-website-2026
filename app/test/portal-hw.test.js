'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detect, choose, status } = require('../lib/portal-hw');

/** A fake /sys with the network devices of a Pi 5, optionally plus USB adapters. */
function fakeSys({ alfa = false, usbLan = false, usbLanCable = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-sys-'));
  const mk = (p, files = {}) => {
    fs.mkdirSync(path.join(root, p), { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(root, p, f), `${v}\n`);
  };
  const link = (target, at) => {
    fs.mkdirSync(path.dirname(path.join(root, at)), { recursive: true });
    fs.symlinkSync(path.join(root, target), path.join(root, at));
  };
  const driver = (name) => { mk(`bus/drivers/${name}`); return `bus/drivers/${name}`; };
  const net = (name, devPath, drv, files) => {
    mk(devPath);
    link(driver(drv), `${devPath}/driver`);
    mk(`class/net/${name}`, { type: 1, operstate: 'up', address: '02:00:00:00:00:01', ...files });
    link(devPath, `class/net/${name}/device`);
  };
  net('eth0', 'devices/platform/axi/1f00100000.ethernet', 'macb', { carrier: 1 });
  net('wlan0', 'devices/platform/axi/1001100000.mmc/mmc_host/mmc1/mmc1:0001/mmc1:0001:1', 'brcmfmac', { carrier: 0 });
  mk('class/net/wlan0/wireless');
  mk('class/net/lo', { type: 772 });
  mk('class/net/br-guest', { type: 1 });
  if (alfa) {
    mk('devices/platform/axi/usb1/1-1', { product: '802.11ac NIC', manufacturer: 'MediaTek Inc.' });
    net('wlan1', 'devices/platform/axi/usb1/1-1/1-1:1.0', 'mt76x2u', { carrier: 0 });
    mk('class/net/wlan1/phy80211');
  }
  if (usbLan) {
    mk('devices/platform/axi/usb2/2-1', { product: 'USB 10/100/1000 LAN', manufacturer: 'Realtek' });
    net('eth1', 'devices/platform/axi/usb2/2-1/2-1:1.0', 'r8152', { carrier: usbLanCable ? 1 : 0 });
  }
  return root;
}

test('detect: a plain Pi 5 has built-in Ethernet and Wi-Fi, and nothing virtual', () => {
  const hw = detect({ sysRoot: fakeSys() });
  assert.deepEqual(hw.map((d) => [d.name, d.kind, d.bus, d.driver]), [
    ['eth0', 'ethernet', 'builtin', 'macb'],
    ['wlan0', 'wifi', 'builtin', 'brcmfmac'],
  ]);
});

test('detect: USB adapters are recognised with their product names', () => {
  const hw = detect({ sysRoot: fakeSys({ alfa: true, usbLan: true, usbLanCable: true }) });
  const byName = Object.fromEntries(hw.map((d) => [d.name, d]));
  assert.equal(byName.wlan1.kind, 'wifi');
  assert.equal(byName.wlan1.bus, 'usb');
  assert.equal(byName.wlan1.driver, 'mt76x2u');
  assert.equal(byName.wlan1.product, 'MediaTek Inc. 802.11ac NIC');
  assert.equal(byName.eth1.kind, 'ethernet');
  assert.equal(byName.eth1.bus, 'usb');
  assert.equal(byName.eth1.product, 'Realtek USB 10/100/1000 LAN');
  assert.equal(byName.eth1.carrier, true);
});

test('detect: a missing /sys is an empty list, not a crash', () => {
  assert.deepEqual(detect({ sysRoot: path.join(os.tmpdir(), 'pt-no-such-sys') }), []);
});

test('choose: automatic uses the USB aerial when plugged in, otherwise the built-in radio', () => {
  const plain = detect({ sysRoot: fakeSys() });
  assert.equal(choose({ radio: 'auto' }, plain).wifi.name, 'wlan0');
  const withAlfa = detect({ sysRoot: fakeSys({ alfa: true }) });
  const c = choose({ radio: 'auto' }, withAlfa);
  assert.equal(c.wifi.name, 'wlan1');
  assert.deepEqual(c.problems, []);
});

test('choose: explicit radios, and a clear problem when the USB aerial is missing', () => {
  const withAlfa = detect({ sysRoot: fakeSys({ alfa: true }) });
  assert.equal(choose({ radio: 'builtin' }, withAlfa).wifi.name, 'wlan0');
  assert.equal(choose({ radio: 'usb' }, withAlfa).wifi.name, 'wlan1');
  assert.equal(choose({ radio: 'off', accessPoints: false }, withAlfa).wifi, null);
  const missing = choose({ radio: 'usb' }, detect({ sysRoot: fakeSys() }));
  assert.equal(missing.wifi, null);
  assert.match(missing.problems[0], /No USB Wi-Fi adapter/);
});

test('choose: access points use a USB network adapter, never the uplink', () => {
  const none = choose({ radio: 'auto', accessPoints: true }, detect({ sysRoot: fakeSys() }));
  assert.equal(none.wired, null, 'eth0 is the internet uplink and must not become the guest port');
  assert.match(none.problems[0], /No USB network adapter/);
  const hw = detect({ sysRoot: fakeSys({ usbLan: true }) });
  assert.equal(choose({ radio: 'off', accessPoints: true }, hw).wired.name, 'eth1');
  assert.equal(choose({ radio: 'auto', accessPoints: false }, hw).wired, null);
});

test('status: lists the devices and what is in use, without MAC addresses', () => {
  const hw = detect({ sysRoot: fakeSys({ alfa: true, usbLan: true }) });
  const s = status({ radio: 'auto', accessPoints: true }, hw, choose({ radio: 'auto', accessPoints: true }, hw), new Date('2026-11-04T12:00:00Z'));
  assert.equal(s.wifi, 'wlan1');
  assert.equal(s.wired, 'eth1');
  assert.equal(s.checkedAt, '2026-11-04T12:00:00.000Z');
  assert.equal(s.devices.length, 4);
  assert.ok(s.devices.every((d) => !('mac' in d)));
});
