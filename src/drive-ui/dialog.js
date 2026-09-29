// "Open from Drive" and "Save to Drive" modal dialogs. Dependency-free ES module, CSP-safe (DOM built with createElement, styles via classes).
import { h, icon, uid, createModal, button, statePanel, classifyError, formatRelative, formatFull, formatSize } from './common.js';

const DEBOUNCE_MS = 300;
const call = (fn) => { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } };

/** Minimal listbox controller: keeps `items` [{el,data}], selection index, aria-activedescendant on `owners`. */
function createListbox(ul, { owners = [], onActivate, onSelect } = {}) {
  const lb = { items: [], index: -1 };
  const setActive = (id) => { for (const o of [ul, ...owners]) { if (id) o.setAttribute('aria-activedescendant', id); else o.removeAttribute('aria-activedescendant'); } };
  lb.select = (i, { scroll = true } = {}) => {
    if (!lb.items.length) { lb.index = -1; setActive(null); onSelect && onSelect(null); return; }
    i = Math.max(0, Math.min(lb.items.length - 1, i));
    if (lb.index >= 0 && lb.items[lb.index]) lb.items[lb.index].el.setAttribute('aria-selected', 'false');
    lb.index = i;
    const it = lb.items[i]; it.el.setAttribute('aria-selected', 'true'); setActive(it.el.id);
    if (scroll && it.el.scrollIntoView) it.el.scrollIntoView({ block: 'nearest' });
    onSelect && onSelect(it.data);
  };
  lb.clear = () => { ul.textContent = ''; lb.items = []; lb.index = -1; setActive(null); onSelect && onSelect(null); };
  lb.add = (data, el) => {
    el.id = uid('gdui-opt'); el.setAttribute('role', 'option'); el.setAttribute('aria-selected', 'false');
    const i = lb.items.length; lb.items.push({ el, data });
    el.addEventListener('click', () => lb.select(i, { scroll: false }));
    el.addEventListener('dblclick', () => { lb.select(i, { scroll: false }); onActivate && onActivate(data); });
    ul.append(el);
  };
  lb.selected = () => (lb.index >= 0 ? lb.items[lb.index].data : null);
  lb.key = (e, { fromInput = false } = {}) => {
    const n = lb.items.length, page = 8;
    switch (e.key) {
      case 'ArrowDown': lb.select(lb.index < 0 ? 0 : lb.index + 1); break;
      case 'ArrowUp': lb.select(lb.index < 0 ? n - 1 : lb.index - 1); break;
      case 'PageDown': lb.select(lb.index + page); break;
      case 'PageUp': lb.select(lb.index - page); break;
      case 'Home': if (fromInput) return false; lb.select(0); break;
      case 'End': if (fromInput) return false; lb.select(n - 1); break;
      default: return false;
    }
    e.preventDefault(); return true;
  };
  ul.addEventListener('keydown', (e) => {
    if (lb.key(e)) return;
    if (e.key === 'Enter' && lb.selected()) { e.preventDefault(); onActivate && onActivate(lb.selected()); }
  });
  return lb;
}

const liveRegion = () => h('div', { class: 'gdui-vh', role: 'status', 'aria-live': 'polite' });

// ======================================================================================
// Open from Drive
// ======================================================================================
/**
 * openDriveDialog({ api, theme, onPick }) -> Promise<{id,name,modifiedTime,size,canEdit}|null>
 * onPick(file) is optional; if it returns a promise the dialog stays open ("Opening…") until it settles;
 * rejection keeps the dialog open and shows the error, resolution closes it.
 */
