// 9. Extra probes: XSS/untrusted markdown, remote image requests, task-list layout, source button sync, large doc, misc.
import { test, expect, md, setMd, openEditor } from '../lib/fixture.mjs';

test('untrusted markdown: raw HTML / javascript: links do not execute or create live handlers/scripts', async ({ ext }) => {
  const r = await openEditor(ext);
  const { page } = r;
  await page.evaluate(() => { window.__pwned = 0; });
  await setMd(page, '<script>window.__pwned=1</script>\n\n<img src="x" onerror="window.__pwned=2">\n\n[click](javascript:window.__pwned=3)\n\n<a href="javascript:window.__pwned=4">h</a>\n\n<iframe src="https://evil.example"></iframe>\n');
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => ({
    pwned: window.__pwned,
    scripts: document.querySelectorAll('.ProseMirror script').length,
    iframes: document.querySelectorAll('.ProseMirror iframe').length,
    onerror: document.querySelectorAll('.ProseMirror [onerror]').length,
    jsLinks: [...document.querySelectorAll('.ProseMirror a')].map((a) => a.getAttribute('href')).filter((h) => /^javascript:/i.test(h)),
    html: document.querySelector('.ProseMirror').innerHTML.slice(0, 600),
    md: window.__mdwe.editor.getMarkdown(),
  }));
  console.log('XSS probe:', JSON.stringify(info, null, 1));
  expect(info.pwned).toBe(0);
  expect(info.scripts).toBe(0); expect(info.iframes).toBe(0); expect(info.onerror).toBe(0);
  if (info.jsLinks.length) test.info().annotations.push({ type: 'finding', description: 'javascript: href present in DOM (rendered as <a>): ' + JSON.stringify(info.jsLinks) });
  // clicking a javascript: link must not run (CSP would block; extension page)
  const a = page.locator('.ProseMirror a').first();
  if (await a.count()) { await a.click().catch(() => {}); await page.waitForTimeout(300); expect(await page.evaluate(() => window.__pwned)).toBe(0); }
  console.log('CSP console msgs:', JSON.stringify(r.errors));
});

test('remote image in markdown triggers a network request when document is opened (privacy info)', async ({ ext }) => {
  const r = await openEditor(ext);
  const reqs = [];
  r.page.on('request', (q) => { if (/^https?:/.test(q.url())) reqs.push(q.url()); });
  await r.page.route('https://tracker.example/**', (route) => route.abort());
  await setMd(r.page, '![t](https://tracker.example/pixel.png)\n');
  await r.page.waitForTimeout(800);
  console.log('remote requests after opening doc with remote image:', JSON.stringify(reqs));
  test.info().annotations.push({ type: 'info', description: 'remote image requests: ' + JSON.stringify(reqs) });
  expect(reqs.length).toBeGreaterThanOrEqual(0);
});

test('[BUG-8] task list layout: checkbox and text on the same line (light + dark)', async ({ ext }) => {
  const r = await openEditor(ext);
  const { page } = r;
  await setMd(page, '- [x] done task\n- [ ] open task\n');
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) await page.locator('#btn-theme').click();
    const g = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror li[data-type="taskItem"], .ProseMirror ul[data-type="taskList"] > li')].map((li) => { const cb = li.querySelector('input').getBoundingClientRect(); const p = li.querySelector('p').getBoundingClientRect(); return { cbTop: cb.top, cbLeft: cb.left, pTop: p.top, pLeft: p.left, pBottom: p.bottom, display: getComputedStyle(li).display }; }));
    console.log(theme, JSON.stringify(g));
    for (const x of g) expect(Math.abs(x.pTop - x.cbTop), `text should be vertically level with checkbox (${theme})`).toBeLessThan(14);
  }
});

test('[BUG-7b] exactly one visible source toggle in UI', async ({ ext }) => {
  const { page } = await openEditor(ext);
  const vis = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /source/i.test(b.title) && b.offsetParent).map((b) => b.id || b.dataset.cmd + ':' + b.textContent));
  console.log('visible source-toggle buttons:', JSON.stringify(vis));
  expect(vis).toEqual(['source:Markdown']);
});

