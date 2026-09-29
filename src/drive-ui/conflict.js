// "Drive file changed" conflict dialog.
import { h, uid, createModal, formatFull, formatRelative } from './common.js';

/**
 * confirmConflict({ name, remoteModifiedTime, localModifiedTime?, theme? }) -> Promise<'overwrite'|'reload'|'save-copy'|'cancel'>
 * Default focus is Cancel. Esc / backdrop => 'cancel'. Arrow Up/Down move between the buttons.
 */
export function confirmConflict({ name, remoteModifiedTime, localModifiedTime, theme } = {}) {
  const m = createModal({ theme, title: 'This file changed on Drive', className: 'gdui-conflict', role: 'alertdialog', cancelValue: 'cancel', backdropCancels: false });
  const descId = uid('gdui-desc');
  m.dialog.setAttribute('aria-describedby', descId);

  const rows = [];
  if (remoteModifiedTime) rows.push(['On Drive:', `${formatFull(remoteModifiedTime)} (${formatRelative(remoteModifiedTime)})`]);
  if (localModifiedTime) rows.push(['Your copy loaded/edited:', formatFull(localModifiedTime)]);
  const times = rows.length ? h('dl', { class: 'gdui-times' }, rows.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])) : null;

  const choice = (value, title, sub, cls = '') =>
    h('button', { type: 'button', class: 'gdui-choice ' + cls, 'data-choice': value, onClick: () => m.close(value) }, h('b', { text: title }), sub ? h('span', { class: 'gdui-sub', text: sub }) : null);

  const cancel = choice('cancel', 'Cancel', null, 'gdui-cancel');
  const choices = h('div', { class: 'gdui-choices', role: 'group', 'aria-label': 'Resolve conflict' },
    choice('overwrite', 'Overwrite Drive version', 'Replace the version on Drive with what\u2019s in the editor. The other changes on Drive are lost.', 'gdui-danger'),
    choice('reload', 'Reload from Drive (discard my edits)', 'Load the current Drive version. Your unsaved edits here are lost.'),
    choice('save-copy', 'Save as a copy', 'Keep both: save your edits to a new file on Drive and leave the original untouched.'),
    cancel);
  choices.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const b = [...choices.querySelectorAll('button')], i = b.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); b[(i + (e.key === 'ArrowDown' ? 1 : b.length - 1)) % b.length].focus();
  });

  m.body.append(
    h('p', { class: 'gdui-msg', id: descId },
      h('b', { text: name || 'This file' }), ' was modified on Google Drive after you opened it. ',
      'If you save now, you could overwrite someone else\u2019s changes (or your own changes from another device). Choose what to do:'),
    times, choices);
  m.foot.hidden = true;
  m.mount(cancel);
  return m.promise;
}
