// 6. Autosave / draft, ?src=file:// handling, BUGS #1-#4 verification.
import { test, expect, md, setMd, openEditor, fsaArgs, fsaStub, storageGet } from '../lib/fixture.mjs';

const pm = (page) => page.locator('#editor-host .ProseMirror');
const draft = (page) => storageGet(page, 'mdwe.draft');
// Init script: serve file:// URLs from an in-memory map (independent of "Allow access to file URLs").
const fetchStub = ({ map }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...r) => { u = String(u); if (u.startsWith('file://')) { if (u in map) return new Response(map[u], { status: 200 }); return new Response('nf', { status: 404 }); } return of(u, ...r); }; };

test('autosave: edit -> after >800ms chrome.storage.local[mdwe.draft] holds getMarkdown()', async ({ ext }) => {
  const { page } = await openEditor(ext);
  expect(await draft(page)).toBeUndefined();
  await pm(page).click(); await page.keyboard.type('draft text');
  await page.waitForTimeout(400);
  expect(await draft(page), 'no draft before 800ms debounce').toBeUndefined();
  await expect.poll(() => draft(page), { timeout: 4000 }).toBeTruthy();
  const d = await draft(page);
  expect(d.text).toBe('draft text\n'); expect(d.name).toBe('Untitled.md'); expect(typeof d.savedAt).toBe('number');
  await expect(page.locator('#status')).toContainText(/Draft autosaved|^$/);
});

test('reload restores draft and marks dirty', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await pm(page).click(); await page.keyboard.type('keep me');
  await expect.poll(() => draft(page)).toBeTruthy();
  await page.evaluate(() => { window.onbeforeunload = null; });
  // beforeunload dialog auto-accepted by helper
  await page.reload();
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  await expect.poll(() => md(page)).toBe('keep me\n');
  await expect(page.locator('#filename')).toHaveClass(/dirty/);
  expect(await page.title()).toMatch(/^• /);
  await expect(page.locator('#status')).toContainText('Restored autosaved draft');
});

test('Save (FSA stub) clears draft; reload afterwards starts empty', async ({ ext }) => {
  const r = await openEditor(ext, { init: fsaStub(), arg: fsaArgs({ saveName: 's.md' }) });
  const { page } = r;
  await pm(page).click(); await page.keyboard.type('to save');
  await expect.poll(() => draft(page)).toBeTruthy();
  await page.keyboard.press('Control+s');
  await expect(page.locator('#filename')).toHaveText('s.md');
  await expect.poll(() => draft(page)).toBeUndefined();
  await page.reload(); await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  expect(await md(page)).toBe('');
  await expect(page.locator('#filename')).not.toHaveClass(/dirty/);
});

test('reverting edits back to saved text removes the draft', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await pm(page).click(); await page.keyboard.type('a');
  await expect.poll(() => draft(page)).toBeTruthy();
  await page.keyboard.press('Backspace');
  await expect.poll(() => draft(page), { timeout: 4000 }).toBeUndefined();
});

test('BUG#1 verify: opening ?src=file:// keeps an existing draft (no silent deletion)', async ({ ext }) => {
  const url = 'file:///tmp/x.md';
  const first = await openEditor(ext);
  await pm(first.page).click(); await first.page.keyboard.type('precious unsaved work');
  await expect.poll(() => draft(first.page)).toBeTruthy();
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: '# From file\n\nhello file\n' } } });
  await expect(r.page.locator('#filename')).toHaveText('x.md');
  expect(await md(r.page)).toBe('# From file\n\nhello file\n');
  const d = await draft(r.page);
  console.log('draft after ?src open:', JSON.stringify(d));
  expect(d && d.text, 'draft must survive ?src load').toBe('precious unsaved work\n');
  await expect(r.page.locator('#status')).toContainText('draft');
  await expect(r.page.locator('#filename')).not.toHaveClass(/dirty/);
});

test('BUG#1 follow-up: draft kept after ?src open is restored on next plain open', async ({ ext }) => {
  const url = 'file:///tmp/x.md';
  const first = await openEditor(ext);
  await pm(first.page).click(); await first.page.keyboard.type('precious');
  await expect.poll(() => draft(first.page)).toBeTruthy();
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: 'x\n' } } });
  await expect(r.page.locator('#filename')).toHaveText('x.md');
  const p3 = await openEditor(ext);
  await expect.poll(() => md(p3.page)).toBe('precious\n');
});

