# PitchTribe — website

[![Deploy to Cloudflare Pages](https://github.com/pitchtribe/pitchtribe-display/actions/workflows/deploy.yml/badge.svg)](https://github.com/pitchtribe/pitchtribe-display/actions/workflows/deploy.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-2ce6a8.svg)](LICENSE)

The marketing site for **PitchTribe** — open-source digital signage for sports and social clubs,
running on a Raspberry Pi 5. Noticeboards, fixtures, bar menus and a guest Wi-Fi portal, managed
from any device on the club's own network.

**Live at [pitchtribe.media](https://pitchtribe.media).**

This repository contains the website and the signage software, which installs on a Pi as one package
with `deploy/install.sh`:

- [`app/`](app/README.md): the signage app. A Node.js server with a management dashboard and a kiosk
  player. It hosts the sports engine below at `/sports`.
- [`signage-server/`](signage-server/README.md): the sports engine. It collects fixtures, live scores and
  results (display page, JSON API, webhook push, MCP). The app uses it as a library, and it can also run on its own.

## Hosting

| Hostname | Behaviour |
| --- | --- |
| `pitchtribe.media` | Canonical. Served by Cloudflare Pages via a custom domain. |
| `www.pitchtribe.media` | 301 → `pitchtribe.media` |
| `pitchtribe.co.uk` | 301 → `pitchtribe.media` |
| `www.pitchtribe.co.uk` | 301 → `pitchtribe.media` |
| `pitchtribe-website.pages.dev` | Pages default domain; serves the same build. |

The three redirects are Cloudflare **Single Redirect** rules in each zone's
`http_request_dynamic_redirect` phase, not DNS changes — they fire at the edge, so each zone keeps
its own apex record and its email routing (MX/SPF/DKIM) untouched.

## Repository layout

| Path | Purpose |
| --- | --- |
| `html/` | Static root, copied verbatim into `dist/`. Add a page here. |
| `html/index.html` | Landing page |
| `html/buy.html` | `/buy` — parts list, ready-built units, installation |
| `html/_headers` | Cloudflare Pages response headers (CSP and cache policy) |
| `src/styles.css` | Tailwind v4 entry point: design tokens, component classes |
| `scripts/fingerprint.mjs` | Content-hashes built assets and rewrites HTML references |
| `scripts/i18n-build.mjs`, `i18n/` | Builds `/fr/`, `/es/`, `/de/`, `/it/`, `/pt/`, `/pl/`, `/ru/`, `/zh/`, `/ja/` from the English pages and `i18n/<lang>.json`, plus hreflang tags and the sitemap |
| `wrangler.toml` | Pages project config (`pages_build_output_dir = "./dist"`) |
| `.github/workflows/deploy.yml` | CI: build on pull requests, build and deploy on push to `main` |
| `signage-server/` | Sports fixtures/scores server: display page, JSON API, webhook push, MCP. Not part of the site build |
| `dist/` | Build output (git-ignored) |
| `app/` | Signage app: dashboard, player and server — see [`app/README.md`](app/README.md) |
| `deploy/` | Raspberry Pi installer, systemd units and kiosk launcher for the app |
| `.github/workflows/app.yml` | CI: tests the signage app when `app/` or `deploy/` change |

## Languages

The English pages in `html/` are the single source of truth. At build time `scripts/i18n-build.mjs` generates a copy of each page in nine more languages:

- `i18n/source.json` lists every translatable English string: text, `alt`, `aria-label`, `title` and meta descriptions.
- `i18n/<lang>.json` maps a string's position in that list to its translation.
- A string with no translation shows in English, so the site never breaks.

After editing English text:

```bash
npm run i18n:update   # append new English strings to i18n/source.json (positions never shift)
npm run i18n:check    # list what still needs translating, per language
```

Translations are inserted as plain text: no HTML tags, and `&` must be written as `&amp;`. The build rejects anything else.
The header has a language switcher that works without JavaScript. Every page gets hreflang alternates, and the sitemap lists all languages.

## Local development

Requires Node 22 (see `.nvmrc`).

```bash
npm ci
npm run build     # clean → copy html/ → compile Tailwind → fingerprint assets
npm run dev       # build, then watch and recompile CSS on change
npm run preview   # build, then serve dist/ on Cloudflare's runtime at http://localhost:8788
```

`docker compose up` also serves a built `dist/` with nginx at http://localhost:8088.

> Changes to `html/*.html` only reach `dist/` through a build — `npm run dev` watches CSS, not markup.

### What the build does

1. **clean** — removes `dist/`.
2. **copy** — copies `html/` into `dist/` unchanged.
3. **build:css** — compiles `src/styles.css` into `dist/assets/app.css`, minified.
4. **fingerprint** — renames each asset to include a content hash (`app.248da1c0.css`) and rewrites
   every reference in the built HTML, then fails the build if an unhashed reference survives.

Step 4 exists because `_headers` caches `/assets/*` for a year while HTML is `must-revalidate`. With
stable filenames a returning visitor could hold last week's stylesheet alongside today's markup and
see the page render half-styled. Hashing the filename makes every build a new URL, so the long cache
is safe and changes land immediately.

## Deployment

Pushing to `main` builds the site and runs:

```
wrangler pages deploy dist --project-name=pitchtribe-website --branch=main
```

The Pages project uses **Direct Upload** rather than a Git integration — CI owns the build, and a
Git integration would build the site a second time and fight it.

The deploy job runs in the **`cloudflare_api`** GitHub environment, because that is where
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are scoped. A job can only read repository-level
secrets plus secrets scoped to its own environment, so moving those secrets to repository level
means changing `environment:` in `deploy.yml` to match. The job fails fast and names the missing
variable if either secret resolves empty.

The API token needs the **Cloudflare Pages: Edit** permission and nothing more.

A deploy can also be run manually with `workflow_dispatch`, or from a workstation with
`npx wrangler login && npm run deploy`.

## Conventions worth knowing

These are the three things that have caused real defects here.

**Tailwind scans `html/` and nothing else.** `src/styles.css` imports Tailwind with `source(none)`
and an explicit `@source "../html"`. Without that, Tailwind's automatic content detection scans
every non-ignored file in the repo and harvests ordinary prose as class names — `README.md`,
`package.json` and a workflow step name were each contributing phantom utilities (`.visible`,
`.contents`, `.inline`, `.static`). Prose inside `html/` can still do this, so diff the generated
CSS after a copy change and confirm the class set only gained utilities the markup actually uses.

**The inline script is pinned by hash.** `html/_headers` sets a strict CSP, and the one inline
script in each page is allow-listed by its SHA-256. Change that script and the CSP must be
regenerated, or the `js` class is never added and every progressive enhancement silently stops:

```bash
printf "%s" "document.documentElement.classList.add('js')" | openssl dgst -sha256 -binary | base64
```

**Prices on the site carry a date.** The hardware costs in the FAQ and on `/buy` are a dated
snapshot, because Raspberry Pi board prices moved three times during 2026. Re-check them when
touching that copy, and keep the date stamp honest.

## Licence

[MIT](LICENSE) — © 2026 Daniel Newbury, trading as PitchTribe.

## About

PitchTribe is a UK sole trader, registered and covered by public liability insurance.

- **Address:** 2 Jubilee Place, Shefford, Bedfordshire, SG17 5JP, United Kingdom
- **Sales and installation enquiries:** sales@pitchtribe.media
- **Press:** press@pitchtribe.media

Ready-built units and on-site installation are quoted per job — see
[pitchtribe.media/buy](https://pitchtribe.media/buy). The software itself is MIT-licensed and free,
and building it yourself from the published parts list is a first-class option.

Raspberry Pi is a trademark of Raspberry Pi Ltd. PitchTribe is not affiliated with Raspberry Pi Ltd.
