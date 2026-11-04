'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const helper = require('../bin/remote-access');

const HASH = execFileSync('openssl', ['passwd', '-6', '-stdin'], { input: 'long-enough-password', encoding: 'utf8' }).trim();

function fakePi({ users = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-ra-'));
  const passwd = path.join(dir, 'passwd');
  const lines = [
    'root:x:0:0:root:/root:/bin/bash',
    'sshd:x:100:65534::/run/sshd:/usr/sbin/nologin',
    'pitchtribe:x:999:999::/var/lib/pitchtribe:/usr/sbin/nologin',
    ...users.map((u, i) => `${u}:x:${1000 + i}:${1000 + i}::/home/${u}:/bin/bash`),
  ];
  fs.writeFileSync(passwd, `${lines.join('\n')}\n`);
  const calls = [];
  let ssh = 'disabled';
  const exec = (cmd, args, input) => {
    calls.push({ cmd: [cmd, ...args].join(' '), input });
    if (cmd === 'useradd') fs.appendFileSync(passwd, `${args.at(-1)}:x:1500:1500::/home/${args.at(-1)}:/bin/bash\n`);
    if (cmd === 'systemctl' && args[0] === 'enable') ssh = 'enabled';
    if (cmd === 'systemctl' && args[0] === 'disable') ssh = 'disabled';
    if (cmd === 'systemctl' && args[0] === 'is-enabled') return `${ssh}\n`;
    if (cmd === 'systemctl' && args[0] === 'is-active') return ssh === 'enabled' ? 'active\n' : 'inactive\n';
    return '';
  };
  const o = { dataDir: dir, passwdFile: passwd, now: () => new Date('2026-11-04T14:00:00Z'), exec };
  const ask = (req) => {
    fs.writeFileSync(path.join(dir, 'remote-access-request.json'), JSON.stringify(req));
    return helper.main('request', o);
  };
  return { o, calls, ask, dir };
}

test('remote access: status lists people, not system accounts', () => {
  const pi = fakePi({ users: ['dan'] });
  const s = helper.main('status', pi.o);
  assert.deepEqual(s.users, ['dan']);
  assert.equal(s.sshActive, false);
});

test('remote access: switching on creates the login, sets the password from a hash, starts SSH', () => {
  const pi = fakePi();
  const s = pi.ask({ id: 'r1', action: 'enable', username: 'clubadmin', passwordHash: HASH });
  assert.equal(s.last.ok, true, s.last.message);
  assert.equal(s.sshActive, true);
  assert.deepEqual(s.users, ['clubadmin']);
  assert.ok(pi.calls.some((c) => c.cmd === 'useradd --create-home --shell /bin/bash --groups sudo,adm,video,plugdev clubadmin'));
  const pw = pi.calls.find((c) => c.cmd === 'chpasswd -e');
  assert.equal(pw.input, `clubadmin:${HASH}\n`, 'only ever a hash, through stdin');
  assert.ok(pi.calls.some((c) => c.cmd === 'ssh-keygen -A'));
  assert.ok(!fs.existsSync(path.join(pi.dir, 'remote-access-request.json')), 'the request with the hash is removed');

  const off = pi.ask({ id: 'r2', action: 'disable' });
  assert.equal(off.sshActive, false);
  assert.deepEqual(off.users, ['clubadmin'], 'the login stays for next time');
});

test('remote access: an Imager login just gets a new password', () => {
  const pi = fakePi({ users: ['dan'] });
  const s = pi.ask({ id: 'r1', action: 'enable', username: 'dan', passwordHash: HASH });
  assert.equal(s.last.ok, true);
  assert.ok(!pi.calls.some((c) => c.cmd.startsWith('useradd')));
  assert.ok(pi.calls.some((c) => c.cmd === 'chpasswd -e'));
});

test('remote access: refuses system accounts, odd names and anything but a SHA-512 hash', () => {
  for (const [username, passwordHash, why] of [
    ['root', HASH, /different username/],
    ['pitchtribe', HASH, /different username/],
    ['sshd', HASH, /different username/],
    ['Bad Name', HASH, /different username/],
    ['clubadmin', 'plain-text-password', /could not be set/],
  ]) {
    const pi = fakePi();
    const s = pi.ask({ id: 'x', action: 'enable', username, passwordHash });
    assert.equal(s.last.ok, false, username);
    assert.match(s.last.message, why);
    assert.ok(!pi.calls.some((c) => c.cmd.startsWith('chpasswd') || c.cmd.startsWith('useradd')), `${username}: nothing changed`);
  }
  // A system account not in the reserved list is refused too.
  const pi = fakePi();
  fs.appendFileSync(pi.o.passwdFile, 'colord:x:120:120::/var/lib/colord:/usr/sbin/nologin\n');
  assert.match(pi.ask({ id: 'y', action: 'enable', username: 'colord', passwordHash: HASH }).last.message, /system account/);
});

test('remote access: the same request is only done once', () => {
  const pi = fakePi();
  pi.ask({ id: 'r1', action: 'enable', username: 'clubadmin', passwordHash: HASH });
  const n = pi.calls.length;
  fs.writeFileSync(path.join(pi.dir, 'remote-access-request.json'), JSON.stringify({ id: 'r1', action: 'disable' }));
  helper.main('request', pi.o);
  assert.ok(!pi.calls.slice(n).some((c) => c.cmd.includes('disable')));
});
