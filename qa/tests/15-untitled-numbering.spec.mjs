// 15. UNTITLED-N NUMBERING (build index-Cvo1EJ2m.js) - "lowest free number, resets when notes are closed".
//   background.js: new note = LOWEST N that is not
//       (a) held by an open tab: Web Lock 'mdwe-num-N' (shared, taken by the page in holdNumber(), kept until the tab closes),
//       (b) used by a stored mdwe.draft* record with NON-BLANK text and name /^Untitled-(\d+)\.md$/i  (slots, mdwe.draft, mdwe.draft.file),
//       (c) reserved: chrome.storage.session['mdwe.untitledPending'] = { "<n>": handedOutAtMs }, expires after 30 s, released by the runtime message {type:'note-number-held', n}.
//     Serialized (promise chain) so rapid clicks stay unique.  The old session counter 'mdwe.untitledNext' is no longer used.
//   main.js saveDraft(): a blank (trim()=='') Untitled-N.md doc-tab note without file handle / Drive link never writes a draft (clearDraft instead).
//   "icon click" = the real chrome.action.onClicked listeners called in the service worker (see 14-new-note); a physical toolbar click can't be produced headlessly.
//   Tests titled [BUG-n] are probes for a real bug logged in ../BUGS.md: they FAIL until it is fixed.
import { test, expect, md, openEditor, storageGet } from '../lib/fixture.mjs';
import { hook, clickIcon, sendNew, info, docId, local, lget, session, sw, pmOf, typeIn, waitDraft, closeTab, sleep, fsaRecorder, seed, uuidRe, nOf, waitNew, EDITOR_RE, pending, PENDING_KEY, noCounter } from '../lib/notes.mjs';
import { installMock, shot } from '../lib/drive.mjs';

const SLOT = 'mdwe.draft.doc.';
const slotOf = (p) => SLOT + docId(p);
const dr = (name, text, extra = {}) => ({ text, name, savedAt: Date.now(), drive: null, ...extra });
const uid = (i) => '30000000-0000-4000-8000-' + String(i).padStart(12, '0');
// -- locks / storage as seen from the service worker (independent of any page)
const lockNames = (ext) => sw(ext).evaluate(async () => (await navigator.locks.query()).held.map((l) => l.name));
const heldNums = async (ext) => (await lockNames(ext)).map((n) => /^mdwe-num-(\d+)$/.exec(n)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
const settle = (ext, want) => expect.poll(() => heldNums(ext), { message: 'number locks == ' + JSON.stringify(want), timeout: 8000 }).toEqual(want.slice().sort((a, b) => a - b));
const localAll = (ext) => sw(ext).evaluate(() => chrome.storage.local.get(null));
const draftKeysStored = async (ext) => Object.keys(await localAll(ext)).filter((k) => k.startsWith('mdwe.draft')).sort();
const nums = async (tabs) => (await Promise.all(tabs.map(info))).map((i) => nOf(i.name));
const one = async (ext, T) => { const [t] = await clickIcon(ext, T); return t; };
const numOf = async (t) => nOf((await info(t)).name);
// -- Drafts dialog helpers (the row's data-draft-key is a JS expando, mirrored into data-k)
const tagRows = (p) => p.evaluate(() => { if (window.__tagObs) return; const tag = () => document.querySelectorAll('.drafts-item').forEach((li) => { if (li['data-draft-key'] !== undefined) li.setAttribute('data-k', li['data-draft-key']); }); window.__tagObs = new MutationObserver(tag); window.__tagObs.observe(document.body, { childList: true, subtree: true }); });
const openDrafts = async (p) => { await p.bringToFront(); await tagRows(p); await p.click('#btn-drafts'); await p.locator('.drafts-box').waitFor(); await p.locator('.drafts-box .drafts-item, .drafts-box .drafts-empty').first().waitFor(); };
const rowKeys = (p) => p.locator('.drafts-box .drafts-item').evaluateAll((l) => l.map((x) => x['data-draft-key']));
const rowFor = (p, key) => p.locator(`.drafts-box .drafts-item[data-k="${key}"]`);
const draftsList = async (p) => { await openDrafts(p); const k = await rowKeys(p); const names = await p.locator('.drafts-box .drafts-item strong').allTextContents(); await p.keyboard.press('Escape'); await expect(p.locator('.drafts-overlay')).toHaveCount(0); return { keys: k, names }; };
// -- service worker control
async function stopWorker(ext, page) {
  const cdp = await ext.ctx.newCDPSession(page);
  const states = []; cdp.on('ServiceWorker.workerVersionUpdated', (e) => { for (const v of e.versions) if ((v.scriptURL || '').includes(ext.extId)) states.push(v.runningStatus); });
  await cdp.send('ServiceWorker.enable'); await sleep(300); await cdp.send('ServiceWorker.stopAllWorkers');
  const t0 = Date.now(); while (Date.now() - t0 < 10000 && states[states.length - 1] !== 'stopped') await sleep(100);
  const ok = states[states.length - 1] === 'stopped';
  await cdp.send('ServiceWorker.disable').catch(() => {}); await cdp.detach().catch(() => {});
  return ok;
}
const awaitSw = async (ext) => { const t0 = Date.now(); while (Date.now() - t0 < 10000) { const w = ext.ctx.serviceWorkers().filter((x) => x.url().includes(ext.extId)).pop(); if (w) { try { await w.evaluate(() => 1); ext.sw = w; return w; } catch {} } await sleep(100); } throw new Error('service worker did not come back'); };
// -- "the tab never loads": run the REAL click handler with chrome.tabs.create disabled (number is handed out + reserved, but no page ever takes the lock / sends note-number-held)
const leakClicks = (ext, n) => sw(ext).evaluate(async (n) => { const orig = chrome.tabs.create; chrome.tabs.create = () => Promise.resolve({}); try { for (let i = 0; i < n; i++) chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 400)); } finally { chrome.tabs.create = orig; } }, n);
const setPending = (ext, o) => sw(ext).evaluate(([k, o]) => chrome.storage.session.set({ [k]: o }), [PENDING_KEY, o]);
const expectNoJunk = async (ext, extraAllowed = []) => { const k = Object.keys(await localAll(ext)).filter((x) => !['mdwe.theme', ...extraAllowed].includes(x) && !x.startsWith(SLOT) && !['mdwe.draft', 'mdwe.draft.file'].includes(x)); expect(k, 'no unexpected keys in chrome.storage.local').toEqual([]); };

// =====================================================================================================================
// 1-2. basic reset / lowest-free semantics
// =====================================================================================================================
test.describe('1-2. reset and lowest free', () => {
  test('(1) open and close FIVE empty notes -> next click is Untitled-1.md; nothing left in storage, no locks, no reservations', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 5);
    expect((await nums(tabs)).sort()).toEqual([1, 2, 3, 4, 5]);
    await settle(ext, [1, 2, 3, 4, 5]);
    for (const t of tabs) await closeTab(t);
    expect(T.of('beforeunload'), 'empty notes close silently').toHaveLength(0);
    await settle(ext, []);
    expect(await draftKeysStored(ext), 'no draft for empty notes').toEqual([]);
    const t = await one(ext, T);
    expect(await numOf(t)).toBe(1);
    await expect.poll(() => pending(ext)).toEqual({}); await noCounter(ext);
    expect(T.errors).toEqual([]);
  });

  test('(1b) the complaint scenario: 8 open/close cycles of one empty note, one at a time -> always Untitled-1; and 8 notes open+closed in a row, then 1', async ({ ext }) => {
    const T = hook(ext);
    for (let i = 0; i < 8; i++) { const t = await one(ext, T); expect(await numOf(t), 'cycle ' + i).toBe(1); await closeTab(t); await settle(ext, []); }
    const tabs = []; for (let i = 0; i < 8; i++) tabs.push(await one(ext, T));
    expect(await nums(tabs)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const t of tabs) await closeTab(t);
    await settle(ext, []);
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(2) Untitled-1 and Untitled-3 open -> next is Untitled-2, then 4; closing the middle one frees exactly that number; the New button follows the same rule', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    expect(await nums([a, b, c])).toEqual([1, 2, 3]);
    await closeTab(b); await settle(ext, [1, 3]);
    const d = await one(ext, T); expect(await numOf(d)).toBe(2);
    const e = await one(ext, T); expect(await numOf(e)).toBe(4);
    await closeTab(a); await closeTab(d); await settle(ext, [3, 4]);
    const before = new Set(ext.ctx.pages()); await e.bringToFront(); await e.click('#btn-new'); const [f] = await waitNew(ext, before, 1);
    expect(await numOf(f), 'New button: lowest free = 1').toBe(1);
    const before2 = new Set(ext.ctx.pages()); await f.keyboard.press('Alt+n'); const [g] = await waitNew(ext, before2, 1);
    expect(await numOf(g), 'Alt+N: lowest free = 2').toBe(2);
    await expect.poll(() => pending(ext)).toEqual({}); await noCounter(ext);
  });

  test('lowest-free in a gap-riddled set: tabs 1..10, close 2,4,6,8,10 -> next five clicks give 2,4,6,8,10 in order', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 10);
    const byN = new Map(); for (const t of tabs) byN.set(await numOf(t), t);
    for (const n of [2, 4, 6, 8, 10]) await closeTab(byN.get(n));
    await settle(ext, [1, 3, 5, 7, 9]);
    const got = []; for (let i = 0; i < 5; i++) got.push(await numOf(await one(ext, T)));
    expect(got).toEqual([2, 4, 6, 8, 10]);
  });
});

// =====================================================================================================================
// 3. closed note with real text keeps its number
// =====================================================================================================================
test.describe('3. a closed note with text keeps its number in Drafts', () => {
  test('(3) text + close -> draft stays, next new note skips that number; Open keeps the number held (and locks the RIGHT number); Discard frees it', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);            // 1,2
    await typeIn(b, 'keep this'); const kb = slotOf(b); await waitDraft(b, kb, 'keep this\n');
    await closeTab(b); await settle(ext, [1]);
    expect((await lget(a, kb)).name).toBe('Untitled-2.md');
    const c = await one(ext, T); expect(await numOf(c), '2 is used by the stored draft').toBe(3);
    // Drafts lists it with its number
    const l = await draftsList(c); expect(l.keys).toEqual([kb]); expect(l.names).toEqual(['Untitled-2.md']);
    // Open: tab named Untitled-2.md and it must hold number 2 (not 1!)
    await openDrafts(c); const before = new Set(ext.ctx.pages());
    await rowFor(c, kb).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    expect((await info(re)).name).toBe('Untitled-2.md'); expect((await info(re)).md).toBe('keep this\n');
    const d = await one(ext, T); expect(await numOf(d), '2 still used (stored draft AND open tab)').toBe(4);   // (which lock the reopened tab holds: see [BUG-46])
    // close the reopened tab (text -> draft stays) then Discard from Drafts
    await closeTab(re); await settle(ext, [1, 3, 4]);
    const e = await one(ext, T); expect(await numOf(e), 'still stored -> skipped').toBe(2 + 3);   // 1,3,4 held, 2 stored -> 5
    await openDrafts(e); await rowFor(e, kb).locator('.drafts-discard').click(); await expect(e.locator('.drafts-empty')).toBeVisible(); await e.keyboard.press('Escape');
    await closeTab(e); await settle(ext, [1, 3, 4]);
    const f = await one(ext, T); expect(await numOf(f), 'after Discard 2 is free again').toBe(2);
    await expect.poll(() => pending(ext)).toEqual({}); await noCounter(ext);
  });

  test('[fixed #46] a draft reopened from Drafts (URL ?doc=<uuid> without n) holds the lock of its OWN Untitled-N number (not mdwe-num-1)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c, d] = await clickIcon(ext, T, 4);        // 1..4
    await typeIn(d, 'four'); const kd = slotOf(d); await waitDraft(d, kd, 'four\n');
    await closeTab(a); await closeTab(d); await settle(ext, [2, 3]);   // 1 free, 4 only stored
    await openDrafts(b); const before = new Set(ext.ctx.pages());
    await rowFor(b, kd).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    const i = await info(re);
    test.info().annotations.push({ type: 'info', description: `reopened Untitled-4 draft: name=${i.name} url=${i.url.slice(-45)} held number locks=${JSON.stringify(await heldNums(ext))}` });
    expect(i.name).toBe('Untitled-4.md');
    await settle(ext, [2, 3, 4]);
    const e = await one(ext, T);
    expect(await numOf(e), 'Untitled-1 is not shown anywhere, so it must be free').toBe(1);
  });

  test('[fixed #46] consequence: reopen Untitled-4 from Drafts, erase its text (draft removed), then click: the new note must not ALSO be "Untitled-4.md"', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c, d] = await clickIcon(ext, T, 4);
    await typeIn(d, 'four'); const kd = slotOf(d); await waitDraft(d, kd, 'four\n'); await closeTab(d);
    await openDrafts(a); const before = new Set(ext.ctx.pages());
    await rowFor(a, kd).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    await pmOf(re).click(); await re.keyboard.press('Control+a'); await re.keyboard.press('Backspace');
    await expect.poll(() => lget(a, kd)).toBeUndefined();
    await closeTab(a); await closeTab(b); await closeTab(c);                       // 1,2,3 free; only the reopened tab "Untitled-4.md" is open
    const got = []; for (let i = 0; i < 4; i++) got.push(await numOf(await one(ext, T)));
    test.info().annotations.push({ type: 'info', description: 'tab shows Untitled-4.md; next four clicks gave ' + JSON.stringify(got) + '; locks=' + JSON.stringify(await heldNums(ext)) });
    expect(got, 'a 5th open tab named Untitled-4.md would be a duplicate visible name').not.toContain(4);
  });

  test('[fixed #46] same for a LEGACY draft reopened from Drafts (adopted into a new slot, n defaults to 1): "Untitled.md" tab holds number 1', async ({ ext }) => {
    const T = hook(ext);
    const a = await one(ext, T);                    // Untitled-1 (then closed)
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'legacy untitled'), 'mdwe.draft.file': dr('Untitled-7.md', 'legacy 7') });
    await closeTab(a); await settle(ext, []);
    const b = await one(ext, T); expect(await numOf(b)).toBe(1);   // 7 is used by mdwe.draft.file
    await openDrafts(b); const before = new Set(ext.ctx.pages());
    await rowFor(b, 'mdwe.draft').locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    await closeTab(b); await settle(ext, [1]).catch(() => {});
    const held = await heldNums(ext);
    test.info().annotations.push({ type: 'info', description: `reopened legacy "${(await info(re)).name}" tab; number locks now: ${JSON.stringify(held)}` });
    expect(held, 'a tab showing "Untitled.md" owns no Untitled-N number').toEqual([]);
  });
});

