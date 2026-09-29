// Shared helpers for the Drive UI: DOM builder, modal shell (focus trap, Esc, inert background), formatting, error mapping.
// CSP-safe: no innerHTML, no inline style attributes, no eval, no remote assets.
import './dialog.css';

let idCounter = 0;
export const uid = (p) => `${p}-${++idCounter}`;

/** Tiny DOM builder. props: class, text, on<Event> (function), any other key -> attribute (true => empty attr, false/null skipped). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('class', 'gdui-ico'); svg.setAttribute('aria-hidden', 'true');
  const paths = kind === 'folder' ? ['M1.5 3.5h4l1.5 1.5h7.5v8h-13z'] : ['M3.5 1.5h6l3 3v10h-9z', 'M9.5 1.5v3h3', 'M5.5 8h5M5.5 10.5h5'];
  for (const d of paths) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}

export function resolveTheme(theme) {
  if (theme === 'dark' || theme === 'light') return theme;
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

// ---------- formatting ----------
const toDate = (v) => (v instanceof Date ? v : new Date(v));
const valid = (d) => d instanceof Date && !isNaN(d.getTime());
export function formatFull(v) { const d = toDate(v); return valid(d) ? d.toLocaleString([], { dateStyle: 'full', timeStyle: 'medium' }) : ''; }
export function formatRelative(v, now = Date.now()) {
  const d = toDate(v); if (!valid(d)) return '—';
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 45 && s > -60) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const min = Math.round(s / 60), hr = Math.round(s / 3600), day = Math.round(s / 86400);
  if (s < 0) return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); // clock skew / future
  if (min < 60) return rtf.format(-min, 'minute');
  if (hr < 24) return rtf.format(-hr, 'hour');
  if (day < 7) return rtf.format(-day, 'day');
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
export function formatSize(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  n = Number(n);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
export function formatClock(v) { const d = toDate(v); return valid(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }

// ---------- error mapping ----------
/** Map a DriveError (or any error) to a UI kind. kind: signedout | offline | notconfigured | forbidden | notfound | quota | error */
export function classifyError(e) {
  const code = e && e.code, status = e && (e.status || (typeof code === 'number' ? code : 0));
  const msg = (e && e.message) || String(e || 'Unknown error');
  if (code === 'not-configured') return { kind: 'notconfigured', title: 'Google Drive isn\u2019t set up yet', message: 'Google Drive isn\u2019t set up yet: the extension needs an OAuth client ID, see README.' };
  if (code === 'auth-cancelled') return { kind: 'signedout', title: 'Sign-in cancelled', message: 'Sign-in was cancelled. Sign in with Google to continue.' };
  if (code === 'auth' || code === 401 || status === 401) return { kind: 'signedout', title: 'Sign in required', message: 'Sign in with Google to access your Drive files.' };
  if (code === 'offline') return { kind: 'offline', title: 'You\u2019re offline', message: 'Couldn\u2019t reach Google Drive. Check your connection and try again.' };
  if (code === 'forbidden' || code === 403 || status === 403) return { kind: 'forbidden', title: 'Permission denied', message: 'Google Drive denied access. Make sure you granted this extension permission to view your Drive files, or sign out and sign in again.' };
  if (code === 'quota') return { kind: 'quota', title: 'Too many requests', message: 'Google Drive rate limit reached. Wait a moment, then retry.' };
  if (code === 'not-found' || code === 404 || status === 404) return { kind: 'notfound', title: 'Not found', message: 'That item was not found (it may have been deleted, moved, or you lost access).' };
  return { kind: 'error', title: 'Something went wrong', message: msg };
}

/** Panel shown in place of a list: spinner / message / actions. */
export function statePanel({ title, message, spinner = false, error = false, actions = [] }) {
  const el = h('div', { class: 'gdui-state' + (error ? ' gdui-is-error' : '') });
  if (spinner) el.append(h('div', { class: 'gdui-spinner', 'aria-hidden': 'true' }));
  if (title) el.append(h('h3', { text: title }));
  if (message) el.append(h('p', { text: message }));
  if (actions.length) el.append(h('div', { class: 'gdui-actions' }, actions.map((a) => h('button', { type: 'button', class: 'gdui-btn' + (a.primary ? ' gdui-primary' : ''), text: a.label, onClick: a.onClick, 'data-action': a.id || null }))));
  return el;
}

