// 10. Google Drive editing. Two harnesses:
//   (M) MOCK  : window.__mdwe.driveApi replaced with an in-page mock that mirrors src/drive/api.js (lib/drive.mjs installMock).
//   (R) REAL  : the real createDriveApi() bundled in the page, stubbed chrome.identity (init script) and a Node-side FakeDrive behind
//               context.route('https://www.googleapis.com/*'). No real Google endpoint is ever contacted.
import { test, expect, md, setMd, storageGet, fsaStub, fsaArgs, SCREENS } from '../lib/fixture.mjs';
import { openDriveEditor, FakeDrive, shot } from '../lib/drive.mjs';
import fs from 'node:fs'; import path from 'node:path';

const FIX = path.resolve(SCREENS, '..', '..', 'src', 'editor', 'fixtures');
const pm = (p) => p.locator('#editor-host .ProseMirror');
const badge = (p) => p.locator('#drive-status .gdui-status');
const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__mdwe.state)));
const drv = (p) => p.evaluate(() => JSON.parse(JSON.stringify({ calls: window.__drv.calls, files: window.__drv.files })));
const calls = async (p, m) => (await drv(p)).calls.filter((c) => c.m === m);
const idc = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__id)));
const draft = (p, k = 'mdwe.draft') => storageGet(p, k);
const appendText = async (p, t) => { await pm(p).click(); await p.keyboard.press('Control+End'); await p.keyboard.type(t); };
const openDlg = async (p) => { await p.click('#btn-drive-open'); await p.locator('.gdui-dialog').waitFor(); };
const rowNames = (p) => p.locator('.gdui-dialog .gdui-row .gdui-fname span:not(.gdui-badge):not(.gdui-ico)').allInnerTexts();
const pickFile = async (p, name) => {
  await openDlg(p);
  const row = p.locator('.gdui-dialog .gdui-row', { hasText: name }).first();
  await row.waitFor(); await row.click();
  await p.locator('.gdui-dialog [data-action="open"]').click();
  await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
};
const dirtyIs = (p, v) => expect.poll(async () => (await st(p)).dirty, { timeout: 3000 }).toBe(v); // onChange->dirty is debounced 250ms
const settle = (p) => p.waitForTimeout(350); // > onChange debounce (250ms)
const M = (files = [], extra = {}) => ({ mock: { files, ...extra } });
const F1 = { id: 'f1', name: 'notes.md', text: '# Notes\n\nfirst file\n' };
const F2 = { id: 'f2', name: 'todo.md', text: '# Todo\n\n- a\n- b\n' };
const F3 = { id: 'f3', name: 'readme.markdown', text: '# Readme\n\nhello\n' };

// =====================================================================================================================
// A. MOCK-API TESTS
// =====================================================================================================================
test.describe('Drive (mock api)', () => {
  test('toolbar: Drive buttons + status container exist, badge hidden initially, no Drive calls at load', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    await expect(r.page.locator('#btn-drive-open')).toHaveText('Open from Drive');
    await expect(r.page.locator('#btn-drive-save')).toHaveText('Save to Drive');
    await expect(badge(r.page)).toBeHidden();
    expect((await drv(r.page)).calls).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test('Open from Drive: list (newest first), search filters (debounced, query passed to api), pick -> content, name, not dirty, state.drive', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1, F2, F3]));
    const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(3);
    expect(await rowNames(p)).toEqual(['readme.markdown', 'todo.md', 'notes.md']); // mock returns newest first
    await expect(p.locator('.gdui-dialog .gdui-account')).toHaveText('tester@example.com');
    // search
    await p.locator('.gdui-dialog input[type=search]').fill('todo');
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
    expect(await rowNames(p)).toEqual(['todo.md']);
    expect((await calls(p, 'listFiles')).map((c) => c.args.query)).toEqual(['', 'todo']);
    await p.locator('.gdui-dialog input[type=search]').fill('zzz-nomatch');
    await expect(p.locator('.gdui-dialog')).toContainText('No matching files');
    await p.locator('.gdui-dialog input[type=search]').fill('');
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(3);
    // pick
    await p.locator('.gdui-dialog .gdui-row', { hasText: 'notes.md' }).click();
    await p.locator('.gdui-dialog [data-action="open"]').click();
    await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(await md(p)).toBe('# Notes\n\nfirst file\n');
    await expect(p.locator('#filename')).toHaveText('notes.md');
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    const s = await st(p);
    expect(s.dirty).toBe(false); expect(s.handle).toBeNull();
    expect(s.drive).toMatchObject({ id: 'f1', canEdit: true }); expect(s.drive.modifiedTime).toMatch(/^2026-09-29T12:00:0\d/);
    await expect(p.locator('#status')).toContainText('Opened notes.md from Drive');
    await expect(badge(p)).toBeHidden();
    expect(r.errors).toEqual([]);
  });

  test('Open dialog: double-click / Enter open; Esc + Cancel close without touching the document; Ctrl+S behind the dialog does nothing', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1, F2]));
    const p = r.page;
    await pm(p).click(); await p.keyboard.type('keep me'); await settle(p);
    p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept()); // confirm "Discard unsaved changes?" -> accept
    await openDlg(p);
    await p.keyboard.press('Control+s'); // must not reach main.js
    await p.waitForTimeout(150);
    expect((await calls(p, 'saveFile')).length + (await calls(p, 'createFile')).length).toBe(0);
    await expect(p.locator('.gdui-dialog .gdui-title')).toHaveText(/Open from Drive|Open/);
    await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(await md(p)).toBe('keep me\n');
    await openDlg(p); await p.locator('.gdui-dialog [data-action="cancel"]').click(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(await md(p)).toBe('keep me\n'); expect((await st(p)).drive).toBeNull();
    await openDlg(p); await p.locator('.gdui-dialog .gdui-row', { hasText: 'todo' }).dblclick();
    await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(await md(p)).toBe('# Todo\n\n- a\n- b\n');
  });

  test('Open from Drive with unsaved edits asks to discard; dismiss keeps content and does not even open the dialog', async ({ ext }) => {
    const r = await openDriveEditor(ext, { ...M([F1]), autoDialog: 'dismiss' });
    const p = r.page;
    await pm(p).click(); await p.keyboard.type('unsaved'); await settle(p);
    await p.click('#btn-drive-open');
    await p.waitForTimeout(300);
    expect(r.dialogs.some((d) => /Discard unsaved/.test(d))).toBe(true);
    await expect(p.locator('.gdui-dialog')).toHaveCount(0);
    expect(await md(p)).toBe('unsaved\n');
  });

  test('Open: readFile failure keeps the picker open with an error banner and leaves the current document alone', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    await setMd(p, 'existing doc'); await settle(p);
    await p.evaluate(() => { window.__drv.fail.readFile = { code: 'not-found', message: 'File not found (deleted, moved, or no access)' }; });
    await openDlg(p);
    await p.locator('.gdui-dialog .gdui-row', { hasText: 'notes.md' }).click();
    await p.locator('.gdui-dialog [data-action="open"]').click();
    await expect(p.locator('.gdui-dialog .gdui-banner')).toContainText(/not found|deleted/i);
    await expect(p.locator('.gdui-dialog')).toHaveCount(1);
    expect(await md(p)).toBe('existing doc'); expect((await st(p)).drive).toBeNull(); // exact-original: setMarkdown text returned verbatim
    await p.keyboard.press('Escape');
  });

  test('Edit + Save: Ctrl+S saves in place with expectedModifiedTime, updates baseline (not dirty), badge Saved; second save uses the NEW modifiedTime', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    await pickFile(p, 'notes.md');
    const loaded = (await st(p)).drive.modifiedTime;
    await appendText(p, ' EDIT1');
    await expect(p.locator('#filename')).toHaveClass(/dirty/);
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    await expect(badge(p)).toContainText(/Saved to Drive \d/);
    let sv = await calls(p, 'saveFile');
    expect(sv.length).toBe(1);
    expect(sv[0].args).toMatchObject({ id: 'f1', expectedModifiedTime: loaded, force: false });
    expect(sv[0].args.text).toBe(await md(p));
    expect(sv[0].args.text).toContain('first file EDIT1');
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    const s = await st(p);
    expect(s.dirty).toBe(false); expect(s.savedText).toBe(await md(p));
    expect(s.drive.modifiedTime).not.toBe(loaded);
    expect(await draft(p, 'mdwe.draft.file')).toBeUndefined();
    // second edit + toolbar button
    await appendText(p, ' EDIT2');
    await p.click('#btn-drive-save');
    await expect.poll(async () => (await calls(p, 'saveFile')).length).toBe(2);
    sv = await calls(p, 'saveFile');
    expect(sv[1].args.expectedModifiedTime).toBe(s.drive.modifiedTime); // baseline advanced
    expect(sv[1].args.text).toContain('EDIT1 EDIT2');
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    expect((await calls(p, 'createFile')).length).toBe(0);
    expect(r.errors).toEqual([]);
  });

  test('Ctrl+S / #btn-save on a Drive doc go to Drive (not a local Save As picker or download)', async ({ ext }) => {
    const r = await openDriveEditor(ext, { ...M([F1]), extraInit: [[fsaStub(), fsaArgs()]] });
    const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' x');
    await p.click('#btn-save');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(await p.evaluate(() => window.__fsa.saveAsCalls)).toBe(0);
    expect((await calls(p, 'saveFile')).length).toBe(1);
  });

  test('status badge states: saving (while in flight), saved, error, offline, conflict, signed-out', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    await pickFile(p, 'notes.md');
    await appendText(p, ' a');
    // saving
    await p.evaluate(() => { window.__gate = null; window.__drv.gate.saveFile = new Promise((res) => { window.__gate = res; }); });
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saving');
    await expect(badge(p)).toHaveText(/Saving to Drive/);
    await p.evaluate(() => { window.__drv.gate.saveFile = null; window.__gate(); });
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const errCase = async (code, message, state, textRe) => {
      await appendText(p, '.');
      await p.evaluate(([code, message]) => { window.__drv.fail.saveFile = { code, message, once: true }; }, [code, message]);
      await p.keyboard.press('Control+s');
      await expect(badge(p)).toHaveAttribute('data-state', state);
      await expect(badge(p)).toHaveText(textRe);
      await expect(p.locator('#filename')).toHaveClass(/dirty/); // never claims success
    };
    await errCase('http', 'Backend Error', 'error', /save failed.*Backend Error/i);
    await errCase('offline', 'Network error: could not reach Google Drive', 'offline', /offline/i);
    await errCase('auth', 'Google session expired. Sign in again.', 'signed-out', /signed out/i);
    await errCase('not-configured', 'Google OAuth client ID is not configured. See README "Google Drive setup".', 'signed-out', /not set up|client|README/i);
    await errCase('forbidden', 'insufficient perms', 'error', /permission denied/i);
    await errCase('quota', 'Google Drive rate limit hit. Try again shortly.', 'error', /rate limited/i);
    // conflict
    await p.evaluate(() => window.__drv.remoteEdit('f1', 'remote change\n'));
    await p.keyboard.press('Control+s');
    await p.locator('.gdui-conflict').waitFor();
    await expect(badge(p)).toHaveAttribute('data-state', 'conflict');
    await p.locator('.gdui-conflict [data-choice="cancel"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'conflict'); // stays until resolved
    // a fresh load clears the badge
    p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
    await pickFile(p, 'notes.md');
    await expect(badge(p)).toBeHidden();
  });
});

