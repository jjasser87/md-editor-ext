import { createEditor } from '../editor/index.js';
import * as files from './files.js';
import { createDriveApi } from '../drive/api.js';
import { openDriveDialog, saveToDriveDialog, confirmConflict, createDriveStatus, statusForError } from '../drive-ui/index.js';

import { SLOT_PREFIX, LEGACY_KEYS, holdSlot, holdNumber, openDraftsDialog, countDrafts } from './drafts.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'mdwe.draft';           // untitled (never opened/saved) document
const FILE_DRAFT_KEY = 'mdwe.draft.file'; // draft of a document that came from a file (separate slot so it can't clobber the untitled draft)
const THEME_KEY = 'mdwe.theme';
const AUTOSAVE_MS = 800;

const state = { slot: null, loaded: false, drive: null, handle: null, name: 'Untitled.md', savedText: '', dirty: false, theme: 'light', source: false };
let editor = null;
let draftTimer = null;
let driveApi = createDriveApi();
let driveStatus = null;
let driveBusy = false; // one Drive read/write at a time
let suppress = false; // ignore onChange fired by programmatic setMarkdown

const store = chrome.storage.local;
const storeGet = (k) => store.get(k).then((r) => r[k]);

function setStatus(msg, ms = 2500) {
  const el = $('status'); el.textContent = msg;
  if (msg && ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, ms);
}
function renderTitle() {
  const el = $('filename');
  el.textContent = state.name; el.classList.toggle('dirty', state.dirty);
  document.title = (state.dirty ? '• ' : '') + state.name + ' — Markdown Editor';
}
function applyTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  editor && editor.setTheme && editor.setTheme(t);
  store.set({ [THEME_KEY]: t });
}

function loadDoc({ handle, name, text }, { keepDraft = false, drive = null } = {}) {
  const prevKey = draftKey();
  state.loaded = true; state.drive = drive; state.handle = handle; state.name = name; state.savedText = text; state.dirty = false;
  suppress = true;
  editor.setMarkdown(text);
  suppress = false;
  // Round-trip may normalize markdown; baseline for "dirty" is the normalized output.
  state.savedText = editor.getMarkdown();
  if (!keepDraft) { clearTimeout(draftTimer); store.remove(prevKey); } // only the slot of the document being replaced; a draft kept in the other slot (e.g. an untitled draft parked by ?src=) survives
  renderTitle();
  driveStatus && driveStatus.set('idle');
  if (drive) setStatus('Opened ' + name + ' from Drive' + (drive.canEdit === false ? ' (read-only: use Save to Drive to save a copy)' : ''), 4000);
  else setStatus(handle ? 'Opened ' + name : 'Opened ' + name + ' (read-only source: Ctrl+S will ask where to save)', handle ? 2500 : 6000);
}

let dirtyTimer = null;
function onChange() {
  if (suppress) return;
  if (!state.dirty) { state.dirty = true; renderTitle(); } // optimistic, cheap
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => { // debounced exact check (avoids serializing on every keystroke)
    state.dirty = editor.getMarkdown() !== state.savedText;
    renderTitle();
  }, 250);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, AUTOSAVE_MS);
}
function saveDraft() {
  state.dirty = editor.getMarkdown() !== state.savedText;
  if (!state.dirty) return clearDraft();
  store.set({ [draftKey()]: { text: editor.getMarkdown(), name: state.name, savedAt: Date.now(), drive: state.drive ? { id: state.drive.id, modifiedTime: state.drive.modifiedTime, canEdit: state.drive.canEdit } : null } })
    .then(() => setStatus('Draft autosaved', 1200))
    .catch(() => setStatus('Draft autosave failed'));
}
// A tab opened from the toolbar icon (?new=N / ?doc=ID) has its own draft slot; a plain page load keeps the two older shared slots.
function draftKey() { return state.slot || (state.loaded ? FILE_DRAFT_KEY : DRAFT_KEY); }
function clearDraft() { clearTimeout(draftTimer); store.remove(draftKey()); }

