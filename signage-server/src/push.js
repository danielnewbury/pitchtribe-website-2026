import { renderDisplay } from './render.js';

/**
 * POST the latest data to each configured signage endpoint.
 *
 * Target shape: { name, url, format: "json" | "html", method?, headers?, leagues?: [keys] }
 *  - json: { title, updatedAt, displayUrl, leagues:[...] } — for CMSs/webhooks that build their own layout
 *  - html: the rendered pamphlet page (static, no live stream) — for systems that take an HTML asset
 */
export async function pushToTargets(targets, snapshot, config, { fetchImpl = fetch, log = console.error } = {}) {
  return Promise.all(targets.map(async (t) => {
    const leagues = t.leagues?.length ? snapshot.leagues.filter((l) => t.leagues.includes(l.key)) : snapshot.leagues;
    const scoped = { ...snapshot, leagues };
    const leagueQuery = t.leagues?.length ? `?leagues=${encodeURIComponent(t.leagues.join(','))}` : '';
    const isHtml = t.format === 'html';
    const body = isHtml
      ? renderDisplay(scoped, { ...config, live: false })
      : JSON.stringify({ ...scoped, displayUrl: `${config.publicUrl}/display${leagueQuery}` });
    try {
      const res = await fetchImpl(t.url, {
        method: t.method ?? 'POST',
        headers: { 'content-type': isHtml ? 'text/html; charset=utf-8' : 'application/json', ...t.headers },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { target: t.name ?? t.url, ok: true, status: res.status };
    } catch (err) {
      log(`[push] ${t.name ?? t.url}: ${err.message}`);
      return { target: t.name ?? t.url, ok: false, error: err.message };
    }
  }));
}