// ---------- conflict ----------
test.describe('Drive conflict (mock api)', () => {
  async function conflictSetup(ext, extra = {}) {
    const r = await openDriveEditor(ext, M([F1], extra));
    const p = r.page;
    await pickFile(p, 'notes.md');
    await appendText(p, ' LOCAL');
    await settle(p);
    await p.evaluate(() => window.__drv.remoteEdit('f1', '# Notes\n\nREMOTE CHANGE\n'));
    await p.keyboard.press('Control+s');
    await p.locator('.gdui-conflict').waitFor();
    return r;
  }
  const remote = (p) => p.evaluate(() => window.__drv.files.find((f) => f.id === 'f1').text);
  const REMOTE = '# Notes\n\nREMOTE CHANGE\n';

  test('conflict dialog: shows alertdialog with 4 choices, focus on Cancel, nothing written yet, screenshots light/dark', async ({ ext }) => {
    const r = await conflictSetup(ext);
    const p = r.page;
    await expect(p.locator('.gdui-conflict')).toHaveAttribute('role', 'alertdialog');
    await expect(p.locator('.gdui-conflict [data-choice]')).toHaveCount(4);
    expect(await p.locator('.gdui-conflict [data-choice]').evaluateAll((b) => b.map((x) => x.dataset.choice))).toEqual(['overwrite', 'reload', 'save-copy', 'cancel']);
    expect(await p.evaluate(() => document.activeElement.dataset.choice)).toBe('cancel');
    expect(await remote(p)).toBe(REMOTE);
    const sv = await calls(p, 'saveFile'); expect(sv.length).toBe(1); expect(sv[0].args.force).toBe(false);
    await shot(p, 'drive-conflict-light.png');
    await p.keyboard.press('Escape'); await p.locator('.gdui-conflict').waitFor({ state: 'detached' });
    await p.click('#btn-theme'); // dark
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await expect(p.locator('.gdui-conflict.gdui-overlay, .gdui-overlay:has(.gdui-conflict)').first()).toHaveAttribute('data-theme', 'dark');
    await shot(p, 'drive-conflict-dark.png');
    await p.keyboard.press('Escape');
    expect(await remote(p)).toBe(REMOTE); // never overwritten by dismissing
  });

  test('conflict -> Cancel / Esc / backdrop click: remote untouched, local edits + dirty kept, badge stays conflict, baseline unchanged', async ({ ext }) => {
    const r = await conflictSetup(ext);
    const p = r.page;
    const before = await st(p); const localText = await md(p);
    await p.locator('.gdui-overlay:has(.gdui-conflict)').click({ position: { x: 5, y: 5 } }); // backdrop: must NOT cancel or choose
    await expect(p.locator('.gdui-conflict')).toHaveCount(1);
    await p.locator('.gdui-conflict [data-choice="cancel"]').click();
    await p.locator('.gdui-conflict').waitFor({ state: 'detached' });
    expect(await remote(p)).toBe(REMOTE);
    expect(await md(p)).toBe(localText); expect(localText).toContain('LOCAL');
    const after = await st(p);
    expect(after.dirty).toBe(true); expect(after.drive.modifiedTime).toBe(before.drive.modifiedTime);
    await expect(p.locator('#filename')).toHaveClass(/dirty/);
    await expect(badge(p)).toHaveAttribute('data-state', 'conflict');
    expect((await calls(p, 'saveFile')).length).toBe(1); expect((await calls(p, 'createFile')).length).toBe(0);
    // a second Ctrl+S re-detects the conflict (does not just write)
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await p.keyboard.press('Escape'); await p.locator('.gdui-conflict').waitFor({ state: 'detached' });
    expect(await remote(p)).toBe(REMOTE);
  });

  test('conflict -> Overwrite: saveFile force:true writes local text; baseline = new modifiedTime; clean; badge saved', async ({ ext }) => {
    const r = await conflictSetup(ext);
    const p = r.page; const localText = await md(p);
    const remoteT = await p.evaluate(() => window.__drv.files.find((f) => f.id === 'f1').modifiedTime);
    await p.locator('.gdui-conflict [data-choice="overwrite"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(await remote(p)).toBe(localText);
    const sv = await calls(p, 'saveFile'); expect(sv.length).toBe(2); expect(sv[1].args.force).toBe(true);
    const s = await st(p); expect(s.dirty).toBe(false); expect(s.drive.modifiedTime).not.toBe(remoteT);
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    // next save is a normal, non-forced save using the new baseline
    await appendText(p, '!'); await p.keyboard.press('Control+s');
    await expect.poll(async () => (await calls(p, 'saveFile')).length).toBe(3);
    const sv3 = (await calls(p, 'saveFile'))[2]; expect(sv3.args.force).toBe(false); expect(sv3.args.expectedModifiedTime).toBe(s.drive.modifiedTime);
  });

  test('conflict -> Reload: asks to confirm; accept loads remote (clean); dismiss keeps local edits and does not reload', async ({ ext }) => {
    const r = await conflictSetup(ext, {});
    const p = r.page; const localText = await md(p);
    // dismiss the confirm() -> nothing changes
    p.removeAllListeners('dialog'); const seen = []; p.on('dialog', (d) => { seen.push(d.message()); d.dismiss(); });
    await p.locator('.gdui-conflict [data-choice="reload"]').click();
    await p.waitForTimeout(300);
    expect(seen.join('|')).toMatch(/Replace your edits/);
    expect(await md(p)).toBe(localText); await dirtyIs(p, true);
    expect((await calls(p, 'readFile')).length).toBe(1); // only the initial open
    // again, this time accept
    p.removeAllListeners('dialog'); p.on('dialog', (d) => d.accept());
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await p.locator('.gdui-conflict [data-choice="reload"]').click();
    await expect.poll(() => md(p)).toBe(REMOTE);
    const s = await st(p); expect(s.dirty).toBe(false); expect(s.drive.id).toBe('f1');
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    await expect(badge(p)).toBeHidden();
    expect(await remote(p)).toBe(REMOTE); expect((await calls(p, 'saveFile')).every((c) => c.args.force === false)).toBe(true);
    expect(await draft(p, 'mdwe.draft.file')).toBeUndefined();
  });

  test('conflict -> Save as a copy: Save dialog defaults to "Copy of notes.md"; original untouched; copy has local text; doc now points at copy', async ({ ext }) => {
    const r = await conflictSetup(ext);
    const p = r.page; const localText = await md(p);
    await p.locator('.gdui-conflict [data-choice="save-copy"]').click();
    await p.locator('.gdui-dialog').waitFor();
    await expect(p.locator('.gdui-dialog input.gdui-input')).toHaveValue('Copy of notes.md');
    await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const cf = await calls(p, 'createFile'); expect(cf.length).toBe(1);
    expect(cf[0].args.name).toBe('Copy of notes.md'); expect(cf[0].args.text).toBe(localText);
    expect(await remote(p)).toBe(REMOTE); // original never overwritten
    const s = await st(p); expect(s.drive.id).not.toBe('f1'); expect(s.dirty).toBe(false);
    await expect(p.locator('#filename')).toHaveText('Copy of notes.md');
    expect((await calls(p, 'saveFile')).every((c) => c.args.force === false)).toBe(true);
  });

  test('conflict -> Save as a copy -> cancel the name dialog: nothing written, edits kept', async ({ ext }) => {
    const r = await conflictSetup(ext);
    const p = r.page; const localText = await md(p);
    await p.locator('.gdui-conflict [data-choice="save-copy"]').click();
    await p.locator('.gdui-dialog').waitFor(); await p.keyboard.press('Escape');
    await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect((await calls(p, 'createFile')).length).toBe(0); expect(await remote(p)).toBe(REMOTE);
    expect(await md(p)).toBe(localText); await dirtyIs(p, true); expect((await st(p)).drive.id).toBe('f1');
  });

  test('conflict: overwrite fails (network) -> error badge, still dirty, remote unchanged', async ({ ext }) => {
    const r = await conflictSetup(ext);
    const p = r.page;
    await p.evaluate(() => { window.__drv.fail.saveFile = { code: 'offline', message: 'Network error: could not reach Google Drive' }; });
    await p.locator('.gdui-conflict [data-choice="overwrite"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'offline');
    await dirtyIs(p, true); expect(await remote(p)).toBe(REMOTE);
  });
});

// ---------- read-only / not configured / errors in the Open dialog (mock) ----------
test.describe('Drive read-only, not-configured, errors (mock api)', () => {
  test('read-only file (canEdit false): row shows Read-only badge; opened with notice; Save blocked -> offered save-as-copy; no PATCH ever sent', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([{ id: 'ro', name: 'shared.md', text: '# Shared\n', canEdit: false }, F1]));
    const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-row', { hasText: 'shared.md' }).locator('.gdui-badge')).toHaveText('Read-only');
    await p.locator('.gdui-row', { hasText: 'shared.md' }).dblclick(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await expect(p.locator('#status')).toContainText(/read-only/i);
    expect((await st(p)).drive.canEdit).toBe(false);
    await appendText(p, 'my edit');
    await p.keyboard.press('Control+s');
    await p.locator('.gdui-dialog').waitFor();
    await expect(p.locator('.gdui-dialog input.gdui-input')).toHaveValue('Copy of shared.md');
    expect((await calls(p, 'saveFile')).length).toBe(0);
    // cancel -> nothing, still dirty
    await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect((await calls(p, 'createFile')).length).toBe(0); await dirtyIs(p, true);
    // accept -> copy is created, original untouched, doc now editable
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor();
    await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect((await calls(p, 'createFile'))[0].args.text).toContain('my edit');
    expect(await p.evaluate(() => window.__drv.files.find((f) => f.id === 'ro').text)).toBe('# Shared\n');
    const s = await st(p); expect(s.drive.canEdit).toBe(true); expect(s.dirty).toBe(false);
  });

  test('file becomes read-only after open: saveFile rejects read-only -> error badge "read-only file", still dirty', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' x');
    await p.evaluate(() => { window.__drv.files[0].canEdit = false; });
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'error');
    await expect(badge(p)).toContainText(/read-only/i);
    await dirtyIs(p, true);
  });

  test('not-configured (mock: listFiles throws not-configured): clear message, no sign-in button; rest of extension still works (type, theme, source, local Save)', async ({ ext }) => {
    const r = await openDriveEditor(ext, { ...M([F1]), extraInit: [[fsaStub(), fsaArgs({ saveName: 'local.md' })]] });
    const p = r.page;
    await p.evaluate(() => { window.__drv.fail.listFiles = { code: 'not-configured', message: 'Google OAuth client ID is not configured. See README "Google Drive setup".' }; });
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/isn.t set up yet.*OAuth client ID.*README/s);
    await expect(p.locator('.gdui-dialog [data-action="signin"]')).toHaveCount(0);
    await shot(p, 'drive-dialog-notconfigured-light.png');
    await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    // rest of extension
    await pm(p).click(); await p.keyboard.type('still works');
    expect(await md(p)).toBe('still works\n');
    await p.click('#btn-theme'); expect(await p.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await p.click('.mdx-toolbar [data-cmd="source"]'); await expect(p.locator('#editor-host textarea')).toBeVisible(); await p.click('.mdx-toolbar [data-cmd="source"]');
    await p.keyboard.press('Control+s'); // untitled + no drive -> LOCAL save as
    await expect(p.locator('#filename')).toHaveText('local.md');
    expect(await p.evaluate(() => window.__fsa.saveAsCalls)).toBe(1);
    expect((await st(p)).drive).toBeNull();
    // and "Save to Drive" reports the same thing clearly instead of hanging / silently failing
    await appendText(p, ' more');
    await p.evaluate(() => { window.__drv.fail.listFolders = { code: 'not-configured', message: 'x' }; });
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor();
    await expect(p.locator('.gdui-dialog')).toContainText(/isn.t set up yet/);
    await p.keyboard.press('Escape');
    expect(r.errors).toEqual([]);
  });

  test('not-configured on Save (createFile/saveFile throws not-configured): badge says "not set up", content + dirty preserved', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    await pm(p).click(); await p.keyboard.type('draft me');
    await p.evaluate(() => { window.__drv.fail.createFile = { code: 'not-configured', message: 'x' }; });
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor(); await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'signed-out');
    await expect(badge(p)).toContainText(/not set up/);
    expect(await md(p)).toBe('draft me\n'); await dirtyIs(p, true); expect((await st(p)).drive).toBeNull();
  });

  test('Open dialog signed out: shows Sign in; Sign in -> lists; Sign out -> "Signed out" + sign in again works; sign-out calls api.signOut', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1], { signedIn: false }));
    const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/Sign in to Google Drive/);
    await p.locator('.gdui-dialog [data-action="signin"]').click();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
    await expect(p.locator('.gdui-dialog .gdui-link')).toBeVisible();
    await p.locator('.gdui-dialog .gdui-link', { hasText: 'Sign out' }).click();
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/Signed out/);
    expect(await p.evaluate(() => [window.__drv.signedOut, window.__drv.signedIn])).toEqual([1, false]);
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(0);
    await p.locator('.gdui-dialog [data-action="signin"]').click();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
    await p.keyboard.press('Escape');
  });

  test('sign-out then Save on an open Drive doc: friendly "signed out" badge, edits + dirty kept, no write', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' Q');
    await openDlg(p); await p.locator('.gdui-dialog .gdui-link', { hasText: 'Sign out' }).click();
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/Signed out/); await p.keyboard.press('Escape');
    await p.evaluate(() => { window.__drv.fail.saveFile = { code: 'auth', message: 'Sign in to Google Drive first' }; });
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'signed-out');
    await expect(badge(p)).toHaveText(/signed out/i);
    await dirtyIs(p, true); expect(await md(p)).toContain('first file Q');
  });

  test('errors in Open dialog: offline -> message+Retry that recovers; quota -> rate-limit; forbidden -> permission; generic -> message + Retry', async ({ ext }) => {
    const r = await openDriveEditor(ext, M([F1]));
    const p = r.page;
    const cases = [['offline', /offline|reach Google Drive/i], ['quota', /rate limit/i], ['forbidden', /Permission denied/], ['not-found', /not found/i], ['http', /Backend Error/]];
    for (const [code, re] of cases) {
      await p.evaluate(([code]) => { window.__drv.fail.listFiles = { code, message: 'Backend Error', once: true }; }, [code]);
      await openDlg(p);
      await expect(p.locator('.gdui-dialog .gdui-state.gdui-state-fill, .gdui-dialog .gdui-state').first()).toContainText(re);
      await p.locator('.gdui-dialog [data-action="retry"]').click(); // fail is once -> retry succeeds
      await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
      await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    }
  });

  test('Open dialog: pagination "Load more" appends next page; a failing next page keeps the loaded list with Retry', async ({ ext }) => {
    const files = Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: `file${i}.md`, text: 'x' + i }));
    const r = await openDriveEditor(ext, M(files, { pageSize: 3 }));
    const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(3);
    await p.evaluate(() => { window.__drv.fail.listFiles = { code: 'offline', message: 'x', once: true }; });
    await p.locator('.gdui-dialog [data-action="more"]').click();
    await expect(p.locator('.gdui-dialog .gdui-err')).toBeVisible();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(3);
    await p.locator('.gdui-dialog [data-action="more"]').click();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(6);
    await p.locator('.gdui-dialog [data-action="more"]').click();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(7);
    await expect(p.locator('.gdui-dialog [data-action="more"]')).toHaveCount(0);
    await p.keyboard.press('Escape');
  });

  test('screenshots: Open-from-Drive dialog + Save-to-Drive dialog in light and dark -> qa/screens/drive-*.png', async ({ ext }) => {
    const files = [F1, F2, F3, { id: 'ro', name: 'shared-readonly.md', text: 'x', canEdit: false }, { id: 'big', name: 'a-much-longer-document-name-for-truncation-check.md', text: 'y'.repeat(3000) }];
    const r = await openDriveEditor(ext, M(files));
    const p = r.page;
    await setMd(p, '# Hello Drive\n\nSome **content** behind the dialog.\n');
    for (const theme of ['light', 'dark']) {
      await p.evaluate((t) => { if (document.documentElement.dataset.theme !== t) document.getElementById('btn-theme').click(); }, theme);
      await openDlg(p); await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(5);
      await expect(p.locator('.gdui-overlay')).toHaveAttribute('data-theme', theme);
      await shot(p, `drive-dialog-${theme}.png`);
      await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
      await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor(); await expect(p.locator('.gdui-folder-row')).toHaveCount(2);
      await shot(p, `drive-save-dialog-${theme}.png`);
      await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    }
    for (const f of ['drive-dialog-light.png', 'drive-dialog-dark.png']) expect(fs.statSync(path.join(SCREENS, f)).size).toBeGreaterThan(5000);
  });
});

