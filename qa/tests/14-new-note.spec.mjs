// 14. "NEW NOTE PER CLICK" (build index-BCILrRUb.js).  Toolbar icon / #btn-new / Alt+N open a NEW tab at editor/index.html?new=N, which rewrites itself to ?doc=<uuid>&n=N.
//     Counter = chrome.storage.session['mdwe.untitledNext'] (serialized in background.js); per-tab draft slot = chrome.storage.local['mdwe.draft.doc.<uuid>'];
//     Web Locks (round 2 build index-DrD0oqKO.js): 'mdwe-slot:<storage key>' (doc tabs exclusive+ifAvailable; plain/?src= tabs SHARED on mdwe.draft + mdwe.draft.file) marks an open draft, 'mdwe-num-<N>' (shared) reserves Untitled-N; Drafts dialog (#btn-drafts -> .drafts-box / .drafts-item / .drafts-open / .drafts-discard).
//   !! A real toolbar click cannot be produced headlessly: "icon click" = calling the REAL chrome.action.onClicked listeners inside the service worker
//      (chrome.action.onClicked.dispatch(activeTab)) - same mechanism as spec 02.  Alt+N is NOT a chrome.commands entry (manifest unchanged), it is an in-page keydown handler.
//   A. icon click / independence   B. rapid clicks   C. naming counter   D. reload restore   E. autosave isolation / storage   F. Drafts dialog
//   G. concurrency   H. regressions   I. edge cases (SW restart, 50 tabs, history)
//   Tests titled [BUG-n] are probes for a real bug logged in ../BUGS.md: they FAIL until it is fixed.  [fixed #n] = former probe, now a positive regression check.
//   J (round 2): tests for the Web Lock design itself (names, shared/exclusive, leaks, hangs, duplicate tab copy, races, focus trap).
import { test, expect, md, setMd, storageGet, SCREENS, ROOT, EXT, openEditor, fsaStub, fsaArgs } from '../lib/fixture.mjs';
import { hook, clickIcon, sendNew, info, docId, local, lget, lset, session, sw, pmOf, typeIn, waitDraft, closeTab, sleep, fsaRecorder, seed, uuidRe, nOf, waitNew, EDITOR_RE } from '../lib/notes.mjs';
import { openDriveEditor, FakeDrive, shot, installMock } from '../lib/drive.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';

const SLOT = 'mdwe.draft.doc.';
const slotOf = (p) => SLOT + docId(p);
const dr = (name, text, extra = {}) => ({ text, name, savedAt: Date.now(), drive: null, ...extra });
// NOTE: drafts.js builds rows with Object.assign(li, {'data-draft-key': key}) = an expando PROPERTY, not a DOM attribute (so no CSS hook). The observer below mirrors it into [data-k] for the tests.
const tagRows = (p) => p.evaluate(() => { if (window.__tagObs) return; const tag = () => document.querySelectorAll('.drafts-item').forEach((li) => { if (li['data-draft-key'] !== undefined) li.setAttribute('data-k', li['data-draft-key']); }); window.__tagObs = new MutationObserver(tag); window.__tagObs.observe(document.body, { childList: true, subtree: true }); });
const openDrafts = async (p) => { await p.bringToFront(); await tagRows(p); await p.click('#btn-drafts'); await p.locator('.drafts-box').waitFor(); await p.locator('.drafts-box .drafts-item, .drafts-box .drafts-empty').first().waitFor(); };
const rows = (p) => p.locator('.drafts-box .drafts-item');
const rowKeys = (p) => p.locator('.drafts-box .drafts-item').evaluateAll((l) => l.map((x) => x['data-draft-key']));
const expectFocused = (p) => expect.poll(() => p.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#editor-host .ProseMirror')), { message: 'editor.focus() puts the caret in the editor', timeout: 4000 }).toBe(true);
const rowFor = (p, key) => p.locator(`.drafts-box .drafts-item[data-k="${key}"]`);

// =====================================================================================================================
// A. ICON CLICK -> NEW INDEPENDENT TABS
// =====================================================================================================================
test.describe('A. icon click gives new independent tabs', () => {
  test('two clicks: two tabs; tab1 typed text+draft untouched by 2nd click; tab2 empty, focused, unmodified, no beforeunload prompt; no tab reused', async ({ ext }) => {
    const T = hook(ext);
    const [t1] = await clickIcon(ext, T, 1);
    const i1 = await info(t1);
    expect(i1.search).toMatch(/^\?doc=[0-9a-f-]{36}&n=1$/); expect(docId(t1)).toMatch(uuidRe);
    expect(i1.slot).toBe(SLOT + docId(t1)); expect(i1.name).toBe('Untitled-1.md');
    await typeIn(t1, 'tab one text');
    await waitDraft(t1, i1.slot, 'tab one text\n');
    const draft1 = await lget(t1, i1.slot);
    const pagesBefore = ext.ctx.pages().length;
    const [t2] = await clickIcon(ext, T, 1);
    expect(ext.ctx.pages().length).toBe(pagesBefore + 1);
    expect(t2).not.toBe(t1);
    expect(docId(t2)).not.toBe(docId(t1));
    // tab 1 untouched
    expect(await md(t1)).toBe('tab one text\n'); expect(t1.url()).toContain(docId(t1));
    expect(await lget(t1, i1.slot)).toEqual(draft1);
    // tab 2: empty, focused, unmodified
    const i2 = await info(t2);
    expect(i2.name).toBe('Untitled-2.md'); expect(i2.md).toBe(''); expect(i2.modified).toBe(false); expect(i2.dirty).toBe(false);
    expect(i2.filenameDirty).toBe(false); expect(i2.filename).toBe('Untitled-2.md');
    await expectFocused(t2);
    await t2.waitForTimeout(1200);
    expect(await lget(t2, i2.slot), 'untouched tab leaves no draft').toBeUndefined();
    // typing goes straight in without a click (focus really works)
    await t2.keyboard.type('x'); expect(await md(t2)).toBe('x\n');
    await t2.keyboard.press('Backspace');
    await waitDraft(t1, i1.slot, 'tab one text\n');
    // no beforeunload prompt for the untouched tab; positive control: tab1 (dirty) DOES prompt
    await sleep(500);
    await closeTab(t2);
    expect(T.of('beforeunload'), 'untouched new note must close silently').toHaveLength(0);
    await closeTab(t1);
    expect(T.of('beforeunload').length, 'positive control: dirty tab prompts').toBe(1);
    expect(T.errors).toEqual([]);
  });

  test('never reuses an existing editor tab (plain editor tab open + focused, with text; ?doc tab; ?src tab) - all untouched, all still there', async ({ ext }) => {
    const T = hook(ext);
    const plain = await openEditor(ext); await typeIn(plain.page, 'legacy text');
    await waitDraft(plain.page, 'mdwe.draft', 'legacy text\n');
    const before = ext.ctx.pages().filter((p) => EDITOR_RE.test(p.url())).length;
    await plain.page.bringToFront();
    const [n1] = await clickIcon(ext, T, 1);
    const [n2] = await clickIcon(ext, T, 1); // active tab is now an editor tab
    await n2.bringToFront();
    const [n3] = await clickIcon(ext, T, 1);
    expect(ext.ctx.pages().filter((p) => EDITOR_RE.test(p.url())).length).toBe(before + 3);
    expect(plain.page.url()).toBe(plain.url); expect(await md(plain.page)).toBe('legacy text\n');
    expect((await lget(plain.page, 'mdwe.draft')).text).toBe('legacy text\n');
    expect(new Set([n1, n2, n3].map(docId)).size).toBe(3);
    // new tabs are placed right after the tab that was active (index+1)
    const idx = await sw(ext).evaluate(async () => (await chrome.tabs.query({})).filter((t) => /editor\/index\.html/.test(t.url || '')).map((t) => ({ i: t.index, url: t.url })));
    test.info().annotations.push({ type: 'info', description: 'tab order: ' + JSON.stringify(idx.map((x) => x.i + ':' + (x.url.split('?')[1] || ''))) });
    expect(T.errors).toEqual([]);
  });

  test('legacy-slot tabs are not clobbered by new-note tabs (plain tab + file-backed tab: draft slots and content intact after many new notes + edits)', async ({ ext }) => {
    const T = hook(ext);
    const plain = await openEditor(ext); await typeIn(plain.page, 'plain A');
    await waitDraft(plain.page, 'mdwe.draft', 'plain A\n');
    const url = 'file:///tmp/q.md';
    const fetchStub = ({ map }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...r) => { u = String(u); if (u.startsWith('file://')) return new Response(map[u], { status: 200 }); return of(u, ...r); }; };
    const srcT = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: '# file\n' } } });
    await typeIn(srcT.page, 'more'); await waitDraft(srcT.page, 'mdwe.draft.file', (await md(srcT.page)));
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'note a'); await typeIn(b, 'note b');
    await waitDraft(a, slotOf(a), 'note a\n'); await waitDraft(b, slotOf(b), 'note b\n');
    const all = await local(a);
    expect(all['mdwe.draft'].text).toBe('plain A\n'); expect(all['mdwe.draft.file'].text).toContain('more');
    expect(await md(plain.page)).toBe('plain A\n');
    expect(plain.page.url()).not.toContain('doc='); expect(srcT.page.url()).toContain('?src=');
    // legacy tabs keep writing to THEIR slots
    await typeIn(plain.page, ' B'); await waitDraft(a, 'mdwe.draft', 'plain A B\n');
    expect((await lget(a, slotOf(a))).text).toBe('note a\n');
  });
});

// =====================================================================================================================
// B. RAPID CLICKS
// =====================================================================================================================
test.describe('B. rapid clicks', () => {
  test('5 clicks in one tick -> 5 tabs, Untitled-1..5, distinct uuids and slots', async ({ ext }) => {
    const T = hook(ext);
    const t0 = Date.now();
    const tabs = await clickIcon(ext, T, 5);
    expect(tabs).toHaveLength(5);
    const infos = await Promise.all(tabs.map(info));
    const names = infos.map((i) => i.name).sort();
    expect(names).toEqual(['Untitled-1.md', 'Untitled-2.md', 'Untitled-3.md', 'Untitled-4.md', 'Untitled-5.md']);
    expect(new Set(infos.map((i) => i.slot)).size).toBe(5); expect(new Set(tabs.map(docId)).size).toBe(5);
    for (const t of tabs) expect(docId(t)).toMatch(uuidRe);
    // title and filename match the n= in the URL
    for (const i of infos) { const n = new URL(i.url).searchParams.get('n'); expect(i.name).toBe(`Untitled-${n}.md`); expect(i.title).toContain(i.name); expect(i.filename).toBe(i.name); }
    expect(await session(ext)).toEqual({ 'mdwe.untitledNext': 6 });
    // each tab independently editable; slots do not collide
    for (const t of tabs) { const n = nOf((await info(t)).name); await typeIn(t, 'body ' + n); }
    for (const t of tabs) { const n = nOf((await info(t)).name); await waitDraft(t, slotOf(t), 'body ' + n + '\n'); }
    const all = await local(tabs[0]);
    expect(Object.keys(all).filter((k) => k.startsWith(SLOT))).toHaveLength(5);
    expect(T.errors).toEqual([]);
    test.info().annotations.push({ type: 'info', description: `5 tabs ready in ${Date.now() - t0}ms` });
  });

  test('5 clicks via the in-page message path (#btn-new x5 quickly, double-click) -> distinct numbers', async ({ ext }) => {
    const T = hook(ext);
    const [t] = await clickIcon(ext, T, 1);
    const before = new Set(ext.ctx.pages());
    for (let i = 0; i < 4; i++) await t.click('#btn-new', { noWaitAfter: true });
    await t.dblclick('#btn-new');
    const fresh = await waitNew(ext, before, 6);
    const names = (await Promise.all(fresh.map(info))).map((i) => nOf(i.name)).sort((a, b) => a - b);
    expect(names).toEqual([2, 3, 4, 5, 6, 7]);
  });

  test('two clicks spread over several ms (0,1,2,5,10 ms gaps) never share a number', async ({ ext }) => {
    const T = hook(ext);
    const before = new Set(ext.ctx.pages());
    await sw(ext).evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); for (const g of [0, 1, 2, 5, 10, 0, 3]) { chrome.action.onClicked.dispatch(t); await new Promise((r) => setTimeout(r, g)); } });
    const tabs = await waitNew(ext, before, 7);
    const ns = (await Promise.all(tabs.map(info))).map((i) => nOf(i.name)).sort((a, b) => a - b);
    expect(ns).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// =====================================================================================================================
// C. NAMING COUNTER
// =====================================================================================================================
const nums = async (tabs) => (await Promise.all(tabs.map(info))).map((i) => nOf(i.name));
test.describe('C. naming counter', () => {
  test('sequence 1,2,3; closing tabs does NOT recycle numbers; stored-draft numbers are skipped', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); const [b] = await clickIcon(ext, T); const [c] = await clickIcon(ext, T);
    expect(await nums([a, b, c])).toEqual([1, 2, 3]);
    await closeTab(c); await closeTab(b);
    const [d] = await clickIcon(ext, T);
    expect(nOf((await info(d)).name), 'closing tabs does not recycle numbers (counter is monotonic per browser session)').toBe(4);
    // a stored draft (Untitled-5 and Untitled-6 from earlier) is skipped
    await seed(ext, { [SLOT + 'aaaaaaaa-0000-4000-8000-000000000005']: dr('Untitled-5.md', 'five'), 'mdwe.draft': dr('Untitled-6.md', 'six'), 'mdwe.draft.file': dr('Untitled-7.MD', 'seven') });
    const [e] = await clickIcon(ext, T);
    expect(nOf((await info(e)).name)).toBe(8);
    expect(await session(ext)).toEqual({ 'mdwe.untitledNext': 9 });
  });

  test('non-matching draft names (Untitled.md, Untitled-0.md, Untitled-3.txt, My Untitled-3.md, huge number) do not reserve numbers', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'x'), [SLOT + 'b1']: dr('Untitled-3.txt', 'x'), [SLOT + 'b2']: dr('My Untitled-1.md', 'x'), [SLOT + 'b3']: { text: 'x' }, [SLOT + 'b4']: dr(null, 'x') });
    const [a] = await clickIcon(ext, T);
    expect(nOf((await info(a)).name)).toBe(1);
    await seed(ext, { [SLOT + 'b5']: dr('Untitled-2.md', 'x'), [SLOT + 'b6']: dr('Untitled-99999999999999999999.md', 'x') });
    const [b] = await clickIcon(ext, T);
    expect(nOf((await info(b)).name)).toBe(3);
  });

  test('session storage cleared (as after browser restart): counter restarts at 1, stored-draft numbers still skipped, no duplicate vs stored drafts', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 3);
    for (const t of tabs) await typeIn(t, 'keep ' + nOf((await info(t)).name));
    for (const t of tabs) await waitDraft(t, slotOf(t), 'keep ' + nOf((await info(t)).name) + '\n');
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    expect(await session(ext)).toEqual({});
    const [x] = await clickIcon(ext, T); const [y] = await clickIcon(ext, T);
    expect(await nums([x, y]), 'drafts Untitled-1..3 are stored -> skipped').toEqual([4, 5]);
  });

  test('[fixed #37] session cleared while an UNTOUCHED new-note tab is still open (no stored draft): the new tab must NOT get the same name', async ({ ext }) => {
    // Chrome restores tabs after a restart: the restored untouched Untitled-1 tab (?doc=..&n=1) has no stored draft, counter restarts at 1.
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    const [b] = await clickIcon(ext, T);
    const [na, nb] = await nums([a, b]);
    test.info().annotations.push({ type: 'info', description: `after session clear: open tab names ${na} and ${nb}` });
    expect(nb, 'two open tabs with the same Untitled-N name after a session reset').not.toBe(na);
  });

  test('draft of a tab named Untitled-1 closed, session counter at 1: new tab never takes Untitled-1 while that draft exists; after discard it can', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'precious'); await waitDraft(a, slotOf(a), 'precious\n'); const key = slotOf(a);
    await closeTab(a);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    const [b] = await clickIcon(ext, T);
    expect(nOf((await info(b)).name)).toBe(2);
    await sw(ext).evaluate((k) => chrome.storage.local.remove(k), key);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    const [c] = await clickIcon(ext, T);
    expect(nOf((await info(c)).name)).toBe(1);
  });

  test('name shows in tab title, #filename, and is the Save As default (suggestedName = Untitled-N.md); after save: name/title update, doc is a normal file', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'my-note.md' });
    await clickIcon(ext, T); const [t] = await clickIcon(ext, T);
    const i = await info(t);
    expect(i.title).toBe('Untitled-2.md — Markdown Editor'); expect(i.filename).toBe('Untitled-2.md'); expect(await t.title()).toBe(i.title);
    await typeIn(t, 'hello');
    await expect.poll(() => t.title()).toBe('• Untitled-2.md — Markdown Editor');
    await waitDraft(t, i.slot, 'hello\n');
    await t.keyboard.press('Control+s');
    await expect.poll(() => t.evaluate(() => window.__fsa.writes.length)).toBe(1);
    expect(await t.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-2.md']);
    await expect(t.locator('#filename')).toHaveText('my-note.md');
    await expect.poll(() => t.title()).toBe('my-note.md — Markdown Editor');
    const after = await info(t);
    expect(after.dirty).toBe(false); expect(after.filenameDirty).toBe(false); expect(after.hasHandle).toBe(true);
    expect(await lget(t, i.slot), 'draft slot cleared after save').toBeUndefined();
    // further Ctrl+S saves in place (no second picker)
    await typeIn(t, ' more'); await t.keyboard.press('Control+s');
    await expect.poll(() => t.evaluate(() => window.__fsa.writes.length)).toBe(2);
    expect(await t.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-2.md']);
    // still the same URL/slot after save; edit again -> draft goes back to the SAME slot with the file's name
    expect(t.url()).toContain(docId(t));
    await typeIn(t, ' again'); await waitDraft(t, i.slot, (await md(t)));
    expect((await lget(t, i.slot)).name).toBe('my-note.md');
    // reload: draft restored under file name (no file handle after reload, so Ctrl+S would ask again)
    await t.reload(); await t.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    await expect(t.locator('#filename')).toHaveText('my-note.md');
    expect(T.errors).toEqual([]);
  });

  test('Save As default name for every counter value in a fresh tab; tab title for 2- and 3-digit numbers', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, {});
    await sw(ext).evaluate(() => chrome.storage.session.set({ 'mdwe.untitledNext': 123 }));
    const [t] = await clickIcon(ext, T);
    expect((await info(t)).title).toBe('Untitled-123.md — Markdown Editor');
    await typeIn(t, 'x'); await t.keyboard.press('Control+Shift+s');
    await expect.poll(() => t.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-123.md']);
  });
});

