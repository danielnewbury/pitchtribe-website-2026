// Builds the documentation section, dist/docs/, from docs/.
//
//   docs/_layout.html    the page shell (header, sidebar, footer)
//   docs/<slug>.html     one page's content, starting with a JSON front-matter
//                        comment: <!-- {"title": "...", "description": "..."} -->
//   docs/img/            pictures, copied to /docs/img/
//
// The sidebar order is NAV below. Each page is written to dist/docs/<slug>.html,
// which Cloudflare Pages serves at /docs/<slug> (and index.html at /docs/).
// Runs after i18n-build.mjs, so it also appends the docs to dist/sitemap.xml.
// The docs are English only for now; translated pages link here too.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://pitchtribe.media';
const SRC = 'docs';
const OUT = join('dist', 'docs');

// [slug, sidebar label, section]
const NAV = [
  ['index', 'Docs home', 'Start here'],
  ['setup', 'Beginner’s setup guide', 'Start here'],
  ['install-raspberry-pi-os', 'Install on Raspberry Pi OS', 'Start here'],
  ['dashboard', 'Using the dashboard', 'Running your screens'],
  ['more-screens', 'Adding more screens', 'Running your screens'],
  ['guest-wifi', 'Guest Wi-Fi', 'Running your screens'],
  ['updates-backups', 'Updates and backups', 'Looking after it'],
  ['troubleshooting', 'Troubleshooting', 'Looking after it'],
];

const urlFor = (slug) => (slug === 'index' ? '/docs/' : `/docs/${slug}`);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const layout = readFileSync(join(SRC, '_layout.html'), 'utf8');

function sidebar(current) {
  const sections = [...new Set(NAV.map(([, , sec]) => sec))];
  return sections.map((sec) => `<p class="doc-nav-head">${sec}</p>
<ul>
${NAV.filter(([, , s]) => s === sec).map(([slug, label]) =>
    `  <li><a href="${urlFor(slug)}"${slug === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n')}
</ul>`).join('\n');
}

function pager(i) {
  const prev = NAV[i - 1];
  const next = NAV[i + 1];
  const link = (item, dir) => item
    ? `<a class="doc-pager-${dir}" href="${urlFor(item[0])}"><span>${dir === 'prev' ? '← Previous' : 'Next →'}</span>${item[1]}</a>`
    : '<span></span>';
  return `<nav class="doc-pager" aria-label="Previous and next page">${link(prev, 'prev')}${link(next, 'next')}</nav>`;
}

mkdirSync(OUT, { recursive: true });
NAV.forEach(([slug], i) => {
  const raw = readFileSync(join(SRC, `${slug}.html`), 'utf8');
  const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`docs/${slug}.html must start with a <!-- {"title": …, "description": …} --> comment`);
  const meta = JSON.parse(m[1]);
  if (!meta.title || !meta.description) throw new Error(`docs/${slug}.html needs a title and a description`);
  const body = raw.slice(m[0].length);
  const html = layout
    .replaceAll('{{title}}', esc(meta.title))
    .replaceAll('{{description}}', esc(meta.description))
    .replaceAll('{{url}}', `${SITE}${urlFor(slug)}`)
    .replaceAll('{{sidebar}}', sidebar(slug))
    .replace('{{content}}', body)
    .replace('{{pager}}', pager(i));
  if (/\{\{\w+\}\}/.test(html)) throw new Error(`docs/${slug}.html: unfilled placeholder ${html.match(/\{\{\w+\}\}/)[0]}`);
  writeFileSync(join(OUT, `${slug}.html`), html);
});

if (existsSync(join(SRC, 'img'))) cpSync(join(SRC, 'img'), join(OUT, 'img'), { recursive: true });

// Every internal /docs/ link must point at a page that exists.
const known = new Set(NAV.map(([slug]) => urlFor(slug)));
for (const [slug] of NAV) {
  const html = readFileSync(join(OUT, `${slug}.html`), 'utf8');
  for (const [, href] of html.matchAll(/href="(\/docs\/[^"#]*)/g)) {
    if (!known.has(href)) throw new Error(`docs/${slug}.html links to ${href}, which is not a docs page`);
  }
}

const sitemapFile = join('dist', 'sitemap.xml');
if (existsSync(sitemapFile)) {
  const urls = NAV.map(([slug]) => `  <url>
    <loc>${SITE}${urlFor(slug)}</loc>
    <changefreq>monthly</changefreq>
    <priority>${slug === 'index' || slug === 'setup' ? '0.8' : '0.6'}</priority>
  </url>`).join('\n');
  writeFileSync(sitemapFile, readFileSync(sitemapFile, 'utf8').replace('</urlset>', `${urls}\n</urlset>`));
}

console.log(`docs: built ${NAV.length} pages`);