export function openDriveDialog({ api, theme, onPick } = {}) {
  const m = createModal({ theme, title: 'Open from Drive', cancelValue: null });
  const live = liveRegion();
  const accountEl = h('span', { class: 'gdui-account' });
  m.head.append(accountEl);

  const search = h('input', { type: 'search', class: 'gdui-input', placeholder: 'Search Markdown files by name (empty = recent)', 'aria-label': 'Search Drive files by name', autocomplete: 'off', spellcheck: 'false' });
  const banner = h('div', { class: 'gdui-banner', role: 'status', hidden: true });
  const ul = h('ul', { class: 'gdui-list', role: 'listbox', 'aria-label': 'Drive files', tabindex: '0' });
  const colhead = h('div', { class: 'gdui-colhead', 'aria-hidden': 'true' }, h('span', { text: 'Name' }), h('span', { text: 'Modified' }), h('span', { class: 'gdui-num', text: 'Size' }));
  const stateHost = h('div', { class: 'gdui-state-host' });
  stateHost.hidden = true;
  const moreHost = h('div', { class: 'gdui-more', hidden: true });
  const listwrap = h('div', { class: 'gdui-listwrap' }, colhead, ul, stateHost, moreHost);
  search.setAttribute('aria-controls', ul.id = uid('gdui-list'));
  m.body.append(search, banner, listwrap, live);

  const signOutLink = h('button', { type: 'button', class: 'gdui-link', text: 'Sign out', hidden: true });
  const openingEl = h('span', { class: 'gdui-opening', hidden: true }, h('span', { class: 'gdui-spinner gdui-sm', 'aria-hidden': 'true' }), 'Opening…');
  const cancelBtn = button('Cancel', { onClick: () => m.close(null), id: 'cancel' });
  const openBtn = button('Open', { primary: true, onClick: () => activate(lb.selected()), id: 'open' });
  openBtn.disabled = true;
  m.foot.append(h('div', { class: 'gdui-grow' }, signOutLink, openingEl), cancelBtn, openBtn);

  let seq = 0, nextPageToken = null, query = '', timer = null, busy = false, opening = false, signedIn = null;
  const lb = createListbox(ul, { owners: [search], onActivate: (f) => activate(f), onSelect: (f) => { openBtn.disabled = !f || opening; } });
  m.onClose = () => { clearTimeout(timer); seq++; removeEventListener('online', onOnline); removeEventListener('offline', onOffline); };

  const showList = (on) => { ul.hidden = !on; colhead.hidden = !on; };
  function showState(opts) { // replaces the list with a message panel
    lb.clear(); showList(false); moreHost.hidden = true; nextPageToken = null;
    stateHost.textContent = ''; stateHost.hidden = false; stateHost.className = 'gdui-state-host gdui-state-fill';
    const p = statePanel(opts); stateHost.append(p);
    live.textContent = [opts.title, opts.message].filter(Boolean).join('. ');
    return p;
  }
  const hideState = () => { stateHost.hidden = true; stateHost.textContent = ''; showList(true); };
  const signInAction = () => ({ id: 'signin', label: 'Sign in with Google', primary: true, onClick: doSignIn });
  const retryAction = (primary = true) => ({ id: 'retry', label: 'Retry', primary, onClick: () => load({ reset: true }) });

  function setSignedIn(v) { signedIn = v; signOutLink.hidden = !v; if (!v) accountEl.textContent = ''; }

  function renderRow(f) {
    const nameCell = h('span', { class: 'gdui-fname' }, icon('file'), h('span', { text: f.name || '(untitled)', title: f.name || '' }));
    if (f.canEdit === false) nameCell.append(h('span', { class: 'gdui-badge', text: 'Read-only', title: 'You only have view access to this file' }));
    const full = f.modifiedTime ? formatFull(f.modifiedTime) : '';
    const row = h('li', { class: 'gdui-row', title: f.name || '' },
      nameCell,
      h('span', { class: 'gdui-cell', text: f.modifiedTime ? formatRelative(f.modifiedTime) : '—', title: full }),
      h('span', { class: 'gdui-cell gdui-num', text: formatSize(f.size) }));
    lb.add(f, row);
  }
  function renderMore(error) {
    moreHost.textContent = '';
    if (!nextPageToken) { moreHost.hidden = true; return; }
    moreHost.hidden = false;
    if (error) moreHost.append(h('span', { class: 'gdui-err', text: 'Couldn\u2019t load more: ' + classifyError(error).message }));
    if (busy) moreHost.append(h('span', { class: 'gdui-spinner gdui-sm', 'aria-hidden': 'true' }), h('span', { class: 'gdui-muted', text: 'Loading…' }));
    else moreHost.append(h('button', { type: 'button', class: 'gdui-btn', text: error ? 'Retry' : 'Load more', 'data-action': 'more', onClick: () => load({ reset: false }) }));
  }

  async function load({ reset }) {
    const my = ++seq; busy = true;
    if (reset) { showState({ title: 'Loading…', spinner: true }); stateHost.setAttribute('aria-busy', 'true'); }
    else renderMore();
    banner.hidden = navigator.onLine !== false; if (navigator.onLine === false) { banner.textContent = 'You\u2019re offline. Showing what was loaded; new requests may fail.'; banner.hidden = false; }
    if (reset && navigator.onLine === false) {
      busy = false; stateHost.removeAttribute('aria-busy');
      showState({ title: 'You\u2019re offline', message: 'Google Drive can\u2019t be reached without an internet connection. This will reload automatically when you\u2019re back online.', error: true, actions: [retryAction(false)] });
      banner.hidden = true; return;
    }
    try {
      if (reset && typeof api.isSignedIn === 'function') {
        const ok = await call(() => api.isSignedIn());
        if (my !== seq) return;
        setSignedIn(!!ok);
        if (!ok) { busy = false; showState({ title: 'Sign in to Google Drive', message: 'Sign in to browse and open Markdown files from your Drive.', actions: [signInAction()] }); focusSoon(); return; }
        loadAccount();
      }
      const res = await call(() => api.listFiles({ query, pageToken: reset ? undefined : nextPageToken }));
      if (my !== seq) return;
      busy = false; stateHost.removeAttribute('aria-busy');
      const files = (res && res.files) || [];
      nextPageToken = (res && res.nextPageToken) || null;
      if (signedIn === null) setSignedIn(true);
      if (reset) {
        if (!files.length) {
          showState(query
            ? { title: 'No matching files', message: `Nothing found for \u201c${query}\u201d. Only Markdown/text files are shown.` }
            : { title: 'No Markdown files yet', message: 'No Markdown files were found in your Drive.' });
          return;
        }
        hideState();
      }
      const prevCount = lb.items.length;
      files.forEach(renderRow);
      renderMore();
      if (reset) lb.select(0, { scroll: false });
      live.textContent = reset ? `${files.length} file${files.length === 1 ? '' : 's'}${nextPageToken ? ', more available' : ''}` : `${files.length} more loaded, ${lb.items.length} total`;
      if (!reset && files.length && prevCount === 0) lb.select(0);
    } catch (e) {
      if (my !== seq) return;
      busy = false; stateHost.removeAttribute('aria-busy');
      if (!reset) { renderMore(e); return; }
      handleListError(e);
    }
  }
  function handleListError(e) {
    const c = classifyError(e);
    if (c.kind === 'signedout') { setSignedIn(false); showState({ title: c.title, message: c.message, actions: [signInAction()] }); }
    else if (c.kind === 'notconfigured') showState({ title: c.title, message: c.message, error: true });
    else if (c.kind === 'forbidden') showState({ title: c.title, message: c.message, error: true, actions: [retryAction(true), { id: 'signin', label: 'Sign in again', onClick: doSignIn }] });
    else if (c.kind === 'offline') showState({ title: c.title, message: c.message, error: true, actions: [retryAction()] });
    else showState({ title: c.title, message: c.message, error: true, actions: [retryAction()] });
    focusSoon();
  }
  function focusSoon() { m.ensureFocus(search); }
  async function loadAccount() {
    if (typeof api.getAccountLabel !== 'function') return;
    try { const l = await call(() => api.getAccountLabel()); if (!m.closed && l && signedIn) accountEl.textContent = String(l); } catch { /* optional */ }
  }
  async function doSignIn() {
    const btn = stateHost.querySelector('[data-action="signin"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try { await call(() => api.signIn()); if (m.closed) return; setSignedIn(true); await load({ reset: true }); }
    catch (e) {
      if (m.closed) return;
      const c = classifyError(e);
      if (c.kind === 'notconfigured') showState({ title: c.title, message: c.message, error: true });
      else showState({ title: c.title === 'Sign-in cancelled' ? c.title : 'Sign-in failed', message: e && e.code === 'auth-cancelled' ? c.message : (e && e.message) || c.message, error: e && e.code !== 'auth-cancelled', actions: [signInAction()] });
      focusSoon();
    }
  }
  async function doSignOut() {
    signOutLink.disabled = true;
    try { await call(() => api.signOut()); } catch { /* still show signed-out */ }
    signOutLink.disabled = false;
    if (m.closed) return;
    seq++; setSignedIn(false);
    showState({ title: 'Signed out', message: 'You\u2019re signed out of Google Drive.', actions: [signInAction()] });
    m.ensureFocus(stateHost.querySelector('button'));
  }
  async function activate(f) {
    if (!f || opening) return;
    const pick = { id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size, canEdit: f.canEdit };
    if (typeof onPick !== 'function') return m.close(pick);
    let r;
    try { r = onPick(pick); } catch (e) { return showPickError(e); }
    if (r && typeof r.then === 'function') {
      opening = true; openBtn.disabled = true; openingEl.hidden = false; live.textContent = 'Opening ' + f.name;
      try { await r; } catch (e) { opening = false; openingEl.hidden = true; openBtn.disabled = !lb.selected(); return showPickError(e); }
      opening = false;
    }
    m.close(pick);
  }
  function showPickError(e) { banner.textContent = 'Couldn\u2019t open the file: ' + classifyError(e).message; banner.hidden = false; live.textContent = banner.textContent; }

  const onOnline = () => { banner.hidden = true; if (stateHost.querySelector('[data-action="retry"]') && !busy) load({ reset: true }); };
  const onOffline = () => { if (lb.items.length) { banner.textContent = 'You\u2019re offline. Showing what was loaded; new requests may fail.'; banner.hidden = false; } };
  addEventListener('online', onOnline); addEventListener('offline', onOffline);

  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (search.value.trim() === query) return; query = search.value.trim(); load({ reset: true }); }, DEBOUNCE_MS);
  });
  search.addEventListener('keydown', (e) => {
    if (lb.key(e, { fromInput: true })) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (timer) { clearTimeout(timer); timer = null; const q = search.value.trim(); if (q !== query) { query = q; load({ reset: true }); return; } }
      activate(lb.selected());
    }
  });
  signOutLink.addEventListener('click', doSignOut);

  m.mount(search);
  showState({ title: 'Loading…', spinner: true });
  load({ reset: true });
  return m.promise;
}

