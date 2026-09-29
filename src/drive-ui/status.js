// Compact Drive status badge. createDriveStatus(containerEl) -> { set(state, detail), setError(err), get state, el, destroy() }
import './dialog.css';
import { h, formatClock } from './common.js';

export const DRIVE_STATES = ['idle', 'saving', 'saved', 'error', 'offline', 'conflict', 'signed-out'];

/**
 * Mapping from Extension Dev's DriveError.code -> badge state.
 * Use statusForError(err) -> { state, detail } then status.set(state, detail), or status.setError(err).
 */
export const DRIVE_ERROR_STATUS = Object.freeze({
  'not-configured': 'signed-out',
  auth: 'signed-out',
  'auth-cancelled': 'signed-out',
  offline: 'offline',
  conflict: 'conflict',
  'read-only': 'error',
  forbidden: 'error',
  quota: 'error',
  'not-found': 'error',
  http: 'error',
});
const DETAIL_TEXT = { 'not-configured': 'not set up (see README)', 'read-only': 'read-only file', quota: 'rate limited — try again shortly', forbidden: 'permission denied', 'not-found': 'file not found' };

export function statusForError(err) {
  const code = err && err.code;
  const state = DRIVE_ERROR_STATUS[code] || 'error';
  return { state, detail: { message: DETAIL_TEXT[code] || (err && err.message) || '', code, error: err } };
}

const TEXT = {
  idle: () => '',
  saving: () => 'Saving to Drive…',
  saved: (d) => 'Saved to Drive' + (d.time ? ' ' + d.time : ''),
  error: (d) => 'Drive: save failed' + (d.message ? ' — ' + d.message : ''),
  offline: () => 'Drive: offline — will retry',
  conflict: () => 'Drive: file changed on Drive — resolve to save',
  'signed-out': (d) => (d.code === 'not-configured' ? 'Drive: ' + d.message : 'Drive: signed out'),
};

/**
 * detail (all optional): string message | Date/ISO/number (for 'saved': the time to show; default now) |
 *   { message, code, time, action: { label, onClick } }  (action renders a small link-button, e.g. Retry / Sign in)
 */
export function createDriveStatus(containerEl) {
  const live = h('span', { class: 'gdui-status-live', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const badge = h('span', { class: 'gdui-status', 'data-state': 'idle', hidden: true });
  const dot = h('span', { class: 'gdui-dot', 'aria-hidden': 'true' });
  const text = h('span', { class: 'gdui-stext' });
  const actionHost = h('span', { class: 'gdui-sact' });
  badge.append(dot, text, actionHost);
  live.append(badge);
  containerEl.append(live);
  let current = 'idle';

  function normalize(state, detail) {
    let d = {};
    if (detail instanceof Error) d = { message: detail.message, code: detail.code };
    else if (typeof detail === 'string') d = state === 'saved' && !isNaN(Date.parse(detail)) && /\d{4}-\d\d-\d\d/.test(detail) ? { time: formatClock(detail) } : { message: detail };
    else if (detail instanceof Date || typeof detail === 'number') d = { time: formatClock(detail) };
    else if (detail && typeof detail === 'object') { d = { ...detail }; if (d.time != null && typeof d.time !== 'string') d.time = formatClock(d.time); else if (typeof d.time === 'string' && /\d{4}-\d\d-\d\d/.test(d.time)) d.time = formatClock(d.time); }
    if (state === 'saved' && !d.time) d.time = formatClock(new Date());
    if (detail instanceof Error && detail.code && DETAIL_TEXT[detail.code]) d.message = DETAIL_TEXT[detail.code];
    return d;
  }
  const api = {
    el: badge,
    get state() { return current; },
    set(state, detail) {
      if (!DRIVE_STATES.includes(state)) throw new Error('createDriveStatus: unknown state ' + state);
      current = state;
      const d = normalize(state, detail);
      badge.dataset.state = state;
      badge.hidden = state === 'idle';
      const t = TEXT[state](d);
      text.textContent = t;
      badge.title = d.message && state !== 'idle' ? t : '';
      actionHost.textContent = '';
      if (d.action && d.action.label && typeof d.action.onClick === 'function' && state !== 'idle') {
        actionHost.append(h('button', { type: 'button', class: 'gdui-sbtn', text: d.action.label, onClick: d.action.onClick }));
      }
    },
    setError(err) { const { state, detail } = statusForError(err); api.set(state, detail); },
    destroy() { live.remove(); },
  };
  api.set('idle');
  return api;
}
