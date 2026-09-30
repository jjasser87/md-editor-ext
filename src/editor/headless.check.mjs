// Headless Chromium check of Mermaid + KaTeX inside the REAL built extension (extension/ must be built: npm run build).
// Run: node src/editor/headless.check.mjs      (uses Playwright from qa/node_modules; writes nothing into qa/)
// Verifies: SVG present, 3 subgraphs, .katex present, invalid mermaid -> inline error (no throw / no stray DOM),
// no CSP violations / console errors, dark-mode re-render, per-block source toggle + re-render, math click-to-edit,
// toolbar Diagram/Math actions, byte-exact getMarkdown, fonts served from the extension.
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const require = createRequire(join(ROOT, 'qa', 'package.json'));
const { chromium } = require('playwright');
const EXT = join(ROOT, 'extension');
const fx = (f) => readFileSync(join(here, 'fixtures', f), 'utf8');

let fails = 0, n = 0;
const ok = (name, cond, detail = '') => { n++; if (!cond) { fails++; console.log(`FAIL ${name} ${detail}`); } else console.log(`ok   ${name}`); };

const dir = mkdtempSync(join(tmpdir(), 'mdx-headless-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const page = await ctx.newPage();
  const problems = [], csp = [], reqs = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(t)) problems.push(`${m.type()}: ${t}`); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
  page.on('request', (r) => reqs.push(r.url()));
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await page.goto(`chrome-extension://${extId}/editor/index.html`);
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);

  const flow = fx('13-mermaid-flowchart.md');
  const doc = `${flow}\n${fx('14-mermaid-sequence.md')}\n${fx('15-mermaid-invalid.md')}\n${fx('16-math-inline.md')}\n${fx('17-math-block.md')}\n${fx('18-math-multiline.md')}\n${fx('19-dollar-prices.md')}\n${fx('20-math-in-code.md')}`;
  const bootReqs = reqs.filter((u) => /assets\//.test(u)).length;
  await page.evaluate((d) => window.__mdwe.editor.setMarkdown(d), doc);
  await page.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"] .mdx-mermaid-render svg, [data-mdx-node="mermaid"] .mdx-error').length >= 4, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.katex').length >= 5, null, { timeout: 30000 });

  const q = (sel) => page.locator(sel);
  const nodes = q('[data-mdx-node="mermaid"]');
  ok('4 mermaid nodes (flow, sequence, graph~~~, invalid x2 => 5?)', (await nodes.count()) === 5, String(await nodes.count()));
  const first = nodes.nth(0);
  ok('flowchart renders <svg>', (await first.locator('.mdx-mermaid-render svg').count()) === 1);
  ok('flowchart has NO error', (await first.locator('.mdx-error').count()) === 0);
  ok('flowchart has 3 subgraph clusters', (await first.locator('svg .cluster').count()) === 3, String(await first.locator('svg .cluster').count()));
  const flowText = await first.locator('svg').innerText().catch(() => '');
  const svgText = await first.evaluate((el) => el.querySelector('svg').textContent);
  for (const label of ['BBS / UGC / Census 2022', 'Threshold Mapping T_E=14, T_I=60', 'Causal Benchmark & Holdout Scoring', 'Raw Event Counts', 'GDELT 2.0 Event Database'])
    ok(`label rendered under strict: ${label}`, svgText.includes(label), svgText.slice(0, 80));
  ok('sequence diagram svg', (await nodes.nth(1).locator('svg').count()) === 1 && (await nodes.nth(1).locator('.mdx-error').count()) === 0);
  ok('~~~mermaid graph svg', (await nodes.nth(2).locator('svg').count()) === 1);
  ok('invalid mermaid (syntax junk) -> inline error, no svg', (await nodes.nth(3).locator('.mdx-error[data-mdx-error="mermaid"]').count()) === 1 && (await nodes.nth(3).locator('svg').count()) === 0);
  ok('collapsed single-line flowchart -> inline error', (await nodes.nth(4).locator('.mdx-error[data-mdx-error="mermaid"]').count()) === 1);
  console.log('   error text:', (await nodes.nth(4).locator('.mdx-error').innerText()).replace(/\s+/g, ' ').slice(0, 140));

  // stray mermaid DOM outside the editor
  const stray = await page.evaluate(() => [...document.body.children].filter((e) => /^(d?mdx-mmd|i?mdx-mmd|dmermaid|mermaid)/.test(e.id) || (e.tagName === 'svg') || (e.tagName === 'DIV' && e.id && /^d?mdx-mmd/.test(e.id))).map((e) => e.tagName + '#' + e.id));
  ok('no stray mermaid elements under <body>', stray.length === 0, JSON.stringify(stray));
  ok('no stray "syntax error in text" bomb anywhere', (await page.evaluate(() => /Syntax error in text/.test(document.body.innerText) && !document.querySelector('.mdx-error'))) === false);

  // math
  ok('.katex present (inline)', (await q('span[data-mdx-node="math-inline"] .katex').count()) >= 4, String(await q('span[data-mdx-node="math-inline"] .katex').count()));
  ok('.katex-display present (block)', (await q('div[data-mdx-node="math-block"] .katex').count()) >= 3, String(await q('div[data-mdx-node="math-block"] .katex').count()));
  ok('MathML emitted (htmlAndMathml)', (await q('.katex .katex-mathml math').count()) > 0);
  ok('bad LaTeX -> inline .mdx-error[data-mdx-error=math], no throw', (await q('span[data-mdx-node="math-inline"] .mdx-error[data-mdx-error="math"]').count()) === 1);
  const prices = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror p')].find((p) => /costs \$5 and \$10/.test(p.textContent))?.querySelector('.katex') ?? null);
  ok('dollar-price paragraph has no math', prices === null);
  const codeDollar = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror code')].some((c) => c.textContent === '$x^2$') && !document.querySelector('.ProseMirror pre .katex'));
  ok('math in code stays literal', codeDollar);
  const fontOk = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => /KaTeX/.test(f.family) && f.status === 'loaded').length; });
  ok('KaTeX fonts loaded from extension', fontOk > 0, String(fontOk));
  ok('font requests are chrome-extension:// only', reqs.filter((u) => /\.(woff2?|ttf)/.test(u)).every((u) => u.startsWith(`chrome-extension://${extId}/`)) && reqs.some((u) => /\.woff2/.test(u)));
  ok('no non-extension requests', reqs.filter((u) => !/^(chrome-extension|data|blob):/.test(u)).length === 0, JSON.stringify(reqs.filter((u) => !/^(chrome-extension|data|blob):/.test(u))));
  const mathColor = await page.evaluate(() => { const k = document.querySelector('.mdx-root .katex'); return getComputedStyle(k).color === getComputedStyle(document.querySelector('.mdx-root')).color; });
  ok('math inherits text color (light)', mathColor);

  // byte-exact
  ok('getMarkdown() byte-identical while unedited', (await page.evaluate(() => window.__mdwe.editor.getMarkdown())) === doc);
  ok('source mode shows raw text', await page.evaluate((d) => { const e = window.__mdwe.editor; e.setSourceMode(true); const v = document.querySelector('textarea.mdx-source').value; e.setSourceMode(false); return v === d; }, doc));
  await page.waitForTimeout(1500);
  ok('nodes still rendered after source toggle', (await nodes.nth(0).locator('svg .cluster').count()) === 3);

  // dark mode re-render
  const fillOf = () => first.evaluate((el) => { const r = el.querySelector('svg .cluster rect') || el.querySelector('svg rect'); return r ? getComputedStyle(r).fill : null; });
  const idOf = () => first.evaluate((el) => el.querySelector('svg').id);
  const light = { fill: await fillOf(), id: await idOf(), bg: await first.evaluate((el) => getComputedStyle(el.querySelector('svg .node rect, svg .node polygon')).fill) };
  await page.evaluate(() => window.__mdwe.editor.setTheme('dark'));
  await page.waitForFunction((id) => { const s = document.querySelector('[data-mdx-node="mermaid"] svg'); return s && s.id !== id; }, light.id, { timeout: 30000 });
  await page.waitForTimeout(500);
  const dark = { fill: await fillOf(), id: await idOf(), bg: await first.evaluate((el) => getComputedStyle(el.querySelector('svg .node rect, svg .node polygon')).fill) };
  console.log('   light cluster/node fill:', light.fill, '/', light.bg, ' dark:', dark.fill, '/', dark.bg);
  ok('dark theme re-renders the diagram with different colors', dark.bg !== light.bg || dark.fill !== light.fill);
  ok('dark: 3 clusters still, no error', (await first.locator('svg .cluster').count()) === 3 && (await first.locator('.mdx-error').count()) === 0);
  ok('dark: invalid stays an error', (await nodes.nth(3).locator('.mdx-error').count()) === 1);
  const darkMath = await page.evaluate(() => { const k = document.querySelector('.mdx-root .katex'); return getComputedStyle(k).color === getComputedStyle(document.querySelector('.mdx-root')).color && getComputedStyle(k).color; });
  ok('math inherits text color (dark)', !!darkMath, String(darkMath));
  await page.evaluate(() => window.__mdwe.editor.setTheme('light'));
  await page.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg .cluster'), null, { timeout: 30000 });

  // per-block source toggle: edit invalid block into a valid one
  const bad = nodes.nth(4);
  await bad.locator('[data-mdx-action="toggle-source"]').click();
  ok('source textarea opens', await bad.locator('textarea.mdx-mermaid-source').isVisible());
  await bad.locator('textarea.mdx-mermaid-source').fill('flowchart TD\n    A --> B --> C');
  await bad.locator('textarea.mdx-mermaid-source').blur();
  await page.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"]')[4].querySelector('svg'), null, { timeout: 30000 });
  ok('edited source re-renders to SVG (no error)', (await bad.locator('.mdx-error').count()) === 0);
  const md1 = await page.evaluate(() => window.__mdwe.editor.getMarkdown());
  ok('edited doc serializes the mermaid fence with new source', md1.includes('```mermaid\nflowchart TD\n    A --> B --> C\n```'));
  ok('edit normalizes rest but keeps math delimiters', md1.includes('$e^{i\\pi} + 1 = 0$') && md1.includes('$$x^2$$') && md1.includes('$$\n\\begin{aligned}') && md1.includes('$5 and $10'));
  ok('flowchart fence preserved verbatim after edit', md1.includes(flow.split('```mermaid\n')[1].split('```')[0]));
  // and back to invalid (debounced commit, no blur)
  await bad.locator('[data-mdx-action="toggle-source"]').click().catch(() => {});
  await bad.locator('[data-mdx-action="toggle-source"]').click();
  await bad.locator('textarea.mdx-mermaid-source').fill('flowchart TD A --> B');
  await page.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"]')[4].querySelector('.mdx-error'), null, { timeout: 30000 });
  ok('debounced re-render shows error for invalid source', true);
  ok('source is not kept open when toggled closed', await (async () => { await bad.locator('[data-mdx-action="toggle-source"]').click(); return !(await bad.locator('textarea.mdx-mermaid-source').isVisible()); })());

  // inline math click to edit, Enter commits
  const im = q('span[data-mdx-node="math-inline"]').first();
  await im.locator('.mdx-math-render').scrollIntoViewIfNeeded();
  const bb = await im.locator('.mdx-math-render').boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); // real pointer click (Playwright's actionability hit-test trips on KaTeX's zero-size MathML layer)
  const inp = im.locator('input.mdx-math-source');
  ok('inline math click shows raw source input', await inp.isVisible() && (await inp.inputValue()) === 'e^{i\\pi} + 1 = 0', await inp.inputValue());
  await inp.fill('a^2+b^2'); await inp.press('Enter');
  await page.waitForTimeout(300);
  ok('inline math Enter commits + re-renders', !(await inp.isVisible()) && (await im.locator('.katex').count()) === 1 && (await page.evaluate(() => window.__mdwe.editor.getMarkdown())).includes('Euler: $a^2+b^2$ and'));
  // block math toggle
  const bm = q('div[data-mdx-node="math-block"]').first();
  await bm.locator('[data-mdx-action="toggle-source"]').click();
  await bm.locator('textarea.mdx-math-source').fill('\\sqrt{2}');
  await bm.locator('[data-mdx-action="toggle-source"]').click();
  ok('block math toggle commits', (await page.evaluate(() => window.__mdwe.editor.getMarkdown())).includes('$$\\sqrt{2}$$'));

  // toolbar actions
  await page.evaluate(() => { window.__mdwe.editor.setMarkdown('start\n'); });
  await page.evaluate(() => window.__mdwe.editor.tiptap.commands.focus('end'));
  await q('button[data-cmd="diagram"]').click();
  await page.waitForSelector('[data-mdx-node="mermaid"] svg', { timeout: 30000 });
  ok('Diagram button inserts a rendered sample flowchart (source opened)', await q('textarea.mdx-mermaid-source').isVisible());
  await q('textarea.mdx-mermaid-source').blur();
  await q('button[data-cmd="mathInline"]').click();
  ok('Math button inserts inline math with source input', await q('input.mdx-math-source').isVisible());
  await q('input.mdx-math-source').press('Enter');
  await q('button[data-cmd="mathBlock"]').click();
  await page.waitForSelector('div[data-mdx-node="math-block"] .katex', { timeout: 20000 });
  const md2 = await page.evaluate(() => window.__mdwe.editor.getMarkdown());
  ok('toolbar inserts serialize as fenced mermaid + $x^2$ + $$E = mc^2$$', /```mermaid\nflowchart LR\n/.test(md2) && md2.includes('$x^2$') && md2.includes('$$E = mc^2$$'), JSON.stringify(md2));
  ok('toolbar buttons labelled', (await q('button[data-cmd="diagram"]').getAttribute('aria-label')) === 'Insert Mermaid diagram');

  // bare-paste wrap
  await page.evaluate(() => { window.__mdwe.editor.setMarkdown('\n'); window.__mdwe.editor.tiptap.commands.focus('start'); });
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'flowchart TD\n    A[One] --> B[Two]\n');
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('[data-mdx-node="mermaid"] svg', { timeout: 30000 });
  ok('pasting bare "flowchart TD…" text wraps it in a mermaid block', (await page.evaluate(() => window.__mdwe.editor.getMarkdown())).startsWith('```mermaid\nflowchart TD\n    A[One] --> B[Two]\n```'));

  // ---- BUG-26: Ctrl/Cmd+S / Ctrl/Cmd+O reach `document` from inside per-block source fields, edit flushed first ----
  await page.evaluate(() => {
    window.__keys = [];
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'o'].includes(e.key.toLowerCase()))
        window.__keys.push({ k: e.key.toLowerCase(), shift: e.shiftKey, md: window.__mdwe.editor.getMarkdown(), prevented: e.defaultPrevented });
    });
    window.__mdwe.editor.setMarkdown('```mermaid\nflowchart LR\n  A --> B\n```\n\nx $a$ y\n\n$$b$$\n');
  });
  await page.waitForSelector('[data-mdx-node="mermaid"] svg', { timeout: 30000 });
  const m26 = q('[data-mdx-node="mermaid"]').first();
  await m26.locator('[data-mdx-action="toggle-source"]').click();
  const ta26 = m26.locator('textarea.mdx-mermaid-source');
  await ta26.fill('flowchart LR\n  A --> B\n  B --> ZZTOP26');
  await ta26.press('Control+s');   // immediately: debounce (350 ms) has NOT fired yet
  await ta26.press('Control+o');
  await ta26.press('Control+Shift+s');
  let keys = await page.evaluate(() => window.__keys);
  ok('#26 mermaid textarea: Ctrl+S / Ctrl+O / Ctrl+Shift+S reach document', keys.length === 3 && keys[0].k === 's' && keys[1].k === 'o' && keys[2].shift === true, JSON.stringify(keys.map((x) => x.k + (x.shift ? '+shift' : ''))));
  ok('#26 markdown seen by the document handler already contains the un-debounced edit', keys.length > 0 && keys.every((x) => x.md.includes('B --> ZZTOP26')), JSON.stringify(keys[0] && keys[0].md));
  ok('#26 field keeps native editing chords local (Ctrl+A/Z do not bubble)', await page.evaluate(() => new Promise((res) => {
    const ta = document.querySelector('textarea.mdx-mermaid-source'); let leaked = 0;
    const h = () => leaked++; document.addEventListener('keydown', h);
    for (const key of ['a', 'z', 'c', 'v', 'x', 'y']) ta.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true })); // plain typing does not bubble either
    document.removeEventListener('keydown', h); res(leaked === 0);
  })));
  await m26.locator('[data-mdx-action="toggle-source"]').click(); // Done
  // block math textarea
  const bm26 = q('div[data-mdx-node="math-block"]').first();
  await bm26.locator('[data-mdx-action="toggle-source"]').click();
  await page.evaluate(() => { window.__keys.length = 0; });
  await bm26.locator('textarea.mdx-math-source').fill('\\alpha_{ZZTOP26}');
  await bm26.locator('textarea.mdx-math-source').press('Control+s');
  keys = await page.evaluate(() => window.__keys);
  ok('#26 block-math textarea: Ctrl+S reaches document with edit flushed', keys.length === 1 && keys[0].md.includes('$$\\alpha_{ZZTOP26}$$'), JSON.stringify(keys));
  await bm26.locator('[data-mdx-action="toggle-source"]').click();
  // inline math input
  const im26 = q('span[data-mdx-node="math-inline"]').first();
  await im26.locator('[data-mdx-action="toggle-source"]').dispatchEvent('click');
  await page.evaluate(() => { window.__keys.length = 0; });
  await im26.locator('input.mdx-math-source').fill('q_{ZZTOP26}');
  await im26.locator('input.mdx-math-source').press('Meta+o');
  keys = await page.evaluate(() => window.__keys);
  ok('#26 inline-math input: Cmd+O reaches document with edit flushed', keys.length === 1 && keys[0].k === 'o' && keys[0].md.includes('x $q_{ZZTOP26}$ y'), JSON.stringify(keys));
  await im26.locator('input.mdx-math-source').press('Enter');
  ok('#26 Enter/Esc still handled by the field (input closes)', !(await im26.locator('input.mdx-math-source').isVisible()));

  // ---- BUG-27: unknown commands / bad LaTeX are flagged as errors (inline + block), valid math unaffected ----
  const mathState = (tex, block) => page.evaluate(async ([t, b]) => {
    const ed = window.__mdwe.editor;
    ed.setMarkdown('\n'); await new Promise((r) => setTimeout(r, 30)); // drop the previous node view
    ed.setMarkdown(b ? `$$${t}$$\n` : `a $${t}$ b\n`);
    const sel = b ? 'div[data-mdx-node="math-block"]' : 'span[data-mdx-node="math-inline"]';
    for (let i = 0; i < 100 && !document.querySelector(`${sel}[data-mdx-rendered]`); i++) await new Promise((r) => setTimeout(r, 50));
    const n = document.querySelector(sel);
    return { rendered: n && n.dataset.mdxRendered, err: n ? n.querySelectorAll('.mdx-error[data-mdx-error="math"]').length : -1, katex: n ? n.querySelectorAll('.katex').length : -1,
      src: n && n.querySelector('.mdx-error-src') ? n.querySelector('.mdx-error-src').textContent : null, md: ed.getMarkdown() };
  }, [tex, block]);
  for (const [tex, block] of [['\\undefinedcmd', false], ['\\undefinedcmd{x}', true], ['\\frac{1', false], ['\\begin{aligned} a &= ', true], ['\\left( x', false]]) {
    const r = await mathState(tex, block);
    ok(`#27 ${block ? 'block' : 'inline'} ${tex} -> .mdx-error[math], data-mdx-rendered=error, raw source shown, markdown intact`,
      r.rendered === 'error' && r.err === 1 && r.katex === 0 && r.src === tex && r.md.includes(tex), JSON.stringify(r));
  }
  for (const [tex, block] of [['\\frac{a}{b}', false], ['\\sum_{i=0}^{n} i', true], ['\\int_0^1 x\\,dx', false], ['\\alpha+\\beta', false], ['\\mathbb{R}^n', false],
    ['\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', true], ['\\text{héllo wörld}', false], ['\\sqrt[3]{x}', false], ['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', true], ['x \\in \\mathcal{A} \\cdot \\vec{v}', false], ['a_1^2', false]]) {
    const r = await mathState(tex, block);
    ok(`#27 valid ${block ? 'block' : 'inline'} math still renders: ${tex.slice(0, 30)}`, r.rendered === 'ok' && r.err === 0 && r.katex === 1, JSON.stringify(r));
  }

  // ---- BUG-29: remote <img>/<image>/<use>/CSS url() in a mermaid HTML label triggers zero non-extension requests ----
  const leak = [];
  await page.route((u) => !/^(chrome-extension|data|blob|about):/.test(u.toString()), (r) => { leak.push(r.request().url()); r.abort(); });
  const leakBefore = reqs.length;
  const evilDoc = '```mermaid\nflowchart LR\n  A["<img src=\'https://leak-img.example/x.png\'> hello IMGLABEL"] --> B["<img src=x onerror=alert(1)> <a href=\'https://leak-a.example/\'>link</a> tail"]\n  C["<div style=\'background:url(https://leak-css.example/b.png)\'>styled</div>"] --> D["<video poster=\'https://leak-poster.example/p.png\' src=\'https://leak-video.example/v.mp4\'></video><iframe src=\'https://leak-iframe.example/\'></iframe> vid"]\n```\n\n' + fx('13-mermaid-flowchart.md');
  await page.evaluate((d) => window.__mdwe.editor.setMarkdown(d), evilDoc);
  await page.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"] svg').length >= 2, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const newReqs = reqs.slice(leakBefore).filter((u) => !/^(chrome-extension|data|blob|about):/.test(u));
  ok('#29 zero requests to non-extension origins for evil labels (request events)', newReqs.length === 0, JSON.stringify(newReqs));
  ok('#29 zero requests intercepted by page.route', leak.length === 0, JSON.stringify(leak));
  const evil = q('[data-mdx-node="mermaid"]').nth(0);
  const evilInfo = await evil.evaluate((el) => ({ txt: el.querySelector('svg')?.textContent || '', bad: el.querySelectorAll('img, video, iframe, [poster], [src]').length,
    urls: (el.innerHTML.match(/https?:\/\/(?!www\.w3\.org)[^"'\s)<]+/g) || []).filter((u) => !/^https:\/\/leak-a\.example/.test(u)), a: el.querySelectorAll('a[href^="https://leak-a.example"]').length }));
  ok('#29 diagram still renders with its text labels, no img/video/iframe/src left', evilInfo.txt.includes('IMGLABEL') && evilInfo.txt.includes('styled') && evilInfo.bad === 0, JSON.stringify(evilInfo).slice(0, 400));
  ok('#29 no remote URLs remain in the SVG (except plain <a href>)', evilInfo.urls.length === 0, JSON.stringify(evilInfo.urls));
  const flow2 = q('[data-mdx-node="mermaid"]').nth(1);
  ok('#29 fixture 13 flowchart still renders 3 clusters + labels after sanitizing', (await flow2.locator('svg .cluster').count()) === 3
    && await flow2.evaluate((el) => ['BBS / UGC / Census 2022', 'Threshold Mapping T_E=14, T_I=60', 'Causal Benchmark & Holdout Scoring', 'Raw Event Counts', 'GDELT 2.0 Event Database'].every((l) => el.querySelector('svg').textContent.includes(l))));
  ok('#29 markdown source of the evil diagram is untouched', (await page.evaluate(() => window.__mdwe.editor.getMarkdown())) === evilDoc);
  await page.unroute(() => true).catch(() => {});

  // ---- BUG-31: themeCSS / url() config in %%{init}%% directives and YAML front matter must not fetch anything ----
  {
    const leak31 = [];
    await page.route((u) => !/^(chrome-extension|data|blob|about):/.test(u.toString()), (r) => { leak31.push(r.request().url()); r.abort(); });
    const T = 'https://leak31-';
    const css = (n) => `.node rect { fill: url(${T}${n}.example/x.png) } .node { background: url(${T}${n}.example/y.png) }`; // exactly the QA repro form (a .label url('') rule alone did not trigger the leak in Chromium; these two do)
    const body = 'flowchart LR\n  A[Alpha31] --> B[Beta31]\n';
    const variants = {
      'init themeCSS url()': `%%{init: {"themeCSS": "${css('init')}"}}%%\n${body}`,
      'init themeCSS single rule': `%%{init: {"themeCSS": ".node rect { fill: url(${T}single.example/x.png) }"}}%%\n${body}`,
      'init themeCSS + legit theme': `%%{init: {"theme": "dark", "themeCSS": "${css('initdark')}"}}%%\n${body}`,
      'multi-line init': `%%{\n  init: {\n    "theme": "forest",\n    "themeCSS": "${css('multi')}"\n  }\n}%%\n${body}`,
      'initialize spelling': `%%{initialize: {"themeCSS": "${css('initialize')}"}}%%\n${body}`,
      'INIT upper-case + single quotes': `%%{INIT: {'themeCSS': '${css('upper').replace(/'/g, '')}'}}%%\n${body}`,
      'config spelling': `%%{config: {"themeCSS": "${css('config')}"}}%%\n${body}`,
      'escaped key spelling': `%%{init: {"theme\\u0043SS": "${css('esc')}"}}%%\n${body}`,
      'themeVariables url()': `%%{init: {"themeVariables": {"primaryColor": "url(${T}tv.example/x.png)", "lineColor": "#ff0000"}}}%%\n${body}`,
      'fontFamily url()': `%%{init: {"fontFamily": "url(${T}font.example/x.woff)", "themeVariables": {"fontFamily": "url(${T}font2.example/x.woff)"}}}%%\n${body}`,
      'two directives': `%%{init: {"theme":"dark"}}%%\n%%{init: {"themeCSS": "${css('two')}"}}%%\n${body}`,
      'yaml front matter config themeCSS': `---\nconfig:\n  theme: dark\n  themeCSS: "${css('fm')}"\n---\n${body}`,
      'yaml front matter block scalar themeCSS': `---\ntitle: Front31\nconfig:\n  themeCSS: |\n    .node rect { fill: url(${T}fmblock.example/x.png) }\n    .node { background: url(${T}fmblock2.example/y.png) }\n  theme: dark\n---\n${body}`,
      'yaml front matter quoted key + themeVariables': `---\nconfig:\n  "themeCSS": '.node rect { fill: url(${T}fmq.example/x.png) }'\n  themeVariables:\n    primaryColor: "url(${T}fmtv.example/x.png)"\n---\n${body}`,
      'front matter + init directive': `---\ntitle: T31\n---\n%%{init: {"themeCSS": "${css('fminit')}"}}%%\n${body}`,
    };
    const mk = (d) => '```mermaid\n' + d + '\n```\n';
    let fixtureFlow = null;
    for (const [name, d] of Object.entries(variants)) {
      const before31 = reqs.length;
      const doc31 = mk(d);
      await page.evaluate((x) => window.__mdwe.editor.setMarkdown(x), doc31);
      await page.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"] svg, [data-mdx-node="mermaid"] .mdx-error').length >= 1, null, { timeout: 60000 });
      await page.waitForTimeout(1200);
      const bad = reqs.slice(before31).filter((u) => !/^(chrome-extension|data|blob|about):/.test(u));
      const info = await page.evaluate(() => { const el = document.querySelector('[data-mdx-node="mermaid"] .mdx-mermaid-render'); const svg = el && el.querySelector('svg'); return { svg: !!svg, txt: svg ? svg.textContent : '', err: document.querySelectorAll('.mdx-error').length, html: svg ? svg.outerHTML : '' }; });
      ok(`#31 [${name}] zero non-extension requests (request events)`, bad.length === 0, JSON.stringify(bad));
      ok(`#31 [${name}] still renders (labels present, no error)`, info.svg && info.err === 0 && info.txt.includes('Alpha31') && info.txt.includes('Beta31'), JSON.stringify({ ...info, html: '' }));
      ok(`#31 [${name}] no remote url() left in svg`, !/leak31-/.test(info.html));
      ok(`#31 [${name}] markdown source byte-identical`, (await page.evaluate(() => window.__mdwe.editor.getMarkdown())) === doc31);
      if (/legit theme/.test(name)) ok('#31 legit init theme:"dark" still applied alongside a stripped themeCSS', /#1f2020|#ccc|lightgrey/i.test(info.html), (info.html.match(/<style>[\s\S]{0,300}/) || [''])[0]);
      if (name === 'yaml front matter config themeCSS') ok('#31 legit yaml front matter theme:dark kept', /#1f2020|#ccc|lightgrey/i.test(info.html), info.html.slice(0, 200));
    }
    // legit directives without any risky part are passed through byte-for-byte: theme really changes the render
    const themed = async (d) => { await page.evaluate((x) => window.__mdwe.editor.setMarkdown(x), mk(d)); await page.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg'), null, { timeout: 60000 }); await page.waitForTimeout(400); return page.evaluate(() => document.querySelector('[data-mdx-node="mermaid"] svg').outerHTML.replace(/mdx-mmd-\d+/g, 'ID')); };
    const plain = await themed(body), dark = await themed(`%%{init: {"theme":"dark"}}%%\n${body}`);
    ok('#31 %%{init: {"theme":"dark"}}%% still changes the rendering', plain !== dark && /#1f2020|#ccc|lightgrey/i.test(dark) && !/#1f2020/i.test(plain), `${plain.length}/${dark.length}`);
    // sanity: fixture 13 (Jasser's flowchart) inside the same session is unaffected
    await page.evaluate((x) => window.__mdwe.editor.setMarkdown(x), fx('13-mermaid-flowchart.md'));
    await page.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg .cluster'), null, { timeout: 60000 });
    fixtureFlow = await page.locator('[data-mdx-node="mermaid"]').nth(0).locator('svg .cluster').count();
    ok('#31 fixture 13 still renders 3 clusters', fixtureFlow === 3, String(fixtureFlow));
    ok('#31 zero requests intercepted by page.route (all variants)', leak31.length === 0, JSON.stringify(leak31));
    await page.unroute(() => true).catch(() => {});
  }

  // ---- BUG-28: whole-document Source toggle keeps an unedited CRLF file byte-exact ----
  const crlf = '# Title\r\n\r\nline one\r\nline two\r\n\r\n```mermaid\r\nflowchart LR\r\n  A --> B\r\n```\r\n\r\n$$x$$\r\n';
  const r28 = await page.evaluate((d) => {
    const e = window.__mdwe.editor; e.setMarkdown(d); e.markSaved();
    const out = { before: e.getMarkdown() === d, mod0: e.isModified() };
    e.setSourceMode(true);
    out.inSrc = e.getMarkdown() === d; out.taHasNoCR = !document.querySelector('textarea.mdx-source').value.includes('\r'); out.modSrc = e.isModified();
    e.setSourceMode(false);
    out.after = e.getMarkdown() === d; out.mod1 = e.isModified();
    // edited in source view -> normal behaviour
    e.setSourceMode(true);
    const ta = document.querySelector('textarea.mdx-source'); ta.value = ta.value + 'more\n'; ta.dispatchEvent(new Event('input'));
    out.editedMod = e.isModified(); out.editedTxt = e.getMarkdown();
    e.setSourceMode(false);
    out.editedAfter = e.getMarkdown();
    return out;
  }, crlf);
  ok('#28 unedited CRLF: getMarkdown exact before/in source view/after, isModified false throughout', r28.before && r28.inSrc && r28.after && !r28.mod0 && !r28.modSrc && !r28.mod1 && r28.taHasNoCR, JSON.stringify(r28));
  ok('#28 edited in source view -> modified, edit kept', r28.editedMod && r28.editedTxt.endsWith('more\n') && r28.editedAfter.includes('more'), JSON.stringify(r28).slice(0, 300));

  // ---- PRINT (print.css + prepareForPrint/afterPrint/setPrintLinks): real print media + page.pdf() + pdftotext ----
  {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, mkdirSync, statSync } = await import('node:fs');
    const SAMPLES = join(ROOT, 'tmp-print-samples'); mkdirSync(SAMPLES, { recursive: true });
    const pdfText = (file) => execFileSync('pdftotext', [file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).replace(/[ \t]*\n+[ \t]*/g, ' ').replace(/[ \t]+/g, ' ');
    const pdfPages = (file) => { const t = execFileSync('pdfinfo', [file], { encoding: 'utf8' }); return Number((/Pages:\s+(\d+)/.exec(t) || [])[1] || 0); };
    const table = '| Name | Value | Notes |\n| --- | --- | --- |\n' + Array.from({ length: 6 }, (_, i) => `| row${i} | ${i * 7} | some wrapped text that is fairly long to exercise word wrapping in the printed table cell number ${i} |`).join('\n');
    const printDoc = `# Print Title\n\nIntro paragraph with a [link](https://example.com/a), an [anchor](#top), and ${'long text '.repeat(60)}\n\n## Table section\n\n${table}\n\n### Code\n\n\`\`\`js\nconst veryLongLine = "${'x'.repeat(220)}";\nconsole.log(veryLongLine);\n\`\`\`\n\n- [x] done task\n- [ ] open task\n\n${flow}\n\nInline math $e^{i\\pi} + 1 = 0$ and block:\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\n<div align="center">raw-html-chip-text</div>\n\nTrailing paragraph.\n`;
    const visible = (sel) => page.evaluate((s) => { const els = [...document.querySelectorAll(s)]; return els.map((e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }); }, sel);
    const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = (c) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b); };
    const prevMedia = async () => { await page.emulateMedia({ media: null }); };

    for (const theme of ['light', 'dark']) {
      await prevMedia();
      await page.evaluate(([t, d]) => { document.documentElement.dataset.theme = t; const e = window.__mdwe.editor; e.setTheme(t); e.setMarkdown(d); e.markSaved(); }, [theme, printDoc]);
      await page.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg') && document.querySelectorAll('.katex').length >= 2, null, { timeout: 60000 });
      const beforeMd = await page.evaluate(() => window.__mdwe.editor.getMarkdown());
      const dirty0 = await page.evaluate(() => window.__mdwe.state.dirty);
      const darkSvgBefore = await page.evaluate(() => document.querySelector('[data-mdx-node="mermaid"] svg').outerHTML);
      let onChangeFired = false; await page.exposeFunction(`__oc_${theme}`, () => { onChangeFired = true; }).catch(() => {});
      const t0 = Date.now();
      await page.evaluate(() => window.__mdwe.editor.prepareForPrint());
      console.log(`   [${theme}] prepareForPrint took ${Date.now() - t0} ms`);
      ok(`print[${theme}] prepareForPrint() resolved; all nodes rendered`, await page.evaluate(() => [...document.querySelectorAll('[data-mdx-node]')].every((n) => n.dataset.mdxRendered === 'ok')));
      await page.emulateMedia({ media: 'print' });
      await page.waitForTimeout(150);
      ok(`print[${theme}] editor is in printing state (matchMedia listener)`, await page.evaluate(() => window.__mdwe.editor.isPrinting()));

      // hidden chrome
      for (const [name, sel] of [['toolbar', '.mdx-toolbar'], ['file bar', '#filebar'], ['status', '#status'], ['drive status', '#drive-status'], ['edit-source buttons', '.mdx-node-toggle'], ['block headers', '.mdx-node-head'], ['popover', '.mdx-popover']]) {
        const v = await visible(sel);
        ok(`print[${theme}] ${name} not displayed`, v.every((x) => !x), JSON.stringify(v));
      }
      ok(`print[${theme}] per-block source fields hidden`, (await visible('textarea, .mdx-math-source, .mdx-source')).every((x) => !x));
      ok(`print[${theme}] placeholder/gapcursor hidden`, (await visible('.ProseMirror-gapcursor, .ProseMirror-trailingBreak')).every((x) => !x));
      ok(`print[${theme}] .mdx-print-source hidden when not in source mode`, (await visible('.mdx-print-source')).every((x) => !x));
      // colours
      const cols = await page.evaluate(() => { const r = document.querySelector('.mdx-root'), pm = document.querySelector('.ProseMirror'); const cs = (e) => getComputedStyle(e); const th = document.querySelector('.ProseMirror th'), pre = document.querySelector('.ProseMirror pre'); return { rootBg: cs(r).backgroundColor, rootFg: cs(r).color, bodyBg: cs(document.body).backgroundColor, pmFg: cs(pm).color, thBg: cs(th).backgroundColor, preBg: cs(pre).backgroundColor, preFg: cs(pre).color, p: cs(document.querySelector('.ProseMirror p')).color, h: cs(document.querySelector('.ProseMirror h1')).color, adjust: cs(pre).printColorAdjust || cs(pre).webkitPrintColorAdjust, scheme: cs(r).colorScheme, mw: cs(document.querySelector('.mdx-wysiwyg')).maxWidth, pad: cs(document.querySelector('.mdx-wysiwyg')).paddingLeft, tblw: document.querySelector('.ProseMirror table').getBoundingClientRect().width, pmw: document.querySelector('.ProseMirror').getBoundingClientRect().width }; });
      ok(`print[${theme}] root+body background white-ish`, lum(cols.rootBg) > 240 && lum(cols.bodyBg) > 240, JSON.stringify(cols));
      ok(`print[${theme}] text dark`, lum(cols.rootFg) < 80 && lum(cols.pmFg) < 80 && lum(cols.p) < 80 && lum(cols.h) < 80, JSON.stringify(cols));
      ok(`print[${theme}] code block / table header keep LIGHT backgrounds + color-adjust exact`, lum(cols.preBg) > 220 && lum(cols.thBg) > 210 && lum(cols.preFg) < 100 && cols.adjust === 'exact', JSON.stringify(cols));
      ok(`print[${theme}] editor container: no max-width/padding, table fills width`, cols.mw === 'none' && cols.pad === '0px' && cols.tblw > cols.pmw * 0.95, JSON.stringify(cols));
      // diagrams + math visible, light colours
      ok(`print[${theme}] mermaid svg + .katex visible`, (await visible('[data-mdx-node="mermaid"] svg')).every(Boolean) && (await visible('.katex')).length >= 2 && (await visible('.katex')).every(Boolean));
      const node = await page.evaluate(() => { const n = document.querySelector('[data-mdx-node="mermaid"] svg .node rect, [data-mdx-node="mermaid"] svg .node polygon'); const svg = document.querySelector('[data-mdx-node="mermaid"] svg'); return { fill: getComputedStyle(n).fill, html: svg.outerHTML, fb: !!document.querySelector('.mdx-print-fallback'), maxH: getComputedStyle(svg).maxHeight }; });
      ok(`print[${theme}] diagram node fill is light (not dark), no invert fallback needed`, lum(node.fill) > 200 && !node.fb, node.fill + ' fallback=' + node.fb);
      ok(`print[${theme}] svg max-height 90vh rule applied`, node.maxH !== 'none', node.maxH);
      if (theme === 'dark') ok('print[dark] svg markup was swapped to the light cache (differs from dark svg)', node.html.replace(/mdx-mmd-\d+/g, 'ID') !== darkSvgBefore.replace(/mdx-mmd-\d+/g, 'ID'));
      else ok('print[light] svg markup unchanged (nothing to swap)', node.html === darkSvgBefore);
      // raw chip + task list + link
      ok(`print[${theme}] raw chip prints verbatim text, label hidden`, await page.evaluate(() => { const c = document.querySelector('.mdx-raw'); return !!c && c.textContent.includes('raw-html-chip-text') && getComputedStyle(c.querySelector('.mdx-raw-label') || c).display !== 'block' || !c.querySelector('.mdx-raw-label'); }));
      ok(`print[${theme}] task checkboxes visible`, (await visible('ul[data-type="taskList"] input[type="checkbox"]')).length === 2 && (await visible('ul[data-type="taskList"] input[type="checkbox"]')).every(Boolean));
      // links option
      const linkAfter = async () => page.evaluate(() => [...document.querySelectorAll('.ProseMirror a')].map((a) => getComputedStyle(a, '::after').content));
      let la = await linkAfter(); ok(`print[${theme}] link URLs off by default`, la.every((c) => c === 'none' || c === 'normal' || c === '""'), JSON.stringify(la));
      await page.evaluate(() => window.__mdwe.editor.setPrintLinks(true)); la = await linkAfter();
      ok(`print[${theme}] setPrintLinks(true): https link gets (url), #anchor does not`, /example\.com\/a/.test(la[0]) && !/#top/.test(la[1] || ''), JSON.stringify(la));
      await page.evaluate(() => window.__mdwe.editor.setPrintLinks(false));

      // PDF
      const pdf = join(SAMPLES, `print-${theme}.pdf`);
      await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
      const txt = pdfText(pdf), pages = pdfPages(pdf);
      ok(`print[${theme}] PDF non-empty, pages > 0`, statSync(pdf).size > 5000 && pages > 0, `${statSync(pdf).size} bytes, ${pages} pages`);
      for (const w of ['Print Title', 'GDELT 2.0 Event Database', 'Raw Event Counts', 'BBS / UGC / Census 2022', 'raw-html-chip-text', 'done task', 'open task', 'row3'])
        ok(`print[${theme}] pdftotext has "${w}"`, txt.includes(w), txt.slice(0, 200));
      ok(`print[${theme}] math rendered in PDF (KaTeX glyphs: "1" "0" "x" "3")`, /e\s*iπ|eiπ|iπ/.test(txt.replace(/\s+/g, ' ')) || /∫|1\s*3/.test(txt), txt.slice(-400));
      ok(`print[${theme}] no editor UI text in PDF`, !/Edit source|Markdown\s+Open|Start writing/.test(txt) && !/Open from Drive/.test(txt));
      ok(`print[${theme}] long code line not clipped (tail of line present)`, txt.replace(/\s+/g, '').includes('x'.repeat(200)));
      // document untouched
      await page.emulateMedia({ media: null });
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => { const e = window.__mdwe.editor; return { md: e.getMarkdown(), mod: e.isModified(), printing: e.isPrinting(), fb: !!document.querySelector('.mdx-print-fallback'), dirty: window.__mdwe.state.dirty }; });
      ok(`print[${theme}] after print: getMarkdown byte-identical, isModified false, page dirty flag unchanged`, after.md === beforeMd && !after.mod && after.dirty === dirty0, JSON.stringify({ ...after, md: after.md.length }));
      ok(`print[${theme}] after print: printing state cleared`, !after.printing && !after.fb);
      ok(`print[${theme}] after print: on-screen diagram markup restored to ${theme} svg`, (await page.evaluate(() => document.querySelector('[data-mdx-node="mermaid"] svg').outerHTML)) === darkSvgBefore);
      ok(`print[${theme}] onChange not fired by printing`, !onChangeFired);
    }

    // beforeprint/afterprint window events (what Ctrl+P in Chrome fires), dark: swap is synchronous from cache
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.__mdwe.editor.setTheme('dark'); });
    await page.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg'), null, { timeout: 60000 });
    await page.evaluate(() => window.__mdwe.editor.prepareForPrint());
    const ev = await page.evaluate(() => { const svg0 = document.querySelector('[data-mdx-node="mermaid"] svg').outerHTML; window.dispatchEvent(new Event('beforeprint')); const mid = document.querySelector('[data-mdx-node="mermaid"] svg').outerHTML; const fb = !!document.querySelector('.mdx-print-fallback'); window.dispatchEvent(new Event('afterprint')); return { changed: svg0 !== mid, fb, restored: document.querySelector('[data-mdx-node="mermaid"] svg').outerHTML === svg0 }; });
    ok('print: beforeprint swaps dark diagram to cached light svg synchronously, afterprint restores it', ev.changed && !ev.fb && ev.restored, JSON.stringify(ev));
    // fallback: no light variant cached for a brand new dark diagram -> invert fallback class, restored afterwards
    await page.evaluate(() => window.__mdwe.editor.setMarkdown('```mermaid\nflowchart LR\n  Q1[NeverPrepared] --> Q2[Other]\n```\n'));
    await page.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg'), null, { timeout: 60000 });
    const fbRes = await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); const fb = !!document.querySelector('.mdx-mermaid-render.mdx-print-fallback'); window.dispatchEvent(new Event('afterprint')); return { fb, after: !document.querySelector('.mdx-print-fallback') }; });
    ok('print: un-prepared dark diagram uses the CSS fallback class on beforeprint and loses it on afterprint', fbRes.fb && fbRes.after, JSON.stringify(fbRes));

    // source mode print
    const srcDoc = '# Source Title\n\nsome **markdown** text with `code`\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
    await page.evaluate((d) => { document.documentElement.dataset.theme = 'light'; const e = window.__mdwe.editor; e.setTheme('light'); e.setMarkdown(d); e.markSaved(); e.setSourceMode(true); }, srcDoc);
    await page.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(150);
    const sv = await page.evaluate(() => { const pre = document.querySelector('.mdx-print-source'); const cs = getComputedStyle(pre); return { shown: cs.display !== 'none', ws: cs.whiteSpace, text: pre.textContent, taShown: getComputedStyle(document.querySelector('textarea.mdx-source')).display !== 'none', wysShown: getComputedStyle(document.querySelector('.mdx-wysiwyg')).display !== 'none', ff: cs.fontFamily }; });
    ok('print source mode: pre.mdx-print-source shown (pre-wrap), textarea + WYSIWYG hidden, text = markdown', sv.shown && sv.ws === 'pre-wrap' && !sv.taShown && !sv.wysShown && sv.text === srcDoc, JSON.stringify(sv).slice(0, 300));
    const pdfS = join(SAMPLES, 'print-source-mode.pdf');
    await page.pdf({ path: pdfS, format: 'A4', printBackground: true });
    const ts = pdfText(pdfS);
    ok('print source mode: PDF shows the markdown text (# Source Title, ```mermaid, flowchart LR)', ts.includes('# Source Title') && ts.includes('```mermaid') && ts.includes('flowchart LR') && ts.includes('some **markdown** text'), ts.slice(0, 200));
    await page.emulateMedia({ media: null }); await page.waitForTimeout(150);
    ok('print source mode: after print getMarkdown identical, not modified, pre emptied', await page.evaluate((d) => { const e = window.__mdwe.editor; return e.getMarkdown() === d && !e.isModified() && document.querySelector('.mdx-print-source').textContent === ''; }, srcDoc));
    await page.evaluate(() => window.__mdwe.editor.setSourceMode(false));

    // long document: multi-page PDF, headings not stranded at page bottom
    const paras = Array.from({ length: 200 }, (_, i) => (i % 25 === 0 ? `## Section ${i / 25}\n\n` : '') + `Paragraph ${i}: ` + 'lorem ipsum dolor sit amet consectetur '.repeat(8) + '\n').join('\n');
    const longDoc = `# Long Doc\n\n${paras}\n${table}\n\n${table}\n\n${flow}\n\n${fx('14-mermaid-sequence.md')}\n\n${flow}\n\n$$E = mc^2$$\n\n${table}\n\nEND-OF-LONG-DOC\n`;
    await page.evaluate((d) => { document.documentElement.dataset.theme = 'dark'; const e = window.__mdwe.editor; e.setTheme('dark'); e.setMarkdown(d); e.markSaved(); }, longDoc);
    await page.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"] svg').length >= 3, null, { timeout: 90000 });
    await page.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await page.emulateMedia({ media: 'print' });
    const pdfL = join(SAMPLES, 'print-long-dark.pdf');
    await page.pdf({ path: pdfL, format: 'A4', printBackground: true });
    const tl = execFileSync('pdftotext', ['-layout', pdfL, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const np = pdfPages(pdfL);
    ok('print long doc: multi-page PDF (>= 5 pages), last text present', np >= 5 && pdfText(pdfL).includes('END-OF-LONG-DOC') && pdfText(pdfL).includes('GDELT 2.0 Event Database'), `${np} pages`);
    const pageTexts = tl.split('\f').map((t) => t.split('\n').map((l) => l.trim()).filter(Boolean));
    const stranded = pageTexts.map((ls, i) => [i + 1, ls[ls.length - 1] || '']).filter(([i, l]) => /^(Section \d|Long Doc|Table section)/.test(l) && i < pageTexts.length);
    ok('print long doc: no heading is the last line of a page (best effort)', stranded.length === 0, JSON.stringify(stranded));
    // NOTE: TipTap tables have no <thead> (header cells are a <tr> of <th> inside <tbody>), so Chrome cannot repeat the header on
    // continuation pages; `display: table-header-group` is set for any <thead> and the header row is kept with its first body row.
    const lastLines = pageTexts.map((ls) => ls[ls.length - 1] || '');
    ok('print long doc: a table header row is never stranded alone at the bottom of a page', !lastLines.some((l) => /^Name\s+Value\s+Notes/.test(l)), JSON.stringify(lastLines.filter((l) => /^Name/.test(l))));
    ok('print long doc: table rows are not split mid-row across pages (each row text intact)', pdfText(pdfL).split('some wrapped text that is fairly long to exercise word wrapping in the printed table cell number').length - 1 >= 15);
    console.log(`   long doc: ${np} pages; samples in ${SAMPLES}`);
    const aft = await page.evaluate(() => { const e = window.__mdwe.editor; return { md: e.getMarkdown() }; });
    await page.emulateMedia({ media: null }); await page.waitForTimeout(150);
    ok('print long doc: isModified false after printing', !(await page.evaluate(() => window.__mdwe.editor.isModified())));
    ok('print long doc: getMarkdown byte-identical', (await page.evaluate(() => window.__mdwe.editor.getMarkdown())) === aft.md && aft.md === longDoc);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.__mdwe.editor.setTheme('light'); });

    // BUG-32: wide tables with unbreakable cell content must wrap (not clip) in print. Every header + every cell must be in the PDF
    // text, IN ITS OWN COLUMN: `pdftotext -bbox` words are grouped by their left x (wrapped lines of one cell all start at the cell's
    // left edge), so a wrapped/fragmented cell is compared as the exact concatenation of its fragments (no interleaving across columns).
    {
      const cn = (r, c, ncols) => (ncols > 10 ? `cell${r}_${String(c).padStart(2, '0')}` : `cell${r}${c}`); // 9 cols: cell08 / cell18 ... (BUG-32 repro naming)
      const mk = (cols, rows, pad) => { const hdr = Array.from({ length: cols }, (_, c) => `H${c}`); const body = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${cn(r, c, cols)}${'x'.repeat(pad)}`)); return [hdr, ...body]; };
      const toMd = (grid) => grid.map((row, i) => `| ${row.join(' | ')} |` + (i === 0 ? `\n| ${row.map(() => '---').join(' | ')} |` : '')).join('\n');
      const longUrl = 'https://example.com/' + 'segment/'.repeat(14) + 'end-of-url-token';
      const hash = 'a1b2c3d4e5f6'.repeat(8);
      const code1 = 'someFunctionName_'.repeat(6) + 'END', code2 = 'q'.repeat(90);
      const prose = 'word '.repeat(60) + 'proseend', prose2 = 'more prose '.repeat(30) + 'lastprose';
      const normalGrid = [['Name', 'Value', 'Notes'], ...Array.from({ length: 6 }, (_, i) => [`row${i}`, `${i * 7}`, `some wrapped text that is fairly long to exercise word wrapping in the printed table cell number ${i}`])];
      const grids = {
        '9col': mk(9, 4, 14), '12col': mk(12, 3, 16), '20col': mk(20, 3, 14), '8col-control': mk(8, 4, 14),
        'long-url': [['Name', 'Link', 'Hash', 'Note'], ['urlrow', longUrl, hash, 'tailnote'], ['second', 'plain', 'plain2', 'tailnote2']],
        'inline-code': [['Id', 'Code', 'Other', 'Tail'], ['1', code1, 'a.b.c()', 'code-tail-marker'], ['2', code2, 'plain', 'code-tail-marker2']],
        'normal': normalGrid, 'wrapped-prose': [['A', 'B', 'C'], [prose, 'short', prose2]],
      };
      const mdOf = (name) => name === 'inline-code' ? toMd(grids[name].map((row, i) => i === 0 ? row : row.map((c, j) => (j === 1 || j === 2) ? '`' + c + '`' : c))) : toMd(grids[name]);
      const cases = [...Object.keys(grids).map((k) => [k, mdOf(k), grids[k]]), ['long-url-autolink', `| A | B | C |\n| --- | --- | --- |\n| [${longUrl}](${longUrl}) | mid | last-col-marker |`, [['A', 'B', 'C'], [longUrl, 'mid', 'last-col-marker']]]];
      const columnsFromPdf = (file, skip) => {
        const xml = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
        const words = []; let pg = 0;
        for (const m of xml.matchAll(/<page\b|<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/g)) { if (m[0] === '<page') { pg++; continue; } const t = m[3].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); if (!skip.has(t)) words.push({ pg, x: +m[1], y: +m[2], t }); }
        const xs = [...new Set(words.map((w) => w.x))].sort((a, b) => a - b); const groups = [];
        for (const x of xs) { const g = groups[groups.length - 1]; if (g && x - g.max < 1.5) { g.max = x; g.xs.push(x); } else groups.push({ max: x, xs: [x] }); }
        return groups.map((g) => words.filter((w) => w.x >= g.xs[0] && w.x <= g.max).sort((a, b) => a.pg - b.pg || a.y - b.y || a.x - b.x).map((w) => w.t).join(''));
      };
      const COLMODE = new Set(['9col', '12col', '20col', '8col-control', 'long-url', 'long-url-autolink']);
      const MARKERS = {
        'inline-code': [['Id', 'Code', 'Other', 'Tail', 'END', 'a.b.c()', 'code-tail-marker', 'code-tail-marker2', 'plain'], { q: 90 }],
        'normal': [['Name', 'Value', 'Notes', 'row0', 'row5', 'number5'], {}],
        'wrapped-prose': [['A', 'B', 'C', 'proseend', 'lastprose', 'short'], {}],
      };
      const skipWords = new Set(['T', 'After', 'table', 'paragraph.']);
      const vp0 = page.viewportSize(); await page.setViewportSize({ width: 680, height: 900 }); // ~ printable width of A4 minus 18 mm margins, so the geometry checks are meaningful
      for (const theme of ['light', 'dark']) {
        for (const [name, md, grid] of cases) {
          await page.emulateMedia({ media: null });
          await page.evaluate(([t, d]) => { document.documentElement.dataset.theme = t; const e = window.__mdwe.editor; e.setTheme(t); e.setMarkdown(d); e.markSaved(); }, [theme, `# T\n\n${md}\n\nAfter table paragraph.\n`]);
          await page.waitForFunction(() => document.querySelector('.ProseMirror table'), null, { timeout: 10000 });
          await page.evaluate(() => window.__mdwe.editor.prepareForPrint());
          await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(150);
          const geo = await page.evaluate(() => { const t = document.querySelector('.ProseMirror table'), pm = document.querySelector('.ProseMirror'); const pr = pm.getBoundingClientRect(), tr = t.getBoundingClientRect(); let over = 0; t.querySelectorAll('th,td').forEach((c) => { const r = c.getBoundingClientRect(); if (r.right > pr.right + 1.5) over++; }); const w = t.closest('.tableWrapper'); return { tblRight: Math.round(tr.right), pmRight: Math.round(pr.right), over, cells: t.querySelectorAll('th,td').length, wrapOv: w ? getComputedStyle(w).overflowX : 'none', layout: getComputedStyle(t).tableLayout }; });
          ok(`print[${theme}] BUG-32 ${name}: table fits the content box (no cell past the right edge), fixed layout`, geo.over === 0 && geo.tblRight <= geo.pmRight + 1.5 && geo.layout === 'fixed', JSON.stringify(geo));
          ok(`print[${theme}] BUG-32 ${name}: .tableWrapper does not clip (overflow visible)`, geo.wrapOv === 'visible' || geo.wrapOv === 'none', JSON.stringify(geo));
          const pdfW = join(SAMPLES, `print-wide-${name}-${theme}.pdf`);
          await page.pdf({ path: pdfW, format: 'A4', printBackground: true });
          if (COLMODE.has(name)) {
            const got = columnsFromPdf(pdfW, skipWords);
            const want = grid[0].map((_, c) => grid.map((row) => row[c].replace(/\s+/g, '')).join(''));
            ok(`print[${theme}] BUG-32 ${name} (${want.length} cols): PDF has ${want.length} columns`, got.length === want.length, `got ${got.length}`);
            const bad = want.map((w, c) => (got[c] === w ? null : c)).filter((c) => c !== null);
            ok(`print[${theme}] BUG-32 ${name}: every header + cell of every column is in the PDF text, in its own column, untruncated`, bad.length === 0, bad.slice(0, 3).map((c) => `col${c}: want ${want[c].slice(0, 60)}… got ${(got[c] || '').slice(0, 60)}…`).join(' | '));
          } else {
            // prose / code cells interleave across columns line by line: check every short marker plus the count of the repeated filler chars
            const flat = execFileSync('pdftotext', [pdfW, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).replace(/\s+/g, '');
            const [markers, counts] = MARKERS[name];
            const miss = markers.filter((m) => !flat.includes(m));
            ok(`print[${theme}] BUG-32 ${name}: every header / marker cell is in the PDF text (${miss.length} missing)`, miss.length === 0, miss.join(','));
            const lowCounts = Object.entries(counts).filter(([ch, nWant]) => flat.split(ch).length - 1 < nWant);
            ok(`print[${theme}] BUG-32 ${name}: long unbreakable content printed in full (char counts)`, lowCounts.length === 0, JSON.stringify(lowCounts));
          }
          ok(`print[${theme}] BUG-32 ${name}: paragraph after the table still printed`, pdfText(pdfW).includes('After table paragraph.'));
        }
      }
      await page.setViewportSize(vp0);
      await page.emulateMedia({ media: null });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.__mdwe.editor.setTheme('light'); });
      // screen (non-print) layout of a wide table is untouched: still scrolls inside .tableWrapper
      await page.evaluate((d) => window.__mdwe.editor.setMarkdown(d), toMd(grids['9col']));
      await page.waitForFunction(() => document.querySelector('.ProseMirror table'), null, { timeout: 10000 });
      ok('screen: wide table layout unchanged (.tableWrapper still overflow-x:auto)', await page.evaluate(() => { const w = document.querySelector('.ProseMirror .tableWrapper'); return !w || getComputedStyle(w).overflowX === 'auto'; }));
    }

    // Ctrl/Cmd+P must bubble out of every per-block source field to `document` (page handler runs doPrint)
    {
      await page.evaluate(() => window.__mdwe.editor.setMarkdown('```mermaid\nflowchart LR\n  A --> B\n```\n\nInline $x^2$ here.\n\n$$y^2$$\n'));
      await page.waitForFunction(() => document.querySelectorAll('.katex').length >= 2 && document.querySelector('[data-mdx-node="mermaid"] svg'), null, { timeout: 60000 });
      await page.evaluate(() => { window.__p = []; let cap = null; window.addEventListener('keydown', (e) => { cap = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' ? e.defaultPrevented : null; }, true); document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') window.__p.push({ def: cap, sel: e.target.className || e.target.tagName }); }); /* def = defaultPrevented as seen BEFORE the page's own handler (capture phase on window) */ });
      for (const [kindSel, tag] of [['[data-mdx-node="mermaid"]', 'textarea'], ['[data-mdx-node="math-block"]', 'textarea'], ['[data-mdx-node="math-inline"]', 'input']]) {
        if (tag === 'input') { const bb = await page.locator(`${kindSel} .mdx-math-render`).first().boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
        else await page.locator(`${kindSel} [data-mdx-action="toggle-source"]`).first().click();
        const field = page.locator(`${kindSel} ${tag}.mdx-${/mermaid/.test(kindSel) ? 'mermaid' : 'math'}-source`).first();
        await field.focus();
        await field.press('End'); await field.type('Q');
        const before = await page.evaluate(() => window.__p.length);
        await field.press('Control+p');
        const r = await page.evaluate((b) => window.__p.slice(b), before);
        ok(`Ctrl+P inside ${kindSel} ${tag} reaches document (not stopped, not prevented by the field)`, r.length === 1 && r[0].def === false, JSON.stringify(r));
        const b2 = await page.evaluate(() => window.__p.length);
        await field.press('Meta+p');
        ok(`Cmd+P inside ${kindSel} ${tag} reaches document`, (await page.evaluate(() => window.__p.length)) === b2 + 1);
        ok(`Ctrl+P inside ${kindSel} committed the pending edit first`, (await page.evaluate(() => window.__mdwe.editor.getMarkdown())).includes('Q'));
        await field.press('Escape');
      }
      // WYSIWYG body + in-editor Ctrl+K handler must not swallow Ctrl+P either
      await page.locator('.ProseMirror p').first().click();
      const b3 = await page.evaluate(() => window.__p.length);
      await page.keyboard.press('Control+p');
      const r3 = await page.evaluate((b) => window.__p.slice(b), b3);
      ok('Ctrl+P in the WYSIWYG body reaches document, not prevented by the editor keymap', r3.length === 1 && r3[0].def === false, JSON.stringify(r3));
      await page.evaluate(() => window.__mdwe.editor.setSourceMode(true));
      const b4 = await page.evaluate(() => window.__p.length);
      await page.keyboard.press('Control+p');
      const r4 = await page.evaluate((b) => window.__p.slice(b), b4);
      ok('Ctrl+P in the whole-document source textarea reaches document', r4.length === 1 && r4[0].def === false, JSON.stringify(r4));
      await page.evaluate(() => window.__mdwe.editor.setSourceMode(false));
    }
  }

  // final tally
  const viol = await page.evaluate(() => window.__csp);
  ok('no securitypolicyviolation events', viol.length === 0, JSON.stringify(viol));
  ok('no CSP console messages', csp.length === 0, JSON.stringify(csp));
  ok('no console errors / page errors', problems.length === 0, JSON.stringify(problems, null, 1));
  console.log(`   initial page asset requests before content: ${bootReqs}; total requests ${reqs.length}`);
} finally {
  await ctx.close(); rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
