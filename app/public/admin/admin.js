/* PitchTribe dashboard — a small dependency-free single-page app.
   Routes: #/content  #/playlists  #/playlists/<id>  #/screens  #/settings */
(() => {
  'use strict';

  const appEl = document.getElementById('app');
  let state = null; // GET /api/state
  let dirty = false; // unsaved playlist edits
  let currentView = null;

  // ================================================================ helpers
  const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'multiple', 'draggable', 'indeterminate']);

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM: allowed by our CSP, unlike style=""
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9.5a1.5 1.5 0 1 0 0-.01',
    video: 'M4 6h11v12H4z M15 10l5-3v10l-5-3',
    url: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
    notice: 'M4 10v4h3l6 4V6L7 10z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11',
    menu: 'M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5',
    fixtures: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5 M8 14h3',
    content: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    playlist: 'M4 6h12 M4 12h12 M4 18h8 M17 15l4 2.5-4 2.5z',
    screen: 'M3 5h18v12H3z M8 21h8 M12 17v4',
    settings: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 2v3 M12 19v3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M2 12h3 M19 12h3 M4.9 19.1 7 17 M17 7l2.1-2.1',
    plus: 'M12 5v14 M5 12h14',
    upload: 'M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
    clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 7v5l3 2',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
    back: 'M15 6l-6 6 6 6',
    x: 'M6 6l12 12 M18 6L6 18',
    logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
    copy: 'M8 8h12v12H8z M4 16V4h12',
    target: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 11.5v1',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.6 M20 4v5h-5',
    external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  };
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', name === 'grip' ? '3' : '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name] || ICONS.content);
    svg.append(path);
    return svg;
  }
  function logo() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
      '<path d="M16 4 27 10.5v11L16 28 5 21.5v-11z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 10.5 21.5 13.5v5L16 21.5 10.5 18.5v-5z" fill="currentColor"/>';
    return svg;
  }

  const TYPE_LABEL = { image: 'Image', video: 'Video', url: 'Web page', notice: 'Notice', menu: 'Menu board', fixtures: 'Fixtures' };
  const STATUS_LABEL = { live: 'Live now', scheduled: 'Scheduled', expired: 'Expired', 'off-hours': 'Off-hours', disabled: 'Off' };
  const NOTICE_STYLES = [
    ['default', 'Navy', '#0e1e30'],
    ['accent', 'Pitch green', '#0a3a2e'],
    ['amber', 'Amber', '#3d2c05'],
    ['alert', 'Alert red', '#4a0f12'],
    ['light', 'Light', '#f3f7fa'],
  ];

  function fmtDuration(sec) {
    if (!sec) return 'full length';
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const fmtLoop = (sec) => (sec ? fmtDuration(sec) : '0s');
  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  }
  function ago(ts) {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }
  const assetById = (id) => state.assets.find((a) => a.id === id);
  const usage = (assetId) => state.playlists.filter((p) => p.items.some((it) => it.assetId === assetId)).length;
  const baseUrl = () =>
    ['localhost', '127.0.0.1', '::1'].includes(location.hostname) && state?.dashboardUrls?.length
      ? state.dashboardUrls[0].replace(/\/$/, '')
      : location.origin;

  function toast(msg, kind = 'ok') {
    const t = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}` }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3200);
  }

  // ================================================================== API
  async function api(method, url, body) {
    const res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: { 'x-pitchtribe': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/auth')) {
      boot();
      throw new Error('Please sign in again');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function refresh() {
    state = await api('GET', '/state');
    return state;
  }

  function guessMime(file) {
    if (file.type) return file.type;
    const ext = file.name.split('.').pop().toLowerCase();
    return (
      { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[ext] ||
      'application/octet-stream'
    );
  }

  function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/assets/upload');
      xhr.setRequestHeader('x-pitchtribe', '1');
      xhr.setRequestHeader('Content-Type', guessMime(file));
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || (xhr.status === 413 ? 'File is too large' : `Upload failed (${xhr.status})`)));
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(file);
    });
  }

  // ================================================================ modal
  function modal({ title, body, footer, wide = false, onClose }) {
    const dlg = h('dialog', { class: wide ? 'wide' : '' });
    const close = () => dlg.close();
    const foot = h('div', { class: 'modal-foot' });
    dlg.append(
      h('div', { class: 'modal' },
        h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
        h('div', { class: 'modal-body' }, body),
        foot)
    );
    append(foot, typeof footer === 'function' ? footer(close) : footer || []);
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (onClose) onClose();
    });
    document.body.append(dlg);
    dlg.showModal();
    return { dlg, close };
  }

  function confirmDialog(title, message, { confirmLabel = 'Delete', danger = true } = {}) {
    return new Promise((resolve) => {
      let result = false;
      modal({
        title,
        body: h('p', { class: 'muted' }, message),
        footer: (close) => [
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { result = true; close(); } }, confirmLabel),
        ],
        onClose: () => resolve(result),
      });
    });
  }

  function promptDialog(title, label, value = '') {
    return new Promise((resolve) => {
      let result = null;
      const input = h('input', { type: 'text', value, maxlength: 80, required: true });
      const form = h('form', { class: 'form-grid', onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) { result = input.value.trim(); m.close(); } } },
        h('label', { class: 'field' }, label, input));
      const m = modal({
        title,
        body: form,
        footer: (close) => [
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => form.requestSubmit() }, 'Continue'),
        ],
        onClose: () => resolve(result),
      });
      setTimeout(() => input.focus(), 30);
    });
  }

  // =============================================================== thumbs
  function thumb(asset, { tag = true } = {}) {
    if (!asset) return h('div', { class: 'thumb' }, icon('content'));
    const t = h('div', { class: 'thumb' });
    if (asset.type === 'image') {
      t.append(h('img', { src: asset.src, alt: '', loading: 'lazy' }));
    } else if (asset.type === 'video') {
      t.append(h('video', { src: `${asset.src}#t=0.5`, preload: 'metadata', muted: true, playsinline: true }));
    } else if (asset.type === 'notice') {
      t.classList.add('text', `style-${asset.content?.style || 'default'}`);
      t.append(h('strong', {}, asset.content?.title || asset.name), h('span', {}, asset.content?.body || ''));
    } else {
      t.append(icon(asset.type));
    }
    if (tag && asset.type !== 'notice') t.append(h('span', { class: 'badge type-tag' }, TYPE_LABEL[asset.type]));
    return t;
  }

  // ================================================================= shell
  const NAV = [
    ['content', 'Content', 'content'],
    ['playlists', 'Playlists', 'playlist'],
    ['screens', 'Screens', 'screen'],
    ['settings', 'Settings', 'settings'],
  ];

  function shell(active, ...content) {
    return [
      h('header', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/content' }, logo(), h('span', {}, 'PITCHTRIBE', h('small', {}, state.settings.clubName))),
        h('nav', { class: 'nav', 'aria-label': 'Main' },
          NAV.map(([key, label, ic]) => h('a', { href: `#/${key}`, 'aria-current': active === key ? 'page' : null }, icon(ic), label))),
        h('button', { class: 'btn ghost icon', type: 'button', title: 'Sign out', 'aria-label': 'Sign out', onclick: logout }, icon('logout'))),
      h('main', { class: 'page' }, content),
    ];
  }

  async function logout() {
    if (dirty && !confirm('Discard unsaved playlist changes?')) return;
    dirty = false;
    await api('POST', '/auth/logout', {}).catch(() => {});
    boot();
  }

  // ================================================================ auth
  function renderAuth(status) {
    const setup = status.setupRequired;
    const err = h('p', { class: 'error-text', role: 'alert' });
    const club = h('input', { type: 'text', name: 'club', autocomplete: 'organization', maxlength: 80, required: true, placeholder: 'e.g. Riverside FC' });
    const pw = h('input', { type: 'password', name: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, minlength: setup ? 8 : null });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, setup ? 'Create dashboard' : 'Sign in');
    const form = h('form', { class: 'form-grid', onsubmit: submit },
      setup && h('label', { class: 'field' }, 'Club name', club),
      h('label', { class: 'field' }, setup ? 'Choose an admin password' : 'Password', pw, setup && h('span', { class: 'hint' }, 'At least 8 characters. Share it with the volunteers who manage the screens.')),
      setup && h('label', { class: 'field' }, 'Confirm password', pw2),
      err,
      btn);

    async function submit(e) {
      e.preventDefault();
      err.textContent = '';
      if (setup && pw.value !== pw2.value) {
        err.textContent = 'The passwords don’t match';
        return;
      }
      btn.disabled = true;
      try {
        if (setup) await api('POST', '/auth/setup', { clubName: club.value, password: pw.value });
        else await api('POST', '/auth/login', { password: pw.value });
        boot();
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    }

    appEl.replaceChildren(
      h('div', { class: 'auth' },
        h('div', { class: 'card' },
          h('div', { class: 'logo' }, logo()),
          h('div', {},
            h('h1', {}, setup ? 'Set up PitchTribe' : `Sign in${status.clubName ? ` to ${status.clubName}` : ''}`),
            h('p', { class: 'muted', style: 'margin-top:6px' }, setup ? 'Create the dashboard for your club’s screens.' : 'Manage what’s on your club’s screens.')),
          form)));
    (setup ? club : pw).focus();
  }

  // ============================================================== content
  let contentFilter = 'all';
  let contentSearch = '';
  const uploads = []; // { name, progress, error }

  function viewContent() {
    const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/*,video/mp4,video/webm,video/quicktime', hidden: true, onchange: () => { startUploads([...fileInput.files]); fileInput.value = ''; } });

    const filters = [['all', 'All'], ['image', 'Images'], ['video', 'Videos'], ['notice', 'Notices'], ['menu', 'Menus'], ['fixtures', 'Fixtures'], ['url', 'Web pages']];
    const list = state.assets
      .filter((a) => contentFilter === 'all' || a.type === contentFilter)
      .filter((a) => !contentSearch || a.name.toLowerCase().includes(contentSearch.toLowerCase()))
      .slice()
      .reverse();

    const grid = list.length
      ? h('div', { class: 'grid' }, list.map((a) => {
          const n = usage(a.id);
          return h('button', { class: 'card asset', type: 'button', onclick: () => editAsset(a) },
            thumb(a),
            h('div', { class: 'asset-body' },
              h('strong', {}, a.name),
              h('span', {}, `${TYPE_LABEL[a.type]} · ${fmtDuration(a.duration)}${n ? ` · in ${n} playlist${n > 1 ? 's' : ''}` : ' · not in a playlist'}`)));
        }))
      : h('div', { class: 'card empty' },
          h('h2', {}, state.assets.length ? 'Nothing matches' : 'No content yet'),
          h('p', {}, state.assets.length ? 'Try another filter.' : 'Upload photos and videos, or create a notice, menu or fixture list.'));

    return shell('content',
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Content'), h('p', {}, 'Everything that can appear on your screens.')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Upload'),
          h('button', { class: 'btn', type: 'button', onclick: () => editAsset({ type: 'notice' }) }, icon('notice'), 'Notice'),
          h('button', { class: 'btn', type: 'button', onclick: () => editAsset({ type: 'menu' }) }, icon('menu'), 'Menu'),
          h('button', { class: 'btn', type: 'button', onclick: () => editAsset({ type: 'fixtures' }) }, icon('fixtures'), 'Fixtures'),
          h('button', { class: 'btn', type: 'button', onclick: () => editAsset({ type: 'url' }) }, icon('url'), 'Web page'),
          fileInput)),
      h('div', { class: 'dropzone' }, 'Drop photos or videos here to upload', h('br'), h('span', { class: 'small' }, `JPG, PNG, GIF, WebP, SVG, MP4, WebM · up to ${state.maxUploadMb} MB each`)),
      uploads.length ? h('div', { class: 'uploads' }, uploads.map((u) =>
        h('div', { class: `card upload ${u.error ? 'error' : ''}` },
          h('strong', {}, u.name),
          h('span', { class: u.error ? '' : 'muted' }, u.error || (u.progress >= 1 ? 'Processing…' : `${Math.round(u.progress * 100)}%`)),
          !u.error && h('progress', { max: 1, value: u.progress })))) : null,
      h('div', { class: 'toolbar' },
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by type' },
          filters.map(([key, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(contentFilter === key), onclick: () => { contentFilter = key; render(); } }, label))),
        h('input', { type: 'search', placeholder: 'Search content', value: contentSearch, 'aria-label': 'Search content', oninput: (e) => { contentSearch = e.target.value; rerenderKeepingFocus(e.target); } })),
      grid);
  }

  function rerenderKeepingFocus(input) {
    const pos = input.selectionStart;
    render();
    const again = appEl.querySelector(`input[aria-label="${input.getAttribute('aria-label')}"]`);
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  }

  async function startUploads(files) {
    if (!files.length) return;
    const jobs = files.map((f) => ({ file: f, name: f.name, progress: 0, error: '' }));
    uploads.push(...jobs);
    render();
    let ok = 0;
    for (const job of jobs) {
      try {
        let last = 0;
        await uploadFile(job.file, (p) => {
          job.progress = p;
          if (p - last > 0.05 || p === 1) { last = p; if (currentView === 'content') render(); }
        });
        ok += 1;
        uploads.splice(uploads.indexOf(job), 1);
      } catch (err) {
        job.error = err.message;
        setTimeout(() => { const i = uploads.indexOf(job); if (i >= 0) uploads.splice(i, 1); render(); }, 8000);
      }
    }
    await refresh();
    render();
    if (ok) toast(`Uploaded ${ok} file${ok > 1 ? 's' : ''} — add ${ok > 1 ? 'them' : 'it'} to a playlist to show on screen`);
  }

  // Drag & drop anywhere while on the content page.
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (currentView !== 'content' || !e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
  });
  document.addEventListener('dragover', (e) => {
    if (currentView === 'content' && e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (currentView !== 'content' || !e.dataTransfer?.files.length) return;
    e.preventDefault();
    startUploads([...e.dataTransfer.files]);
  });

  // ---------------------------------------------------------- asset editor
  function editAsset(asset) {
    const isNew = !asset.id;
    const type = asset.type;
    const c = asset.content || {};
    const defaults = { url: 30, notice: 12, menu: 20, fixtures: 15 };
    const f = {}; // field elements
    const body = h('form', { class: 'form-grid', onsubmit: (e) => { e.preventDefault(); save(); } });

    if (type === 'image') body.append(h('img', { class: 'preview-media', src: asset.src, alt: '' }));
    if (type === 'video') body.append(h('video', { class: 'preview-media', src: asset.src, controls: true, muted: true, preload: 'metadata' }));

    f.name = h('input', { type: 'text', value: asset.name || '', maxlength: 120, required: true, placeholder: { notice: 'e.g. AGM notice', menu: 'e.g. Bar menu', fixtures: 'e.g. First team fixtures', url: 'e.g. League table' }[type] });
    f.duration = h('input', { type: 'number', min: type === 'video' ? 0 : 1, max: 86400, value: asset.duration ?? defaults[type] ?? 10, required: true });
    body.append(h('div', { class: 'row-2' },
      h('label', { class: 'field' }, 'Name', f.name),
      h('label', { class: 'field' }, 'Show for (seconds)', f.duration, type === 'video' && h('span', { class: 'hint' }, '0 = play the whole video'))));

    if (type === 'image' || type === 'video') {
      f.fit = h('select', {}, h('option', { value: 'contain', selected: asset.fit !== 'cover' }, 'Fit whole picture (may show bars)'), h('option', { value: 'cover', selected: asset.fit === 'cover' }, 'Fill screen (may crop edges)'));
      body.append(h('label', { class: 'field' }, 'Sizing', f.fit));
    }
    if (type === 'video') {
      f.muted = h('input', { type: 'checkbox', checked: asset.muted !== false });
      body.append(h('label', { class: 'switch' }, f.muted, 'Mute sound'));
    }
    if (type === 'image' || type === 'video') {
      body.append(h('p', { class: 'small muted' }, `${asset.file.originalName} · ${fmtBytes(asset.file.size)}`));
    }
    if (type === 'url') {
      f.url = h('input', { type: 'url', value: asset.url || '', required: true, placeholder: 'https://' });
      body.append(h('label', { class: 'field' }, 'Web address', f.url,
        h('span', { class: 'hint' }, 'Live pages such as league tables, weather or social walls. Some sites block being shown inside other pages — preview the playlist to check.')));
    }
    if (type === 'notice') {
      f.title = h('input', { type: 'text', value: c.title || '', maxlength: 200, placeholder: 'AGM — Friday 7th November, 7pm' });
      f.body = h('textarea', { maxlength: 3000, placeholder: 'All members welcome. Bar opens 6:30pm.' }, c.body || '');
      let style = c.style || 'default';
      const picker = h('div', { class: 'style-picker', role: 'group', 'aria-label': 'Colour' });
      const drawPicker = () => picker.replaceChildren(...NOTICE_STYLES.map(([key, label, color]) =>
        h('button', { type: 'button', title: label, 'aria-label': label, 'aria-pressed': String(style === key), style: `background:${color}`, onclick: () => { style = key; drawPicker(); } })));
      drawPicker();
      f.style = { get value() { return style; } };
      body.append(h('label', { class: 'field' }, 'Headline', f.title), h('label', { class: 'field' }, 'Message', f.body, h('span', { class: 'hint' }, 'New lines start new paragraphs. Long text shrinks to fit the screen.')), h('div', { class: 'field' }, 'Colour', picker));
    }
    if (type === 'menu' || type === 'fixtures') {
      f.title = h('input', { type: 'text', value: c.title || '', maxlength: 200, placeholder: type === 'menu' ? 'Bar & Kitchen — Today’s Menu' : 'Upcoming Fixtures' });
      f.text = h('textarea', { class: 'code', spellcheck: false, maxlength: type === 'menu' ? 20000 : 50000 }, c.text || (isNew ? (type === 'menu' ? MENU_EXAMPLE : fixturesExample()) : ''));
      const summary = h('p', { class: 'parse-summary' });
      const update = () => { summary.textContent = type === 'menu' ? menuSummary(f.text.value) : fixturesSummary(f.text.value); };
      f.text.addEventListener('input', update);
      update();
      body.append(h('label', { class: 'field' }, 'Heading on screen', f.title));
      body.append(h('label', { class: 'field' }, type === 'menu' ? 'Menu' : 'Fixtures', f.text, summary));
      body.append(type === 'menu'
        ? h('details', { class: 'help' }, h('summary', {}, 'How to write a menu'),
            h('p', { style: 'margin-top:8px' }, 'Start a section with #. One item per line: name | price | notes. Add “| sold out” to mark an item sold out. You can paste straight from a spreadsheet.'),
            h('pre', {}, MENU_EXAMPLE))
        : h('details', { class: 'help' }, h('summary', {}, 'How to write fixtures'),
            h('p', { style: 'margin-top:8px' }, 'One per line: date & time | match | competition | venue. Dates can be 2026-11-09 14:00 or 09/11/2026 14:00. Past fixtures hide themselves 3 hours after kick-off, and the next one gets a countdown. You can paste from a spreadsheet.'),
            h('pre', {}, fixturesExample())));
      if (type === 'fixtures') {
        f.limit = h('input', { type: 'number', min: 1, max: 20, value: c.limit || 8 });
        body.append(h('label', { class: 'field' }, 'Show at most', f.limit));
      }
    }
    if (isNew && state.playlists.length) {
      f.addTo = h('select', {}, h('option', { value: '' }, 'Don’t add yet'),
        state.playlists.map((p, i) => h('option', { value: p.id, selected: i === 0 }, p.name)));
      body.append(h('label', { class: 'field' }, 'Add to playlist', f.addTo));
    }
    if (!isNew) {
      const n = usage(asset.id);
      body.append(h('p', { class: 'small muted' }, n ? `Used in ${n} playlist${n > 1 ? 's' : ''}. Changes show on screens straight away.` : 'Not in any playlist yet — add it from a playlist to show it on screen.'));
    }

    const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => save() }, isNew ? 'Create' : 'Save');
    const m = modal({
      title: isNew ? `New ${TYPE_LABEL[type].toLowerCase()}` : `Edit ${TYPE_LABEL[type].toLowerCase()}`,
      body,
      wide: type === 'menu' || type === 'fixtures',
      footer: (close) => [
        !isNew && h('button', { class: 'btn danger', type: 'button', onclick: remove }, icon('trash'), 'Delete'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'),
        saveBtn,
      ],
    });
    setTimeout(() => (type === 'notice' && isNew ? f.title : f.name).focus(), 30);

    async function save() {
      if (!body.reportValidity()) return;
      const payload = { name: f.name.value, duration: Number(f.duration.value) };
      if (f.fit) payload.fit = f.fit.value;
      if (f.muted) payload.muted = f.muted.checked;
      if (f.url) payload.url = f.url.value;
      if (type === 'notice') payload.content = { title: f.title.value, body: f.body.value, style: f.style.value };
      if (type === 'menu') payload.content = { title: f.title.value, text: f.text.value };
      if (type === 'fixtures') payload.content = { title: f.title.value, text: f.text.value, limit: Number(f.limit.value) };
      saveBtn.disabled = true;
      try {
        if (isNew) await api('POST', '/assets', { type, ...payload, addToPlaylist: f.addTo?.value || undefined });
        else await api('PATCH', `/assets/${asset.id}`, payload);
        await refresh();
        m.close();
        render();
        toast(isNew ? (f.addTo?.value ? 'Created and added to the playlist' : 'Created') : 'Saved — screens update in a few seconds');
      } catch (err) {
        toast(err.message, 'error');
        saveBtn.disabled = false;
      }
    }

    async function remove() {
      const n = usage(asset.id);
      const ok = await confirmDialog(`Delete “${asset.name}”?`, n ? `It will also be removed from ${n} playlist${n > 1 ? 's' : ''}. This can’t be undone.` : 'This can’t be undone.');
      if (!ok) return;
      try {
        await api('DELETE', `/assets/${asset.id}`);
        await refresh();
        m.close();
        render();
        toast('Deleted');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }

  const MENU_EXAMPLE = `# Draught
Lager (pint) | £4.50
Real ale (pint) | £4.80 | Ask for today’s guest ale
Stout (pint) | £4.70

# Food
Beef burger & chips | £8.50 | Contains gluten
Chicken & mushroom pie | £7.00 | | sold out
Chips | £3.00 | V, VG`;

  function fixturesExample() {
    const d = (offset, time) => {
      const x = new Date();
      x.setDate(x.getDate() + offset);
      return `${PTSchedule.dateKey(x)} ${time}`;
    };
    return `${d(4, '14:00')} | Riverside FC v Rovers United | League | Home
${d(7, '19:30')} | Training · Astroturf Pitch A
${d(11, '15:00')} | City Athletic v Riverside FC | League | Away
${d(18, '14:00')} | Riverside FC v Northdale Athletic | County Cup | Home`;
  }

  function menuSummary(text) {
    const secs = PTFormats.parseMenu(text);
    const items = secs.reduce((n, s) => n + s.items.length, 0);
    const sold = secs.reduce((n, s) => n + s.items.filter((i) => i.soldOut).length, 0);
    return `${secs.length} section${secs.length === 1 ? '' : 's'}, ${items} item${items === 1 ? '' : 's'}${sold ? ` (${sold} sold out)` : ''}`;
  }
  function fixturesSummary(text) {
    const all = PTFormats.parseFixtures(text, { includePast: true });
    const upcoming = PTFormats.parseFixtures(text);
    const next = upcoming.find((f) => f.date);
    const past = all.length - upcoming.length;
    return `${upcoming.length} upcoming${past ? `, ${past} past (hidden)` : ''}${next ? ` · next: ${next.title} — ${PTFormats.formatWhen(next)}` : ''}`;
  }

  // ============================================================ playlists
  function loopSeconds(p) {
    return p.items.filter((it) => it.enabled).reduce((n, it) => n + (it.duration ?? assetById(it.assetId)?.duration ?? 0), 0);
  }

  function viewPlaylists() {
    const cards = state.playlists.map((p) => {
      const now = new Date();
      const live = p.items.filter((it) => PTSchedule.isLive(it, now)).length;
      const screens = state.screens.filter((s) => s.playlistId === p.id).length;
      return h('a', { class: 'card pl-card', href: `#/playlists/${p.id}` },
        h('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' },
          h('h2', {}, p.name),
          p.id === state.settings.defaultPlaylistId && h('span', { class: 'badge' }, 'Default')),
        h('div', { class: 'pl-thumbs' }, p.items.slice(0, 6).map((it) => {
          const a = assetById(it.assetId);
          return h('div', {}, a?.type === 'image' ? h('img', { src: a.src, alt: '', loading: 'lazy' }) : icon(a?.type || 'content'));
        })),
        h('div', { class: 'stats' },
          h('span', {}, `${p.items.length} item${p.items.length === 1 ? '' : 's'}`),
          h('span', {}, `${live} live now`),
          h('span', {}, `loop ≈ ${fmtLoop(loopSeconds(p))}`),
          h('span', {}, `${screens} screen${screens === 1 ? '' : 's'}`)));
    });
    return shell('playlists',
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Playlists'), h('p', {}, 'The running order for each screen — with timings for when each item plays.')),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: newPlaylist }, icon('plus'), 'New playlist'))),
      cards.length ? h('div', { class: 'grid' }, cards) : h('div', { class: 'card empty' }, h('h2', {}, 'No playlists yet'), h('p', {}, 'Create one, then assign it to your screens.')));
  }

  async function newPlaylist() {
    const name = await promptDialog('New playlist', 'Name', '');
    if (!name) return;
    try {
      const p = await api('POST', '/playlists', { name });
      await refresh();
      location.hash = `#/playlists/${p.id}`;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ------------------------------------------------------- playlist editor
  let draft = null;
  let expanded = new Set();

  function viewPlaylist(id) {
    const saved = state.playlists.find((p) => p.id === id);
    if (!saved) return shell('playlists', h('div', { class: 'card empty' }, h('h2', {}, 'Playlist not found'), h('a', { href: '#/playlists' }, 'Back to playlists')));
    if (!draft || draft.id !== id) {
      draft = structuredClone(saved);
      dirty = false;
      expanded = new Set();
    }
    const markDirty = () => {
      dirty = true;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    };

    const saveBtn = h('button', { class: 'btn primary', type: 'button', disabled: !dirty, onclick: save }, dirty ? 'Save changes' : 'Saved');
    const nameInput = h('input', { class: 'title', type: 'text', value: draft.name, maxlength: 80, 'aria-label': 'Playlist name', oninput: (e) => { draft.name = e.target.value; markDirty(); } });

    async function save() {
      saveBtn.disabled = true;
      try {
        await api('PUT', `/playlists/${draft.id}`, draft);
        await refresh();
        draft = structuredClone(state.playlists.find((p) => p.id === id));
        dirty = false;
        render();
        toast('Saved — screens update in a few seconds');
      } catch (err) {
        saveBtn.disabled = false;
        toast(err.message, 'error');
      }
    }

    async function removePlaylist() {
      const screens = state.screens.filter((s) => s.playlistId === id).length;
      const ok = await confirmDialog(`Delete “${saved.name}”?`, `${screens ? `${screens} screen${screens > 1 ? 's' : ''} will switch to the default playlist. ` : ''}Your content stays in the library.`);
      if (!ok) return;
      try {
        await api('DELETE', `/playlists/${id}`);
        dirty = false;
        draft = null;
        await refresh();
        location.hash = '#/playlists';
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    // ---- items
    const list = h('div', { class: 'items' });
    const drawItems = () => {
      list.replaceChildren(...draft.items.map((it, i) => itemRow(it, i)));
      if (!draft.items.length) list.append(h('div', { class: 'card empty' }, h('h2', {}, 'This playlist is empty'), h('p', {}, 'Add notices, photos, videos, menus or fixtures from your library.')));
      totals.textContent = `${draft.items.length} item${draft.items.length === 1 ? '' : 's'} · one loop takes about ${fmtLoop(loopSeconds(draft))} (videos set to “full length” not counted)`;
    };
    const totals = h('p', { class: 'small muted' });

    let dragFrom = null;
    function itemRow(it, i) {
      const a = assetById(it.assetId);
      const st = PTSchedule.status(it);
      const isOpen = expanded.has(it.id);
      const row = h('div', { class: `card item ${it.enabled ? '' : 'disabled'}` });
      const grip = h('span', { class: 'grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip'));
      grip.addEventListener('pointerdown', () => { row.draggable = true; });
      row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); dragFrom = null; list.querySelectorAll('.item').forEach((r) => r.classList.remove('drop-before', 'drop-after')); });
      row.addEventListener('dragover', (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const after = e.offsetY > row.offsetHeight / 2;
        row.classList.toggle('drop-after', after);
        row.classList.toggle('drop-before', !after);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom === null) return;
        let to = row.classList.contains('drop-after') ? i + 1 : i;
        const [moved] = draft.items.splice(dragFrom, 1);
        if (dragFrom < to) to -= 1;
        draft.items.splice(to, 0, moved);
        markDirty();
        drawItems();
      });

      const move = (delta) => {
        const j = i + delta;
        if (j < 0 || j >= draft.items.length) return;
        [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]];
        markDirty();
        drawItems();
      };

      const dur = h('input', {
        type: 'number', min: 0, max: 86400, value: it.duration ?? '', placeholder: String(a?.duration ?? ''), 'aria-label': 'Seconds on screen',
        title: 'Seconds on screen (blank = the content’s default)',
        oninput: (e) => { it.duration = e.target.value === '' ? null : Number(e.target.value); markDirty(); },
      });
      const enabled = h('input', { type: 'checkbox', checked: it.enabled, 'aria-label': 'Show this item', onchange: (e) => { it.enabled = e.target.checked; markDirty(); drawItems(); } });

      append(row, [
        h('div', { class: 'item-main' },
          grip,
          thumb(a, { tag: false }),
          h('div', { class: 'item-info' },
            h('strong', {}, a?.name || 'Missing content'),
            h('div', { class: 'meta' },
              h('span', { class: `badge ${st}` }, STATUS_LABEL[st]),
              h('span', {}, TYPE_LABEL[a?.type] || ''),
              h('span', {}, '·'),
              h('span', {}, PTSchedule.describe(it.schedule)))),
          h('div', { class: 'item-controls' },
            h('label', { class: 'dur' }, dur, 's'),
            h('label', { class: 'switch', title: it.enabled ? 'On' : 'Off' }, enabled, h('span', { class: 'sr-only' }, 'Enabled')),
            h('button', { class: `btn sm ${isOpen ? 'primary' : ''}`, type: 'button', 'aria-expanded': String(isOpen), onclick: () => { isOpen ? expanded.delete(it.id) : expanded.add(it.id); drawItems(); } }, icon('clock'), 'Timing'),
            h('button', { class: 'btn sm icon ghost', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(-1) }, icon('up')),
            h('button', { class: 'btn sm icon ghost', type: 'button', 'aria-label': 'Move down', disabled: i === draft.items.length - 1, onclick: () => move(1) }, icon('down')),
            h('button', { class: 'btn sm icon ghost danger', type: 'button', 'aria-label': 'Remove from playlist', onclick: () => { draft.items.splice(i, 1); markDirty(); drawItems(); } }, icon('x')))),
        isOpen && timingEditor(it, () => { markDirty(); drawItems(); })]);
      return row;
    }

    function timingEditor(it, changed) {
      const s = (it.schedule ||= { startDate: '', endDate: '', days: [], startTime: '', endTime: '' });
      const set = (k) => (e) => { s[k] = e.target.value; changed(); };
      const days = h('div', { class: 'chips', role: 'group', 'aria-label': 'Days' },
        [1, 2, 3, 4, 5, 6, 0].map((d) => h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(s.days.includes(d)),
          onclick: () => { s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort(); if (s.days.length === 7) s.days = []; changed(); },
        }, PTSchedule.DAY_NAMES[d])));
      const preset = (label, fn) => h('button', { class: 'chip', type: 'button', onclick: () => { fn(); changed(); } }, label);
      const today = PTSchedule.dateKey(new Date());
      return h('div', { class: 'timing' },
        h('div', { class: 'presets' },
          preset('Always', () => Object.assign(s, { startDate: '', endDate: '', days: [], startTime: '', endTime: '' })),
          preset('Weekdays', () => { s.days = [1, 2, 3, 4, 5]; }),
          preset('Weekends', () => { s.days = [0, 6]; }),
          preset('Lunch 12–2', () => Object.assign(s, { startTime: '12:00', endTime: '14:00' })),
          preset('Evenings 5pm–close', () => Object.assign(s, { startTime: '17:00', endTime: '00:00' })),
          preset('Today only', () => Object.assign(s, { startDate: today, endDate: today }))),
        h('div', { class: 'row-2' },
          h('label', { class: 'field' }, 'Start showing on', h('input', { type: 'date', value: s.startDate, onchange: set('startDate') })),
          h('label', { class: 'field' }, 'Stop after', h('input', { type: 'date', value: s.endDate, onchange: set('endDate') }))),
        h('div', { class: 'field' }, 'Days', days, h('span', { class: 'hint' }, 'None selected = every day')),
        h('div', { class: 'row-2' },
          h('label', { class: 'field' }, 'From', h('input', { type: 'time', value: s.startTime, onchange: set('startTime') })),
          h('label', { class: 'field' }, 'Until', h('input', { type: 'time', value: s.endTime, onchange: set('endTime') }), h('span', { class: 'hint' }, 'Can run past midnight, e.g. 18:00 → 01:00'))));
    }

    function addContent() {
      const chosen = new Set();
      let filter = '';
      const listEl = h('div', { class: 'picker-list' });
      const addBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Add');
      const draw = () => {
        const assets = state.assets.slice().reverse().filter((a) => !filter || a.name.toLowerCase().includes(filter));
        listEl.replaceChildren(...(assets.length ? assets.map((a) => {
          const inPl = draft.items.some((it) => it.assetId === a.id);
          return h('label', { class: 'picker-row' },
            h('input', { type: 'checkbox', checked: chosen.has(a.id), onchange: (e) => { e.target.checked ? chosen.add(a.id) : chosen.delete(a.id); syncBtn(); } }),
            thumb(a, { tag: false }),
            h('div', {}, h('strong', {}, a.name), h('div', { class: 'small muted' }, `${TYPE_LABEL[a.type]} · ${fmtDuration(a.duration)}${inPl ? ' · already in this playlist' : ''}`)));
        }) : [h('p', { class: 'muted' }, state.assets.length ? 'Nothing matches.' : 'Your library is empty — upload or create content first.')]));
      };
      const syncBtn = () => { addBtn.disabled = !chosen.size; addBtn.textContent = chosen.size ? `Add ${chosen.size}` : 'Add'; };
      draw();
      const m = modal({
        title: 'Add content',
        body: h('div', { class: 'stack' },
          h('input', { type: 'search', placeholder: 'Search your library', oninput: (e) => { filter = e.target.value.toLowerCase(); draw(); } }),
          listEl,
          h('a', { href: '#/content', onclick: () => m.close() }, 'Go to the content library to upload or create something new')),
        footer: (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), addBtn],
      });
      addBtn.addEventListener('click', () => {
        // Keep library order for multi-select adds.
        for (const a of state.assets.filter((x) => chosen.has(x.id))) {
          draft.items.push({ id: `n${Math.random().toString(36).slice(2, 10)}`, assetId: a.id, enabled: true, duration: null, schedule: { startDate: '', endDate: '', days: [], startTime: '', endTime: '' } });
        }
        markDirty();
        drawItems();
        m.close();
      });
    }

    drawItems();

    const clock = h('input', { type: 'checkbox', checked: draft.showClock, onchange: (e) => { draft.showClock = e.target.checked; markDirty(); } });
    const ticker = h('textarea', { maxlength: 2000, placeholder: 'Bar open from 12:00 on matchdays\nMembers’ draw — Friday night', oninput: (e) => { draft.ticker = e.target.value; markDirty(); } }, draft.ticker || '');
    const screensUsing = state.screens.filter((s) => s.playlistId === id);

    return shell('playlists',
      h('div', { class: 'editor-head' },
        h('a', { class: 'btn ghost icon', href: '#/playlists', 'aria-label': 'Back to playlists' }, icon('back')),
        nameInput,
        h('a', { class: 'btn', href: `/player/?preview=${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener' }, icon('eye'), 'Preview'),
        saveBtn),
      h('div', { class: 'editor-layout' },
        h('section', { class: 'stack' },
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' },
            totals,
            h('button', { class: 'btn', type: 'button', onclick: addContent }, icon('plus'), 'Add content')),
          list),
        h('aside', { class: 'stack' },
          h('div', { class: 'card panel-box form-grid' },
            h('h2', {}, 'On-screen extras'),
            h('label', { class: 'switch' }, clock, 'Show clock'),
            h('label', { class: 'field' }, 'Scrolling ticker', ticker, h('span', { class: 'hint' }, 'One message per line. Leave empty to hide the ticker.'))),
          h('div', { class: 'card panel-box' },
            h('h2', {}, 'Screens'),
            screensUsing.length
              ? h('ul', { class: 'small', style: 'margin:0;padding-left:18px' }, screensUsing.map((s) => h('li', {}, s.name)))
              : h('p', { class: 'small muted' }, 'No screens use this playlist yet.'),
            h('a', { class: 'small', href: '#/screens' }, 'Manage screens')),
          h('button', { class: 'btn danger', type: 'button', onclick: removePlaylist }, icon('trash'), 'Delete playlist'))));
  }

  // =============================================================== screens
  let screenSlug = 'bar-tv';

  function viewScreens() {
    const playlistOptions = (selected) => [
      h('option', { value: '', selected: !selected }, '— Nothing (show splash) —'),
      ...state.playlists.map((p) => h('option', { value: p.id, selected: p.id === selected }, p.name)),
    ];
    const patch = async (s, body, msg) => {
      try {
        await api('PATCH', `/screens/${encodeURIComponent(s.id)}`, body);
        await refresh();
        toast(msg);
      } catch (err) {
        toast(err.message, 'error');
        render();
      }
    };
    const command = async (s, cmd) => {
      try {
        const r = await api('POST', `/screens/${encodeURIComponent(s.id)}/command`, { command: cmd });
        toast(r.delivered ? (cmd === 'identify' ? `Showing the name on “${s.name}” for 10 seconds` : `Reloading “${s.name}”`) : `“${s.name}” isn’t connected right now`, r.delivered ? 'ok' : 'error');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    const cards = state.screens.map((s) =>
      h('div', { class: 'card screen' },
        h('div', { class: 'screen-head' },
          h('span', { class: `dot ${s.online ? 'on' : ''}`, title: s.online ? 'Online' : 'Offline' }),
          h('input', { type: 'text', value: s.name, maxlength: 80, 'aria-label': 'Screen name', onchange: (e) => e.target.value.trim() && patch(s, { name: e.target.value }, 'Renamed') })),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Status'), h('dd', {}, s.online ? 'Online' : `Offline · last seen ${ago(s.lastSeen)}`),
          h('dt', {}, 'Screen id'), h('dd', { class: 'mono' }, s.id),
          s.resolution && [h('dt', {}, 'Resolution'), h('dd', {}, s.resolution)],
          s.ip && [h('dt', {}, 'Address'), h('dd', { class: 'mono' }, s.ip.replace(/^::ffff:/, ''))]),
        h('div', { class: 'row-2' },
          h('label', { class: 'field' }, 'Playlist', h('select', { onchange: (e) => patch(s, { playlistId: e.target.value }, 'Playlist changed — the screen updates now') }, playlistOptions(s.playlistId))),
          h('label', { class: 'field' }, 'Rotation', h('select', { onchange: (e) => patch(s, { rotation: Number(e.target.value) }, 'Rotation changed') },
            [[0, 'Landscape'], [90, 'Portrait (90°)'], [180, 'Upside down'], [270, 'Portrait (270°)']].map(([v, l]) => h('option', { value: v, selected: (s.rotation || 0) === v }, l))))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => command(s, 'identify') }, icon('target'), 'Identify'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => command(s, 'reload') }, icon('refresh'), 'Reload'),
          h('a', { class: 'btn sm', href: `/player/?screen=${encodeURIComponent(s.id)}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Open'),
          h('button', {
            class: 'btn sm ghost danger', type: 'button',
            onclick: async () => {
              if (!(await confirmDialog(`Remove “${s.name}”?`, 'If the screen is still running it will reappear with the default playlist the next time it checks in.'))) return;
              try { await api('DELETE', `/screens/${encodeURIComponent(s.id)}`); await refresh(); render(); } catch (err) { toast(err.message, 'error'); }
            },
          }, icon('trash'), 'Remove'))));

    const urlCode = h('code', {});
    const slugInput = h('input', { type: 'text', value: screenSlug, maxlength: 64, 'aria-label': 'New screen id', oninput: (e) => { screenSlug = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[-_]+/, ''); syncUrl(); } });
    const syncUrl = () => { urlCode.textContent = `${baseUrl()}/player/?screen=${screenSlug || 'my-screen'}`; };
    syncUrl();

    const howTo = h('details', { class: 'card panel-box', open: !state.screens.length },
      h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Add a screen'),
      h('ol', { class: 'steps', style: 'margin-top:14px' },
        h('li', {}, h('strong', {}, 'Raspberry Pi with the PitchTribe image: '), 'plug it into the TV and switch on. It appears here by itself, named after the Pi.'),
        h('li', {}, h('strong', {}, 'Any other screen '), '(smart TV browser, a PC or a second Pi): pick a name, then open this address full-screen on it:',
          h('div', { class: 'stack', style: 'margin-top:8px;gap:8px' },
            h('label', { class: 'field' }, 'Screen id', slugInput),
            h('div', { class: 'copy-row' }, urlCode,
              h('button', { class: 'btn sm', type: 'button', onclick: () => navigator.clipboard?.writeText(urlCode.textContent).then(() => toast('Copied'), () => toast('Copy failed — select the text instead', 'error')) }, icon('copy'), 'Copy')))),
        h('li', {}, 'Once it shows up below, choose its playlist.')));

    return shell('screens',
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Screens'), h('p', {}, 'Every display connected to PitchTribe. Updates every few seconds.'))),
      h('div', { class: 'stack' },
        howTo,
        cards.length ? h('div', { class: 'screens' }, cards) : h('div', { class: 'card empty' }, h('h2', {}, 'No screens yet'), h('p', {}, 'Follow the steps above — your first screen will appear here.'))));
  }

  // ============================================================== settings
  function viewSettings() {
    const club = h('input', { type: 'text', value: state.settings.clubName, maxlength: 80, required: true });
    const def = h('select', {},
      h('option', { value: '', selected: !state.settings.defaultPlaylistId }, '— None —'),
      state.playlists.map((p) => h('option', { value: p.id, selected: p.id === state.settings.defaultPlaylistId }, p.name)));
    const general = h('form', {
      class: 'card panel-box form-grid',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('PUT', '/settings', { clubName: club.value, defaultPlaylistId: def.value || null });
          await refresh();
          render();
          toast('Settings saved');
        } catch (err) { toast(err.message, 'error'); }
      },
    },
      h('h2', {}, 'Club'),
      h('label', { class: 'field' }, 'Club name', club, h('span', { class: 'hint' }, 'Shown on notices, menus and fixture slides.')),
      h('label', { class: 'field' }, 'Playlist for new screens', def),
      h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));

    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
    const pw = h('form', {
      class: 'card panel-box form-grid',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/settings/password', { current: cur.value, next: next.value });
          cur.value = next.value = '';
          toast('Password changed — other devices have been signed out');
        } catch (err) { toast(err.message, 'error'); }
      },
    },
      h('h2', {}, 'Admin password'),
      h('label', { class: 'field' }, 'Current password', cur),
      h('label', { class: 'field' }, 'New password', next, h('span', { class: 'hint' }, 'At least 8 characters.')),
      h('div', {}, h('button', { class: 'btn', type: 'submit' }, 'Change password')));

    const about = h('div', { class: 'card panel-box stack', style: 'gap:10px' },
      h('h2', {}, 'About'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Version'), h('dd', {}, state.version),
        h('dt', {}, 'Dashboard'), h('dd', {}, state.dashboardUrls.length ? state.dashboardUrls.join('  ') : location.origin),
        h('dt', {}, 'Content'), h('dd', {}, `${state.assets.length} items · ${fmtBytes(state.assets.reduce((n, a) => n + (a.file?.size || 0), 0))} of media`)),
      h('p', { class: 'small muted' }, 'PitchTribe is free, open-source software (MIT licence).'));

    return shell('settings',
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),
      h('div', { class: 'stack', style: 'max-width:640px' }, general, pw, about));
  }

  // ================================================================ router
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { view: parts[0] || 'content', id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function render() {
    if (!state) return;
    const r = parseRoute();
    currentView = r.view;
    if (r.view !== 'playlists' || !r.id) draft = null;
    let nodes;
    if (r.view === 'playlists' && r.id) nodes = viewPlaylist(r.id);
    else if (r.view === 'playlists') nodes = viewPlaylists();
    else if (r.view === 'screens') nodes = viewScreens();
    else if (r.view === 'settings') nodes = viewSettings();
    else nodes = viewContent();
    const y = window.scrollY;
    appEl.replaceChildren(...nodes);
    window.scrollTo(0, y);
  }

  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('You have unsaved playlist changes. Leave without saving?')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    if (location.hash !== lastHash) window.scrollTo(0, 0);
    dirty = false;
    lastHash = location.hash;
    render();
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // Keep screen status fresh without disturbing someone mid-edit.
  setInterval(async () => {
    if (!state || document.hidden) return;
    if (currentView !== 'screens') return;
    const active = document.activeElement;
    if (active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    try {
      await refresh();
      render();
    } catch { /* offline: try again later */ }
  }, 10_000);

  async function boot() {
    state = null;
    draft = null;
    dirty = false;
    try {
      const status = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json());
      if (!status.authenticated) return renderAuth(status);
      await refresh();
      if (!location.hash) history.replaceState(null, '', '#/content');
      lastHash = location.hash;
      render();
    } catch (err) {
      appEl.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'card' }, h('h1', {}, 'Can’t reach PitchTribe'), h('p', { class: 'muted' }, err.message), h('button', { class: 'btn primary', type: 'button', onclick: boot }, 'Try again'))));
    }
  }

  boot();
})();
