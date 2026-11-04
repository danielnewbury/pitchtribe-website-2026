'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../lib/auth');

const script = path.join(__dirname, '..', 'bin', 'reset-password.js');
const run = (file, password) =>
  spawnSync(process.execPath, [script, file], { env: { ...process.env, PT_PASSWORD: password }, encoding: 'utf8' });

test('reset-password: sets a new password, signs everyone out, keeps content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-reset-'));
  const file = path.join(dir, 'db.json');
  const before = {
    schemaVersion: 1,
    settings: { clubName: 'Riverside FC', adminHash: auth.hashPassword('old-password'), sessionSecret: 'a'.repeat(64) },
    assets: [{ id: 'x', type: 'notice' }],
    playlists: [{ id: 'p', name: 'Main', items: [] }],
    screens: [],
  };
  fs.writeFileSync(file, JSON.stringify(before));

  const r = run(file, 'new-password-123');
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(auth.verifyPassword('new-password-123', after.settings.adminHash));
  assert.ok(!auth.verifyPassword('old-password', after.settings.adminHash));
  assert.notEqual(after.settings.sessionSecret, before.settings.sessionSecret);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(after.playlists, before.playlists);
  assert.equal(after.settings.clubName, 'Riverside FC');
  assert.deepEqual(fs.readdirSync(dir), ['db.json'], 'no temp file left behind');
});

test('reset-password: refuses a short password and leaves the file alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-reset-'));
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, '{"settings":{"adminHash":"keep"}}');
  const r = run(file, 'short');
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"settings":{"adminHash":"keep"}}');
});