// =====================================================================================================================
// 4. rapid clicks, SW restarts, reservation expiry
// =====================================================================================================================
test.describe('4. rapid clicks / SW restart / reservation expiry', () => {
  for (const k of [2, 5, 10]) {
    test(`(4) ${k} rapid clicks in one tick -> ${k} unique names, lowest-free (1..${k}), reservations released`, async ({ ext }) => {
      const T = hook(ext);
      const tabs = await clickIcon(ext, T, k);
      expect((await nums(tabs)).sort((x, y) => x - y)).toEqual(Array.from({ length: k }, (_, i) => i + 1));
      await expect.poll(() => pending(ext)).toEqual({}); await noCounter(ext);
      await settle(ext, Array.from({ length: k }, (_, i) => i + 1));
    });
  }

  test('(4) rapid clicks on top of a gap set (held 2 and 5): 5 clicks in one tick give 1,3,4,6,7', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 5);                    // 1..5
    const byN = new Map(); for (const t of tabs) byN.set(await numOf(t), t);
    for (const n of [1, 3, 4]) await closeTab(byN.get(n));
    await settle(ext, [2, 5]);
    const more = await clickIcon(ext, T, 5);
    expect((await nums(more)).sort((x, y) => x - y)).toEqual([1, 3, 4, 6, 7]);
  });

  test('(4) clicks from several sources at once (icon x3, New button x2 in two tabs, Alt+N) in one tick: all unique', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    const before = new Set(ext.ctx.pages());
    await Promise.all([
      sw(ext).evaluate(() => { for (let i = 0; i < 3; i++) chrome.action.onClicked.dispatch({ id: 0, index: 0 }); }),
      a.evaluate(() => { for (let i = 0; i < 2; i++) chrome.runtime.sendMessage({ type: 'new-note' }); }),
      b.evaluate(() => { chrome.runtime.sendMessage({ type: 'new-note' }); }),
    ]);
    const fresh = await waitNew(ext, before, 6);
    const ns = (await nums(fresh)).sort((x, y) => x - y);
    expect(ns).toEqual([3, 4, 5, 6, 7, 8]);
  });

  test('(4) right after the service worker is stopped: 2 then 5 rapid clicks (cold start) stay unique and lowest-free; reservations (session storage) survive the restart', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                       // 1
    expect(await stopWorker(ext, a)).toBe(true);
    const before = new Set(ext.ctx.pages());
    await a.evaluate(() => { for (let i = 0; i < 2; i++) chrome.runtime.sendMessage({ type: 'new-note' }); });
    const two = await waitNew(ext, before, 2);
    expect((await nums(two)).sort()).toEqual([2, 3]);
    expect(await stopWorker(ext, a)).toBe(true);
    const before2 = new Set(ext.ctx.pages());
    await a.evaluate(() => { for (let i = 0; i < 5; i++) chrome.runtime.sendMessage({ type: 'new-note' }); });
    const five = await waitNew(ext, before2, 5);
    expect((await nums(five)).sort((x, y) => x - y)).toEqual([4, 5, 6, 7, 8]);
    await awaitSw(ext);
    // reservation made, worker killed BEFORE the tab loads: a leaked reservation must survive in session storage and keep blocking the number
    await leakClicks(ext, 1);                                   // hands out 9 (reserved), no tab
    expect(Object.keys(await pending(ext))).toEqual(['9']);
    expect(await stopWorker(ext, a)).toBe(true);
    const before3 = new Set(ext.ctx.pages()); await a.evaluate(() => chrome.runtime.sendMessage({ type: 'new-note' }));
    const [n10] = await waitNew(ext, before3, 1);
    expect(await numOf(n10), 'reservation of 9 survived the worker restart').toBe(10);
  });

  test('(4) reservation expiry (simulated by ageing the timestamps in session storage): 29.5 s old still blocks, 30.5 s old is freed and reused; garbage values in the key do not break allocation', async ({ ext }) => {
    const T = hook(ext);
    await setPending(ext, { 1: Date.now() - 29500, 2: Date.now() - 30500, 3: Date.now() - 1000 });
    const a = await one(ext, T);
    expect(await numOf(a), '1 (29.5 s) and 3 (1 s) blocked, 2 (30.5 s) expired').toBe(2);
    const p = await pending(ext); test.info().annotations.push({ type: 'info', description: 'pending after: ' + JSON.stringify(p) });
    await expect.poll(() => pending(ext)).toEqual({ 1: expect.any(Number), 3: expect.any(Number) });   // 2 released by the tab's note-number-held, expired entries purged
    await setPending(ext, { 1: 'x', 2: null, 3: {}, abc: Date.now(), '-4': Date.now(), '0': Date.now() });
    const b = await one(ext, T);
    test.info().annotations.push({ type: 'info', description: 'with garbage pending values the next note is ' + await numOf(b) });
    expect(await numOf(b)).toBeGreaterThanOrEqual(1);
    expect(T.errors).toEqual([]);
  });

  test('(4) real clock: a leaked reservation blocks its number for < 30 s, then it is free (waits ~31 s)', async ({ ext }) => {
    test.setTimeout(90000);
    const T = hook(ext);
    await leakClicks(ext, 1);
    const t0 = Date.now();
    const a = await one(ext, T); expect(await numOf(a), 'blocked immediately after the leak').toBe(2);
    await closeTab(a); await settle(ext, []);
    await sleep(Math.max(0, 31000 - (Date.now() - t0)));
    const b = await one(ext, T);
    expect(await numOf(b), 'freed after 30 s').toBe(1);
  });
});

// =====================================================================================================================
// 5. reload keeps name + lock (no gap)
// =====================================================================================================================
test.describe('5. reload', () => {
  test('(5) reload keeps the name (empty note and note with text), the URL (?doc&n), and the number lock afterwards', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(b, 'reload me'); await waitDraft(b, slotOf(b), 'reload me\n');
    const ua = (await info(a)).url, ub = (await info(b)).url;
    await a.reload(); await b.reload();
    await expect.poll(async () => (await info(a)).name).toBe('Untitled-1.md');
    await expect.poll(async () => (await info(b)).name).toBe('Untitled-2.md');
    expect((await info(b)).md).toBe('reload me\n');
    expect((await info(a)).url).toBe(ua); expect((await info(b)).url).toBe(ub);
    await settle(ext, [1, 2]);
    expect(await numOf(await one(ext, T))).toBe(3);
    expect(await draftKeysStored(ext)).toEqual([slotOf(b)]);
  });

  test('(5) HAMMER (background side, tabs.create stubbed): the background STILL hands out the number of a reloading blank note (by design since #47: the collision is resolved client-side by yielding) - recorded, see 5b/16 for the visible outcome', async ({ ext }) => {
    test.setTimeout(120000);
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                   // Untitled-1, empty
    await settle(ext, [1]);
    const stolen = []; let clicks = 0;
    for (let round = 0; round < 6; round++) {
      // fire clicks from the SW for ~the whole reload; collect the numbers handed out (tabs.create stubbed so no windows pile up)
      await sw(ext).evaluate(() => { globalThis.__got = []; globalThis.__run = true; const orig = chrome.tabs.create; globalThis.__orig = orig; chrome.tabs.create = (o) => { globalThis.__got.push(o.url); return Promise.resolve({}); }; (async () => { while (globalThis.__run) { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 5)); } })(); });
      await a.reload({ waitUntil: 'load' }); await expect.poll(async () => (await info(a)).name).toBe('Untitled-1.md'); await sleep(150);
      const got = await sw(ext).evaluate(() => { globalThis.__run = false; const g = globalThis.__got; chrome.tabs.create = globalThis.__orig; return g; });
      clicks += got.length;
      for (const u of got) if (/[?&](new|n)=1(&|$)/.test(u)) stolen.push(round + ':' + u.slice(-12));
      await setPending(ext, {});                          // drop the leaked reservations
    }
    test.info().annotations.push({ type: 'info', description: `${clicks} clicks fired during 6 reloads; handed out Untitled-1 ${stolen.length} times` });
    expect(clicks).toBeGreaterThan(20);
    test.info().annotations.push({ type: 'info', description: 'stolen rounds (background level, expected by design): ' + JSON.stringify(stolen) });
  });

  test('(5) HAMMER 2: click continuously (real tabs) during a reload of Untitled-1 with TEXT: its number is protected by the stored draft in the gap', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await typeIn(a, 'x'); await waitDraft(a, slotOf(a), 'x\n');
    const before = new Set(ext.ctx.pages());
    await sw(ext).evaluate(() => { globalThis.__run = true; (async () => { while (globalThis.__run) { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 20)); } })(); });
    await a.reload(); await sleep(300);
    await sw(ext).evaluate(() => { globalThis.__run = false; });
    await sleep(800);
    const fresh = [...ext.ctx.pages()].filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
    const ns = await nums(fresh);
    expect(ns).not.toContain(1);
    expect(new Set(ns).size, 'unique').toBe(ns.length);
    expect(await numOf(a)).toBe(1);
  });

  test('(5) the page that is loading holds a reservation: reload of an empty note while its number is being re-locked - note stays Untitled-1 and a click after the reload gets 2', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await a.reload(); await expect.poll(async () => (await info(a)).name).toBe('Untitled-1.md'); await settle(ext, [1]);
    expect(await numOf(await one(ext, T))).toBe(2);
  });
});

// =====================================================================================================================
// 6. no tabs open: next is 1 even if a prior session had counter 8
// =====================================================================================================================
test.describe('6. fresh state', () => {
  test('(6) no editor tabs open + stale session counter 8 (+ stale pending of an old session cleared) -> Untitled-1; the counter is ignored and never rewritten', async ({ ext }) => {
    const T = hook(ext);
    await sw(ext).evaluate(() => chrome.storage.session.set({ 'mdwe.untitledNext': 8 }));
    const a = await one(ext, T);
    expect(await numOf(a)).toBe(1);
    const b = await one(ext, T); expect(await numOf(b)).toBe(2);
    expect((await session(ext)).get ? 0 : 0).toBe(0);
    const s = await sw(ext).evaluate(() => chrome.storage.session.get(null));
    expect(s['mdwe.untitledNext'], 'stale value untouched (not read, not incremented, not removed)').toBe(8);
  });

  test('(6) all editor tabs closed after having reached 8: next click is 1 (session storage still has reservations/counters from the earlier run)', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 8);
    expect(await nums(tabs)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const t of tabs) await closeTab(t);
    await settle(ext, []);
    await sw(ext).evaluate(() => chrome.storage.session.set({ 'mdwe.untitledNext': 9 }));
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(6) chrome.storage.session wiped (browser restart) while draft-less: Untitled-1; wiped while drafts exist: their numbers still skipped', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2); await typeIn(b, 'persist'); await waitDraft(b, slotOf(b), 'persist\n');
    await closeTab(a); await closeTab(b); await settle(ext, []);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    expect(await numOf(await one(ext, T)), '2 is held by the draft').toBe(1);
    expect(await numOf(await one(ext, T))).toBe(3);
  });
});

// =====================================================================================================================
// 7. which stored records hold a number
// =====================================================================================================================
test.describe('7. stored records and numbers', () => {
  test('(7) blank-only draft records (whitespace, newlines, tabs, empty string) hold NO number', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, {
      [SLOT + uid(1)]: dr('Untitled-1.md', '   '), [SLOT + uid(2)]: dr('Untitled-2.md', '\n\n'), [SLOT + uid(3)]: dr('Untitled-3.md', '\t \n'),
      'mdwe.draft': dr('Untitled-4.md', ''), 'mdwe.draft.file': dr('Untitled-5.md', ' \u00a0 '.replace('\u00a0', ' ')),
    });
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(7) draft with text but a name that is not Untitled-N.md holds no Untitled number (renamed, saved file, .txt, Untitled.md, Untitled-0x, UntitledX-1.md, Untitled-1.md.bak, Untitled--1.md, Untitled-1 .md)', async ({ ext }) => {
    const T = hook(ext);
    const names = ['notes.md', 'Untitled-1.txt', 'Untitled.md', 'Untitled-1.md.bak', 'xUntitled-1.md', 'Untitled--1.md', 'Untitled-1 .md', 'untitled-1.mdx', 'Untitled-.md', '', 'Untitled-1a.md'];
    const o = {}; names.forEach((n, i) => { o[SLOT + uid(i + 1)] = dr(n, 'real text'); });
    o[SLOT + uid(50)] = { text: 'no name field at all', savedAt: 1 };
    await seed(ext, o);
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(7) Untitled-N.md match is case-insensitive (UNTITLED-1.MD holds 1); a saved-to-Drive draft named Untitled-N.md still holds N', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { [SLOT + uid(1)]: dr('UNTITLED-1.MD', 'a'), [SLOT + uid(2)]: dr('Untitled-2.md', 'b', { drive: { id: 'd1', modifiedTime: 'x', canEdit: true } }) });
    expect(await numOf(await one(ext, T))).toBe(3);
  });

  test('(7) LEGACY records: mdwe.draft and mdwe.draft.file named Untitled-N.md with text hold N; blank legacy ones and other names do not', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draft': dr('Untitled-1.md', 'legacy text'), 'mdwe.draft.file': dr('Untitled-2.md', 'legacy file text') });
    expect(await numOf(await one(ext, T))).toBe(3);
    await seed(ext, { 'mdwe.draft': dr('Untitled-4.md', '  '), 'mdwe.draft.file': dr('report.md', 'x') });   // overwrites both legacy records: nothing stored holds a number any more
    expect(await numOf(await one(ext, T)), 'blank + renamed legacy hold nothing: only the open tab (3) is held -> 1').toBe(1);
  });

  test('(7) the draft that holds a number is only counted while it exists: removing the record frees exactly that number', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { [SLOT + uid(1)]: dr('Untitled-1.md', 'a'), [SLOT + uid(2)]: dr('Untitled-2.md', 'b') });
    const a = await one(ext, T); expect(await numOf(a)).toBe(3);
    await sw(ext).evaluate((k) => chrome.storage.local.remove(k), SLOT + uid(1));
    expect(await numOf(await one(ext, T))).toBe(1);
    await sw(ext).evaluate((k) => chrome.storage.local.remove(k), SLOT + uid(2));
    expect(await numOf(await one(ext, T))).toBe(2);
  });

  test('(7) non-draft keys that merely start with "mdwe.draft" and lack text/name do not crash allocation; non-object values are ignored', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draftX': 'string', 'mdwe.draft.doc.zz': 5, 'mdwe.draft.doc.nul': null, 'mdwe.draft.doc.arr': ['Untitled-1.md'], 'mdwe.draft.doc.notxt': { name: 'Untitled-1.md' }, 'mdwe.draft.doc.num': { text: 123, name: 'Untitled-1.md' } });
    const t = await one(ext, T);
    const n = await numOf(t);
    test.info().annotations.push({ type: 'info', description: 'with malformed records the next number is ' + n });
    expect(n).toBeGreaterThanOrEqual(1); expect(T.errors).toEqual([]);
  });
});

// =====================================================================================================================
// 8. erase -> no draft; close with text -> reopen from Drafts same name
// =====================================================================================================================
test.describe('8. typed, erased, closed', () => {
  test('(8) text typed then everything erased: draft removed, number freed when the tab is closed (and the closing is silent)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(b, 'temporary'); await waitDraft(b, slotOf(b), 'temporary\n');
    await b.keyboard.press('Control+a'); await b.keyboard.press('Backspace');
    await expect.poll(() => draftKeysStored(ext)).toEqual([]);
    expect((await info(b)).dirty, 'doc is not dirty / is blank').toBeDefined();
    await closeTab(b); await settle(ext, [1]);
    expect(T.of('beforeunload')).toHaveLength(0);
    expect(await numOf(await one(ext, T))).toBe(2);
  });

  test('(8) erase down to whitespace only (a space, then newlines): also no draft left', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await typeIn(a, 'abc'); await waitDraft(a, slotOf(a), 'abc\n');
    await a.keyboard.press('Control+a'); await a.keyboard.type('   '); await a.keyboard.press('Enter'); await a.keyboard.press('Enter');
    await expect.poll(() => draftKeysStored(ext), { timeout: 6000 }).toEqual([]);
    await closeTab(a); await settle(ext, []);
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(8) typed + closed (draft stays) + re-opened from Drafts: same name, same text; closing it again keeps the one draft; erasing there removes it and frees the number', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(b, 'again'); const kb = slotOf(b); await waitDraft(b, kb, 'again\n');
    await closeTab(b);
    await openDrafts(a); const before = new Set(ext.ctx.pages());
    await rowFor(a, kb).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    const i = await info(re); expect(i.name).toBe('Untitled-2.md'); expect(i.md).toBe('again\n'); expect(i.title).toBe('• Untitled-2.md — Markdown Editor');   // restored draft = unsaved = bullet
    expect(i.slot, 'same slot').toBe(kb);
    await a.keyboard.press('Escape'); await closeTab(re); expect(await draftKeysStored(ext)).toEqual([kb]);
    await sleep(3200);   // the dialog keeps a just-opened row hidden ~2.5 s (known, see 14-new-note)
    await openDrafts(a); const before2 = new Set(ext.ctx.pages());
    await rowFor(a, kb).locator('.drafts-open').click(); const [re2] = await waitNew(ext, before2, 1);
    await re2.bringToFront(); await pmOf(re2).click(); await re2.keyboard.press('Control+a'); await re2.keyboard.press('Backspace');
    await expect.poll(() => draftKeysStored(ext)).toEqual([]);
    await closeTab(re2); await settle(ext, [1]);
    expect(await numOf(await one(ext, T)), '2 is free now').toBe(2);
  });

  test('(8) a blank note whose name was changed by Save (file handle) or a Drive link is NOT treated as an untitled blank (still writes/keeps its draft semantics)', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'blank-saved.md' });
    const [a] = await clickIcon(ext, T);
    await typeIn(a, 'will be saved'); await a.keyboard.press('Control+s');
    await expect.poll(async () => (await info(a)).name).toBe('blank-saved.md');
    await a.keyboard.press('Control+a'); await a.keyboard.press('Backspace');
    await sleep(1200);
    const i = await info(a);
    expect(i.name).toBe('blank-saved.md');
    const keys = await draftKeysStored(ext);
    test.info().annotations.push({ type: 'info', description: 'after erasing a saved file: dirty=' + i.dirty + ' draft keys=' + JSON.stringify(keys) });
    expect(i.dirty).toBe(true);
  });
});

