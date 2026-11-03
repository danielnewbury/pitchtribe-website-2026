'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../lib/app');

const espnFixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'signage-server', 'test', 'fixtures', 'espn-eng1.json'), 'utf8')
);
const fakeEspn = async () => ({ ok: true, status: 200, json: async () => espnFixture });

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchtribe-test-'));
  const ctx = createApp({ dataDir, maxUploadMb: 1, sportsFetch: fakeEspn, log: () => {} });
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(method, url, body, { headers = {}, raw = false } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        'x-pitchtribe': '1',
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  }
  const stop = () => {
    ctx.close();
    server.closeAllConnections();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { call, stop, ctx, base, clearCookie: () => { cookie = ''; } };
}

test('first-run setup, login and auth guard', async (t) => {
  const s = await startServer();
  t.after(s.stop);

  let r = await s.call('GET', '/api/auth/status');
  assert.equal(r.body.setupRequired, true);

  r = await s.call('GET', '/api/state');
  assert.equal(r.status, 401);

  r = await s.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'short' });
  assert.equal(r.status, 400);

  r = await s.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  assert.equal(r.status, 200);

  r = await s.call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.clubName, 'Riverside FC');
  assert.equal(r.body.playlists.length, 1, 'a starter playlist is created');
  assert.equal(r.body.assets[0].type, 'notice', 'with a welcome notice');
  assert.equal(r.body.settings.adminHash, undefined, 'secrets never leave the server');

  r = await s.call('POST', '/api/auth/setup', { clubName: 'Again', password: 'another password' });
  assert.equal(r.status, 409);

  // Mutations need the CSRF header.
  r = await s.call('POST', '/api/playlists', { name: 'X' }, { headers: { 'x-pitchtribe': '' } });
  assert.equal(r.status, 403);

  s.clearCookie();
  r = await s.call('POST', '/api/auth/login', { password: 'wrong password' });
  assert.equal(r.status, 401);
  r = await s.call('POST', '/api/auth/login', { password: 'correct horse' });
  assert.equal(r.status, 200);
  r = await s.call('GET', '/api/state');
  assert.equal(r.status, 200);
});

test('content, playlists, timings and the screen manifest', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  await s.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  const playlistId = (await s.call('GET', '/api/state')).body.playlists[0].id;

  // Upload an image (raw body).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  let r = await s.call('POST', '/api/assets/upload', png, {
    raw: true,
    headers: { 'content-type': 'image/png', 'x-filename': encodeURIComponent('Club crest.png') },
  });
  assert.equal(r.status, 201);
  const image = r.body;
  assert.equal(image.type, 'image');
  assert.equal(image.name, 'Club crest');
  assert.equal(image.duration, 10);

  // Uploaded media is served with a sandboxing CSP.
  r = await s.call('GET', image.src);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);

  // Unsupported upload types are refused.
  r = await s.call('POST', '/api/assets/upload', 'hello', { raw: true, headers: { 'content-type': 'text/html' } });
  assert.equal(r.status, 415);

  // Oversized uploads are refused (limit is 1 MB in tests).
  r = await s.call('POST', '/api/assets/upload', Buffer.alloc(1024 * 1024 + 10), { raw: true, headers: { 'content-type': 'image/png' } });
  assert.equal(r.status, 413);

  // Text content types.
  r = await s.call('POST', '/api/assets', { type: 'menu', name: 'Bar menu', content: { title: 'Bar', text: '# Draught\nLager | £4.50' }, addToPlaylist: playlistId });
  assert.equal(r.status, 201);
  const menu = r.body;
  r = await s.call('POST', '/api/assets', { type: 'url', name: 'Bad', url: 'javascript:alert(1)' });
  assert.equal(r.status, 400);
  r = await s.call('POST', '/api/assets', { type: 'notice', name: 'Empty' });
  assert.equal(r.status, 400);

  // Build the playlist: image (lunchtime only), menu (disabled).
  r = await s.call('GET', '/api/state');
  const pl = r.body.playlists[0];
  assert.equal(pl.items.length, 2, 'menu was added to the playlist on create');
  r = await s.call('PUT', `/api/playlists/${pl.id}`, {
    ...pl,
    ticker: 'Bar open from 12:00',
    items: [
      ...pl.items,
      { assetId: image.id, enabled: true, duration: 7, schedule: { days: [1, 2, 3, 4, 5], startTime: '12:00', endTime: '14:00' } },
      { assetId: 'does-not-exist', enabled: true },
    ].map((it) => (it.assetId === menu.id ? { ...it, enabled: false } : it)),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 3, 'unknown assets are dropped');
  assert.deepEqual(r.body.items[2].schedule, { startDate: '', endDate: '', days: [1, 2, 3, 4, 5], startTime: '12:00', endTime: '14:00' });

  r = await s.call('PUT', `/api/playlists/${pl.id}`, { items: [{ assetId: image.id, schedule: { startDate: '2026-12-01', endDate: '2026-11-01' } }] });
  assert.equal(r.status, 400, 'end date before start date');

  // A screen registers itself on first contact and gets the default playlist.
  r = await s.call('GET', '/api/player/bar-tv/manifest?w=1920&h=1080');
  assert.equal(r.status, 200);
  assert.equal(r.body.screen.id, 'bar-tv');
  assert.equal(r.body.playlist.ticker, 'Bar open from 12:00');
  assert.deepEqual(r.body.items.map((i) => i.type), ['notice', 'image'], 'disabled items are not sent');
  assert.equal(r.body.items[1].duration, 7, 'per-item duration overrides the default');

  r = await s.call('GET', '/api/player/bad id!/manifest');
  assert.equal(r.status, 400);

  r = await s.call('GET', '/api/state');
  const screen = r.body.screens.find((x) => x.id === 'bar-tv');
  assert.equal(screen.resolution, '1920×1080');
  assert.equal(screen.online, true);

  // Rename + rotate the screen, unassign its playlist.
  r = await s.call('PATCH', '/api/screens/bar-tv', { name: 'Bar TV', rotation: 90, playlistId: '' });
  assert.equal(r.body.name, 'Bar TV');
  assert.equal(r.body.rotation, 90);
  r = await s.call('GET', '/api/player/bar-tv/manifest');
  assert.equal(r.body.playlist, null);
  assert.equal(r.body.items.length, 0);

  // Deleting content removes it from playlists and disk.
  const mediaFile = path.join(s.ctx.dataDir, 'media', path.basename(image.src));
  assert.ok(fs.existsSync(mediaFile));
  r = await s.call('DELETE', `/api/assets/${image.id}`);
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(mediaFile));
  r = await s.call('GET', '/api/state');
  assert.ok(r.body.playlists.every((p) => p.items.every((it) => it.assetId !== image.id)));

  // Preview needs a login.
  r = await s.call('GET', `/api/preview/${pl.id}/manifest`);
  assert.equal(r.status, 200);
  s.clearCookie();
  r = await s.call('GET', `/api/preview/${pl.id}/manifest`);
  assert.equal(r.status, 401);
});

