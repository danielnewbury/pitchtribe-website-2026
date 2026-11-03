'use strict';
/* Input sanitisers. Every value from the dashboard passes through one of
   these before it reaches the store, so the player can trust the data. */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

function str(v, { max = 200, required = false, field = 'value' } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`${field} is required`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters)`);
  return s;
}

function int(v, { min = 0, max = 86400, fallback = 0 } = {}) {
  if (v === '' || v == null) return fallback;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v, fallback = false) {
  if (v === undefined) return fallback;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function oneOf(v, options, fallback) {
  return options.includes(v) ? v : fallback;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-4]):[0-5]\d$/;

function schedule(s) {
  s = s && typeof s === 'object' ? s : {};
  const out = {
    startDate: DATE_RE.test(s.startDate || '') ? s.startDate : '',
    endDate: DATE_RE.test(s.endDate || '') ? s.endDate : '',
    days: Array.isArray(s.days)
      ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [],
    startTime: TIME_RE.test(s.startTime || '') ? s.startTime : '',
    endTime: TIME_RE.test(s.endTime || '') ? s.endTime : '',
  };
  if (out.days.length === 7) out.days = [];
  if (out.startDate && out.endDate && out.endDate < out.startDate) throw bad('End date is before start date');
  return out;
}

function httpUrl(v) {
  const s = str(v, { max: 2000, required: true, field: 'URL' });
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad('Enter a full web address, starting with http:// or https://');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad('Only http:// and https:// addresses are supported');
  return u.toString();
}

const SCREEN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

module.exports = { HttpError, bad, str, int, bool, oneOf, schedule, httpUrl, SCREEN_ID_RE };