async function doOpen() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  try {
    loadDoc(files.hasFSA() ? await files.openWithPicker() : await files.openWithInput($('fallback-input')));
  } catch (e) { if (e.name !== 'AbortError') setStatus('Open failed: ' + e.message, 5000); }
}
async function doSaveAs() {
  const text = editor.getMarkdown();
  if (!files.hasFSA()) return doDownload();
  try {
    const handle = await files.pickSaveHandle(state.name);
    await files.writeHandle(handle, text);
    state.handle = handle; state.drive = null; state.name = handle.name; state.savedText = text; state.dirty = false; markEditorSaved(text);
    clearDraft(); renderTitle(); setStatus('Saved');
  } catch (e) { if (e.name !== 'AbortError') setStatus('Save failed: ' + e.message, 5000); }
}
async function doSave() {
  if (state.drive) return doSaveDrive();
  if (!state.handle) return doSaveAs();
  const text = editor.getMarkdown();
  try {
    await files.writeHandle(state.handle, text);
    state.savedText = text; state.dirty = false; markEditorSaved(text); clearDraft(); renderTitle(); setStatus('Saved');
  } catch (e) { setStatus('Save failed: ' + e.message, 5000); }
}
function doDownload() {
  const text = editor.getMarkdown();
  files.downloadText(state.name.match(/\.(md|markdown|mdown)$/i) ? state.name : state.name + '.md', text);
  setStatus('Downloaded');
}

// Print / Save as PDF: Chrome's print dialog offers "Save as PDF", so window.print() needs no permission or library.
let printing = false;
async function doPrint() {
  if (printing) return;
  printing = true;
  try { if (editor.prepareForPrint) await editor.prepareForPrint(); } // let diagrams/equations finish rendering first
  catch (e) { setStatus('Print preparation failed: ' + e.message, 4000); }
  finally { printing = false; }
  window.print();
}

// ---------- Google Drive ----------
function markEditorSaved(text) { if (editor.markSaved && editor.getMarkdown() === text) editor.markSaved(); } // reset the editor's byte-exact baseline (skip if the user kept typing)
function afterDriveWrite(text, file) {
  markEditorSaved(text);
  state.savedText = text;
  state.dirty = editor.getMarkdown() !== text; // user may have kept typing during the upload
  if (file.name) state.name = file.name;
  clearTimeout(draftTimer);
  if (state.dirty) draftTimer = setTimeout(saveDraft, AUTOSAVE_MS); else store.remove(draftKey());
  renderTitle();
  driveStatus.set('saved');
}
async function withDrive(fn) {
  if (driveBusy) { setStatus('A Drive operation is already in progress', 2500); return; }
  driveBusy = true;
  try { return await fn(); } finally { driveBusy = false; }
}
async function doOpenDrive() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  await withDrive(async () => {
    let doc = null;
    const picked = await openDriveDialog({ api: driveApi, theme: state.theme, onPick: async (f) => { doc = await driveApi.readFile(f.id); } });
    if (!picked || !doc) return;
    loadDoc({ handle: null, name: doc.name, text: doc.text }, { drive: { id: doc.id, modifiedTime: doc.modifiedTime, canEdit: doc.canEdit } });
  });
}
// Create a NEW Drive file from the current text (first save, or "save a copy").
async function createOnDrive(defaultName) {
  const text = editor.getMarkdown();
  const target = await saveToDriveDialog({ api: driveApi, defaultName, theme: state.theme });
  if (!target) return false;
  driveStatus.set('saving');
  try {
    const r = await driveApi.createFile(target.name, text, { parentId: target.parentId });
    const oldKey = draftKey(); // slot the doc was autosaved to before it became a Drive file
    state.drive = { id: r.id, modifiedTime: r.modifiedTime, canEdit: r.canEdit !== false };
    state.handle = null; state.loaded = true;
    store.remove(oldKey); // otherwise the stale untitled draft restores as a dirty, unlinked doc -> duplicate file
    afterDriveWrite(text, r);
    return true;
  } catch (e) { reportDriveError(e); return false; }
}
function isDirtyNow() { return editor.getMarkdown() !== state.savedText; } // getMarkdown() returns the untouched original text until the doc is edited
// Show a Drive error in the badge; sign-in problems get a Sign in button that signs in and retries the save.
function reportDriveError(e) {
  const { state: st, detail } = statusForError(e);
  if (e && (e.code === 'auth' || e.code === 'auth-cancelled')) {
    detail.action = { label: 'Sign in', onClick: async () => {
      try { await driveApi.signIn(); doSaveDrive(); } catch (e2) { reportDriveError(e2); }
    } };
  }
  driveStatus.set(st, detail);
}
async function doSaveDriveAs() { return withDrive(() => createOnDrive(state.name)); }
async function doSaveDrive() {
  if (!state.drive) return doSaveDriveAs();
  if (state.drive.canEdit === false) { // read-only in Drive: offer a copy instead of a doomed PATCH
    return withDrive(() => createOnDrive('Copy of ' + state.name));
  }
  if (!isDirtyNow()) { setStatus('No changes to save', 2000); return; } // don't upload (and create a Drive revision) when nothing changed
  await withDrive(async () => {
    const text = editor.getMarkdown();
    driveStatus.set('saving');
    try {
      const r = await driveApi.saveFile(state.drive.id, text, { expectedModifiedTime: state.drive.modifiedTime });
      state.drive.modifiedTime = r.modifiedTime; afterDriveWrite(text, r);
    } catch (e) {
      if (e.code !== 'conflict') return reportDriveError(e);
      driveStatus.set('conflict');
      const choice = await confirmConflict({ name: state.name, remoteModifiedTime: e.remoteModifiedTime, theme: state.theme });
      try {
        if (choice === 'overwrite') {
          const r = await driveApi.saveFile(state.drive.id, text, { force: true });
          state.drive.modifiedTime = r.modifiedTime; afterDriveWrite(text, r);
        } else if (choice === 'reload') {
          if (!confirm('Replace your edits with the version currently in Drive?')) return;
          const d = await driveApi.readFile(state.drive.id);
          loadDoc({ handle: null, name: d.name, text: d.text }, { drive: { id: d.id, modifiedTime: d.modifiedTime, canEdit: d.canEdit } });
        } else if (choice === 'save-copy') {
          await createOnDrive('Copy of ' + state.name);
        } // 'cancel': leave the conflict badge and the dirty state as they are
      } catch (e2) { reportDriveError(e2); }
    }
  });
}

