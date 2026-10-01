// Helpers for "new note per click" tests (14-new-note.spec.mjs). Test-side only.
//  hook(ext)            : context-wide page hook: console/page errors + every dialog (alert/confirm/beforeunload) recorded; T.mode='accept'|'dismiss'
//  clickIcon(ext,T,n)   : emulates the toolbar click by calling the REAL chrome.action.onClicked listeners in the service worker with the real active-tab object
//                         (a physical toolbar click cannot be produced headlessly)
//  info(p)              : state snapshot of a note tab
import { expect } from '@playwright/test';

export const EDITOR_RE = /\/editor\/index\.html/;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sw = (ext) => ext.ctx.serviceWorkers().filter((w) => w.url().includes(ext.extId)).pop() || ext.sw; // newest worker (a restarted worker is a new object)

export function hook(ext) {
  const T = { errors: [], dialogs: [], mode: 'accept', pages: [] };
  const attach = (p) => {
    if (T.pages.includes(p)) return; T.pages.push(p);
    p.on('console', (m) => { if (m.type() === 'error') T.errors.push({ url: p.url(), text: m.text() }); });
    p.on('pageerror', (e) => T.errors.push({ url: p.url(), text: 'pageerror: ' + e.message }));
    p.on('dialog', (d) => { T.dialogs.push({ type: d.type(), message: d.message(), url: p.url() });
      // deferred + guarded: pages made by openEditor() already auto-accept in their own handler
      setTimeout(() => { try { (T.mode === 'dismiss' ? d.dismiss() : d.accept()).catch(() => {}); } catch {} }, 0); });
  };
  ext.ctx.pages().forEach(attach); ext.ctx.on('page', attach);
  T.of = (type) => T.dialogs.filter((d) => d.type === type);
  return T;
}

export async function waitNew(ext, before, n, { timeout = 40000, ready = true } = {}) {
  const t0 = Date.now(); let fresh = [];
  while (Date.now() - t0 < timeout) {
    fresh = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
    if (fresh.length >= n) break; await sleep(40);
  }
  if (fresh.length < n) throw new Error(`expected ${n} new editor tabs, got ${fresh.length}`);
  if (ready) for (const p of fresh) await p.waitForFunction(() => window.__mdwe && window.__mdwe.editor && window.__mdwe.state.slot && /doc=/.test(location.search), null, { timeout });
  return fresh;
}
export async function clickIcon(ext, T, n = 1, opts = {}) {
  const before = new Set(ext.ctx.pages());
  await sw(ext).evaluate(async (n) => {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    for (let i = 0; i < n; i++) chrome.action.onClicked.dispatch(t);
  }, n);
  return waitNew(ext, before, n, opts);
}
export const sendNew = (p) => p.evaluate(() => chrome.runtime.sendMessage({ type: 'new-note' }));

export const info = (p) => p.evaluate(() => {
  const s = window.__mdwe.state, e = window.__mdwe.editor;
  return { url: location.href, search: location.search, slot: s.slot, name: s.name, dirty: s.dirty, title: document.title, filename: document.getElementById('filename').textContent, filenameDirty: document.getElementById('filename').classList.contains('dirty'),
    modified: e.isModified(), md: e.getMarkdown(), active: document.activeElement && document.activeElement.className, activeTag: document.activeElement && document.activeElement.tagName, drive: s.drive, hasHandle: !!s.handle };
});
export const docId = (p) => new URL(p.url()).searchParams.get('doc');
export const local = (p) => p.evaluate(() => chrome.storage.local.get(null));
export const lget = (p, k) => p.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), k);
export const lset = (p, o) => p.evaluate((o) => chrome.storage.local.set(o), o);
export const session = (ext) => sw(ext).evaluate(() => chrome.storage.session.get(null));
export const pmOf = (p) => p.locator('#editor-host .ProseMirror');
export async function typeIn(p, text) { await p.bringToFront(); await pmOf(p).click(); await p.keyboard.type(text); }
export async function waitDraft(p, slot, text) {
  await expect.poll(() => lget(p, slot).then((d) => d && d.text), { timeout: 6000 }).toBe(text);
}
// close a tab the way a user does (runs beforeunload; the hook accepts the prompt)
export async function closeTab(p) { await p.close({ runBeforeUnload: true }); await sleep(200); }

// In-memory File System Access stub that RECORDS suggestedName (init script; install with ext.ctx.addInitScript(fsaRecorder, args)).
export function fsaRecorder({ saveName, openContent = '# Opened\n\nhello\n', openName = 'opened.md' } = {}) {
  const fsa = window.__fsa = { files: {}, writes: [], opens: 0, saveAs: [] };
  const mk = (name, content) => { fsa.files[name] = content; return { kind: 'file', name,
    getFile: async () => new File([fsa.files[name]], name, { type: 'text/markdown' }), queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    createWritable: async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { fsa.files[name] = buf; fsa.writes.push({ name, text: buf }); } }; } }; };
  window.showOpenFilePicker = async () => { fsa.opens++; return [mk(openName, openContent)]; };
  window.showSaveFilePicker = async (o) => { fsa.saveAs.push(o && o.suggestedName); return mk(saveName || (o && o.suggestedName) || 'x.md', ''); };
}
export const seed = (ext, o) => sw(ext).evaluate((o) => chrome.storage.local.set(o), o);
export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const nOf = (name) => Number((/^Untitled-(\d+)\.md$/.exec(name) || [])[1]);
