/* PitchTribe — playlist item scheduling.
   Shared by the server (Node `require`) and the browser (window.PTSchedule).
   All times are evaluated in the local time of whoever runs it: on a screen,
   that is the display's clock, so a screen keeps the right schedule offline. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PTSchedule = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n) => String(n).padStart(2, '0');

  /** Local date as YYYY-MM-DD (sorts lexically). */
  function dateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** "HH:MM" -> minutes after midnight, or null when empty/invalid. */
  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 24 || min > 59) return null;
    return Math.min(h * 60 + min, 1440);
  }

  /**
   * Status of a playlist item at `now`:
   *   'live'      — plays now
   *   'disabled'  — switched off
   *   'scheduled' — start date is in the future
   *   'expired'   — end date has passed
   *   'off-hours' — inside its dates, but outside its days / time window
   *
   * Time windows may cross midnight (e.g. 18:00–02:00); the early-morning
   * part counts as the previous day for the day-of-week check.
   */
  function status(item, now) {
    now = now || new Date();
    if (!item || item.enabled === false) return 'disabled';
    const s = item.schedule || {};
    const today = dateKey(now);
    if (s.startDate && today < s.startDate) return 'scheduled';
    if (s.endDate && today > s.endDate) return 'expired';

    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let day = now.getDay();

    if (start !== null || end !== null) {
      const st = start === null ? 0 : start;
      const en = end === null ? 1440 : end; // "00:00" as an end means midnight (overnight)
      if (st < en) {
        if (nowMin < st || nowMin >= en) return 'off-hours';
      } else if (st > en) {
        // Overnight window.
        if (nowMin >= st) {
          /* evening part: today */
        } else if (nowMin < en) {
          day = (day + 6) % 7;
        } else {
          return 'off-hours';
        }
      }
      // st === en: treat as "all day".
    }

    const days = Array.isArray(s.days) && s.days.length ? s.days : null;
    if (days && !days.includes(day)) return 'off-hours';
    return 'live';
  }

  function isLive(item, now) {
    return status(item, now) === 'live';
  }

  /** Short human summary, e.g. "Mon–Fri · 12:00–14:00 · until 2026-12-01". */
  function describe(schedule) {
    const s = schedule || {};
    const parts = [];
    const days = Array.isArray(s.days) ? s.days.slice().sort((a, b) => a - b) : [];
    if (days.length && days.length < 7) {
      const key = days.join(',');
      if (key === '1,2,3,4,5') parts.push('Weekdays');
      else if (key === '0,6') parts.push('Weekends');
      else parts.push(days.map((d) => DAY_NAMES[d]).join(', '));
    }
    if (s.startTime || s.endTime) parts.push(`${s.startTime || '00:00'}–${s.endTime || '24:00'}`);
    if (s.startDate && s.endDate) parts.push(`${s.startDate} → ${s.endDate}`);
    else if (s.startDate) parts.push(`from ${s.startDate}`);
    else if (s.endDate) parts.push(`until ${s.endDate}`);
    return parts.join(' · ') || 'Always';
  }

  return { status, isLive, describe, dateKey, toMinutes, DAY_NAMES };
});