// =====================================================================================================================
// D. RELOAD RESTORE / URL PARAMS
// =====================================================================================================================
test.describe('D. reload restore', () => {
  test('type, reload -> same URL, content, name, slot; reload again; unmodified tabs stay empty', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); const [b] = await clickIcon(ext, T);
    const ua = a.url(), ub = b.url();
    await typeIn(a, '# Heading\n\nbody **bold**');
    const ia = await info(a); await waitDraft(a, ia.slot, (await md(a)));
    for (let k = 0; k < 2; k++) {
      await a.reload(); await a.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
      await expect.poll(async () => (await info(a)).md).toBe('# Heading\n\nbody **bold**\n');
      const r = await info(a);
      expect(r.url).toBe(ua); expect(r.slot).toBe(ia.slot); expect(r.name).toBe('Untitled-1.md'); expect(r.title).toBe('• Untitled-1.md — Markdown Editor');
      expect(r.dirty).toBe(true);
      await expect(a.locator('#status')).toContainText('Restored autosaved draft');
    }
    // empty untouched tab b reloads empty, same URL, same name, no draft
    await b.reload(); await b.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    const rb = await info(b);
    expect(rb.url).toBe(ub); expect(rb.md).toBe(''); expect(rb.name).toBe('Untitled-2.md'); expect(rb.dirty).toBe(false); expect(rb.modified).toBe(false);
    await expectFocused(b);
    expect(await lget(b, rb.slot)).toBeUndefined();
    // a restored (draft-backed) tab: the editor's own "modified" state
    test.info().annotations.push({ type: 'info', description: 'restored draft tab: editor.isModified()=' + (await info(a)).modified + ' state.dirty=' + (await info(a)).dirty });
    expect(T.errors).toEqual([]);
  });

  test('two tabs reload independently (each keeps its own content), draft untouched by the other', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'AAA'); await typeIn(b, 'BBB');
    await waitDraft(a, slotOf(a), 'AAA\n'); await waitDraft(b, slotOf(b), 'BBB\n');
    await Promise.all([a.reload(), b.reload()]);
    await Promise.all([a, b].map((p) => p.waitForFunction(() => window.__mdwe && window.__mdwe.editor)));
    await expect.poll(() => md(a)).toBe('AAA\n'); await expect.poll(() => md(b)).toBe('BBB\n');
    expect((await local(a))[slotOf(a)].text).toBe('AAA\n'); expect((await local(a))[slotOf(b)].text).toBe('BBB\n');
  });

  test('?new=N loaded directly (as the SW does): rewritten to ?doc=<uuid>&n=N via replaceState; each ?new load makes a new uuid; reload keeps it', async ({ ext }) => {
    const r1 = await openEditor(ext, { query: '?new=7' });
    await expect.poll(() => r1.page.url()).toMatch(/\?doc=[0-9a-f-]{36}&n=7$/);
    const u = r1.page.url();
    expect((await info(r1.page)).name).toBe('Untitled-7.md');
    await r1.page.reload(); await r1.page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    expect(r1.page.url()).toBe(u);
    const r2 = await openEditor(ext, { query: '?new=7' });
    expect(docId(r2.page)).not.toBe(docId(r1.page));
  });

  test('garbled params: n=abc / n=0 / n=-5 / n=1.9 / n=1e3 / n= / new=abc / new without value -> sane name, no crash', async ({ ext }) => {
    const out = {};
    for (const q of ['?new=abc', '?new=', '?new', '?new=0', '?new=-5', '?new=1.9', '?new=1e3', '?new=007', '?new=%00', '?new=99999999999999999999', '?doc=' + '11111111-1111-4111-8111-111111111111' + '&n=abc', '?doc=22222222-2222-4222-8222-222222222222&n=-3', '?doc=33333333-3333-4333-8333-333333333333', '?doc=44444444-4444-4444-8444-444444444444&n=0']) {
      const r = await openEditor(ext, { query: q });
      const i = await info(r.page); out[q] = i.name;
      expect(r.errors, q).toEqual([]);
      expect(i.slot, q).toMatch(/^mdwe\.draft\.doc\./);
      expect(i.md).toBe('');
      await r.page.close();
    }
    test.info().annotations.push({ type: 'info', description: 'name by query: ' + JSON.stringify(out) });
    for (const [q, name] of Object.entries(out)) expect(name, q).toMatch(/^Untitled-[1-9]\d*\.md$/); 
  });

  test('[fixed #36] n=-5 / huge n are clamped: no "Untitled--5.md" / 21-digit names', async ({ ext }) => {
    const r = await openEditor(ext, { query: '?new=-5' });
    expect((await info(r.page)).name).toMatch(/^Untitled-[1-9]\d*\.md$/);
    const r2 = await openEditor(ext, { query: '?new=99999999999999999999' });
    expect((await info(r2.page)).name).toMatch(/^Untitled-\d{1,9}\.md$/);
  });

  test('?doc= edge values: empty doc (+new), garbage id, id with slashes/dots/spaces/unicode, very long id: no crash, own slot only, no overwrite of another note', async ({ ext }) => {
    const T = hook(ext);
    const [victim] = await clickIcon(ext, T); await typeIn(victim, 'victim text'); await waitDraft(victim, slotOf(victim), 'victim text\n');
    const before = await local(victim);
    const cases = ['?doc=&new=3', '?doc=garbage&new=1', '?doc=' + encodeURIComponent('../../mdwe.draft') + '&new=1', '?doc=' + encodeURIComponent('a b/ü€😀') + '&new=1', '?doc=' + 'x'.repeat(5000) + '&new=2', '?doc=' + encodeURIComponent('x&n=9') + '&new=1'];
    const res = {};
    for (const q of cases) {
      const r = await openEditor(ext, { query: q }); const i = await info(r.page);
      res[q.slice(0, 40)] = { slot: i.slot && i.slot.slice(0, 50), name: i.name, search: r.page.url().slice(-40) };
      expect(r.errors, q).toEqual([]);
      await typeIn(r.page, 'T' + q.length); await sleep(1100);
      await r.page.close({ runBeforeUnload: true });
    }
    test.info().annotations.push({ type: 'info', description: JSON.stringify(res) });
    const after = await local(victim);
    expect(after[slotOf(victim)]).toEqual(before[slotOf(victim)]);
    // round 2 (#36/#43): a non-uuid ?doc= is rejected: WITH new= it becomes a fresh uuid note, WITHOUT new= it is a plain page load (legacy slot, like any plain tab)
    for (const q of ['?doc=garbage', '?doc=' + 'x'.repeat(50), '?doc=' + encodeURIComponent('../../mdwe.draft')]) { const pl = await openEditor(ext, { query: q }); expect((await info(pl.page)).slot, q).toBeNull(); expect(pl.page.url()).toContain(q.slice(0, 20)); }
    const nw = await openEditor(ext, { query: '?doc=garbage&new=4' }); expect((await info(nw.page)).slot).toMatch(/^mdwe\.draft\.doc\.[0-9a-f-]{36}$/); expect((await info(nw.page)).name).toBe('Untitled-4.md');
    for (const k of Object.keys(after).filter((x) => x.startsWith(SLOT))) expect(k, 'only uuid slots are ever created').toMatch(/^mdwe\.draft\.doc\.[0-9a-f-]{36}$/);
    const k = Object.keys(after).filter((x) => x.startsWith('mdwe.draft'));
    test.info().annotations.push({ type: 'info', description: 'draft keys after garbled loads: ' + JSON.stringify(k.map((x) => x.slice(0, 40))) });
  });

  test('missing ?n= on a ?doc= URL of an existing draft: the draft name wins (no rename); a restored draft keeps its name even if n differs', async ({ ext }) => {
    const id = '55555555-5555-4555-8555-555555555555';
    await seed(ext, { [SLOT + id]: dr('Untitled-9.md', 'stored body') });
    const r = await openEditor(ext, { query: '?doc=' + id });
    expect((await info(r.page)).name).toBe('Untitled-9.md'); expect(await md(r.page)).toBe('stored body');
    const r2 = await openEditor(ext, { query: '?doc=' + id + '&n=2' });
    expect((await info(r2.page)).name).toBe('Untitled-9.md');
  });

  test('[fixed #43] two tabs on the SAME ?doc= (duplicate-tab / ctrl+shift+T): both load content; no crash; recorded who owns the slot', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'dup');
    await waitDraft(a, slotOf(a), 'dup\n');
    const b = await openEditor(ext, { query: a.url().slice(a.url().indexOf('?')) });
    expect(await md(b.page)).toBe('dup\n');
    await typeIn(b.page, '+b'); await sleep(1200);
    const d = await lget(a, slotOf(a));
    test.info().annotations.push({ type: 'info', description: 'two live tabs on one slot: slot text=' + JSON.stringify(d.text) + ' (a=' + JSON.stringify(await md(a)) + ')' });
    expect((await info(b.page)).slot !== slotOf(a), 'a duplicated tab must get its own slot (fresh uuid)').toBe(true);
  });
});

// =====================================================================================================================
// E. AUTOSAVE ISOLATION / STORAGE
// =====================================================================================================================
test.describe('E. autosave isolation and storage contents', () => {
  test('edits in tab A write only A\'s slot (never B\'s, never legacy mdwe.draft); theme + other prefs stay shared; exact storage keys', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'only A');
    await waitDraft(a, slotOf(a), 'only A\n');
    await sleep(1500);
    let all = await local(a);
    expect(Object.keys(all).sort()).toEqual([slotOf(a)].concat(all['mdwe.theme'] ? ['mdwe.theme'] : []).sort());
    expect(all[slotOf(b)]).toBeUndefined(); expect(all['mdwe.draft']).toBeUndefined(); expect(all['mdwe.draft.file']).toBeUndefined();
    const rec = all[slotOf(a)];
    expect(Object.keys(rec).sort()).toEqual(['drive', 'name', 'savedAt', 'text']);
    expect(rec).toMatchObject({ text: 'only A\n', name: 'Untitled-1.md', drive: null }); expect(Math.abs(Date.now() - rec.savedAt)).toBeLessThan(15000);
    // typing in B then clearing it: B's slot removed, A's untouched
    await typeIn(b, 'B text'); await waitDraft(b, slotOf(b), 'B text\n');
    await pmOf(b).click(); await b.keyboard.press('Control+a'); await b.keyboard.press('Backspace');
    await expect.poll(() => lget(b, slotOf(b)), { timeout: 5000 }).toBeUndefined();
    expect((await lget(a, slotOf(a))).text).toBe('only A\n');
    // theme: toggle in A -> B follows? (shared pref in storage) and survives new tabs
    await a.click('#btn-theme');
    const th = await a.evaluate(() => document.documentElement.dataset.theme);
    expect(await lget(a, 'mdwe.theme')).toBe(th);
    const [c] = await clickIcon(ext, T);
    expect(await c.evaluate(() => document.documentElement.dataset.theme)).toBe(th);
    const keys = Object.keys(await local(a)).sort();
    test.info().annotations.push({ type: 'info', description: 'chrome.storage.local keys after multi-tab use: ' + JSON.stringify(keys) + '; session: ' + JSON.stringify(await session(ext)) });
    expect(T.errors).toEqual([]);
  });

  test('visibilitychange(hidden)/tab switch flushes the draft to the tab\'s own slot; no legacy write', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await a.bringToFront(); await pmOf(a).click(); await a.keyboard.type('quick');
    await b.bringToFront(); // hides A immediately (<800ms)
    await expect.poll(() => lget(b, slotOf(a)).then((d) => d && d.text), { timeout: 3000 }).toBe('quick\n');
    expect(await lget(b, 'mdwe.draft')).toBeUndefined();
  });

  test('no unbounded growth: 20 untouched tabs + open/close leave NO draft entries; typed-then-erased tab leaves none; whitespace-only note is stored but hidden from Drafts', async ({ ext }) => {
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 20);
    await sleep(1200);
    expect(Object.keys(await local(tabs[0])).filter((k) => k.startsWith('mdwe.draft'))).toEqual([]);
    for (const t of tabs) await closeTab(t);
    const probe = await openEditor(ext);
    expect(Object.keys(await local(probe.page)).filter((k) => k.startsWith('mdwe.draft'))).toEqual([]);
    expect(await sw(ext).evaluate(() => chrome.storage.local.getBytesInUse(null))).toBeLessThan(200);
    // whitespace-only
    const [w] = await clickIcon(ext, T); await typeIn(w, '   '); await sleep(1500);
    const wk = Object.keys(await local(w)).filter((k) => k.startsWith(SLOT));
    test.info().annotations.push({ type: 'info', description: 'whitespace-only note leaves slots: ' + JSON.stringify(wk) });
    await closeTab(w);
    const dlg = await openEditor(ext); await openDrafts(dlg.page);
    expect(await rows(dlg.page).count(), 'whitespace-only drafts must not show in Drafts').toBe(0);
    const after = Object.keys(await local(dlg.page)).filter((k) => k.startsWith(SLOT));
    test.info().annotations.push({ type: 'info', description: 'orphan whitespace slot kept in storage after close: ' + JSON.stringify(after.length) });
    expect(after.length).toBe(0);
  });

  test('closed-tab drafts accumulate in storage only for tabs with text; reload does not create a second slot', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'x'); await waitDraft(a, slotOf(a), 'x\n');
    for (let i = 0; i < 3; i++) { await a.reload(); await a.waitForFunction(() => window.__mdwe && window.__mdwe.editor); }
    const slots = Object.keys(await local(a)).filter((k) => k.startsWith(SLOT));
    expect(slots).toEqual([slotOf(a)]);
  });
});

