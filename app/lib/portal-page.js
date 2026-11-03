'use strict';
/* Guest Wi-Fi splash and "you're online" pages. Server-rendered HTML with no
   JavaScript, so it works inside phones' captive-portal sheets. Used by the
   guest-facing portal server and by the dashboard preview. */

const DEFAULT_TERMS = [
  'This free Wi-Fi is provided by the club for members, players and visitors.',
  'Please use it responsibly: no illegal activity, no attempts to access other devices or the club’s systems, and nothing offensive in shared spaces.',
  'The service is provided as is, may be filtered or limited in speed, and can be withdrawn at any time.',
  'The connection is not encrypted. Avoid sending sensitive information unless the website uses HTTPS.',
  'We keep a record of connections (time and device address) to manage the service. If you give us your email address, we only use it as you agree below.',
].join('\n\n');

const DEFAULT_PORTAL = {
  enabled: false,
  ssid: 'Club-Guest',
  channel: 6,
  sessionMinutes: 120,
  downMbps: 10,
  upMbps: 3,
  headline: 'Welcome to {club}',
  message: 'Free Wi-Fi for members, players and visitors. Enjoy the game!',
  terms: DEFAULT_TERMS,
  accent: '#2ce6a8',
  logoAssetId: null,
  redirectUrl: '',
  collectEmail: 'off', // off | optional | required
  consentText: 'Email me club news and events. I can unsubscribe at any time.',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paragraphs = (s) => String(s || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
const withClub = (s, club) => String(s || '').split('{club}').join(club);

function page({ title, body, css }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
${css.map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')}
</head>
<body>
<main class="card">
${body}
</main>
</body>
</html>`;
}

function header(club, logoUrl) {
  const mark = logoUrl
    ? `<img class="logo" src="${esc(logoUrl)}" alt="">`
    : `<div class="logo initial" aria-hidden="true">${esc((club || '?').trim().charAt(0).toUpperCase())}</div>`;
  return `<header class="brand">${mark}<span>${esc(club)}</span></header>`;
}

/**
 * @param o.club       club name
 * @param o.portal     portal settings (see DEFAULT_PORTAL)
 * @param o.logoUrl    URL of the logo image, or null
 * @param o.css        stylesheet URLs
 * @param o.action     form action
 * @param o.error      message to show above the form
 * @param o.values     previously entered values { email, consent }
 * @param o.preview    true in the dashboard preview (form doesn't submit)
 */
function renderSplash(o) {
  const p = { ...DEFAULT_PORTAL, ...o.portal };
  const club = o.club || 'Our club';
  const email = p.collectEmail === 'optional' || p.collectEmail === 'required';
  const v = o.values || {};
  const body = `
${header(club, o.logoUrl)}
<h1>${esc(withClub(p.headline, club))}</h1>
<div class="message">${paragraphs(withClub(p.message, club))}</div>
${o.error ? `<p class="error" role="alert">${esc(o.error)}</p>` : ''}
<form method="post" action="${esc(o.action || '/accept')}">
${email ? `
  <label class="field">
    <span>Email address${p.collectEmail === 'optional' ? ' <em>(optional)</em>' : ''}</span>
    <input type="email" name="email" autocomplete="email" inputmode="email" maxlength="200" value="${esc(v.email)}"${p.collectEmail === 'required' ? ' required' : ''}>
  </label>
  <label class="check">
    <input type="checkbox" name="consent" value="yes"${v.consent ? ' checked' : ''}>
    <span>${esc(p.consentText)}</span>
  </label>` : ''}
  <details class="terms">
    <summary>Terms of use</summary>
    ${paragraphs(withClub(p.terms, club))}
  </details>
  <label class="check">
    <input type="checkbox" name="terms" value="yes" required>
    <span>I agree to the terms of use</span>
  </label>
  <button type="${o.preview ? 'button' : 'submit'}">Connect to Wi-Fi</button>
</form>
<footer>Free Wi-Fi from ${esc(club)}${p.sessionMinutes ? ` · sessions last ${esc(formatMinutes(p.sessionMinutes))}` : ''} · Powered by PitchTribe</footer>`;
  return page({ title: `${club} Wi-Fi`, body, css: o.css || [] });
}

function renderConnected(o) {
  const p = { ...DEFAULT_PORTAL, ...o.portal };
  const club = o.club || 'Our club';
  const body = `
${header(club, o.logoUrl)}
<div class="tick" aria-hidden="true">✓</div>
<h1>You’re online</h1>
<div class="message"><p>Enjoy the free Wi-Fi${o.minutesLeft ? ` — your session lasts another ${esc(formatMinutes(o.minutesLeft))}. After that, just connect again` : ''}.</p></div>
${p.redirectUrl ? `<a class="button" href="${esc(p.redirectUrl)}">Continue</a>` : ''}
<footer>Free Wi-Fi from ${esc(club)} · Powered by PitchTribe</footer>`;
  return page({ title: `${club} Wi-Fi`, body, css: o.css || [] });
}

function renderMessage(o) {
  const body = `${header(o.club || 'Our club', o.logoUrl)}<h1>${esc(o.title)}</h1><div class="message">${paragraphs(o.text)}</div>`;
  return page({ title: o.title, body, css: o.css || [] });
}

function formatMinutes(m) {
  m = Number(m);
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} minutes` : ''}`;
}

/** Theme CSS (accent colour) — kept out of the HTML so the CSP can forbid inline styles. */
function themeCss(accent) {
  const c = /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : DEFAULT_PORTAL.accent;
  return `:root { --accent: ${c}; }\n`;
}

module.exports = { DEFAULT_PORTAL, DEFAULT_TERMS, renderSplash, renderConnected, renderMessage, themeCss, formatMinutes, esc };