test('screens receive a push when content changes', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  await s.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  await s.call('GET', '/api/player/lounge/manifest');

  const ac = new AbortController();
  t.after(() => ac.abort());
  const res = await fetch(`${s.base}/api/player/lounge/events`, { signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let r = await s.call('GET', '/api/state');
  assert.equal(r.body.screens[0].online, true);

  await s.call('POST', '/api/assets', { type: 'notice', name: 'Hello', content: { title: 'Hello' } });
  let text = '';
  while (!text.includes('event: changed')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  assert.match(text, /event: changed/);

  r = await s.call('POST', '/api/screens/lounge/command', { command: 'identify' });
  assert.equal(r.body.delivered, 1);
  r = await s.call('POST', '/api/screens/lounge/command', { command: 'format-disk' });
  assert.equal(r.status, 400);
});

test('sports engine runs inside the app: settings, /sports routes, MCP auth, live-score slides', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  await s.call('POST', '/api/auth/setup', { clubName: 'Riverside FC', password: 'correct horse' });
  await s.ctx.sports.ready;

  let r = await s.call('GET', '/api/state');
  assert.equal(r.body.sports.enabled, false);
  assert.ok(r.body.sports.catalog.some((l) => l.key === 'eng.1'), 'league catalogue comes from signage-server');
  assert.ok(!r.body.sports.catalog.some((l) => l.key === 'club'), 'manual club league is not offered');
  const token = r.body.sports.apiToken;
  assert.ok(token.length >= 24);

  r = await s.call('GET', '/feeds/api/health');
  assert.equal(r.status, 404, 'off until enabled');

  r = await s.call('PUT', '/api/settings/sports', { enabled: true, leagues: ['eng.1', 'not-a-league'], timezone: 'Europe/London' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.leagues, ['eng.1']);
  assert.equal(r.body.running, true);
  r = await s.call('PUT', '/api/settings/sports', { enabled: true, leagues: ['eng.1'], timezone: 'Mars/Olympus' });
  assert.equal(r.status, 400);

  r = await s.call('POST', '/api/sports/refresh', {});
  assert.equal(r.status, 200);
  assert.ok(r.body.status[0].events > 0);

  // The engine's own routes, served by the app.
  r = await s.call('GET', '/feeds/api/health');
  assert.equal(r.body.ok, true);
  r = await s.call('GET', '/feeds/display');
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.body, /new EventSource\('api\/stream'\)/, 'stream URL is relative so it works under /feeds');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/);

  // MCP needs the token (or a dashboard session).
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  s.clearCookie();
  r = await s.call('POST', '/feeds/mcp', rpc, { headers: { 'x-pitchtribe': '' } });
  assert.equal(r.status, 401);
  r = await s.call('POST', '/feeds/mcp', rpc, { headers: { authorization: `Bearer ${token}`, 'x-pitchtribe': '' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.result.tools.some((tool) => tool.name === 'get_live_scores'));
  await s.call('POST', '/api/auth/login', { password: 'correct horse' });

  // A "Live scores" slide carries the data in the screen manifest.
  r = await s.call('POST', '/api/assets', {
    type: 'scores', name: 'Premier League', content: { title: 'Premier League', leagues: ['eng.1', '<bad>'], show: 'all', limit: 5 },
    addToPlaylist: (await s.call('GET', '/api/state')).body.playlists[0].id,
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.content.leagues, ['eng.1']);
  r = await s.call('GET', '/api/player/bar-tv/manifest');
  const slide = r.body.items.find((i) => i.type === 'scores');
  assert.ok(slide.data.length > 0 && slide.data.length <= 5);
  assert.ok(slide.data[0].home.name && 'score' in slide.data[0].home);

  // Score changes are pushed to screens.
  let pushed = 0;
  const orig = s.ctx.hub.broadcast.bind(s.ctx.hub);
  s.ctx.hub.broadcast = (event, data) => { if (data && data.sports) pushed += 1; return orig(event, data); };
  s.ctx.sports.emit('update');
  assert.equal(pushed, 1);

  // Switching off removes the data and the routes.
  await s.call('PUT', '/api/settings/sports', { enabled: false, leagues: ['eng.1'] });
  r = await s.call('GET', '/api/player/bar-tv/manifest');
  assert.equal(r.body.items.find((i) => i.type === 'scores').data, null);
  r = await s.call('GET', '/feeds/api/health');
  assert.equal(r.status, 404);
});