// =====================================================================================================================
// B. REAL createDriveApi() + stubbed chrome.identity + FakeDrive behind context.route('https://www.googleapis.com/*')
// =====================================================================================================================
const fx = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const newDrive = (files) => new FakeDrive(files);
const R = (drive, o = {}) => ({ drive, ...o });
const NOTES = { id: 'f1', name: 'notes.md', text: '# Notes\n\nfirst file\n' };
const fileState = (p) => storageGet(p, 'mdwe.draft.file');

test.describe('Drive (real api.js + stubbed identity + routed googleapis)', () => {
  test('smoke: open dialog lists via real REST (query params, Bearer token, only googleapis hosts contacted), pick -> content byte-exact', async ({ ext }) => {
    const d = newDrive([NOTES, { id: 'f2', name: 'todo.md', text: '# Todo\n' }, { id: 'pic', name: 'photo.png', text: 'x', mimeType: 'image/png' }]);
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(2); // png filtered client-side
    const list = d.reqs((l) => l.path === '/drive/v3/files' && l.method === 'GET')[0];
    expect(list.search.q).toMatch(/trashed = false/); expect(list.search.orderBy).toBe('modifiedTime desc'); expect(list.search.supportsAllDrives).toBe('true');
    expect(list.auth).toBe('Bearer TOK1');
    await p.locator('.gdui-row', { hasText: 'notes.md' }).dblclick(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(await md(p)).toBe(NOTES.text);
    expect((await st(p)).drive).toMatchObject({ id: 'f1', modifiedTime: d.files.get('f1').modifiedTime, canEdit: true });
    expect(d.log.every((l) => /^(www|oauth2)\.googleapis\.com$/.test(l.host))).toBe(true);
    expect(r.external.filter((u) => !/googleapis\.com/.test(u))).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  test('search: typed query is escaped into q (quote + backslash) and filters server-side', async ({ ext }) => {
    const d = newDrive([NOTES, { id: 'q1', name: "it's a plan.md", text: '# p' }]);
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p);
    await p.locator('.gdui-dialog input[type=search]').fill("it's");
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
    const qs = d.reqs((l) => l.path === '/drive/v3/files').map((l) => l.search.q);
    expect(qs[qs.length - 1]).toContain("name contains 'it\\'s'");
    await p.keyboard.press('Escape');
  });

  test('save in place: GET metadata (expected modifiedTime) -> PATCH upload media with exact body + text/markdown; baseline from PATCH response', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md');
    await appendText(p, ' EDITED'); await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const w = d.writes(); expect(w.length).toBe(1);
    expect(w[0].method).toBe('PATCH'); expect(w[0].path).toBe('/upload/drive/v3/files/f1'); expect(w[0].search.uploadType).toBe('media');
    expect(w[0].ct).toMatch(/^text\/markdown/);
    expect(w[0].body.toString('utf8')).toBe('# Notes\n\nfirst file EDITED\n');
    expect(d.text('f1')).toBe(await md(p));
    const seq = d.log.filter((l) => l.path.includes('/files/f1')).map((l) => l.method + ' ' + (l.path.startsWith('/upload') ? 'upload' : l.search.alt || 'meta'));
    expect(seq.slice(-2)).toEqual(['GET meta', 'PATCH upload']); // check-then-act order
    expect((await st(p)).drive.modifiedTime).toBe(d.files.get('f1').modifiedTime);
    await dirtyIs(p, false);
    await appendText(p, '2'); await p.keyboard.press('Control+s');
    await expect.poll(() => d.writes().length).toBe(2); // no false conflict on 2nd save
    expect(d.text('f1')).toContain('EDITED2');
  });

  test('real conflict: remote changes after open -> real 409-less metadata check triggers dialog; Cancel = no PATCH at all', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' LOCAL'); await settle(p);
    d.remoteEdit('f1', '# Notes\n\nREMOTE\n');
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await p.locator('.gdui-conflict [data-choice="cancel"]').click();
    expect(d.writes().length).toBe(0); expect(d.text('f1')).toBe('# Notes\n\nREMOTE\n');
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await p.locator('.gdui-conflict [data-choice="overwrite"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.text('f1')).toContain('first file LOCAL'); expect(d.writes().length).toBe(1);
  });

  test('conflict -> Save copy (real createFile multipart) + Reload (real GET) leave the original correct', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' LOCAL'); await settle(p);
    d.remoteEdit('f1', '# Notes\n\nREMOTE\n');
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await p.locator('.gdui-conflict [data-choice="save-copy"]').click(); await p.locator('.gdui-dialog').waitFor();
    await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const post = d.log.find((l) => l.method === 'POST' && l.path === '/upload/drive/v3/files');
    expect(post.meta).toMatchObject({ name: 'Copy of notes.md', mimeType: 'text/markdown' }); expect(post.content).toBe('# Notes\n\nfirst file LOCAL\n');
    expect(d.text('f1')).toBe('# Notes\n\nREMOTE\n');
    expect([...d.files.values()].map((f) => f.name).sort()).toEqual(['Copy of notes.md', 'notes.md']);
  });

  test('expired token: 401 -> removeCachedAuthToken + new token + ONE retry -> success (open list, read, save)', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p); await expect(p.locator('.gdui-row')).toHaveCount(1); // caches TOK1
    d.minGen = 2; // token TOK1 now expired server-side
    await p.locator('.gdui-row').dblclick(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' }); // readFile uses TOK1 -> 401 -> refresh
    expect(await md(p)).toBe(NOTES.text);
    const id = await idc(p); expect(id.removed).toEqual(['TOK1']);
    const auths = d.log.filter((l) => l.path.startsWith('/drive/v3/files/f1')).map((l) => l.auth + ':' + l.status);
    expect(auths).toEqual(['Bearer TOK1:401', 'Bearer TOK2:200', 'Bearer TOK2:200']); // meta 401->retry, then media
    // expire again during SAVE
    await appendText(p, ' s'); d.minGen = 3;
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.text('f1')).toContain('first file s'); expect((await idc(p)).removed).toEqual(['TOK1', 'TOK2']);
    expect(d.attempts('PATCH').map((l) => l.status)).toEqual([200]); // the write itself was sent once
    expect(r.errors.filter((e) => !/Failed to load resource: the server responded with a status of 401/.test(e)), 'only the (expected) browser 401 network log lines').toEqual([]);
  });

  test('repeated 401 on save: refresh once only, then friendly auth error (badge "signed out"); edits + dirty kept; no PATCH; no retry loop', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' edit');
    d.alwaysAuthFail = true;
    const before = d.log.length;
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'signed-out');
    await expect(badge(p)).toHaveText(/signed out/i);
    await p.waitForTimeout(500);
    const n = d.log.length - before; expect(n, 'exactly 2 attempts (original + one retry)').toBe(2);
    expect(d.attempts('PATCH').length).toBe(0);
    await dirtyIs(p, true); expect(await md(p)).toContain('first file edit');
    const idd = await idc(p); console.log('after 2x401: tokens removed from Chrome cache =', JSON.stringify(idd.removed), '(2nd token stays cached; self-heals on next request)');
    // server recovers (e.g. transient): the very next Ctrl+S must recover by itself, not stay stuck on the stale cached token
    d.alwaysAuthFail = false; d.minGen = idd.gen; await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect(d.text('f1')).toContain('first file edit');
    expect(r.errors.filter((e) => !/Failed to load resource: the server responded with a status of 401/.test(e))).toEqual([]);
  });

  test('repeated 401 in Open dialog: friendly "Sign in required" state with Sign in button (no raw HTTP text)', async ({ ext }) => {
    const d = newDrive([NOTES]); d.alwaysAuthFail = true;
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/Sign in/);
    await expect(p.locator('.gdui-dialog .gdui-state')).not.toContainText(/Invalid Credentials|401/);
    await expect(p.locator('.gdui-dialog [data-action="signin"]')).toBeVisible();
    await p.keyboard.press('Escape');
  });

  test('offline (route abort) on open: message + Retry; Retry recovers when back online', async ({ ext }) => {
    const d = newDrive([NOTES]); let off = true; d.hooks.push(() => (off ? { abort: true } : undefined));
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/offline|Couldn.t reach Google Drive/i);
    off = false; await p.locator('.gdui-dialog [data-action="retry"]').click();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
    await p.keyboard.press('Escape');
  });

  test('offline (route abort) on save: offline badge + editor content and dirty state preserved; draft kept; later retry succeeds', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' OFFLINE EDIT'); await settle(p);
    const before = await md(p);
    let off = true; d.hooks.push(() => (off ? { abort: true } : undefined));
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'offline');
    await expect(badge(p)).toContainText(/offline/i);
    expect(await md(p)).toBe(before); await dirtyIs(p, true); await expect(p.locator('#filename')).toHaveClass(/dirty/);
    expect((await st(p)).savedText).toBe(NOTES.text);
    expect(d.text('f1')).toBe(NOTES.text);
    await expect.poll(() => fileState(p), { timeout: 4000 }).toBeTruthy();
    expect((await fileState(p)).text).toBe(before);
    off = false; await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.text('f1')).toBe(before); await dirtyIs(p, false);
    expect(r.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  });

  test('offline during metadata check while file was changed remotely is NOT treated as success', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' Z');
    d.hooks.push((e) => (e.method === 'PATCH' ? { abort: true } : undefined)); // metadata OK, upload fails mid-way
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'offline');
    await dirtyIs(p, true); expect(d.text('f1')).toBe(NOTES.text);
  });

  test('429 -> quota message (save + open dialog); 403 rateLimitExceeded -> quota; 403 forbidden -> permission', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    let mode = null; d.hooks.push((e) => (mode && e.path !== '' ? { status: mode.status, reason: mode.reason, message: mode.message } : undefined));
    mode = { status: 429, message: 'Too Many Requests' };
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/rate limit/i);
    mode = null; await p.locator('.gdui-dialog [data-action="retry"]').click(); await expect(p.locator('.gdui-row')).toHaveCount(1);
    await p.locator('.gdui-row').dblclick(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await appendText(p, ' q');
    for (const [m, re] of [[{ status: 429, message: 'Too Many Requests' }, /rate limited/], [{ status: 403, reason: 'userRateLimitExceeded', message: 'x' }, /rate limited/], [{ status: 403, reason: 'insufficientFilePermissions', message: 'no' }, /permission denied/i], [{ status: 500, message: 'Backend Error' }, /Backend Error/]]) {
      mode = m; await p.keyboard.press('Control+s');
      await expect(badge(p)).toHaveAttribute('data-state', 'error'); await expect(badge(p)).toHaveText(re);
      await dirtyIs(p, true);
    }
    mode = null; await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.text('f1')).toContain('first file q');
  });

  test('read-only file via real capabilities.canEdit=false: Read-only badge, no metadata PATCH, Save offers a copy (createFile multipart)', async ({ ext }) => {
    const d = newDrive([{ id: 'ro', name: 'shared.md', text: '# Shared\n', canEdit: false }]);
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p); await expect(p.locator('.gdui-badge')).toHaveText('Read-only'); await p.locator('.gdui-row').dblclick(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await appendText(p, 'mine'); await p.keyboard.press('Control+s'); await p.locator('.gdui-dialog').waitFor();
    await expect(p.locator('.gdui-dialog input.gdui-input')).toHaveValue('Copy of shared.md');
    await p.locator('.gdui-dialog [data-action="save"]').click(); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.attempts('PATCH').length).toBe(0); expect(d.text('ro')).toBe('# Shared\n');
    const copy = [...d.files.values()].find((f) => f.name === 'Copy of shared.md'); expect(copy.body.toString()).toContain('mine');
  });

  test('server refuses PATCH (403 insufficientFilePermissions although canEdit said true): permission error, dirty kept', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' x'); d.files.get('f1').canEdit = false;
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'error'); await expect(badge(p)).toContainText(/read-only/i);
    await dirtyIs(p, true);
  });

  test('CORS/host_permissions: requests succeed WITHOUT any CORS headers from the server (extension host_permissions bypass)', async ({ ext }) => {
    const d = newDrive([NOTES]); d.cors = false;
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' c'); await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    console.log('preflights seen (Authorization header => preflight expected only if not host-permitted):', d.log.filter((l) => l.preflight).length);
    expect(d.text('f1')).toContain('first file c');
  });

  test('[BUG-19] placeholder/invalid client id: chrome says "Invalid OAuth2 Client ID." -> must be mapped to the clear "not set up" (not-configured) message, not "Sign-in failed" + endless Sign in button', async ({ ext }) => {
    const d = newDrive([NOTES]);
    const r = await openDriveEditor(ext, { ...R(d), identity: { signedIn: false, interactiveError: 'Invalid OAuth2 Client ID.' } }); const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog [data-action="signin"]')).toBeVisible();
    await p.locator('.gdui-dialog [data-action="signin"]').click();
    await p.waitForTimeout(500);
    console.log('dialog text after Invalid OAuth2 Client ID:', JSON.stringify(await p.locator('.gdui-dialog .gdui-state').innerText()));
    await shot(p, 'drive-dialog-notconfigured-real.png');
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/isn.t set up yet/i);
    await expect(p.locator('.gdui-dialog [data-action="signin"]')).toHaveCount(0);
    await p.keyboard.press('Escape');
    await pm(p).click(); await p.keyboard.type('local still ok'); expect(await md(p)).toBe('local still ok\n');
  });

  test('chrome.identity missing entirely: dialog offers Sign in, click -> clear "not set up"; no crash; local editing works', async ({ ext }) => {
    const r = await openDriveEditor(ext, { drive: newDrive([]), identity: { missing: true } }); const p = r.page;
    await openDlg(p);
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/set up|OAuth|Drive/i);
    console.log('identity missing -> dialog text:', JSON.stringify(await p.locator('.gdui-dialog .gdui-state').innerText()));
    await p.locator('.gdui-dialog [data-action="signin"]').click();
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/isn.t set up yet/i);
    await p.keyboard.press('Escape');
    await pm(p).click(); await p.keyboard.type('ok'); expect(await md(p)).toBe('ok\n'); expect(r.errors).toEqual([]);
  });

  test('user cancels the Google sign-in prompt: "Sign-in cancelled" and can retry; other errors show the message', async ({ ext }) => {
    const d = newDrive([NOTES]);
    const r = await openDriveEditor(ext, { ...R(d), identity: { signedIn: false, interactiveError: 'The user did not approve access.' } }); const p = r.page;
    await openDlg(p); await p.locator('.gdui-dialog [data-action="signin"]').click();
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/cancel/i);
    await p.evaluate(() => { window.__id.interactiveError = null; });
    await p.locator('.gdui-dialog [data-action="signin"]').click();
    await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
    expect((await idc(p)).calls.filter((c) => c.interactive).length).toBe(2);
    await p.keyboard.press('Escape');
  });

  test('sign-out via dialog: revoke POST to oauth2.googleapis.com/revoke, cached tokens cleared, next open requires sign-in again', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await openDlg(p); await expect(p.locator('.gdui-row')).toHaveCount(1);
    await p.locator('.gdui-dialog .gdui-link', { hasText: 'Sign out' }).click();
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/Signed out/);
    const rev = d.log.filter((l) => l.host === 'oauth2.googleapis.com'); expect(rev.length).toBe(1); expect(rev[0].method).toBe('POST'); expect(rev[0].search.token).toBe('TOK1');
    const id = await idc(p); expect(id.clearAll).toBe(1); expect(id.removed).toContain('TOK1');
    await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await openDlg(p); await expect(p.locator('.gdui-dialog [data-action="signin"]')).toBeVisible();
    // Save to an already-open Drive doc after sign-out -> friendly auth message, no network write
    await p.keyboard.press('Escape');
  });

  test('sign-out then Ctrl+S on an open Drive doc: friendly error, no write, edits kept', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' after-signout');
    await openDlg(p); await p.locator('.gdui-dialog .gdui-link', { hasText: 'Sign out' }).click(); await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/Signed out/); await p.keyboard.press('Escape');
    await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'signed-out');
    await expect(badge(p)).toHaveText(/signed out/i);
    expect(d.attempts('PATCH').length).toBe(0); await dirtyIs(p, true); expect(await md(p)).toContain('after-signout');
  });

  test('[BUG-23] signed-out / expired-session error on Save of an open Drive doc offers no way to sign in (badge has no action; Save never opens a sign-in prompt)', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' x');
    await p.evaluate(() => { window.__id.signedIn = false; }); // user signed out of Chrome / token revoked, cache empty after reload etc.
    await p.evaluate(async () => { await window.__mdwe.driveApi.signOut(); }); // clears cached token
    await p.keyboard.press('Control+s');
    await expect(badge(p)).toHaveAttribute('data-state', 'signed-out');
    const actions = await p.locator('#drive-status button, .gdui-dialog [data-action="signin"]').count();
    console.log('signed-out badge text:', JSON.stringify(await badge(p).innerText()), ' action buttons offered:', actions);
    expect(actions, 'the signed-out badge/save path must offer a Sign in action (or open the sign-in dialog)').toBeGreaterThan(0);
  });

  test('first Save to Drive of an untitled doc: name dialog (Untitled.md), multipart createFile, Drive text == getMarkdown(), state.drive set, badge saved, clean, later Ctrl+S saves in place', async ({ ext }) => {
    const d = newDrive([]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pm(p).click(); await p.keyboard.type('Hello Drive');
    const text = await md(p);
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor();
    await expect(p.locator('.gdui-dialog input.gdui-input')).toHaveValue('Untitled.md');
    await p.locator('.gdui-dialog input.gdui-input').fill('my notes'); // .md must be appended
    await expect(p.locator('.gdui-dialog .gdui-hint')).toContainText('my notes.md');
    await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const post = d.log.find((l) => l.method === 'POST' && l.path === '/upload/drive/v3/files');
    expect(post.search.uploadType).toBe('multipart'); expect(post.ct).toMatch(/^multipart\/related; boundary=mdwe/);
    expect(post.meta).toEqual({ name: 'my notes.md', mimeType: 'text/markdown' }); expect(post.contentType).toMatch(/^text\/markdown; charset=UTF-8/);
    expect(post.content).toBe(text); expect(text).toBe('Hello Drive\n');
    const s = await st(p);
    expect(s.drive).toMatchObject({ canEdit: true }); expect(s.drive.id).toBeTruthy(); expect(s.handle).toBeNull(); expect(s.name).toBe('my notes.md');
    await expect(p.locator('#filename')).toHaveText('my notes.md'); await dirtyIs(p, false);
    await appendText(p, ' again'); await p.keyboard.press('Control+s');
    await expect.poll(() => d.writes().length).toBe(2);
    expect(d.log.filter((l) => l.method === 'POST' && l.path.startsWith('/upload')).length).toBe(1); // no second create
    expect(d.attempts('PATCH').length).toBe(1);
  });

  test('Save to Drive dialog: folder browser passes parents; cancel writes nothing; invalid name rejected', async ({ ext }) => {
    const d = newDrive([]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pm(p).click(); await p.keyboard.type('x');
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor();
    await p.locator('.gdui-dialog input.gdui-input').fill('a/b'); await p.keyboard.press('Enter');
    await expect(p.locator('.gdui-dialog .gdui-error-line')).toContainText(/can.t contain/);
    await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(d.log.filter((l) => l.method === 'POST').length).toBe(0);
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor();
    await p.locator('.gdui-folder-row', { hasText: 'Work' }).dblclick();
    await p.locator('.gdui-dialog input.gdui-input').fill('in-folder'); await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const post = d.log.find((l) => l.method === 'POST' && l.path.startsWith('/upload')); expect(post.meta.parents).toEqual(['FOLD2']);
  });

  test('createFile fails (offline/429) on first save: doc stays untitled + dirty, no state.drive; retry works', async ({ ext }) => {
    const d = newDrive([]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    let fail = 429; d.hooks.push((e) => (fail && e.method === 'POST' && e.path.startsWith('/upload') ? { status: fail, message: 'slow down' } : undefined));
    await pm(p).click(); await p.keyboard.type('first');
    const create = async () => { await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor(); await p.locator('.gdui-dialog [data-action="save"]').click(); };
    await create(); await expect(badge(p)).toHaveAttribute('data-state', 'error'); await expect(badge(p)).toHaveText(/rate limited/);
    expect((await st(p)).drive).toBeNull(); await dirtyIs(p, true); expect([...d.files.values()].length).toBe(0);
    fail = 0; await create(); await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect([...d.files.values()].length).toBe(1);
  });

  test('typing during an in-flight save keeps the doc dirty and drafted (afterDriveWrite compares against text that was uploaded)', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' one');
    let release; const gate = new Promise((res) => { release = res; });
    d.hooks.push(async (e) => { if (e.method === 'PATCH') await gate; });
    await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saving');
    await p.keyboard.type(' two'); release();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.text('f1')).toContain('first file one\n'); expect(d.text('f1')).not.toContain('two');
    await dirtyIs(p, true); await expect(p.locator('#filename')).toHaveClass(/dirty/);
    await expect.poll(() => fileState(p), { timeout: 4000 }).toBeTruthy(); expect((await fileState(p)).text).toContain('one two');
  });

  test('double Ctrl+S while a save is running does not produce two writes', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' x');
    let release; const gate = new Promise((res) => { release = res; }); d.hooks.push(async (e) => { if (e.method === 'PATCH') await gate; });
    await p.keyboard.press('Control+s'); await p.keyboard.press('Control+s'); await p.waitForTimeout(200); release();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved'); await p.waitForTimeout(300);
    expect(d.attempts('PATCH').length).toBe(1);
  });

  test('DOCUMENTED (#17): change landing between metadata check and PATCH is overwritten (check-then-act) - asserts current best-effort behaviour', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' mine');
    d.hooks.push((e, dd) => { if (e.method === 'PATCH') dd.remoteEdit('f1', 'SOMEONE ELSE\n'); });
    await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.text('f1')).toContain('mine'); // remote edit lost - known limitation, README documents it
  });
});