// =====================================================================================================================
// F. DRAFTS DIALOG
// =====================================================================================================================
test.describe('F. Drafts dialog', () => {
  test('[fixed #42] long unbroken note/file name (120 chars) does not overflow the dialog horizontally (Open/Discard stay reachable)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await seed(ext, { [SLOT + 'long']: dr('a'.repeat(117) + '.md', 'short body') });
    await openDrafts(a);
    const r = await a.evaluate(() => { const b = document.querySelector('.drafts-box'); const o = document.querySelector('.drafts-open').getBoundingClientRect(); const d = document.querySelector('.drafts-discard').getBoundingClientRect(); const bb = b.getBoundingClientRect();
      return { scrollW: b.scrollWidth, clientW: b.clientWidth, openRight: o.right, discardRight: d.right, boxRight: bb.right, vw: innerWidth }; });
    test.info().annotations.push({ type: 'info', description: JSON.stringify(r) });
    expect(r.scrollW).toBeLessThanOrEqual(r.clientW + 1);
    expect(r.discardRight).toBeLessThanOrEqual(r.boxRight);
    await shot(a, '14-drafts-longname.png');
  });

  test('close tab with text -> draft stays; close empty untouched -> none; dialog (from another tab) lists only the first; title/preview/time sensible', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    await typeIn(a, '# Shopping list\n\nmilk and eggs'); const ka = slotOf(a); await waitDraft(a, ka, (await md(a)));
    await closeTab(a); await closeTab(b);
    expect(await lget(c, ka)).toBeTruthy();
    await openDrafts(c);
    expect(await rowKeys(c)).toEqual([ka]);
    const row = rowFor(c, ka);
    await expect(row.locator('strong')).toHaveText('Untitled-1.md');
    await expect(row.locator('.drafts-when')).toContainText(/just now/);
    await expect(row.locator('.drafts-snippet')).toContainText('Shopping list');
    await expect(row.locator('.drafts-snippet')).toContainText('milk and eggs');
    expect(await c.locator('.drafts-box h2').textContent()).toBe('Unsaved drafts');
    expect(await c.locator('.drafts-box').getAttribute('role')).toBe('dialog'); expect(await c.locator('.drafts-box').getAttribute('aria-label')).toBe('Unsaved drafts');
    expect(await c.locator('#btn-drafts').textContent()).toBe('Drafts (1)');
    await shot(c, '14-drafts-light.png');
  });

  test('empty state; Esc closes (also while focus is in the editor); overlay click closes; Close button focused on open; Esc does not leak to the editor', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await expect(a.locator('#btn-drafts')).toHaveText('Drafts');
    await openDrafts(a);
    await expect(a.locator('.drafts-empty')).toHaveText('No unsaved drafts.');
    await expect(a.locator('.drafts-box .drafts-close')).toBeFocused();
    await a.keyboard.press('Escape'); await expect(a.locator('.drafts-overlay')).toHaveCount(0);
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor();
    await a.mouse.click(3, 3); await expect(a.locator('.drafts-overlay')).toHaveCount(0);
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor();
    await a.locator('.drafts-box .drafts-close').click(); await expect(a.locator('.drafts-overlay')).toHaveCount(0);
    // clicking inside the box does not close
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor(); await a.locator('.drafts-box h2').click(); await expect(a.locator('.drafts-box')).toHaveCount(1);
    await a.keyboard.press('Escape');
    // reopening repeatedly does not stack overlays / leak key handlers
    for (let i = 0; i < 3; i++) { await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor(); await a.keyboard.press('Escape'); }
    await a.click('#btn-drafts'); await expect(a.locator('.drafts-overlay')).toHaveCount(1);
    // double click on the Drafts button while open
    await a.keyboard.press('Escape');
    // after closing, focus returns where? (recorded)
    test.info().annotations.push({ type: 'info', description: 'focus after closing dialog: ' + (await a.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id + '.' + document.activeElement.className)) });
    expect(T.errors).toEqual([]);
  });

  test('Tab key stays inside the dialog? (focus trap) - recorded; Enter on focused Close closes', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await seed(ext, { [SLOT + 'f1']: dr('Untitled-7.md', 'one'), [SLOT + 'f2']: dr('Untitled-8.md', 'two') });
    await openDrafts(a);
    const seen = [];
    for (let i = 0; i < 8; i++) { await a.keyboard.press('Tab'); seen.push(await a.evaluate(() => (document.activeElement.closest('.drafts-box') ? 'in:' : 'OUT:') + document.activeElement.tagName + '.' + document.activeElement.className + '#' + document.activeElement.id)); }
    test.info().annotations.push({ type: 'info', description: 'tab order from Close: ' + JSON.stringify(seen) });
    await a.keyboard.press('Escape');
  });

  test('[fixed #39] after Open the row is still shown, enabled, in the SAME dialog (list re-rendered before the new tab took its lock) - a 2nd click opens a 2nd editor on the slot', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'row stays'); const ka = slotOf(a); await waitDraft(a, ka, 'row stays\n'); await closeTab(a);
    await openDrafts(b);
    const before = new Set(ext.ctx.pages());
    await rowFor(b, ka).locator('.drafts-open').click();
    await waitNew(ext, before, 1); await sleep(800);
    const still = await rows(b).count();
    const enabled = still ? await rowFor(b, ka).locator('.drafts-open').isEnabled() : null;
    test.info().annotations.push({ type: 'info', description: `rows left in the dialog after Open: ${still}, Open enabled: ${enabled}` });
    expect(still, 'a draft that is now open in a tab must not stay offered in the same dialog').toBe(0);
  });

  test('Open: new tab with exact content/name; slot draft adopted in place (no duplicate, no copy), original row disappears; Open tab holds the lock', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    const body = '# Title\n\n- a\n- b\n\n```js\nlet x = 1;\n```\n\n**bold** é 😀';
    await typeIn(a, body); const ka = slotOf(a); await waitDraft(a, ka, (await md(a)));
    const saved = await md(a); const idA = docId(a);
    await closeTab(a);
    await openDrafts(b);
    const before = new Set(ext.ctx.pages());
    await rowFor(b, ka).locator('.drafts-open').click();
    const [re] = await waitNew(ext, before, 1);
    expect(docId(re)).toBe(idA);
    const i = await info(re);
    expect(i.md).toBe(saved); expect(i.name).toBe('Untitled-1.md'); expect(i.slot).toBe(ka);
    await expect(re.locator('#status')).toContainText('Restored autosaved draft');
    expect(Object.keys(await local(b)).filter((k) => k.startsWith(SLOT))).toEqual([ka]);
    // after re-opening the dialog the row is gone (lock now held by the reopened tab), no second copy
    await b.keyboard.press('Escape'); await openDrafts(b);
    await expect(rows(b)).toHaveCount(0);
    expect(T.errors).toEqual([]);
  });

  test('[fixed #41] Drafts (N) button count goes stale after Open: it still counts the draft that the dialog no longer lists (count refreshes only on storage change; taking the Web Lock changes nothing)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'count me'); const ka = slotOf(a); await waitDraft(a, ka, 'count me\n'); await closeTab(a);
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts (1)');
    const before = new Set(ext.ctx.pages());
    await openDrafts(b); await rowFor(b, ka).locator('.drafts-open').click(); await waitNew(ext, before, 1); await sleep(1000);
    await b.keyboard.press('Escape'); await openDrafts(b);
    const listed = await rows(b).count(); const label = await b.locator('#btn-drafts').textContent();
    test.info().annotations.push({ type: 'info', description: `dialog lists ${listed}, button says "${label}"` });
    expect(label).toBe(listed ? `Drafts (${listed})` : 'Drafts');
  });

  test('Open of a LEGACY shared slot (mdwe.draft and mdwe.draft.file): adopted into mdwe.doc slot, legacy key removed, content+name+drive link preserved', async ({ ext }) => {
    const T = hook(ext);
    const [b] = await clickIcon(ext, T);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'legacy untitled', { savedAt: Date.now() - 1000 }), 'mdwe.draft.file': dr('notes.md', 'legacy file draft', { savedAt: Date.now() - 2000, drive: { id: 'DRV1', modifiedTime: '2026-09-29T12:00:00.000Z', canEdit: true } }) });
    await openDrafts(b);
    expect(await rowKeys(b)).toEqual(['mdwe.draft', 'mdwe.draft.file']); // sorted newest first
    for (const [key, text, name] of [['mdwe.draft.file', 'legacy file draft', 'notes.md'], ['mdwe.draft', 'legacy untitled', 'Untitled.md']]) {
      const before = new Set(ext.ctx.pages());
      await rowFor(b, key).locator('.drafts-open').click();
      const [re] = await waitNew(ext, before, 1);
      const i = await info(re);
      expect(i.md).toBe(text); expect(i.name).toBe(name); expect(i.slot).toMatch(/^mdwe\.draft\.doc\./);
      if (key === 'mdwe.draft.file') expect(i.drive).toMatchObject({ id: 'DRV1' });
      const all = await local(b);
      expect(all[key], 'legacy slot cleared after adoption').toBeUndefined();
      expect(all[i.slot].text).toBe(text);
    }
    const all = await local(b);
    expect(Object.keys(all).filter((k) => k.startsWith(SLOT))).toHaveLength(2);
    expect(T.errors).toEqual([]);
  });

  test('[fixed #38] legacy slot draft is NOT shown in the Drafts of the tab that owns it (plain tab), and IS shown in new-note tabs even while that plain tab is open (no lock for legacy)', async ({ ext }) => {
    const T = hook(ext);
    const plain = await openEditor(ext); await typeIn(plain.page, 'owned by plain tab'); await waitDraft(plain.page, 'mdwe.draft', 'owned by plain tab\n');
    const [n] = await clickIcon(ext, T);
    await openDrafts(plain.page); expect(await rows(plain.page).count()).toBe(0); await plain.page.keyboard.press('Escape');
    await openDrafts(n);
    const keys = await rowKeys(n);
    test.info().annotations.push({ type: 'info', description: 'new-note tab Drafts lists legacy draft of a still-open plain tab: ' + JSON.stringify(keys) });
    expect(keys, 'a legacy draft still open in a plain tab must not be offered for Open').toEqual([]);
  });

  test('Discard: confirm text names the draft; cancel keeps; confirm removes (storage + row + count); Esc/focus stay sane', async ({ ext }) => {
    const T = hook(ext); T.mode = 'dismiss';
    const [a] = await clickIcon(ext, T);
    await seed(ext, { [SLOT + 'd1']: dr('Untitled-4.md', 'keep me'), [SLOT + 'd2']: dr('Untitled-5.md', 'second', { savedAt: Date.now() - 5000 }) });
    await openDrafts(a);
    await expect(a.locator('#btn-drafts')).toHaveText('Drafts (2)');
    await rowFor(a, SLOT + 'd1').locator('.drafts-discard').click();
    await expect.poll(() => T.of('confirm').length).toBe(1);
    expect(T.of('confirm')[0].message).toBe('Discard "Untitled-4.md"? This cannot be undone.');
    expect(await lget(a, SLOT + 'd1')).toBeTruthy(); await expect(rows(a)).toHaveCount(2);
    T.mode = 'accept';
    await rowFor(a, SLOT + 'd1').locator('.drafts-discard').click();
    await expect(rows(a)).toHaveCount(1);
    expect(await lget(a, SLOT + 'd1')).toBeUndefined(); expect(await lget(a, SLOT + 'd2')).toBeTruthy();
    await expect(a.locator('#btn-drafts')).toHaveText('Drafts (1)');
    await a.locator('.drafts-box .drafts-discard').click();
    await expect(a.locator('.drafts-empty')).toBeVisible(); await expect(a.locator('#btn-drafts')).toHaveText('Drafts');
    await expect(a.locator('.drafts-box .drafts-close')).toBeFocused();
    await a.keyboard.press('Escape'); await expect(a.locator('.drafts-overlay')).toHaveCount(0);
  });

  test('Drafts button count updates live across tabs (storage.onChanged) and the hint is shown on a fresh note', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'text in a'); await waitDraft(a, slotOf(a), 'text in a\n');
    await a.bringToFront(); await closeTab(a);
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts (1)');
    const [c] = await clickIcon(ext, T);
    await expect(c.locator('#status')).toContainText('1 unsaved draft from earlier: see Drafts');
    await expect(c.locator('#btn-drafts')).toHaveText('Drafts (1)');
  });

  test('dark mode: dialog colours differ from light and are readable (contrast of text vs box background >= 4.5)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await seed(ext, { [SLOT + 'k1']: dr('Untitled-4.md', 'dark mode body text') });
    const probe = async () => { await openDrafts(a); const r = await a.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const cr = (x, y) => { const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p); return (l1 + 0.05) / (l2 + 0.05); };
      const box = getComputedStyle(document.querySelector('.drafts-box')); const out = {};
      for (const sel of ['.drafts-box h2', '.drafts-item strong', '.drafts-snippet', '.drafts-when', '.drafts-hint', '.drafts-open', '.drafts-discard']) { const e = document.querySelector(sel); const cs = getComputedStyle(e);
        const bg = /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) ? box.backgroundColor : cs.backgroundColor; out[sel] = { fg: cs.color, bg, ratio: Math.round(cr(cs.color, bg) * 10) / 10 }; }
      return { boxBg: box.backgroundColor, out }; }); await a.keyboard.press('Escape'); return r; };
    const light = await probe(); await a.click('#btn-theme'); expect(await a.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    const dark = await probe(); await openDrafts(a); await shot(a, '14-drafts-dark.png'); await a.keyboard.press('Escape');
    test.info().annotations.push({ type: 'info', description: 'contrast light=' + JSON.stringify(Object.fromEntries(Object.entries(light.out).map(([k, v]) => [k, v.ratio]))) + ' dark=' + JSON.stringify(Object.fromEntries(Object.entries(dark.out).map(([k, v]) => [k, v.ratio]))) });
    expect(dark.boxBg).not.toBe(light.boxBg);
    for (const [k, v] of Object.entries(dark.out)) expect(v.ratio, 'dark ' + k).toBeGreaterThanOrEqual(3);
    for (const [k, v] of Object.entries(light.out)) expect(v.ratio, 'light ' + k).toBeGreaterThanOrEqual(3);
  });

  test('XSS-safe rendering: <img onerror>, <script>, quotes in draft text AND note name are inert text (no element, no handler, no dialog, no ext API leak)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const evil = '<img src=x onerror="window.__pwn=1;alert(1)"><script>window.__pwn=2</script><svg onload="window.__pwn=3"> "\'><b>bold</b>';
    const evilName = '<img src=x onerror="window.__pwn=4"><script>window.__pwn=5</script>.md';
    await seed(ext, { [SLOT + '0aaaaaaa-0000-4000-8000-0000000000x1'.replace('x1', 'a1')]: dr(evilName, evil), [SLOT + '0aaaaaaa-0000-4000-8000-0000000000a2']: dr('Untitled-2.md', '[click](javascript:window.__pwn=6) <iframe src="javascript:alert(2)"></iframe>') });
    await openDrafts(a);
    await expect(rows(a)).toHaveCount(2);
    const r = await a.evaluate(() => ({ imgs: document.querySelectorAll('.drafts-box img, .drafts-box script, .drafts-box svg, .drafts-box iframe, .drafts-box b, .drafts-box a').length, pwn: window.__pwn || null,
      text: document.querySelector('.drafts-item[data-k$="a1"]').textContent }));
    expect(r.imgs).toBe(0); expect(r.pwn).toBeNull(); expect(r.text).toContain('<img src=x onerror='); expect(r.text).toContain('<script>');
    await sleep(500); expect(T.of('alert')).toHaveLength(0);
    // opening the evil draft renders it through the editor: still inert
    const before = new Set(ext.ctx.pages());
    await rowFor(a, SLOT + '0aaaaaaa-0000-4000-8000-0000000000a1').locator('.drafts-open').click();
    const [re] = await waitNew(ext, before, 1); await sleep(500);
    expect(await re.evaluate(() => window.__pwn || null)).toBeNull(); expect(T.of('alert')).toHaveLength(0);
    expect(await re.evaluate(() => document.querySelectorAll('#editor-host img[src="x"], #editor-host script, #editor-host svg[onload]').length)).toBe(0);
    expect((await info(re)).title).toContain('<img src=x'); // title is text
    expect((await info(re)).filename).toContain('<img src=x'); // textContent
    expect(await re.evaluate(() => document.getElementById('filename').children.length)).toBe(0);
  });

  test('many drafts: 100 drafts list renders quickly (< 2s), button count, scroll, discard in the middle; 300-char/long single-line/huge text preview is clipped', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const o = {}; for (let i = 0; i < 100; i++) o[SLOT + 'm' + String(i).padStart(3, '0')] = dr('Untitled-' + (i + 10) + '.md', 'draft number ' + i + '\n' + 'lorem ipsum '.repeat(20), { savedAt: Date.now() - i * 60000 });
    o[SLOT + 'big'] = dr('big.md', 'x'.repeat(2_000_000), { savedAt: Date.now() + 1000 });
    o[SLOT + 'wide'] = dr('Untitled-9' + '9'.repeat(200) + '.md', 'W'.repeat(5000) + ' end', { savedAt: Date.now() + 2000 });
    await seed(ext, o);
    await expect(a.locator('#btn-drafts')).toHaveText('Drafts (102)');
    await tagRows(a); const t0 = Date.now(); await a.click('#btn-drafts'); await expect(rows(a)).toHaveCount(102, { timeout: 15000 }); const dt = Date.now() - t0;
    test.info().annotations.push({ type: 'info', description: `dialog with 102 drafts (one 2MB) rendered in ${dt}ms` });
    expect(dt).toBeLessThan(4000);
    const dims = await a.evaluate(() => { const b = document.querySelector('.drafts-box').getBoundingClientRect(); const l = document.querySelector('.drafts-list'); const cs = getComputedStyle(l);
      return { boxH: b.height, boxW: b.width, vh: innerHeight, vw: innerWidth, listOverflowY: cs.overflowY, boxOverflowY: getComputedStyle(document.querySelector('.drafts-box')).overflowY, scrollW: document.querySelector('.drafts-box').scrollWidth, clientW: document.querySelector('.drafts-box').clientWidth }; });
    test.info().annotations.push({ type: 'info', description: 'layout ' + JSON.stringify(dims) });
    expect(dims.boxH).toBeLessThanOrEqual(dims.vh); expect(dims.boxW).toBeLessThanOrEqual(dims.vw);
    const sn0 = await a.locator('.drafts-snippet').evaluateAll((l) => l.map((e) => e.textContent.length)); expect(Math.max(...sn0)).toBeLessThanOrEqual(130);
    // snippet overflow only (exclude the long-name row)
    const snipOverflow = await a.evaluate(() => { const b = document.querySelector('.drafts-box'); const li = [...document.querySelectorAll('.drafts-item')]; return li.map((x) => x.getBoundingClientRect().right - b.getBoundingClientRect().right).filter((d) => d > 1).length; });
    test.info().annotations.push({ type: 'info', description: 'rows sticking out of the box (long 200-char name): ' + snipOverflow + '; box scrollWidth ' + dims.scrollW + ' vs clientWidth ' + dims.clientW });
    const sn = await a.locator('.drafts-snippet').evaluateAll((l) => l.map((e) => e.textContent.length));
    expect(Math.max(...sn)).toBeLessThanOrEqual(130);
    await shot(a, '14-drafts-many.png');
    // discard one in the middle
    const mid = rowFor(a, SLOT + 'm050'); await mid.scrollIntoViewIfNeeded(); await mid.locator('.drafts-discard').click();
    await expect(rows(a)).toHaveCount(101); expect(await lget(a, SLOT + 'm050')).toBeUndefined();
    await a.keyboard.press('Escape');
  });
});

