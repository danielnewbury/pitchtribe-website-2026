'use strict';
/* Single admin password (club volunteers share one login), scrypt-hashed.
   Sessions are stateless HMAC-signed cookies; changing the password rotates
   the signing secret, which signs everyone else out. */
const crypto = require('node:crypto');

const COOKIE = 'pt_session';
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function issueToken(secret) {
  const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
  const body = `v1.${expires}`;
  return `${body}.${sign(body, secret)}`;
}

function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  return Number(parts[1]) > Date.now();
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(token, req) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

/** Tiny in-memory limiter for login attempts: 10 failures per 15 min per IP. */
class LoginLimiter {
  constructor({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  blocked(ip) {
    const rec = this.hits.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.first > this.windowMs) {
      this.hits.delete(ip);
      return false;
    }
    return rec.count >= this.max;
  }
  fail(ip) {
    const rec = this.hits.get(ip);
    if (!rec || Date.now() - rec.first > this.windowMs) this.hits.set(ip, { first: Date.now(), count: 1 });
    else rec.count += 1;
  }
  reset(ip) {
    this.hits.delete(ip);
  }
}

module.exports = {
  COOKIE,
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
  parseCookies,
  sessionCookie,
  clearCookie,
  LoginLimiter,
};