// =====================================================================================================================
// C. Drafts / local handle / round-trip fidelity
// =====================================================================================================================
test.describe('Drive drafts + local files interplay (real api)', () => {
  test('autosave of a Drive-opened doc goes to mdwe.draft.file (with drive link) and leaves an existing untitled mdwe.draft slot alone', async ({ ext }) => {
    const d = newDrive([NOTES]);
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await p.evaluate(() => chrome.storage.local.set({ 'mdwe.draft': { text: 'untitled precious\n', name: 'Untitled.md', savedAt: 1, drive: null } }));
    await pickFile(p, 'notes.md'); // loadDoc (no confirm needed: clean) - see BUG-20 test for the resulting slot state
    await p.evaluate(() => chrome.storage.local.set({ 'mdwe.draft': { text: 'untitled precious\n', name: 'Untitled.md', savedAt: 1, drive: null } })); // re-seed after open
    await appendText(p, ' typed');
    await expect.poll(() => fileState(p), { timeout: 4000 }).toBeTruthy();
    const fd = await fileState(p);
    expect(fd.name).toBe('notes.md'); expect(fd.text).toContain('first file typed'); expect(fd.drive).toMatchObject({ id: 'f1', canEdit: true });
    expect((await draft(p)).text).toBe('untitled precious\n'); // untitled slot untouched by Drive autosave
  });

  test('[BUG-20] opening a Drive file while a kept (not currently shown) draft exists silently deletes that draft, no prompt (same loadDoc path as local Open)', async ({ ext }) => {
    // Same class as BUG-1/BUG-12: a clean editor (no confirm) + loadDoc() without keepDraft => both draft slots removed.
    const d = newDrive([NOTES]);
    const first = await openDriveEditor(ext, R(d));
    await pm(first.page).click(); await first.page.keyboard.type('precious unsaved work');
    await expect.poll(() => draft(first.page)).toBeTruthy();
    const url = 'file:///tmp/x.md';
    const r = await openDriveEditor(ext, { ...R(d), query: '?src=' + encodeURIComponent(url), extraInit: [[({ url }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...a) => (String(u) === url ? new Response('# x\n', { status: 200 }) : of(u, ...a)); }, { url }]] });
    const p = r.page;
    await expect(p.locator('#status')).toContainText('draft');
    expect((await draft(p)).text).toBe('precious unsaved work\n');
    await p.click('#btn-drive-open'); await p.locator('.gdui-dialog').waitFor(); await p.locator('.gdui-row').dblclick(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    expect(r.dialogs.filter((x) => /Discard/.test(x))).toEqual([]); // no confirm was shown (editor was clean)
    const after = await draft(p);
    console.log('untitled draft after Drive open:', JSON.stringify(after));
    // probe (report only): does a LOCAL Open behave the same? (FSA stub, clean editor)
    const r2 = await openDriveEditor(ext, { ...R(d), query: '?src=' + encodeURIComponent(url), extraInit: [[({ url }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...a) => (String(u) === url ? new Response('# x\n', { status: 200 }) : of(u, ...a)); }, { url }], [fsaStub(), fsaArgs({ openName: 'l.md' })]] });
    await r2.page.evaluate(() => chrome.storage.local.set({ 'mdwe.draft': { text: 'precious2\n', name: 'Untitled.md', savedAt: 2, drive: null } }));
    await r2.page.keyboard.press('Control+o'); await expect(r2.page.locator('#filename')).toHaveText('l.md');
    console.log('kept draft after LOCAL Ctrl+O on a clean editor:', JSON.stringify(await draft(r2.page)));
    expect(after && after.text, 'the previously kept draft must survive opening a Drive file (or user must be asked)').toBe('precious unsaved work\n');
  });

  test('[BUG-21] first Save to Drive of an untitled doc leaves the stale untitled draft in mdwe.draft; reload then "restores" already-saved text as an unsaved, un-linked draft', async ({ ext }) => {
    const d = newDrive([]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pm(p).click(); await p.keyboard.type('saved to drive');
    await expect.poll(() => draft(p)).toBeTruthy(); // autosave into mdwe.draft
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor(); await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    await dirtyIs(p, false);
    await p.waitForTimeout(1200);
    const stale = await draft(p); const fileSlot = await fileState(p);
    console.log('after first Save to Drive: mdwe.draft =', JSON.stringify(stale), ' mdwe.draft.file =', JSON.stringify(fileSlot));
    await p.evaluate(() => { window.onbeforeunload = null; });
    await p.reload(); await p.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    await p.waitForTimeout(400);
    const s2 = await st(p);
    console.log('after reload: dirty =', s2.dirty, ' drive =', JSON.stringify(s2.drive), ' name =', s2.name, ' status =', await p.locator('#status').innerText());
    expect.soft(stale, 'untitled draft slot must be cleared after the doc was saved to Drive').toBeUndefined();
    expect.soft(s2.dirty, 'reload after a successful save must not present a dirty restored draft').toBe(false);
    // After the fix nothing is restored at all: the saved doc is clean, so reload starts an empty untitled doc (same as a locally saved doc);
    // the duplicate trap (a dirty, un-linked copy of already-saved text) is gone. state.drive===null on that EMPTY doc is correct.
    expect.soft(await md(p), 'nothing stale restored into the editor').toBe('');
  });

  test('reload while a Drive doc has unsaved edits: draft restored WITH Drive link (dirty); Ctrl+S saves in place (remote unchanged) ; conflict dialog if remote changed meanwhile', async ({ ext }) => {
    const d = newDrive([NOTES]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'notes.md'); await appendText(p, ' unsaved');
    await expect.poll(() => fileState(p), { timeout: 4000 }).toBeTruthy();
    await p.reload(); await p.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    await expect.poll(() => md(p)).toContain('first file unsaved');
    let s = await st(p); expect(s.dirty).toBe(true); expect(s.drive).toMatchObject({ id: 'f1' }); expect(s.name).toBe('notes.md');
    await p.keyboard.press('Control+s'); // focus may be body; handler is on document
    await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect(d.text('f1')).toContain('first file unsaved');
    // now the conflict variant
    await appendText(p, ' more'); await expect.poll(() => fileState(p), { timeout: 4000 }).toBeTruthy();
    await p.reload(); await p.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    d.remoteEdit('f1', 'changed elsewhere\n');
    await p.keyboard.press('Control+s'); await p.locator('.gdui-conflict').waitFor();
    await p.locator('.gdui-conflict [data-choice="cancel"]').click();
    expect(d.text('f1')).toBe('changed elsewhere\n');
  });

  test('Ctrl+S with a LOCAL file handle open saves locally (FSA) and never contacts Drive; Ctrl+Shift+S from a Drive doc detaches it to local', async ({ ext }) => {
    const d = newDrive([NOTES]);
    const r = await openDriveEditor(ext, { ...R(d), extraInit: [[fsaStub(), fsaArgs({ openContent: '# Local\n\nbody\n', openName: 'local.md', saveName: 'new-local.md' })]] }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('local.md');
    await appendText(p, ' L1'); await p.keyboard.press('Control+s');
    await expect.poll(() => p.evaluate(() => window.__fsa.writes.length)).toBe(1);
    expect(await p.evaluate(() => window.__fsa.files['local.md'])).toContain('body L1');
    await dirtyIs(p, false);
    expect(d.log.filter((l) => l.host.includes('googleapis')).length).toBe(0);
    expect((await st(p)).drive).toBeNull(); await expect(badge(p)).toBeHidden();
    // open a Drive doc, then Ctrl+O local again -> drive link dropped, Ctrl+S local
    await pickFile(p, 'notes.md'); expect((await st(p)).drive).toBeTruthy();
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('local.md');
    expect((await st(p)).drive).toBeNull();
    await appendText(p, ' L2'); await p.keyboard.press('Control+s');
    await expect.poll(() => p.evaluate(() => window.__fsa.writes.length)).toBe(2);
    expect(d.attempts('PATCH').length).toBe(0);
    // Drive doc -> Save As (local)
    await pickFile(p, 'notes.md'); await appendText(p, ' D');
    await p.keyboard.press('Control+Shift+s');
    await expect.poll(() => p.evaluate(() => window.__fsa.saveAsCalls)).toBe(1);
    await expect(p.locator('#filename')).toHaveText('new-local.md'); expect((await st(p)).drive).toBeNull();
    expect(d.text('f1')).toBe(NOTES.text); expect(d.attempts('PATCH').length).toBe(0);
  });

  test('local doc -> "Save to Drive" creates a Drive copy and RE-TARGETS Ctrl+S to Drive from then on (behaviour note; handle dropped)', async ({ ext }) => {
    const d = newDrive([]);
    const r = await openDriveEditor(ext, { ...R(d), extraInit: [[fsaStub(), fsaArgs({ openContent: '# Local\n', openName: 'local.md' })]] }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('local.md');
    await appendText(p, ' x');
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor(); await expect(p.locator('.gdui-dialog input.gdui-input')).toHaveValue('local.md');
    await p.locator('.gdui-dialog [data-action="save"]').click(); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const s = await st(p); console.log('after Save-to-Drive from a local-file doc: handle =', s.handle, ' drive =', !!s.drive);
    expect(s.handle).toBeNull(); expect(s.drive).toBeTruthy();
    await appendText(p, ' y'); await p.keyboard.press('Control+s');
    await expect.poll(() => d.attempts('PATCH').length).toBe(1);
    expect(await p.evaluate(() => window.__fsa.writes.length)).toBe(0); // local file is no longer written
  });
});

test.describe('Drive round-trip fidelity (real api, byte-exact via routed FakeDrive)', () => {
  const SPECIAL = [
    '# Escapes\n\n\\# not heading\n\n\\- not list\n\n1\\. not ordered\n\nSnake_case_word and 2 * 3 * 4.\n\n\\> not quote\n',
    '# Raw HTML\n\n<!-- a comment -->\n\n<details><summary>S</summary>\n\nbody\n\n</details>\n\nH<sub>2</sub>O and <kbd>Ctrl</kbd>\n',
    '# Footnotes\n\nText with a note[^1] and another[^two].\n\n[^1]: The first note.\n[^two]: The second.\n',
    '---\ntitle: Front matter\ntags: [a, b]\n---\n\n# Doc\n\nBody\n',
    '# Refs\n\nSee [the site][ref] and <https://example.com>.\n\n[ref]: https://example.com "Title"\n',
  ];
  const noopSave = async (ext, name, text) => {
    const d = newDrive([{ id: 'x', name, text }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, name); await settle(p);
    const s = await st(p); const before = d.bytes('x');
    await p.keyboard.press('Control+s'); await p.waitForTimeout(700);
    return { d, p, dirty: s.dirty, patches: d.attempts('PATCH').length, before, after: d.bytes('x'), md: await md(p), badge: await badge(p).getAttribute('data-state').catch(() => null) };
  };

  test('unicode + CRLF-free content: emoji/CJK/RTL/combining/NBSP survive edit->PATCH (UTF-8 media upload) and createFile multipart bytes', async ({ ext }) => {
    const U = 'Ünïcödé — 日本語 🎉 مرحبا e\u0301 nbsp\u00a0here ﬁ ligature';
    const d = newDrive([{ id: 'u', name: 'u.md', text: '# T\n' }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'u.md'); await appendText(p, U); await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const want = await md(p); expect(want).toContain(U);
    expect(d.bytes('u').equals(Buffer.from(want, 'utf8'))).toBe(true);
    // create: fresh doc
    await setMd(p, '# N\n\n' + U + '\n'); await p.evaluate(() => { window.__mdwe.state.drive = null; }); // detach -> create path
    await p.click('#btn-drive-save'); await p.locator('.gdui-dialog').waitFor(); await p.locator('.gdui-dialog input.gdui-input').fill('uni'); await p.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const post = d.log.find((l) => l.method === 'POST' && l.path.startsWith('/upload'));
    expect(post.content).toBe(await md(p)); expect(post.content).toContain(U);
    expect(post.body.includes(Buffer.from(U, 'utf8'))).toBe(true); // raw request bytes are UTF-8 of the text
  });

  test('CRLF handling (REPORT): a CRLF Drive file opened + edited is written back with LF only; a no-op keeps/loses CRLF?', async ({ ext }) => {
    const crlf = '# Title\r\n\r\nline one\r\nline two\r\n\r\n- a\r\n- b\r\n';
    const d = newDrive([{ id: 'c', name: 'crlf.md', text: crlf }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'crlf.md'); await settle(p);
    const loaded = await md(p); console.log('CRLF file getMarkdown JSON:', JSON.stringify(loaded));
    // Exact-original semantics: an UNEDITED CRLF doc round-trips as CRLF (intended); Ctrl+S is a no-op (nothing uploaded).
    expect(loaded).toBe(crlf);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(500); expect(d.attempts('PATCH').length).toBe(0); expect(d.text('c')).toBe(crlf);
    // After a real edit the output is normalized to LF (report).
    await p.locator('.ProseMirror h1').click(); await p.keyboard.press('End'); await p.keyboard.type(' edited'); await settle(p);
    console.log('CRLF file after ONE edit getMarkdown JSON:', JSON.stringify(await md(p)));
    await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    const out = d.text('c'); console.log('CRLF file after edit+save bytes JSON:', JSON.stringify(out));
    expect(out.includes('\r')).toBe(false); // documents the normalization (CRLF -> LF) on first real edit
    expect(out).toBe(await md(p));
    // multipart create: "\r\n" inside text must not break the multipart framing
    const d2 = newDrive([]); const r2 = await openDriveEditor(ext, R(d2)); const p2 = r2.page;
    await setMd(p2, 'a\r\nb\r\n\r\n--mdwe123\r\nc'); const t2 = await md(p2);
    await p2.click('#btn-drive-save'); await p2.locator('.gdui-dialog').waitFor(); await p2.locator('.gdui-dialog [data-action="save"]').click();
    await expect(badge(p2)).toHaveAttribute('data-state', 'saved');
    const post = d2.log.find((l) => l.method === 'POST' && l.path.startsWith('/upload')); expect(post.content).toBe(t2);
  });

  test('BOM (REPORT): UTF-8 BOM in the Drive file is dropped on read (fetch text()) -> first write removes it', async ({ ext }) => {
    const d = newDrive([{ id: 'b', name: 'bom.md', text: '\ufeff# With BOM\n' }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'bom.md'); expect(await md(p)).toBe('# With BOM\n');
    await appendText(p, ' x'); await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    console.log('BOM present after save:', d.bytes('b')[0] === 0xef);
    expect(d.text('b').startsWith('# With BOM')).toBe(true);
  });

  test('[BUG-22] Ctrl+S / Save to Drive on a CLEAN (unedited) Drive doc uploads anyway (PATCH + new Drive revision on every press) - must be a no-op', async ({ ext }) => {
    const items = fs.readdirSync(FIX).filter((f) => f.endsWith('.md')).map((f) => [f, fx(f)]).concat(SPECIAL.map((t, i) => ['special-' + (i + 1) + '.md', t]));
    const uploaded = []; const rewritten = []; const report = [];
    for (const [name, text] of items) {
      const r = await noopSave(ext, name, text);
      const same = r.before.equals(r.after);
      report.push(`${name}: dirtyAfterOpen=${r.dirty} PATCH=${r.patches} bytesUnchanged=${same}`);
      if (r.patches) uploaded.push(name);
      if (!same) rewritten.push(name);
      await r.p.close();
    }
    console.log('NO-OP SAVE REPORT (clean doc, Ctrl+S):\n' + report.join('\n'));
    console.log('NORMALIZATION (REPORT, not asserted): a no-op save REWROTE the bytes of:', JSON.stringify(rewritten));
    console.log('NORMALIZATION (REPORT): byte-for-byte preserved even though PATCHed:', JSON.stringify(items.map((i) => i[0]).filter((n) => !rewritten.includes(n))));
    expect(uploaded, 'a clean doc was uploaded (PATCH sent) for: ' + uploaded.join(', ')).toEqual([]);
  });

  test('REPORT: what a no-op save does to special constructs (escapes, raw HTML, comments, footnotes, front matter, autolinks): preserved byte-for-byte?', async ({ ext }) => {
    const names = ['special-1 escapes', 'special-2 raw html/comment/kbd/sub', 'special-3 footnotes', 'special-4 front matter', 'special-5 ref-links + autolink'];
    const out = [];
    for (let i = 0; i < SPECIAL.length; i++) {
      const r = await noopSave(ext, `s${i}.md`, SPECIAL[i]);
      out.push(`${names[i]}: ${r.before.equals(r.after) ? 'IDENTICAL' : 'CHANGED -> ' + JSON.stringify(r.d.text('x'))}`);
      await r.p.close();
    }
    console.log('SPECIAL CONSTRUCTS THROUGH DRIVE READ->SAVE:\n' + out.join('\n'));
    // Only constructs the editor is documented to preserve verbatim are asserted (BUG-9/BUG-10 fixes): escapes, raw html, footnotes, front matter.
    expect(out.slice(0, 4).every((l) => l.includes('IDENTICAL')), out.slice(0, 4).join('\n')).toBe(true);
  });

  test('unedited doc, Ctrl+S: what does the UI say? (REPORT) - badge/status text after a no-op save', async ({ ext }) => {
    const r = await noopSave(ext, 'plain.md', '# Plain\n\nJust text.\n');
    console.log('no-op save on already-canonical doc: PATCH count =', r.patches, ' badge =', r.badge, ' bytes unchanged =', r.before.equals(r.after));
    expect(r.before.equals(r.after)).toBe(true); // canonical content is stable either way
  });

  test('edit one word: everything else in a normalized-fixture doc stays (idempotent doc): diff between Drive-before and Drive-after is limited (REPORT lines changed)', async ({ ext }) => {
    const rep = [];
    for (const name of ['01-basic.md', '02-lists.md', '05-mixed.md', '11-raw-html.md', '12-footnotes.md']) {
      const text = fx(name);
      const d = newDrive([{ id: 'w', name, text }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
      await pickFile(p, name); await appendText(p, ' ZZZ'); await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
      const a = text.split('\n'), b = d.text('w').split('\n');
      rep.push(`${name}: bytes ${Buffer.byteLength(text)} -> ${Buffer.byteLength(d.text('w'))}; lines removed ${a.filter((l) => !b.includes(l)).length}, added ${b.filter((l) => !a.includes(l)).length}`);
      await p.close();
    }
    console.log('ONE-WORD-EDIT DIFF REPORT (lines not present in the other version):\n' + rep.join('\n'));
  });
});

test.describe('Drive under real Chromium chrome.identity (no stub) - what a non-Chrome user sees (BUG-18 area)', () => {
  test('REPORT: real chrome.identity in Chromium: non-interactive getAuthToken fails "not signed in" -> dialog shows Sign in; click Sign in -> does it ever settle? extension stays usable', async ({ ext }) => {
    const d = newDrive([NOTES]);
    const r = await openDriveEditor(ext, { drive: d, identity: false }); const p = r.page; // identity:false => no stub, real API
    await openDlg(p);
    await expect(p.locator('.gdui-dialog [data-action="signin"]')).toBeVisible();
    await p.locator('.gdui-dialog [data-action="signin"]').click();
    await p.waitForTimeout(6000);
    const txt = await p.locator('.gdui-dialog .gdui-state').innerText();
    console.log('REAL Chromium identity, 6s after clicking Sign in: dialog =', JSON.stringify(txt), ' googleapis requests =', d.log.length);
    await p.keyboard.press('Escape'); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await pm(p).click(); await p.keyboard.type('alive'); expect(await md(p)).toBe('alive\n');
    expect(d.log.length).toBe(0);
  });
});


// =====================================================================================================================
// D. Exact-original (Editor Dev getMarkdown()/isModified()/markSaved()) + placeholder client id (added after build BTJ1MUpn)
// =====================================================================================================================
test.describe('Exact-original / unedited save probes (18 docs) + placeholder client id', () => {
  const SPECIAL = [
    '# Escapes\n\n\\# not heading\n\n\\- not list\n\n1\\. not ordered\n\nSnake_case_word and 2 * 3 * 4.\n\n\\> not quote\n',
    '# Raw HTML\n\n<!-- a comment -->\n\n<details><summary>S</summary>\n\nbody\n\n</details>\n\nH<sub>2</sub>O and <kbd>Ctrl</kbd>\n',
    '# Footnotes\n\nText with a note[^1] and another[^two].\n\n[^1]: The first note.\n[^two]: The second.\n',
    '---\ntitle: Front matter\ntags: [a, b]\n---\n\n# Doc\n\nBody\n',
    '# Refs\n\nSee [the site][ref] and <https://example.com>.\n\n[ref]: https://example.com "Title"\n',
  ];
  const docs = () => fs.readdirSync(FIX).filter((f) => f.endsWith('.md')).sort().map((f) => [f, fx(f)]).concat(SPECIAL.map((t, i) => ['special-' + (i + 1) + '.md', t]));

  test('[REPORT] byte-for-byte: 18 docs, UNEDITED Drive open -> Ctrl+S: 0 PATCH, Drive bytes identical, getMarkdown()==original, isModified()==false; Ctrl+Z right after open does not blank the doc', async ({ ext }) => {
    const items = docs(); expect(items.length).toBe(18);
    const patched = [], changed = [], mdDiff = [], blank = [], modified = [], skipMsg = [];
    for (const [name, text] of items) {
      const d = newDrive([{ id: 'x', name, text }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
      await pickFile(p, name); await settle(p);
      if ((await md(p)) !== text) mdDiff.push(name);
      if (await p.evaluate(() => window.__mdwe.editor.isModified())) modified.push(name);
      await pm(p).click(); await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await settle(p);
      const afterUndo = await md(p); if (afterUndo.trim() === '' && text.trim() !== '') blank.push(name); else if (afterUndo !== text) mdDiff.push(name + ' (after Ctrl+Z)');
      await p.keyboard.press('Control+s'); await p.waitForTimeout(600);
      if (d.attempts('PATCH').length) patched.push(name);
      if (!d.bytes('x').equals(Buffer.from(text, 'utf8'))) changed.push(name);
      skipMsg.push(await p.locator('#status').innerText());
      await p.close();
    }
    console.log(`DRIVE unedited Ctrl+S over ${items.length} docs: PATCHed=${patched.length} ${JSON.stringify(patched)}; Drive bytes CHANGED=${changed.length} ${JSON.stringify(changed)}; getMarkdown!=original=${mdDiff.length} ${JSON.stringify(mdDiff)}; isModified()=true after open=${modified.length} ${JSON.stringify(modified)}; blanked by Ctrl+Z=${blank.length} ${JSON.stringify(blank)}; status texts=${JSON.stringify([...new Set(skipMsg)])}`);
    expect.soft(patched, 'unedited Drive Ctrl+S must not upload').toEqual([]);
    expect.soft(changed, 'Drive bytes changed').toEqual([]);
    expect.soft(mdDiff, 'getMarkdown() must equal the original on an unedited doc').toEqual([]);
    expect.soft(modified, 'isModified() false after open').toEqual([]);
    expect.soft(blank, 'Ctrl+Z after open must not blank the doc').toEqual([]);
  });

  test('[REPORT] byte-for-byte: 18 docs, UNEDITED local open (FSA stub) -> Ctrl+S writes exactly the original bytes', async ({ ext }) => {
    const items = docs(); const changed = [], blank = [];
    for (const [name, text] of items) {
      const r = await openDriveEditor(ext, { extraInit: [[fsaStub(), fsaArgs({ openContent: text, openName: name })]] }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText(name); await settle(p);
      await pm(p).click(); await p.keyboard.press('Control+z'); await settle(p);
      if ((await md(p)).trim() === '' && text.trim() !== '') blank.push(name);
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      const w = await p.evaluate(() => window.__fsa.writes.map((x) => x.text));
      const out = w.length ? w[w.length - 1] : null;
      if (out !== text) changed.push(name + (out === null ? ' (no write)' : ''));
      await p.close();
    }
    console.log(`LOCAL unedited Ctrl+S over ${items.length} docs: bytes CHANGED=${changed.length} ${JSON.stringify(changed)}; blanked by Ctrl+Z=${blank.length}`);
    expect.soft(changed).toEqual([]); expect.soft(blank).toEqual([]);
  });

  test('unedited Drive doc: Ctrl+S shows "No changes to save", no PATCH, no badge error; after a real edit + save + markSaved, a 2nd Ctrl+S is skipped again', async ({ ext }) => {
    const d = newDrive([{ id: 'x', name: 'n.md', text: '# Setext\n=====\n\n* star\n' }]); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await pickFile(p, 'n.md'); await settle(p);
    await p.keyboard.press('Control+s');
    await expect(p.locator('#status')).toContainText('No changes to save');
    expect(d.attempts('PATCH').length).toBe(0); expect(d.attempts('GET').filter((l) => /files\/x$/.test(l.path) && !l.search.alt).length).toBeLessThanOrEqual(1);
    await appendText(p, ' more'); await p.keyboard.press('Control+s'); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(d.attempts('PATCH').length).toBe(1);
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false); // markSaved() called after save
    await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
    expect(d.attempts('PATCH').length).toBe(1);
    await p.evaluate(() => { window.__mdwe.editor.setMarkdown('x'); });
  });

  test('placeholder client id (manifest AS SHIPPED, YOUR_CLIENT_ID...): Open-from-Drive -> Sign in gives "isn\'t set up yet" WITHOUT calling chrome.identity (no interactive call)', async ({ extReal }) => {
    const d = newDrive([NOTES2]);
    const r = await openDriveEditor(extReal, { ...R(d), identity: { signedIn: false } }); const p = r.page;
    await openDlg(p);
    const t1 = await p.locator('.gdui-dialog .gdui-state').innerText();
    console.log('placeholder manifest: dialog on open (non-interactive probe) =', JSON.stringify(t1));
    await p.locator('.gdui-dialog [data-action="signin"]').click(); // placeholder check fires in getTokenRaw on sign-in
    await expect(p.locator('.gdui-dialog .gdui-state')).toContainText(/isn.t set up yet/i);
    await expect(p.locator('.gdui-dialog [data-action="signin"]')).toHaveCount(0);
    const id = await idc(p); console.log('identity calls with placeholder manifest:', JSON.stringify(id.calls));
    expect(id.calls).toEqual([]); expect(d.log.length).toBe(0);
    await p.keyboard.press('Escape');
    await pm(p).click(); await p.keyboard.type('local ok'); expect(await md(p)).toBe('local ok\n');
  });
});
const NOTES2 = { id: 'f1', name: 'notes.md', text: '# Notes\n\nfirst file\n' };