// ---------- modal shell ----------
const stack = [];
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * createModal({theme,title,role,className,backdropCancels,cancelValue}) ->
 *   { overlay, dialog, head, titleEl, body, foot, closed, mount(focusEl), close(v), promise, onClose, ensureFocus(el) }
 * Caller fills body/foot, then calls mount(). Esc -> close(cancelValue). Tab is trapped. Background is inert. Keys don't leak to the page.
 */
export function createModal({ theme, title, role = 'dialog', className = '', backdropCancels = true, cancelValue = null } = {}) {
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'gdui gdui-overlay', 'data-theme': resolveTheme(theme) });
  const titleEl = h('h2', { class: 'gdui-title', id: uid('gdui-title'), text: title });
  const head = h('div', { class: 'gdui-head' }, h('div', { class: 'gdui-title-wrap' }, titleEl));
  const body = h('div', { class: 'gdui-body' });
  const foot = h('div', { class: 'gdui-foot' });
  const dialog = h('div', { class: 'gdui-dialog ' + className, role, 'aria-modal': 'true', 'aria-labelledby': titleEl.id, tabindex: '-1' }, head, body, foot);
  overlay.append(dialog);

  let resolve; const promise = new Promise((r) => { resolve = r; });
  const m = { overlay, dialog, head, titleEl, body, foot, closed: false, promise, onClose: null, cancelValue };
  const inerted = [];
  let downOnOverlay = false;

  const focusables = () => [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && !el.hidden && el.getClientRects().length > 0);
  m.ensureFocus = (el) => {
    if (m.closed || dialog.contains(document.activeElement) && document.activeElement !== dialog) return;
    (el && !el.disabled ? el : focusables()[0] || dialog).focus();
  };
  m.close = (value) => {
    if (m.closed) return; m.closed = true;
    const i = stack.indexOf(m); if (i >= 0) stack.splice(i, 1);
    document.removeEventListener('keydown', onDocKey, true);
    document.removeEventListener('focusin', onFocusIn, true);
    try { m.onClose && m.onClose(); } catch { /* ignore */ }
    overlay.remove();
    for (const [el, was] of inerted) el.inert = was;
    if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus();
    resolve(value);
  };
  const cancel = () => m.close(m.cancelValue);
  const onTab = (e) => {
    const f = focusables(); if (!f.length) { e.preventDefault(); dialog.focus(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || a === dialog || !dialog.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !dialog.contains(a))) { e.preventDefault(); first.focus(); }
  };
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Tab') onTab(e);
    e.stopPropagation(); // keep page shortcuts (Ctrl+S / Ctrl+O ...) from firing behind the modal
  });
  // If focus was lost (e.g. the focused element was removed), still honour Esc/Tab.
  function onDocKey(e) {
    if (stack[stack.length - 1] !== m || overlay.contains(e.target)) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === 'Tab') { e.stopPropagation(); onTab(e); }
  }
  function onFocusIn(e) { if (stack[stack.length - 1] === m && !overlay.contains(e.target)) (focusables()[0] || dialog).focus(); }
  overlay.addEventListener('mousedown', (e) => { downOnOverlay = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (backdropCancels && downOnOverlay && e.target === overlay) cancel(); downOnOverlay = false; });

  m.mount = (focusEl) => {
    for (const el of document.body.children) { inerted.push([el, el.inert]); el.inert = true; }
    stack.push(m);
    document.body.append(overlay);
    document.addEventListener('keydown', onDocKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    (focusEl || focusables()[0] || dialog).focus();
    return m;
  };
  return m;
}

/** Reusable footer button. */
export const button = (label, { primary = false, danger = false, onClick, id } = {}) =>
  h('button', { type: 'button', class: 'gdui-btn' + (primary ? ' gdui-primary' : '') + (danger ? ' gdui-danger' : ''), text: label, onClick, 'data-action': id || null });
