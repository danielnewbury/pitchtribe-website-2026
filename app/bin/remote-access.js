#!/usr/bin/env node
'use strict';
/* PitchTribe remote access helper: switches SSH on or off and sets the login
   used for it, as asked from the dashboard (Settings → Remote access). Runs
   as root (pitchtribe-remote-access@.service), because the dashboard's server
   can't create accounts or start services.

     remote-access.js status    record whether SSH is on, and the logins (boot)
     remote-access.js request   do what remote-access-request.json asks

   remote-access-request.json, written by the server:
     { id, action: 'enable', username, passwordHash }   SHA-512 crypt hash, never the password
     { id, action: 'disable' }
   remote-access-status.json, written here:
     { sshEnabled, sshActive, users: [names], username, last, lastRequestId }

   'enable' creates the login if it doesn't exist (in the sudo group, so it can
   run the installer), or sets a new password on one this helper made before,
   makes sure SSH has host keys, and starts SSH. 'disable' stops SSH; the login
   stays, so switching it back on later keeps the same name. */
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const USERNAME_RE = /^[a-z][a-z0-9-]{2,30}$/;
// Never touch these, even if asked: system accounts and PitchTribe's own.
const RESERVED = new Set(['root', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp', 'mail', 'news', 'uucp', 'proxy',
  'www-data', 'backup', 'list', 'irc', 'nobody', 'systemd-network', 'systemd-timesync', 'messagebus', 'sshd', 'avahi',
  'pitchtribe', 'pitchtribe-kiosk', 'admin', 'administrator', 'sudo', 'adm', 'ssh', 'user']);
const HASH_RE = /^\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{86}$/;

function defaults() {
  return {
    dataDir: process.env.DATA_DIR || '/var/lib/pitchtribe',
    passwdFile: '/etc/passwd',
    now: () => new Date(),
    exec: (cmd, args, input) => childProcess.execFileSync(cmd, args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }),
  };
}

const file = (o, name) => path.join(o.dataDir, name);
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function writeJson(f, value) {
  fs.writeFileSync(`${f}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(`${f}.tmp`, f);
}

/** Accounts people log in as (uid 1000 and up, with a real shell). */
function people(o) {
  const out = [];
  for (const line of fs.readFileSync(o.passwdFile, 'utf8').split('\n')) {
    const [name, , uid, , , , shell] = line.split(':');
    if (Number(uid) >= 1000 && Number(uid) < 60000 && shell && !/nologin|false$/.test(shell)) out.push({ name, uid: Number(uid) });
  }
  return out;
}

function sshState(o) {
  const q = (args) => { try { return o.exec('systemctl', args).trim(); } catch (err) { return String(err.stdout || '').trim(); } };
  return { sshEnabled: q(['is-enabled', 'ssh.service']) === 'enabled', sshActive: q(['is-active', 'ssh.service']) === 'active' };
}

function status(o, extra = {}) {
  const prev = readJson(file(o, 'remote-access-status.json')) || {};
  const next = {
    ...prev,
    ...extra,
    ...sshState(o),
    users: people(o).map((u) => u.name),
    updatedAt: o.now().toISOString(),
  };
  writeJson(file(o, 'remote-access-status.json'), next);
  return next;
}

function enable(o, req) {
  const username = String(req.username || '');
  const hash = String(req.passwordHash || '');
  if (!USERNAME_RE.test(username) || RESERVED.has(username)) throw new Error('Choose a different username: small letters, numbers and hyphens, starting with a letter');
  if (!HASH_RE.test(hash)) throw new Error('The password could not be set');
  const existing = people(o).find((u) => u.name === username);
  let systemUser = false;
  try { systemUser = !existing && fs.readFileSync(o.passwdFile, 'utf8').split('\n').some((l) => l.split(':')[0] === username); } catch { /* no */ }
  if (systemUser) throw new Error(`“${username}” is a system account. Choose a different username.`);
  // A personal login (perhaps the one set in Raspberry Pi Imager) just gets the
  // new password, which also rescues a forgotten one; otherwise create it.
  if (!existing) {
    o.exec('useradd', ['--create-home', '--shell', '/bin/bash', '--groups', 'sudo,adm,video,plugdev', username]);
  }
  o.exec('chpasswd', ['-e'], `${username}:${hash}\n`);
  try { o.exec('ssh-keygen', ['-A']); } catch { /* keys already there */ }
  o.exec('systemctl', ['enable', '--now', 'ssh.service']);
  return { username, last: { action: 'enable', at: o.now().toISOString(), ok: true, message: `Remote access is on for “${username}”` } };
}

function handleRequest(o) {
  const req = readJson(file(o, 'remote-access-request.json'));
  const prev = readJson(file(o, 'remote-access-status.json')) || {};
  if (!req || !req.id || req.id === prev.lastRequestId) return status(o);
  // The request may hold a password hash: remove it as soon as it's read.
  fs.rmSync(file(o, 'remote-access-request.json'), { force: true });
  try {
    if (req.action === 'enable') return status(o, { lastRequestId: req.id, ...enable(o, req) });
    if (req.action === 'disable') {
      o.exec('systemctl', ['disable', '--now', 'ssh.service']);
      return status(o, { lastRequestId: req.id, last: { action: 'disable', at: o.now().toISOString(), ok: true, message: 'Remote access is off' } });
    }
    return status(o, { lastRequestId: req.id });
  } catch (err) {
    const message = err.stderr ? String(err.stderr).trim().split('\n').pop() : err.message;
    return status(o, { lastRequestId: req.id, last: { action: req.action, at: o.now().toISOString(), ok: false, message } });
  }
}

function main(command, o = defaults()) {
  if (command === 'status') return status(o);
  if (command === 'request') return handleRequest(o);
  throw new Error('usage: remote-access.js status|request');
}

module.exports = { main, people, USERNAME_RE, RESERVED, HASH_RE };

if (require.main === module) {
  try {
    const s = main(process.argv[2]);
    console.log(`ssh ${s.sshActive ? 'on' : 'off'}${s.last ? ` — ${s.last.message}` : ''}`);
    process.exitCode = s.last && !s.last.ok ? 1 : 0;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
