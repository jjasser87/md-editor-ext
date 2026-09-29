// 5. File I/O: fallback input open, drag-drop, download, dirty indicator, shortcuts, FSA stub (open + save to same handle).
import { test, expect, md, setMd, openEditor, fsaArgs, fsaStub, storageGet } from '../lib/fixture.mjs';
import fs from 'node:fs';

const pm = (page) => page.locator('#editor-host .ProseMirror');
const dirtyState = (page) => page.evaluate(() => ({ cls: document.getElementById('filename').classList.contains('dirty'), title: document.title, name: document.getElementById('filename').textContent, dirty: window.__mdwe.state.dirty }));

test('Open via #fallback-input (no FSA): loads content, name, not dirty', async ({ ext }) => {
  const { page } = await openEditor(ext, { init: () => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; } });
  expect(await page.evaluate(() => typeof window.showOpenFilePicker)).toBe('undefined');
  await page.locator('#btn-open').click(); // triggers input.click() -> file chooser
  // input is hidden; use setInputFiles directly (equivalent to choosing a file)
  const chooser = page.waitForEvent('filechooser').catch(() => null);
  await page.evaluate(() => document.getElementById('fallback-input').click());
  // btn-open above already installed onchange; set files:
  await page.setInputFiles('#fallback-input', { name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('# Hi\n\n- a\n- b\n') });
  await expect(page.locator('#filename')).toHaveText('note.md');
  expect(await md(page)).toBe('# Hi\n\n- a\n- b\n');
  expect((await dirtyState(page)).dirty).toBe(false);
  expect(await page.title()).toBe('note.md — Markdown Editor');
});

test('dirty indicator: #filename.dirty + title bullet toggle on edit / revert / save', async ({ ext }) => {
  const { page } = await openEditor(ext, {});
  await setMd(page, 'base\n');
  await page.evaluate(() => { window.__mdwe.state.savedText = window.__mdwe.editor.getMarkdown(); });
  let s = await dirtyState(page); expect(s.cls).toBe(false); expect(s.title.startsWith('•')).toBe(false);
  await pm(page).click(); await page.keyboard.press('Control+End'); await page.keyboard.type('X');
  await expect(page.locator('#filename')).toHaveClass(/dirty/);
  s = await dirtyState(page); expect(s.title.startsWith('• ')).toBe(true);
  // revert edit -> should go clean after debounce
  await page.keyboard.press('Backspace');
  await expect(page.locator('#filename')).not.toHaveClass(/dirty/, { timeout: 3000 });
  s = await dirtyState(page); expect(s.title.startsWith('•')).toBe(false);
});

test('drag-drop simulation (DataTransfer with File) opens file', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['# Dropped\n\ntext\n'], 'dropped.md', { type: 'text/markdown' }));
    for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#filename')).toHaveText('dropped.md');
  expect(await md(page)).toBe('# Dropped\n\ntext\n');
  await expect(page.locator('#dropzone')).toBeHidden();
});

test('drag-drop with dirty doc asks to confirm (dialog handled)', async ({ ext }) => {
  const r = await openEditor(ext); const { page } = r;
  await pm(page).click(); await page.keyboard.type('unsaved');
  await expect(page.locator('#filename')).toHaveClass(/dirty/);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['# D2\n'], 'd2.md'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#filename')).toHaveText('d2.md');
  expect(r.dialogs.some((d) => d.startsWith('confirm: Discard'))).toBe(true);
});

test('#btn-download triggers download whose content equals getMarkdown()', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await setMd(page, '# Dl\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] t\n');
  const expected = await md(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-download').click()]);
  expect(dl.suggestedFilename()).toBe('Untitled.md');
  const p = await dl.path();
  expect(fs.readFileSync(p, 'utf8')).toBe(expected);
});

test('Download filename: opened name kept; non-md name gets .md appended', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await page.evaluate(() => { const d = new DataTransfer(); d.items.add(new File(['x\n'], 'notes.txt')); window.dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true })); });
  await expect(page.locator('#filename')).toHaveText('notes.txt');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-download').click()]);
  expect(dl.suggestedFilename()).toBe('notes.txt.md');
});