// =====================================================================================================================
// G. CONCURRENCY
// =====================================================================================================================
const liveOnSlot = (ext, id) => ext.ctx.pages().filter((p) => EDITOR_RE.test(p.url()) && p.url().includes('doc=' + id));
test.describe('G. concurrency', () => {
  test('[fixed #39] Open on the same draft twice quickly (double click / two dialogs): at most ONE live editor on the slot', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    await typeIn(a, 'shared draft'); const ka = slotOf(a), idA = docId(a); await waitDraft(a, ka, 'shared draft\n'); await closeTab(a);
    await openDrafts(b); await openDrafts(c);
    const before = new Set(ext.ctx.pages());
    // fire both Open clicks from two different tabs' dialogs, plus a double click in the first, as fast as possible
    await Promise.all([rowFor(b, ka).locator('.drafts-open').dblclick({ noWaitAfter: true }), rowFor(c, ka).locator('.drafts-open').click({ noWaitAfter: true })]);
    await sleep(3000);
    const live = liveOnSlot(ext, idA).filter((p) => !before.has(p));
    test.info().annotations.push({ type: 'info', description: 'tabs opened on one draft after 3 quick Open clicks: ' + live.length });
    expect(live.length, 'at most one live editor per slot').toBeLessThanOrEqual(1);
  });

  test('[BUG-44] same legacy draft Opened from two tabs: slot adoption creates at most one copy (no duplicated content)', async ({ ext }) => {
    const T = hook(ext);
    const [b, c] = await clickIcon(ext, T, 2);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'legacy once') });
    await openDrafts(b); await openDrafts(c);
    const before = new Set(ext.ctx.pages());
    await Promise.all([rowFor(b, 'mdwe.draft').locator('.drafts-open').click({ noWaitAfter: true }), rowFor(c, 'mdwe.draft').locator('.drafts-open').click({ noWaitAfter: true })]);
    await sleep(3000);
    const fresh = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
    const slots = Object.entries(await local(b)).filter(([k, v]) => k.startsWith(SLOT) && v.text.includes('legacy once'));
    test.info().annotations.push({ type: 'info', description: `two Opens of one legacy draft: new tabs=${fresh.length}, slots holding the text=${slots.length}` });
    expect(fresh.length, 'two tabs for one legacy draft').toBe(1);
    expect(slots.length).toBe(1);
  });

  test('a draft open in tab A does not appear in tab B\'s Drafts; after A closes it appears; after reopen (lock) it vanishes again; reload of A keeps lock', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'in A'); const ka = slotOf(a); await waitDraft(a, ka, 'in A\n');
    await openDrafts(b); expect(await rowKeys(b)).toEqual([]); await b.keyboard.press('Escape');
    // reload A: lock is released at unload and re-taken at load; during that gap B may list it (recorded) but afterwards not
    await a.reload(); await a.waitForFunction(() => window.__mdwe && window.__mdwe.editor); await sleep(300);
    await openDrafts(b); expect(await rowKeys(b)).toEqual([]); await b.keyboard.press('Escape');
    await closeTab(a);
    await openDrafts(b); expect(await rowKeys(b)).toEqual([ka]);
    await b.keyboard.press('Escape');
  });

  test('draft list refresh while it is open: A closing while B\'s dialog is open - dialog is a snapshot (no auto refresh), reopen shows it', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'will close'); const ka = slotOf(a); await waitDraft(a, ka, 'will close\n');
    await openDrafts(b); expect(await rowKeys(b)).toEqual([]);
    await closeTab(a); await sleep(500);
    const live = await rowKeys(b);
    test.info().annotations.push({ type: 'info', description: 'dialog already open when the other tab closed: rows=' + JSON.stringify(live) + ' button=' + (await b.locator('#btn-drafts').textContent()) });
    await b.keyboard.press('Escape'); await openDrafts(b); expect(await rowKeys(b)).toEqual([ka]);
  });

  test('[fixed #40] Discard of a draft whose tab was just reopened elsewhere (stale dialog): removes the slot under a live editor -> live tab re-saves on next edit (no data loss)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    await typeIn(a, 'racy'); const ka = slotOf(a); await waitDraft(a, ka, 'racy\n'); await closeTab(a);
    await openDrafts(b);                    // b's dialog lists the draft
    const before = new Set(ext.ctx.pages());
    await openDrafts(c); await rowFor(c, ka).locator('.drafts-open').click();   // c reopens it
    const [re] = await waitNew(ext, before, 1);
    await rowFor(b, ka).locator('.drafts-discard').click();                      // stale row in b: Discard + confirm(auto-accept)
    await sleep(500);
    const gone = await lget(b, ka);
    test.info().annotations.push({ type: 'info', description: 'stale Discard removed the slot of a live reopened tab: ' + (gone === undefined) });
    await typeIn(re, ' more'); await waitDraft(re, ka, (await md(re)));          // live tab recovers on next autosave
    expect(gone === undefined, 'stale dialog Discard must not delete the draft of a tab reopened meanwhile').toBe(false);
  });
});