test('BUG#1 side effect probe: after ?src open, a later Save/edit-revert overwrites or clears the kept draft?', async ({ ext }) => {
  const url = 'file:///tmp/x.md';
  const first = await openEditor(ext);
  await pm(first.page).click(); await first.page.keyboard.type('precious');
  await expect.poll(() => draft(first.page)).toBeTruthy();
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: 'x\n' } } });
  await expect(r.page.locator('#filename')).toHaveText('x.md');
  await pm(r.page).click(); await r.page.keyboard.press('Control+End'); await r.page.keyboard.type('y');
  await expect(r.page.locator('#filename')).toHaveClass(/dirty/);
  await r.page.waitForTimeout(1500);
  const d = await draft(r.page);
  console.log('draft after editing file-backed doc in 2nd tab:', JSON.stringify(d));
  // Not asserting: report only. (Editing the ?src doc overwrites the single-slot draft: expected for single-slot design.)
  expect(d).toBeTruthy();
});

test('BUG#2 verify: malformed %-sequence in ?src no longer throws in decodeURIComponent (name falls back to raw)', async ({ ext }) => {
  const url = 'file:///tmp/bad%E0%A4%A.md';
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: '# ok\n' } } });
  await expect(r.page.locator('#filename')).toHaveText('bad%E0%A4%A.md');
  expect(await md(r.page)).toBe('# ok\n');
  expect(r.errors).toEqual([]);
});

test('?src with %20 decodes filename', async ({ ext }) => {
  const url = 'file:///tmp/my%20notes.md';
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fetchStub, arg: { map: { [url]: '# n\n' } } });
  await expect(r.page.locator('#filename')).toHaveText('my notes.md');
});

test('BUG#4 verify: ?src doc status says Ctrl+S will ask where to save; Ctrl+S -> Save As picker', async ({ ext }) => {
  const url = 'file:///tmp/x.md';
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent(url), init: fsaStub(), arg: fsaArgs({ saveName: 'x.md' }), after: `(${fetchStub.toString()})({ map: ${JSON.stringify({ [url]: '# x\n' })} });` });
  await expect(r.page.locator('#status')).toContainText('Ctrl+S will ask where to save');
  await r.page.keyboard.press('Control+s');
  await expect.poll(() => r.page.evaluate(() => window.__fsa.saveAsCalls)).toBe(1);
  await expect.poll(() => r.page.evaluate(() => window.__fsa.files['x.md'])).toBe('# x\n');
});

test('?src fetch failure: real file:// (no file-URL access in this harness) reports error gracefully', async ({ ext }) => {
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent('file:///tmp/x.md') });
  await page_wait(r.page);
  const st = await r.page.locator('#status').textContent();
  const body = await md(r.page);
  console.log('REAL fetch(file:///tmp/x.md) from extension page -> status:', JSON.stringify(st), '| editor content:', JSON.stringify(body), '| errors:', JSON.stringify(r.errors));
  // Either it works (file access allowed) or fails with the friendly message. Both acceptable; page must stay usable.
  if (body.includes('hello file')) test.info().annotations.push({ type: 'info', description: 'real file:// fetch WORKED' });
  else { expect(st).toMatch(/Could not read file/); test.info().annotations.push({ type: 'info', description: 'real file:// fetch failed gracefully: ' + st }); }
  await pm(r.page).click(); await r.page.keyboard.type('still works');
  expect(await md(r.page)).toContain('still works');
});
async function page_wait(page) { await page.waitForTimeout(1200); }

test('[BUG-11] BUG#3 residual: type then unload immediately (<250ms onChange debounce) -> is text kept in draft?', async ({ ext }) => {
  const a = await openEditor(ext);
  const { page } = a;
  await pm(page).click();
  await page.keyboard.type('quick edit');
  // close right away with beforeunload handlers running
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1000));
  const p2 = await openEditor(ext);
  const d = await draft(p2.page);
  const content = await md(p2.page);
  console.log('after immediate close: draft=', JSON.stringify(d), ' reopened content=', JSON.stringify(content));
  expect(d && d.text, 'text typed <250ms before unload should still be in the draft').toBe('quick edit\n');
});

test('BUG#3 probe: type, wait 400ms (onChange fired, autosave pending), then close -> draft flushed?', async ({ ext }) => {
  const a = await openEditor(ext);
  const { page } = a;
  await pm(page).click();
  await page.keyboard.type('flush me');
  await page.waitForTimeout(400);
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1000));
  const p2 = await openEditor(ext);
  const d = await draft(p2.page);
  console.log('after close at 400ms: draft=', JSON.stringify(d));
  expect(d && d.text).toBe('flush me\n');
});

test('draft persists ALL edit types incl. source-mode edits', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await page.locator('textarea.mdx-source').click(); await page.keyboard.type('# from source');
  await expect.poll(() => draft(page), { timeout: 4000 }).toBeTruthy();
  expect((await draft(page)).text).toBe('# from source');
});
