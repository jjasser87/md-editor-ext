import { createEditor } from '../editor/index.js';
import * as files from './files.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'mdwe.draft';           // untitled (never opened/saved) document
const FILE_DRAFT_KEY = 'mdwe.draft.file'; // draft of a document that came from a file (separate slot so it can't clobber the untitled draft)
const THEME_KEY = 'mdwe.theme';
const AUTOSAVE_MS = 800;

const state = { loaded: false, handle: null, name: 'Untitled.md', savedText: '', dirty: false, theme: 'light', source: false };
let editor = null;
let draftTimer = null;
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

function loadDoc({ handle, name, text }, { keepDraft = false } = {}) {
  state.loaded = true; state.handle = handle; state.name = name; state.savedText = text; state.dirty = false;
  suppress = true;
  editor.setMarkdown(text);
  suppress = false;
  // Round-trip may normalize markdown; baseline for "dirty" is the normalized output.
  state.savedText = editor.getMarkdown();
  if (!keepDraft) { clearTimeout(draftTimer); store.remove([DRAFT_KEY, FILE_DRAFT_KEY]); } // user opened/dropped a file (already confirmed discard)
  renderTitle(); setStatus(handle ? 'Opened ' + name : 'Opened ' + name + ' (read-only source: Ctrl+S will ask where to save)', handle ? 2500 : 6000);
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
  store.set({ [draftKey()]: { text: editor.getMarkdown(), name: state.name, savedAt: Date.now() } })
    .then(() => setStatus('Draft autosaved', 1200))
    .catch(() => setStatus('Draft autosave failed'));
}
function draftKey() { return state.loaded ? FILE_DRAFT_KEY : DRAFT_KEY; }
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
    state.handle = handle; state.name = handle.name; state.savedText = text; state.dirty = false;
    clearDraft(); renderTitle(); setStatus('Saved');
  } catch (e) { if (e.name !== 'AbortError') setStatus('Save failed: ' + e.message, 5000); }
}
async function doSave() {
  if (!state.handle) return doSaveAs();
  const text = editor.getMarkdown();
  try {
    await files.writeHandle(state.handle, text);
    state.savedText = text; state.dirty = false; clearDraft(); renderTitle(); setStatus('Saved');
  } catch (e) { setStatus('Save failed: ' + e.message, 5000); }
}
function doDownload() {
  const text = editor.getMarkdown();
  files.downloadText(state.name.match(/\.(md|markdown|mdown)$/i) ? state.name : state.name + '.md', text);
  setStatus('Downloaded');
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
  const innerSrc = document.querySelector('.mdx-toolbar [data-cmd="source"]');
  if (innerSrc) new MutationObserver(syncSourceUi).observe(innerSrc, { attributes: true, attributeFilter: ['aria-pressed'] });

  // Priority: ?src=file:// URL  >  saved draft  >  empty doc
  const src = new URLSearchParams(location.search).get('src');
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
    renderTitle(); setStatus('Restored autosaved draft', 4000);
  } else renderTitle();
}

$('btn-open').onclick = doOpen;
$('btn-save').onclick = doSave;
$('btn-saveas').onclick = doSaveAs;
$('btn-download').onclick = doDownload;
$('btn-theme').onclick = () => applyTheme(state.theme === 'dark' ? 'light' : 'dark');

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.shiftKey ? doSaveAs() : doSave(); }
  else if (k === 'o') { e.preventDefault(); doOpen(); }
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
window.__mdwe = { state, get editor() { return editor; } }; // test hook for Playwright