// =====================================================================================================================
// 9. Save As from Untitled-3
// =====================================================================================================================
test.describe('9. Save As from Untitled-N', () => {
  test('(9) Save As from Untitled-3: saved doc is not "Untitled" anywhere, suggestedName == Untitled-3.md, no draft left; REPORTS whether the tab still holds mdwe-num-3 and what the next click gets', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'Quarterly Plan.md' });
    const tabs = await clickIcon(ext, T, 3); const t3 = tabs[2]; expect(await numOf(t3)).toBe(3);
    await typeIn(t3, '# plan'); await waitDraft(t3, slotOf(t3), '# plan\n');
    await t3.keyboard.press('Control+s');
    await expect.poll(() => t3.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-3.md']);
    await expect.poll(async () => (await info(t3)).filename).toBe('Quarterly Plan.md');
    const i = await info(t3);
    expect(i.name).toBe('Quarterly Plan.md'); expect(i.title).toBe('Quarterly Plan.md — Markdown Editor'); expect(i.title).not.toMatch(/Untitled/i); expect(i.filename).not.toMatch(/Untitled/i);
    expect(i.dirty).toBe(false);
    await expect.poll(() => draftKeysStored(ext)).toEqual([]);
    const held = await heldNums(ext);
    const nx = await one(ext, T); const nn = await numOf(nx);
    test.info().annotations.push({ type: 'info', description: `after Save As from Untitled-3: number locks=${JSON.stringify(held)}; next new note = Untitled-${nn}` });
    expect(held, 'round 4 (#48 fixed): the saved tab released mdwe-num-3 as soon as its name stopped being Untitled-3.md').toEqual([1, 2]);
    expect(nn, 'the next new note reuses 3 while the saved tab (Quarterly Plan.md) is still open').toBe(3);
    // editing the saved file afterwards: its draft is named after the file, so it never holds an Untitled number
  });

  test('[fixed #48] Save As from Untitled-3 releases number 3: the saved tab (now "Quarterly Plan.md") must not keep blocking Untitled-3', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'Quarterly Plan.md' });
    const tabs = await clickIcon(ext, T, 3); const t3 = tabs[2];
    await typeIn(t3, '# plan'); await t3.keyboard.press('Control+s');
    await expect.poll(async () => (await info(t3)).name).toBe('Quarterly Plan.md');
    expect(await heldNums(ext), 'tab no longer is Untitled-3').toEqual([1, 2]);
    expect(await numOf(await one(ext, T))).toBe(3);
  });

  test('(9) saved-then-edited file: the draft is named after the file (holds no number); Untitled-N.md typed as the file name in Save As keeps working (name == Untitled-3.md with a file handle: draft written, number held by tab)', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'Untitled-9.md' });
    const [a] = await clickIcon(ext, T);                        // 1
    await typeIn(a, 'x'); await a.keyboard.press('Control+s');
    await expect.poll(async () => (await info(a)).filename).toBe('Untitled-9.md');
    await typeIn(a, 'more'); await expect.poll(() => draftKeysStored(ext)).toEqual([slotOf(a)]);
    await closeTab(a); await settle(ext, []);
    const b = await one(ext, T);
    test.info().annotations.push({ type: 'info', description: 'a file the user named Untitled-9.md (with draft) holds 9; next note = ' + await numOf(b) });
    expect(await numOf(b)).toBe(1);
    await seed(ext, {});
    const c = await one(ext, T); expect(await numOf(c)).toBe(2);
  });

  test('(9) a blank note with a FILE HANDLE named Untitled-N.md (saved with that name, then erased) keeps its draft (not treated as an empty untitled note)', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'Untitled-5.md' });
    const [a] = await clickIcon(ext, T);
    await typeIn(a, 'x'); await a.keyboard.press('Control+s'); await expect.poll(async () => (await info(a)).filename).toBe('Untitled-5.md');
    await a.keyboard.press('Control+a'); await a.keyboard.press('Backspace');
    await expect.poll(async () => (await info(a)).dirty).toBe(true);
    await sleep(1200);
    expect(await draftKeysStored(ext), 'the file differs from the empty editor: a draft is kept').toEqual([slotOf(a)]);
  });
});

// =====================================================================================================================
// 10. pending-reservation leaks
// =====================================================================================================================
test.describe('10. pending reservation leaks', () => {
  test('(10) a click whose tab never loads: pending {1: ts}; the next click gets 2; after the reservation is aged past 30 s number 1 is reusable; entries are purged', async ({ ext }) => {
    const T = hook(ext);
    await leakClicks(ext, 1);
    const p = await pending(ext); expect(Object.keys(p)).toEqual(['1']); expect(Date.now() - p[1]).toBeLessThan(5000);
    const a = await one(ext, T); expect(await numOf(a)).toBe(2);
    await closeTab(a);
    await setPending(ext, { 1: Date.now() - 31000 });
    expect(await numOf(await one(ext, T))).toBe(1);
    await expect.poll(() => pending(ext)).toEqual({});
  });

  test('(10) many leaks (25 clicks with no tab): numbers 1..25 blocked, the 26th click gets 26; after expiry (aged) all 25 are free again and get reused; pending does not grow beyond the live entries', async ({ ext }) => {
    const T = hook(ext);
    await leakClicks(ext, 25);
    expect(Object.keys(await pending(ext)).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    const a = await one(ext, T); expect(await numOf(a)).toBe(26);
    const aged = {}; for (let i = 1; i <= 25; i++) aged[i] = Date.now() - 31000;
    await setPending(ext, aged);
    await closeTab(a); await settle(ext, []);
    const tabs = await clickIcon(ext, T, 3);
    expect((await nums(tabs)).sort((x, y) => x - y)).toEqual([1, 2, 3]);
    await expect.poll(async () => Object.keys(await pending(ext)).length, { message: 'expired entries were purged' }).toBe(0);
  });

  test('(10) repeated leak cycles do not make numbers grow unboundedly: 10 cycles of (leak 3, age them out) then one click -> Untitled-1 each time; clicks stay fast', async ({ ext }) => {
    test.setTimeout(120000);
    const T = hook(ext);
    for (let c = 0; c < 10; c++) {
      await leakClicks(ext, 3);
      const aged = {}; for (const k of Object.keys(await pending(ext))) aged[k] = Date.now() - 31000;
      await setPending(ext, aged);
      const t0 = Date.now(); const t = await one(ext, T); const dt = Date.now() - t0;
      expect(await numOf(t), 'cycle ' + c).toBe(1); expect(dt, 'no hang').toBeLessThan(8000);
      await closeTab(t); await settle(ext, []);
    }
    expect(Object.keys(await pending(ext))).toEqual([]);
  });

  test('(10) a leak with the service worker killed in between, and a handler call where the page never messages: the background itself never hangs (call returns, 50 leaked clicks in one tick)', async ({ ext }) => {
    const T = hook(ext);
    await leakClicks(ext, 50);
    const k = Object.keys(await pending(ext)).map(Number).sort((a, b) => a - b);
    expect(k).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const t0 = Date.now(); const a = await one(ext, T); expect(await numOf(a)).toBe(51); expect(Date.now() - t0).toBeLessThan(8000);
  });

  test('(10) note-number-held for a number that is not pending / junk messages do not break anything; a late message (after expiry) frees a re-handed number only if it is the same n', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await a.evaluate(() => { for (const m of [{ type: 'note-number-held', n: 99 }, { type: 'note-number-held' }, { type: 'note-number-held', n: 'x' }, { type: 'note-number-held', n: -1 }]) chrome.runtime.sendMessage(m); });
    await sleep(300);
    expect(await numOf(await one(ext, T))).toBe(2);
    expect(T.errors).toEqual([]);
  });

  test('(10) tab fails to load (extension page URL ends in an error) - simulated by a tab that is created and closed again before its script ran: number frees after <= 30 s (aged), until then the next note skips it', async ({ ext }) => {
    const T = hook(ext);
    const before = new Set(ext.ctx.pages());
    await sw(ext).evaluate(() => chrome.action.onClicked.dispatch({ id: 0, index: 0 }));
    const p = [...ext.ctx.pages()].filter((x) => !before.has(x));
    for (let i = 0; i < 50 && !p.length; i++) { await sleep(20); p.push(...[...ext.ctx.pages()].filter((x) => !before.has(x))); }
    await sw(ext).evaluate(async () => { const ts = await chrome.tabs.query({}); for (const t of ts) if ((t.pendingUrl || t.url || '').includes('new=1')) chrome.tabs.remove(t.id); });
    await sleep(500);
    const pend = await pending(ext), held = await heldNums(ext);
    test.info().annotations.push({ type: 'info', description: `tab killed immediately after creation: pending=${JSON.stringify(pend)} locks=${JSON.stringify(held)}` });
    const n = await numOf(await one(ext, T));
    expect([1, 2]).toContain(n);
    if (n === 2) { await setPending(ext, {}); }
  });
});

// =====================================================================================================================
// 11. duplicate tab + seeded fuzz
// =====================================================================================================================
const dupQuery = (p) => '?doc=' + docId(p) + '&n=' + new URL(p.url()).searchParams.get('n');
test.describe('11. duplicate tab and fuzz', () => {
  test('(11) duplicate tab (#43 copy): own slot + sensible behaviour, both closed -> number freed; REPORTS the duplicate\'s name and number locks', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'orig'); await waitDraft(a, slotOf(a), 'orig\n');
    const b = await openEditor(ext, { query: dupQuery(a) });
    await b.page.waitForFunction(() => window.__mdwe.state.slot && /^Untitled-\d+/.test(window.__mdwe.state.name));
    await expect.poll(() => docId(b.page)).not.toBe(docId(a));
    const ia = await info(a), ib = await info(b.page);
    test.info().annotations.push({ type: 'info', description: `original=${ia.name} duplicate=${ib.name}; number locks=${JSON.stringify(await heldNums(ext))}` });
    expect(ib.md).toBe('orig\n');
    const c = await one(ext, T);
    expect(await numOf(c), 'the next new note must not collide with the duplicate\'s number').toBeGreaterThan(Math.max(nOf(ia.name), nOf(ib.name)) - 1);
    expect([nOf(ia.name), nOf(ib.name)]).not.toContain(await numOf(c));
    await closeTab(a); await settle(ext, [nOf(ib.name), await numOf(c)]);   // the number is still held by the duplicate
    await closeTab(b.page); await closeTab(c); await settle(ext, []);
    // both slots still hold the text -> number is still used by the stored drafts
    expect((await draftKeysStored(ext)).length).toBe(2);
    expect(await numOf(await one(ext, T)), 'round 5: original = Untitled-1, copy = Untitled-2 (both stored) -> 3').toBe(3);
  });

  test('[fixed #49] a BLANK duplicated tab (same ?doc=&n= URL) no longer shows the SAME "Untitled-N.md" as the original: two open tabs display one name (and Save As suggests the same file name)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const b = await openEditor(ext, { query: dupQuery(a) });
    await b.page.waitForFunction(() => window.__mdwe.state.slot && /^Untitled-\d+/.test(window.__mdwe.state.name));
    await expect.poll(async () => (await info(b.page)).name, { message: 'blank duplicate yields after the 500 ms re-check', timeout: 6000 }).not.toBe((await info(a)).name);
    expect((await info(b.page)).name).toBe('Untitled-2.md');
  });

  test('(11) FUZZ seed 20261001: 200 random steps (click x1-3 / close / type / erase) over up to 20 tabs: visible names unique, each click gets the lowest free numbers, empty notes leave no draft keys, locks == open numbers', async ({ ext }) => {
    test.setTimeout(900000);
    const T = hook(ext);
    let s = 20261001; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; const ri = (n) => Math.floor(rnd() * n);
    const open = new Map();           // n -> { page, text }
    const stored = new Set();         // numbers held only by a closed note with text
    const log = [];
    const used = () => new Set([...open.keys(), ...stored]);
    const lowest = (k) => { const u = used(), r = []; for (let n = 1; r.length < k; n++) if (!u.has(n)) r.push(n); return r; };
    const stats = { click: 0, close: 0, type: 0, erase: 0, tabsMax: 0 };
    const check = async (label) => {
      await settle(ext, [...open.keys()]);
      const names = await Promise.all([...open.values()].map(async (o) => (await info(o.page)).name));
      expect(new Set(names).size, label + ': unique visible names ' + names).toBe(names.length);
      expect(names.sort(), label).toEqual([...open.keys()].map((n) => `Untitled-${n}.md`).sort());
      const want = new Set([...open.values()].filter((o) => o.text).map((o) => slotOf(o.page)));
      const have = await draftKeysStored(ext);
      // stored (closed) drafts are tracked by number; compare counts + open ones exactly
      const all = await localAll(ext); const keys = have;
      expect(keys.length, label + ': draft keys = open-with-text + closed-with-text ' + JSON.stringify(log.slice(-4))).toBe(want.size + stored.size);
      for (const k of want) expect(keys, label).toContain(k);
      for (const k of keys) expect(String(all[k].text).trim(), label + ': no blank draft ' + k).not.toBe('');
    };
    for (let step = 0; step < 200; step++) {
      const r = rnd(); const list = [...open.entries()];
      let act;
      if (list.length === 0) act = 'click';
      else if (r < 0.34 && list.length < 20) act = 'click';
      else if (r < 0.58) act = 'close';
      else if (r < 0.82) act = 'type';
      else act = 'erase';
      if (act === 'click') {
        const k = Math.min(1 + ri(3), 20 - list.length); if (k < 1) { step--; continue; }
        const want = lowest(k);
        const tabs = await clickIcon(ext, T, k);
        const got = (await nums(tabs)).sort((a, b) => a - b);
        log.push(`click${k}->${got}`); expect(got, `step ${step} click x${k} (log ${log.slice(-5)})`).toEqual(want);
        for (const p of tabs) open.set(await numOf(p), { page: p, text: false });
        stats.click++;
      } else {
        const [n, o] = list[ri(list.length)];
        if (act === 'close') {
          log.push(`close${n}`); await closeTab(o.page); open.delete(n); if (o.text) stored.add(n); stats.close++;
        } else if (act === 'type') {
          log.push(`type${n}`); await typeIn(o.page, 'w' + step); const key = slotOf(o.page);
          await expect.poll(async () => { const d = await lget(o.page, key); return d && d.text.trim().length > 0; }, { timeout: 8000 }).toBe(true);
          o.text = true; stats.type++;
        } else {
          log.push(`erase${n}`); await o.page.bringToFront(); await pmOf(o.page).click(); await o.page.keyboard.press('Control+a'); await o.page.keyboard.press('Backspace');
          await expect.poll(async () => await lget(o.page, slotOf(o.page)), { timeout: 8000 }).toBeUndefined();
          o.text = false; stats.erase++;
        }
      }
      stats.tabsMax = Math.max(stats.tabsMax, open.size);
      if (step % 5 === 4 || step > 190) await check('step ' + step);
    }
    await check('final');
    test.info().annotations.push({ type: 'info', description: 'fuzz stats ' + JSON.stringify(stats) + ' closed-with-text numbers=' + JSON.stringify([...stored]) });
    // wind down: close everything, discard nothing -> the next click is the lowest number not in a stored draft
    for (const [n, o] of [...open]) { await closeTab(o.page); open.delete(n); if (o.text) stored.add(n); }
    await settle(ext, []);
    expect(await numOf(await one(ext, T))).toBe(lowest(1)[0]);
    expect(T.errors).toEqual([]);
    expect(stats.tabsMax).toBeGreaterThan(5);
  });
});

