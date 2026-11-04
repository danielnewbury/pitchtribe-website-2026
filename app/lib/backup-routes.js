'use strict';
/* Backup and restore routes for the dashboard.

   USB stick backups are done by a root helper (bin/backup.js), because this
   server may not mount disks. The server talks to it through files:
   it writes backup-request.json, and reads backup-status.json and
   backup-config.json, which the helper writes.

   A backup file (.tar.gz) is made and restored by this server itself:
     GET  /api/backup/download          the whole club, as one file
     POST /api/backup/restore-file      put a downloaded backup back

   Before the dashboard has been set up (a freshly flashed card), the restore
   routes also work without signing in, from the first-run screen:
     POST /api/setup/restore-usb        restore from a backup on a USB stick
     POST /api/setup/restore-file       restore from a backup file
   Once the dashboard has a password they need it, like everything else. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { tarChunks, readTar } = require('./tar');
const { DATA_FILES, SAFE_NAME, SNAPSHOT_ID, mediaFiles } = require('./backup');
const v = require('./validate');

const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

function mountBackupRoutes({ app, api, dataDir, mediaDir, store, setupRequired, onRestored, version = '', hostname = os.hostname() }) {
  const file = (name) => path.join(dataDir, name);
  const readJson = (name) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return null; } };

  /** What the root helper last reported, or null if it isn't installed (e.g. a dev machine). */
  const status = () => readJson('backup-status.json');

  function request(action, extra = {}) {
    const req = { id: crypto.randomBytes(8).toString('hex'), action, at: new Date().toISOString(), ...extra };
    fs.writeFileSync(`${file('backup-request.json')}.tmp`, `${JSON.stringify(req, null, 2)}\n`);
    fs.renameSync(`${file('backup-request.json')}.tmp`, file('backup-request.json'));
    return req.id;
  }

  /** Backups on any plugged-in stick, for the first-run screen. */
  function setupInfo() {
    const s = status();
    if (!s) return { usb: [], running: null, last: null };
    const usb = (s.sticks || []).filter((k) => (k.backups || []).length).map((k) => ({
      uuid: k.uuid,
      label: k.label,
      backups: k.backups.map((b) => ({ host: b.host, snapshots: b.snapshots.map(({ id, at, club, counts }) => ({ id, at, club, counts })) })),
    }));
    return { usb, running: s.running || null, last: s.last || null, lastRequestId: s.lastRequestId || null };
  }

  function requestUsbRestore(body) {
    const uuid = String(body.uuid || '');
    const host = String(body.host || '');
    const snapshot = String(body.snapshot || '');
    if (!UUID_RE.test(uuid) || !SAFE_NAME.test(host) || !SNAPSHOT_ID.test(snapshot)) throw v.bad('Choose a backup to restore');
    const s = status();
    if (!s) throw new v.HttpError(503, 'USB backups need PitchTribe to be installed on a Raspberry Pi');
    const found = (s.sticks || []).find((k) => k.uuid === uuid)?.backups?.find((b) => b.host === host)?.snapshots?.some((x) => x.id === snapshot);
    if (!found) throw v.bad('That backup isn’t on a plugged-in USB stick any more');
    return request('restore', { uuid, host, snapshot });
  }

  /** Reads an uploaded .tar.gz backup and makes it the current data. */
  async function restoreFromFile(req) {
    const work = fs.mkdtempSync(path.join(dataDir, '.restore-'));
    try {
      const names = new Set();
      try {
        await readTar(req.pipe(zlib.createGunzip()), (name) => {
          const m = /^media\/([^/]+)$/.exec(name);
          if (m && SAFE_NAME.test(m[1])) {
            fs.mkdirSync(path.join(work, 'media'), { recursive: true });
            names.add(name);
            return path.join(work, 'media', m[1]);
          }
          if (DATA_FILES.includes(name) || name === 'manifest.json') {
            names.add(name);
            return path.join(work, name);
          }
          return null; // anything else in the archive is ignored
        });
      } catch (err) {
        throw v.bad(/incorrect header check|unexpected end/i.test(err.message) || !err.message
          ? 'That isn’t a PitchTribe backup file. Choose the .tar.gz file from “Download backup”.'
          : err.message);
      }
      let db;
      try { db = JSON.parse(fs.readFileSync(path.join(work, 'db.json'), 'utf8')); } catch { db = null; }
      if (!db || typeof db.settings !== 'object' || !Array.isArray(db.assets)) {
        throw v.bad('That file has no PitchTribe database in it. Choose the .tar.gz file from “Download backup”.');
      }
      const missing = db.assets
        .map((a) => a.file && a.file.filename)
        .filter((f) => f && !names.has(`media/${f}`) && !fs.existsSync(path.join(mediaDir, f)));
      if (missing.length) throw v.bad(`That backup is missing ${missing.length} photo or video file(s). It may not have finished downloading.`);

      for (const f of names) {
        if (!f.startsWith('media/')) continue;
        fs.renameSync(path.join(work, f), path.join(mediaDir, path.basename(f)));
      }
      for (const f of DATA_FILES) {
        if (f === 'db.json') continue;
        if (names.has(f)) fs.renameSync(path.join(work, f), file(f));
        else fs.rmSync(file(f), { force: true });
      }
      store.replace(db);
      onRestored();
      return { club: String(db.settings.clubName || '') };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  const guardSetup = (req) => {
    if (!setupRequired()) throw new v.HttpError(409, 'This dashboard is already set up. Sign in and restore from Settings → Backups.');
    if (req.get('x-pitchtribe') !== '1') throw new v.HttpError(403, 'Missing request header');
  };
  const wrap = (fn) => (req, res, next) => { Promise.resolve().then(() => fn(req, res)).catch(next); };

  // First-run screen (no password yet) ------------------------------------------
  app.post('/api/setup/restore-usb', wrap((req, res) => {
    guardSetup(req);
    res.json({ requestId: requestUsbRestore(req.body || {}) });
  }));
  app.post('/api/setup/restore-file', wrap(async (req, res) => {
    guardSetup(req);
    res.json(await restoreFromFile(req));
  }));

  // Signed-in dashboard ---------------------------------------------------------------
  api.get('/backup', (req, res) => {
    const s = status();
    res.set('Cache-Control', 'no-store').json({ available: Boolean(s), status: s, config: readJson('backup-config.json') });
  });

  api.post('/backup/request', wrap((req, res) => {
    const b = req.body || {};
    const action = v.oneOf(b.action, ['use', 'stop', 'now', 'restore'], null);
    if (!action) throw v.bad('Unknown backup action');
    if (!status()) throw new v.HttpError(503, 'USB backups need PitchTribe to be installed on a Raspberry Pi');
    if (action === 'restore') return res.json({ requestId: requestUsbRestore(b) });
    if (action === 'use' && !UUID_RE.test(String(b.uuid || ''))) throw v.bad('Choose a USB stick');
    res.json({ requestId: request(action, action === 'use' ? { uuid: String(b.uuid) } : {}) });
  }));

  api.post('/backup/restore-file', wrap(async (req, res) => {
    res.json(await restoreFromFile(req));
  }));

  api.get('/backup/download', wrap(async (req, res) => {
    store.flush();
    const d = store.data;
    const media = mediaFiles(dataDir);
    const day = new Date().toISOString().slice(0, 10);
    const manifest = { format: 1, at: new Date().toISOString(), hostname, version, club: d.settings.clubName || '', media };
    const entries = [
      { name: 'manifest.json', buffer: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
      { name: 'db.json', buffer: Buffer.from(JSON.stringify(d, null, 2)) },
      ...DATA_FILES.filter((f) => f !== 'db.json' && fs.existsSync(file(f))).map((f) => ({ name: f, file: file(f) })),
      ...media.map((f) => ({ name: `media/${f}`, file: path.join(mediaDir, f) })),
    ];
    const safeHost = hostname.replace(/[^A-Za-z0-9-]/g, '') || 'pi';
    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="pitchtribe-backup-${safeHost}-${day}.tar.gz"`,
      'Cache-Control': 'no-store',
    });
    try {
      await pipeline(Readable.from(tarChunks(entries)), zlib.createGzip({ level: 6 }), res);
    } catch (err) {
      res.destroy(err); // the browser sees a failed download, never a short file
    }
  }));

  return { setupInfo };
}

module.exports = { mountBackupRoutes };
