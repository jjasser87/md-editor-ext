// 7. content script on file://*.md. Requires extension file-URL access; in this harness (Playwright Chromium, --load-extension) we probe what happens.
import { test, expect, openEditor } from '../lib/fixture.mjs';
import fs from 'node:fs';

test('missing file via ?src: graceful error, editor usable', async ({ ext }) => {
  const r = await openEditor(ext, { query: '?src=' + encodeURIComponent('file:///tmp/definitely-not-here-12345.md') });
  await expect(r.page.locator('#status')).toContainText(/Could not read file/);
  console.log('status for missing file:', await r.page.locator('#status').textContent());
  expect(r.errors.filter((e) => !/ERR_FILE_NOT_FOUND|requestfailed: file:\/\/\/tmp\/definitely-not-here/.test(e)), 'only the browser-level failed-load line is allowed').toEqual([]);
});

test('file:///tmp/test.md: "Edit in Markdown Editor" button appears and opens the editor with content', async ({ ext }) => {
  fs.writeFileSync('/tmp/test.md', '# Test file\n\nhello from disk\n');
  const page = await ext.ctx.newPage();
  const resp = await page.goto('file:///tmp/test.md').catch((e) => ({ err: e.message }));
  console.log('goto file:///tmp/test.md ->', resp && resp.err ? resp.err : `status ${resp && resp.status && resp.status()}`, '| url:', page.url(), '| content-type:', resp && resp.headers ? JSON.stringify(await resp.headers()) : 'n/a');
  const btn = page.locator('#__mdwe_btn');
  let appeared = true;
  try { await btn.waitFor({ timeout: 5000 }); } catch { appeared = false; }
  console.log('content-script button present:', appeared);
  if (!appeared) {
    test.info().annotations.push({ type: 'manual', description: 'Button did not appear: content script not injected (file-URL access likely off) or page rendered as download. Verify manually.' });
    test.skip(true, 'content script not injected in this harness -> MANUAL');
  }
  await expect(btn).toHaveText('✎ Edit in Markdown Editor');
  await btn.click();
  await page.waitForURL(/chrome-extension:\/\/.*\/editor\/index\.html\?src=/, { timeout: 8000 });
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  await expect(page.locator('#filename')).toHaveText('test.md');
  expect(await page.evaluate(() => window.__mdwe.editor.getMarkdown())).toBe('# Test file\n\nhello from disk\n');
});

test('content script: injected once, no duplicate button on .markdown, not on .txt', async ({ ext }) => {
  fs.writeFileSync('/tmp/test2.markdown', '# two\n'); fs.writeFileSync('/tmp/test3.txt', 'plain\n');
  const p1 = await ext.ctx.newPage(); await p1.goto('file:///tmp/test2.markdown').catch(() => {});
  await p1.waitForTimeout(1500);
  const n1 = await p1.locator('#__mdwe_btn').count();
  const p2 = await ext.ctx.newPage(); await p2.goto('file:///tmp/test3.txt').catch(() => {});
  await p2.waitForTimeout(1500);
  const n2 = await p2.locator('#__mdwe_btn').count();
  console.log('button count .markdown:', n1, ' .txt:', n2);
  expect(n2).toBe(0);
  expect(n1).toBeLessThanOrEqual(1);
  if (n1 === 0) test.info().annotations.push({ type: 'manual', description: '.markdown: button absent (file access off or download)' });
});