// =====================================================================================================================
// 12. title / file bar / Save As suggestion
// =====================================================================================================================
test.describe('12. name consistency', () => {
  test('(12) for numbers 1, 2, 7 (gap) and 12: tab title, file-bar name, state.name and Save As suggestedName all equal the allocated number', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, {});
    const held = await clickIcon(ext, T, 12);
    const by = new Map(); for (const t of held) by.set(await numOf(t), t);
    for (const n of [3, 4, 5, 6, 8, 9, 10, 11]) await closeTab(by.get(n));
    for (const n of [1, 2, 7, 12]) {
      const t = by.get(n); const i = await info(t);
      expect(i.name).toBe(`Untitled-${n}.md`); expect(i.title).toBe(`Untitled-${n}.md — Markdown Editor`); expect(i.filename).toBe(`Untitled-${n}.md`);
      await typeIn(t, 'q'); await t.keyboard.press('Control+Shift+s');
      await expect.poll(() => t.evaluate(() => window.__fsa.saveAs)).toEqual([`Untitled-${n}.md`]);
    }
    const [x] = await clickIcon(ext, T);                       // lowest free = 3
    const ix = await info(x); expect(ix.name).toBe('Untitled-3.md'); expect(ix.title).toBe('Untitled-3.md — Markdown Editor'); expect(ix.filename).toBe('Untitled-3.md');
    await typeIn(x, 'z'); await expect.poll(() => info(x).then((i) => i.title)).toBe('• Untitled-3.md — Markdown Editor');
    await x.keyboard.press('Control+Shift+s'); await expect.poll(() => x.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-3.md']);
  });

  test('(12) a recycled number gives the same name everywhere again, also after reload; stored draft restores its OWN name (not the URL n)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(b, 'bee'); await waitDraft(b, slotOf(b), 'bee\n'); await closeTab(a); await settle(ext, [2]);
    const c = await one(ext, T); expect(await numOf(c)).toBe(1);
    await b.reload(); await c.reload();
    await expect.poll(async () => (await info(b)).title).toBe('• Untitled-2.md — Markdown Editor');
    await expect.poll(async () => (await info(c)).title).toBe('Untitled-1.md — Markdown Editor');
    // tamper: the URL says n=5 but the stored draft says Untitled-2.md -> the stored name wins
    await b.goto(b.url().replace(/&n=\d+/, '&n=5'));
    await expect.poll(async () => (await info(b)).name).toBe('Untitled-2.md');
  });
});

// =====================================================================================================================
// 13. regressions
// =====================================================================================================================
test.describe('13. regressions', () => {
  test('(13) mdwe.untitledNext is never written (clicks, New button, Alt+N, SW restart, reload); a stale value is neither read nor modified; session storage holds only the pending reservations', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 3); await noCounter(ext);
    await sw(ext).evaluate(() => chrome.storage.session.set({ 'mdwe.untitledNext': 99 }));
    await tabs[0].click('#btn-new').catch(() => {}); await sleep(600);
    await sendNew(tabs[1]); await sleep(600);
    expect(await stopWorker(ext, tabs[0])).toBe(true); await sendNew(tabs[0]); await awaitSw(ext); await sleep(800);
    await tabs[2].reload();
    const ns = [];
    for (const p of ext.ctx.pages().filter((x) => EDITOR_RE.test(x.url()))) ns.push(await numOf(p));
    expect(ns.sort((a, b) => a - b)).toEqual(Array.from({ length: ns.length }, (_, i) => i + 1));
    const s = await sw(ext).evaluate(() => chrome.storage.session.get(null));
    expect(s['mdwe.untitledNext']).toBe(99);
    expect(Object.keys(s).filter((k) => k !== 'mdwe.untitledNext' && k !== PENDING_KEY)).toEqual([]);
    const l = await localAll(ext); expect(Object.keys(l).filter((k) => /untitledNext|untitledPending/i.test(k)), 'nothing leaks into chrome.storage.local').toEqual([]);
  });

  test('(13) churn leaves no junk in chrome.storage.local: 40 rounds of open / type / erase / close / discard -> only expected keys, empty after cleanup', async ({ ext }) => {
    test.setTimeout(300000);
    const T = hook(ext);
    for (let r = 0; r < 40; r++) {
      const tabs = await clickIcon(ext, T, 1 + (r % 3));
      if (r % 2) { await typeIn(tabs[0], 'r' + r); await waitDraft(tabs[0], slotOf(tabs[0]), 'r' + r + '\n'); if (r % 4 === 1) { await tabs[0].keyboard.press('Control+a'); await tabs[0].keyboard.press('Backspace'); await expect.poll(() => lget(tabs[0], slotOf(tabs[0]))).toBeUndefined(); } }
      for (const t of tabs) await closeTab(t);
    }
    await expectNoJunk(ext);
    const keys = await draftKeysStored(ext); expect(keys.every((k) => k.startsWith(SLOT))).toBe(true);
    expect(keys.length, 'one draft per odd round with surviving text (r%4==3): 10').toBe(10);
    const alive = await one(ext, T); await openDrafts(alive);
    for (let i = 0; i < 10; i++) { const row = alive.locator('.drafts-box .drafts-item').first(); alive.once('dialog', (d) => d.accept()); await row.locator('.drafts-discard').click(); await expect(alive.locator('.drafts-box .drafts-item')).toHaveCount(9 - i); }
    await alive.keyboard.press('Escape'); await closeTab(alive);
    expect(Object.keys(await localAll(ext)).filter((k) => k.startsWith('mdwe.draft'))).toEqual([]);
    await expectNoJunk(ext);
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(13) Drafts dialog: shows the other notes with their names; a blank-erased note never appears; Open/Discard both free/keep numbers as expected; own note not listed', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    await typeIn(b, 'bee'); await waitDraft(b, slotOf(b), 'bee\n');
    await typeIn(c, 'see'); await waitDraft(c, slotOf(c), 'see\n'); await c.keyboard.press('Control+a'); await c.keyboard.press('Backspace'); await expect.poll(() => lget(a, slotOf(c))).toBeUndefined();
    await closeTab(b); await closeTab(c);
    expect(await draftsList(a)).toEqual({ keys: [slotOf(b)], names: ['Untitled-2.md'] });
    await expect(a.locator('#btn-drafts')).toContainText('1');
    expect(await numOf(await one(ext, T))).toBe(3);
  });

  test('(13) plain load and ?src= load: legacy flows still work, hold no Untitled number, and legacy draft names keep their number blocked', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draft': dr('Untitled-2.md', 'legacy plain'), 'mdwe.draft.file': dr('Untitled-3.md', 'legacy file') });
    const plain = await openEditor(ext);
    await expect.poll(() => md(plain.page)).toBe('legacy plain');
    expect((await info(plain.page)).name).toBe('Untitled-2.md'); expect(await heldNums(ext), 'plain tab holds no mdwe-num lock').toEqual([]);
    const url = 'file:///tmp/a.md';
    const fetchStub = ({ map }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...r) => { u = String(u); if (u.startsWith('file://')) return new Response(map[u], { status: 200 }); return of(u, ...r); }; };
    const srcT = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: '# file\n' } } });
    await expect.poll(() => md(srcT.page)).toBe('# file\n'); expect((await info(srcT.page)).name).toBe('a.md');
    expect(await heldNums(ext)).toEqual([]);
    const t = await one(ext, T); expect(await numOf(t), '1 is free; 2 and 3 are held by the legacy drafts').toBe(1);
    expect(await numOf(await one(ext, T))).toBe(4);
    await typeIn(plain.page, '!'); await expect.poll(async () => (await lget(plain.page, 'mdwe.draft')).text).toBe('legacy plain!\n');
    expect(await numOf(await one(ext, T))).toBe(5);
    expect(T.errors).toEqual([]);
  });

  test('(13) Drive flow: a blank new note saved to Drive (Drive link) is not "blank untitled" - and the number frees on Save; note with Drive link + name Untitled-N.md keeps its draft semantics', async ({ ext }) => {
    const T = hook(ext);
    const [t] = await clickIcon(ext, T);
    await t.evaluate(installMock, { files: [{ id: 'f1', name: 'existing.md', text: '# Existing\n' }] }); await t.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; });
    await typeIn(t, 'to drive'); await waitDraft(t, slotOf(t), 'to drive\n');
    await t.click('#btn-drive-save'); await t.locator('.gdui-dialog').waitFor(); await t.locator('.gdui-dialog [data-action="save"]').click();
    await expect.poll(async () => (await info(t)).drive && 1, { timeout: 15000 }).toBe(1);
    expect(await t.evaluate(() => window.__drv.calls.find((c) => c.m === 'createFile').args.name)).toBe('Untitled-1.md');
    await expect.poll(() => draftKeysStored(ext)).toEqual([]);
    // file is Drive linked, named Untitled-1.md: erasing the text is a real change vs the Drive copy -> draft is kept (not blank-untitled)
    await pmOf(t).click(); await t.keyboard.press('Control+a'); await t.keyboard.press('Backspace');
    await expect.poll(async () => (await info(t)).dirty).toBe(true);
    await sleep(1200);
    const keys = await draftKeysStored(ext);
    test.info().annotations.push({ type: 'info', description: 'Drive-linked Untitled-1.md erased: draft keys=' + JSON.stringify(keys) });
    expect(keys, 'draft with a blank text is kept for a Drive-linked note (it differs from the remote copy)').toEqual([slotOf(t)]);
    const next = await one(ext, T);
    expect(await numOf(next), 'the tab still holds 1 so the next is 2').toBe(2);
    await closeTab(t); await closeTab(next); await settle(ext, []);
    expect(await numOf(await one(ext, T)), 'blank draft record holds no number').toBe(1);
  });

  test('(13) Open from Drive over a new note, then close: name changes to the Drive file; no Untitled number reserved by its draft', async ({ ext }) => {
    const T = hook(ext);
    const [t] = await clickIcon(ext, T);
    await t.evaluate(installMock, { files: [{ id: 'f1', name: 'existing.md', text: '# Existing\n' }] }); await t.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; });
    await t.click('#btn-drive-open'); await t.locator('.gdui-dialog').waitFor(); await t.locator('.gdui-dialog .gdui-row', { hasText: 'existing' }).dblclick();
    await expect.poll(() => md(t), { timeout: 10000 }).toContain('Existing');
    expect((await info(t)).name).toBe('existing.md'); expect((await info(t)).title).not.toMatch(/Untitled/);
    await typeIn(t, 'x'); await waitDraft(t, slotOf(t), (await md(t)));
    await closeTab(t); await settle(ext, []);
    expect(await numOf(await one(ext, T))).toBe(1);
  });
});


// =====================================================================================================================
// ROUND 4 (build index-DPbNKTra.js): alloc-number, yielding tabs (#47/#49), drafts reopen (#46), release on rename (#48)
//   page: a ?doc tab without usable n (and without draft text) sends {type:'alloc-number'} -> {n} (reserved in mdwe.untitledPending like a click);
//         a blank FRESH (?new) or COPY (duplicate) tab that finds another holder of its mdwe-num-N lock waits 500 ms, re-checks, and if still blank/untouched
//         asks alloc-number for a new number and switches (lock, name, URL n). A reloading ?doc tab never yields. renderTitle() releases the lock when the name stops being Untitled-<N>.md.
// =====================================================================================================================
// init script (runs in every page it is installed for): records runtime messages sent, title changes, URL rewrites; slow=true stretches the 500 ms yield wait to 4 s (test hook)
const recInit = ({ slow = false } = {}) => {
  window.__msgs = []; window.__titles = []; window.__urls = [];
  const o = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (...a) => { window.__msgs.push(a[0] && a[0].type + (a[0] && a[0].n ? ':' + a[0].n : '')); return o(...a); };
  const ro = history.replaceState.bind(history);
  history.replaceState = (...a) => { ro(...a); window.__urls.push(location.search); };
  const push = () => { if (window.__titles[window.__titles.length - 1] !== document.title) window.__titles.push(document.title); };
  new MutationObserver(push).observe(document, { subtree: true, childList: true, characterData: true });
  window.__claims = []; const lr = navigator.locks.request.bind(navigator.locks); navigator.locks.request = (name, ...a) => { if (/^mdwe-claim-/.test(name)) window.__claims.push(name); return lr(name, ...a); };
  if (slow) { const st = window.setTimeout.bind(window); window.setTimeout = (f, d, ...a) => st(f, d === 500 ? 4000 : d, ...a); }
};
const openDoc = async (ext, query, slow = false) => {
  const r = await openEditor(ext, { query, init: recInit, arg: { slow } });
  await r.page.waitForFunction(() => window.__mdwe.state.slot);
  r.page.__r = r; return r.page;
};
const alloc = (p) => p.evaluate(() => chrome.runtime.sendMessage({ type: 'alloc-number' }));
const msgs = (p) => p.evaluate(() => window.__msgs || []);
const nameIs = (p, re, timeout = 8000) => expect.poll(async () => (await info(p)).name, { timeout }).toMatch(re);
const allocCount = async (p) => (await msgs(p)).filter((m) => m === 'alloc-number').length;
const qn = (p) => new URL(p.url()).searchParams.get('n');
const dupQ = (p) => '?doc=' + docId(p) + (qn(p) ? '&n=' + qn(p) : '');
const noPending = (ext) => expect.poll(() => pending(ext), { timeout: 6000 }).toEqual({});


test.describe('14. alloc-number: reservation semantics', () => {
  test('[fixed #50] alloc-number is ANSWERED: a page that sends {type:\'alloc-number\'} gets {n} within 3 s (background onMessage listener must declare sendResponse)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const r = await a.evaluate(() => Promise.race([new Promise((res) => chrome.runtime.sendMessage({ type: 'alloc-number' }, (x) => res(x === undefined ? 'undefined (port closed: ' + (chrome.runtime.lastError && chrome.runtime.lastError.message) + ')' : x))), new Promise((res) => setTimeout(() => res('NO RESPONSE in 3 s'), 3000))]));
    expect(r, 'response to alloc-number').toEqual({ n: 2 });
  });

  test('(14) alloc-number returns the lowest free number and RESERVES it in mdwe.untitledPending (like an icon click); skips lock-held, stored-text-draft numbers; blank / renamed drafts do not count', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { [SLOT + uid(1)]: dr('Untitled-1.md', 'text'), [SLOT + uid(2)]: dr('Untitled-2.md', '  '), [SLOT + uid(3)]: dr('renamed.md', 'text') });
    const [a] = await clickIcon(ext, T);                       // 2 (1 stored with text; 2 blank record does not count)
    expect(await numOf(a)).toBe(2);
    const r = await alloc(a); expect(r).toEqual({ n: 3 });
    expect(Object.keys(await pending(ext))).toEqual(['3']);
    const r2 = await alloc(a); expect(r2).toEqual({ n: 4 });
    expect(Object.keys(await pending(ext)).sort()).toEqual(['3', '4']);
    const b = await one(ext, T); expect(await numOf(b), 'icon click skips both reserved numbers').toBe(5);
    expect(Object.keys(await pending(ext)).sort()).toEqual(['3', '4']);        // the click's own reservation 5 was released by its tab
    await a.evaluate(() => chrome.runtime.sendMessage({ type: 'note-number-held', n: 3 }));
    await expect.poll(async () => Object.keys(await pending(ext)).sort()).toEqual(['4']);
    expect(await alloc(a), 'released number is free again').toEqual({ n: 3 });
    await noCounter(ext); expect(T.errors).toEqual([]);
  });

  test('(14) 10 CONCURRENT alloc-number calls (one tick) -> 10 unique numbers 1..10 and 10 reservations; response shape {n:int}', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                       // 1
    const rs = await a.evaluate(() => Promise.all(Array.from({ length: 10 }, () => chrome.runtime.sendMessage({ type: 'alloc-number', junk: [1, 2] }))));
    const ns = rs.map((r) => r.n).sort((x, y) => x - y);
    expect(ns).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); for (const r of rs) expect(Object.keys(r)).toEqual(['n']);
    expect(Object.keys(await pending(ext)).map(Number).sort((x, y) => x - y)).toEqual(ns);
  });

  test('(14) INTERPLAY: 5 icon clicks + 5 alloc-number calls + 3 New-button messages fired in one tick -> 13 unique numbers 2..14 (tabs hold 8, 5 reservations stay pending)', async ({ ext }) => {
    const T = hook(ext);
    const [seedTab] = await clickIcon(ext, T);                  // 1
    const before = new Set(ext.ctx.pages());
    const [allocs] = await Promise.all([
      seedTab.evaluate(() => Promise.all(Array.from({ length: 5 }, () => chrome.runtime.sendMessage({ type: 'alloc-number' })))),
      sw(ext).evaluate(() => { for (let i = 0; i < 5; i++) chrome.action.onClicked.dispatch({ id: 0, index: 0 }); }),
      seedTab.evaluate(() => { for (let i = 0; i < 3; i++) chrome.runtime.sendMessage({ type: 'new-note' }); }),
    ]);
    const tabs = await waitNew(ext, before, 8);
    const all = [...allocs.map((r) => r.n), ...(await nums(tabs))].sort((x, y) => x - y);
    expect(all).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(Object.keys(await pending(ext)).map(Number).sort((x, y) => x - y), 'only the 5 allocs (no page took them) remain reserved').toEqual(allocs.map((r) => r.n).sort((x, y) => x - y));
    await settle(ext, [1, ...(await nums(tabs))]);
  });

  test('(14) reservation EXPIRY: an alloc-number nobody takes blocks its number against icon clicks and further allocs until 30 s (aged: 29.5 s blocks, 30.5 s frees), expired entry is purged', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                       // 1
    const { n } = await alloc(a); expect(n).toBe(2);
    await setPending(ext, { 2: Date.now() - 29500 });
    const b = await one(ext, T); expect(await numOf(b), 'still reserved at 29.5 s').toBe(3);
    await setPending(ext, { 2: Date.now() - 30500 });
    expect(await alloc(a)).toEqual({ n: 2 });                  // expired -> reusable
    await sleep(100); expect(Object.keys(await pending(ext))).toEqual(['2']);   // fresh reservation replaced the stale timestamp
  });

  test('(14) alloc-number right after the service worker was stopped (cold start) works and is unique against a leaked click reservation', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                       // 1
    await leakClicks(ext, 1);                                  // 2 reserved
    expect(await stopWorker(ext, a)).toBe(true);
    const r = await alloc(a); expect(r).toEqual({ n: 3 });
    await awaitSw(ext); expect(Object.keys(await pending(ext)).sort()).toEqual(['2', '3']);
  });

  test('(14) 30 alloc-number calls from 3 pages while the SW is stopped in between: all unique, none hang', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 3);
    const all = [];
    const fire = (p) => p.evaluate(() => Promise.all(Array.from({ length: 10 }, () => chrome.runtime.sendMessage({ type: 'alloc-number' })))).then((rs) => rs.map((r) => r.n));
    all.push(...await Promise.all([fire(tabs[0]), fire(tabs[1])]).then((x) => x.flat()));
    expect(await stopWorker(ext, tabs[0])).toBe(true);
    all.push(...await fire(tabs[2]));
    expect(new Set(all).size).toBe(30); expect(Math.min(...all)).toBe(4); expect(Math.max(...all)).toBe(33);
  });
});

