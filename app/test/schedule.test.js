'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { status, describe } = require('../public/shared/schedule');
const { parseMenu, parseFixtures, countdown } = require('../public/shared/formats');

// Tuesday 4 Nov 2026, 13:30 local time.
const tue1330 = new Date(2026, 10, 4, 13, 30);
const item = (schedule, enabled = true) => ({ enabled, schedule });

test('always-on and disabled items', () => {
  assert.equal(status(item({}), tue1330), 'live');
  assert.equal(status(item({}, false), tue1330), 'disabled');
});

test('date range is inclusive', () => {
  assert.equal(status(item({ startDate: '2026-11-04' }), tue1330), 'live');
  assert.equal(status(item({ startDate: '2026-11-05' }), tue1330), 'scheduled');
  assert.equal(status(item({ endDate: '2026-11-04' }), tue1330), 'live');
  assert.equal(status(item({ endDate: '2026-11-03' }), tue1330), 'expired');
});

test('days of week', () => {
  assert.equal(status(item({ days: [1, 2, 3, 4, 5] }), tue1330), 'live');
  assert.equal(status(item({ days: [0, 6] }), tue1330), 'off-hours');
});

test('daily time window', () => {
  assert.equal(status(item({ startTime: '12:00', endTime: '14:00' }), tue1330), 'live');
  assert.equal(status(item({ startTime: '14:00', endTime: '16:00' }), tue1330), 'off-hours');
  assert.equal(status(item({ startTime: '13:30' }), tue1330), 'live');
  assert.equal(status(item({ endTime: '13:30' }), tue1330), 'off-hours');
});

test('overnight window counts the small hours as the previous day', () => {
  const s = { startTime: '18:00', endTime: '02:00', days: [5] }; // Friday nights
  assert.equal(status(item(s), new Date(2026, 10, 6, 23, 0)), 'live'); // Fri 23:00
  assert.equal(status(item(s), new Date(2026, 10, 7, 1, 30)), 'live'); // Sat 01:30
  assert.equal(status(item(s), new Date(2026, 10, 7, 2, 0)), 'off-hours'); // Sat 02:00
  assert.equal(status(item(s), new Date(2026, 10, 7, 23, 0)), 'off-hours'); // Sat 23:00
  assert.equal(status(item({ startTime: '17:00', endTime: '00:00' }), new Date(2026, 10, 4, 23, 59)), 'live');
  assert.equal(status(item({ startTime: '17:00', endTime: '00:00' }), new Date(2026, 10, 4, 9, 0)), 'off-hours');
});

test('describe()', () => {
  assert.equal(describe({}), 'Always');
  assert.equal(describe({ days: [1, 2, 3, 4, 5], startTime: '12:00', endTime: '14:00' }), 'Weekdays · 12:00–14:00');
  assert.equal(describe({ endDate: '2026-12-01' }), 'until 2026-12-01');
});

test('parseMenu: sections, notes and sold-out', () => {
  const menu = parseMenu('# Draught\nLager | £4.50\nStout | £4.70 | | sold out\n\n# Food\nChips\t£3.00\tV, VG');
  assert.equal(menu.length, 2);
  assert.deepEqual(menu[0].items[1], { name: 'Stout', price: '£4.70', notes: '', soldOut: true });
  assert.deepEqual(menu[1].items[0], { name: 'Chips', price: '£3.00', notes: 'V, VG', soldOut: false });
});

test('parseFixtures: sorts, hides past, accepts UK dates and undated lines', () => {
  const now = new Date(2026, 10, 4, 12, 0);
  const text = [
    '16/11/2026 15:00 | Away game | League | Away',
    '2026-11-09 14:00 | Home game | League | Home',
    '2026-11-04 08:00 | Finished this morning',
    '2026-11-04 10:00 | Kicked off two hours ago',
    'Tuesday 19:30 | Training',
  ].join('\n');
  const list = parseFixtures(text, { now });
  assert.deepEqual(list.map((f) => f.title), ['Kicked off two hours ago', 'Home game', 'Away game', 'Training']);
  assert.equal(list[3].whenText, 'Tuesday 19:30');
  assert.equal(parseFixtures(text, { now, includePast: true }).length, 5);
  assert.equal(countdown(list[1], now), 'in 6 days');
});
