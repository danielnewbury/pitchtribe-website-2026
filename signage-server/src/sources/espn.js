// ESPN's public scoreboard JSON (the same feed that powers espn.com score pages).
// No API key needed. Covers football/soccer leagues worldwide, NFL, NBA, NHL, MLB, etc.
// Path examples: "soccer/eng.1", "soccer/uefa.champions", "basketball/nba", "hockey/nhl".

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const yyyymm = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** The [from, to] window of matches we want on screen. */
export function scoreboardWindow({ daysBack = 3, daysAhead = 7, now = new Date() } = {}) {
  return { from: addDays(now, -daysBack), to: addDays(now, daysAhead) };
}

/** The `YYYYMM` months the window touches — one request each, usually one, two across a month end.
    ESPN rejects a `dates=YYYYMMDD-YYYYMMDD` range with HTTP 400, but accepts a whole month. */
export function scoreboardMonths(opts = {}) {
  const { from, to } = scoreboardWindow(opts);
  const months = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
  while (cur.getTime() <= last) {
    months.push(yyyymm(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

export function scoreboardUrl(league, month) {
  return `${BASE}/${league.path}/scoreboard?dates=${month}&limit=300`;
}

export async function fetchEspn(league, { fetchImpl = fetch, ...opts } = {}) {
  const at = { ...opts, now: opts.now ?? new Date() }; // one clock reading for both the window and the months
  const { from, to } = scoreboardWindow(at);
  // Any month failing is a league error: the store then keeps the last good data on screen
  // rather than quietly showing half the window.
  const pages = await Promise.all(
    scoreboardMonths(at).map(async (month) => {
      const res = await fetchImpl(scoreboardUrl(league, month), {
        headers: { accept: 'application/json', 'user-agent': 'PitchTribe-Signage/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`ESPN ${league.path}: HTTP ${res.status}`);
      return normalizeEspn(await res.json(), league);
    })
  );

  // A month returns the whole month, so trim it back to the window the config asked for.
  const seen = new Set();
  const events = [];
  for (const page of pages) {
    for (const ev of page.events) {
      if (seen.has(ev.id)) continue;
      const at = ev.start ? Date.parse(ev.start) : NaN;
      if (Number.isFinite(at) && (at < from.getTime() || at > to.getTime())) continue;
      seen.add(ev.id);
      events.push(ev);
    }
  }
  return { key: league.key, name: pages[0]?.name ?? league.name ?? league.key, events };
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