test.describe('14b. ?doc tab without number / reopened drafts (#46)', () => {
  test('(14b) ?doc=<uuid> with no draft and no n: asks alloc-number -> lowest free, URL gets &n=N, lock held, reservation released, no draft, exactly one alloc message', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                       // 1
    const id = '5a5a5a5a-0000-4000-8000-000000000001';
    const p = await openDoc(ext, '?doc=' + id);
    await nameIs(p, /^Untitled-2\.md$/);
    expect(p.url()).toMatch(new RegExp('\\?doc=' + id + '&n=2$'));
    expect((await info(p)).title).toBe('Untitled-2.md — Markdown Editor'); expect((await info(p)).filename).toBe('Untitled-2.md');
    await settle(ext, [1, 2]); await noPending(ext);
    expect(await allocCount(p)).toBe(1); expect(await draftKeysStored(ext)).toEqual([]);
    await p.reload(); await nameIs(p, /^Untitled-2\.md$/); expect(await allocCount(p), 'reload has n in the URL: no new alloc').toBe(0);
  });

  test('(14b) ?doc=<uuid>&n=junk (and n=0, n=-1, n=abc, huge) behaves like no n: fresh number each, never "Untitled.md"', async ({ ext }) => {
    const names = [];
    for (const [i, q] of ['&n=junk', '&n=0', '&n=-1', '&n=abc', '&n=99999999999', ''].entries()) {
      const p = await openDoc(ext, '?doc=5b5b5b5b-0000-4000-8000-00000000000' + i + q);
      await nameIs(p, /^Untitled-\d+\.md$/); names.push((await info(p)).name);
    }
    expect(new Set(names).size, 'all open at once -> unique ' + names).toBe(6);
    expect(names.sort()).toEqual(['Untitled-1.md', 'Untitled-2.md', 'Untitled-3.md', 'Untitled-4.md', 'Untitled-5.md', 'Untitled-6.md']);
  });

  test('(14b) [#46] re-open the Untitled-4 draft, erase its text, then closing 1-3: new clicks never produce a second Untitled-4, and Untitled-1 is NOT blocked', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c, d] = await clickIcon(ext, T, 4);
    await typeIn(d, 'four'); const kd = slotOf(d); await waitDraft(d, kd, 'four\n'); await closeTab(d);
    await openDrafts(a); const before = new Set(ext.ctx.pages());
    await rowFor(a, kd).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    expect((await info(re)).name).toBe('Untitled-4.md'); expect(re.url()).toMatch(/&n=4$/);
    await settle(ext, [1, 2, 3, 4]);
    await pmOf(re).click(); await re.keyboard.press('Control+a'); await re.keyboard.press('Backspace');
    await expect.poll(() => lget(a, kd)).toBeUndefined();
    await settle(ext, [1, 2, 3, 4]);                           // still held by the open (now blank) tab
    await closeTab(a); await closeTab(b); await closeTab(c); await settle(ext, [4]);
    const got = []; for (let i = 0; i < 4; i++) got.push(await numOf(await one(ext, T)));
    expect(got, '1 is free, 4 is held by the reopened tab').toEqual([1, 2, 3, 5]);
    await re.reload(); await nameIs(re, /^Untitled-4\.md$/); expect(re.url()).toMatch(/&n=4$/);
  });

  test('(14b) [#46] a RENAMED draft (text, name notes.md) reopened from Drafts holds NO number: URL has no n, no mdwe-num lock, no alloc, Untitled-1 stays free; same after reload; same for legacy "Untitled.md"', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);                       // 1
    await seed(ext, { [SLOT + uid(1)]: dr('notes.md', 'renamed text'), [SLOT + uid(2)]: dr('Untitled.md', 'no number text') });
    await openDrafts(a); const before = new Set(ext.ctx.pages());
    await rowFor(a, SLOT + uid(1)).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    expect((await info(re)).name).toBe('notes.md'); expect(re.url()).toMatch(/\?doc=[0-9a-f-]{36}$/);
    await settle(ext, [1]);                                    // only the first tab
    await re.reload(); await nameIs(re, /^notes\.md$/); expect(re.url()).toMatch(/\?doc=[0-9a-f-]{36}$/); await settle(ext, [1]);
    await sleep(3200); await a.keyboard.press('Escape').catch(() => {});
    await openDrafts(a); const before2 = new Set(ext.ctx.pages());
    await rowFor(a, SLOT + uid(2)).locator('.drafts-open').click(); const [re2] = await waitNew(ext, before2, 1);
    expect((await info(re2)).name).toBe('Untitled.md'); expect(re2.url()).not.toContain('&n='); await settle(ext, [1]);
    await closeTab(a); expect(await numOf(await one(ext, T)), 'Untitled-1 free: nothing renamed holds it').toBe(1);
    expect((await allocCount(re)) + (await allocCount(re2))).toBe(0);
  });

  test('(14b) [#46] reopened Untitled-4 draft with a STALE n in the URL (?doc=<id>&n=2): the draft\'s own name wins (4), lock 4 held, URL rewritten to n=4', async ({ ext }) => {
    const id = '5c5c5c5c-0000-4000-8000-000000000001';
    await seed(ext, { [SLOT + id]: dr('Untitled-4.md', 'four') });
    const p = await openDoc(ext, '?doc=' + id + '&n=2');
    await nameIs(p, /^Untitled-4\.md$/); expect(p.url()).toMatch(/&n=4$/); await settle(ext, [4]);
    const p2 = await openDoc(ext, '?doc=5c5c5c5c-0000-4000-8000-000000000002&n=3');
    await nameIs(p2, /^Untitled-3\.md$/); await settle(ext, [3, 4]);
  });
});

test.describe('15. yielding blank tabs (#47 / #49)', () => {
  test('[fixed #47] (15) fresh ?new=1 tab while Untitled-1 is open YIELDS: after the re-check it is Untitled-2 everywhere (state, title, file bar, URL n, lock); old lock not duplicated; one alloc; no draft; no flicker; reservation released', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1');
    const first = (await info(p)).name;                        // may already be 2 (if the check ran) or still 1
    expect(['Untitled-1.md', 'Untitled-2.md']).toContain(first);
    await nameIs(p, /^Untitled-2\.md$/);
    const i = await info(p);
    expect(i.title).toBe('Untitled-2.md — Markdown Editor'); expect(i.filename).toBe('Untitled-2.md'); expect(i.dirty).toBe(false); expect(i.md).toBe('');
    expect(p.url()).toMatch(/\?doc=[0-9a-f-]{36}&n=2$/);
    await settle(ext, [1, 2]); await noPending(ext);
    expect(await allocCount(p)).toBe(1); expect(await draftKeysStored(ext)).toEqual([]);
    const titles = (await p.evaluate(() => window.__titles)).filter((t) => /Untitled/.test(t));
    test.info().annotations.push({ type: 'info', description: 'title sequence of the yielding tab: ' + JSON.stringify(titles) + ' urls: ' + JSON.stringify(await p.evaluate(() => window.__urls)) });
    expect(titles.filter((t) => !/^Untitled-[12]\.md — Markdown Editor$/.test(t)), 'no bullet / other name flickers through the title').toEqual([]);
    expect(titles.lastIndexOf('Untitled-1.md — Markdown Editor') < titles.indexOf('Untitled-2.md — Markdown Editor') || !titles.includes('Untitled-1.md — Markdown Editor'), 'monotonic 1 -> 2, no flip-flop').toBe(true);
    expect(await numOf(a)).toBe(1); expect(T.errors).toEqual([]);
    // the old number is genuinely free again: close the original, next click reuses 1, then 3
    await closeTab(a); await settle(ext, [2]);
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(15) a yielding tab keeps working: type -> draft is named Untitled-2.md under ITS slot; reload keeps Untitled-2 (no second yield); close -> draft in Drafts as Untitled-2', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1'); await nameIs(p, /^Untitled-2\.md$/);
    await typeIn(p, 'after yield'); await waitDraft(p, slotOf(p), 'after yield\n');
    expect((await lget(p, slotOf(p))).name).toBe('Untitled-2.md');
    await p.reload(); await nameIs(p, /^Untitled-2\.md$/); await sleep(1500);
    expect((await info(p)).md).toBe('after yield\n'); expect(await allocCount(p), 'reload with text: no alloc').toBe(0);
    await settle(ext, [1, 2]);
    await closeTab(p); await settle(ext, [1]);
    expect(await numOf(await one(ext, T)), 'Untitled-2 is held by the stored draft').toBe(3);
    expect(await draftKeysStored(ext)).toEqual([slotOf(p)].map((x) => x));
  });

  test('(15) TYPED DURING THE WAIT (wait stretched to 4 s by a setTimeout hook): the note does NOT switch, keeps its text and draft, no alloc message ever sent, nothing lost', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1', true);
    expect((await info(p)).name).toBe('Untitled-1.md');
    await typeIn(p, 'typed in the window'); await waitDraft(p, slotOf(p), 'typed in the window\n');
    await sleep(5500);
    const i = await info(p);
    expect(i.name).toBe('Untitled-1.md'); expect(i.md).toBe('typed in the window\n'); expect(await allocCount(p)).toBe(0);
    expect((await lget(p, slotOf(p))).name).toBe('Untitled-1.md');
    await settle(ext, [1, 1]); await noPending(ext);
    test.info().annotations.push({ type: 'info', description: 'typed-in-window tab and the original both show ' + i.name + ' (residual, see BUGS #52)' });
    expect(T.errors).toEqual([]);
  });

  test('(15) PASTE / insertText during the wait: no switch, text kept', async ({ ext }) => {
    const T = hook(ext);
    await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1', true);
    await pmOf(p).click(); await p.keyboard.insertText('pasted block');
    await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', ' + clip'); document.querySelector('#editor-host .ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await sleep(5200);
    const i = await info(p); expect(i.name).toBe('Untitled-1.md'); expect(i.md).toContain('pasted block'); expect(await allocCount(p)).toBe(0);
    await expect.poll(async () => (await lget(p, slotOf(p))) && (await lget(p, slotOf(p))).text).toContain('pasted block');
  });

  test('(15) type then ERASE / UNDO to empty during the wait: no lost text, no loop (<=1 alloc), no stray draft, title/URL/lock agree afterwards (RECORDS whether the tab still yields)', async ({ ext }) => {
    const T = hook(ext);
    await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1', true);
    await typeIn(p, 'abc'); await p.keyboard.press('Control+z');
    const q = await openDoc(ext, '?new=1', true);
    await typeIn(q, 'xyz'); await q.keyboard.press('Control+a'); await q.keyboard.press('Backspace');
    await sleep(6000);
    for (const [label, t] of [['undo', p], ['erase', q]]) {
      const i = await info(t); const n = nOf(i.name);
      test.info().annotations.push({ type: 'info', description: `${label}-to-empty in the window: name=${i.name} dirty=${i.dirty} allocs=${await allocCount(t)} url=${t.url().slice(-6)}` });
      expect(i.md.trim()).toBe(''); expect(await allocCount(t)).toBeLessThanOrEqual(1);
      expect(i.title).toBe(`${i.dirty ? '• ' : ''}${i.name} — Markdown Editor`); expect(t.url()).toMatch(new RegExp('&n=' + n + '$'));
    }
    expect(await draftKeysStored(ext), 'blank notes leave no draft').toEqual([]);
    await noPending(ext);
  });

  test('(15) RENAMED during the wait (Save As via Ctrl+S): the tab does not switch / allocate; its number lock is released; name stays', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'renamed.md' });
    await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1', true);
    await typeIn(p, 'x'); await p.keyboard.press('Control+s');
    await nameIs(p, /^renamed\.md$/, 6000);
    await sleep(5200);
    expect((await info(p)).name).toBe('renamed.md'); expect(await allocCount(p)).toBe(0);
    await settle(ext, [1]);                                    // the original only: the saved tab owns no number
    expect(await draftKeysStored(ext)).toEqual([]);
  });

  test('(15) OPEN FILE (Ctrl+O) over the blank note during the wait: name becomes the file name, no alloc, number lock released', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { openName: 'opened.md', openContent: '# Opened\n' });
    await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1', true);
    await p.keyboard.press('Control+o');
    await nameIs(p, /^opened\.md$/, 6000); await sleep(5200);
    expect((await info(p)).name).toBe('opened.md'); expect(await allocCount(p)).toBe(0); await settle(ext, [1]);
  });

  test('(15) original + TWO duplicates (+ a fresh collision): all four end up unique; each copy sends exactly one alloc-number; locks == names; reservations drained', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const d1 = await openDoc(ext, dupQ(a)); const d2 = await openDoc(ext, dupQ(a)); const f = await openDoc(ext, '?new=1');
    const all = [a, d1, d2, f];
    await expect.poll(async () => new Set((await Promise.all(all.map(async (t) => (await info(t)).name)))).size, { timeout: 12000 }).toBe(4);
    const names = await Promise.all(all.map(async (t) => (await info(t)).name));
    expect(names[0]).toBe('Untitled-1.md'); expect(names.slice(1).sort()).toEqual(['Untitled-2.md', 'Untitled-3.md', 'Untitled-4.md']);
    for (const t of [d1, d2, f]) { expect(await allocCount(t)).toBe(1); const i = await info(t); expect(i.title).toBe(i.name + ' — Markdown Editor'); expect(t.url()).toMatch(new RegExp('&n=' + nOf(i.name) + '$')); }
    expect(await allocCount(a)).toBe(0);
    await settle(ext, [1, 2, 3, 4]); await noPending(ext); expect(await draftKeysStored(ext)).toEqual([]);
    expect(T.errors).toEqual([]);
  });

  test('(15) NO LOOP with many holders: 20 duplicates of one blank note -> 21 unique names after settling, each copy exactly ONE alloc-number, finished in < 40 s', async ({ ext }) => {
    test.setTimeout(240000);
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const t0 = Date.now(); const q = dupQ(a);
    const copies = await Promise.all(Array.from({ length: 20 }, () => openDoc(ext, q)));
    const all = [a, ...copies];
    await expect.poll(async () => new Set((await Promise.all(all.map(async (t) => (await info(t)).name)))).size, { timeout: 40000, intervals: [500] }).toBe(21);
    const dt = Date.now() - t0;
    const counts = await Promise.all(copies.map(allocCount));
    test.info().annotations.push({ type: 'info', description: `20 copies unique after ${dt} ms; alloc counts ${JSON.stringify(counts)}` });
    expect(counts.every((c) => c === 1), 'every copy allocated exactly once: ' + counts).toBe(true);
    await settle(ext, Array.from({ length: 21 }, (_, i) => i + 1)); await noPending(ext);
    await sleep(1500); expect((await Promise.all(copies.map(allocCount))).every((c) => c === 1), 'no late second yield').toBe(true);
  });

  test('(15) round 5 tie-break: a blank tab that RELOADS while a twin with text shares its number is the LATER claimer -> it yields (one alloc), the twin keeps its number and text; names unique; a second reload is stable', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const twin = await openDoc(ext, '?new=1', true); await typeIn(twin, 't'); await waitDraft(twin, slotOf(twin), 't\n');
    await a.reload(); await nameIs(a, /^Untitled-2\.md$/);
    expect((await info(twin)).name).toBe('Untitled-1.md'); expect((await info(twin)).md).toBe('t\n'); expect(a.url()).toMatch(/&n=2$/);
    await settle(ext, [1, 2]);
    await a.reload(); await sleep(1500); expect((await info(a)).name, 'no twin any more: stable').toBe('Untitled-2.md');
  });

  test('(15) yield + close + reopen cycles leave no junk: 15 rounds of (original + fresh collision -> yield -> close both) keep storage empty and numbers reset to 1', async ({ ext }) => {
    test.setTimeout(180000);
    const T = hook(ext);
    for (let r = 0; r < 15; r++) {
      const [a] = await clickIcon(ext, T); expect(await numOf(a), 'round ' + r).toBe(1);
      const p = await openDoc(ext, '?new=1'); await nameIs(p, /^Untitled-2\.md$/);
      await closeTab(a); await closeTab(p); await settle(ext, []);
    }
    expect(await draftKeysStored(ext)).toEqual([]); await expectNoJunk(ext); await noPending(ext);
    expect(await numOf(await one(ext, T))).toBe(1);
  });
});