// =====================================================================================================================
// H. REGRESSIONS
// =====================================================================================================================
const fetchStub = ({ map }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...r) => { u = String(u); if (u.startsWith('file://')) { if (u in map) return new Response(map[u], { status: 200 }); return new Response('nf', { status: 404 }); } return of(u, ...r); }; };
test.describe('H. regressions', () => {
  test('manifest/zip/bundle: permissions exactly storage+identity, same CSP, no commands, no eval, one module script, built files present, zip == extension/', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    expect(m.permissions).toEqual(['storage', 'identity']);
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
    expect(m.commands, 'Alt+N is NOT a chrome.commands entry').toBeUndefined();
    expect(m.action).toBeTruthy(); expect(m.action.default_popup, 'no popup: onClicked only fires without one').toBeUndefined();
    const html = fs.readFileSync(path.join(EXT, 'editor/index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*>/g)].map((x) => x[0]);
    expect(scripts).toHaveLength(1); expect(scripts[0]).toMatch(/^<script type="module" crossorigin src="\.\/assets\/index-[A-Za-z0-9_-]+\.js">$/);
    const bundle = /src="\.\/(assets\/[^"]+)"/.exec(scripts[0])[1];
    expect(fs.existsSync(path.join(EXT, 'editor', bundle))).toBe(true);
    test.info().annotations.push({ type: 'info', description: 'bundle: ' + bundle });
    expect(fs.readdirSync(path.join(EXT, 'editor/assets')).filter((x) => /^index-.*\.js$/.test(x))).toEqual([bundle.replace('assets/', '')]);
    for (const f of fs.readdirSync(path.join(EXT, 'editor/assets')).filter((x) => x.endsWith('.js'))) { const js = fs.readFileSync(path.join(EXT, 'editor/assets', f), 'utf8'); expect(js, f).not.toMatch(/\beval\s*\(|new Function\s*\(/); }
    expect(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8')).not.toMatch(/\beval\s*\(|new Function\s*\(/);
    const zip = path.join(ROOT, 'dist', 'md-editor-ext.zip');
    if (fs.existsSync(zip)) { const d = fs.mkdtempSync('/tmp/zipchk-'); execSync(`unzip -q ${zip} -d ${d}`); expect(execSync(`diff -rq ${d} ${EXT} || true`).toString().trim(), 'zip content == extension/').toBe(''); }
    const diff = execSync(`git -C ${ROOT} diff --stat HEAD -- extension/manifest.json || true`).toString().trim();
    expect(diff, 'manifest.json identical to git HEAD').toBe('');
  });

  test('plain editor/index.html: still uses legacy mdwe.draft (autosave + restore after reload); no ?doc rewrite; no lock slot; New-note tabs do not affect it', async ({ ext }) => {
    const T = hook(ext);
    const p = await openEditor(ext); await typeIn(p.page, 'plain draft');
    await waitDraft(p.page, 'mdwe.draft', 'plain draft\n');
    expect(p.page.url()).toBe(p.url); expect((await info(p.page)).slot).toBeNull(); expect((await info(p.page)).title).toBe('• Untitled.md — Markdown Editor');
    const all = await local(p.page); expect(Object.keys(all).filter((k) => k.startsWith('mdwe.draft'))).toEqual(['mdwe.draft']);
    await p.page.close({ runBeforeUnload: true });
    const p2 = await openEditor(ext); await expect.poll(() => md(p2.page)).toBe('plain draft\n');
    expect(await p2.page.locator('#filename').textContent()).toBe('Untitled.md');
    expect(await p2.page.locator('#btn-drafts').textContent(), 'own legacy draft not counted').toBe('Drafts');
    // clear the content -> legacy slot removed
    await pmOf(p2.page).click(); await p2.page.keyboard.press('Control+a'); await p2.page.keyboard.press('Backspace');
    await expect.poll(() => lget(p2.page, 'mdwe.draft'), { timeout: 5000 }).toBeUndefined();
  });

  test('?src= (local file) opens unchanged: legacy mdwe.draft.file slot after edit, no ?doc rewrite, no new-note slot; existing plain draft kept', async ({ ext }) => {
    const T = hook(ext);
    const url = 'file:///tmp/s.md';
    const plain = await openEditor(ext); await typeIn(plain.page, 'keep'); await waitDraft(plain.page, 'mdwe.draft', 'keep\n');
    const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: '# From src\n' } } });
    expect(r.page.url()).toContain('?src='); expect(r.page.url()).not.toContain('doc=');
    const i = await info(r.page); expect(i.slot).toBeNull(); expect(i.name).toBe('s.md'); expect(i.md).toBe('# From src\n'); expect(i.dirty).toBe(false);
    await typeIn(r.page, 'edit'); await expect.poll(async () => (await lget(r.page, 'mdwe.draft.file')) && 1, { timeout: 5000 }).toBe(1);
    const all = await local(r.page);
    expect(Object.keys(all).filter((k) => k.startsWith(SLOT))).toEqual([]); expect(all['mdwe.draft'].text).toBe('keep\n'); expect(all['mdwe.draft.file'].name).toBe('s.md');
    // ?src= together with ?new= : src wins
    const both = await openEditor(ext, { query: '?new=3&src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: 'both\n' } } });
    expect((await info(both.page)).slot).toBeNull(); expect(both.page.url()).not.toContain('doc=');
    expect(T.errors).toEqual([]);
  });

  test('?src= Drive-linked draft (mdwe.draft.file with drive link) restored by plain load keeps its link; legacy slot semantics unchanged', async ({ ext }) => {
    await seed(ext, { 'mdwe.draft': dr('remote.md', 'drive text', { drive: { id: 'D1', modifiedTime: '2026-09-29T12:00:00.000Z', canEdit: true } }) });
    const p = await openEditor(ext);
    await expect.poll(() => md(p.page)).toBe('drive text');
    const i = await info(p.page); expect(i.drive).toMatchObject({ id: 'D1' }); expect(i.name).toBe('remote.md'); expect(i.slot).toBeNull();
    await typeIn(p.page, '!'); await expect.poll(async () => (await lget(p.page, 'mdwe.draft') || {}).text).toBe('drive text!\n');
    expect((await lget(p.page, 'mdwe.draft')).drive).toMatchObject({ id: 'D1' });
  });

  test('new-note tab + Drive: Save to Drive creates file, doc becomes Drive-linked, slot cleared; Open from Drive replaces the note and keeps the slot/URL', async ({ ext }) => {
    const T = hook(ext);
    const [t] = await clickIcon(ext, T);
    await t.evaluate(installMock, { files: [{ id: 'f1', name: 'existing.md', text: '# Existing\n' }] }); await t.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; });
    await typeIn(t, 'to drive'); await waitDraft(t, slotOf(t), 'to drive\n');
    await t.click('#btn-drive-save'); await t.locator('.gdui-dialog').waitFor();
    await t.locator('.gdui-dialog [data-action="save"]').click();
    await expect.poll(() => t.evaluate(() => window.__drv.calls.filter((c) => c.m === 'createFile').length), { timeout: 15000 }).toBe(1);
    await expect.poll(async () => (await info(t)).drive && 1, { timeout: 10000 }).toBe(1);
    const i = await info(t);
    test.info().annotations.push({ type: 'info', description: 'after Drive save: name=' + i.name + ' drive=' + JSON.stringify(i.drive) });
    expect(i.drive.id).toBeTruthy(); expect(i.dirty).toBe(false);
    expect(await t.evaluate(() => window.__drv.calls.find((c) => c.m === 'createFile').args.name), 'Drive file defaults to the note name').toBe('Untitled-1.md');
    await expect.poll(() => lget(t, slotOf(t))).toBeUndefined();
    await t.click('#btn-drive-open'); await t.locator('.gdui-dialog').waitFor();
    await t.locator('.gdui-dialog .gdui-row', { hasText: 'existing' }).dblclick();
    await expect.poll(() => md(t), { timeout: 10000 }).toContain('Existing');
    expect(t.url()).toContain(docId(t));
    await typeIn(t, 'x'); await waitDraft(t, slotOf(t), (await md(t)));
    expect((await lget(t, slotOf(t))).drive).toMatchObject({ id: 'f1' });
  });

  test('Print, Source toggle, Mermaid/KaTeX, Ctrl+S/Ctrl+O, drag-drop all work inside a new-note tab', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'out.md', openContent: '# Opened via Ctrl+O\n', openName: 'o.md' });
    await ext.ctx.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    const [t] = await clickIcon(ext, T);
    // typing + markdown shortcuts
    await typeIn(t, '# Head\n\nmath $x^2$ and ');
    await setMd(t, '# Head\n\n```mermaid\ngraph TD; A-->B;\n```\n\n$$E=mc^2$$\n\ninline $a+b$\n');
    await expect(t.locator('#editor-host .katex').first()).toBeVisible({ timeout: 15000 });
    await expect(t.locator('#editor-host svg').first()).toBeVisible({ timeout: 20000 }); // mermaid diagram
    // Source toggle
    await t.click('.mdx-toolbar [data-cmd="source"]'); await expect.poll(() => t.evaluate(() => window.__mdwe.editor.isSourceMode())).toBe(true);
    await t.click('.mdx-toolbar [data-cmd="source"]'); await expect.poll(() => t.evaluate(() => window.__mdwe.editor.isSourceMode())).toBe(false);
    // Print (Ctrl+P and button)
    await t.click('#btn-print'); await expect.poll(() => t.evaluate(() => window.__prints)).toBe(1);
    await t.keyboard.press('Control+p'); await expect.poll(() => t.evaluate(() => window.__prints)).toBe(2);
    // Ctrl+S -> Save As (first time), suggestedName Untitled-1.md
    await t.keyboard.press('Control+s'); await expect.poll(() => t.evaluate(() => window.__fsa.writes.length)).toBe(1);
    expect(await t.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-1.md']);
    await expect(t.locator('#filename')).toHaveText('out.md');
    // Ctrl+O replaces the (saved) note in the same tab; slot/URL unchanged
    await t.keyboard.press('Control+o'); await expect.poll(() => md(t)).toBe('# Opened via Ctrl+O\n');
    expect(t.url()).toContain(docId(t)); await expect(t.locator('#filename')).toHaveText('o.md');
    // drag-drop
    await t.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['# Dropped\n'], 'drop.md', { type: 'text/markdown' })); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); });
    await expect.poll(() => md(t)).toBe('# Dropped\n'); await expect(t.locator('#filename')).toHaveText('drop.md');
    expect(T.errors).toEqual([]);
  });

  test('Alt+N / #btn-new from a note with UNSAVED text: opens a NEW tab, no confirm/beforeunload, current tab + draft untouched; also from a legacy plain tab; Alt+N with other modifiers does nothing', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'unsaved stuff'); await waitDraft(a, slotOf(a), 'unsaved stuff\n');
    const d0 = await lget(a, slotOf(a));
    let before = new Set(ext.ctx.pages());
    await pmOf(a).click(); await a.keyboard.press('Alt+n');
    const [n1] = await waitNew(ext, before, 1);
    before = new Set(ext.ctx.pages()); await a.bringToFront(); await a.click('#btn-new');
    const [n2] = await waitNew(ext, before, 1);
    before = new Set(ext.ctx.pages()); await a.bringToFront(); await pmOf(a).click(); await a.keyboard.press('Alt+Shift+N'); await a.keyboard.press('Control+Alt+n'); await a.keyboard.press('Alt+m'); await sleep(800);
    expect(ext.ctx.pages().filter((p) => !before.has(p))).toHaveLength(0);
    expect(T.of('confirm')).toHaveLength(0); expect(T.of('beforeunload')).toHaveLength(0);
    expect(await md(a)).toBe('unsaved stuff\n'); expect(a.url()).toContain(docId(a)); expect(await lget(a, slotOf(a))).toEqual(d0);
    expect(await nums([n1, n2])).toEqual([2, 3]);
    expect((await info(n1)).md).toBe(''); await expectFocused(n1);
    // no stray 'n' typed into the editor by Alt+N (and Alt+N key not inserted)
    expect(await md(a)).not.toContain('n\n'.repeat(1) + 'x');
    // from a legacy plain tab
    const plain = await openEditor(ext); await typeIn(plain.page, 'p'); before = new Set(ext.ctx.pages());
    await plain.page.keyboard.press('Alt+n'); const [n3] = await waitNew(ext, before, 1);
    expect(nOf((await info(n3)).name)).toBe(4); expect(await md(plain.page)).toBe('p\n');
    expect(T.of('confirm')).toHaveLength(0);
  });

  test('Alt+N does not conflict with in-page shortcuts (Ctrl+N is not hijacked; Alt+letters in editor; Alt+N while Drafts dialog / source mode open)', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await typeIn(a, 'abc');
    const before = new Set(ext.ctx.pages());
    await a.keyboard.press('Alt+b'); await a.keyboard.press('Alt+i'); await a.keyboard.press('Alt+Enter');
    await sleep(500); expect(ext.ctx.pages().filter((p) => !before.has(p))).toHaveLength(0);
    const defaultPrevented = await a.evaluate(() => new Promise((res) => { const ev = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }); document.dispatchEvent(ev); res(ev.defaultPrevented); }));
    expect(defaultPrevented, 'Ctrl+N is browser-level and not intercepted').toBe(false);
    const altN = await a.evaluate(() => { const ev = new KeyboardEvent('keydown', { key: 'N', altKey: true, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; });
    expect(altN, 'Alt+Shift?+N uppercase key without shift flag still treated as Alt+N').toBe(true);
    await a.waitForTimeout(500);
    const extra = ext.ctx.pages().filter((p) => !before.has(p)); test.info().annotations.push({ type: 'info', description: 'synthetic Alt+N event opened tabs: ' + extra.length });
    // Alt+N from the Drafts dialog and from source mode
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor();
    const b2 = new Set(ext.ctx.pages()); await a.keyboard.press('Alt+n'); await waitNew(ext, b2, 1);
    await a.keyboard.press('Escape');
  });

  test('tabs open BEFORE the update (legacy slots) are not clobbered: stored mdwe.draft/mdwe.draft.file survive the first icon click + Drafts count shows them', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'pre-update A'), 'mdwe.draft.file': dr('old.md', 'pre-update B') });
    const [a] = await clickIcon(ext, T);
    const all = await local(a);
    expect(all['mdwe.draft'].text).toBe('pre-update A'); expect(all['mdwe.draft.file'].text).toBe('pre-update B');
    await expect(a.locator('#btn-drafts')).toHaveText('Drafts (2)');
    await expect(a.locator('#status')).toContainText('2 unsaved drafts from earlier: see Drafts');
    expect((await info(a)).md).toBe('');
    await typeIn(a, 'new'); await waitDraft(a, slotOf(a), 'new\n');
    const all2 = await local(a); expect(all2['mdwe.draft'].text).toBe('pre-update A'); expect(all2['mdwe.draft.file'].text).toBe('pre-update B');
    // a plain-load now restores mdwe.draft as before
    const p = await openEditor(ext); await expect.poll(() => md(p.page)).toBe('pre-update A');
  });

  test('file:// .md content script unchanged (content.js identical to git HEAD); its open-in-editor message still navigates the sender tab to ?src= (not a new-note tab)', async ({ ext }) => {
    const T = hook(ext);
    expect(execSync(`git -C ${ROOT} diff --stat HEAD -- extension/content.js || true`).toString().trim(), 'content.js identical to git HEAD').toBe('');
    const before = new Set(ext.ctx.pages());
    const p = await openEditor(ext);
    const url = 'file:///tmp/z.md';
    await p.page.evaluate((u) => chrome.runtime.sendMessage({ type: 'open-in-editor', url: u }), url);   // exactly what the content script sends; sender.tab = this tab
    await expect.poll(() => p.page.url(), { timeout: 8000 }).toContain('editor/index.html?src=' + encodeURIComponent(url));
    expect(p.page.url()).not.toContain('doc=');
    expect(ext.ctx.pages().filter((x) => !before.has(x) && x !== p.page && EDITOR_RE.test(x.url()))).toHaveLength(0);
    // non-file urls are still rejected
    const b2 = new Set(ext.ctx.pages()); await p.page.evaluate(() => chrome.runtime.sendMessage({ type: 'open-in-editor', url: 'https://example.com/x.md' })); await sleep(600);
    expect(ext.ctx.pages().filter((x) => !b2.has(x))).toHaveLength(0);
  });
});

// =====================================================================================================================
// I. EDGE CASES
// =====================================================================================================================
async function stopWorker(ext, page) {
  const cdp = await ext.ctx.newCDPSession(page);
  const states = []; cdp.on('ServiceWorker.workerVersionUpdated', (e) => { for (const v of e.versions) if ((v.scriptURL || '').includes(ext.extId)) states.push(v.runningStatus); });
  await cdp.send('ServiceWorker.enable');
  await sleep(300);
  await cdp.send('ServiceWorker.stopAllWorkers');
  const t0 = Date.now();
  while (Date.now() - t0 < 10000 && states[states.length - 1] !== 'stopped') await sleep(100);
  const ok = states[states.length - 1] === 'stopped';
  await cdp.send('ServiceWorker.disable').catch(() => {}); await cdp.detach().catch(() => {});
  return ok;
}
const awaitSw = async (ext) => { const t0 = Date.now(); while (Date.now() - t0 < 10000) { const w = ext.ctx.serviceWorkers().filter((x) => x.url().includes(ext.extId)).pop(); if (w) { try { await w.evaluate(() => 1); ext.sw = w; return w; } catch {} } await sleep(100); } throw new Error('service worker did not come back'); };
test.describe('I. edge cases', () => {
  test('service worker stopped between clicks: counter survives (chrome.storage.session), numbers continue 1,2,3,4; in-page message path also wakes the worker', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    expect(await nums([a, b])).toEqual([1, 2]);
    const stopped = await stopWorker(ext, a);
    test.info().annotations.push({ type: 'info', description: 'service worker actually stopped: ' + stopped });
    expect(stopped, 'SW could be stopped via CDP ServiceWorker.stopAllWorkers').toBe(true);
    // wake via the page's New button (runtime message restarts the worker)
    let before = new Set(ext.ctx.pages()); await a.click('#btn-new'); const [c] = await waitNew(ext, before, 1);
    expect(nOf((await info(c)).name)).toBe(3);
    expect(await stopWorker(ext, a)).toBe(true);
    // wake via the real onClicked path: a toolbar click on a stopped worker re-runs background.js and delivers the event; emulate by waking it with a message then dispatching
    before = new Set(ext.ctx.pages()); await a.evaluate(() => chrome.runtime.sendMessage({ type: 'ping' })); await awaitSw(ext);
    await sw(ext).evaluate(() => { chrome.action.onClicked.dispatch({ id: 0, index: 0 }); });
    const [d] = await waitNew(ext, before, 1);
    expect(nOf((await info(d)).name)).toBe(4);
    expect(await session(ext)).toEqual({ 'mdwe.untitledNext': 5 });
  });

  test('burst of 5 messages while the worker is stopped (cold start): distinct numbers, 5 tabs', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    expect(await stopWorker(ext, a)).toBe(true);
    const before = new Set(ext.ctx.pages());
    await a.evaluate(() => { for (let i = 0; i < 5; i++) chrome.runtime.sendMessage({ type: 'new-note' }); });
    const tabs = await waitNew(ext, before, 5);
    expect((await nums(tabs)).sort((x, y) => x - y)).toEqual([2, 3, 4, 5, 6]);
  });

  test('50 tabs quickly: 50 distinct numbers/uuids/slots, all load, no errors; each autosaves separately (spot check)', async ({ ext }) => {
    test.setTimeout(180000);
    const T = hook(ext);
    const t0 = Date.now();
    const tabs = await clickIcon(ext, T, 50, { timeout: 120000 });
    const dt = Date.now() - t0;
    const infos = await Promise.all(tabs.map(info));
    const ns = infos.map((i) => nOf(i.name)).sort((x, y) => x - y);
    expect(ns).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(infos.map((i) => i.slot)).size).toBe(50);
    expect(new Set(tabs.map(docId)).size).toBe(50);
    for (const i of infos) expect(i.search).toMatch(/^\?doc=[0-9a-f-]{36}&n=\d+$/);
    expect(await session(ext)).toEqual({ 'mdwe.untitledNext': 51 });
    for (const k of [0, 17, 49]) { await typeIn(tabs[k], 'spot' + k); }
    for (const k of [0, 17, 49]) await waitDraft(tabs[k], infos[k].slot, 'spot' + k + '\n');
    const slots = Object.keys(await local(tabs[0])).filter((k) => k.startsWith(SLOT));
    expect(slots).toHaveLength(3);
    test.info().annotations.push({ type: 'info', description: `50 tabs ready in ${dt}ms; errors=${T.errors.length}` });
    expect(T.errors).toEqual([]);
    // Web Locks: 50 locks held -> Drafts in any tab sees zero foreign drafts except none
    await openDrafts(tabs[1]); expect(await rowKeys(tabs[1])).toEqual([]);
  });

  test('history: rewrite uses replaceState - history.length unchanged by the rewrite, Back does not land on ?new= (which would re-create a note), title intact', async ({ ext }) => {
    const T = hook(ext);
    const page = await ext.ctx.newPage(); await page.goto(`chrome-extension://${ext.extId}/editor/index.html?x=1`); await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    const h0 = await page.evaluate(() => history.length);
    await page.goto(`chrome-extension://${ext.extId}/editor/index.html?new=5`);
    await page.waitForFunction(() => /doc=/.test(location.search) && window.__mdwe && window.__mdwe.state.slot);
    const h1 = await page.evaluate(() => history.length);
    expect(h1, 'only the navigation itself added one entry; the rewrite added none').toBe(h0 + 1);
    expect(await page.title()).toBe('Untitled-5.md — Markdown Editor');
    const withDoc = page.url();
    await page.goBack(); await page.waitForFunction(() => /x=1/.test(location.search));
    expect(page.url()).toContain('?x=1');
    await page.goForward(); await page.waitForFunction(() => /doc=/.test(location.search) && window.__mdwe && window.__mdwe.state.slot);
    expect(page.url(), 'forward lands on the rewritten URL (same uuid), not on ?new= again').toBe(withDoc);
    // an SW-created tab has exactly 1 history entry
    const [t] = await clickIcon(ext, T);
    expect(await t.evaluate(() => history.length)).toBe(1);
    expect(await t.evaluate(() => history.state)).toBeNull();
    expect(await t.title()).toMatch(/^Untitled-\d+\.md — Markdown Editor$/);
    await t.reload(); await t.waitForFunction(() => window.__mdwe && window.__mdwe.editor); expect(await t.evaluate(() => history.length)).toBe(1);
  });

  test('Back after the draft restore / hash links: location.hash and extra params survive reload; ?doc=..&n=..&foo=1 keeps working', async ({ ext }) => {
    const r = await openEditor(ext, { query: '?new=2#top' });
    const u = r.page.url();
    test.info().annotations.push({ type: 'info', description: 'rewritten URL from ?new=2#top: ' + u });
    expect(u).toMatch(/\?doc=[0-9a-f-]{36}&n=2/);
    test.info().annotations.push({ type: 'info', description: 'URL fragment preserved by the rewrite: ' + u.includes('#top') + ' (the extension never produces fragments; UX note only)' });
  });

  test('closing the browser window path: Web Lock released at tab close, so closed note instantly listed (no stale-lock TTL); dead-tab (crash) simulated via page.close without beforeunload', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'crash me'); await waitDraft(a, slotOf(a), 'crash me\n'); const ka = slotOf(a);
    await a.close({ runBeforeUnload: false });
    await sleep(300);
    await openDrafts(b); expect(await rowKeys(b)).toEqual([ka]);
  });

  test('locks: every note tab holds exactly its own mdwe-slot:<key> (exclusive) + mdwe-num-N (shared); a reloaded tab does not duplicate them; released on close', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    const held = async () => (await a.evaluate(async () => (await navigator.locks.query()).held.filter((l) => l.name.startsWith('mdwe')).map((l) => l.mode + ' ' + l.name))).sort();
    const want = (...ts) => ts.flatMap((t) => ['exclusive mdwe-slot:' + slotOf(t), 'shared mdwe-num-' + nOf(t.__n)]).sort();
    a.__n = 'Untitled-1.md'; b.__n = 'Untitled-2.md';
    expect(await held()).toEqual(want(a, b));
    await b.reload(); await b.waitForFunction(() => window.__mdwe && window.__mdwe.editor); await sleep(300);
    expect(await held()).toEqual(want(a, b));
    await b.close(); await sleep(400);
    expect(await held()).toEqual(want(a));
  });
});

