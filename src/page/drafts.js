// Unsaved drafts that are not open in any tab: list them, reopen one in its own tab, or discard it.
// Per-tab drafts live in chrome.storage.local under 'mdwe.draft.doc.<id>'; the two older shared slots are migrated into a per-tab slot when reopened.
export const SLOT_PREFIX = 'mdwe.draft.doc.';
const LEGACY = ['mdwe.draft', 'mdwe.draft.file'];
const store = chrome.storage.local;

// Every open editor tab holds a Web Lock on the draft slot(s) it may write ('mdwe-slot:<storage key>'), so a draft whose lock is held is open somewhere.
// Doc tabs hold an exclusive lock on their own slot; plain / ?src= tabs hold shared locks on the two older shared slots.
export const lockName = (key) => 'mdwe-slot:' + key;
export const LEGACY_KEYS = LEGACY;
// Resolves true once this tab holds the lock (kept until the tab closes), false if another tab already holds it (exclusive only).
export function holdSlot(key, { shared = false } = {}) {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request(lockName(key), shared ? { mode: 'shared' } : { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      resolve(true); return new Promise(() => {});
    });
  });
}
// Tells the background which Untitled-N numbers are in use by open tabs.
export function holdNumber(n) { if (navigator.locks) navigator.locks.request('mdwe-num-' + n, { mode: 'shared' }, () => new Promise(() => {})); }
async function heldLocks() {
  try { return new Set(((await navigator.locks.query()).held || []).map((l) => l.name)); } catch { return new Set(); }
}
export async function listDrafts(ownKey) {
  const all = await store.get(null);
  const held = await heldLocks();
  const out = [];
  for (const [key, d] of Object.entries(all)) {
    const isSlot = key.indexOf(SLOT_PREFIX) === 0;
    if (!(isSlot || LEGACY.includes(key)) || key === ownKey || !d || !d.text || !String(d.text).trim()) continue;
    if (held.has(lockName(key))) continue;
    out.push({ key, name: d.name || 'Untitled.md', text: String(d.text), savedAt: d.savedAt || 0 });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export async function isOpenElsewhere(key) { return (await heldLocks()).has(lockName(key)); }
// Returns the doc id whose tab should be opened for this draft.
export async function adoptDraft(d) {
  if (d.key.indexOf(SLOT_PREFIX) === 0) return d.key.slice(SLOT_PREFIX.length);
  const id = crypto.randomUUID();
  const rec = (await store.get(d.key))[d.key];
  await store.set({ [SLOT_PREFIX + id]: rec });
  await store.remove(d.key);
  return id;
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const ago = (t) => { if (!t) return ''; const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };

const opening = new Set(); // slot keys being opened from a dialog in this tab; hidden until their new tab has had time to take its lock
let adoptChain = Promise.resolve(); // adoptions run one at a time
export function openDraftsDialog({ ownKey, onOpen, onChange, onClose }) {
  const overlay = el('div', { className: 'drafts-overlay' });
  const box = el('div', { className: 'drafts-box', role: 'dialog', ariaLabel: 'Unsaved drafts', ariaModal: 'true' });
  const list = el('ul', { className: 'drafts-list' });
  const close = el('button', { textContent: 'Close', className: 'drafts-close' });
  box.append(el('h2', { textContent: 'Unsaved drafts' }), el('p', { className: 'drafts-hint', textContent: 'Notes you started but never saved, and that are not open in a tab. Open one to keep working on it.' }), list, close);
  overlay.append(box); document.body.append(overlay);
  const done = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); done(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...box.querySelectorAll('button:not([disabled])')]; if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  close.onclick = done; overlay.onclick = (e) => { if (e.target === overlay) done(); };
  async function render(keepFocus) {
    const items = (await listDrafts(ownKey)).filter((d) => !opening.has(d.key));
    list.replaceChildren();
    if (!items.length) list.append(el('li', { className: 'drafts-empty', textContent: 'No unsaved drafts.' }));
    for (const d of items) {
      const open = el('button', { textContent: 'Open in new tab', className: 'drafts-open' });
      const del = el('button', { textContent: 'Discard', className: 'drafts-discard' });
      const row = el('li', { className: 'drafts-item', 'data-draft-key': d.key },
        el('div', { className: 'drafts-main' }, el('strong', { textContent: d.name, title: d.name }), el('span', { className: 'drafts-when', textContent: ' ' + ago(d.savedAt) }), el('div', { className: 'drafts-snippet', textContent: d.text.replace(/\s+/g, ' ').trim().slice(0, 110) })),
        el('div', { className: 'drafts-actions' }, open, del));
      open.onclick = () => {
        if (opening.has(d.key)) return;
        opening.add(d.key); row.remove(); // gone from the list at once: a second click can't open a second editor on the same slot
        if (!list.children.length) render();
        adoptChain = adoptChain.then(async () => {
          try {
            if (await isOpenElsewhere(d.key)) return; // it was opened by another tab meanwhile
            await onOpen(await adoptDraft(d));
          } finally { setTimeout(() => { opening.delete(d.key); onChange && onChange(); }, 2500); onChange && onChange(); }
        }).catch(() => {});
      };
      del.onclick = async () => {
        if (!confirm('Discard "' + d.name + '"? This cannot be undone.')) return;
        if (await isOpenElsewhere(d.key) || opening.has(d.key)) { alert('"' + d.name + '" was opened in a tab in the meantime, so it was not discarded.'); await render(); return; }
        await store.remove(d.key); await render(); onChange && onChange();
      };
      list.append(row);
    }
    if (!keepFocus) close.focus();
  }
  render();
  return { close: done };
}
export async function countDrafts(ownKey) { return (await listDrafts(ownKey)).length; }
