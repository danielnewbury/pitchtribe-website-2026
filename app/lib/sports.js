'use strict';
/* Embeds the sports engine (../signage-server, an ES module) in the app.
   - Leagues, timezone and on/off are set from the dashboard (settings.sports).
   - Its routes (display page, JSON API, SSE, MCP) are served at /feeds.
   - "Live scores" slides get their data from here, inlined in screen manifests;
     when scores change, screens are told to refetch. */
const { EventEmitter } = require('node:events');

const LEAGUE_KEY_RE = /^[\w.-]{1,40}$/;
const SHOW = {
  all: undefined,
  live: 'live',
  results: 'final',
  fixtures: 'scheduled,postponed',
};

class Sports extends EventEmitter {
  constructor({ fetchImpl, log = console.error, publicUrl = '' } = {}) {
    super();
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.publicUrl = publicUrl;
    this.service = null;
    this.lib = null;
    this.catalog = [];
    this.pending = null; // settings waiting for the module to load
    this.ready = import('pitchtribe-signage-server').then((lib) => {
      this.lib = lib;
      // Dashboard offers the feed-backed leagues; club fixtures are a "Fixtures" slide in the app.
      this.catalog = lib
        .exampleConfig()
        .leagues.filter((l) => (l.source ?? 'espn') === 'espn')
        .map(({ key, name, path, source }) => ({ key, name, path, source: source ?? 'espn' }));
      if (this.pending) this.configure(...this.pending);
    });
    this.ready.catch((err) => log('[sports] failed to load the sports engine:', err));
  }

  /** (Re)start the engine for these settings; stops it when disabled. */
  configure(settings, { title = 'Sports' } = {}) {
    if (!this.lib) {
      this.pending = [settings, { title }];
      return;
    }
    this.pending = null;
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
    const s = settings || {};
    const leagues = this.catalog.filter((l) => (s.leagues || []).includes(l.key));
    if (!s.enabled || !leagues.length) {
      this.emit('update');
      return;
    }
    const config = this.lib.resolveConfig({
      title,
      timezone: s.timezone || 'Europe/London',
      leagues,
      pushTargets: [],
      apiToken: '', // the app checks credentials before requests reach the engine
      publicUrl: this.publicUrl,
    });
    const opts = { config, log: (...a) => this.log('[sports]', ...a) };
    if (this.fetchImpl) opts.fetchImpl = this.fetchImpl;
    this.service = this.lib.createSportsService(opts);
    this.service.store.on('update', () => this.emit('update'));
    this.service.start();
  }

  get enabled() {
    return Boolean(this.service);
  }

  /** Express-style handler for /feeds/*. */
  handle(req, res) {
    if (!this.service) {
      res.status(404).json({ error: 'Sports feeds are switched off. Turn them on in the dashboard under Settings.' });
      return;
    }
    this.service.handler(req, res);
  }

  /** Events for a "Live scores" slide, trimmed to what the player draws. */
  events({ leagues = [], show = 'all', limit = 10 } = {}) {
    if (!this.service) return null;
    const list = this.service.store.query({
      league: leagues.length ? leagues.join(',') : undefined,
      status: SHOW[show],
      limit,
    });
    return list.map((e) => ({
      id: e.id,
      league: e.league,
      leagueName: e.leagueName,
      start: e.start,
      status: e.status,
      statusText: e.statusText,
      home: { name: e.home.short || e.home.name, logo: e.home.logo, score: e.home.score },
      away: { name: e.away.short || e.away.name, logo: e.away.logo, score: e.away.score },
    }));
  }

  /** Per-league status for the dashboard. */
  status() {
    if (!this.service) return [];
    return this.service.store.snapshot().leagues.map((l) => ({
      key: l.key,
      name: l.name,
      events: l.events.length,
      live: l.events.filter((e) => e.status === 'live').length,
      fetchedAt: l.fetchedAt,
      error: l.error,
    }));
  }

  refresh() {
    if (!this.service) return Promise.resolve(null);
    return this.service.store.refresh();
  }

  close() {
    if (this.service) this.service.stop();
    this.service = null;
  }
}

module.exports = { Sports, LEAGUE_KEY_RE, SHOW_OPTIONS: Object.keys(SHOW) };
