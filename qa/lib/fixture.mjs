// Shared fixtures: launches Playwright's bundled Chromium with the unpacked extension (persistent context).
import { test as base, expect, chromium } from '@playwright/test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT = path.join(ROOT, 'extension');
export const SCREENS = path.join(ROOT, 'qa', 'screens');
export { expect };

// Test-only copy of extension/ whose manifest oauth2.client_id is NOT the YOUR_CLIENT_ID placeholder (api.js short-circuits
// placeholder ids with 'not-configured' before calling chrome.identity, so tests that mock a token need a non-placeholder id).
// extension/ itself is never modified.
export function makeExtCopy(clientId = 'qa-test-client.apps.googleusercontent.com') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwe-extcopy-'));
  fs.cpSync(EXT, d, { recursive: true });
  const mp = path.join(d, 'manifest.json'); const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  m.oauth2.client_id = clientId; fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  return d;
}
export async function launch({ allowFileUrls = false, placeholder = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwe-pw-'));
  // placeholder=true: the manifest as shipped IF it still has the YOUR_CLIENT_ID placeholder; the shipped manifest now carries a real-looking client id
  // (Dev, 14:28), so a copy with the placeholder is used to keep testing the not-configured path.
  const shippedIsPlaceholder = /^YOUR_CLIENT_ID/.test(JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).oauth2?.client_id || '');
  const extDir = placeholder ? (shippedIsPlaceholder ? EXT : makeExtCopy('YOUR_CLIENT_ID.apps.googleusercontent.com')) : makeExtCopy();
  const args = [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`];
  // NOTE: headless (new) via Playwright's chromium channel. No xvfb needed.
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args, acceptDownloads: true, viewport: { width: 1200, height: 800 } });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  return { ctx, sw, extId, dir, extDir };
}

export const test = base.extend({
  ext: async ({}, use) => {
    const e = await launch();
    await use(e);
    await e.ctx.close();
    fs.rmSync(e.dir, { recursive: true, force: true });
    if (e.extDir !== EXT) fs.rmSync(e.extDir, { recursive: true, force: true });
  },
  // The extension exactly as shipped (placeholder client id) - only for tests about the placeholder/not-configured state.
  extReal: async ({}, use) => {
    const e = await launch({ placeholder: true });
    await use(e);
    await e.ctx.close();
    fs.rmSync(e.dir, { recursive: true, force: true });
    if (e.extDir !== EXT) fs.rmSync(e.extDir, { recursive: true, force: true });
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
  // External http(s) loads (e.g. https://example.com/a.png in fixtures) fail on a box without network: tolerate pure network errors.
  const netNoise = [];
  page.on('requestfailed', (r) => {
    const why = (r.failure() && r.failure().errorText) || '';
    if (/^https?:/.test(r.url()) && /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_BLOCKED_BY_ORB|ERR_BLOCKED_BY_CLIENT|ERR_CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|ERR_TIMED_OUT|ERR_PROXY/.test(why)) { netNoise.push(r.url() + ' ' + why); return; }
    errors.push('requestfailed: ' + r.url() + (why ? ' (' + why + ')' : ''));
  });
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); d.accept(); });
  if (init) await page.addInitScript(init, arg);
  if (after) await page.addInitScript(after); // string of JS executed after `init` (init scripts run in order)
  const url = `chrome-extension://${ext.extId}/editor/index.html${query}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  return { page, errors, netNoise, dialogs, url, extId: ext.extId, ctx: ext.ctx, sw: ext.sw };
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
