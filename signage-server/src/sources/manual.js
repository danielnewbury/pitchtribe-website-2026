// Club's own fixtures from a local JSON file — for grassroots teams no public feed covers.
// Edit the file and the next refresh picks it up.
import { readFile } from 'node:fs/promises';

const STATUSES = new Set(['scheduled', 'live', 'final', 'postponed']);

const side = (name, score) => ({
  name: String(name ?? 'TBC'),
  short: String(name ?? 'TBC'),
  abbr: '',
  logo: '',
  score: score === undefined || score === null || score === '' ? null : Number(score),
});

export async function fetchManual(league) {
  const data = JSON.parse(await readFile(league.file, 'utf8'));
  const events = (data.events ?? []).map((ev, i) => {
    const status = STATUSES.has(ev.status) ? ev.status : 'scheduled';
    return {
      id: `${league.key}:${ev.id ?? i}`,
      league: league.key,
      leagueName: league.name ?? league.key,
      start: ev.start ?? null,
      status,
      statusText: ev.statusText ?? (status === 'final' ? 'FT' : status === 'postponed' ? 'Postponed' : ''),
      home: side(ev.home, ev.homeScore),
      away: side(ev.away, ev.awayScore),
      venue: ev.venue ?? '',
    };
  });
  return { key: league.key, name: league.name ?? league.key, events };
}
