// Renders the snapshot as a full-screen, auto-rotating "pamphlet" for signage screens.
// Each league becomes one or more pages; pages rotate every rotateSeconds. The page listens
// on /api/stream (Server-Sent Events) and reloads itself the moment scores change.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(iso, tz) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz,
  }).format(d);
}

function logo(t) {
  return t.logo
    ? `<img class="logo" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
}

function row(e, tz) {
  const score = e.status === 'scheduled' || e.status === 'postponed'
    ? `<span class="vs">${esc(e.status === 'postponed' ? 'P-P' : fmtTime(e.start, tz).split(', ').pop())}</span>`
    : `<span class="score">${esc(e.home.score ?? '-')}<i>–</i>${esc(e.away.score ?? '-')}</span>`;
  const badge = {
    live: `<span class="badge live">● ${esc(e.statusText || 'LIVE')}</span>`,
    final: `<span class="badge final">${esc(e.statusText || 'FT')}</span>`,
    postponed: '<span class="badge pp">Postponed</span>',
    scheduled: `<span class="badge when">${esc(fmtTime(e.start, tz).split(', ')[0])}</span>`,
  }[e.status];
  return `<li class="ev ${e.status}">
    <span class="team home">${esc(e.home.short)}${logo(e.home)}</span>
    ${score}
    <span class="team away">${logo(e.away)}${esc(e.away.short)}</span>
    ${badge}
  </li>`;
}

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * @param snapshot   Store.snapshot()
 * @param opts       { only?: string[], title, timezone, rotateSeconds, rowsPerPage, theme, live }
 */
export function renderDisplay(snapshot, opts = {}) {
  const tz = opts.timezone ?? 'Europe/London';
  const rows = Math.max(1, Number(opts.rowsPerPage) || 10);
  const rotate = Math.max(3, Number(opts.rotateSeconds) || 15);
  const title = opts.title ?? snapshot.title ?? 'Sports';
  const theme = opts.theme === 'light' ? 'light' : 'dark';

  const leagues = snapshot.leagues.filter((l) => !opts.only?.length || opts.only.includes(l.key));
  const pages = leagues.flatMap((l) => {
    if (!l.events.length) return [];
    const parts = chunk(l.events, rows);
    return parts.map((events, i) => `<section class="page" data-league="${esc(l.key)}">
      <h2>${esc(l.name)}${parts.length > 1 ? ` <small>${i + 1}/${parts.length}</small>` : ''}</h2>
      <ul>${events.map((e) => row(e, tz)).join('')}</ul>
    </section>`);
  });
  if (!pages.length) {
    pages.push('<section class="page"><h2>No fixtures right now</h2><p class="empty">Check back soon.</p></section>');
  }

  const updated = snapshot.updatedAt ? fmtTime(snapshot.updatedAt, tz) : '—';
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#0b1220;--panel:#121b2e;--fg:#f4f7fb;--muted:#8fa0bd;--accent:#2ce6a8;--live:#ff4d5e;--line:#22304d}
  [data-theme=light]{--bg:#eef2f7;--panel:#fff;--fg:#0b1220;--muted:#56657f;--accent:#0a9f72;--live:#d61f33;--line:#d7deea}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  body{display:flex;flex-direction:column;padding:2.5vh 3vw;gap:2vh}
  header{display:flex;justify-content:space-between;align-items:baseline}
  header h1{font-size:4.2vh;letter-spacing:.02em}
  header h1 b{color:var(--accent)}
  header .meta{color:var(--muted);font-size:2vh;text-align:right}
  main{flex:1;position:relative}
  .page{position:absolute;inset:0;background:var(--panel);border-radius:2vh;padding:3vh 3vw;opacity:0;transition:opacity .8s;display:flex;flex-direction:column}
  .page.on{opacity:1}
  .page h2{font-size:4vh;margin-bottom:2vh;color:var(--accent)}
  .page h2 small{color:var(--muted);font-size:2.4vh;font-weight:500}
  ul{list-style:none;display:flex;flex-direction:column;flex:1;justify-content:space-evenly}
  .ev{display:grid;grid-template-columns:1fr auto 1fr 16vw;align-items:center;gap:2vw;font-size:3.3vh;padding:.6vh 0;border-bottom:1px solid var(--line)}
  .ev:last-child{border-bottom:0}
  .team{display:flex;align-items:center;gap:1vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .home{justify-content:flex-end}
  .logo{height:4vh;width:4vh;object-fit:contain}
  .score{font-weight:800;font-variant-numeric:tabular-nums;min-width:9vw;text-align:center}
  .score i{font-style:normal;color:var(--muted);margin:0 .6vw}
  .vs{color:var(--muted);min-width:9vw;text-align:center;font-variant-numeric:tabular-nums}
  .badge{justify-self:end;font-size:2.3vh;padding:.5vh 1vw;border-radius:99px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
  .badge.live{color:#fff;background:var(--live);border-color:var(--live);animation:pulse 2s infinite}
  .badge.final{color:var(--fg)}
  .ev.live .score{color:var(--live)}
  .empty{color:var(--muted);font-size:3vh}
  footer{display:flex;gap:.8vw;justify-content:center}
  footer i{width:1.2vh;height:1.2vh;border-radius:50%;background:var(--line)}
  footer i.on{background:var(--accent)}
  @keyframes pulse{50%{opacity:.6}}
</style>
</head>
<body>
<header><h1><b>●</b> ${esc(title)}</h1><div class="meta"><div id="clock"></div>Updated ${esc(updated)}</div></header>
<main>${pages.join('\n')}</main>
<footer>${pages.map(() => '<i></i>').join('')}</footer>
<script>
(() => {
  const pages = [...document.querySelectorAll('.page')];
  const dots = [...document.querySelectorAll('footer i')];
  let i = 0;
  try { i = Number(sessionStorage.getItem('pt-page')) % pages.length || 0; } catch {}
  const show = () => {
    pages.forEach((p, n) => p.classList.toggle('on', n === i));
    dots.forEach((d, n) => d.classList.toggle('on', n === i));
    try { sessionStorage.setItem('pt-page', i); } catch {}
  };
  show();
  if (pages.length > 1) setInterval(() => { i = (i + 1) % pages.length; show(); }, ${rotate * 1000});
  const clock = document.getElementById('clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ${JSON.stringify(tz)} }); };
  tick(); setInterval(tick, 10000);
  ${opts.live === false ? '' : `if ('EventSource' in window) {
    const es = new EventSource('/api/stream');
    es.addEventListener('update', () => location.reload());
  }
  // Safety net if the stream drops: full reload every 10 minutes.
  setTimeout(() => location.reload(), 600000);`}
})();
</script>
</body>
</html>`;
}
