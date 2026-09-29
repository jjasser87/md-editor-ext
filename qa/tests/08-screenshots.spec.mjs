// 8. Screenshots of light / dark editor states -> qa/screens/
import { test, expect, openEditor, setMd, SCREENS } from '../lib/fixture.mjs';
import fs from 'node:fs'; import path from 'node:path';

const DOC = `# Markdown WYSIWYG

Some **bold**, *italic*, ~~strike~~, \`inline code\` and a [link](https://example.com).

## Lists

- bullet one
- bullet two
  - nested

1. first
2. second

- [x] done task
- [ ] open task

> A blockquote

\`\`\`js
function hello(name) {
  return \`Hello, \${name}!\`; // comment
}
\`\`\`

| Name | Qty |
| --- | --- |
| Apple | 3 |
| Pear | 10 |

---
`;

test('screenshots: light, dark, source (light+dark)', async ({ ext }) => {
  fs.mkdirSync(SCREENS, { recursive: true });
  const { page } = await openEditor(ext, { init: () => { /* force light scheme regardless of host */ } });
  await page.emulateMedia({ colorScheme: 'light' });
  // ensure light first
  if ((await page.locator('html').getAttribute('data-theme')) !== 'light') await page.locator('#btn-theme').click();
  await setMd(page, DOC);
  await page.locator('#editor-host .ProseMirror').click();
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENS, 'editor-light.png') });
  await page.locator('#btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENS, 'editor-dark.png') });
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENS, 'source-dark.png') });
  await page.locator('#btn-theme').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SCREENS, 'source-light.png') });
  // dirty + table active state in dark
  await page.locator('.mdx-toolbar [data-cmd="source"]').click();
  await page.locator('#btn-theme').click();
  await page.locator('.ProseMirror td').first().click();
  await page.keyboard.type('!');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENS, 'editor-dark-dirty-table.png') });
  for (const f of ['editor-light', 'editor-dark', 'source-dark', 'source-light', 'editor-dark-dirty-table']) expect(fs.statSync(path.join(SCREENS, f + '.png')).size).toBeGreaterThan(5000);
});
