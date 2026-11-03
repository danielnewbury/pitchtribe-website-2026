'use strict';
/* Embeds the signage-server engine (../signage-server, an ES module) in the app:
   sports fixtures/scores plus widgets (weather, jokes, quiz, history…).
   - Configured from dashboard settings (settings.sports, settings.widgets).
   - Its routes (display page, JSON API, SSE, widgets, MCP) are served at /feeds.
   - "Live scores" and widget slides get their data from here, inlined in screen
     manifests; when that data changes, screens are told to refetch. */
const { EventEmitter } = require('node:events');

const LEAGUE_KEY_RE = /^[\w.-]{1,40}$/;
const SHOW = {
  all: undefined,
  live: 'live',
  results: 'final',
  fixtures: 'scheduled,postponed',
};

class Feeds extends EventEmitter {
  constructor({ fetchImpl, log = console.error, publicUrl = '' } = {}) {
    super();
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.publicUrl = publicUrl;
    this.service = null;
    this.lib = null;
    this.catalog = [];
    this.widgetKinds = [];
    this.sportsOn = false;
    this.pending = null; // settings waiting for the module to load
    this.ready = import('pitchtribe-signage-server').then((lib) => {
      this.lib = lib;
      // Dashboard offers the feed-backed leagues; club fixtures are a "Fixtures" slide in the app.
      this.catalog = lib
        .exampleConfig()
        .leagues.filter((l) => (l.source ?? 'espn') === 'espn')
        .map(({ key, name, path, source }) => ({ key, name, path, source: source ?? 'espn' }));
      this.widgetKinds = lib.WIDGET_KINDS;
      if (this.pending) this.configure(...this.pending);
    });
    this.ready.catch((err) => log('[feeds] failed to load the signage-server engine:', err));
  }

  /** (Re)start the engine for these settings. */
  configure({ sports = {}, widgets = {}, title = 'PitchTribe' } = {}) {
    if (!this.lib) {
      this.pending = [{ sports, widgets, title }];
      return;
    }
    this.pending = null;
    if (this.service) this.service.stop();
    const leagues = sports.enabled ? this.catalog.filter((l) => (sports.leagues || []).includes(l.key)) : [];
    this.sportsOn = leagues.length > 0;
    const config = this.lib.resolveConfig({
      title,
      timezone: sports.timezone || 'Europe/London',
      leagues,
      pushTargets: [],
      apiToken: '', // the app checks credentials before requests reach the engine
      publicUrl: this.publicUrl,
      weather: widgets.weather || null,
      widgets: { wikipedia: widgets.wikipedia !== false, trains: widgets.trains || null, bods: widgets.bods || null },
    });
    const opts = { config, log: (...a) => this.log('[feeds]', ...a) };
    if (this.fetchImpl) opts.fetchImpl = this.fetchImpl;
    this.service = this.lib.createSignageService(opts);
    this.service.store.on('update', () => this.emit('update', 'sports'));
    this.service.widgets.on('update', () => this.emit('update', 'widgets'));
    if (this.sportsOn) this.service.start();
    this.service.widgets.prefetch();
    this.emit('update', 'config');
  }

  /** Express-style handler for /feeds/*. */
  handle(req, res) {
    if (!this.service) {
      res.status(503).json({ error: 'Starting up — try again in a moment' });
      return;
    }
    this.service.handler(req, res);
  }

  // ---------------------------------------------------------------- sports
  /** Events for a "Live scores" slide, trimmed to what the player draws; null when sports are off. */
  events({ leagues = [], show = 'all', limit = 10 } = {}) {
    if (!this.service || !this.sportsOn) return null;
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
    if (!this.service || !this.sportsOn) return [];
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
    if (!this.service || !this.sportsOn) return Promise.resolve(null);
    return this.service.store.refresh();
  }

  // --------------------------------------------------------------- widgets
  /** Widget data right now (cached/bundled); starts any live fetch in the background. */
  widget(kind, opts) {
    if (!this.service) return { error: 'Starting up…' };
    try {
      return this.service.widgets.peek(kind, opts);
    } catch (err) {
      return { error: err.message };
    }
  }

  geocode(q) {
    if (!this.service) return Promise.resolve([]);
    return this.service.widgets.geocode(q);
  }

  close() {
    if (this.service) this.service.stop();
    this.service = null;
  }
}

module.exports = { Feeds, LEAGUE_KEY_RE, SHOW_OPTIONS: Object.keys(SHOW) };
