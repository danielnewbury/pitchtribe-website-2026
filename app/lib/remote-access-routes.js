'use strict';
/* Settings → Remote access: switch SSH on or off and choose its login.

   The root helper (bin/remote-access.js) does the work; this server writes
   remote-access-request.json for it and reads remote-access-status.json back.
   Turning SSH on gives a shell on the Pi, so it needs the dashboard password
   again, and the SSH password is hashed here (SHA-512 crypt, via openssl):
   the plain password is never written to disk. */
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('./auth');
const v = require('./validate');
const { USERNAME_RE, RESERVED, HASH_RE } = require('../bin/remote-access');

const MIN_PASSWORD = 10;

function mountRemoteAccessRoutes({ api, dataDir, adminHash, limiter, hashPassword }) {
  hashPassword = hashPassword || sha512crypt;
  const statusFile = path.join(dataDir, 'remote-access-status.json');
  const requestFile = path.join(dataDir, 'remote-access-request.json');
  const status = () => { try { return JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch { return null; } };

  api.get('/remote-access', (req, res) => {
    const s = status();
    res.set('Cache-Control', 'no-store').json({
      available: Boolean(s),
      status: s && {
        sshEnabled: Boolean(s.sshEnabled),
        sshActive: Boolean(s.sshActive),
        users: s.users || [],
        username: s.username || null,
        last: s.last || null,
        lastRequestId: s.lastRequestId || null,
      },
    });
  });

  api.post('/remote-access', (req, res, next) => {
    try {
      const b = req.body || {};
      if (!status()) throw new v.HttpError(503, 'Remote access can only be switched on from a Raspberry Pi running PitchTribe');
      if (limiter.blocked(req.ip)) throw new v.HttpError(429, 'Too many attempts — wait 15 minutes and try again');
      if (!auth.verifyPassword(String(b.currentPassword || ''), adminHash())) {
        limiter.fail(req.ip);
        throw new v.HttpError(403, 'Your dashboard password isn’t right');
      }
      limiter.reset(req.ip);

      let body;
      if (b.enabled) {
        const username = String(b.username || '').trim();
        if (!USERNAME_RE.test(username) || RESERVED.has(username)) {
          throw v.bad('Choose a username of small letters, numbers and hyphens, starting with a letter (for example “clubadmin”)');
        }
        const password = String(b.password || '');
        if (password.length < MIN_PASSWORD) throw v.bad(`Choose an SSH password of at least ${MIN_PASSWORD} characters`);
        const passwordHash = hashPassword(password);
        if (!HASH_RE.test(passwordHash)) throw new v.HttpError(500, 'The password could not be prepared');
        body = { action: 'enable', username, passwordHash };
      } else {
        body = { action: 'disable' };
      }
      const id = crypto.randomBytes(8).toString('hex');
      fs.writeFileSync(`${requestFile}.tmp`, `${JSON.stringify({ id, at: new Date().toISOString(), ...body })}\n`, { mode: 0o600 });
      fs.renameSync(`${requestFile}.tmp`, requestFile);
      res.json({ requestId: id });
    } catch (err) {
      next(err);
    }
  });
}

/** SHA-512 crypt ($6$) hash, as /etc/shadow stores it. */
function sha512crypt(password) {
  return childProcess.execFileSync('openssl', ['passwd', '-6', '-stdin'], { input: password, encoding: 'utf8' }).trim();
}

module.exports = { mountRemoteAccessRoutes, MIN_PASSWORD };