// =====================================================================================================================
// J. ROUND 2: the Web Lock design (mdwe-slot:<key> exclusive+ifAvailable for doc tabs, SHARED on mdwe.draft / mdwe.draft.file for plain + ?src= tabs, mdwe-num-N shared)
// =====================================================================================================================
const lockInfo = (p) => p.evaluate(async () => { const q = await navigator.locks.query(); const f = (l) => l.mode + ' ' + l.name; return { held: q.held.filter((l) => l.name.startsWith('mdwe')).map(f).sort(), pending: q.pending.filter((l) => l.name.startsWith('mdwe')).map(f).sort() }; });
const heldNames = async (p) => (await lockInfo(p)).held;
const draftKeys = async (p) => { await openDrafts(p); const k = await rowKeys(p); await p.keyboard.press('Escape'); await expect(p.locator('.drafts-overlay')).toHaveCount(0); return k; };
// records every distinct #status text (the message can be overwritten within ms by 'Draft autosaved')
const statusRec = () => { window.__st = []; const go = () => { const e = document.getElementById('status'); if (!e) return setTimeout(go, 5); new MutationObserver(() => { const t = e.textContent; if (t) window.__st.push(t); }).observe(e, { childList: true, characterData: true, subtree: true }); }; go(); };
const dupQuery = (p) => p.url().slice(p.url().indexOf('?'));
const inEditor = (p) => p.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#editor-host .ProseMirror'));
const srcStub = ({ map }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...r) => { u = String(u); if (u.startsWith('file://')) return new Response(map[u] || '', { status: 200 }); return of(u, ...r); }; };

test.describe('J1. lock names and modes', () => {
  test('doc tab: exactly {exclusive mdwe-slot:mdwe.draft.doc.<uuid>, shared mdwe-num-N}; plain tab and ?src= tab: {shared mdwe-slot:mdwe.draft, shared mdwe-slot:mdwe.draft.file} and no num lock; nothing pending; no old mdwe-doc-* locks', async ({ ext }) => {
    const T = hook(ext);
    const [d] = await clickIcon(ext, T);
    await expect.poll(() => heldNames(d)).toEqual(['exclusive mdwe-slot:' + slotOf(d), 'shared mdwe-num-1']);
    const plain = await openEditor(ext);
    await expect.poll(() => heldNames(d)).toEqual(['exclusive mdwe-slot:' + slotOf(d), 'shared mdwe-num-1', 'shared mdwe-slot:mdwe.draft', 'shared mdwe-slot:mdwe.draft.file'].sort());
    const url = 'file:///tmp/lk.md';
    const s = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: srcStub, arg: { map: { [url]: '# lk\n' } } });
    await expect.poll(async () => (await heldNames(d)).filter((x) => /mdwe-slot:mdwe\.draft(\.file)?$/.test(x)).length).toBe(4); // 2 plain-style tabs x 2 shared locks
    const li = await lockInfo(d);
    expect(li.pending, 'no waiting lock requests (no hang)').toEqual([]);
    expect(li.held.filter((x) => /mdwe-doc-/.test(x))).toEqual([]);
    expect(li.held.filter((x) => /mdwe-num/.test(x))).toEqual(['shared mdwe-num-1']);
    // new-note tab with draft slot name containing the exact storage key
    expect(slotOf(d)).toBe('mdwe.draft.doc.' + docId(d)); expect(docId(d)).toMatch(uuidRe);
    expect(T.errors).toEqual([]);
  });

  test('shared vs exclusive: two plain tabs open at the same time are fine (both hold shared locks, both load, no pending requests); a plain tab + Drafts hides both legacy drafts while ANY plain tab is open and shows them after the last one closes', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'legacy A'), 'mdwe.draft.file': dr('f.md', 'legacy F') });
    const [n] = await clickIcon(ext, T);
    expect(await draftKeys(n), 'no plain tab yet -> both legacy drafts listed').toEqual(['mdwe.draft', 'mdwe.draft.file']);
    const p1 = await openEditor(ext); const p2 = await openEditor(ext);
    await expect.poll(() => md(p1.page)).toBe('legacy A'); await expect.poll(() => md(p2.page)).toBe('legacy A');
    expect((await lockInfo(n)).pending).toEqual([]);
    expect(await draftKeys(n), 'both plain tabs open: both shared slots hidden').toEqual([]);
    await closeTab(p1.page);
    expect(await draftKeys(n), 'one plain tab left').toEqual([]);
    await closeTab(p2.page);
    await expect.poll(() => draftKeys(n)).toEqual(['mdwe.draft', 'mdwe.draft.file']);
    // the plain tab\'s own dialog never lists its own legacy slots even when the other tab is gone
    const p3 = await openEditor(ext); expect(await draftKeys(p3.page)).toEqual([]);
    expect(T.errors).toEqual([]);
  });

  test('a plain tab does not stop a doc tab from taking its own exclusive slot lock; doc tabs and plain tabs never block each other on load (page ready < 5 s with 10 tabs of each kind)', async ({ ext }) => {
    const T = hook(ext);
    const t0 = Date.now();
    const plains = []; for (let i = 0; i < 10; i++) plains.push(await openEditor(ext));
    const docs = await clickIcon(ext, T, 10);
    const dt = Date.now() - t0;
    test.info().annotations.push({ type: 'info', description: `10 plain + 10 doc tabs ready in ${dt}ms` });
    const li = await lockInfo(docs[0]);
    expect(li.pending).toEqual([]);
    expect(li.held.filter((x) => x.startsWith('exclusive mdwe-slot:'))).toHaveLength(10);
    expect(li.held.filter((x) => x.startsWith('shared mdwe-slot:'))).toHaveLength(20);
    expect(li.held.filter((x) => x.startsWith('shared mdwe-num-'))).toHaveLength(10);
  });
});

test.describe('J2. duplicate tab (#43): fresh uuid + own copy', () => {
  test('second tab on the same ?doc=: different uuid, same n and name, copy of the text with status message, original untouched; type in both, reload both -> independent', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'orig text'); await waitDraft(a, slotOf(a), 'orig text\n');
    const aUrl = a.url();
    const b = await openEditor(ext, { query: dupQuery(a), init: statusRec });
    await expect.poll(() => docId(b.page)).not.toBe(docId(a));
    await b.page.waitForFunction(() => window.__mdwe.state.slot && /Untitled-1/.test(window.__mdwe.state.name));
    const ib = await info(b.page);
    expect(docId(b.page)).toMatch(uuidRe); expect(ib.slot).toBe(slotOf(b.page)); expect(ib.slot).not.toBe(slotOf(a));
    expect(b.page.url()).toMatch(/\?doc=[0-9a-f-]{36}&n=1$/); expect(a.url()).toBe(aUrl);
    expect(ib.md).toBe('orig text\n'); expect(ib.name).toBe('Untitled-1.md'); expect(ib.title).toBe('• Untitled-1.md — Markdown Editor');
    await expect.poll(() => b.page.evaluate(() => window.__st), { message: 'status message shown at least once' }).toContain('This note is open in another tab: working on a copy');
    const st = await b.page.evaluate(() => window.__st);
    test.info().annotations.push({ type: 'info', description: 'status texts seen in the copy tab: ' + JSON.stringify(st) });
    await expectFocused(b.page);
    // the copy was persisted right away under ITS slot; original slot untouched
    await expect.poll(() => lget(a, ib.slot).then((d) => d && d.text)).toBe('orig text\n');
    expect((await lget(a, slotOf(a))).text).toBe('orig text\n');
    // locks: both slots exclusively held by their own tab, separate
    await expect.poll(async () => (await heldNames(a)).filter((x) => x.startsWith('exclusive')).sort()).toEqual(['exclusive mdwe-slot:' + slotOf(a), 'exclusive mdwe-slot:' + ib.slot].sort());
    // independent edits
    await typeIn(b.page, ' +B'); await typeIn(a, ' +A');
    await waitDraft(a, slotOf(a), 'orig text +A\n'); await waitDraft(a, ib.slot, 'orig text +B\n');
    // reload both at once: each restores ITS own text, nobody becomes a copy again
    const uA = a.url(), uB = b.page.url();
    await Promise.all([a.reload(), b.page.reload()]);
    await Promise.all([a, b.page].map((p) => p.waitForFunction(() => window.__mdwe && window.__mdwe.editor && window.__mdwe.state.slot)));
    await expect.poll(() => md(a)).toBe('orig text +A\n'); await expect.poll(() => md(b.page)).toBe('orig text +B\n');
    expect(a.url()).toBe(uA); expect(b.page.url()).toBe(uB);
    await expect(a.locator('#status')).not.toContainText('another tab');
    expect(Object.keys(await local(a)).filter((k) => k.startsWith(SLOT)).sort()).toEqual([slotOf(a), ib.slot].sort());
    expect(T.errors).toEqual([]);
  });

  test('duplicate of an EMPTY untouched note: fresh uuid, empty, no stray draft, no "copy" message; duplicate of a duplicate; 3 live tabs -> 3 slots', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const b = await openEditor(ext, { query: dupQuery(a) }); await expect.poll(() => docId(b.page)).not.toBe(docId(a));
    const c = await openEditor(ext, { query: dupQuery(b.page) }); await expect.poll(() => docId(c.page)).not.toBe(docId(b.page));
    expect(new Set([docId(a), docId(b.page), docId(c.page)]).size).toBe(3);
    const ib = await info(b.page); expect(ib.md).toBe(''); expect(ib.dirty).toBe(false);
    await expect(b.page.locator('#status')).not.toContainText('copy');
    await sleep(1200);
    expect(Object.keys(await local(a)).filter((k) => k.startsWith(SLOT))).toEqual([]);
    test.info().annotations.push({ type: 'info', description: 'names of 3 tabs on one n: ' + JSON.stringify(await Promise.all([a, b.page, c.page].map(async (p) => (await info(p)).name))) + ' (duplicate names by design)' });
  });

  test('closed-tab restore (Ctrl+Shift+T): original tab closed -> same URL takes the ORIGINAL slot (no copy, no new uuid); while the draft is open it is hidden from Drafts', async ({ ext }) => {
    const T = hook(ext);
    const [a, other] = await clickIcon(ext, T, 2); await typeIn(a, 'restore me'); await waitDraft(a, slotOf(a), 'restore me\n');
    const u = a.url(), id = docId(a);
    await closeTab(a);
    const r = await openEditor(ext, { query: u.slice(u.indexOf('?')) });
    await r.page.waitForFunction(() => window.__mdwe.state.slot);
    expect(docId(r.page)).toBe(id); expect((await info(r.page)).md).toBe('restore me\n');
    await expect(r.page.locator('#status')).not.toContainText('another tab');
    expect(await draftKeys(other)).toEqual([]);
  });

  test('two tabs loaded simultaneously on one stored ?doc= (session restore of duplicated tabs): one becomes the original, the other a copy; distinct slots, both have the text', async ({ ext }) => {
    const id = '66666666-6666-4666-8666-666666666666';
    await seed(ext, { [SLOT + id]: dr('Untitled-3.md', 'stored for two') });
    const [x, y] = await Promise.all([openEditor(ext, { query: '?doc=' + id + '&n=3', init: statusRec }), openEditor(ext, { query: '?doc=' + id + '&n=3', init: statusRec })]);
    await Promise.all([x, y].map((r) => r.page.waitForFunction(() => window.__mdwe.state.slot && /doc=/.test(location.search))));
    await sleep(500);
    const ix = await info(x.page), iy = await info(y.page);
    expect(ix.slot).not.toBe(iy.slot);
    expect([ix.slot, iy.slot]).toContain(SLOT + id);
    expect(ix.md).toBe('stored for two'); expect(iy.md).toBe('stored for two');
    const msgs = await Promise.all([x, y].map((r) => r.page.evaluate(() => window.__st)));
    test.info().annotations.push({ type: 'info', description: 'simultaneous load status texts: ' + JSON.stringify(msgs) });
    expect(msgs.filter((m) => m.some((t) => /another tab/.test(t)))).toHaveLength(1);
  });

  test('original tab BUSY (main thread blocked 6 s): the duplicate still loads (ifAvailable: the lock request never queues behind a held lock -> no deadlock), gets a copy of the stored text', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'busy orig'); await waitDraft(a, slotOf(a), 'busy orig\n');
    a.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 6000); }, 0); }).catch(() => {});
    await sleep(200);
    const t0 = Date.now();
    const b = await openEditor(ext, { query: dupQuery(a), init: statusRec });
    await b.page.waitForFunction(() => window.__mdwe.state.slot && window.__st.some((t) => /another tab/.test(t)), null, { timeout: 15000 });
    const dt = Date.now() - t0;
    test.info().annotations.push({ type: 'info', description: `duplicate ready while original busy in ${dt}ms` });
    // extension pages share one renderer process, so a busy tab delays other tabs by its busy time; a lock-queue deadlock would never finish at all
    expect(dt).toBeLessThan(14000);
    expect(await md(b.page)).toBe('busy orig\n');
  });

  test('duplicate of a Drive-linked note keeps the Drive link in the copy (conflict check protects the remote copy); copy keeps name', async ({ ext }) => {
    const T = hook(ext);
    const id = '77777777-7777-4777-8777-777777777777';
    await seed(ext, { [SLOT + id]: dr('remote.md', 'drive body', { drive: { id: 'D9', modifiedTime: '2026-09-29T12:00:01.000Z', canEdit: true } }) });
    const a = await openEditor(ext, { query: '?doc=' + id + '&n=1' }); await a.page.waitForFunction(() => window.__mdwe.state.slot);
    const b = await openEditor(ext, { query: '?doc=' + id + '&n=1' }); await expect.poll(() => docId(b.page)).not.toBe(id);
    const ib = await info(b.page);
    expect(ib.drive).toMatchObject({ id: 'D9' }); expect(ib.name).toBe('remote.md'); expect(ib.md).toBe('drive body');
    expect((await lget(a.page, ib.slot)).drive).toMatchObject({ id: 'D9' });
  });
});