// Single source of truth is the editor; the inner toolbar button can also toggle it.
function syncSourceUi() {
  state.source = !!(editor.isSourceMode ? editor.isSourceMode() : state.source);
}
async function init() {
  const theme = (await storeGet(THEME_KEY)) ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme; state.theme = theme;

  editor = createEditor($('editor-host'), { markdown: '', onChange, theme });
  applyTheme(theme);
  driveStatus = createDriveStatus($('drive-status'));
  const innerSrc = document.querySelector('.mdx-toolbar [data-cmd="source"]');
  if (innerSrc) new MutationObserver(syncSourceUi).observe(innerSrc, { attributes: true, attributeFilter: ['aria-pressed'] });

  // Priority: ?src=file:// URL  >  per-tab note (?new / ?doc)  >  saved shared draft  >  empty doc
  const params = new URLSearchParams(location.search);
  const src = params.get('src');
  let docId = params.get('doc');
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (docId && !UUID.test(docId)) docId = null;
  if (!src && (docId || params.has('new'))) {
    let n = parseInt(params.get('n') || params.get('new'), 10); if (!(n >= 1 && n <= 999999)) n = 1;
    let copyFrom = null;
    if (!docId) { docId = crypto.randomUUID(); await holdSlot(SLOT_PREFIX + docId); }
    else if (!(await holdSlot(SLOT_PREFIX + docId))) { // another tab already edits this note (Duplicate tab): work on a copy, never two editors on one slot
      copyFrom = SLOT_PREFIX + docId; docId = crypto.randomUUID(); await holdSlot(SLOT_PREFIX + docId);
    }
    history.replaceState(null, '', '?doc=' + docId + '&n=' + n); // reload / restored tab keeps this note
    state.slot = SLOT_PREFIX + docId; state.name = 'Untitled-' + n + '.md';
    holdNumber(n);
    const mine = await storeGet(copyFrom || state.slot);
    if (mine && mine.text) {
      suppress = true; editor.setMarkdown(mine.text); suppress = false;
      state.name = mine.name || state.name; state.savedText = ''; state.dirty = true; state.drive = mine.drive || null;
      renderTitle(); setStatus(copyFrom ? 'This note is open in another tab: working on a copy' : 'Restored autosaved draft', 4000);
      if (copyFrom) saveDraft();
    } else {
      renderTitle();
      const k = await countDrafts(state.slot).catch(() => 0);
      if (k) setStatus(k + ' unsaved draft' + (k > 1 ? 's' : '') + ' from earlier: see Drafts', 6000);
    }
    editor.focus && editor.focus();
    refreshDraftCount();
    return;
  }
  for (const k of LEGACY_KEYS) holdSlot(k, { shared: true }); // plain and ?src= tabs may write either shared slot: mark them as open
  const untitledDraft = await storeGet(DRAFT_KEY);
  const fileDraft = await storeGet(FILE_DRAFT_KEY);
  const draft = untitledDraft || fileDraft;
  if (src) {
    try { loadDoc(await files.fetchFileUrl(src), { keepDraft: true }); if (draft && draft.text) setStatus('Opened file. Your unsaved draft (' + (draft.name || 'Untitled.md') + ') is kept separately and will restore next time you open the editor.', 8000); }
    catch (e) { setStatus('Could not read file (enable "Allow access to file URLs" for this extension): ' + e.message, 8000); }
  } else if (draft && draft.text) {
    suppress = true; editor.setMarkdown(draft.text); suppress = false;
    if (!untitledDraft) state.loaded = true; // restoring a file-backed draft keeps using the file slot
    state.name = draft.name || 'Untitled.md'; state.savedText = ''; state.dirty = true;
    state.drive = draft.drive || null; // restored Drive-backed draft keeps its link; the conflict check protects the remote copy
    renderTitle(); setStatus('Restored autosaved draft', 4000);
  } else renderTitle();
  refreshDraftCount();
}

