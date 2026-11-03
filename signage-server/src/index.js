#!/usr/bin/env node
// Standalone HTTP server: polls the sports sources, serves the display page + JSON API + MCP
// endpoint, and pushes to configured signage endpoints whenever scores change.
// (Inside the PitchTribe app the same service is mounted at /sports instead — see app/lib/sports.js.)
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createSportsService } from './service.js';

const config = loadConfig();
const log = (...a) => console.error(new Date().toISOString(), ...a);
const sports = createSportsService({ config, log });

const server = createServer(sports.handler);
server.listen(config.port, config.host, () => {
  log(`[http] PitchTribe signage server on http://${config.host}:${config.port}`);
  log(`[http] display: ${config.publicUrl}/display   MCP: ${config.publicUrl}/mcp`);
  log(`[config] ${config.configFile ?? 'defaults'} — ${config.leagues.length} leagues, ${config.pushTargets.length} push targets`);
  if (!config.apiToken) log('[security] apiToken not set: POST /api/* and /mcp are open to anyone on the network');
});
sports.start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    sports.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
