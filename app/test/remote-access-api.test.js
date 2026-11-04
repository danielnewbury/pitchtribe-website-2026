'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/app');

const offline = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

test('remote access API: needs the dashboard password, never stores the SSH password', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-ra-api-'));
  const ctx = createApp({ dataDir, sportsFetch: offline, feedsFetch: offline, log: () => {} });
  const server = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => { ctx.close(); server.closeAllConnections(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'x-pitchtribe': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  const reqFile = path.join(dataDir, 'remote-access-request.json');

  // Not on a Pi (no helper status yet): say so.
  assert.equal((await call('GET', '/api/remote-access')).body.available, false);
  assert.equal((await call('POST', '/api/remote-access', { enabled: true, username: 'clubadmin', password: 'long-enough-pw', currentPassword: 'correct horse' })).status, 503);

  fs.writeFileSync(path.join(dataDir, 'remote-access-status.json'), JSON.stringify({ sshEnabled: false, sshActive: false, users: ['dan'] }));
  let r = await call('GET', '/api/remote-access');
  assert.equal(r.body.available, true);
  assert.deepEqual(r.body.status.users, ['dan']);

  r = await call('POST', '/api/remote-access', { enabled: true, username: 'clubadmin', password: 'long-enough-pw', currentPassword: 'wrong' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /dashboard password/);
  assert.equal((await call('POST', '/api/remote-access', { enabled: true, username: 'root', password: 'long-enough-pw', currentPassword: 'correct horse' })).status, 400);
  assert.equal((await call('POST', '/api/remote-access', { enabled: true, username: 'clubadmin', password: 'short', currentPassword: 'correct horse' })).status, 400);
  assert.ok(!fs.existsSync(reqFile));

  r = await call('POST', '/api/remote-access', { enabled: true, username: 'clubadmin', password: 'long-enough-pw', currentPassword: 'correct horse' });
  assert.equal(r.status, 200);
  const raw = fs.readFileSync(reqFile, 'utf8');
  const req = JSON.parse(raw);
  assert.deepEqual([req.id, req.action, req.username], [r.body.requestId, 'enable', 'clubadmin']);
  assert.match(req.passwordHash, /^\$6\$/);
  assert.ok(!raw.includes('long-enough-pw'), 'the plain password is never written');
  assert.equal(fs.statSync(reqFile).mode & 0o077, 0, 'readable by the server and root only');

  r = await call('POST', '/api/remote-access', { enabled: false, currentPassword: 'correct horse' });
  assert.equal(JSON.parse(fs.readFileSync(reqFile, 'utf8')).action, 'disable');

  cookie = '';
  assert.equal((await call('GET', '/api/remote-access')).status, 401);
});