test('Save-as without FSA falls back to download; Ctrl+S / Ctrl+O / Ctrl+Shift+S do not crash', async ({ ext }) => {
  const r = await openEditor(ext, { init: () => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; } });
  const { page } = r;
  await setMd(page, 'abc\n');
  let [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-saveas').click()]);
  expect(fs.readFileSync(await dl.path(), 'utf8')).toBe('abc\n');
  [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(fs.readFileSync(await dl.path(), 'utf8')).toBe('abc\n');
  [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+Shift+s')]);
  const chooser = page.waitForEvent('filechooser', { timeout: 3000 });
  await page.keyboard.press('Control+o');
  const fc = await chooser; expect(fc.isMultiple()).toBe(false);
  await fc.setFiles({ name: 'viaCtrlO.md', mimeType: 'text/markdown', buffer: Buffer.from('# ctrl-o\n') });
  await expect(page.locator('#filename')).toHaveText('viaCtrlO.md');
  expect(r.errors).toEqual([]);
});

test('FSA stub: Ctrl+O opens via showOpenFilePicker; edit; Ctrl+S writes back to SAME handle (no Save As prompt)', async ({ ext }) => {
  const r = await openEditor(ext, { init: fsaStub(), arg: fsaArgs({ openContent: '# Opened\n\nhello\n' }) });
  const { page } = r;
  await page.keyboard.press('Control+o');
  await expect(page.locator('#filename')).toHaveText('opened.md');
  expect(await md(page)).toBe('# Opened\n\nhello\n');
  await pm(page).click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' world');
  await expect(page.locator('#filename')).toHaveClass(/dirty/);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#filename')).not.toHaveClass(/dirty/);
  const fsa = await page.evaluate(() => window.__fsa);
  expect(fsa.saveAsCalls, 'Save-as picker must not be shown for an opened handle').toBe(0);
  expect(fsa.writes.length).toBe(1);
  expect(fsa.writes[0].name).toBe('opened.md');
  expect(fsa.writes[0].text).toBe('# Opened\n\nhello world\n');
  expect(fsa.writes[0].text).toBe(await md(page));
  // second edit + second save -> same handle again
  await page.keyboard.type('!'); await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => window.__fsa.writes.length)).toBe(2);
  expect(await page.evaluate(() => window.__fsa.saveAsCalls)).toBe(0);
  expect(await page.title()).toBe('opened.md — Markdown Editor');
  expect(r.errors).toEqual([]);
});

test('FSA stub: untitled doc + Ctrl+S -> Save As picker -> writes; name updates; subsequent Ctrl+S reuses handle', async ({ ext }) => {
  const r = await openEditor(ext, { init: fsaStub(), arg: fsaArgs({ saveName: 'brand-new.md' }) });
  const { page } = r;
  await pm(page).click(); await page.keyboard.type('fresh doc');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#filename')).toHaveText('brand-new.md');
  let fsa = await page.evaluate(() => window.__fsa);
  expect(fsa.saveAsCalls).toBe(1); expect(fsa.files['brand-new.md']).toBe('fresh doc\n');
  await page.keyboard.type(' more'); await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => window.__fsa.writes.length)).toBe(2);
  fsa = await page.evaluate(() => window.__fsa);
  expect(fsa.saveAsCalls).toBe(1);
  expect(fsa.files['brand-new.md']).toBe('fresh doc more\n');
});

test('FSA stub: Save As (Ctrl+Shift+S) always prompts; Open cancelled (AbortError) is silent', async ({ ext }) => {
  const r = await openEditor(ext, { init: fsaStub(), arg: fsaArgs(), after: "window.showOpenFilePicker = async () => { throw new DOMException('cancel', 'AbortError'); };" });
  const { page } = r;
  await page.keyboard.press('Control+o');
  await page.waitForTimeout(300);
  await expect(page.locator('#status')).toHaveText('');
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => page.evaluate(() => window.__fsa.saveAsCalls)).toBe(1);
  expect(r.errors).toEqual([]);
});

test('Open while Source mode is on (BUGS #6): state stays consistent and content shows', async ({ ext }) => {
  const r = await openEditor(ext, { init: fsaStub(), arg: fsaArgs({ openContent: '# From file\n\nbody\n' }) });
  const { page } = r;
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await page.keyboard.press('Control+o');
  await expect(page.locator('#filename')).toHaveText('opened.md');
  const st = await page.evaluate(() => ({ src: document.querySelector('textarea.mdx-source').value, srcVisible: !document.querySelector('textarea.mdx-source').hidden, mode: window.__mdwe.editor.isSourceMode(), stateSource: window.__mdwe.state.source, getMd: window.__mdwe.editor.getMarkdown(), dirty: window.__mdwe.state.dirty }));
  console.log('Open-in-source-mode:', JSON.stringify(st));
  expect(st.src).toBe('# From file\n\nbody\n');
  expect(st.getMd).toBe('# From file\n\nbody\n');
  expect(st.mode).toBe(st.stateSource);
  expect(st.dirty).toBe(false);
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('From file');
});

test('Write failure on save surfaces status message, keeps dirty', async ({ ext }) => {
  const r = await openEditor(ext, { init: fsaStub(), arg: fsaArgs(), after: "(() => { const o = window.showOpenFilePicker; window.showOpenFilePicker = async () => { const [h] = await o(); h.createWritable = async () => { throw new Error('disk full'); }; return [h]; }; })();" });
  const { page } = r;
  await page.keyboard.press('Control+o'); await expect(page.locator('#filename')).toHaveText('opened.md');
  await pm(page).click(); await page.keyboard.type('x');
  await page.keyboard.press('Control+s');
  await expect(page.locator('#status')).toContainText('Save failed: disk full');
  await expect(page.locator('#filename')).toHaveClass(/dirty/);
});
