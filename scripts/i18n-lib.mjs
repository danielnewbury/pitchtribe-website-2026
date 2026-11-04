// Shared helpers for the website translations.
//
// The English pages in html/ stay the single source of truth. Translatable text
// is every visible text run plus a few attributes (alt, aria-label, title,
// placeholder, meta descriptions). Translations live in i18n/<lang>.json as
// { "English text": "Translated text" }; anything missing falls back to English.

export const LANGS = [
  { code: 'fr', name: 'Français', locale: 'fr_FR', html: 'fr' },
  { code: 'es', name: 'Español', locale: 'es_ES', html: 'es' },
  { code: 'de', name: 'Deutsch', locale: 'de_DE', html: 'de' },
  { code: 'it', name: 'Italiano', locale: 'it_IT', html: 'it' },
  { code: 'pt', name: 'Português', locale: 'pt_PT', html: 'pt-PT' },
  { code: 'pl', name: 'Polski', locale: 'pl_PL', html: 'pl' },
  { code: 'ru', name: 'Русский', locale: 'ru_RU', html: 'ru' },
  { code: 'zh', name: '中文', locale: 'zh_CN', html: 'zh-Hans' },
  { code: 'ja', name: '日本語', locale: 'ja_JP', html: 'ja' },
];
export const PAGES = ['index.html', 'buy.html'];

const ATTRS = ['alt', 'aria-label', 'title', 'placeholder'];
const META = ['description', 'og:title', 'og:description'];

/** Collapse whitespace the way the browser renders it. */
export const norm = (s) => s.replace(/\s+/g, ' ').trim();
// Worth translating: has a letter and isn't code, a price, a URL or a command.
const translatable = (s) => /\p{L}/u.test(s) && !/^(https?:|curl |sudo |\/|[#.]?[a-z0-9-]+\.(html|svg|css|js)$)/i.test(s);

/**
 * Split HTML into segments; `visit(text, kind)` returns the replacement for each
 * translatable string (kind: "text" | "attr"). Script/style/code/pre are skipped.
 */
export function transform(html, visit) {
  const out = [];
  const re = /<(script|style|code|pre)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/gi;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok[0] !== '<') {
      const t = norm(tok);
      if (t && translatable(t)) {
        const lead = tok.match(/^\s*/)[0];
        const trail = tok.match(/\s*$/)[0];
        out.push(lead + visit(t, 'text') + trail);
      } else out.push(tok);
      continue;
    }
    if (/^<(script|style|code|pre)\b/i.test(tok) || tok.startsWith('<!--')) { out.push(tok); continue; }
    let tag = tok;
    for (const a of ATTRS) {
      tag = tag.replace(new RegExp(`(\\s${a}=")([^"]*)(")`, 'g'), (all, p, v, q) => (translatable(norm(v)) ? p + visit(norm(v), 'attr') + q : all));
    }
    if (/^<title>/i.test(tag)) { out.push(tag); continue; }
    if (/^<meta\b/i.test(tag)) {
      const name = (tag.match(/\s(?:name|property)="([^"]+)"/) || [])[1];
      if (META.includes(name)) tag = tag.replace(/(\scontent=")([^"]*)(")/, (all, p, v, q) => p + visit(norm(v), 'attr') + q);
    }
    out.push(tag);
  }
  return out.join('');
}

/** All translatable strings in a page, in order, de-duplicated. */
export function extract(html) {
  const seen = new Set();
  transform(html, (t) => { seen.add(t); return t; });
  return [...seen];
}
