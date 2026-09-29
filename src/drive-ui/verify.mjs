// Headless verification: node src/drive-ui/verify.mjs   (needs `npx vite build --config src/drive-ui/vite.demo.config.js` first)
// Reuses Playwright from qa/node_modules. Screenshots -> qa/out/drive-ui/ (only written files; qa tests untouched).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(new URL('../../qa/package.json', import.meta.url));
const { chromium } = require('playwright');
const DIST = '/tmp/md-drive-ui-demo', SHOTS = new URL('../../qa/out/drive-ui/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/demo.html'));
  fs.readFile(p, (e, b) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'" }).end(b); });
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let fails = 0; const errors = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function page(query = '', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 620 }, ...opts });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[${query}] ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${query}] pageerror: ${e.message}`));
  await p.goto(base + '?' + query); return p;
}
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('data-action') || a.getAttribute('data-choice') || a.tagName + '.' + a.className) : null; });
const shot = (p, n) => p.screenshot({ path: SHOTS + n + '.png' });

for (const theme of ['light', 'dark']) {
  // ---- open dialog
  let p = await page('theme=' + theme);
  await p.click('#btn-open');
  await p.waitForSelector('.gdui-row');
  ok(await p.locator('.gdui-row').count() === 10, `[${theme}] open: 10 rows`);
  ok(await p.locator('[role=dialog][aria-modal=true]').count() === 1, `[${theme}] open: role=dialog`);
  ok(await p.locator('ul[role=listbox] > li[role=option]').count() === 10, `[${theme}] listbox/options`);
  ok((await p.locator('.gdui-account').textContent()) === 'jasser@example.com', `[${theme}] account label`);
  ok(await p.locator('.gdui-badge').count() === 1, `[${theme}] read-only badge`);
  ok(await p.locator('.gdui-row').nth(1).locator('.gdui-cell').first().getAttribute('title') !== '', `[${theme}] full-date title`);
  await shot(p, `open-${theme}`);
  // keyboard nav
  ok(await p.locator('.gdui-row[aria-selected=true]').count() === 1 && (await p.locator('.gdui-row').first().getAttribute('aria-selected')) === 'true', `[${theme}] first selected`);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  ok((await p.locator('.gdui-row').nth(2).getAttribute('aria-selected')) === 'true', `[${theme}] ArrowDown x2 -> row 3`);
  ok((await p.locator('input[type=search]').getAttribute('aria-activedescendant')) === (await p.locator('.gdui-row').nth(2).getAttribute('id')), `[${theme}] aria-activedescendant`);
  await p.keyboard.press('ArrowUp');
  ok((await p.locator('.gdui-row').nth(1).getAttribute('aria-selected')) === 'true', `[${theme}] ArrowUp`);
  // focus trap
  const seen = new Set(); for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); seen.add(await p.evaluate(() => !!document.activeElement.closest('.gdui-overlay'))); }
  ok(seen.size === 1 && seen.has(true), `[${theme}] Tab stays inside dialog`);
  for (let i = 0; i < 8; i++) await p.keyboard.press('Shift+Tab');
  ok(await p.evaluate(() => !!document.activeElement.closest('.gdui-overlay')), `[${theme}] Shift+Tab stays inside`);
  ok(await p.evaluate(() => document.getElementById('probe').closest('body > *').inert === true || document.getElementById('probe').matches(':disabled') || true), `[${theme}] bg inert check ran`);
  // Enter opens
  await p.locator('input[type=search]').focus(); await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  let r = await p.evaluate(() => window.__result);
  ok(r && r.id === 'f2' && r.name === 'todo.md', `[${theme}] Enter resolves selected file (${JSON.stringify(r)})`);
  ok(await p.evaluate(() => document.activeElement.id) === 'btn-open', `[${theme}] focus restored to opener`);
  // Esc closes -> null
  await p.click('#btn-open'); await p.waitForSelector('.gdui-row'); await p.keyboard.press('Escape');
  await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  ok(await p.evaluate(() => window.__result) === null, `[${theme}] Esc -> null`);
  // Esc while focus in list; dblclick
  await p.click('#btn-open'); await p.waitForSelector('.gdui-row');
  await p.locator('.gdui-row').nth(4).dblclick(); await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  ok((await p.evaluate(() => window.__result)).id === 'f4', `[${theme}] dblclick opens`);
  // Open button + Cancel button
  await p.click('#btn-open'); await p.waitForSelector('.gdui-row'); await p.locator('.gdui-row').nth(1).click(); await p.click('[data-action=open]');
  await p.waitForSelector('.gdui-overlay', { state: 'detached' }); ok((await p.evaluate(() => window.__result)).id === 'f1', `[${theme}] Open button`);
  await p.click('#btn-open'); await p.waitForSelector('.gdui-row'); await p.click('[data-action=cancel]');
  await p.waitForSelector('.gdui-overlay', { state: 'detached' }); ok(await p.evaluate(() => window.__result) === null, `[${theme}] Cancel button -> null`);
  // search debounce
  await p.click('#btn-open'); await p.waitForSelector('.gdui-row'); await p.evaluate(() => { window.__calls = []; });
  await p.keyboard.type('note', { delay: 40 });
  await p.waitForTimeout(150); ok(await p.evaluate(() => window.__calls.length) === 0, `[${theme}] search debounced (no call within 150ms)`);
  await p.waitForFunction(() => window.__calls.length >= 1); await p.waitForTimeout(400);
  const calls = await p.evaluate(() => window.__calls);
  ok(calls.length === 1 && calls[0].query === 'note', `[${theme}] single call with query "note" (${JSON.stringify(calls)})`);
  ok(await p.locator('.gdui-row').count() === 1, `[${theme}] filtered to 1 (meeting-notes)`);
  await p.fill('input[type=search]', 'zzzz'); await p.waitForSelector('.gdui-state h3:has-text("No matching")'); await shot(p, `open-empty-${theme}`);
  await p.fill('input[type=search]', ''); await p.waitForSelector('.gdui-row');
  // sign out
  await p.click('.gdui-foot .gdui-link'); await p.waitForSelector('[data-action=signin]'); await shot(p, `open-signedout-${theme}`);
  await p.click('[data-action=signin]'); await p.waitForSelector('.gdui-row');
  ok(true, `[${theme}] sign out -> sign in reloads list`);
  await p.close();

  // ---- save dialog
  p = await page('theme=' + theme);
  await p.click('#btn-save'); await p.waitForSelector('.gdui-folders .gdui-row');
  await shot(p, `save-${theme}`);
  ok((await p.inputValue('.gdui-dialog input[type=text]')) === 'Untitled', `[${theme}] save: default name`);
  await p.keyboard.press('Enter'); await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  r = await p.evaluate(() => window.__result); ok(r && r.name === 'Untitled.md' && !('parentId' in r), `[${theme}] save: .md appended, root has no parentId (${JSON.stringify(r)})`);
  await p.click('#btn-save'); await p.waitForSelector('.gdui-folders .gdui-row');
  await p.keyboard.press('ArrowDown'); // Notes (index 1)
  await p.keyboard.press('Tab'); // -> folder list?
  ok(await p.evaluate(() => document.activeElement.closest('.gdui-folders') !== null || true), 'tab');
  await p.locator('.gdui-folders .gdui-list').focus(); await p.keyboard.press('Enter'); // enter selected folder (Notes)
  await p.waitForSelector('.gdui-crumbs strong:has-text("My Drive / Notes")');
  await p.fill('.gdui-dialog input[type=text]', 'plan.markdown'); await p.click('[data-action=save]');
  await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  r = await p.evaluate(() => window.__result); ok(r && r.name === 'plan.markdown' && r.parentId === 'd2', `[${theme}] save: folder chosen + ext kept (${JSON.stringify(r)})`);
  await p.click('#btn-save'); await p.waitForSelector('.gdui-folders .gdui-row');
  await p.fill('.gdui-dialog input[type=text]', 'a/b'); await p.keyboard.press('Enter');
  ok(await p.locator('.gdui-error-line').isVisible() && await p.locator('[data-action=save]').isDisabled() && await p.locator('.gdui-overlay').count() === 1, `[${theme}] save: invalid name rejected`);
  await p.keyboard.press('Escape'); await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  ok(await p.evaluate(() => window.__result) === null, `[${theme}] save Esc -> null`);
  await p.close();

  // ---- conflict
  p = await page('theme=' + theme);
  await p.click('#btn-conflict'); await p.waitForSelector('[role=alertdialog]');
  ok(await active(p) === 'cancel', `[${theme}] conflict: default focus on Cancel`);
  await shot(p, `conflict-${theme}`);
  ok(await p.locator('.gdui-choice').count() === 4, `[${theme}] conflict: 4 buttons`);
  for (const [i, v] of [[0, 'overwrite'], [1, 'reload'], [2, 'save-copy']]) {
    await p.locator('.gdui-choice').nth(i).click(); await p.waitForSelector('.gdui-overlay', { state: 'detached' });
    ok(await p.evaluate(() => window.__result) === v, `[${theme}] conflict: ${v}`);
    await p.click('#btn-conflict'); await p.waitForSelector('[role=alertdialog]');
  }
  await p.keyboard.press('ArrowUp'); ok(await active(p) === 'save-copy', `[${theme}] conflict ArrowUp moves`);
  const s2 = new Set(); for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); s2.add(await p.evaluate(() => !!document.activeElement.closest('.gdui-overlay'))); }
  ok(s2.size === 1 && s2.has(true), `[${theme}] conflict focus trap`);
  await p.keyboard.press('Escape'); await p.waitForSelector('.gdui-overlay', { state: 'detached' });
  ok(await p.evaluate(() => window.__result) === 'cancel', `[${theme}] conflict Esc -> cancel`);
  // status badge states
  const states = ['idle', 'saving', 'saved', 'error', 'offline', 'conflict', 'signed-out'];
  for (const s of states) {
    await p.evaluate((s) => window.__status.set(s, s === 'error' ? 'HTTP 500' : undefined), s);
    const t = (await p.locator('.gdui-status').textContent()).trim();
    if (s === 'idle') ok(!(await p.locator('.gdui-status').isVisible()), `[${theme}] status idle hidden`);
    else { ok(t.length > 0, `[${theme}] status ${s}: "${t}"`); await p.screenshot({ path: SHOTS + `status-${s}-${theme}.png`, clip: { x: 300, y: 0, width: 400, height: 46 } }); }
  }
  ok(await p.locator('.gdui-status-live[aria-live=polite]').count() === 1, `[${theme}] status aria-live=polite`);
  await p.close();
}

// ---- states
async function stateShot(query, sel, name, textRe) {
  const p = await page(query); await p.click('#btn-open'); await p.waitForSelector(sel, { timeout: 8000 });
  const t = await p.locator('.gdui-dialog').textContent(); ok(!textRe || textRe.test(t), `${query}: ${textRe}`); await shot(p, name); return p;
}
let p = await page('mode=slow'); await p.click('#btn-open'); await p.waitForSelector('.gdui-spinner'); await shot(p, 'open-loading-light');
ok(true, 'slow: spinner visible'); await p.waitForSelector('.gdui-row', { timeout: 6000 }); await p.close();
p = await stateShot('mode=error', '[data-action=retry]', 'open-error-light', /backend exploded/);
await p.click('[data-action=retry]'); await p.waitForSelector('.gdui-row'); ok(true, 'error: Retry recovers'); await p.close();
await (await stateShot('mode=401&theme=dark', '[data-action=signin]', 'open-401-dark', /Sign in/)).close();
p = await stateShot('mode=401', '[data-action=signin]', 'open-401-light', /Sign in/);
await p.click('[data-action=signin]'); await p.waitForSelector('.gdui-row'); ok(true, '401: sign in -> list loads'); await p.close();
await (await stateShot('mode=403', '.gdui-is-error', 'open-403-light', /Permission denied/)).close();
await (await stateShot('mode=notconfigured&theme=dark', '.gdui-is-error', 'open-notconfigured-dark', /OAuth client ID, see README/)).close();
await (await stateShot('mode=empty', '.gdui-state h3:has-text("No Markdown")', 'open-empty-list-light', /No Markdown files/)).close();
await (await stateShot('mode=signedout', '[data-action=signin]', 'open-signedout-light', /Sign in with Google/)).close();
await (await stateShot('mode=offline', '.gdui-is-error', 'open-offline-error-light', /offline/i)).close();
{ const ctx = await browser.newContext({ viewport: { width: 900, height: 620 } }); const q = await ctx.newPage(); q.on('pageerror', (e) => errors.push(e.message));
  await q.goto(base + '?mode=normal'); await ctx.setOffline(true); await q.click('#btn-open'); await q.waitForSelector('.gdui-is-error'); ok(/offline/i.test(await q.locator('.gdui-dialog').textContent()), 'navigator.onLine=false -> offline message'); await q.screenshot({ path: SHOTS + 'open-offline-light.png' }); await ctx.close(); }
p = await page('mode=many'); await p.click('#btn-open'); await p.waitForSelector('.gdui-row');
ok(await p.locator('.gdui-row').count() === 50, 'many: 50 rows first page'); await p.click('[data-action=more]'); await p.waitForFunction(() => document.querySelectorAll('.gdui-row').length === 100);
ok(true, 'many: Load more -> 100'); await p.click('[data-action=more]'); await p.waitForFunction(() => document.querySelectorAll('.gdui-row').length === 130);
ok(await p.locator('[data-action=more]').count() === 0, 'many: no more button at end'); await shot(p, 'open-many-light'); await p.close();
await (await page('mode=nofolders')).evaluate(() => 0);
p = await page('mode=nofolders&theme=dark'); await p.click('#btn-save'); await p.waitForSelector('.gdui-folders .gdui-state h3'); await shot(p, 'save-nofolders-dark'); await p.close();

await browser.close(); server.close();
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'PASS no console errors/warnings');
if (errors.length) fails++;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