// ======================================================================================
// Save to Drive
// ======================================================================================
const MD_EXT = /\.(md|markdown|mdown)$/i;
/** Same rule as api.createFile: append .md unless the name already ends in .md/.markdown/.mdown. */
export function normalizeDriveName(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  return MD_EXT.test(n) ? n : n.replace(/\.+$/, '') + '.md';
}
function validateName(name) {
  const n = String(name || '').trim();
  if (!n || /^\.+$/.test(n) || n === '.md') return 'Enter a file name.';
  if (/[\\/]/.test(n)) return 'File names can\u2019t contain / or \\.';
  if (normalizeDriveName(n).length > 255) return 'That name is too long.';
  return '';
}

/**
 * saveToDriveDialog({ api, defaultName, theme }) -> Promise<{name, parentId?}|null>
 * parentId is omitted for "My Drive" (root). Folder chooser is shown only if api.listFolders exists.
 */
export function saveToDriveDialog({ api, defaultName = 'Untitled.md', theme } = {}) {
  const m = createModal({ theme, title: 'Save to Drive', className: 'gdui-narrow', cancelValue: null });
  const live = liveRegion();
  const nameId = uid('gdui-name');
  const input = h('input', { type: 'text', class: 'gdui-input', id: nameId, value: defaultName, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': nameId + '-hint' });
  const hint = h('p', { class: 'gdui-hint', id: nameId + '-hint' });
  const errEl = h('div', { class: 'gdui-error-line', role: 'alert', hidden: true });
  m.body.append(h('div', {}, h('label', { class: 'gdui-label', for: nameId, text: 'File name' }), input, hint, errEl));

  const hasFolders = typeof (api && api.listFolders) === 'function';
  const path = [{ id: undefined, name: 'My Drive' }]; // stack; last = current folder
  let fSeq = 0, fToken = null, fBusy = false;
  let folderUl, fb, crumbs, upBtn, fMore, fState, foldersWrap;
  if (hasFolders) {
    crumbs = h('div', { class: 'gdui-crumbs' });
    upBtn = h('button', { type: 'button', class: 'gdui-btn gdui-up', text: '↑ Up', 'aria-label': 'Up one folder', 'data-action': 'up', onClick: goUp });
    folderUl = h('ul', { class: 'gdui-list', role: 'listbox', 'aria-label': 'Folders (Enter opens the folder)', tabindex: '0' });
    fMore = h('div', { class: 'gdui-more', hidden: true });
    fState = h('div', { class: 'gdui-state-host', hidden: true });
    foldersWrap = h('div', { class: 'gdui-folders' },
      h('span', { class: 'gdui-label', text: 'Location' }), h('div', { class: 'gdui-crumbs' }, crumbs, upBtn),
      h('div', { class: 'gdui-listwrap' }, folderUl, fState, fMore));
    // (crumbs is inside the flex row above)
    m.body.append(foldersWrap);
    fb = createListbox(folderUl, { onActivate: (f) => enter(f) });
  }
  m.body.append(live);

  const signInBtn = h('button', { type: 'button', class: 'gdui-btn', text: 'Sign in with Google', 'data-action': 'signin', hidden: true, onClick: doSignIn });
  const cancelBtn = button('Cancel', { onClick: () => m.close(null), id: 'cancel' });
  const saveBtn = button('Save', { primary: true, onClick: submit, id: 'save' });
  m.foot.append(h('div', { class: 'gdui-grow' }, signInBtn), cancelBtn, saveBtn);

  function refreshHint() {
    const err = validateName(input.value);
    const final = normalizeDriveName(input.value);
    hint.textContent = err ? '' : `Will be saved as \u201c${final}\u201d in ${path.map((p) => p.name).join(' / ')}`;
    saveBtn.disabled = !!err;
    return err;
  }
  function submit() {
    const err = refreshHint();
    if (err) { errEl.textContent = err; errEl.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    const cur = path[path.length - 1];
    const out = { name: normalizeDriveName(input.value) };
    if (cur.id) out.parentId = cur.id;
    m.close(out);
  }
  input.addEventListener('input', () => { errEl.hidden = true; input.removeAttribute('aria-invalid'); refreshHint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (fb && fb.key(e, { fromInput: true })) return;
  });

  // ---- folders ----
  function renderCrumbs() {
    crumbs.textContent = '';
    crumbs.append(h('span', { text: 'Saving in:' }), h('strong', { text: path.map((p) => p.name).join(' / ') }));
    upBtn.disabled = path.length <= 1;
    refreshHint();
  }
  function goUp() { if (path.length > 1) { path.pop(); loadFolders(true); } }
  function enter(f) { path.push({ id: f.id, name: f.name }); loadFolders(true); }
  function showFolderState(opts) { fb.clear(); folderUl.hidden = true; fMore.hidden = true; fState.textContent = ''; fState.hidden = false; fState.className = 'gdui-state-host gdui-state-fill'; fState.append(statePanel(opts)); }
  function renderFMore(error) {
    fMore.textContent = '';
    if (!fToken) { fMore.hidden = true; return; }
    fMore.hidden = false;
    if (error) fMore.append(h('span', { class: 'gdui-err', text: 'Couldn\u2019t load more folders.' }));
    if (fBusy) fMore.append(h('span', { class: 'gdui-spinner gdui-sm', 'aria-hidden': 'true' }));
    else fMore.append(h('button', { type: 'button', class: 'gdui-btn', text: error ? 'Retry' : 'Load more', onClick: () => loadFolders(false) }));
  }
  async function loadFolders(reset) {
    const my = ++fSeq; fBusy = true; renderCrumbs();
    if (reset) { fToken = null; showFolderState({ title: 'Loading folders…', spinner: true }); } else renderFMore();
    if (navigator.onLine === false && reset) { fBusy = false; showFolderState({ title: 'You\u2019re offline', message: 'Folders can\u2019t be listed offline. You can still save to the selected location.', error: true, actions: [{ id: 'retry', label: 'Retry', onClick: () => loadFolders(true) }] }); return; }
    try {
      if (reset && typeof api.isSignedIn === 'function') {
        const ok = await call(() => api.isSignedIn()); if (my !== fSeq) return;
        signInBtn.hidden = !!ok; saveBtn.disabled = !ok || !!validateName(input.value);
        if (!ok) { fBusy = false; showFolderState({ title: 'Sign in to Google Drive', message: 'Sign in to choose a folder and save the file.', actions: [{ id: 'signin', label: 'Sign in with Google', primary: true, onClick: doSignIn }] }); return; }
      }
      const cur = path[path.length - 1];
      const res = await call(() => api.listFolders({ parentId: cur.id || 'root', pageToken: reset ? undefined : fToken }));
      if (my !== fSeq) return;
      fBusy = false; fToken = (res && res.nextPageToken) || null;
      const list = (res && (res.folders || res.files)) || [];
      if (reset) {
        fb.clear(); fState.hidden = true; fState.textContent = ''; folderUl.hidden = false;
        if (!list.length) { showFolderState({ title: 'No subfolders', message: 'This location has no folders. The file will be saved here.' }); return; }
      }
      for (const f of list) {
        const row = h('li', { class: 'gdui-row gdui-folder-row', title: f.name }, h('span', { class: 'gdui-fname' }, icon('folder'), h('span', { text: f.name })));
        fb.add(f, row);
      }
      renderFMore();
      if (reset) fb.select(0, { scroll: false });
      live.textContent = `${list.length} folder${list.length === 1 ? '' : 's'}`;
    } catch (e) {
      if (my !== fSeq) return; fBusy = false;
      if (!reset) return renderFMore(e);
      const c = classifyError(e);
      if (c.kind === 'signedout') { signInBtn.hidden = false; saveBtn.disabled = true; showFolderState({ title: c.title, message: c.message, actions: [{ id: 'signin', label: 'Sign in with Google', primary: true, onClick: doSignIn }] }); }
      else showFolderState({ title: c.title, message: c.message + ' You can still save to the selected location.', error: true, actions: c.kind === 'notconfigured' ? [] : [{ id: 'retry', label: 'Retry', onClick: () => loadFolders(true) }] });
    }
  }
  async function doSignIn() {
    signInBtn.disabled = true;
    try { await call(() => api.signIn()); if (m.closed) return; signInBtn.disabled = false; if (hasFolders) loadFolders(true); else { signInBtn.hidden = true; refreshHint(); } }
    catch (e) { if (m.closed) return; signInBtn.disabled = false; const c = classifyError(e); errEl.textContent = e && e.code === 'auth-cancelled' ? c.message : c.kind === 'notconfigured' ? c.message : 'Sign-in failed: ' + c.message; errEl.hidden = false; }
  }

  m.mount(input);
  input.select();
  refreshHint();
  if (hasFolders) loadFolders(true);
  else if (api && typeof api.isSignedIn === 'function') {
    call(() => api.isSignedIn()).then((ok) => { if (m.closed) return; signInBtn.hidden = !!ok; if (!ok) saveBtn.disabled = true; }).catch(() => {});
  }
  return m.promise;
}