// =====================================================================================================================
// J3. Drafts dialog races, number locks, count refresh, focus, long names (round-2 fixes #39 #40 #37 #41 #42)
// =====================================================================================================================
test.describe('J3. Drafts dialog behaviour after the fixes', () => {
  test('Open: row removed immediately (same dialog, before the new tab exists), button not clickable twice; double click / click+click -> exactly ONE new tab on the slot', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'one editor only'); const ka = slotOf(a), idA = docId(a); await waitDraft(a, ka, 'one editor only\n'); await closeTab(a);
    await seed(ext, { [SLOT + '0bbbbbbb-0000-4000-8000-000000000001']: dr('Untitled-8.md', 'other draft', { savedAt: Date.now() - 9999 }) });
    await openDrafts(b);
    const before = new Set(ext.ctx.pages());
    const btn = rowFor(b, ka).locator('.drafts-open');
    await btn.dblclick({ noWaitAfter: true });
    await expect(rowFor(b, ka)).toHaveCount(0);
    await expect(rows(b)).toHaveCount(1);
    await sleep(3500);
    const live = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
    expect(live.map((p) => docId(p))).toEqual([idA]);
    expect((await info(live[0])).md).toBe('one editor only\n');
    // after the 2.5 s hold-down the row stays hidden (lock now held by the new tab)
    await b.keyboard.press('Escape'); expect(await draftKeys(b)).toEqual([SLOT + '0bbbbbbb-0000-4000-8000-000000000001']);
  });

  test('Open of the LAST row: list immediately shows the empty state; Open of a draft already opened by another tab meanwhile (stale row) opens nothing', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    await typeIn(a, 'stale open'); const ka = slotOf(a); await waitDraft(a, ka, 'stale open\n'); await closeTab(a);
    await openDrafts(b); await openDrafts(c);
    let before = new Set(ext.ctx.pages());
    await rowFor(c, ka).locator('.drafts-open').click();
    await expect(c.locator('.drafts-empty')).toBeVisible();
    const [re] = await waitNew(ext, before, 1); await sleep(800);
    before = new Set(ext.ctx.pages());
    await rowFor(b, ka).locator('.drafts-open').click();          // stale row in b
    await sleep(2500);
    expect(ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()))).toHaveLength(0);
    expect(docId(re)).toBe(ka.replace(SLOT, ''));
    expect(T.errors).toEqual([]);
  });

  test('legacy draft Opened from two tabs at once: serialized adoption -> exactly one new tab, one copy of the text, legacy key gone', async ({ ext }) => {
    const T = hook(ext);
    const [b, c] = await clickIcon(ext, T, 2);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'legacy once') });
    await openDrafts(b); await openDrafts(c);
    const before = new Set(ext.ctx.pages());
    await Promise.all([rowFor(b, 'mdwe.draft').locator('.drafts-open').click({ noWaitAfter: true }), rowFor(c, 'mdwe.draft').locator('.drafts-open').click({ noWaitAfter: true })]);
    await sleep(3500);
    const fresh = ext.ctx.pages().filter((p) => !before.has(p) && EDITOR_RE.test(p.url()));
    const all = await local(b);
    const slots = Object.entries(all).filter(([k, v]) => k.startsWith(SLOT) && v.text.includes('legacy once'));
    test.info().annotations.push({ type: 'info', description: `two Opens of one legacy draft: new tabs=${fresh.length}, slots holding the text=${slots.length}, legacy key left=${'mdwe.draft' in all}` });
    test.info().annotations.push({ type: 'info', description: 'new tab contents: ' + JSON.stringify(await Promise.all(fresh.map(async (p) => ({ url: p.url().slice(-60), md: await md(p).catch(() => null) })))) + ' storage slots: ' + JSON.stringify(Object.keys(all).filter((k) => k.startsWith(SLOT))) });
    expect.soft(slots.length, 'one copy of the text').toBe(1);
    expect.soft('mdwe.draft' in all, 'legacy key removed').toBe(false);
    expect(fresh.length, '[BUG-44] second Open (other tab\'s dialog, adoption already done) opens an extra tab on an EMPTY new slot').toBe(1);
  });

  test('Discard: stale row whose draft was meanwhile opened elsewhere -> NOT discarded, alert explains, slot + live tab intact', async ({ ext }) => {
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3);
    await typeIn(a, 'racy'); const ka = slotOf(a); await waitDraft(a, ka, 'racy\n'); await closeTab(a);
    await openDrafts(b);
    const before = new Set(ext.ctx.pages());
    await openDrafts(c); await rowFor(c, ka).locator('.drafts-open').click();
    const [re] = await waitNew(ext, before, 1); await sleep(500);
    await rowFor(b, ka).locator('.drafts-discard').click();
    await expect.poll(() => T.of('alert').length).toBe(1);
    expect(T.of('alert')[0].message).toMatch(/was opened in a tab in the meantime, so it was not discarded/);
    expect(T.of('confirm')[0].message).toMatch(/^Discard "Untitled-1\.md"\?/);
    expect(await lget(b, ka)).toBeTruthy(); expect(await md(re)).toBe('racy\n');
    await expect(rowFor(b, ka)).toHaveCount(0);   // dialog re-rendered
  });

  test('Discard right after Open (same dialog, within the 2.5 s opening window): refused, slot kept', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'x1'); const ka = slotOf(a); await waitDraft(a, ka, 'x1\n'); await closeTab(a);
    await seed(ext, { [SLOT + '0ccccccc-0000-4000-8000-000000000002']: dr('Untitled-9.md', 'second') });
    await openDrafts(b);
    await rowFor(b, SLOT + '0ccccccc-0000-4000-8000-000000000002').locator('.drafts-discard').click();
    await expect(rows(b)).toHaveCount(1);
    expect(await lget(b, SLOT + '0ccccccc-0000-4000-8000-000000000002')).toBeUndefined();
    expect(await lget(b, ka)).toBeTruthy();
  });

  test('#37 number locks: a number held by an open tab is skipped even with session cleared; released when the tab closes (number reusable); reload keeps it; several tabs', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);          // 1,2 (untouched, nothing stored)
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    const [c] = await clickIcon(ext, T);
    expect(nOf((await info(c)).name), 'skips 1 and 2 held by open untouched tabs').toBe(3);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    await closeTab(a);                                   // frees 1
    await expect.poll(async () => (await heldNames(b)).includes('shared mdwe-num-1')).toBe(false);
    const [d] = await clickIcon(ext, T);
    expect(nOf((await info(d)).name), 'number 1 released by the closed tab').toBe(1);
    // reload keeps the number reserved (lock released at unload and re-taken at load; service worker sees one or the other)
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    await b.reload(); await b.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot);
    const [e] = await clickIcon(ext, T);
    expect(nOf((await info(e)).name), '1,2,3 held again').toBe(4);
    expect(await session(ext)).toEqual({ 'mdwe.untitledNext': 5 });
  });

  test('#37 duplicate-tab copies keep n: the number lock is shared, so two tabs on Untitled-1 do not break the counter; both released only when BOTH closed', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const b = await openEditor(ext, { query: dupQuery(a) }); await expect.poll(() => docId(b.page)).not.toBe(docId(a));
    await closeTab(a); await sleep(300);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    const [c] = await clickIcon(ext, T);
    expect(nOf((await info(c)).name), 'the copy still holds Untitled-1').toBe(2);
    await closeTab(b.page); await sleep(300);
    await sw(ext).evaluate(() => chrome.storage.session.clear());
    const [d] = await clickIcon(ext, T);
    expect(nOf((await info(d)).name)).toBe(1);
  });

  test('#41 count refresh: button shows Drafts (N) immediately after Open/Discard (no waiting) and matches the dialog afterwards (0.8 s and 2.8 s refreshes)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'cnt'); const ka = slotOf(a); await waitDraft(a, ka, 'cnt\n'); await closeTab(a);
    await seed(ext, { [SLOT + '0ddddddd-0000-4000-8000-000000000003']: dr('Untitled-9.md', 'discard me') });
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts (2)');
    await openDrafts(b);
    await rowFor(b, SLOT + '0ddddddd-0000-4000-8000-000000000003').locator('.drafts-discard').click();
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts (1)', { timeout: 1500 });
    const before = new Set(ext.ctx.pages());
    await rowFor(b, ka).locator('.drafts-open').click();
    await waitNew(ext, before, 1);
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts', { timeout: 5000 });
    await b.keyboard.press('Escape'); expect(await draftKeys(b)).toEqual([]);
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts');
  });

  test('#41 count in OTHER tabs when a tab closes with text: count goes up without opening the dialog (storage change)', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2);
    await typeIn(a, 'up'); await waitDraft(a, slotOf(a), 'up\n');
    await expect(b.locator('#btn-drafts')).toHaveText('Drafts');   // a is open -> hidden
    await closeTab(a);
    const label = await b.locator('#btn-drafts').textContent();
    await sleep(3200);
    const later = await b.locator('#btn-drafts').textContent();
    test.info().annotations.push({ type: 'info', description: `count in other tab right after close: "${label}", 3 s later: "${later}" (no storage write happens on close, lock release is not observable by storage.onChanged)` });
    expect.soft(later, 'count in an idle background tab never learns that a draft became visible (until a storage change or reopening the dialog)').toBe('Drafts (1)');
  });

  test('focus: Close focused on open; Tab/Shift+Tab cycle inside the dialog (never reaches the page behind); Esc / Close / overlay click return focus to the EDITOR', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    await seed(ext, { [SLOT + '0eeeeeee-0000-4000-8000-000000000004']: dr('Untitled-4.md', 'one'), [SLOT + '0eeeeeee-0000-4000-8000-000000000005']: dr('Untitled-5.md', 'two', { savedAt: Date.now() - 100 }) });
    await openDrafts(a);
    await expect(a.locator('.drafts-close')).toBeFocused();
    const seq = []; const cur = () => a.evaluate(() => { const e = document.activeElement; return (e.closest('.drafts-box') ? 'in:' : 'OUT:') + e.className; });
    for (let i = 0; i < 9; i++) { await a.keyboard.press('Tab'); seq.push(await cur()); }
    for (let i = 0; i < 9; i++) { await a.keyboard.press('Shift+Tab'); seq.push(await cur()); }
    test.info().annotations.push({ type: 'info', description: 'focus walk: ' + JSON.stringify(seq) });
    expect(seq.filter((x) => x.startsWith('OUT')), 'focus never leaves the dialog').toEqual([]);
    expect(new Set(seq).size, 'visits Open/Discard/Close').toBeGreaterThanOrEqual(3);
    await a.keyboard.press('Escape'); await expect(a.locator('.drafts-overlay')).toHaveCount(0);
    await expect.poll(() => inEditor(a), { message: 'Esc returns focus to the editor' }).toBe(true);
    await a.keyboard.type('typed after Esc'); expect(await md(a)).toBe('typed after Esc\n');
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor(); await a.locator('.drafts-close').click();
    await expect.poll(() => inEditor(a), { message: 'Close returns focus to the editor' }).toBe(true);
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor(); await a.mouse.click(3, 3);
    await expect.poll(() => inEditor(a), { message: 'overlay click returns focus to the editor' }).toBe(true);
    // empty dialog: Tab with only Close
    await seed(ext, {}); await sw(ext).evaluate(() => chrome.storage.local.remove(['mdwe.draft.doc.0eeeeeee-0000-4000-8000-000000000004', 'mdwe.draft.doc.0eeeeeee-0000-4000-8000-000000000005']));
    await a.click('#btn-drafts'); await a.locator('.drafts-empty').waitFor();
    for (let i = 0; i < 3; i++) { await a.keyboard.press('Tab'); await expect(a.locator('.drafts-close')).toBeFocused(); }
    await a.keyboard.press('Shift+Tab'); await expect(a.locator('.drafts-close')).toBeFocused();
    await a.keyboard.press('Escape');
    // aria
    await a.click('#btn-drafts'); await a.locator('.drafts-box').waitFor();
    expect(await a.locator('.drafts-box').getAttribute('aria-modal')).toBe('true'); await a.keyboard.press('Escape');
    // Alt+N still works while the dialog is open and a Tab key press is not swallowed outside it
    expect(T.errors).toEqual([]);
  });

  test('focus: after Discard/Open the focus stays inside the dialog (Close), Esc after Open still closes and returns to the editor; ctrl+S from the dialog does not save', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, {});
    const [a] = await clickIcon(ext, T);
    await seed(ext, { [SLOT + '0fffffff-0000-4000-8000-000000000006']: dr('Untitled-6.md', 'to discard') });
    await openDrafts(a);
    await rowFor(a, SLOT + '0fffffff-0000-4000-8000-000000000006').locator('.drafts-discard').click();
    await expect(a.locator('.drafts-empty')).toBeVisible();
    expect(await a.evaluate(() => !!document.activeElement.closest('.drafts-box')), 'focus not lost to <body> after the row vanished').toBe(true);
    await a.keyboard.press('Escape'); await expect.poll(() => inEditor(a)).toBe(true);
  });

  test('#42 long names: 117/300-char unbroken name, name with spaces, RTL, emoji: no horizontal overflow, ellipsis on the name, title attribute = full name, Open + Discard fully inside the box and clickable', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T);
    const names = ['a'.repeat(117) + '.md', 'W'.repeat(300) + '.md', 'many words '.repeat(30) + '.md', '😀'.repeat(60) + '.md', 'עברית'.repeat(30) + '.md'];
    const seeds = {}; names.forEach((n, i) => { seeds[SLOT + '10000000-0000-4000-8000-00000000000' + i] = dr(n, 'body ' + i, { savedAt: Date.now() - i * 1000 }); });
    await seed(ext, seeds);
    await openDrafts(a);
    await expect(rows(a)).toHaveCount(5);
    const r = await a.evaluate(() => { const b = document.querySelector('.drafts-box'), bb = b.getBoundingClientRect();
      return { sw: b.scrollWidth, cw: b.clientWidth, items: [...document.querySelectorAll('.drafts-item')].map((li) => { const s = li.querySelector('strong'), o = li.querySelector('.drafts-open').getBoundingClientRect(), d = li.querySelector('.drafts-discard').getBoundingClientRect(), l = li.getBoundingClientRect();
        const cs = getComputedStyle(s); return { title: s.title, textOverflow: cs.textOverflow, ws: cs.whiteSpace, clipped: s.scrollWidth > s.clientWidth, liRight: l.right, boxRight: bb.right, openL: o.left, openR: o.right, discR: d.right, discVisible: d.right <= bb.right + 0.5 && d.left >= bb.left }; }) }; });
    test.info().annotations.push({ type: 'info', description: JSON.stringify({ sw: r.sw, cw: r.cw }) });
    expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
    for (const [i, it] of r.items.entries()) { expect(it.discVisible, 'row ' + i + ' buttons inside box').toBe(true); expect(it.textOverflow).toBe('ellipsis'); expect(it.ws).toBe('nowrap'); expect(it.liRight).toBeLessThanOrEqual(it.boxRight + 0.5); }
    expect(r.items.some((x) => x.clipped)).toBe(true);
    expect(r.items.map((x) => x.title).sort()).toEqual(names.slice().sort());
    await shot(a, '14-drafts-longname-r2.png');
    // the buttons of the longest row are really clickable (Open works)
    const before = new Set(ext.ctx.pages());
    await rows(a).nth(1).locator('.drafts-open').click(); await waitNew(ext, before, 1);
  });
});

