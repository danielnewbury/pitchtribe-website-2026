'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/app');

const offline = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-bk-api-'));
  const ctx = createApp({ dataDir, sportsFetch: offline, feedsFetch: offline, log: () => {} });
  const server = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => { ctx.close(); server.closeAllConnections(); server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method,
      headers: { cookie, 'x-pitchtribe': '1', ...(body && !isBuf ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? (isBuf ? body : JSON.stringify(body)) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const out = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: out };
  };
  return { dataDir, call, signOut: () => { cookie = ''; } };
}

test('backup file: download from one club, restore onto a freshly flashed Pi', async (t) => {
  const a = await start(t);
  await a.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
  const up = await a.call('POST', '/api/assets/upload', png, { 'content-type': 'image/png', 'x-filename': 'crest.png' });
  assert.equal(up.status, 201);
  await a.call('POST', '/api/assets', { type: 'notice', name: 'Quiz night', content: { title: 'Quiz night', body: 'Friday 8pm' } });

  const dl = await a.call('GET', '/api/backup/download');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /pitchtribe-backup-.*\.tar\.gz/);
  const file = path.join(a.dataDir, 'backup.tar.gz');
  fs.writeFileSync(file, dl.body);
  const listing = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(listing.includes('db.json') && listing.includes('manifest.json'));
  assert.ok(listing.includes(`media/${up.body.file.filename}`));

  a.signOut();
  assert.equal((await a.call('GET', '/api/backup/download')).status, 401);
  assert.equal((await a.call('POST', '/api/setup/restore-file', dl.body, { 'content-type': 'application/gzip' })).status, 409,
    'a set-up dashboard can’t be restored over without signing in');

  // A brand-new card: the first-run screen can restore the file.
  const b = await start(t);
  let st = await b.call('GET', '/api/auth/status');
  assert.equal(st.body.setupRequired, true);
  assert.deepEqual(st.body.restore.usb, []);
  const bad = await b.call('POST', '/api/setup/restore-file', Buffer.from('not a backup'), { 'content-type': 'application/gzip' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /isn’t a PitchTribe backup/);
  const noHeader = await b.call('POST', '/api/setup/restore-file', dl.body, { 'content-type': 'application/gzip', 'x-pitchtribe': '0' });
  assert.equal(noHeader.status, 403);

  const r = await b.call('POST', '/api/setup/restore-file', dl.body, { 'content-type': 'application/gzip' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.club, 'Riverside FC');
  st = await b.call('GET', '/api/auth/status');
  assert.equal(st.body.setupRequired, false);
  assert.equal(st.body.restore, undefined);
  assert.equal((await b.call('POST', '/api/auth/login', { password: 'correct horse' })).status, 200, 'the old password works');
  const state = (await b.call('GET', '/api/state')).body;
  assert.deepEqual(state.assets.map((x) => x.name).sort(), ['Quiz night', 'Welcome notice', 'crest']);
  assert.ok(fs.existsSync(path.join(b.dataDir, 'media', up.body.file.filename)));
  assert.deepEqual(fs.readdirSync(b.dataDir).filter((f) => f.startsWith('.restore-')), [], 'no leftovers');

  // Signed in, a backup can be restored over the current data too.
  assert.equal((await b.call('POST', '/api/backup/restore-file', dl.body, { 'content-type': 'application/gzip' })).status, 200);
});

test('USB backups: status for Settings, requests for the root helper, restore from the first-run screen', async (t) => {
  const a = await start(t);
  const statusFile = path.join(a.dataDir, 'backup-status.json');
  const requestFile = () => JSON.parse(fs.readFileSync(path.join(a.dataDir, 'backup-request.json'), 'utf8'));
  fs.writeFileSync(statusFile, JSON.stringify({
    running: null,
    sticks: [{ uuid: 'AAAA-1111', label: 'CLUB', fstype: 'vfat', size: 32e9, free: 30e9, backups: [
      { host: 'bar-tv', snapshots: [{ id: '2026-11-04T03-30-00Z', at: '2026-11-04T03:30:00.000Z', club: 'Riverside FC', counts: { assets: 3 } }] },
    ] }],
  }));

  // Fresh Pi with a stick plugged in: the first-run screen sees the backup.
  let st = await a.call('GET', '/api/auth/status');
  assert.equal(st.body.restore.usb[0].backups[0].snapshots[0].club, 'Riverside FC');
  assert.equal((await a.call('POST', '/api/setup/restore-usb', { uuid: 'AAAA-1111', host: 'bar-tv', snapshot: '2026-11-04T03-30-00Z' })).status, 200);
  assert.deepEqual([requestFile().action, requestFile().host, requestFile().snapshot], ['restore', 'bar-tv', '2026-11-04T03-30-00Z']);
  assert.equal((await a.call('POST', '/api/setup/restore-usb', { uuid: 'AAAA-1111', host: 'bar-tv', snapshot: '2026-01-01T00-00-00Z' })).status, 400);
  assert.equal((await a.call('POST', '/api/setup/restore-usb', { uuid: 'AAAA-1111', host: '../x', snapshot: '2026-11-04T03-30-00Z' })).status, 400);

  // Once set up, those routes are closed and Settings → Backups takes over.
  await a.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  st = await a.call('GET', '/api/auth/status');
  assert.equal(st.body.restore, undefined);
  assert.equal((await a.call('POST', '/api/setup/restore-usb', { uuid: 'AAAA-1111', host: 'bar-tv', snapshot: '2026-11-04T03-30-00Z' })).status, 409);
  const b = (await a.call('GET', '/api/backup')).body;
  assert.equal(b.available, true);
  assert.equal(b.status.sticks[0].label, 'CLUB');
  assert.equal((await a.call('POST', '/api/backup/request', { action: 'use', uuid: 'AAAA-1111' })).status, 200);
  assert.deepEqual([requestFile().action, requestFile().uuid], ['use', 'AAAA-1111']);
  assert.equal((await a.call('POST', '/api/backup/request', { action: 'now' })).status, 200);
  assert.equal(requestFile().action, 'now');
  assert.equal((await a.call('POST', '/api/backup/request', { action: 'format-disk' })).status, 400);

  // Without the helper (not on a Pi), USB actions say so.
  fs.rmSync(statusFile);
  assert.equal((await a.call('GET', '/api/backup')).body.available, false);
  assert.equal((await a.call('POST', '/api/backup/request', { action: 'now' })).status, 503);
});