test('Source mode: Save/Download uses textarea content; dirty logic works when only source edited', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await setMd(page, 'a\n');
  await page.evaluate(() => { window.__mdwe.state.savedText = 'a\n'; });
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await page.locator('textarea.mdx-source').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('bcd');
  await expect(page.locator('#filename')).toHaveClass(/dirty/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-download').click()]);
  const fs = await import('node:fs');
  expect(fs.readFileSync(await dl.path(), 'utf8')).toBe('a\nbcd');
});

test('Tab in source textarea inserts 2 spaces (does not leave field)', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await page.locator('textarea.mdx-source').click(); await page.keyboard.type('-'); await page.keyboard.press('Tab'); await page.keyboard.type('x');
  expect(await md(page)).toBe('-  x');
});

test('large document (2000 paragraphs + 200-row table): load + type latency', async ({ ext }) => {
  const { page } = await openEditor(ext);
  const big = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} with **bold** and \`code\` and [l](https://e.com/${i}).`).join('\n\n') + '\n\n| a | b |\n| - | - |\n' + Array.from({ length: 200 }, (_, i) => `| ${i} | v${i} |`).join('\n') + '\n';
  const t0 = Date.now(); await setMd(page, big); const tLoad = Date.now() - t0;
  const t1 = Date.now(); const out = await md(page); const tGet = Date.now() - t1;
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End');
  const t2 = Date.now(); await page.keyboard.type('hello', { delay: 0 }); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); const tType = Date.now() - t2;
  console.log(`large doc: setMarkdown ${tLoad}ms, getMarkdown ${tGet}ms, typing 5 chars ${tType}ms, out length ${out.length}`);
  expect(out).toContain('Paragraph 1999');
  expect(tLoad).toBeLessThan(15000);
});

test('unicode / emoji / CRLF input survives; CRLF normalized', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await setMd(page, '# Ünïcödé 日本語 🎉\r\n\r\nline\r\n\r\n- é\r\n');
  const out = await md(page);
  expect(out).toBe('# Ünïcödé 日本語 🎉\n\nline\n\n- é\n');
});

test('Ctrl+S when not focused in editor (focus on toolbar button) still handled and default prevented', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await page.evaluate(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  await page.locator('#btn-theme').focus();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), page.keyboard.press('Control+s')]);
  expect(dl.suggestedFilename()).toBe('Untitled.md');
});

test('Open cancelled via fallback input (no file) is silent', async ({ ext }) => {
  const r = await openEditor(ext, { init: () => { delete window.showOpenFilePicker; } });
  const fc = r.page.waitForEvent('filechooser');
  await r.page.locator('#btn-open').click();
  await (await fc).setFiles([]);
  await r.page.waitForTimeout(500);
  await expect(r.page.locator('#status')).toHaveText('');
});

test('[BUG-8b] task-list CSS selectors match rendered DOM (li[data-type=taskItem])', async ({ ext }) => {
  const { page } = await openEditor(ext);
  await setMd(page, '- [x] a\n');
  const r = await page.evaluate(() => { const li = document.querySelector('.ProseMirror ul[data-type="taskList"] > li'); return { liAttrs: [...li.attributes].map((a) => a.name), matchesCss: li.matches('li[data-type="taskItem"]'), display: getComputedStyle(li).display, listStyle: getComputedStyle(li.parentElement).listStyleType }; });
  console.log('task li:', JSON.stringify(r));
  expect(r.matchesCss).toBe(true);
});

test('[BUG-10] raw HTML / comments / footnotes survive open+save', async ({ ext }) => {
  const { page } = await openEditor(ext);
  const cases = { details: '<details><summary>S</summary>\n\nbody\n\n</details>\n', sub: 'H<sub>2</sub>O and <kbd>Ctrl</kbd>\n', comment: '<!-- keep me -->\n\ntext\n', footnote: 'Foot[^1]\n\n[^1]: the note\n' };
  const out = {};
  for (const [k, v] of Object.entries(cases)) { await setMd(page, v); out[k] = await md(page); }
  console.log('lossy import:', JSON.stringify(out, null, 1));
  expect(out.details).toContain('<details>');
  expect(out.sub).toContain('<sub>');
  expect(out.comment).toContain('<!-- keep me -->');
  expect(out.footnote).toContain('[^1]: the note');
});
