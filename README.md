# PitchTribe website

Landing page for PitchTribe — open-source Raspberry Pi 5 digital signage for sports and social clubs.
Static HTML + Tailwind CSS v4, hosted on **Cloudflare Pages**.

## Layout

| Path | Purpose |
| --- | --- |
| `html/` | Static root: `index.html`, `404.html`, `_headers`, `robots.txt`, `sitemap.xml`, `assets/` |
| `src/styles.css` | Tailwind entry point (theme tokens, components) — compiled to `dist/assets/app.css` |
| `dist/` | Build output deployed to Pages (git-ignored) |
| `wrangler.toml` | Cloudflare Pages project config (`pages_build_output_dir = "./dist"`) |
| `.github/workflows/deploy.yml` | CI: build on PRs, build + deploy on push to `main` |

## Local development

```bash
npm ci
npm run build     # copy html/ → dist/ and compile Tailwind (minified)
npm run preview   # build, then serve dist/ with Cloudflare's runtime at http://localhost:8788
npm run dev       # build, then watch src/ + html/ classes and recompile CSS
```

Alternatively, `docker compose up` serves the built `dist/` with nginx at http://localhost:8088.

> Edits to `html/*.html` need `npm run build` (or re-run `npm run copy`) to show up in `dist/`.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the site and runs
`wrangler pages deploy dist --project-name=pitchtribe-website --branch=main`.

One-time setup:

1. In Cloudflare, create a Pages project named **`pitchtribe-website`** using *Direct Upload*
   (or run `npx wrangler pages project create pitchtribe-website --production-branch=main`).
2. Create an API token with the **Cloudflare Pages: Edit** permission.
3. In GitHub → *Settings → Secrets and variables → Actions*, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Attach custom domains (`pitchtribe.media`, `pitchtribe.co.uk`) under the Pages project's *Custom domains*.

Manual deploy from a workstation: `npx wrangler login && npm run deploy`.

## Security headers

`html/_headers` sets a strict CSP. The single inline script in `index.html`
(`document.documentElement.classList.add('js')`) is allow-listed by its SHA-256 hash — if you change
that script, regenerate the hash:

```bash
printf "%s" "document.documentElement.classList.add('js')" | openssl dgst -sha256 -binary | base64
```
