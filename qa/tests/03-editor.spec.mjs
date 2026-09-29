// 3. Editor behaviour: typing, toolbar commands, source toggle, theme toggle.
import { test, expect, md, setMd, storageGet } from '../lib/fixture.mjs';

const tb = (page, cmd) => page.locator(`.mdx-toolbar [data-cmd="${cmd}"]`);
const pm = (page) => page.locator('#editor-host .ProseMirror');
async function fresh(page) { await setMd(page, ''); await pm(page).click(); }

test('typing plain text', async ({ editor: { page } }) => {
  await pm(page).click();
  await page.keyboard.type('Hello world');
  expect(await md(page)).toBe('Hello world\n');
});

test('bold / italic / strike / inline code via toolbar', async ({ editor: { page } }) => {
  await fresh(page);
  await tb(page, 'bold').click(); await page.keyboard.type('b'); await tb(page, 'bold').click();
  await page.keyboard.type(' '); await tb(page, 'italic').click(); await page.keyboard.type('i'); await tb(page, 'italic').click();
  await page.keyboard.type(' '); await tb(page, 'strike').click(); await page.keyboard.type('s'); await tb(page, 'strike').click();
  await page.keyboard.type(' '); await tb(page, 'code').click(); await page.keyboard.type('c'); await tb(page, 'code').click();
  expect(await md(page)).toBe('**b** *i* ~~s~~ `c`\n');
});

test('bold via Ctrl+B on selection', async ({ editor: { page } }) => {
  await fresh(page);
  await page.keyboard.type('word');
  await page.keyboard.press('Control+a');
  await page.waitForFunction(() => !window.__mdwe.editor.tiptap.state.selection.empty); // selectionchange -> PM is async
  await page.keyboard.press('Control+b');
  expect(await md(page)).toBe('**word**\n');
});

test('heading via block select (H1,H2,H3, back to paragraph)', async ({ editor: { page } }) => {
  await fresh(page);
  await page.keyboard.type('Title');
  const sel = page.locator('.mdx-toolbar select[data-cmd="block"]');
  for (const [v, exp] of [['1', '# Title\n'], ['2', '## Title\n'], ['3', '### Title\n'], ['p', 'Title\n']]) {
    await sel.selectOption(v);
    expect(await md(page), 'select ' + v).toBe(exp);
  }
});

test('bullet, ordered, task list, blockquote, hr', async ({ editor: { page } }) => {
  await fresh(page);
  await tb(page, 'bullet').click(); await page.keyboard.type('a'); await page.keyboard.press('Enter'); await page.keyboard.type('b');
  expect(await md(page)).toBe('- a\n- b\n');
  await setMd(page, ''); await pm(page).click();
  await tb(page, 'ordered').click(); await page.keyboard.type('one'); await page.keyboard.press('Enter'); await page.keyboard.type('two');
  expect(await md(page)).toBe('1. one\n2. two\n');
  await setMd(page, ''); await pm(page).click();
  await tb(page, 'task').click(); await page.keyboard.type('todo'); await page.keyboard.press('Enter'); await page.keyboard.type('done');
  expect(await md(page)).toBe('- [ ] todo\n- [ ] done\n');
  // click checkbox of 2nd item
  await page.locator('ul[data-type="taskList"] li input[type="checkbox"]').nth(1).click();
  expect(await md(page)).toBe('- [ ] todo\n- [x] done\n');
  await setMd(page, ''); await pm(page).click();
  await tb(page, 'quote').click(); await page.keyboard.type('q');
  expect(await md(page)).toBe('> q\n');
  await setMd(page, 'x'); await pm(page).click(); await page.keyboard.press('Control+End');
  await tb(page, 'hr').click();
  expect(await md(page)).toMatch(/^x\n\n---\n/);
});

test('table insert + type in cells + add row/col', async ({ editor: { page } }) => {
  await fresh(page);
  await tb(page, 'table').click();
  await page.keyboard.type('A'); await page.keyboard.press('Tab'); await page.keyboard.type('B'); await page.keyboard.press('Tab'); await page.keyboard.type('C');
  await page.keyboard.press('Tab'); await page.keyboard.type('1');
  let out = await md(page);
  expect(out).toMatch(/^\| A\s*\| B\s*\| C\s*\|\n\| -+ \| -+ \| -+ \|\n\| 1\s*\|/);
  await tb(page, 'addCol').click(); await tb(page, 'addRow').click();
  out = await md(page);
  console.log('table after +col +row:\n' + out);
  const rows = out.trim().split('\n');
  expect(rows.length).toBe(5); // header, sep, 3 body rows
  expect(rows[0].split('|').length - 2).toBe(4);
  await tb(page, 'delTable').click();
  expect((await md(page)).includes('|')).toBe(false);
});

