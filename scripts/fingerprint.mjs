// Content-hashes the built assets and rewrites the HTML references to match.
//
// _headers caches /assets/* for a week. With stable filenames that means a
// visitor can hold last week's stylesheet alongside today's HTML (HTML is
// must-revalidate, assets are not), so any CSS change renders half-applied
// until the asset cache expires. Hashing the filename makes each build a new
// URL, so a long immutable cache is safe and changes land immediately.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const ASSETS = ['assets/app.css', 'assets/main.js', 'assets/favicon.svg'];

const rewrites = ASSETS.map((asset) => {
  const bytes = readFileSync(join(DIST, asset));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const dot = asset.lastIndexOf('.');
  const hashed = `${asset.slice(0, dot)}.${hash}${asset.slice(dot)}`;
  renameSync(join(DIST, asset), join(DIST, hashed));
  return { from: `/${asset}`, to: `/${hashed}` };
});

const pages = readdirSync(DIST).filter((f) => f.endsWith('.html'));
if (pages.length === 0) throw new Error('no HTML in dist/ to rewrite');

for (const page of pages) {
  const path = join(DIST, page);
  let html = readFileSync(path, 'utf8');
  for (const { from, to } of rewrites) html = html.replaceAll(from, to);
  writeFileSync(path, html);
}

// Any surviving unhashed reference means an asset was missed and would 404.
for (const page of pages) {
  const html = readFileSync(join(DIST, page), 'utf8');
  for (const { from } of rewrites) {
    if (html.includes(from)) throw new Error(`${page} still references ${from}`);
  }
}

for (const { from, to } of rewrites) console.log(`fingerprint ${from} -> ${to}`);
console.log(`rewrote ${pages.length} page(s): ${pages.join(', ')}`);