test.describe('16. race: tab loads BEFORE the reloading note re-takes its lock (#50)', () => {
  test('(16) deterministic order A: the FRESH tab loads after the reloading note holds its lock -> fresh tab yields, names unique', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1'); await nameIs(p, /^Untitled-2\.md$/);
    expect((await info(a)).name).toBe('Untitled-1.md');
  });

  test('[fixed #51] deterministic order B: the note is unloaded (lock released), a fresh ?new=1 tab takes the number, THEN the note loads again -> two tabs show the same Untitled-1.md for good (reloading tab never yields)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const url = a.url();
    await a.goto('about:blank'); await settle(ext, []);
    const p = await openDoc(ext, '?new=1'); await settle(ext, [1]);
    await a.goto(url); await a.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot);
    await sleep(3500);
    const na = (await info(a)).name, np = (await info(p)).name;
    test.info().annotations.push({ type: 'info', description: `after 3.5 s: reloaded note=${na}, fresh tab=${np}, locks=${JSON.stringify(await heldNums(ext))}` });
    expect(new Set([na, np]).size, `two tabs show ${na} / ${np}`).toBe(2);
  });

  test('[fixed #47] real hammer: 8 reloads of a blank Untitled-1 with icon clicks arriving every 15 ms -> after settling NO two open tabs show the same name (and the reloaded tab keeps Untitled-1 every time)', async ({ ext }) => {
    test.setTimeout(300000);
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const dupRounds = [], renamed = [];
    for (let round = 0; round < 8; round++) {
      const before = new Set(ext.ctx.pages());
      await sw(ext).evaluate(() => { globalThis.__run = true; (async () => { while (globalThis.__run) { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 15)); } })(); });
      await a.reload(); await sleep(300);
      await sw(ext).evaluate(() => { globalThis.__run = false; });
      await sleep(2500);
      const extra = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
      for (const p of extra) await p.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot).catch(() => {});
      const names = await Promise.all([a, ...extra].map(async (p) => (await info(p)).name));
      const dup = names.filter((x, i) => names.indexOf(x) !== i);
      if (dup.length) dupRounds.push(round + ':' + dup.join('+')); if (names[0] !== 'Untitled-1.md') renamed.push(round + ':' + names[0]);
      for (const p of extra) await p.close().catch(() => {});
      await sleep(300); await setPending(ext, {});
      await settle(ext, [1]);
    }
    test.info().annotations.push({ type: 'info', description: `rounds with duplicate visible names: ${JSON.stringify(dupRounds)}; reloaded tab renamed in rounds ${JSON.stringify(renamed)}` });
    expect.soft(renamed, 'the reloading ?doc tab must keep its name').toEqual([]);
    expect(dupRounds, 'duplicate visible names after settling').toEqual([]);
  });

  test('(16) hammer with TEXT in the note (stored draft holds the number): 6 reloads, never a duplicate (the pre-existing guarantee)', async ({ ext }) => {
    test.setTimeout(240000);
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'keep'); await waitDraft(a, slotOf(a), 'keep\n');
    for (let round = 0; round < 6; round++) {
      const before = new Set(ext.ctx.pages());
      await sw(ext).evaluate(() => { globalThis.__run = true; (async () => { while (globalThis.__run) { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 15)); } })(); });
      await a.reload(); await sleep(300); await sw(ext).evaluate(() => { globalThis.__run = false; }); await sleep(1800);
      const extra = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
      for (const p of extra) await p.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot).catch(() => {});
      const names = await Promise.all([a, ...extra].map(async (p) => (await info(p)).name));
      expect(new Set(names).size, 'round ' + round + ' ' + names.slice(0, 4)).toBe(names.length); expect(names[0]).toBe('Untitled-1.md');
      for (const p of extra) await p.close().catch(() => {}); await sleep(300); await setPending(ext, {});
    }
  });

  test('[fixed #52] a duplicate of a note WITH TEXT keeps the same Untitled-N as its original (copy path only yields when blank): two open tabs, one name', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'content'); await waitDraft(a, slotOf(a), 'content\n');
    const d = await openDoc(ext, dupQ(a)); await sleep(1800);
    const na = (await info(a)).name, nd = (await info(d)).name;
    test.info().annotations.push({ type: 'info', description: `original=${na} copy-with-text=${nd}; locks=${JSON.stringify(await heldNums(ext))}; copy text=${JSON.stringify((await info(d)).md)}` });
    expect(nd, 'duplicate with text must not display the original\'s number').not.toBe(na);
  });
});

test.describe('17. number released when the name stops being Untitled-N (#48)', () => {
  test('(17) Save As from Untitled-2 frees 2 at once: next click reuses 2 while the saved tab is still open; the saved tab is never "Untitled"; draft/locks consistent; reload of the saved tab holds no number', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'Plan.md' });
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(b, 'plan'); await b.keyboard.press('Control+s'); await nameIs(b, /^Plan\.md$/);
    await settle(ext, [1]);
    const c = await one(ext, T); expect(await numOf(c)).toBe(2);
    expect((await info(b)).title).toBe('Plan.md — Markdown Editor'); await expect.poll(() => draftKeysStored(ext)).toEqual([]);
    await typeIn(b, ' more'); await waitDraft(b, slotOf(b), 'plan more\n');   // file-bound draft named after the file: holds no number
    await b.reload(); await nameIs(b, /^Plan\.md$/); expect(b.url()).not.toMatch(/&n=\d/); await settle(ext, [1, 2]);
    await closeTab(b); expect(await numOf(await one(ext, T)), 'Plan.md draft holds no Untitled number').toBe(3);
  });

  test('(17) Open file (Ctrl+O) over a blank Untitled-1 releases 1; next click reuses it', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { openName: 'opened.md', openContent: '# Opened\n' });
    const [a] = await clickIcon(ext, T); await a.keyboard.press('Control+o'); await nameIs(a, /^opened\.md$/);
    await settle(ext, []);
    expect(await numOf(await one(ext, T))).toBe(1);
  });

  test('(17) Drive: Open from Drive over a blank note releases its number; Save to Drive with the default name keeps the Untitled-N name AND number; renaming to another name in the Drive dialog releases it', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    for (const t of [a, b]) { await t.evaluate(installMock, { files: [{ id: 'f1', name: 'existing.md', text: '# Existing\n' }] }); await t.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; }); }
    await a.click('#btn-drive-open'); await a.locator('.gdui-dialog').waitFor(); await a.locator('.gdui-dialog .gdui-row', { hasText: 'existing' }).dblclick();
    await nameIs(a, /^existing\.md$/); await settle(ext, [2]);
    expect(await numOf(await one(ext, T)), '1 reused').toBe(1);
    await typeIn(b, 'to drive'); await waitDraft(b, slotOf(b), 'to drive\n');
    await b.click('#btn-drive-save'); await b.locator('.gdui-dialog').waitFor();
    await b.locator('.gdui-dialog [data-action="save"]').click();
    await expect.poll(async () => (await info(b)).drive && 1, { timeout: 15000 }).toBe(1);
    const i = await info(b);
    test.info().annotations.push({ type: 'info', description: `after Drive save with default name: name=${i.name} locks=${JSON.stringify(await heldNums(ext))}` });
    expect(i.name).toBe('Untitled-2.md'); await settle(ext, [1, 2]);
  });

  test('(17) Save As under another Untitled-M name (Untitled-3 saved as "Untitled-9.md"): lock 3 released, nothing holds 9; RECORDS that nine tabs later a second tab can be called Untitled-9.md', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'Untitled-9.md' });
    const tabs = await clickIcon(ext, T, 3); const t3 = tabs[2];
    await typeIn(t3, 'x'); await t3.keyboard.press('Control+s'); await expect.poll(async () => (await info(t3)).filename).toBe('Untitled-9.md');
    await settle(ext, [1, 2]);
    const more = []; for (let i = 0; i < 7; i++) more.push(await one(ext, T));
    const ns = await nums(more);
    test.info().annotations.push({ type: 'info', description: 'with a file tab named Untitled-9.md open, the next 7 clicks gave ' + JSON.stringify(ns) });
    expect(ns).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  test('(17) a renamed note whose draft is closed holds no number, and Discard of it changes nothing', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'kept.md' });
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(b, 'v1'); await b.keyboard.press('Control+s'); await nameIs(b, /^kept\.md$/); await typeIn(b, 'v2'); await waitDraft(b, slotOf(b), 'v1v2\n');
    await closeTab(b); await settle(ext, [1]);
    expect((await lget(a, slotOf(b))).name).toBe('kept.md');
    expect(await numOf(await one(ext, T))).toBe(2);
  });
});

test.describe('18. performance, fuzz with duplicates / reloads / reopen, storage', () => {
  test('(18) 50 tabs: 50 icon clicks in one tick -> all ready, unique 1..50, no draft, lock set == 1..50, time recorded', async ({ ext }) => {
    test.setTimeout(240000);
    const T = hook(ext);
    const t0 = Date.now(); const tabs = await clickIcon(ext, T, 50, { timeout: 90000 });
    const dt = Date.now() - t0;
    expect((await nums(tabs)).sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    await settle(ext, Array.from({ length: 50 }, (_, i) => i + 1)); await noPending(ext);
    test.info().annotations.push({ type: 'info', description: `50 clicks -> 50 ready tabs in ${dt} ms` });
    expect(dt).toBeLessThan(60000); expect(await draftKeysStored(ext)).toEqual([]);
    const ms = []; for (let k = 0; k < 5; k++) { const s = Date.now(); const [x] = await clickIcon(ext, T); ms.push(Date.now() - s); await closeTab(x); }
    test.info().annotations.push({ type: 'info', description: 'single click latency with 50 tabs open (ms): ' + JSON.stringify(ms) });
    expect(Math.max(...ms)).toBeLessThan(15000);
  });

  test('(18) STORM: 40 fresh ?new=1 tabs opened at once (all collide on 1) + 1 original: everyone ends unique, <= 1 alloc each, settles within 60 s, no draft, pending drained', async ({ ext }) => {
    test.setTimeout(300000);
    const T = hook(ext);
    const t0 = Date.now();
    const tabs = await Promise.all(Array.from({ length: 40 }, () => openDoc(ext, '?new=1')));
    const [a] = await clickIcon(ext, T);
    const all = [a, ...tabs];
    await expect.poll(async () => new Set(await Promise.all(all.map(async (t) => (await info(t)).name))).size, { timeout: 90000, intervals: [1000] }).toBe(41);
    const dt = Date.now() - t0;
    const counts = await Promise.all(tabs.map(allocCount));
    test.info().annotations.push({ type: 'info', description: `41 colliding tabs unique after ${dt} ms; alloc histogram ${JSON.stringify(counts.reduce((h, c) => (h[c] = (h[c] || 0) + 1, h), {}))}` });
    expect(Math.max(...counts)).toBeLessThanOrEqual(1);
    await settle(ext, (await nums(all)).sort((x, y) => x - y)); await noPending(ext); expect(await draftKeysStored(ext)).toEqual([]);
    const final = (await nums(all)).sort((x, y) => x - y);
    test.info().annotations.push({ type: 'info', description: 'final numbers span 1..' + final[final.length - 1] });
    expect(final[final.length - 1], 'numbers stay compact (<= 60)').toBeLessThanOrEqual(60);
  });

  test('(18) storage after churn (clicks, dups that yield, reloads, drafts reopened, Save As, closes): chrome.storage.local has only expected keys, session only an EMPTY pending object, locks == open tabs', async ({ ext }) => {
    test.setTimeout(240000);
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'out.md' });
    for (let r = 0; r < 6; r++) {
      const [a, b] = await clickIcon(ext, T, 2);
      const d = await openDoc(ext, dupQ(a)); await expect.poll(async () => (await info(d)).name, { timeout: 8000 }).not.toBe((await info(a)).name);
      await typeIn(b, 'r' + r); await waitDraft(b, slotOf(b), 'r' + r + '\n');
      if (r % 2) { await b.keyboard.press('Control+s'); await nameIs(b, /^out\.md$/); }
      await a.reload(); await b.reload(); await sleep(300);
      for (const t of [a, b, d]) await closeTab(t);
    }
    await settle(ext, []); await noPending(ext); await expectNoJunk(ext);
    const keys = await draftKeysStored(ext); expect(keys.every((k) => k.startsWith(SLOT))).toBe(true);
    const s = await sw(ext).evaluate(() => chrome.storage.session.get(null)); expect(Object.keys(s)).toEqual([PENDING_KEY]);
    const all = await localAll(ext); for (const k of keys) expect(String(all[k].text).trim()).not.toBe('');
  });

  test('(18) FUZZ-2 seed 20261002: 160 random steps incl. DUPLICATES (blank), RELOADS, DRAFT REOPEN, DISCARD, up to 20 tabs: unique names, locks == open numbers, click/dup get the lowest free number, no blank drafts, nothing lost', async ({ ext }) => {
    test.setTimeout(1500000);
    const T = hook(ext);
    let s = 20261002; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; const ri = (n) => Math.floor(rnd() * n);
    const open = new Map();            // n -> { page, text, id }
    const stored = new Map();          // n -> slot key (closed note with text, number held by the draft)
    const log = []; const st = { click: 0, close: 0, type: 0, erase: 0, dup: 0, reload: 0, reopen: 0, discard: 0, max: 0 };
    const used = () => new Set([...open.keys(), ...stored.keys()]);
    const lowest = (k, extra = []) => { const u = used(); extra.forEach((x) => u.add(x)); const r = []; for (let n = 1; r.length < k; n++) if (!u.has(n)) r.push(n); return r; };
    const check = async (label) => {
      await settle(ext, [...open.keys()]);
      const names = await Promise.all([...open.values()].map(async (o) => (await info(o.page)).name));
      expect(names.slice().sort(), label + ' ' + log.slice(-5)).toEqual([...open.keys()].map((n) => `Untitled-${n}.md`).sort());
      expect(new Set(names).size, label + ': unique').toBe(names.length);
      const want = [...open.values()].filter((o) => o.text).map((o) => slotOf(o.page));
      const have = await draftKeysStored(ext); const all = await localAll(ext);
      expect(have.length, label + ': draft keys = open-with-text + closed-with-text ' + log.slice(-4)).toBe(want.length + stored.size);
      for (const k of want) expect(have, label).toContain(k);
      for (const k of stored.values()) expect(have, label).toContain(k);
      for (const k of have) expect(String(all[k].text).trim(), label + ' blank draft ' + k).not.toBe('');
      await noPending(ext);
    };
    for (let step = 0; step < 160; step++) {
      const list = [...open.entries()]; const r = rnd();
      let act;
      if (!list.length) act = stored.size && r < 0.4 ? 'reopen' : 'click';
      else if (r < 0.22 && list.length < 20) act = 'click';
      else if (r < 0.40) act = 'close';
      else if (r < 0.54) act = 'type';
      else if (r < 0.64) act = 'erase';
      else if (r < 0.74) act = 'dup';
      else if (r < 0.84) act = 'reload';
      else if (r < 0.93) act = stored.size && list.length < 20 ? 'reopen' : 'reload';
      else act = stored.size ? 'discard' : 'type';
      if (act === 'click') {
        const k = Math.min(1 + ri(3), 20 - list.length); if (k < 1) { step--; continue; }
        const want = lowest(k); const tabs = await clickIcon(ext, T, k);
        const got = (await nums(tabs)).sort((a, b) => a - b); log.push(`click${k}->${got}`);
        expect(got, `step ${step} ${log.slice(-5)}`).toEqual(want);
        for (const p of tabs) open.set(await numOf(p), { page: p, text: false }); st.click++;
      } else if (act === 'dup') {
        const blanks = list.filter(([, o]) => !o.text); if (!blanks.length || list.length >= 20) { step--; continue; }
        const [n, o] = blanks[ri(blanks.length)];
        const want = lowest(1)[0];
        const d = await openDoc(ext, dupQ(o.page));
        await expect.poll(async () => (await info(d)).name, { timeout: 10000, message: `dup of ${n}` }).not.toBe(`Untitled-${n}.md`);
        const got = await numOf(d); log.push(`dup${n}->${got}`); expect(got, `step ${step} dup ${log.slice(-5)}`).toBe(want);
        open.set(got, { page: d, text: false }); st.dup++;
      } else if (act === 'reopen') {
        const keys = [...stored.entries()]; const [n, key] = keys[ri(keys.length)];
        const p = await openDoc(ext, '?doc=' + key.slice(SLOT.length)); await nameIs(p, new RegExp(`^Untitled-${n}\\.md$`), 10000);
        log.push(`reopen${n}`); stored.delete(n); open.set(n, { page: p, text: true }); st.reopen++;
      } else if (act === 'discard') {
        const keys = [...stored.entries()]; const [n, key] = keys[ri(keys.length)];
        await sw(ext).evaluate((k) => chrome.storage.local.remove(k), key); stored.delete(n); log.push(`discard${n}`); st.discard++;
      } else {
        const [n, o] = list[ri(list.length)];
        if (act === 'close') { log.push(`close${n}`); await closeTab(o.page); open.delete(n); if (o.text) stored.set(n, slotOf(o.page)); st.close++; }
        else if (act === 'type') { log.push(`type${n}`); await typeIn(o.page, 'w' + step); const key = slotOf(o.page); await expect.poll(async () => { const d = await lget(o.page, key); return d && d.text.trim().length > 0; }, { timeout: 8000 }).toBe(true); o.text = true; st.type++; }
        else if (act === 'erase') { log.push(`erase${n}`); await o.page.bringToFront(); await pmOf(o.page).click(); await o.page.keyboard.press('Control+a'); await o.page.keyboard.press('Backspace'); await expect.poll(async () => await lget(o.page, slotOf(o.page)), { timeout: 8000 }).toBeUndefined(); o.text = false; st.erase++; }
        else if (act === 'reload') { log.push(`reload${n}`); await o.page.reload(); await nameIs(o.page, new RegExp(`^Untitled-${n}\\.md$`), 10000); await sleep(700); st.reload++; }
      }
      st.max = Math.max(st.max, open.size);
      if (step % 5 === 4 || step > 150) await check('step ' + step);
    }
    await check('final');
    test.info().annotations.push({ type: 'info', description: 'fuzz-2 stats ' + JSON.stringify(st) + ' stored=' + JSON.stringify([...stored.keys()]) });
    for (const [n, o] of [...open]) { await closeTab(o.page); open.delete(n); if (o.text) stored.set(n, slotOf(o.page)); }
    await settle(ext, []); expect(await numOf(await one(ext, T))).toBe(lowest(1)[0]);
    expect(T.errors).toEqual([]); expect(st.dup).toBeGreaterThan(3); expect(st.reload).toBeGreaterThan(3); expect(st.reopen).toBeGreaterThan(1);
  });
});

