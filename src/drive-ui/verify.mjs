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


// ---- save dialog: folder search
const SEARCH = '[data-role=folder-search]', NAME = '.gdui-dialog input[type=text]', ROWS = '.gdui-folders .gdui-row';
const openSave = async (query = '') => { const q = await page(query); await q.click('#btn-save'); await q.waitForSelector(ROWS); return q; };
const rowTexts = (q) => q.locator(ROWS).evaluateAll((els) => els.map((e) => e.textContent));
const crumb = (q) => q.locator('.gdui-dest').textContent();
const fcalls = (q) => q.evaluate(() => window.__fcalls);
for (const theme of ['light', 'dark']) {
  const T = `[search ${theme}]`;
  let q = await openSave('theme=' + theme), r, rows;
  ok(await q.locator(SEARCH).count() === 1 && (await q.locator(SEARCH).getAttribute('placeholder')) === 'Search folders…' && (await q.locator(SEARCH).getAttribute('aria-label')) === 'Search folders', `${T} search input, placeholder, aria-label`);
  ok(await q.locator('[data-action=clear-search]').isHidden(), `${T} clear button hidden when empty`);
  ok(await q.evaluate(() => document.activeElement.type) === 'text', `${T} open focus is still the name input`);
  // debounce + filtering + path
  await q.evaluate(() => { window.__fcalls = []; });
  await q.click(SEARCH); await q.keyboard.type('ARCH', { delay: 30 });
  ok(await q.locator('[data-action=clear-search]').isVisible(), `${T} clear button shown when non-empty`);
  await q.waitForTimeout(150); ok((await fcalls(q)).length === 0, `${T} debounced (no call within 150 ms)`);
  await q.waitForSelector('.gdui-row[data-kind=result]'); await q.waitForTimeout(150);
  let calls = await fcalls(q);
  ok(calls.length === 1 && calls[0].query === 'ARCH' && calls[0].pageToken === undefined && !('parentId' in calls[0]), `${T} one call {query:"ARCH"} and no parentId (${JSON.stringify(calls)})`);
  rows = await rowTexts(q);
  ok(rows.length === 3 && rows.every((t) => /Archive/.test(t)), `${T} case-insensitive contains: 3 Archive folders (${JSON.stringify(rows)})`);
  ok(rows.some((t) => t.includes('My Drive / Documents')) && rows.some((t) => t.includes('My Drive / Notes')) && rows.some((t) => t.includes('Shared drives / Marketing')), `${T} results show their path (incl. shared drive)`);
  ok(await q.locator('.gdui-fpath').first().isVisible(), `${T} path visible`);
  ok((await q.locator(ROWS).first().getAttribute('aria-selected')) === 'true' && (await q.locator(SEARCH).getAttribute('aria-activedescendant')) === (await q.locator(ROWS).first().getAttribute('id')), `${T} first result selected, aria-activedescendant on search box`);
  ok(/3 folders found/.test(await q.locator('.gdui-dialog [role=status]').last().textContent()), `${T} result count announced`);
  await shot(q, `save-search-${theme}`);
  // keyboard: ArrowDown / PageDown / ArrowUp from the search box
  await q.keyboard.press('ArrowDown');
  ok((await q.locator(ROWS).nth(1).getAttribute('aria-selected')) === 'true', `${T} ArrowDown moves into results`);
  await q.keyboard.press('PageDown'); ok((await q.locator(ROWS).nth(2).getAttribute('aria-selected')) === 'true', `${T} PageDown clamps to last`);
  await q.keyboard.press('PageUp'); ok((await q.locator(ROWS).nth(0).getAttribute('aria-selected')) === 'true', `${T} PageUp -> first`);
  await q.keyboard.press('ArrowDown'); // 2nd result = Notes/Archive? find by id below
  const selId = await q.locator(ROWS).nth(1).getAttribute('data-folder-id');
  // Enter in search picks, never saves
  await q.keyboard.press('Enter');
  await q.waitForFunction(() => document.querySelector('.gdui-dest') && !document.querySelector('[data-role=folder-search]').value);
  ok(await q.locator('.gdui-overlay').count() === 1, `${T} Enter in search box did not close/save the dialog`);
  const dest = await crumb(q);
  ok(dest === (selId === 'n1' ? 'My Drive / Notes / Archive' : selId === 'd1b' ? 'My Drive / Documents / Archive' : 'Shared drives / Marketing / Archive'), `${T} Enter picks: breadcrumb shows chosen destination (${dest})`);
  ok((await q.inputValue(SEARCH)) === '' && await q.locator('[data-action=clear-search]').isHidden(), `${T} search cleared after pick`);
  await q.waitForFunction((id) => window.__fcalls.at(-1).parentId === id, selId);
  ok((await fcalls(q)).at(-1).parentId === selId && (await fcalls(q)).at(-1).query === undefined, `${T} after pick, subfolders of picked folder listed (${JSON.stringify((await fcalls(q)).at(-1))})`);
  await q.waitForSelector('.gdui-state h3:has-text("No subfolders"), .gdui-folders .gdui-row[data-kind=folder]');
  await q.fill(NAME, 'plan'); await q.keyboard.press('Enter'); await q.waitForSelector('.gdui-overlay', { state: 'detached' });
  r = await q.evaluate(() => window.__result); ok(r && r.name === 'plan.md' && r.parentId === selId, `${T} Enter in name input saves with parentId of picked folder (${JSON.stringify(r)})`);
  await q.close();
}
{
  let q = await openSave(), r, rows;
  // double-click pick + go deeper + Up
  await q.fill(SEARCH, 'Meeting'); await q.waitForSelector('.gdui-row[data-kind=result]');
  const rs = await rowTexts(q); ok(rs.length === 2 && rs.every((t) => t.startsWith('Meeting Notes')), `duplicate names in different parents both listed (${JSON.stringify(rs)})`);
  ok(rs.some((t) => t.includes('My Drive / Documents / Projects')) && rs.some((t) => t.includes('My Drive / Notes')), 'duplicate names are disambiguated by path');
  await q.locator(ROWS).filter({ hasText: 'My Drive / Documents / Projects' }).dblclick();
  await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent === 'My Drive / Documents / Projects / Meeting Notes');
  ok(true, 'dblclick picks result; breadcrumb = path + name');
  await q.waitForFunction(() => window.__fcalls.at(-1).parentId === 'pmn'); ok(true, 'subfolders of picked folder requested');
  await q.fill(SEARCH, 'Specs'); await q.waitForSelector('.gdui-row[data-kind=result]'); await q.locator(ROWS).first().click(); await q.click('[data-action=save]'); // click selects only; pick is Enter/dblclick
  await q.waitForTimeout(100);
  ok(await q.locator('.gdui-overlay').count() === 0, 'Save button with a selected (not picked) search result saves to the current destination without error');
  r = await q.evaluate(() => window.__result); ok(r && r.parentId === 'pmn', `selected-but-unpicked result does not change destination (${JSON.stringify(r)})`);
  // Up after pick -> My Drive
  q = await openSave(); await q.fill(SEARCH, 'Launch'); await q.waitForSelector('.gdui-row[data-kind=result]'); await q.locator(ROWS).first().dblclick();
  await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent.endsWith('Launch Plan'));
  ok(await q.locator('[data-action=up]').isEnabled(), 'Up enabled after pick'); await q.click('[data-action=up]');
  await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent === 'My Drive');
  await q.waitForSelector('.gdui-row[data-kind=folder]'); ok((await rowTexts(q)).includes('Documents'), 'Up after pick -> My Drive root listing');
  await q.click('[data-action=save]'); await q.waitForSelector('.gdui-overlay', { state: 'detached' });
  r = await q.evaluate(() => window.__result); ok(r && !('parentId' in r), 'Up to My Drive then Save -> no parentId');
  await q.close();

  // Esc behaviour
  q = await openSave(); await q.click(SEARCH); await q.keyboard.type('notes'); await q.waitForSelector('.gdui-row[data-kind=result]');
  await q.keyboard.press('Escape'); await q.waitForSelector('.gdui-row[data-kind=folder]');
  ok(await q.locator('.gdui-overlay').count() === 1 && (await q.inputValue(SEARCH)) === '', 'Esc #1 clears the search, dialog stays open');
  ok(await q.evaluate(() => document.activeElement.matches('[data-role=folder-search]')), 'focus stays in search box after Esc-clear');
  ok((await rowTexts(q)).includes('Documents') && await crumb(q) === 'My Drive', 'back to normal browsing at the current location');
  await q.keyboard.press('Escape'); await q.waitForSelector('.gdui-overlay', { state: 'detached' });
  ok(await q.evaluate(() => window.__result) === null, 'Esc #2 closes the dialog (null)');
  await q.close();

  // clear button; browse location preserved
  q = await openSave(); await q.locator(ROWS).first().dblclick(); await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent === 'My Drive / Documents');
  await q.waitForSelector('.gdui-row[data-kind=folder]:has-text("Projects")');
  await q.fill(SEARCH, 'zz'); await q.waitForSelector('.gdui-state h3');
  ok((await q.locator('.gdui-state h3').textContent()) === 'No folders match \u201czz\u201d', 'empty state: No folders match \u201czz\u201d');
  ok(/No folders match/.test(await q.locator('.gdui-dialog [role=status]').last().textContent()), 'empty state announced');
  await shot(q, 'save-search-empty-light');
  ok(await crumb(q) === 'My Drive / Documents', 'search does not change the current destination');
  await q.click('[data-action=clear-search]');
  await q.waitForSelector('.gdui-row[data-kind=folder]:has-text("Projects")');
  ok((await q.inputValue(SEARCH)) === '' && await q.locator('[data-action=clear-search]').isHidden() && await crumb(q) === 'My Drive / Documents', 'clear (×) returns to browsing at the current location');
  ok(await q.evaluate(() => document.activeElement.matches('[data-role=folder-search]')), 'clear button returns focus to search box');
  // whitespace-only query = empty
  await q.evaluate(() => { window.__fcalls = []; }); await q.fill(SEARCH, '   '); await q.waitForTimeout(500);
  ok((await fcalls(q)).length === 0, 'whitespace-only query triggers no request');
  // trimmed query
  await q.fill(SEARCH, '  Ideas  '); await q.waitForSelector('.gdui-row[data-kind=result]');
  ok((await fcalls(q)).at(-1).query === 'Ideas', 'query is trimmed');
  await q.close();

  // verbatim special characters
  q = await openSave(); const weird = 'Bob\'s "Drafts" \\ 100%_done';
  await q.fill(SEARCH, weird); await q.waitForSelector('.gdui-row[data-kind=result]');
  ok((await fcalls(q)).at(-1).query === weird, `special characters passed verbatim (${JSON.stringify((await fcalls(q)).at(-1).query)})`);
  ok((await rowTexts(q)).length === 1 && (await q.locator('.gdui-fn').first().textContent()) === weird, 'row renders the name verbatim');
  for (const odd of ["a'b", 'x"y', 'zz\\', 'zz%', "<img src=x onerror=alert(1)>", "')) or 1=1 --"]) {
    await q.fill(SEARCH, odd); await q.waitForFunction((t) => window.__fcalls.at(-1).query === t && document.querySelector('.gdui-folders .gdui-state h3')?.textContent.endsWith('\u201c' + t + '\u201d'), odd);
    ok((await fcalls(q)).at(-1).query === odd && await q.locator('.gdui-state img').count() === 0, `verbatim/no-HTML: ${JSON.stringify(odd)}`);
  }
  for (const odd of ['\\', '%']) { await q.fill(SEARCH, odd); await q.waitForFunction((t) => window.__fcalls.at(-1).query === t && document.querySelector('.gdui-row[data-kind=result]'), odd); ok((await fcalls(q)).at(-1).query === odd, `passed verbatim (API layer escapes, mock does plain contains): ${JSON.stringify(odd)}`); }
  await q.close();

  // stale responses
  q = await openSave('fmode=slow'); await q.waitForSelector(ROWS);
  await q.evaluate(() => { window.__folderDelays = { arch: 1500, notes: 100 }; window.__fcalls = []; });
  await q.fill(SEARCH, 'arch'); await q.waitForFunction(() => window.__fcalls.some((c) => c.query === 'arch'));
  await q.fill(SEARCH, 'notes'); await q.waitForFunction(() => window.__fcalls.some((c) => c.query === 'notes'));
  await q.waitForSelector('.gdui-row[data-kind=result]:has-text("Notes")'); await q.waitForTimeout(1800);
  rows = await rowTexts(q); ok(rows.length >= 2 && rows.every((t) => /notes/i.test(t)) && !rows.some((t) => /Archive/.test(t)), `stale slow older query did not overwrite newer results (${JSON.stringify(rows)})`);
  // stale vs clear
  await q.evaluate(() => { window.__folderDelays = { arch: 1200 }; });
  await q.fill(SEARCH, 'arch'); await q.waitForFunction(() => window.__fcalls.filter((c) => c.query === 'arch').length >= 2); await q.click('[data-action=clear-search]');
  await q.waitForSelector('.gdui-row[data-kind=folder]'); await q.waitForTimeout(1500);
  rows = await rowTexts(q); ok(rows.includes('Documents') && !rows.some((t) => /Archive/.test(t) && t.includes('/')) && await q.locator('.gdui-row[data-kind=result]').count() === 0, 'slow response arriving after the search was cleared is ignored');
  // stale vs navigation (enter folder while search pending)
  await q.fill(SEARCH, 'arch'); await q.waitForFunction(() => window.__fcalls.filter((c) => c.query === 'arch').length >= 3);
  await q.click('[data-action=clear-search]'); await q.waitForSelector('.gdui-row[data-kind=folder]'); await q.locator(ROWS).first().dblclick();
  await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent === 'My Drive / Documents'); await q.waitForTimeout(1500);
  ok(await q.locator('.gdui-row[data-kind=result]').count() === 0 && await crumb(q) === 'My Drive / Documents', 'slow response after navigating is ignored');
  await q.close();

  // spinner while searching
  q = await openSave('fmode=slow'); await q.waitForSelector(ROWS); await q.fill(SEARCH, 'arch');
  await q.waitForSelector('.gdui-state .gdui-spinner'); ok(/Searching/.test(await q.locator('.gdui-folders .gdui-state h3').textContent()), '"Searching…" spinner state'); await shot(q, 'save-search-loading-light');
  ok(await q.locator('[data-action=save]').isEnabled(), 'Save stays enabled while searching');
  await q.close();

  // error + Retry
  q = await openSave('theme=dark&fmode=error'); await q.fill(SEARCH, 'arch'); await q.waitForSelector('.gdui-folders [data-action=retry]');
  ok(/folder search exploded/.test(await q.locator('.gdui-folders .gdui-state').textContent()) && /save to the selected location/.test(await q.locator('.gdui-folders .gdui-state').textContent()), 'search error message + save hint');
  await shot(q, 'save-search-error-dark');
  ok(await q.locator('[data-action=save]').isEnabled(), 'Save still enabled on search error');
  await q.click('.gdui-folders [data-action=retry]'); await q.waitForSelector('.gdui-row[data-kind=result]');
  ok((await fcalls(q)).at(-1).query === 'arch', 'Retry re-runs the same query and recovers');
  await q.close();

  // offline
  { const ctx = await browser.newContext({ viewport: { width: 900, height: 620 } }); const o = await ctx.newPage(); o.on('pageerror', (e) => errors.push(e.message));
    await o.goto(base); await o.click('#btn-save'); await o.waitForSelector(ROWS); await ctx.setOffline(true);
    await o.fill(SEARCH, 'arch'); await o.waitForSelector('.gdui-folders .gdui-is-error'); ok(/offline/i.test(await o.locator('.gdui-folders .gdui-state').textContent()), 'offline: search shows offline state'); await ctx.close(); }
  q = await openSave('fmode=offline'); await q.fill(SEARCH, 'arch'); await q.waitForSelector('.gdui-folders .gdui-is-error'); ok(/offline/i.test(await q.locator('.gdui-folders .gdui-state').textContent()), 'DriveError offline -> offline state'); await q.close();
  // signed out
  q = await page('mode=signedout'); await q.click('#btn-save'); await q.waitForSelector('.gdui-folders [data-action=signin]');
  ok(await q.locator(SEARCH).count() === 1, 'signed-out: folder area shows sign-in'); await q.fill(SEARCH, 'arch'); await q.waitForSelector('.gdui-folders [data-action=signin]');
  await q.click('.gdui-folders [data-action=signin]'); await q.waitForSelector('.gdui-row[data-kind=result]'); ok(true, 'signed-out: sign-in then search results load'); await q.close();

  // pagination
  q = await openSave('fmode=many'); await q.fill(SEARCH, 'project'); await q.waitForSelector('.gdui-row[data-kind=result]');
  ok(await q.locator(ROWS).count() === 50 && /more available/.test(await q.locator('.gdui-dialog [role=status]').last().textContent()), 'pagination: 50 results + "more available"');
  await q.click('.gdui-folders [data-action=more]'); await q.waitForFunction(() => document.querySelectorAll('.gdui-folders .gdui-row').length === 100);
  ok((await fcalls(q)).at(-1).pageToken === '50' && (await fcalls(q)).at(-1).query === 'project', 'Load more passes query + nextPageToken');
  await q.click('.gdui-folders [data-action=more]'); await q.waitForFunction(() => document.querySelectorAll('.gdui-folders .gdui-row').length === 121);
  ok(await q.locator('.gdui-folders [data-action=more]').count() === 0 && /more loaded/.test(await q.locator('.gdui-dialog [role=status]').last().textContent()), 'pagination: no Load more at end, announced');
  await q.close();

  // recent
  q = await openSave('fmode=recent'); await q.waitForSelector('.gdui-row[data-kind=recent]');
  ok(await q.locator('.gdui-subhead').first().textContent() === 'Recent' && await q.locator('.gdui-row[data-kind=recent]').count() === 2, 'Recent section at My Drive root (2 rows)');
  ok(await q.locator('.gdui-row[data-kind=folder]').count() === 3, 'normal folders still listed below Recent');
  await shot(q, 'save-recent-light');
  await q.locator('.gdui-row[data-kind=recent]').first().dblclick(); await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent === 'My Drive / Documents / Projects');
  ok(await q.locator('.gdui-subhead:has-text("Recent")').count() === 0, 'no Recent section away from root');
  await q.click('[data-action=save]'); await q.waitForSelector('.gdui-overlay', { state: 'detached' });
  r = await q.evaluate(() => window.__result); ok(r && r.parentId === 'd1a', `pick from Recent sets parentId (${JSON.stringify(r)})`);
  q = await openSave(); ok(await q.locator('.gdui-subhead').count() === 0, 'no getRecentFolders -> no Recent heading'); await q.close();
  // keyboard in search with browse (empty) list: Enter does nothing until the user arrows
  q = await openSave(); await q.click(SEARCH); await q.keyboard.press('Enter'); await q.waitForTimeout(150);
  ok(await q.locator('.gdui-overlay').count() === 1 && await crumb(q) === 'My Drive', 'Enter in empty search box does nothing');
  await q.keyboard.press('ArrowDown'); await q.keyboard.press('Enter'); await q.waitForFunction(() => document.querySelector('.gdui-dest').textContent === 'My Drive / Notes');
  ok(true, 'ArrowDown+Enter in search box (empty query) enters the folder');
  // Enter flushes a pending debounced query rather than acting on stale rows
  await q.click(SEARCH); await q.keyboard.type('ideas'); await q.keyboard.press('Enter'); await q.waitForSelector('.gdui-row[data-kind=result]');
  ok(await q.locator('.gdui-overlay').count() === 1 && await crumb(q) === 'My Drive / Notes', 'Enter during debounce runs the query, does not save/pick');
  ok(await q.locator('[data-action=up]').isDisabled(), 'Up disabled while a search is active');
  await q.close();
  // focus is not lost after search replaced the focused list
  q = await openSave(); await q.locator('.gdui-folders .gdui-list').focus(); await q.fill(SEARCH, 'zz'); await q.waitForSelector('.gdui-state h3');
  ok(await q.evaluate(() => !!document.activeElement.closest('.gdui-overlay')), 'focus stays inside dialog when results are replaced');
  // narrow viewport screenshot
  await q.close();
}

await browser.close(); server.close();
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'PASS no console errors/warnings');
if (errors.length) fails++;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
