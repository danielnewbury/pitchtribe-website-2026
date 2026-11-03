#!/usr/bin/env node
'use strict';
/* Guest Wi-Fi captive portal (systemd: pitchtribe-portal.service).
   Listens on the access-point address only; nftables redirects guests' web
   traffic here until they accept the terms. */
const { createPortalApp } = require('./lib/portal');

const host = process.env.PORTAL_HOST || '10.42.0.1';
const port = Number(process.env.PORTAL_PORT || 8082);
const dataDir = process.env.DATA_DIR || require('node:path').join(__dirname, 'data');
const { app, close } = createPortalApp({ dataDir, portalHost: host });

const server = app.listen(port, process.env.PORTAL_LISTEN || host, () => {
  console.log(`PitchTribe guest Wi-Fi portal on http://${host}:${port} (data: ${dataDir})`);
});
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