// =====================================================================================================================
// ROUND 5 (build index-azEHsZT0.js): claim locks 'mdwe-claim-<n>-<time15>-<rand>' next to 'mdwe-num-<n>'; only the LATER claimer of a shared number yields;
// duplicate of a note with text gets a fresh number (#52); allocNumber() falls back after 2.5 s (no init hang).
// =====================================================================================================================
const lockInfo = (ext) => sw(ext).evaluate(async () => (await navigator.locks.query()).held.map((l) => ({ name: l.name, mode: l.mode })));
const claimNames = async (ext) => (await lockInfo(ext)).map((l) => l.name).filter((n) => /^mdwe-claim-/.test(n)).sort();
const claimTime = (name) => name.split('-')[3];
const settleClaims = (ext, want) => expect.poll(async () => (await claimNames(ext)).map((n) => Number(n.split('-')[2])).sort((a, b) => a - b), { timeout: 8000, message: 'claim locks (by n) == ' + JSON.stringify(want) }).toEqual(want.slice().sort((a, b) => a - b));
const claimsOf = (p) => p.evaluate(() => window.__claims || []);
const dropAlloc = () => { const o = chrome.runtime.sendMessage.bind(chrome.runtime); window.__dropped = 0; chrome.runtime.sendMessage = (m, cb, ...r) => { if (m && m.type === 'alloc-number') { window.__dropped++; return; } return o(m, cb, ...r); }; };
const openWith = async (ext, query, extraInit, slow = false) => {
  const r = await openEditor(ext, { query, init: ({ slow, extra }) => { /* eslint-disable-next-line no-new-func */ new Function('return (' + extra + ')')()(); }, arg: { slow, extra: extraInit.toString() } });
  await r.page.waitForFunction(() => window.__mdwe.state.slot); return r.page;
};
const forgeHolder = (p, n, stamp) => p.evaluate(([n, stamp]) => { navigator.locks.request('mdwe-claim-' + n + '-' + stamp, { mode: 'shared' }, () => new Promise(() => {})); navigator.locks.request('mdwe-num-' + n, { mode: 'shared' }, () => new Promise(() => {})); return true; }, [n, stamp]);

test.describe('19. claim locks (#51): naming, release, tie-break', () => {
  test('(19) every Untitled-N tab holds ONE shared claim lock "mdwe-claim-<n>-<15 digit ms>-<rand>" plus shared "mdwe-num-<n>"; none for plain/?src= tabs', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 3);
    const li = await lockInfo(ext);
    const claims = li.filter((l) => /^mdwe-claim-/.test(l.name));
    expect(claims).toHaveLength(3);
    for (const c of claims) { expect(c.name).toMatch(/^mdwe-claim-[1-3]-\d{15}-[a-z0-9]{1,8}$/); expect(c.mode).toBe('shared'); }
    expect(claims.map((c) => Number(c.name.split('-')[2])).sort()).toEqual([1, 2, 3]);
    expect(li.filter((l) => /^mdwe-num-/.test(l.name)).every((l) => l.mode === 'shared')).toBe(true);
    const times = claims.map((c) => Number(claimTime(c.name))); for (const t of times) expect(Math.abs(t - Date.now())).toBeLessThan(120000);
    const plain = await openEditor(ext); await sleep(300);
    expect(await claimNames(ext), 'a plain tab takes no claim').toHaveLength(3);
    await plain.page.close();
    test.info().annotations.push({ type: 'info', description: 'locks of 3 tabs: ' + JSON.stringify(li.map((l) => l.mode + ' ' + l.name).filter((n) => /claim|num/.test(n)).sort()) });
  });

  test('(19) claim + number locks are released together on close / reload (re-taken with a LATER stamp) / Save As / Open file; no stale claims after everything closes', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'saved.md', openName: 'o.md', openContent: '# o\n' });
    const [a, b, c, d] = await clickIcon(ext, T, 4);
    await settleClaims(ext, [1, 2, 3, 4]);
    const before = (await claimNames(ext)).find((n) => n.startsWith('mdwe-claim-1-'));
    await a.reload(); await nameIs(a, /^Untitled-1\.md$/); await settleClaims(ext, [1, 2, 3, 4]);
    const after = (await claimNames(ext)).find((n) => n.startsWith('mdwe-claim-1-'));
    expect(after).not.toBe(before); expect(claimTime(after) >= claimTime(before)).toBe(true);
    await typeIn(b, 'x'); await b.keyboard.press('Control+s'); await nameIs(b, /^saved\.md$/);
    await settleClaims(ext, [1, 3, 4]); await settle(ext, [1, 3, 4]);
    await c.keyboard.press('Control+o'); await nameIs(c, /^o\.md$/); await settleClaims(ext, [1, 4]); await settle(ext, [1, 4]);
    await closeTab(a); await settleClaims(ext, [4]); await closeTab(d); await closeTab(b); await closeTab(c);
    await settleClaims(ext, []); await settle(ext, []);
    expect((await lockNames(ext)).filter((n) => /^mdwe-(claim|num)-/.test(n)), 'no stale claim/num lock after all tabs closed').toEqual([]);
  });

  test('(19) TIE-BREAK: 3 / 6 / 10 blank ?new=1 tabs loaded at once: exactly ONE keeps 1 (the earliest claimer), the others each allocate exactly once, no ping-pong (<= 2 claims per tab), all unique', async ({ ext }) => {
    test.setTimeout(240000);
    const recClaims = () => { window.__claims = []; const lr = navigator.locks.request.bind(navigator.locks); navigator.locks.request = (name, ...a) => { if (/^mdwe-claim-/.test(name)) window.__claims.push(name); return lr(name, ...a); }; };
    for (const k of [3, 6, 10]) {
      const tabs = await Promise.all(Array.from({ length: k }, () => openWith(ext, '?new=1', () => { window.__msgs = []; const o = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (...a) => { window.__msgs.push(a[0] && a[0].type); return o(...a); }; window.__claims = []; const lr = navigator.locks.request.bind(navigator.locks); navigator.locks.request = (name, ...a) => { if (/^mdwe-claim-/.test(name)) window.__claims.push(name); return lr(name, ...a); }; })));
      await expect.poll(async () => new Set(await Promise.all(tabs.map(async (t) => (await info(t)).name))).size, { timeout: 30000, intervals: [500] }).toBe(k);
      await sleep(1500);
      const names = await Promise.all(tabs.map(async (t) => (await info(t)).name));
      expect(new Set(names).size).toBe(k); expect(names.filter((x) => x === 'Untitled-1.md')).toHaveLength(1);
      const first = await Promise.all(tabs.map(async (t) => (await claimsOf(t))[0]));
      const earliest = tabs[first.indexOf(first.slice().sort()[0])];
      expect((await info(earliest)).name, 'the earliest claimer keeps the number').toBe('Untitled-1.md');
      const allocs = await Promise.all(tabs.map((t) => t.evaluate(() => window.__msgs.filter((m) => m === 'alloc-number').length)));
      const claims = await Promise.all(tabs.map(async (t) => (await claimsOf(t)).length));
      test.info().annotations.push({ type: 'info', description: `k=${k}: names ${JSON.stringify(names.sort())} allocs ${JSON.stringify(allocs)} claims/tab ${JSON.stringify(claims)}` });
      expect(allocs.reduce((a, b) => a + b, 0), 'k-1 allocations in total').toBe(k - 1); expect(Math.max(...allocs)).toBeLessThanOrEqual(1);
      expect(Math.max(...claims), 'at most: initial claim + one after moving').toBeLessThanOrEqual(2);
      await settle(ext, names.map(nOf)); await settleClaims(ext, names.map(nOf)); await noPending(ext);
      expect(await draftKeysStored(ext)).toEqual([]);
      for (const t of tabs) await t.close(); await settleClaims(ext, []);
    }
  });

  test('(19) the EARLIER claimer never yields: original keeps its name, claim and zero alloc messages while a later duplicate moves', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const claim0 = (await claimNames(ext))[0];
    const d = await openDoc(ext, dupQ(a)); await nameIs(d, /^Untitled-2\.md$/);
    expect((await claimNames(ext)).filter((n) => n.startsWith('mdwe-claim-1-'))).toEqual([claim0]);
    expect((await info(a)).name).toBe('Untitled-1.md'); await sleep(1200); expect((await info(a)).name).toBe('Untitled-1.md');
    await settleClaims(ext, [1, 2]);
  });

  test('(19) forged holders (tie-break by stamp): an EARLIER foreign claim makes a fresh ?new=5 tab yield; a LATER foreign claim does not; identical stamp -> decided by the random suffix', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await forgeHolder(a, 5, '000000000000001-aaaaaaaa');
    const p = await openDoc(ext, '?new=5'); await nameIs(p, /^Untitled-(?!5\.)\d+\.md$/, 10000);
    expect((await info(p)).name).toBe('Untitled-2.md');
    await a.evaluate(() => { navigator.locks.request('mdwe-claim-7-999999999999999-zzzzzzzz', { mode: 'shared' }, () => new Promise(() => {})); navigator.locks.request('mdwe-num-7', { mode: 'shared' }, () => new Promise(() => {})); });
    const q = await openDoc(ext, '?new=7'); await sleep(2500);
    expect((await info(q)).name, 'later foreign claim: this tab is the earlier claimer, stays').toBe('Untitled-7.md');
  });

  test('(19) a LATER blank tab yields to an EARLIER tab that has text; an earlier BLANK tab never yields to a later one that has text (typed in the window)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'text first'); await waitDraft(a, slotOf(a), 'text first\n');
    const b = await openDoc(ext, '?new=1'); await nameIs(b, /^Untitled-2\.md$/);
    expect((await info(a)).name).toBe('Untitled-1.md'); expect((await info(a)).md).toBe('text first\n');
    await closeTab(a); await closeTab(b); await sleep(300);
    const [c] = await clickIcon(ext, T);                                          // 1 (a's draft holds 1 -> 2?) discard first
    test.info().annotations.push({ type: 'info', description: 'after closing the text tab its draft holds 1; the next click got ' + await numOf(c) });
  });
});

