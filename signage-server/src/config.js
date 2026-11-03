import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  port: 8090,
  host: '0.0.0.0',
  publicUrl: '',
  apiToken: '',
  title: 'Sports Centre',
  timezone: 'Europe/London',
  daysBack: 3,
  daysAhead: 7,
  refreshMinutes: 10,
  liveRefreshSeconds: 60,
  rotateSeconds: 15,
  rowsPerPage: 10,
  leagues: [],
  pushTargets: [],
};

/**
 * Load config from $SIGNAGE_CONFIG, ./config.json, or config.example.json (in that order).
 * PORT, HOST, PUBLIC_URL and API_TOKEN environment variables override the file.
 */
export function loadConfig(env = process.env) {
  const candidates = [env.SIGNAGE_CONFIG, resolve(ROOT, 'config.json'), resolve(ROOT, 'config.example.json')]
    .filter(Boolean);
  const file = candidates.find((p) => existsSync(p));
  const fromFile = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const config = { ...DEFAULTS, ...fromFile, configFile: file ?? null };

  if (env.PORT) config.port = Number(env.PORT);
  if (env.HOST) config.host = env.HOST;
  if (env.PUBLIC_URL) config.publicUrl = env.PUBLIC_URL;
  if (env.API_TOKEN) config.apiToken = env.API_TOKEN;
  if (!config.publicUrl) config.publicUrl = `http://localhost:${config.port}`;
  config.publicUrl = config.publicUrl.replace(/\/+$/, '');

  // Resolve relative paths (manual sources) against the server root.
  config.leagues = config.leagues.map((l) => (l.file ? { ...l, file: resolve(ROOT, l.file) } : l));
  config.pushTargets = config.pushTargets.filter((t) => t.enabled !== false);
  return config;
}
