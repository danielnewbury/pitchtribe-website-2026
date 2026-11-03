#!/usr/bin/env node
'use strict';
/* PitchTribe signage server: dashboard at /admin, screens at /player. */
const { createApp } = require('./lib/app');
const pkg = require('./package.json');

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const { app, close, dataDir } = createApp({ port });

const server = app.listen(port, host, () => {
  console.log(`PitchTribe ${pkg.version} listening on http://${host}:${port}`);
  console.log(`  Dashboard: http://localhost:${port}/admin/`);
  console.log(`  Screen:    http://localhost:${port}/player/?screen=lounge-tv`);
  console.log(`  Data:      ${dataDir}`);
});
// Long-lived SSE connections and large video uploads must not time out.
server.requestTimeout = 0;
server.headersTimeout = 60_000;

function shutdown() {
  close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