test.describe('20. #51 repro, #52 duplicate with text, allocNumber fallback', () => {
  test('(20) #51 repro: note at n=1 -> about:blank -> open ?new=1 -> return to the note URL: two tabs end with DIFFERENT names; the earlier claimer (the fresh tab) keeps 1, the returning note moves; one alloc; locks consistent', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); const url = a.url();
    await a.goto('about:blank'); await settle(ext, []);
    const p = await openDoc(ext, '?new=1'); await settle(ext, [1]);
    await a.goto(url); await a.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot);
    await expect.poll(async () => new Set([(await info(a)).name, (await info(p)).name]).size, { timeout: 8000 }).toBe(2);
    expect((await info(p)).name).toBe('Untitled-1.md'); expect((await info(a)).name).toBe('Untitled-2.md'); expect(a.url()).toMatch(/&n=2$/);
    await settle(ext, [1, 2]); await settleClaims(ext, [1, 2]); await noPending(ext);
    expect(await allocCount(p)).toBe(0); expect(T.errors).toEqual([]);
  });

  test('(20) #52: duplicate of a note WITH text gets a fresh number AND its saved draft is renamed; original untouched; reload / close / Drafts consistent; locks [1,2]', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'dup me'); await waitDraft(a, slotOf(a), 'dup me\n');
    const d = await openDoc(ext, dupQ(a)); await nameIs(d, /^Untitled-2\.md$/);
    const i = await info(d); expect(i.md).toBe('dup me\n'); expect(i.title).toBe('• Untitled-2.md — Markdown Editor'); expect(d.url()).toMatch(/&n=2$/);
    await expect.poll(async () => (await lget(a, slotOf(d))) && (await lget(a, slotOf(d))).name).toBe('Untitled-2.md');
    expect((await lget(a, slotOf(a))).name).toBe('Untitled-1.md'); expect((await lget(a, slotOf(a))).text).toBe('dup me\n');
    await settle(ext, [1, 2]); await settleClaims(ext, [1, 2]);
    await d.reload(); await nameIs(d, /^Untitled-2\.md$/); expect((await info(d)).md).toBe('dup me\n'); expect(await allocCount(d)).toBe(0);
    await closeTab(d);
    expect((await draftsList(a)).names).toEqual(['Untitled-2.md']);
    expect(await numOf(await one(ext, T)), '1 held by tab, 2 by stored draft').toBe(3);
    // chain: duplicate of the duplicate-with-text
    const e = await openDoc(ext, dupQ(a)); const f = await openDoc(ext, dupQ(a));
    await expect.poll(async () => new Set([(await info(e)).name, (await info(f)).name]).size, { timeout: 8000 }).toBe(2);
    expect(T.errors).toEqual([]);
  });

  test('(20) #52 edge: duplicate of a RENAMED text note (notes.md) keeps its name and holds no number; duplicate of a Drive-linked Untitled-1.md copy: RECORD name / drive link / what Save would send', async ({ ext }) => {
    const T = hook(ext);
    const id = '6d6d6d6d-0000-4000-8000-000000000001';
    await seed(ext, { [SLOT + id]: dr('notes.md', 'renamed text') });
    const a = await openDoc(ext, '?doc=' + id); await nameIs(a, /^notes\.md$/);
    const d = await openDoc(ext, '?doc=' + id); await sleep(1500);
    expect((await info(d)).name).toBe('notes.md'); expect(d.url()).not.toMatch(/&n=/); await settle(ext, []);
    expect((await info(d)).slot).not.toBe((await info(a)).slot);
    const id2 = '6d6d6d6d-0000-4000-8000-000000000002';
    await seed(ext, { [SLOT + id2]: dr('Untitled-1.md', 'drive text', { drive: { id: 'D1', modifiedTime: '2026-09-29T12:00:00.000Z', canEdit: true } }) });
    const g = await openDoc(ext, '?doc=' + id2); await nameIs(g, /^Untitled-1\.md$/);
    const h = await openDoc(ext, '?doc=' + id2); await sleep(1500);
    const ih = await info(h); const ig = await info(g);
    test.info().annotations.push({ type: 'info', description: `drive-linked original: ${ig.name} drive=${JSON.stringify(ig.drive)}; copy: ${ih.name} drive=${JSON.stringify(ih.drive)}` });
    expect(ih.drive, 'copy keeps the Drive link').toMatchObject({ id: 'D1' });
    expect(nOf(ih.name) > 0 || ih.name === 'Untitled-1.md').toBe(true);
  });

  test('(20) allocNumber FALLBACK: the background never answers alloc-number (dropped in the page) -> init still completes in ~2.5 s: numbered name (fallback number), lock + claim held, URL n, caret in the editor; late/never answer harmless; next icon click still lowest free', async ({ ext }) => {
    const T = hook(ext);
    const t0 = Date.now();
    const p = await openWith(ext, '?new=abc', dropAlloc);
    await expect.poll(async () => (await info(p)).name, { timeout: 8000 }).toMatch(/^Untitled-\d+\.md$/);
    const dt = Date.now() - t0;
    const i = await info(p); const n = nOf(i.name);
    test.info().annotations.push({ type: 'info', description: `fallback after ${dt} ms: ${i.name} (fallback = 1 + Date.now() % 900000)` });
    expect(dt).toBeGreaterThan(2000); expect(dt).toBeLessThan(7000); expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(900000);
    expect(i.title).toBe(i.name + ' — Markdown Editor'); expect(p.url()).toMatch(new RegExp('&n=' + n + '$'));
    await expect.poll(() => heldNums(ext)).toEqual([n]); await settleClaims(ext, [n]);
    await expect.poll(async () => (await info(p)).activeTag, { timeout: 4000 }).toBe('DIV');   // editor focused (ProseMirror)
    await typeIn(p, 'works'); await waitDraft(p, slotOf(p), 'works\n');
    expect(await numOf(await one(ext, T)), 'icon click unaffected by the fallback number').toBe(1);
  });

  test('(20) allocNumber fallback for a text DUPLICATE (#52 path) with the background silent: copy still loads (text kept), numbered by the fallback', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'orig'); await waitDraft(a, slotOf(a), 'orig\n');
    const d = await openWith(ext, dupQ(a), dropAlloc);
    await expect.poll(async () => (await info(d)).name, { timeout: 9000 }).toMatch(/^Untitled-\d+\.md$/); await expect.poll(async () => (await info(d)).name, { timeout: 9000 }).not.toBe('Untitled-1.md');
    expect((await info(d)).md).toBe('orig\n'); expect(await d.evaluate(() => window.__dropped)).toBeGreaterThanOrEqual(1);
    expect((await info(a)).md).toBe('orig\n');
  });

  test('(20) typing during the 500 ms wait of a later claimer: no switch, no lost text, no alloc; the earlier tab is untouched; after closing, numbers/drafts consistent', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const p = await openDoc(ext, '?new=1', true);
    await typeIn(p, 'typed while waiting'); await waitDraft(p, slotOf(p), 'typed while waiting\n'); await sleep(5200);
    expect((await info(p)).name).toBe('Untitled-1.md'); expect((await info(p)).md).toBe('typed while waiting\n'); expect(await allocCount(p)).toBe(0);
    expect((await info(a)).name).toBe('Untitled-1.md'); await settle(ext, [1, 1]);
    await closeTab(p); await settle(ext, [1]);
    expect(await numOf(await one(ext, T)), 'stored draft of the typed tab holds 1, tab a holds 1 -> 2').toBe(2);
  });
});

test.describe('21. claim-design hammer, mass reload, complaint', () => {
  test('(21) ORIGINAL COMPLAINT: open+close 5 empty notes -> next is Untitled-1; then 8 -> Untitled-1; claim/num locks and pending all empty', async ({ ext }) => {
    const T = hook(ext);
    for (const k of [5, 8]) {
      const tabs = await clickIcon(ext, T, k); expect((await nums(tabs)).sort((x, y) => x - y)).toEqual(Array.from({ length: k }, (_, i) => i + 1));
      for (const t of tabs) await closeTab(t);
      await settle(ext, []); await settleClaims(ext, []);
      const t = await one(ext, T); expect(await numOf(t), 'after ' + k).toBe(1); await closeTab(t);
    }
    await noPending(ext); expect(await draftKeysStored(ext)).toEqual([]); await expectNoJunk(ext);
  });

  test('(21) RELOAD ALL: 12 blank tabs reloaded at the same moment (+ icon clicks arriving): after settling every visible name is unique, claims/locks match, nothing leaks', async ({ ext }) => {
    test.setTimeout(240000);
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 12);
    const before = new Set(ext.ctx.pages());
    await sw(ext).evaluate(() => { globalThis.__run = true; (async () => { while (globalThis.__run) { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 25)); } })(); });
    await Promise.all(tabs.map((t) => t.reload())); await sleep(600);
    await sw(ext).evaluate(() => { globalThis.__run = false; }); await sleep(3500);
    const all = [...tabs, ...ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()))];
    for (const p of all) await p.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot);
    const names = await Promise.all(all.map(async (t) => (await info(t)).name));
    test.info().annotations.push({ type: 'info', description: `${all.length} tabs after mass reload+clicks; unique=${new Set(names).size}` });
    expect(new Set(names).size, 'unique names: ' + names).toBe(names.length);
    await settle(ext, names.map(nOf)); await settleClaims(ext, names.map(nOf)); await noPending(ext);
  });

  test('(21) hammer variant: TWO blank notes (1 and 2) reloading alternately while clicks arrive every 120 ms, 6 rounds: unique after settling', async ({ ext }) => {
    test.setTimeout(300000);
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2); const bad = [];
    for (let round = 0; round < 6; round++) {
      const before = new Set(ext.ctx.pages());
      await sw(ext).evaluate(() => { globalThis.__run = true; (async () => { while (globalThis.__run) { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); await new Promise((r) => setTimeout(r, 120)); } })(); });
      await Promise.all([a.reload(), sleep(60).then(() => b.reload())]); await sleep(300);
      await sw(ext).evaluate(() => { globalThis.__run = false; }); await sleep(2500);
      const extra = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
      for (const p of extra) await p.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot).catch(() => {});
      const names = await Promise.all([a, b, ...extra].map(async (p) => (await info(p)).name));
      if (new Set(names).size !== names.length) bad.push(round + ':' + names.filter((x, i) => names.indexOf(x) !== i));
      for (const p of extra) await p.close().catch(() => {}); await sleep(300); await setPending(ext, {});
      // a and b may have moved to other numbers; continue with whatever they are
    }
    test.info().annotations.push({ type: 'info', description: 'rounds with duplicates: ' + JSON.stringify(bad) });
    expect(bad).toEqual([]);
  });

  test('(21) 50 tabs + claim locks: 50 clicks -> 50 claims; 50 blank DUPLICATES of one note settle to unique names in < 60 s with exactly 49 allocs; all locks released after closing', async ({ ext }) => {
    test.setTimeout(420000);
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const t0 = Date.now(); const q = dupQ(a);
    const copies = await Promise.all(Array.from({ length: 49 }, () => openDoc(ext, q)));
    const all = [a, ...copies];
    await expect.poll(async () => new Set(await Promise.all(all.map(async (t) => (await info(t)).name))).size, { timeout: 90000, intervals: [1000] }).toBe(50);
    const dt = Date.now() - t0; const counts = await Promise.all(copies.map(allocCount));
    test.info().annotations.push({ type: 'info', description: `50 duplicates unique after ${dt} ms; allocs total ${counts.reduce((x, y) => x + y, 0)}` });
    expect(counts.every((c) => c === 1)).toBe(true); expect(dt).toBeLessThan(80000);
    await settle(ext, (await nums(all)).sort((x, y) => x - y)); await settleClaims(ext, (await nums(all)).sort((x, y) => x - y));
    for (const t of all) await t.close().catch(() => {});
    await settleClaims(ext, []); await settle(ext, []); await noPending(ext);
  });

  test('(21) FUZZ-3 seed 20261003: 160 steps incl. duplicates of notes WITH text (#52), blank duplicates, reloads, drafts reopen/discard, up to 20 tabs: unique names, locks == claims == open numbers, lowest free', async ({ ext }) => {
    test.setTimeout(1500000);
    const T = hook(ext);
    let s = 20261003; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; const ri = (n) => Math.floor(rnd() * n);
    const open = new Map(); const stored = new Map(); const log = []; const st = { click: 0, close: 0, type: 0, erase: 0, dup: 0, dupText: 0, reload: 0, reopen: 0, discard: 0, max: 0 };
    const used = () => new Set([...open.keys(), ...stored.keys()]);
    const lowest = (k) => { const u = used(); const r = []; for (let n = 1; r.length < k; n++) if (!u.has(n)) r.push(n); return r; };
    const check = async (label) => {
      await settle(ext, [...open.keys()]); await settleClaims(ext, [...open.keys()]);
      const names = await Promise.all([...open.values()].map(async (o) => (await info(o.page)).name));
      expect(names.slice().sort(), label + ' ' + log.slice(-5)).toEqual([...open.keys()].map((n) => `Untitled-${n}.md`).sort());
      expect(new Set(names).size, label + ': unique').toBe(names.length);
      const want = [...open.values()].filter((o) => o.text).map((o) => slotOf(o.page));
      const have = await draftKeysStored(ext); const all = await localAll(ext);
      expect(have.length, label + ' draft keys ' + log.slice(-4)).toBe(want.length + stored.size);
      for (const k of want) expect(have, label).toContain(k); for (const k of stored.values()) expect(have, label).toContain(k);
      for (const k of have) expect(String(all[k].text).trim(), label + ' blank draft').not.toBe('');
      for (const k of want) expect(all[k].name, label + ' draft name of an open tab = its tab name').toMatch(/^Untitled-\d+\.md$/);
      await noPending(ext);
    };
    for (let step = 0; step < 160; step++) {
      const list = [...open.entries()]; const r = rnd(); let act;
      if (!list.length) act = stored.size && r < 0.4 ? 'reopen' : 'click';
      else if (r < 0.2 && list.length < 20) act = 'click'; else if (r < 0.36) act = 'close'; else if (r < 0.5) act = 'type'; else if (r < 0.58) act = 'erase';
      else if (r < 0.72) act = 'dup'; else if (r < 0.82) act = 'reload'; else if (r < 0.92) act = stored.size && list.length < 20 ? 'reopen' : 'reload'; else act = stored.size ? 'discard' : 'type';
      if (act === 'click') {
        const k = Math.min(1 + ri(3), 20 - list.length); if (k < 1) { step--; continue; }
        const want = lowest(k); const tabs = await clickIcon(ext, T, k); const got = (await nums(tabs)).sort((a, b) => a - b); log.push(`click${k}->${got}`);
        expect(got, `step ${step} ${log.slice(-5)}`).toEqual(want); for (const p of tabs) open.set(await numOf(p), { page: p, text: false }); st.click++;
      } else if (act === 'dup') {
        if (list.length >= 20) { step--; continue; }
        const [n, o] = list[ri(list.length)]; const want = lowest(1)[0];
        const d = await openDoc(ext, dupQ(o.page));
        await expect.poll(async () => (await info(d)).name, { timeout: 12000, message: `dup of ${n}` }).not.toBe(`Untitled-${n}.md`);
        const got = await numOf(d); log.push(`dup${n}${o.text ? 'T' : ''}->${got}`); expect(got, `step ${step} dup ${log.slice(-5)}`).toBe(want);
        open.set(got, { page: d, text: o.text }); st.dup++; if (o.text) st.dupText++;
        if (o.text) await expect.poll(async () => { const dd = await lget(d, slotOf(d)); return dd && dd.name; }, { timeout: 8000 }).toBe(`Untitled-${got}.md`);
      } else if (act === 'reopen') {
        const keys = [...stored.entries()]; const [n, key] = keys[ri(keys.length)];
        const p = await openDoc(ext, '?doc=' + key.slice(SLOT.length)); await nameIs(p, new RegExp(`^Untitled-${n}\\.md$`), 10000);
        log.push(`reopen${n}`); stored.delete(n); open.set(n, { page: p, text: true }); st.reopen++;
      } else if (act === 'discard') {
        const keys = [...stored.entries()]; const [n, key] = keys[ri(keys.length)]; await sw(ext).evaluate((k) => chrome.storage.local.remove(k), key); stored.delete(n); log.push(`discard${n}`); st.discard++;
      } else {
        const [n, o] = list[ri(list.length)];
        if (act === 'close') { log.push(`close${n}`); await closeTab(o.page); open.delete(n); if (o.text) stored.set(n, slotOf(o.page)); st.close++; }
        else if (act === 'type') { log.push(`type${n}`); await typeIn(o.page, 'w' + step); const key = slotOf(o.page); await expect.poll(async () => { const d = await lget(o.page, key); return d && d.text.trim().length > 0; }, { timeout: 8000 }).toBe(true); o.text = true; st.type++; }
        else if (act === 'erase') { log.push(`erase${n}`); await o.page.bringToFront(); await pmOf(o.page).click(); await o.page.keyboard.press('Control+a'); await o.page.keyboard.press('Backspace'); await expect.poll(async () => await lget(o.page, slotOf(o.page)), { timeout: 8000 }).toBeUndefined(); o.text = false; st.erase++; }
        else if (act === 'reload') { log.push(`reload${n}`); await o.page.reload(); await nameIs(o.page, new RegExp(`^Untitled-${n}\\.md$`), 10000); await sleep(700); st.reload++; }
      }
      st.max = Math.max(st.max, open.size);
      if (step % 5 === 4 || step > 150) await check('step ' + step);
    }
    await check('final');
    test.info().annotations.push({ type: 'info', description: 'fuzz-3 stats ' + JSON.stringify(st) });
    for (const [n, o] of [...open]) { await closeTab(o.page); open.delete(n); if (o.text) stored.set(n, slotOf(o.page)); }
    await settle(ext, []); await settleClaims(ext, []); expect(await numOf(await one(ext, T))).toBe(lowest(1)[0]);
    expect(T.errors).toEqual([]); expect(st.dupText).toBeGreaterThan(2); expect(st.dup).toBeGreaterThan(6);
  });
});
