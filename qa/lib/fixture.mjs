// Shared fixtures: launches Playwright's bundled Chromium with the unpacked extension (persistent context).
import { test as base, expect, chromium } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT = path.join(ROOT, 'extension');
export const SCREENS = path.join(ROOT, 'qa', 'screens');
export { expect };

export async function launch({ allowFileUrls = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwe-pw-'));
  const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`];
  // NOTE: headless (new) via Playwright's chromium channel. No xvfb needed.
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args, acceptDownloads: true, viewport: { width: 1200, height: 800 } });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  return { ctx, sw, extId, dir };
}

export const test = base.extend({
  ext: async ({}, use) => {
    const e = await launch();
    await use(e);
    await e.ctx.close();
    fs.rmSync(e.dir, { recursive: true, force: true });
  },
  // Opens the editor page, collecting console errors / page errors.
  editor: async ({ ext }, use) => {
    await use(await openEditor(ext));
  },
});

export const md = (page) => page.evaluate(() => window.__mdwe.editor.getMarkdown());
export const setMd = (page, t) => page.evaluate((t) => window.__mdwe.editor.setMarkdown(t), t);
export const storageGet = (page, k) => page.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), k);

// Open the editor page in a new tab. opts.init: function/string injected before page scripts (addInitScript).
export async function openEditor(ext, { query = '', init, arg, after } = {}) {
  const page = await ext.ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); d.accept(); });
  if (init) await page.addInitScript(init, arg);
  if (after) await page.addInitScript(after); // string of JS executed after `init` (init scripts run in order)
  const url = `chrome-extension://${ext.extId}/editor/index.html${query}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  return { page, errors, dialogs, url, extId: ext.extId, ctx: ext.ctx, sw: ext.sw };
}

// In-memory File System Access stub (installed via init script). Exposes window.__fsa.
export function fsaStub({ openContent = '# Opened\n\nhello\n', openName = 'opened.md', saveName = 'saved-as.md' } = {}) {
  return ({ openContent, openName, saveName }) => {
    const fsa = window.__fsa = { files: {}, writes: [], opens: 0, saveAsCalls: 0 };
    const mk = (name, content) => {
      fsa.files[name] = content;
      return { kind: 'file', name,
        getFile: async () => new File([fsa.files[name]], name, { type: 'text/markdown' }),
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        createWritable: async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { fsa.files[name] = buf; fsa.writes.push({ name, text: buf }); } }; } };
    };
    window.showOpenFilePicker = async () => { fsa.opens++; return [mk(openName, openContent)]; };
    window.showSaveFilePicker = async (o) => { fsa.saveAsCalls++; return mk(saveName || (o && o.suggestedName) || 'x.md', ''); };
  };
}
export const fsaArgs = (o = {}) => ({ openContent: '# Opened\n\nhello\n', openName: 'opened.md', saveName: 'saved-as.md', ...o });