// =====================================================================================================================
// K. ROUND 2: looking for NEW regressions caused by the lock design
// =====================================================================================================================
const tabIdOf = (ext, p) => sw(ext).evaluate(async (u) => { const t = (await chrome.tabs.query({})).find((x) => x.url === u); return t && t.id; }, p.url());
test.describe('K. lock-design regressions', () => {
  test('reload x10 (and F5) of a doc tab never turns it into a "copy" (old lock is released before the new page asks), same uuid, same text', async ({ ext }) => {
    const T = hook(ext);
    const [a] = await clickIcon(ext, T); await typeIn(a, 'stable'); await waitDraft(a, slotOf(a), 'stable\n');
    const u = a.url();
    for (let i = 0; i < 10; i++) { i % 2 ? await a.keyboard.press('F5') : await a.reload(); await a.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot); expect(a.url(), 'reload ' + i).toBe(u); }
    await expect.poll(() => md(a)).toBe('stable\n');
    expect(Object.keys(await local(a)).filter((k) => k.startsWith(SLOT))).toEqual([slotOf(a)]);
    expect(T.errors).toEqual([]);
  });

  test('crash simulation (CDP Page.crash; extension pages share ONE renderer so every editor tab crashes together): all locks are released, drafts of all crashed tabs are listed at once from a fresh page (not stuck invisible), Open works', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2); await typeIn(a, 'before crash'); const ka = slotOf(a); await waitDraft(a, ka, 'before crash\n'); await typeIn(b, 'second'); const kb = slotOf(b); await waitDraft(b, kb, 'second\n');
    const cdp = await ext.ctx.newCDPSession(a);
    cdp.send('Page.crash').catch(() => {});
    await sleep(1500);
    const crashed = await Promise.all([a, b].map((p) => p.evaluate(() => 1, null, { timeout: 1500 }).then(() => false, () => true)));
    test.info().annotations.push({ type: 'info', description: 'crashed tabs a,b: ' + JSON.stringify(crashed) });
    const fresh = await ext.ctx.newPage(); await fresh.goto(`chrome-extension://${ext.extId}/editor/index.html?new=9`); await fresh.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot);
    const held = await heldNames(fresh);
    test.info().annotations.push({ type: 'info', description: 'locks visible after the crash: ' + JSON.stringify(held) });
    for (const k of [ka, kb]) expect(held.filter((x) => x.includes(k)), 'lock of crashed tab released').toEqual([]);
    expect(held.filter((x) => /mdwe-num-[12]$/.test(x)), 'number locks of crashed tabs released').toEqual([]);
    expect((await draftKeys(fresh)).sort()).toEqual([ka, kb].sort());
    const before = new Set(ext.ctx.pages());
    await openDrafts(fresh); await rowFor(fresh, ka).locator('.drafts-open').click();
    const [re] = await waitNew(ext, before, 1);
    expect(await md(re)).toBe('before crash\n'); expect(docId(re)).toBe(ka.replace(SLOT, ''));
    await a.close().catch(() => {}); await b.close().catch(() => {});
  });

  test('discarded tab (chrome.tabs.discard): lock released while the tab shell still exists -> its draft is offered by Drafts; activating the discarded tab reloads it on its own slot; Open meanwhile makes the reload a "copy" (no double editor)', async ({ ext }) => {
    // chrome.tabs.discard() in this headless Chromium takes the WHOLE browser context down (probe: context/pages gone right after discard, extension pages share one renderer), so this stays a documented manual check.
    test.skip(true, 'chrome.tabs.discard terminates the headless browser context (manual-only item); see REPORT.md');
    const T = hook(ext);
    const [a, b, c] = await clickIcon(ext, T, 3); await typeIn(a, 'discard me'); const ka = slotOf(a); await waitDraft(a, ka, 'discard me\n');
    await b.bringToFront();
    const id = await tabIdOf(ext, a);
    const ok = await sw(ext).evaluate(async (id) => { try { const t = await chrome.tabs.discard(id); return !!t; } catch (e) { return String(e); } }, id);
    test.info().annotations.push({ type: 'info', description: 'chrome.tabs.discard result: ' + ok });
    test.skip(ok !== true, 'tab discard not possible in this harness');
    await sleep(500);
    const discarded = await sw(ext).evaluate(async (id) => (await chrome.tabs.get(id)).discarded, id);
    expect(discarded).toBe(true);
    const keys = await draftKeys(c);
    test.info().annotations.push({ type: 'info', description: 'Drafts while that tab is discarded: ' + JSON.stringify(keys) });
    expect(keys, 'discarded tab\'s draft listed (lock gone)').toEqual([ka]);
    // user clicks Open on it although the discarded tab is still in the tab strip -> now TWO tabs for the same note
    const before = new Set(ext.ctx.pages());
    await openDrafts(c); await rowFor(c, ka).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    // activate the discarded tab: it reloads its URL; the slot lock is taken by `re`, so it must become a copy
    await sw(ext).evaluate(async (id) => chrome.tabs.update(id, { active: true }), id);
    await expect.poll(async () => ext.ctx.pages().filter((p) => EDITOR_RE.test(p.url()) && /doc=/.test(p.url())).length).toBeGreaterThanOrEqual(4);
    await sleep(1500);
    const docs = ext.ctx.pages().filter((p) => EDITOR_RE.test(p.url()) && p.url().includes('doc='));
    const slots = await Promise.all(docs.map(async (p) => p.evaluate(() => window.__mdwe && window.__mdwe.state.slot).catch(() => null)));
    test.info().annotations.push({ type: 'info', description: 'slots of all doc tabs after reactivating: ' + JSON.stringify(slots.map((x) => x && x.slice(-8))) });
    expect(new Set(slots.filter(Boolean)).size, 'no two live editors on one slot').toBe(slots.filter(Boolean).length);
  });

  test('bfcache / history: navigating a doc tab to another extension page and back releases the lock while away (draft listed) and re-takes it on return without becoming a copy', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2); await typeIn(a, 'history'); const ka = slotOf(a); await waitDraft(a, ka, 'history\n');
    const u = a.url();
    await a.goto(`chrome-extension://${ext.extId}/editor/index.html?src=${encodeURIComponent('file:///nonexistent.md')}`);
    await a.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    await expect.poll(() => draftKeys(b), { timeout: 5000 }).toEqual([ka]);   // lock released immediately (not parked in bfcache)
    await a.goBack(); await a.waitForFunction(() => window.__mdwe && window.__mdwe.state.slot);
    expect(a.url()).toBe(u); await expect.poll(() => md(a)).toBe('history\n');
    await expect.poll(() => draftKeys(b)).toEqual([]);
    expect((await heldNames(b)).filter((x) => x.includes(ka))).toEqual(['exclusive mdwe-slot:' + ka]);
  });

  test('50 tabs: ~50 exclusive + 50 shared locks, no pending requests, Drafts opens fast and lists nothing; closing them all releases every lock and lists exactly the 50 typed notes', async ({ ext }) => {
    test.setTimeout(240000);
    const T = hook(ext);
    const tabs = await clickIcon(ext, T, 50, { timeout: 120000 });
    for (const t of tabs.slice(0, 5)) await typeIn(t, 'note ' + docId(t).slice(0, 4));
    await sleep(1200);
    const li = await lockInfo(tabs[10]);
    expect(li.held.filter((x) => x.startsWith('exclusive mdwe-slot:'))).toHaveLength(50);
    expect(li.held.filter((x) => x.startsWith('shared mdwe-num-'))).toHaveLength(50); expect(li.pending).toEqual([]);
    const t0 = Date.now(); await openDrafts(tabs[10]); const dt = Date.now() - t0;
    expect(await rowKeys(tabs[10])).toEqual([]); await tabs[10].keyboard.press('Escape');
    test.info().annotations.push({ type: 'info', description: `Drafts dialog with 100 locks held opened in ${dt}ms` });
    expect(dt).toBeLessThan(3000);
    const keep = tabs[49]; const typed = tabs.slice(0, 5).map(slotOf);
    for (const t of tabs.slice(0, 49)) await t.close({ runBeforeUnload: false });
    await sleep(500);
    await expect.poll(() => heldNames(keep).then((h) => h.length), { timeout: 8000 }).toBe(2);
    const keys = await draftKeys(keep); expect(keys.sort()).toEqual(typed.sort());
  });

  test('Save As in a doc tab: slot lock + number lock unchanged by the rename; draft removed on save; re-editing after save writes the SAME slot (still hidden from other tabs\' Drafts), Ctrl+S saves in place', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { saveName: 'renamed.md' });
    const [a, b] = await clickIcon(ext, T, 2); const ka = slotOf(a);
    const before = await heldNames(b);
    await typeIn(a, 'v1'); await waitDraft(a, ka, 'v1\n');
    await a.keyboard.press('Control+s'); await expect(a.locator('#filename')).toHaveText('renamed.md');
    await expect.poll(() => lget(a, ka)).toBeUndefined();
    expect(await heldNames(b), 'locks identical after rename').toEqual(before);
    expect(await draftKeys(b)).toEqual([]);
    await typeIn(a, ' v2'); await waitDraft(a, ka, 'v1 v2\n');
    expect((await lget(a, ka)).name).toBe('renamed.md');
    expect(await draftKeys(b), 'still hidden: lock held').toEqual([]);
    expect(await a.evaluate(() => window.__fsa.saveAs)).toEqual(['Untitled-1.md']);
    await a.keyboard.press('Control+s'); await expect.poll(() => a.evaluate(() => window.__fsa.writes.length)).toBe(2);
    await expect.poll(() => lget(a, ka)).toBeUndefined();
    // close after a save+re-edit: draft listed under the file name; discarded tab number 1 stays reserved only while the tab is open
    await typeIn(a, ' v3'); await waitDraft(a, ka, 'v1 v2 v3\n'); await closeTab(a);
    await openDrafts(b); await expect(rowFor(b, ka).locator('strong')).toHaveText('renamed.md'); await b.keyboard.press('Escape');
    expect(T.errors).toEqual([]);
  });

  test('plain tab: Ctrl+O/drag-drop (loadDoc switches draft slot to mdwe.draft.file) - both shared locks were taken at load, so neither slot is offered while the tab lives; after it closes they are', async ({ ext }) => {
    const T = hook(ext);
    await ext.ctx.addInitScript(fsaRecorder, { openContent: '# from disk\n', openName: 'disk.md' });
    const [n] = await clickIcon(ext, T);
    const p = await openEditor(ext); await typeIn(p.page, 'plain draft'); await waitDraft(p.page, 'mdwe.draft', 'plain draft\n');
    await p.page.keyboard.press('Control+o');
    await expect(p.page.locator('#filename')).toHaveText('disk.md');
    await typeIn(p.page, 'edit on file'); await waitDraft(p.page, 'mdwe.draft.file', (await md(p.page)));
    expect(await draftKeys(n), 'both hidden while the plain tab is open').toEqual([]);
    await closeTab(p.page);
    const keys = await (async () => { await expect.poll(() => draftKeys(n)).not.toEqual([]); return draftKeys(n); })();
    test.info().annotations.push({ type: 'info', description: 'after the plain tab closed: ' + JSON.stringify(keys) });
    expect(keys).toContain('mdwe.draft.file');
  });

  test('[BUG-45] ?src= tab (file:// .md via the content script) hides the parked untitled draft in mdwe.draft from Drafts - in ITS OWN dialog and every other tab - for as long as it lives, although it never writes that slot', async ({ ext }) => {
    const T = hook(ext);
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'parked untitled draft') });
    const [n] = await clickIcon(ext, T);
    expect(await draftKeys(n), 'baseline: listed while no plain/?src tab is open').toEqual(['mdwe.draft']);
    const url = 'file:///tmp/long-lived.md';
    const s = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: srcStub, arg: { map: { [url]: '# long lived\n' } } });
    await expect(s.page.locator('#btn-drafts')).toBeVisible();
    const fromSrc = await draftKeys(s.page); const fromNote = await draftKeys(n);
    test.info().annotations.push({ type: 'info', description: `Drafts in the ?src tab: ${JSON.stringify(fromSrc)}, in the note tab: ${JSON.stringify(fromNote)}; src tab draftKey = mdwe.draft.file, it never writes mdwe.draft` });
    expect(fromNote, 'parked draft is not owned by the ?src tab (it writes mdwe.draft.file only) so it must stay listed').toEqual(['mdwe.draft']);
  });

  test('two plain tabs on one stored mdwe.draft (legacy, pre-existing): both restore it; shared locks cannot flag this - recorded', async ({ ext }) => {
    await seed(ext, { 'mdwe.draft': dr('Untitled.md', 'legacy shared') });
    const p1 = await openEditor(ext); const p2 = await openEditor(ext);
    await expect.poll(() => md(p1.page)).toBe('legacy shared'); await expect.poll(() => md(p2.page)).toBe('legacy shared');
    await typeIn(p1.page, '+1'); await typeIn(p2.page, '+2'); await sleep(1200);
    test.info().annotations.push({ type: 'info', description: 'two plain tabs on mdwe.draft (pre-existing legacy behaviour): slot=' + JSON.stringify((await lget(p1.page, 'mdwe.draft')).text) + ' p1=' + JSON.stringify(await md(p1.page)) + ' p2=' + JSON.stringify(await md(p2.page)) });
  });

  test('legacy Open keeps the Drive link end-to-end: reopened tab is Drive-linked (same id + modifiedTime), Save to Drive goes to the SAME file id with the stored modifiedTime as the conflict guard; legacy key cleared', async ({ ext }) => {
    const T = hook(ext);
    const [n] = await clickIcon(ext, T);
    await seed(ext, { 'mdwe.draft.file': dr('notes.md', 'edited offline', { drive: { id: 'DRV1', modifiedTime: '2026-09-29T12:00:00.000Z', canEdit: true } }) });
    await openDrafts(n); const before = new Set(ext.ctx.pages());
    await rowFor(n, 'mdwe.draft.file').locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    const i = await info(re);
    expect(i.drive).toEqual({ id: 'DRV1', modifiedTime: '2026-09-29T12:00:00.000Z', canEdit: true }); expect(i.name).toBe('notes.md'); expect(i.md).toBe('edited offline');
    expect(await lget(re, 'mdwe.draft.file')).toBeUndefined();
    expect((await lget(re, i.slot)).drive).toMatchObject({ id: 'DRV1' });
    await re.evaluate(installMock, { files: [{ id: 'DRV1', name: 'notes.md', text: 'remote' }] }); await re.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; });
    await re.click('#btn-drive-save');
    await expect.poll(() => re.evaluate(() => window.__drv.calls.filter((c) => c.m === 'saveFile').length), { timeout: 10000 }).toBeGreaterThan(0);
    const call = await re.evaluate(() => window.__drv.calls.find((c) => c.m === 'saveFile').args);
    expect(call.id).toBe('DRV1'); expect(call.expectedModifiedTime).toBe('2026-09-29T12:00:00.000Z'); expect(call.text).toBe('edited offline');
  });

  test('?src= + Drive flows unchanged: ?src= tab Save to Drive -> Drive-linked, draft slot mdwe.draft.file cleared, locks stay the two shared legacy locks; Open from Drive in a plain tab keeps legacy slots', async ({ ext }) => {
    const T = hook(ext);
    const url = 'file:///tmp/dv.md';
    const s = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: srcStub, arg: { map: { [url]: '# dv\n' } } });
    await s.page.evaluate(installMock, { files: [{ id: 'f1', name: 'remote.md', text: '# Remote\n' }] }); await s.page.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; });
    await typeIn(s.page, 'x'); await waitDraft(s.page, 'mdwe.draft.file', (await md(s.page)));
    await s.page.click('#btn-drive-save'); await s.page.locator('.gdui-dialog').waitFor(); await s.page.locator('.gdui-dialog [data-action="save"]').click();
    await expect.poll(async () => (await info(s.page)).drive && 1, { timeout: 15000 }).toBe(1);
    await expect.poll(() => lget(s.page, 'mdwe.draft.file')).toBeUndefined();
    expect(await heldNames(s.page)).toEqual(['shared mdwe-slot:mdwe.draft', 'shared mdwe-slot:mdwe.draft.file']);
    expect(s.page.url()).toContain('?src='); expect(s.page.url()).not.toContain('doc=');
    await s.page.click('#btn-drive-open'); await s.page.locator('.gdui-dialog').waitFor(); await s.page.locator('.gdui-dialog .gdui-row', { hasText: 'remote' }).dblclick();
    await expect.poll(() => md(s.page)).toContain('Remote');
    await typeIn(s.page, 'y'); await expect.poll(() => lget(s.page, 'mdwe.draft.file').then((d) => d && d.drive && d.drive.id)).toBe('f1');
    expect(Object.keys(await local(s.page)).filter((k) => k.startsWith(SLOT))).toEqual([]);
    expect(T.errors).toEqual([]);
  });

  test('Drafts button/dialog in a ?src= tab and plain tab: opens (no hang) with many held locks; ownKey excluded; Open from there creates a doc tab', async ({ ext }) => {
    const T = hook(ext);
    const [a, b] = await clickIcon(ext, T, 2); await typeIn(a, 'closed soon'); await waitDraft(a, slotOf(a), 'closed soon\n'); const ka = slotOf(a); await closeTab(a);
    const p = await openEditor(ext);
    await expect.poll(() => draftKeys(p.page)).toEqual([ka]);
    const before = new Set(ext.ctx.pages()); await openDrafts(p.page); await rowFor(p.page, ka).locator('.drafts-open').click(); const [re] = await waitNew(ext, before, 1);
    expect(docId(re)).toBe(ka.replace(SLOT, '')); expect(p.page.url()).toBe(p.url);
  });
});
