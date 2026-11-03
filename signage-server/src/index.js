#!/usr/bin/env node
// HTTP server: polls the sports sources, serves the display page + JSON API + MCP endpoint,
// and pushes to configured signage endpoints whenever scores change.
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { pushToTargets } from './push.js';
import { createMcpHandler } from './mcp.js';
import { createHttpServer } from './http.js';

const config = loadConfig();
const log = (...a) => console.error(new Date().toISOString(), ...a);
const store = new Store(config, { log });
const push = () => pushToTargets(config.pushTargets, store.snapshot(), config, { log });
const mcp = createMcpHandler({ store, config, push });

store.on('update', async () => {
  log(`[store] data changed (${store.snapshot().leagues.reduce((n, l) => n + l.events.length, 0)} events)`);
  if (config.pushTargets.length) {
    const results = await push();
    log(`[push] ${results.filter((r) => r.ok).length}/${results.length} targets ok`);
  }
});

const server = createHttpServer({ store, config, push, mcp, log });
server.listen(config.port, config.host, () => {
  log(`[http] PitchTribe signage server on http://${config.host}:${config.port}`);
  log(`[http] display: ${config.publicUrl}/display   MCP: ${config.publicUrl}/mcp`);
  log(`[config] ${config.configFile ?? 'defaults'} — ${config.leagues.length} leagues, ${config.pushTargets.length} push targets`);
  if (!config.apiToken) log('[security] apiToken not set: POST /api/* and /mcp are open to anyone on the network');
});
store.start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { store.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
