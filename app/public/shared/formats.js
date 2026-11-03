/* PitchTribe — plain-text formats for menu boards and fixture lists.
   Club volunteers edit these as simple text on a phone (or paste from a
   spreadsheet); the player and the dashboard both parse them with this file.

   Menu:
     # Draught
     Lager (pint) | £4.50
     Real ale (pint) | £4.80 | Ask for guest ale
     Stout (pint) | £4.70 | | sold out

   Fixtures:
     2026-11-09 14:00 | Riverside FC v Rovers United | League | Home
     16/11/2026 15:00 | City Athletic v Riverside FC | League | Away
     Tuesday 19:30 | Training · Astroturf Pitch A
   Columns may be separated by "|" or tabs (paste from Excel/Sheets). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PTFormats = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const splitCols = (line) => line.split(/\s*[|\t]\s*/).map((c) => c.trim());
  const lines = (text) =>
    String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'));

  function parseMenu(text) {
    const sections = [];
    let current = null;
    for (const line of lines(text)) {
      if (line.startsWith('#')) {
        current = { title: line.replace(/^#+\s*/, ''), items: [] };
        sections.push(current);
        continue;
      }
      if (!current) {
        current = { title: '', items: [] };
        sections.push(current);
      }
      const cols = splitCols(line);
      let soldOut = false;
      if (cols.length > 1 && /^sold\s*out$/i.test(cols[cols.length - 1])) {
        soldOut = true;
        cols.pop();
      }
      current.items.push({
        name: cols[0] || '',
        price: cols[1] || '',
        notes: cols.slice(2).filter(Boolean).join(' · '),
        soldOut,
      });
    }
    return sections.filter((s) => s.title || s.items.length);
  }

  /** Parse "2026-11-09 14:00", "09/11/2026 14:00" or "9/11/26". Returns {date, hasTime} or null. */
  function parseWhen(str) {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?$/.exec(str);
    let y, mo, d, h, mi;
    if (m) {
      [, y, mo, d, h, mi] = m;
    } else {
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?$/.exec(str);
      if (!m) return null;
      [, d, mo, y, h, mi] = m;
      if (y.length === 2) y = '20' + y;
    }
    const hasTime = h !== undefined;
    const date = new Date(Number(y), Number(mo) - 1, Number(d), hasTime ? Number(h) : 0, hasTime ? Number(mi) : 0);
    if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(mo) - 1) return null;
    return { date, hasTime };
  }

  /**
   * Returns fixtures sorted by date (undated lines keep their order, after
   * dated ones). Unless `includePast`, fixtures are dropped 3 hours after
   * kick-off (or at the end of the day when no time is given).
   */
  function parseFixtures(text, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const out = [];
    lines(text).forEach((line, i) => {
      const cols = splitCols(line);
      const when = parseWhen(cols[0]);
      const f = {
        order: i,
        whenText: when ? '' : cols[0],
        date: when ? when.date : null,
        hasTime: when ? when.hasTime : false,
        title: cols[1] || '',
        competition: cols[2] || '',
        venue: cols[3] || '',
      };
      if (!when && cols.length === 1) {
        f.whenText = '';
        f.title = cols[0];
      }
      if (f.date && !opts.includePast) {
        const endsAt = f.hasTime
          ? f.date.getTime() + 3 * 3600 * 1000
          : new Date(f.date.getFullYear(), f.date.getMonth(), f.date.getDate() + 1).getTime();
        if (endsAt < now.getTime()) return;
      }
      out.push(f);
    });
    out.sort((a, b) => {
      if (a.date && b.date) return a.date - b.date;
      if (a.date) return -1;
      if (b.date) return 1;
      return a.order - b.order;
    });
    return out;
  }

  /** "Today 14:00", "Tomorrow", "Sat 9 Nov · 15:00". */
  function formatWhen(f, now) {
    if (!f.date) return f.whenText;
    now = now || new Date();
    const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((day0(f.date) - day0(now)) / 86400000);
    let day;
    if (diffDays === 0) day = 'Today';
    else if (diffDays === 1) day = 'Tomorrow';
    else day = f.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!f.hasTime) return day;
    const time = `${String(f.date.getHours()).padStart(2, '0')}:${String(f.date.getMinutes()).padStart(2, '0')}`;
    return `${day} · ${time}`;
  }

  /** Countdown text for an upcoming fixture: "in 3 days", "in 2h 15m", "Live now". */
  function countdown(f, now) {
    if (!f.date) return '';
    now = now || new Date();
    const ms = f.date.getTime() - now.getTime();
    if (ms <= 0) return f.hasTime ? 'Live now' : 'Today';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `in ${hours}h ${mins % 60}m`;
    const days = Math.ceil(ms / 86400000);
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }

  return { parseMenu, parseFixtures, parseWhen, formatWhen, countdown };
});
