// Minimal Model Context Protocol server core (JSON-RPC 2.0), shared by the stdio
// transport (src/mcp-stdio.js) and the HTTP endpoint (POST /mcp).

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'pitchtribe-signage', version: '1.0.0' };

const filterProps = {
  league: { type: 'string', description: 'League key(s), comma-separated, e.g. "eng.1" or "eng.1,ucl". See list_leagues.' },
  team: { type: 'string', description: 'Case-insensitive team name filter, e.g. "Arsenal".' },
  limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum events to return (default 50).' },
};

const TOOLS = [
  {
    name: 'list_leagues',
    description: 'List the configured leagues/competitions with event counts and last-fetch status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_fixtures',
    description: 'Upcoming fixtures (not yet started), soonest first.',
    inputSchema: { type: 'object', properties: filterProps },
  },
  {
    name: 'get_live_scores',
    description: 'Matches currently in progress with live scores.',
    inputSchema: { type: 'object', properties: filterProps },
  },
  {
    name: 'get_results',
    description: 'Finished matches with final scores, most recent first.',
    inputSchema: { type: 'object', properties: filterProps },
  },
  {
    name: 'refresh',
    description: 'Re-fetch fixtures/scores from the sources now (all leagues, or one).',
    inputSchema: { type: 'object', properties: { league: { type: 'string', description: 'Optional single league key.' } } },
  },
  {
    name: 'push_to_displays',
    description: 'Push the current fixtures/scores to every configured signage endpoint. Live display pages update automatically.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_widget',
    description: 'Get content for a screen widget: weather, joke, phrase, trivia, quiz, history (this day/week/month), emoji quiz, flags & capitals quiz, or country of the day.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['weather', 'joke', 'phrase', 'trivia', 'quiz', 'history', 'emoji', 'geoquiz', 'country'] },
        topic: { type: 'string', enum: ['sport', 'film-tv', 'music', 'geography', 'culture', 'mixed', 'entertainment', 'all'], description: 'For quiz/trivia: sport, film-tv, music, geography, culture or mixed. For history: sport, entertainment or all.' },
        mode: { type: 'string', enum: ['flags', 'capitals', 'mixed'], description: 'For geoquiz.' },
        scope: { type: 'string', enum: ['day', 'week', 'month'], description: 'For history.' },
        general: { type: 'boolean', description: 'For history: include general (non-sport) events from Wikipedia.' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'get_display_url',
    description: 'Get the URL of the full-screen display page to load on a screen, optionally limited to some leagues.',
    inputSchema: {
      type: 'object',
      properties: {
        leagues: { type: 'string', description: 'Comma-separated league keys.' },
        theme: { type: 'string', enum: ['dark', 'light'] },
      },
    },
  },
];

const line = (e) => {
  const score = e.home.score === null ? 'v' : `${e.home.score}-${e.away.score}`;
  return `[${e.leagueName}] ${e.home.name} ${score} ${e.away.name} — ${e.statusText || e.status} (${e.start ?? 'TBC'})`;
};

/**
 * @param ctx { store, config, push: () => Promise<results> }
 * @returns handle(message) -> response object, or null for notifications
 */
export function createMcpHandler({ store, config, push, widgets }) {
  const ensureData = async () => { if (!store.updatedAt) await store.refresh(); };

  const events = async (status, args) => {
    await ensureData();
    const list = store.query({ ...args, status, limit: args.limit ?? 50 });
    return {
      content: [{ type: 'text', text: list.length ? list.map(line).join('\n') : 'No matching events.' }],
      structuredContent: { events: list },
    };
  };

  const tools = {
    async list_leagues() {
      await ensureData();
      const leagues = store.snapshot().leagues.map((l) => ({
        key: l.key, name: l.name, events: l.events.length,
        live: l.events.filter((e) => e.status === 'live').length,
        fetchedAt: l.fetchedAt, error: l.error,
      }));
      const text = leagues.map((l) => `${l.key}: ${l.name} — ${l.events} events, ${l.live} live${l.error ? ` (error: ${l.error})` : ''}`).join('\n');
      return { content: [{ type: 'text', text: text || 'No leagues configured.' }], structuredContent: { leagues } };
    },
    get_fixtures: (a) => events('scheduled', a),
    get_live_scores: (a) => events('live', a),
    get_results: (a) => events('final', a),
    async refresh(a) {
      const { changed, snapshot } = await store.refresh(a.league || undefined);
      const total = snapshot.leagues.reduce((n, l) => n + l.events.length, 0);
      return { content: [{ type: 'text', text: `Refreshed ${a.league || 'all leagues'}: ${total} events${changed ? ' (changed)' : ' (no change)'}.` }] };
    },
    async push_to_displays() {
      await ensureData();
      const results = await push();
      const text = results.length
        ? results.map((r) => `${r.target}: ${r.ok ? `ok (${r.status})` : `FAILED – ${r.error}`}`).join('\n')
        : 'No push targets configured; screens showing the display page update live on their own.';
      return { content: [{ type: 'text', text }], structuredContent: { results } };
    },
    async get_widget(a) {
      if (!widgets) throw new Error('Widgets are not available');
      const data = await widgets.get(a.kind, a);
      let text;
      if (data.error) text = data.error;
      else if (a.kind === 'weather') text = `${data.place}: ${data.current.temp}${data.units.temp}, ${data.current.text}, wind ${data.current.wind} ${data.units.wind}`;
      else if (a.kind === 'history') text = `${data.label}\n${data.items.map((i) => `${i.year}: ${i.text}`).join('\n')}`;
      else if (a.kind === 'joke') text = data.items.slice(0, 5).map((j) => `${j.q} — ${j.a}`).join('\n');
      else if (a.kind === 'quiz' || a.kind === 'geoquiz') text = data.items.slice(0, 5).map((q) => `${q.flag && a.kind === 'geoquiz' ? `${q.flag} ` : ''}${q.q} (${q.options[q.answer]})`).join('\n');
      else if (a.kind === 'emoji') text = data.items.slice(0, 5).map((e) => `${e.emoji} — ${e.answer}${e.category ? ` (${e.category})` : ''}`).join('\n');
      else if (a.kind === 'country') text = data.items.slice(0, 3).map((c) => `${c.flag} ${c.name}: capital ${c.capital}, ${c.continent}, ${c.currency}`).join('\n');
      else text = (data.items || []).slice(0, 5).join('\n');
      return { content: [{ type: 'text', text }], structuredContent: data };
    },
    async get_display_url(a) {
      const q = new URLSearchParams();
      if (a.leagues) q.set('leagues', a.leagues);
      if (a.theme) q.set('theme', a.theme);
      const url = `${config.publicUrl}/display${q.size ? `?${q}` : ''}`;
      return { content: [{ type: 'text', text: url }], structuredContent: { url } };
    },
  };

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  async function handleOne(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg && 'id' in msg && !('method' in msg) ? null : fail(msg?.id, -32600, 'Invalid Request');
    }
    const isNotification = !('id' in msg);
    const { id, method, params = {} } = msg;
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, …

    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        return ok(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: 'Sports fixtures, live scores and results for club signage screens. Use get_* tools to read data, push_to_displays to update screens.',
        });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const fn = tools[params.name];
        if (!fn) return fail(id, -32602, `Unknown tool: ${params.name}`);
        try {
          return ok(id, await fn(params.arguments ?? {}));
        } catch (err) {
          return ok(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
        }
      }
      default:
        return fail(id, -32601, `Method not found: ${method}`);
    }
  }

  return async function handle(message) {
    if (Array.isArray(message)) {
      const out = (await Promise.all(message.map(handleOne))).filter(Boolean);
      return out.length ? out : null;
    }
    return handleOne(message);
  };
}
