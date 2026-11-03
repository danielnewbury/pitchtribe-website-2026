#!/usr/bin/env node
// MCP over stdio — for Claude Desktop / Claude Code / any MCP client that launches a local process.
// stdout carries JSON-RPC only (one message per line); all logging goes to stderr.
import { createInterface } from 'node:readline';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { pushToTargets } from './push.js';
import { createMcpHandler } from './mcp.js';

const config = loadConfig();
const log = (...a) => console.error('[pitchtribe-mcp]', ...a);
const store = new Store(config, { log });
const push = () => pushToTargets(config.pushTargets, store.snapshot(), config, { log });
const handle = createMcpHandler({ store, config, push });

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

createInterface({ input: process.stdin, terminal: false }).on('line', async (lineText) => {
  if (!lineText.trim()) return;
  let msg;
  try {
    msg = JSON.parse(lineText);
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const reply = await handle(msg);
  if (reply) write(reply);
}).on('close', () => process.exit(0));

log(`ready — ${config.leagues.length} leagues configured`);
