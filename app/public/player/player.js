/* PitchTribe player.
   Open /player/?screen=<id> on a display (the kiosk does this on boot).
   - Registers itself with the server and plays the screen's playlist.
   - Gets pushed updates over Server-Sent Events; polls every minute as a heartbeat.
   - Evaluates each item's schedule locally, and keeps the last playlist in
     localStorage so it carries on playing if the server is unreachable.
   /player/?preview=<playlistId> previews a playlist (dashboard login needed). */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const stage = $('#stage');
  const root = $('#root');
  const params = new URLSearchParams(location.search);
  const previewId = params.get('preview');
  const SCREEN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, val) => { try { localStorage.setItem(k, val); } catch { /* storage unavailable */ } };

  function resolveScreenId() {
    let id = params.get('screen');
    if (id && SCREEN_ID_RE.test(id)) {
      safeSet('pt_screen', id);
      return id;
    }
    id = safeGet('pt_screen');
    if (!id || !SCREEN_ID_RE.test(id)) {
      id = `screen-${Math.random().toString(36).slice(2, 8)}`;
      safeSet('pt_screen', id);
    }
    return id;
  }

  const screenId = previewId ? null : resolveScreenId();
  const cacheKey = `pt_manifest_${previewId || screenId}`;

  function manifestUrl() {
    if (previewId) return `/api/preview/${encodeURIComponent(previewId)}/manifest`;
    const w = Math.round(window.screen.width * (window.devicePixelRatio || 1));
    const h = Math.round(window.screen.height * (window.devicePixelRatio || 1));
    return `/api/player/${encodeURIComponent(screenId)}/manifest?w=${w}&h=${h}`;
  }

  let manifest = null;
  let current = null; // { item, sig, el }
  let advanceTimer = null;
  let renderToken = 0;

  const signature = (it) =>
    JSON.stringify([it.id, it.type, it.src, it.url, it.content, it.fit, it.muted, it.duration, it.updatedAt, it.data]);
  const playable = () => (manifest ? manifest.items.filter((it) => PTSchedule.isLive(it)) : []);

  // ---------------------------------------------------------------- loading
  let loadTimer = null;
  function scheduleLoad(delay = 250) {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(load, delay);
  }

  async function load() {
    try {
      const res = await fetch(manifestUrl(), { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        showSplash('Preview needs you to be signed in', 'Sign in to the dashboard, then reopen this preview.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const m = await res.json();
      safeSet(cacheKey, JSON.stringify(m));
      apply(m);
    } catch (err) {
      if (manifest) return; // keep playing what we have
      const cached = safeGet(cacheKey);
      if (cached) {
        try {
          apply(JSON.parse(cached));
          return;
        } catch { /* corrupt cache */ }
      }
      showSplash('Connecting…', 'Waiting for the PitchTribe server. This screen will start automatically.');
    }
  }

  function apply(m) {
    manifest = m;
    applyChrome();
    if (!current) return next();
    const still = playable().find((it) => it.id === current.item.id);
    if (!still || signature(still) !== current.sig) next();
  }

  // --------------------------------------------------------------- playback
  function pickNext() {
    const all = manifest ? manifest.items : [];
    const n = all.length;
    if (!n) return null;
    const start = current ? all.findIndex((it) => it.id === current.item.id) : -1;
    const now = new Date();
    for (let k = 1; k <= n; k++) {
      const cand = all[(((start + k) % n) + n) % n];
      if (PTSchedule.isLive(cand, now)) return cand;
    }
    return null;
  }

  function next() {
    clearTimeout(advanceTimer);
    const item = pickNext();
    if (!item) {
      clearStage();
      current = null;
      showIdle();
      advanceTimer = setTimeout(next, 15000);
      return;
    }
    hideSplash();
    const sig = signature(item);
    // A lone web page or image keeps running instead of reloading itself.
    if (current && current.item.id === item.id && current.sig === sig && (item.type === 'url' || item.type === 'image')) {
      advanceTimer = setTimeout(next, Math.max(item.duration, 5) * 1000);
      return;
    }
    show(item, sig);
  }

  async function show(item, sig) {
    const token = ++renderToken;
    let slide;
    try {
      slide = render(item);
    } catch (err) {
      console.error('Render failed', item, err);
      advanceTimer = setTimeout(next, 2000);
      return;
    }
    stage.appendChild(slide.el);
    await slide.ready;
    if (token !== renderToken) {
      slide.el.remove();
      return;
    }
    fitText(slide.el);
    // Force a layout so the fade-in transition runs.
    void slide.el.offsetWidth;
    slide.el.classList.add('in');
    const previous = [...stage.children].filter((c) => c !== slide.el);
    setTimeout(() => {
      for (const p of previous) {
        p.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
        p.remove();
      }
    }, 900);
    current = { item, sig, el: slide.el };

    if (item.type === 'video') {
      const video = slide.el.querySelector('video');
      const playing = video.play();
      if (playing) playing.catch(() => { video.muted = true; video.play().catch(() => {}); });
      if (!item.duration) {
        video.addEventListener('ended', () => token === renderToken && next(), { once: true });
        advanceTimer = setTimeout(next, 3 * 3600 * 1000); // safety net
        return;
      }
    }
    advanceTimer = setTimeout(next, Math.max(item.duration || 10, 1) * 1000);
  }

  function clearStage() {
    renderToken++;
    stage.replaceChildren();
  }

  // ------------------------------------------------------------- rendering
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const withTimeout = (promise, ms) =>
    Promise.race([promise, new Promise((r) => setTimeout(r, ms))]).catch(() => {});

  function render(item) {
    const slide = el('div', 'slide');
    let ready = Promise.resolve();
    const c = item.content || {};
    const club = manifest.clubName;

    switch (item.type) {
      case 'image': {
        slide.classList.add('media');
        const img = el('img', `fit-${item.fit || 'contain'}`);
        img.alt = '';
        img.src = item.src;
        ready = withTimeout(img.decode(), 8000);
        slide.append(img);
        break;
      }
      case 'video': {
        slide.classList.add('media');
        const video = el('video', `fit-${item.fit || 'contain'}`);
        video.src = item.src;
        video.muted = item.muted !== false;
        video.playsInline = true;
        video.preload = 'auto';
        video.loop = Boolean(item.duration); // fixed-length slot: loop short clips
        video.addEventListener('error', () => {
          console.warn('Video failed', item.src);
          if (current && current.item.id === item.id) {
            clearTimeout(advanceTimer);
            advanceTimer = setTimeout(next, 1500);
          }
        });
        ready = withTimeout(new Promise((r) => video.addEventListener('canplay', r, { once: true })), 8000);
        slide.append(video);
        break;
      }
      case 'url': {
        slide.classList.add('web');
        const frame = el('iframe');
        frame.src = item.url;
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        frame.setAttribute('allow', 'autoplay; fullscreen');
        frame.referrerPolicy = 'no-referrer';
        ready = withTimeout(new Promise((r) => frame.addEventListener('load', r, { once: true })), 6000);
        slide.append(frame);
        break;
      }
      case 'notice': {
        const panel = el('section', `panel notice style-${c.style || 'default'}`);
        const fit = el('div', 'fit');
        fit.append(el('div', 'kicker', club));
        if (c.title) fit.append(el('h1', '', c.title));
        const body = el('div', 'body');
        for (const para of String(c.body || '').split(/\n+/).filter(Boolean)) body.append(el('p', '', para));
        fit.append(body);
        panel.append(fit);
        slide.append(panel);
        break;
      }
      case 'menu': {
        const panel = el('section', 'panel menu');
        panel.append(el('div', 'kicker', club), el('h1', '', c.title || item.name));
        const fit = el('div', 'fit');
        for (const section of PTFormats.parseMenu(c.text)) {
          const sec = el('div', 'menu-section');
          if (section.title) sec.append(el('h2', '', section.title));
          for (const it of section.items) {
            const row = el('div', `menu-item${it.soldOut ? ' sold-out' : ''}`);
            const name = el('div', 'name', it.name);
            if (it.soldOut) name.append(el('span', 'badge', 'Sold out'));
            if (it.notes) name.append(el('span', 'notes', it.notes));
            row.append(name, el('div', 'dots'), el('div', 'price', it.price));
            sec.append(row);
          }
          fit.append(sec);
        }
        panel.append(fit);
        slide.append(panel);
        break;
      }
      case 'fixtures': {
        const panel = el('section', 'panel fixtures');
        panel.append(el('div', 'kicker', club), el('h1', '', c.title || item.name));
        const fit = el('div', 'fit');
        const now = new Date();
        const list = PTFormats.parseFixtures(c.text, { now }).slice(0, c.limit || 8);
        if (!list.length) fit.append(el('p', 'empty-note', 'No upcoming fixtures — check back soon.'));
        const ul = el('ul', 'fixtures-list');
        let highlighted = false;
        for (const f of list) {
          const li = el('li', 'fixture');
          const when = el('div', 'when', PTFormats.formatWhen(f, now));
          if (f.date && !highlighted) {
            highlighted = true;
            li.classList.add('next');
            when.append(el('span', 'countdown', PTFormats.countdown(f, now)));
          }
          li.append(when, el('div', 'title', f.title), el('div', 'meta', [f.competition, f.venue].filter(Boolean).join(' · ')));
          ul.append(li);
        }
        if (list.length) fit.append(ul);
        panel.append(fit);
        slide.append(panel);
        break;
      }
      case 'scores': {
        const panel = el('section', 'panel scores');
        panel.append(el('div', 'kicker', club), el('h1', '', c.title || item.name));
        const fit = el('div', 'fit');
        if (!item.data) {
          fit.append(el('p', 'empty-note', 'Sports feeds are switched off — turn them on in Settings.'));
        } else if (!item.data.length) {
          fit.append(el('p', 'empty-note', c.show === 'live' ? 'No matches in progress right now.' : 'No matches to show right now.'));
        } else {
          let league = null;
          let list = null;
          for (const e of item.data) {
            if (e.leagueName !== league) {
              league = e.leagueName;
              fit.append(el('h2', 'league', league));
              list = el('ul', 'score-list');
              fit.append(list);
            }
            list.append(scoreRow(e));
          }
        }
        panel.append(fit);
        slide.append(panel);
        break;
      }
      default:
        throw new Error(`Unknown type ${item.type}`);
    }
    return { el: slide, ready };
  }

  function teamCell(t, side) {
    const cell = el('span', `team ${side}`);
    const name = el('span', 'team-name', t.name);
    if (t.logo && /^https:\/\//.test(t.logo)) {
      const img = el('img', 'logo');
      img.alt = '';
      img.src = t.logo;
      img.addEventListener('error', () => img.remove());
      if (side === 'home') cell.append(name, img);
      else cell.append(img, name);
    } else {
      cell.append(name);
    }
    return cell;
  }

  function scoreRow(e) {
    const li = el('li', `score-row ${e.status}`);
    const start = e.start ? new Date(e.start) : null;
    const hhmm = start ? start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    let mid;
    if (e.status === 'scheduled') mid = el('span', 'mid vs', hhmm || 'v');
    else if (e.status === 'postponed') mid = el('span', 'mid vs', 'P–P');
    else mid = el('span', 'mid score', `${e.home.score ?? '-'} – ${e.away.score ?? '-'}`);
    let badge;
    if (e.status === 'live') badge = el('span', 'tag live', e.statusText || 'LIVE');
    else if (e.status === 'final') badge = el('span', 'tag final', e.statusText || 'FT');
    else if (e.status === 'postponed') badge = el('span', 'tag pp', 'Postponed');
    else badge = el('span', 'tag when', start ? PTFormats.formatWhen({ date: start, hasTime: false }) : '');
    li.append(badge, teamCell(e.home, 'home'), mid, teamCell(e.away, 'away'));
    return li;
  }

  /** Shrink a text slide's font until its content fits on screen. */
  function fitText(slide) {
    const panel = slide.querySelector('.panel');
    if (!panel) return;
    const fit = panel.querySelector('.fit');
    panel.style.fontSize = '';
    let size = parseFloat(getComputedStyle(panel).fontSize);
    const min = size * 0.4;
    const overflows = () =>
      panel.scrollHeight > panel.clientHeight + 1 ||
      (fit && (fit.scrollHeight > fit.clientHeight + 1 || fit.scrollWidth > fit.clientWidth + 1));
    while (overflows() && size > min) {
      size *= 0.93;
      panel.style.fontSize = `${size}px`;
    }
  }

  // ---------------------------------------------------------------- chrome
  let tickerText = null;
  function applyChrome() {
    const rotation = (manifest.screen && manifest.screen.rotation) || 0;
    root.className = rotation ? `rotate-${rotation}` : '';
    document.title = manifest.screen ? `${manifest.screen.name} · PitchTribe` : 'Preview · PitchTribe';

    const pl = manifest.playlist || {};
    $('#clock').hidden = !pl.showClock;
    updateClock();

    const text = (pl.ticker || '').trim();
    if (text === tickerText) return;
    tickerText = text;
    const ticker = $('#ticker');
    const track = ticker.querySelector('.ticker-track');
    track.replaceChildren();
    if (!text) {
      ticker.hidden = true;
      document.documentElement.style.setProperty('--ticker-h', '0px');
      return;
    }
    ticker.hidden = false;
    document.documentElement.style.setProperty('--ticker-h', '6.5vmin');
    for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) track.append(el('span', '', line));
    requestAnimationFrame(() => {
      const pxPerSec = Math.max(root.clientHeight, 300) * 0.14;
      track.style.animationDuration = `${Math.max(track.scrollWidth / pxPerSec, 8)}s`;
    });
  }

  function updateClock() {
    const clock = $('#clock');
    if (clock.hidden) return;
    clock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function showSplash(msg, meta) {
    const splash = $('#splash');
    splash.querySelector('.splash-title').textContent = (manifest && manifest.clubName) || 'PitchTribe';
    splash.querySelector('.splash-msg').textContent = msg;
    splash.querySelector('.splash-meta').textContent = meta || '';
    splash.hidden = false;
  }
  const hideSplash = () => { $('#splash').hidden = true; };

  function showIdle() {
    const dash = (manifest.dashboardUrls && manifest.dashboardUrls[0]) || `${location.origin}/`;
    if (previewId) {
      showSplash('Nothing in this playlist is scheduled to play right now.', '');
    } else if (!manifest.playlist) {
      showSplash('This screen has no playlist yet.', `Screen “${screenId}” · choose a playlist at ${dash}`);
    } else {
      showSplash('Nothing scheduled right now.', `Screen “${manifest.screen.name}” · manage at ${dash}`);
    }
  }

  let identifyTimer = null;
  function identify(data) {
    const box = $('#identify');
    box.replaceChildren(el('div', '', data.name || screenId), el('small', '', `screen id: ${data.id || screenId}`));
    box.hidden = false;
    clearTimeout(identifyTimer);
    identifyTimer = setTimeout(() => { box.hidden = true; }, 10000);
  }

  // ------------------------------------------------------------------ boot
  setInterval(updateClock, 1000);
  // Re-check schedules: drop the current slide if its time window just ended.
  setInterval(() => {
    if (!manifest) return;
    if (current && !PTSchedule.isLive(current.item)) next();
  }, 30_000);

  if (previewId) {
    setInterval(load, 10_000);
  } else {
    setInterval(load, 60_000); // heartbeat + fallback if push is unavailable
    if ('EventSource' in window) {
      const es = new EventSource(`/api/player/${encodeURIComponent(screenId)}/events`);
      es.addEventListener('open', () => scheduleLoad());
      es.addEventListener('changed', () => scheduleLoad());
      es.addEventListener('identify', (e) => identify(JSON.parse(e.data || '{}')));
      es.addEventListener('reload', () => location.reload());
    }
  }
  load();
})();
