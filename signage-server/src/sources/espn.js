// ESPN's public scoreboard JSON (the same feed that powers espn.com score pages).
// No API key needed. Covers football/soccer leagues worldwide, NFL, NBA, NHL, MLB, etc.
// Path examples: "soccer/eng.1", "soccer/uefa.champions", "basketball/nba", "hockey/nhl".

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

export function scoreboardUrl(league, { daysBack = 3, daysAhead = 7, now = new Date() } = {}) {
  const range = `${ymd(addDays(now, -daysBack))}-${ymd(addDays(now, daysAhead))}`;
  return `${BASE}/${league.path}/scoreboard?dates=${range}&limit=300`;
}

export async function fetchEspn(league, { fetchImpl = fetch, ...opts } = {}) {
  const url = scoreboardUrl(league, opts);
  const res = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'PitchTribe-Signage/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ESPN ${league.path}: HTTP ${res.status}`);
  return normalizeEspn(await res.json(), league);
}

function mapStatus(type = {}) {
  const name = String(type.name ?? '').toUpperCase();
  if (/POSTPONED|CANCEL|SUSPENDED|ABANDONED|DELAYED/.test(name)) return 'postponed';
  if (type.state === 'in') return 'live';
  if (type.state === 'post' || type.completed) return 'final';
  return 'scheduled';
}

function team(c = {}) {
  const t = c.team ?? {};
  return {
    name: t.displayName ?? t.name ?? 'TBC',
    short: t.shortDisplayName ?? t.displayName ?? 'TBC',
    abbr: t.abbreviation ?? '',
    logo: t.logo ?? t.logos?.[0]?.href ?? '',
    score: c.score === undefined || c.score === '' ? null : Number(c.score),
  };
}

export function normalizeEspn(data, league) {
  const leagueName = league.name ?? data?.leagues?.[0]?.name ?? league.key;
  const events = (data?.events ?? []).map((ev) => {
    const comp = ev.competitions?.[0] ?? {};
    const competitors = comp.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
    const away = competitors.find((c) => c.homeAway === 'away') ?? competitors[1];
    const statusType = ev.status?.type ?? comp.status?.type;
    const status = mapStatus(statusType);
    const h = team(home);
    const a = team(away);
    if (status === 'scheduled') h.score = a.score = null; // ESPN reports "0" before kick-off
    return {
      id: `${league.key}:${ev.id}`,
      league: league.key,
      leagueName,
      start: ev.date ?? comp.date ?? null,
      status,
      statusText: statusType?.shortDetail ?? statusType?.detail ?? '',
      home: h,
      away: a,
      venue: comp.venue?.fullName ?? '',
    };
  });
  return { key: league.key, name: leagueName, events };
}