async function refreshDraftCount() {
  try { const k = await countDrafts(state.slot || (state.loaded ? FILE_DRAFT_KEY : DRAFT_KEY)); $('btn-drafts').textContent = k ? 'Drafts (' + k + ')' : 'Drafts'; } catch { /* count is cosmetic */ }
}
function newNote() { chrome.runtime.sendMessage({ type: 'new-note' }); }
chrome.storage.onChanged.addListener((ch) => { if (Object.keys(ch).some((k) => k.indexOf('mdwe.draft') === 0)) refreshDraftCount(); });

$('btn-new').onclick = newNote;
$('btn-drafts').onclick = () => openDraftsDialog({ ownKey: draftKey(), onOpen: (id) => chrome.tabs.create({ url: chrome.runtime.getURL('editor/index.html') + '?doc=' + id }), onChange: () => { refreshDraftCount(); setTimeout(refreshDraftCount, 800); setTimeout(refreshDraftCount, 2800); }, onClose: () => editor.focus && editor.focus() });
$('btn-open').onclick = doOpen;
$('btn-save').onclick = doSave;
$('btn-saveas').onclick = doSaveAs;
$('btn-download').onclick = doDownload;
$('btn-print').onclick = doPrint;
$('btn-drive-open').onclick = doOpenDrive;
$('btn-drive-save').onclick = doSaveDrive; // in place if the doc came from Drive, otherwise asks where to create it
$('btn-theme').onclick = () => applyTheme(state.theme === 'dark' ? 'light' : 'dark');

document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); return; }
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.shiftKey ? doSaveAs() : doSave(); }
  else if (k === 'o') { e.preventDefault(); doOpen(); }
  else if (k === 'p' && !e.shiftKey && !e.altKey) { e.preventDefault(); doPrint(); }
});

let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropzone').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('dropzone').hidden = true;
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const doc = await files.readDropItem(e.dataTransfer);
  if (doc) loadDoc(doc);
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && editor) saveDraft(); }); // saveDraft computes dirty itself (onChange is debounced)
addEventListener('beforeunload', (e) => { if (!editor) return; saveDraft(); if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

init();
window.__mdwe = { state, get editor() { return editor; }, get driveApi() { return driveApi; }, set driveApi(a) { driveApi = a; } }; // test hook for Playwright