test('link via toolbar popover (selection) and Ctrl+K (empty selection inserts url)', async ({ editor: { page } }) => {
  await fresh(page);
  await page.keyboard.type('site');
  await page.keyboard.press('Shift+Home');
  await tb(page, 'link').click();
  await expect(page.locator('.mdx-popover')).toBeVisible();
  await page.locator('.mdx-popover input').fill('https://example.com/a');
  await page.keyboard.press('Enter');
  expect(await md(page)).toBe('[site](https://example.com/a)\n');
  // javascript: URL rejected
  await setMd(page, ''); await pm(page).click();
  await page.keyboard.type('bad'); await page.keyboard.press('Shift+Home');
  await tb(page, 'link').click();
  await page.locator('.mdx-popover input').fill('javascript:alert(1)');
  await page.keyboard.press('Enter');
  expect(await md(page)).not.toMatch(/javascript:/i);
  // Ctrl+K
  await setMd(page, ''); await pm(page).click();
  await page.keyboard.press('Control+k');
  await expect(page.locator('.mdx-popover')).toBeVisible();
  await page.locator('.mdx-popover input').fill('https://k.example');
  await page.keyboard.press('Enter');
  expect(await md(page)).toContain('https://k.example');
});

test('image via URL popover', async ({ editor: { page } }) => {
  await fresh(page);
  await tb(page, 'image').click();
  await page.locator('.mdx-popover input').fill('https://example.com/i.png');
  await page.keyboard.press('Enter');
  expect(await md(page)).toBe('![](https://example.com/i.png)\n');
});

test('code block via toolbar (with ``` inside content uses longer fence)', async ({ editor: { page } }) => {
  await fresh(page);
  await tb(page, 'codeBlock').click();
  await page.keyboard.type('let x = 1;'); await page.keyboard.press('Enter'); await page.keyboard.type('y');
  expect(await md(page)).toBe('```\nlet x = 1;\ny\n```\n');
  await setMd(page, '````js\nconsole.log(1)\n```\ninner\n```\n````\n');
  expect(await md(page)).toBe('````js\nconsole.log(1)\n```\ninner\n```\n````\n');
});

test('undo / redo toolbar', async ({ editor: { page } }) => {
  await fresh(page);
  await page.keyboard.type('abc');
  await tb(page, 'undo').click();
  expect(await md(page)).toBe('');
  await tb(page, 'redo').click();
  expect(await md(page)).toBe('abc\n');
});

test('source toggle: shows markdown, edits round-trip back into WYSIWYG', async ({ editor: { page } }) => {
  await setMd(page, '# T\n\n**b** text\n');
  const btn = page.locator('.mdx-toolbar [data-cmd="source"]');
  await btn.click();
  const ta = page.locator('textarea.mdx-source');
  await expect(ta).toBeVisible();
  await expect(page.locator('.mdx-wysiwyg')).toBeHidden();
  expect(await ta.inputValue()).toBe('# T\n\n**b** text\n');
  expect(await page.evaluate(() => window.__mdwe.state.source)).toBe(true);
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  // edit in source
  await ta.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- added');
  expect(await md(page), 'getMarkdown in source mode reflects textarea').toBe('# T\n\n**b** text\n\n- added');
  await btn.click();
  await expect(page.locator('.mdx-wysiwyg')).toBeVisible();
  await expect(page.locator('.ProseMirror ul li')).toHaveText('added');
  expect(await md(page)).toBe('# T\n\n**b** text\n\n- added\n');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
});

test('[BUG-7] single source toggle (top-bar #btn-source removed); state.source follows editor', async ({ editor: { page } }) => {
  expect(await page.locator('#btn-source').count(), 'top-bar #btn-source should be gone').toBe(0);
  const inner = page.locator('.mdx-toolbar [data-cmd="source"]');
  await expect(inner).toHaveCount(1);
  await inner.click();
  let st = await page.evaluate(() => ({ state: window.__mdwe.state.source, actual: window.__mdwe.editor.isSourceMode(), pressed: document.querySelector('.mdx-toolbar [data-cmd="source"]').getAttribute('aria-pressed') }));
  expect(st).toEqual({ state: true, actual: true, pressed: 'true' });
  await inner.click();
  st = await page.evaluate(() => ({ state: window.__mdwe.state.source, actual: window.__mdwe.editor.isSourceMode(), pressed: document.querySelector('.mdx-toolbar [data-cmd="source"]').getAttribute('aria-pressed') }));
  expect(st).toEqual({ state: false, actual: false, pressed: 'false' });
});

test('theme toggle sets html[data-theme], editor root theme, persists in chrome.storage.local', async ({ editor: { page } }) => {
  const html = page.locator('html');
  const start = await html.getAttribute('data-theme');
  const other = start === 'dark' ? 'light' : 'dark';
  await page.locator('#btn-theme').click();
  await expect(html).toHaveAttribute('data-theme', other);
  await expect(page.locator('.mdx-root')).toHaveAttribute('data-theme', other);
  await expect.poll(() => storageGet(page, 'mdwe.theme')).toBe(other);
  await page.locator('#btn-theme').click();
  await expect(html).toHaveAttribute('data-theme', start);
  await expect.poll(() => storageGet(page, 'mdwe.theme')).toBe(start);
  // persists across reload
  await page.locator('#btn-theme').click();
  await page.reload();
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  await expect(html).toHaveAttribute('data-theme', other);
  await expect(page.locator('.mdx-root')).toHaveAttribute('data-theme', other);
});
