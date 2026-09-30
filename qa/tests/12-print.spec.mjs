// (Section I at the end: BUG-32 print-table hardening, added 2026-09-30 for build index-DR2BNDPO.js)
// 12. Print / Save as PDF (build index-CqPh5u-r.js). Page side: #btn-print + Ctrl/Cmd+P -> `await editor.prepareForPrint(); window.print()`;
// editor side: src/editor/print.css (light palette always, hidden chrome, page-break rules, print links, source-mode mirror, dark->light SVG swap).
// Method: window.print is stubbed by an init script (headless has no print dialog) and counted; documents are printed with Chromium's own
// page.pdf() (print media), analysed with poppler (pdfinfo / pdftotext / pdffonts / pdftoppm -> qa/lib/print-stats.py raster stats).
// PDFs -> qa/out/print-*.pdf ; rasterised pages -> qa/screens/print-*.png. Never edits src/ or extension/.
import { test, expect, md, setMd, storageGet, fsaStub, fsaArgs, EXT, ROOT, SCREENS } from '../lib/fixture.mjs';
import { openDriveEditor } from '../lib/drive.mjs';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { execFileSync } from 'node:child_process';

const OUT = path.join(ROOT, 'qa', 'out'); const STATS = path.join(ROOT, 'qa', 'lib', 'print-stats.py');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SCREENS, { recursive: true });
const MM = '[data-mdx-node="mermaid"]', MI = '[data-mdx-node="math-inline"]', MB = '[data-mdx-node="math-block"]';
const settle = (p) => p.waitForTimeout(400);
const bootErrOk = (e) => !/ERR_FILE_NOT_FOUND/.test(e);

// ------------------------------------------------------------------ documents
const FLOW_BODY = `flowchart TD
    subgraph Data Layer
        G[GDELT 2.0 Event Database] -->|Raw Event Counts| AGG[division_daily_aggregated.csv]
        AGG -->|Threshold Mapping T_E=14, T_I=60| GT[SEIR Ground-Truth Labels]
        BBS[BBS / UGC / Census 2022] -->|Static Features| SIEGE[5D SIEGE Vectors]
    end

    subgraph Modeling Paradigms
        SIEGE --> ABM[SEIR NetLogo ABM]
        GT -.->|Offline Validation Only| ABM
        GT --> PERS[Temporal Persistence Baseline]
        AGG --> LOG[Lagged L2 Logistic Regression]
        AGG --> HWK[Hawkes-Lite Point Process]
    end

    subgraph Evaluation
        ABM --> EVAL[Causal Benchmark & Holdout Scoring]
        PERS --> EVAL
        LOG --> EVAL
        HWK --> EVAL
    end`;
const FLOW_LABELS = ['Data Layer', 'Modeling Paradigms', 'Evaluation', 'GDELT 2.0 Event Database', 'division_daily_aggregated.csv', 'SEIR Ground-Truth Labels', 'BBS / UGC / Census 2022',
  '5D SIEGE Vectors', 'SEIR NetLogo ABM', 'Temporal Persistence Baseline', 'Lagged L2 Logistic Regression', 'Hawkes-Lite Point Process', 'Causal Benchmark & Holdout Scoring', 'Raw Event Counts', 'Static Features', 'Offline Validation Only'];
const SEQ = 'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hello Bob\n    Bob-->>Alice: Hi Alice';
const BAD_MM = 'flowchart TD\n    A[Start --> B{{\n    this is not valid ))) mermaid';
const fence = (body, lang = 'mermaid') => '```' + lang + '\n' + body + '\n```';
const BLUE_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#0000ff"/></svg>').toString('base64');
const filler = (n, tag = 'lorem') => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');
const para = (i) => `Paragraph ${i} lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`;

const LONG_TABLE = '| Col A | Col B | Col C |\n| --- | --- | --- |\n' + Array.from({ length: 12 }, (_, i) => `| a${i} | b${i} | c${i} |`).join('\n');
// 150 paragraphs + tables (A: multi-page check)
const DOC_150 = '# Long Doc FIRSTHEAD\n\n' + Array.from({ length: 150 }, (_, i) => {
  const n = i + 1; let s = (n === 1 ? 'FIRST-PARAGRAPH ' : n === 150 ? 'LAST-PARAGRAPH ' : '') + para(n);
  if (n % 50 === 0) s += '\n\n' + LONG_TABLE;
  return s;
}).join('\n\n') + '\n';

// full-content doc (B)
const DOC_CONTENT = `# Heading One Alpha

## Heading Two Beta

### Heading Three Gamma

Some **bold** and *italic* and ~~struck~~ and \`inline code\` text.

- Bullet apple
- Bullet banana
  - Nested cherry

1. Ordered first
2. Ordered second

- [x] Task done item
- [ ] Task todo item

| Name | Qty | Notes |
| --- | ---: | :---: |
| Widget | 12 | first row cell |
| Gadget | 7 | second row cell |

\`\`\`js
function greetWorld(name) {
  return "Hello, " + name;
}
\`\`\`

> Blockquote wisdom line one
> line two of the quote

![blue box](data:image/svg+xml;base64,${BLUE_SVG})

Links: [Example page](https://example.com/page), [Mail me](mailto:jasser@example.com) and [Jump](#heading-one) and [Plain](https://plain.example.org/x).

---

${fence(FLOW_BODY)}

${fence(SEQ)}

Inline math $E=mc^2$ and $a^2+b^2=c^2$ in a sentence.

$$\\int_0^\\infty e^{-x^2}dx=\\frac{\\sqrt\\pi}{2}$$

The End Marker.
`;

// ------------------------------------------------------------------ page helper
function printInit() {
  window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  window.__pr = { calls: 0, log: [] };
  window.print = function () { window.__pr.calls++; window.__pr.log.push('print'); };
  window.__kd = [];
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'p') setTimeout(() => window.__kd.push({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, dp: e.defaultPrevented }), 0); }, true);
}
async function openPrint(ext, { fsa, query = '' } = {}) {
  const page = await ext.ctx.newPage();
  const r = { page, errors: [], reqs: [], dialogs: [], downloads: [] };
  page.on('console', (m) => { if (m.type() === 'error') r.errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => r.errors.push('pageerror: ' + e.message));
  page.on('request', (q) => r.reqs.push(q.url()));
  page.on('requestfailed', (q) => { if (!/^https?:/.test(q.url())) r.errors.push('requestfailed: ' + q.url()); });
  page.on('dialog', (d) => { r.dialogs.push(d.type() + ': ' + d.message()); d.accept(); });
  page.on('download', (d) => r.downloads.push(d.suggestedFilename()));
  await page.addInitScript(printInit);
  if (fsa) await page.addInitScript(fsaStub(), fsaArgs(fsa));
  await page.goto(`chrome-extension://${ext.extId}/editor/index.html${query}`);
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  return r;
}
const rendered = (p, minNodes = 1, timeout = 90000) => p.waitForFunction((n) => { const ns = [...document.querySelectorAll('[data-mdx-node]')]; return ns.length >= n && ns.every((x) => x.dataset.mdxRendered); }, minNodes, { timeout });
const prCalls = (p) => p.evaluate(() => window.__pr.calls);
const prLog = (p) => p.evaluate(() => window.__pr.log);
const kd = (p) => p.evaluate(() => window.__kd);
const csp = (p) => p.evaluate(() => window.__csp);
const clean = (r) => r.errors.filter(bootErrOk);
const external = (r) => r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u));
const focusPM = async (p) => { await p.evaluate(() => window.__mdwe.editor.tiptap.commands.focus('end')); await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('ProseMirror')); await p.waitForTimeout(60); };
const setDark = async (p) => { if (await p.evaluate(() => document.documentElement.dataset.theme) !== 'dark') await p.click('#btn-theme'); await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.querySelector('.mdx-root').dataset.theme === 'dark'); };
const loadDoc = async (p, text, nodes = 0) => { await setMd(p, text); if (nodes) await rendered(p, nodes); await p.waitForTimeout(150); };

// ------------------------------------------------------------------ PDF helpers
let SEQN = 0;
/** print-media PDF of the page (like the page's own doPrint: prepareForPrint first). Returns file path. */
async function makePdf(p, name, { prepare = true, width, height } = {}) {
  if (prepare) await p.evaluate(() => window.__mdwe.editor.prepareForPrint());
  const file = path.join(OUT, `print-${name}.pdf`);
  await p.pdf({ path: file, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  return file;
}
const pdfPages = (f) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1]);
const pdfText = (f, { layout = false, first, last } = {}) => execFileSync('pdftotext', [...(layout ? ['-layout'] : []), ...(first ? ['-f', String(first), '-l', String(last || first)] : []), f, '-'], { maxBuffer: 1 << 28 }).toString('utf8');
const pdfFonts = (f) => execFileSync('pdffonts', [f]).toString();
const pdfPageText = (f) => { const n = pdfPages(f); return Array.from({ length: n }, (_, i) => pdfText(f, { first: i + 1 })); };
const norm = (s) => s.replace(/\s+/g, ' ');
const compact = (s) => s.replace(/[\s\u00ad-]+/g, ''); // pdftotext re-wraps at hyphens/spaces inside long labels and URLs: compare without whitespace/hyphens
function raster(f, name, dpi = 50, keep = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwe-pdf-')); execFileSync('pdftoppm', ['-r', String(dpi), '-png', f, path.join(dir, 'pg')]);
  const stats = JSON.parse(execFileSync('python3', [STATS, dir, String(dpi)], { maxBuffer: 1 << 26 }).toString());
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.png')).sort();
  files.slice(0, keep).forEach((x, i) => fs.copyFileSync(path.join(dir, x), path.join(SCREENS, `print-${name}${keep > 1 ? '-p' + (i + 1) : ''}.png`)));
  fs.rmSync(dir, { recursive: true, force: true }); return stats;
}
const disp = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'absent'; }, sel);
const lum = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb); return m ? 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] : NaN; };

// fields for the "Ctrl+P inside per-block source fields" tests (same open helpers as spec 11 / 12a)
const DOCF = '# K\n\n' + fence('graph LR\n  A-->B') + '\n\nInline $a+b$ text.\n\n$$x+1$$\n\nend\n';
const openInlineMath = async (p) => { const bx = await p.locator(MI + ' .mdx-math-render').boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await expect(p.locator(MI + ' input.mdx-math-source')).toBeVisible(); };
const FIELDS = {
  mermaid: { open: (p) => p.locator(MM + ' [data-mdx-action="toggle-source"]').click(), field: MM + ' textarea.mdx-mermaid-source', val: 'graph LR\n  A-->B\n  B-->QP1', expect: 'B-->QP1' },
  blockMath: { open: (p) => p.locator(MB + ' [data-mdx-action="toggle-source"]').click(), field: MB + ' textarea.mdx-math-source', val: 'x+QP2', expect: '$$x+QP2$$' },
  inlineMath: { open: openInlineMath, field: MI + ' input.mdx-math-source', val: 'a^QP3', expect: '$a^QP3$' },
  wholeDocSource: { open: async (p) => { await p.evaluate(() => window.__mdwe.editor.setSourceMode(true)); await p.locator('.mdx-source').click(); }, field: '.mdx-source', val: null, expect: '# K' },
};

// =====================================================================================================================
// A. page side + print media basics
// =====================================================================================================================
test.describe('A. print button, shortcut, print-media page shell', () => {
  test('#btn-print exists, visible, enabled, has an accessible name, sits in the file bar; click calls window.print exactly once', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const b = p.locator('#btn-print');
    await expect(b).toHaveCount(1); await expect(b).toBeVisible(); await expect(b).toBeEnabled();
    await expect(b).toHaveText('Print / PDF');
    expect(await b.getAttribute('title')).toMatch(/print|pdf/i);
    await expect(p.getByRole('button', { name: /print/i })).toHaveCount(1);
    expect(await b.evaluate((e) => e.closest('#filebar') !== null && e.tagName === 'BUTTON' && e.disabled === false)).toBe(true);
    expect(await prCalls(p)).toBe(0);
    await b.click(); await p.waitForTimeout(500);
    expect(await prCalls(p)).toBe(1);
    await b.click(); await p.waitForTimeout(500);
    expect(await prCalls(p), 'second click prints again (once per click)').toBe(2);
    expect(clean(r)).toEqual([]); expect(await csp(p)).toEqual([]);
  });

  test('Ctrl+P and Cmd+P (metaKey) from the main editor: print once each, default prevented; Ctrl+Shift+P / Alt+Ctrl+P do not print', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# T\n\nhello\n'); await focusPM(p);
    await p.keyboard.press('Control+p'); await p.waitForTimeout(400);
    expect(await prCalls(p)).toBe(1);
    await p.keyboard.press('Meta+p'); await p.waitForTimeout(400);
    expect(await prCalls(p)).toBe(2);
    const k = await kd(p); console.log('Ctrl/Cmd+P keydown records:', JSON.stringify(k));
    expect(k.length).toBe(2);
    expect(k[0]).toMatchObject({ ctrl: true, dp: true }); expect(k[1]).toMatchObject({ meta: true, dp: true });
    await p.keyboard.press('Control+Shift+p'); await p.waitForTimeout(300);
    await p.keyboard.press('Control+Alt+p'); await p.waitForTimeout(300);
    console.log('after Ctrl+Shift+P / Ctrl+Alt+P print calls:', await prCalls(p), 'kd:', JSON.stringify((await kd(p)).slice(2)));
    expect(await prCalls(p), 'Shift/Alt variants must not print').toBe(2);
    expect(await md(p)).toBe('# T\n\nhello\n');
    expect(clean(r)).toEqual([]);
  });

  test('Ctrl+P from inside the mermaid textarea, block-math textarea, inline-math input and whole-doc Source textarea: print once, default prevented, pending edit kept', async ({ ext }) => {
    const res = {};
    for (const [k, f] of Object.entries(FIELDS)) {
      const r = await openPrint(ext); const p = r.page;
      await loadDoc(p, DOCF, 3);
      await f.open(p);
      if (f.val !== null) { await p.locator(f.field).fill(f.val); } else { await p.locator(f.field).press('End'); await p.keyboard.type(' QP4'); }
      await p.keyboard.press('Control+p'); await p.waitForTimeout(500);
      const c1 = await prCalls(p);
      await p.keyboard.press('Meta+p'); await p.waitForTimeout(500);
      const kk = await kd(p);
      const now = await md(p);
      res[k] = { calls: await prCalls(p), after1: c1, dp: kk.map((x) => x.dp), hasEdit: now.includes(f.val === null ? 'QP4' : f.expect), errors: clean(r) };
      await p.close();
    }
    console.log('Ctrl/Cmd+P in fields:', JSON.stringify(res));
    for (const [k, v] of Object.entries(res)) {
      expect(v.after1, k + ': Ctrl+P prints once').toBe(1); expect(v.calls, k + ': Cmd+P prints once more').toBe(2);
      expect(v.dp, k + ' default prevented (Ctrl, Cmd)').toEqual([true, true]); expect(v.hasEdit, k + ' pending edit not lost').toBe(true); expect(v.errors, k).toEqual([]);
    }
  });

  test('native chords still work in the per-block fields (Ctrl+A selects all, Ctrl+Z undoes typing) and none of them print; Ctrl+P does not save/open/download', async ({ ext }) => {
    const r = await openPrint(ext, { fsa: { openContent: DOCF, openName: 'k.md' } }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3);
    const res = {};
    for (const [k, f] of Object.entries({ mermaid: FIELDS.mermaid, blockMath: FIELDS.blockMath, inlineMath: FIELDS.inlineMath })) {
      await f.open(p); const fld = p.locator(f.field);
      await fld.press('End'); await p.keyboard.type('ZZ'); const typed = await fld.inputValue();
      await p.keyboard.press('Control+z'); const undone = await fld.inputValue();
      await p.keyboard.press('Control+a'); const sel = await fld.evaluate((e) => e.selectionEnd - e.selectionStart === e.value.length && e.value.length > 0);
      await p.keyboard.press('Control+c'); await p.keyboard.press('Control+x'); await p.keyboard.press('Control+z'); // cut then undo: value restored, no crash
      res[k] = { undone: undone.length < typed.length, sel };
      await p.keyboard.press('Escape'); await settle(p);
    }
    console.log('native chords:', JSON.stringify(res), 'print calls', await prCalls(p));
    for (const [k, v] of Object.entries(res)) { expect(v.undone, k + ' Ctrl+Z works').toBe(true); expect(v.sel, k + ' Ctrl+A selects all').toBe(true); }
    expect(await prCalls(p), 'native chords never print').toBe(0);
    // Ctrl+P is not confused with Ctrl+S / Ctrl+O
    const s0 = await p.evaluate(() => ({ w: window.__fsa.writes.length, o: window.__fsa.opens, sa: window.__fsa.saveAsCalls }));
    await focusPM(p); await p.keyboard.press('Control+p'); await p.waitForTimeout(500);
    const s1 = await p.evaluate(() => ({ w: window.__fsa.writes.length, o: window.__fsa.opens, sa: window.__fsa.saveAsCalls }));
    expect(s1).toEqual(s0); expect(r.downloads).toEqual([]); expect(await prCalls(p)).toBe(1);
    expect(clean(r)).toEqual([]);
  });

  test('prepareForPrint is awaited before window.print (order check); double Ctrl+P while preparing prints once; a rejecting prepareForPrint still prints and shows a status', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# T\n\nhello\n');
    expect(await p.evaluate(() => typeof window.__mdwe.editor.prepareForPrint)).toBe('function');
    await p.evaluate(() => {
      const ed = window.__mdwe.editor; const orig = ed.prepareForPrint.bind(ed);
      ed.prepareForPrint = async () => { window.__pr.log.push('prep-start'); await new Promise((r) => setTimeout(r, 400)); await orig(); window.__pr.log.push('prep-end'); };
    });
    await p.click('#btn-print'); await p.waitForTimeout(900);
    expect(await prLog(p)).toEqual(['prep-start', 'prep-end', 'print']);
    await p.evaluate(() => { window.__pr.log.length = 0; window.__pr.calls = 0; });
    await focusPM(p); await p.keyboard.press('Control+p'); await p.keyboard.press('Control+p'); await p.click('#btn-print'); await p.waitForTimeout(1200);
    console.log('rapid triple print log:', JSON.stringify(await prLog(p)));
    expect(await prCalls(p), 're-entrancy guard: one print for overlapping requests').toBe(1);
    // reject
    await p.evaluate(() => { window.__pr.log.length = 0; window.__pr.calls = 0; window.__mdwe.editor.prepareForPrint = async () => { throw new Error('boom'); }; });
    await p.click('#btn-print'); await p.waitForTimeout(500);
    expect(await prCalls(p)).toBe(1);
    await expect(p.locator('#status')).toContainText('Print preparation failed');
    expect(r.errors.filter((e) => !/boom/.test(e))).toEqual([]);
  });

  test('print with an empty document does not crash (button, Ctrl+P, PDF) and prints no UI text', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '');
    await p.click('#btn-print'); await p.waitForTimeout(400);
    await p.evaluate(() => window.__mdwe.editor.focus()); await p.keyboard.press('Control+p'); await p.waitForTimeout(400);
    expect(await prCalls(p)).toBe(2);
    const f = await makePdf(p, 'empty');
    const t = pdfText(f); console.log('empty doc PDF pages', pdfPages(f), 'text', JSON.stringify(t.trim()));
    expect(pdfPages(f)).toBeGreaterThanOrEqual(1);
    expect(t).not.toMatch(/Open|Save|Download|Print|Theme|Untitled|Markdown/);
    expect(await md(p)).toBe('');
    expect(clean(r)).toEqual([]);
  });

  test('print media: file bar, status bar, drive badge, toolbar, dropzone hidden (computed display none); editor host grows (not clipped)', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOC_150);
    await p.evaluate(() => { document.getElementById('status').textContent = 'Some status text'; document.getElementById('drive-status').textContent = 'Drive: x'; });
    const screenH = await p.evaluate(() => document.getElementById('editor-host').getBoundingClientRect().height);
    await p.emulateMedia({ media: 'print' });
    const d = {};
    for (const s of ['#filebar', '#status', '#drive-status', '#dropzone', '#fallback-input', '.mdx-toolbar', '.mdx-source', '.gdui-overlay', '.gdui-dialog']) d[s] = await disp(p, s);
    const host = await p.evaluate(() => { const h = document.getElementById('editor-host'); const cs = getComputedStyle(h); const pm = document.querySelector('.ProseMirror').getBoundingClientRect().height; return { overflow: cs.overflow, h: h.getBoundingClientRect().height, sh: h.scrollHeight, pm, bodyOverflow: getComputedStyle(document.body).overflow }; });
    console.log('print-media display:', JSON.stringify(d), 'host', JSON.stringify(host), 'screen host h', screenH);
    for (const s of ['#filebar', '#status', '#drive-status', '#dropzone', '.mdx-toolbar', '.mdx-source']) expect(d[s], s).toBe('none');
    expect(host.overflow).toBe('visible'); expect(host.h).toBeGreaterThan(screenH * 3); expect(host.h + 2).toBeGreaterThanOrEqual(host.pm);
    expect(host.sh - host.h, 'host is not clipped (scrollHeight == height)').toBeLessThanOrEqual(2);
    await p.emulateMedia({ media: null });
  });

  test('150 paragraphs + tables: PDF has multiple pages, contains first and last paragraph, no UI text, nothing clipped (last text reachable)', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOC_150);
    const f = await makePdf(p, 'long150');
    const n = pdfPages(f); const t = pdfText(f); const stats = raster(f, 'long150', 40, 2);
    console.log('150 para PDF pages:', n, 'chars', t.length);
    expect(n).toBeGreaterThan(1); expect(n).toBeLessThan(40);
    expect(t).toContain('Long Doc FIRSTHEAD'); expect(t).toContain('FIRST-PARAGRAPH'); expect(t).toContain('LAST-PARAGRAPH'); expect(t).toContain('Paragraph 75 lorem');
    for (let i = 1; i <= 150; i++) if (!t.includes(`Paragraph ${i} lorem`) && i !== 1 && i !== 150) { throw new Error('paragraph ' + i + ' missing from PDF'); }
    expect(t).toContain('Col A'); expect(t).toContain('c11');
    expect(t).not.toMatch(/Open from Drive|Save to Drive|Print \/ PDF|Untitled\.md|Download|Formatting/);
    // margins: no ink within the right/left margin strips on any page
    const bad = stats.filter((s) => s.inkRight > 0 || s.inkLeft > 0); console.log('pages with ink in margins:', bad.length, 'of', stats.length);
    expect(bad.map((s) => s.file)).toEqual([]);
    expect(stats.every((s) => s.white > 0.75 && s.dark < 0.2), 'pages white-ish with dark text').toBe(true);
    expect(clean(r)).toEqual([]);
  });

  test('print with a Drive dialog open, and with the dialog in an error state: prints once, dialog/overlay hidden in print media, doc still printed', async ({ ext }) => {
    const files = [{ id: 'f1', name: 'notes.md', text: '# Notes\n\nfirst file\n' }];
    for (const mode of ['open', 'error']) {
      const r = await openDriveEditor(ext, { mock: { files }, extraInit: [printInit] }); const p = r.page;
      await setMd(p, '# Doc DRIVEDOC\n\nbody text BODYTXT\n');
      if (mode === 'error') await p.evaluate(() => { window.__drv.fail.listFiles = { code: 'quota', message: 'Drive quota exceeded QUOTAMSG' }; });
      await p.click('#btn-drive-open'); await p.locator('.gdui-dialog').waitFor();
      if (mode === 'error') await expect(p.locator('.gdui-dialog')).toContainText(/quota|Rate|limit/i);
      else await expect(p.locator('.gdui-dialog .gdui-row')).toHaveCount(1);
      const dlgText = (await p.locator('.gdui-dialog').innerText()).slice(0, 60);
      await p.evaluate(() => document.getElementById('btn-print').click()); await p.waitForTimeout(500); // real click blocked by the modal overlay
      await p.keyboard.press('Control+p'); await p.waitForTimeout(500);
      const calls = await prCalls(p);
      await p.emulateMedia({ media: 'print' });
      const d = { overlay: await disp(p, '.gdui-overlay'), dialog: await disp(p, '.gdui-dialog'), bar: await disp(p, '#filebar') };
      await p.emulateMedia({ media: null });
      const f = await makePdf(p, 'drive-dialog-' + mode); const t = pdfText(f);
      console.log(mode, 'dialog:', JSON.stringify(dlgText), 'print calls', calls, 'display', JSON.stringify(d), 'pdf pages', pdfPages(f));
      expect(calls, mode + ': print calls (button + Ctrl+P)').toBeGreaterThanOrEqual(1);
      expect(d.overlay).toBe('none'); expect(d.dialog).toBe('none'); expect(d.bar).toBe('none');
      expect(t).toContain('DRIVEDOC'); expect(t).toContain('BODYTXT');
      expect(t).not.toMatch(/notes\.md|Open from Google Drive|Sign in|QUOTAMSG|quota|Cancel/i);
      expect(r.errors.filter(bootErrOk)).toEqual([]);
      await p.close();
    }
  });
});

// =====================================================================================================================
// B. Content in PDF
// =====================================================================================================================
test.describe('B. content in the PDF', () => {
  test('headings, lists, tables, code, blockquote, image, links, diagrams (rendered, not source), math (glyphs, not $..$); no edit buttons; margins clean', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOC_CONTENT, 4);
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const f = await makePdf(p, 'content'); const t = pdfText(f); const T = norm(t); const stats = raster(f, 'content', 60, 3); const fonts = pdfFonts(f);
    console.log('content PDF pages', pdfPages(f), 'fonts:\n' + fonts);
    for (const s of ['Heading One Alpha', 'Heading Two Beta', 'Heading Three Gamma', 'Bullet apple', 'Bullet banana', 'Nested cherry', 'Ordered first', 'Ordered second', 'Task done item', 'Task todo item',
      'Widget', 'Gadget', 'first row cell', 'Name', 'Qty', 'Notes', 'greetWorld', 'Hello, ', 'Blockquote wisdom line one', 'line two of the quote', 'Example page', 'Mail me', 'Plain', 'The End Marker.']) expect(T, s).toContain(s);
    // diagrams: rendered text present, source syntax absent
    for (const l of FLOW_LABELS) expect(compact(T), 'flowchart label ' + l).toContain(compact(l));
    expect(T).toContain('Hello Bob'); expect(T).toContain('Hi Alice'); expect(T).toContain('Alice'); expect(T).toContain('Bob');
    for (const src of ['flowchart TD', 'subgraph', '-->', 'sequenceDiagram', 'participant', '->>', '```']) expect(T, 'source text leaked: ' + src).not.toContain(src);
    // math: glyphs from KaTeX fonts, no raw TeX
    expect(fonts).toMatch(/KaTeX_/);
    expect(T).not.toMatch(/\$E=mc|\$a\^2|\$\$|\\int|\\frac|\\sqrt|\\pi/);
    // hidden UI
    expect(T).not.toMatch(/Edit source|Edit .* source|✎|\bDone\b|Formatting|Toggle Markdown|Open from Drive|Print \/ PDF|Untitled/);
    expect(T).not.toMatch(/(^| )(MERMAID|MATH|Mermaid|Math)( |$)/); // block label bars (.mdx-node-head) hidden
    // list markup, code & quote backgrounds, image
    const blue = stats.reduce((a, s) => a + s.blue, 0); console.log('blue px (image) across 3 first pages:', blue);
    expect(blue, 'data-URI image printed (blue pixels)').toBeGreaterThan(1500);
    const bad = stats.filter((s) => s.inkRight > 0 || s.inkLeft > 0); expect(bad.map((s) => s.file), 'ink in margins').toEqual([]);
    // DOM facts: task checkboxes rendered (2), tables have visible border
    expect(await p.locator('.ProseMirror ul[data-type="taskList"] input[type=checkbox]').count()).toBe(2);
    expect(await md(p)).toBe(DOC_CONTENT);
    expect(clean(r)).toEqual([]); expect(await csp(p)).toEqual([]);
  });

  test('links: in print media links are coloured/underlined; anchors kept; markdown unchanged', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, 'See [Example](https://example.com/x).\n');
    await p.emulateMedia({ media: 'print' });
    const cs = await p.evaluate(() => { const a = document.querySelector('.ProseMirror a'); const s = getComputedStyle(a); return { color: s.color, deco: s.textDecorationLine, href: a.getAttribute('href') }; });
    await p.emulateMedia({ media: null });
    console.log('print link style', JSON.stringify(cs));
    expect(cs.deco).toContain('underline'); expect(cs.href).toBe('https://example.com/x');
  });

  test('Edit-source toggles / inline-math pencil / block label bars are display:none in print media; textareas hidden even while a per-block source field is open', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOCF, 3);
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await expect(p.locator(MM + ' textarea.mdx-mermaid-source')).toBeVisible(); // open field
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await p.emulateMedia({ media: 'print' });
    const res = await p.evaluate(() => {
      const all = (s) => [...document.querySelectorAll(s)]; const vis = (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
      return { toggles: all('.mdx-node-toggle').filter(vis).length, toggleCount: all('.mdx-node-toggle').length, heads: all('.mdx-node-head').filter(vis).length, ta: all('textarea, input[type=text]').filter(vis).length, toolbar: all('.mdx-toolbar').filter(vis).length };
    });
    console.log('visible UI in print media:', JSON.stringify(res));
    expect(res.toggleCount).toBe(3); expect(res.toggles).toBe(0); expect(res.heads).toBe(0); expect(res.ta).toBe(0); expect(res.toolbar).toBe(0);
    const f = await makePdf(p, 'no-edit-buttons'); const t = pdfText(f);
    expect(t).not.toMatch(/Edit source|✎|Done|A-->B|graph LR/);
    await p.emulateMedia({ media: null });
  });

  test('bad diagram + bad math: print does not crash; error boxes print sensibly (message + source as plain text), no edit UI, rest of the document prints', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# Errors ERRTOP\n\n' + fence(BAD_MM) + '\n\nBetween BETWEENTXT.\n\n$$\\frac{$$\n\nInline $\\undefinedcmd$ done.\n\nAfter AFTERTXT.\n', 3);
    await expect(p.locator('.mdx-error')).toHaveCount(3);
    await p.click('#btn-print'); await p.waitForTimeout(400); expect(await prCalls(p)).toBe(1);
    const f = await makePdf(p, 'errors'); const t = norm(pdfText(f)); raster(f, 'errors', 70);
    console.log('error PDF text:', t.slice(0, 500));
    for (const s of ['ERRTOP', 'BETWEENTXT', 'AFTERTXT']) expect(t).toContain(s);
    expect(t).toMatch(/Mermaid syntax error/i); expect(t).toMatch(/Math error/i);
    expect(t).not.toMatch(/Edit source|✎|Formatting/);
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    expect(clean(r)).toEqual([]); expect(await csp(p)).toEqual([]);
  });
});

// =====================================================================================================================
// C. Dark mode
// =====================================================================================================================
test.describe('C. dark theme prints light', () => {
  test('dark theme + print media: computed backgrounds white, text dark, code/table backgrounds light, toolbar hidden', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOC_CONTENT, 4); await setDark(p);
    const screen = await p.evaluate(() => getComputedStyle(document.querySelector('.mdx-root')).backgroundColor);
    expect(lum(screen), 'screen is really dark').toBeLessThan(60);
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await p.emulateMedia({ media: 'print' });
    const c = await p.evaluate(() => {
      const g = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); return { bg: cs.backgroundColor, fg: cs.color }; };
      return { html: g('html'), body: g('body'), root: g('.mdx-root'), pm: g('.ProseMirror'), p: g('.ProseMirror p'), h1: g('.ProseMirror h1'), li: g('.ProseMirror li'), pre: g('.ProseMirror pre'), th: g('.ProseMirror th'), td: g('.ProseMirror td'), bq: g('.ProseMirror blockquote'), katex: g('.ProseMirror .katex'), a: g('.ProseMirror a'), scheme: getComputedStyle(document.querySelector('.mdx-root')).colorScheme, toolbar: getComputedStyle(document.querySelector('.mdx-toolbar')).display };
    });
    console.log('dark→print computed:', JSON.stringify(c));
    for (const k of ['html', 'body', 'root']) expect(lum(c[k].bg), k + ' bg light').toBeGreaterThan(240);
    expect(c.pm && (lum(c.pm.bg) > 240 || c.pm.bg === 'rgba(0, 0, 0, 0)'), 'ProseMirror bg white/transparent').toBe(true);
    for (const k of ['root', 'pm', 'p', 'h1', 'li', 'td', 'katex']) expect(lum(c[k].fg), k + ' text dark').toBeLessThan(90);
    expect(lum(c.pre.bg), 'code block bg light').toBeGreaterThan(200); expect(lum(c.th.bg), 'th bg light').toBeGreaterThan(200);
    expect(lum(c.a.fg), 'link colour readable on white').toBeLessThan(140);
    expect(c.toolbar).toBe('none'); expect(c.scheme).toBe('light');
    await p.emulateMedia({ media: null });
    // screen theme unaffected by printing
    expect(await p.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    expect(lum(await p.evaluate(() => getComputedStyle(document.querySelector('.mdx-root')).backgroundColor))).toBeLessThan(60);
  });

  test('dark theme PDF: pages are mostly white with dark text; diagrams (dark->light swap) and math readable; screen restored afterwards', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOC_CONTENT, 4); await setDark(p);
    const before = await p.evaluate(() => window.__mdwe.editor.getMarkdown());
    const f = await makePdf(p, 'dark-content'); const stats = raster(f, 'dark-content', 60, 3); const T = norm(pdfText(f));
    console.log('dark PDF pages', pdfPages(f), 'stats', JSON.stringify(stats.map((s) => ({ f: s.file, white: +s.white.toFixed(3), dark: +s.dark.toFixed(4) }))));
    for (const s of stats) { expect(s.white, s.file + ' mostly white (diagram page has light pastel fills)').toBeGreaterThan(0.6); expect(s.dark, s.file + ' has dark text but no dark blocks').toBeLessThan(0.15); }
    expect(stats.some((s) => s.dark > 0.002), 'dark text present').toBe(true);
    for (const l of FLOW_LABELS.slice(0, 6)) expect(compact(T)).toContain(compact(l));
    expect(T).toContain('Hello Bob'); expect(T).toContain('Heading One Alpha');
    // no-prepare path (plain Ctrl+P after theme switch): still not a dark page
    const f2 = await makePdf(p, 'dark-noprepare', { prepare: false }); const st2 = raster(f2, 'dark-noprepare', 60, 3);
    console.log('dark PDF without prepareForPrint:', JSON.stringify(st2.map((s) => ({ f: s.file, white: +s.white.toFixed(3), dark: +s.dark.toFixed(4) }))));
    for (const s of st2) { expect(s.white, s.file + ' (no prepare) mostly white').toBeGreaterThan(0.6); }
    expect(await p.evaluate(() => window.__mdwe.editor.getMarkdown())).toBe(before);
    expect(clean(r)).toEqual([]);
  });

  test('beforeprint swaps dark diagrams to LIGHT svg synchronously and afterprint restores the dark DOM; document untouched', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# D\n\n' + fence(FLOW_BODY) + '\n\nafter\n', 1); await setDark(p); await rendered(p, 1);
    const fill = () => p.evaluate(() => { const e = document.querySelector(MMSEL + ' svg .node rect, ' + MMSEL + ' svg .node polygon, ' + MMSEL + ' svg .node path'); return e ? getComputedStyle(e).fill : null; }).catch(() => null);
    const q = (label) => p.evaluate((label) => { const n = document.querySelector('[data-mdx-node="mermaid"] svg .node rect'); const t = document.querySelector('[data-mdx-node="mermaid"] svg .node'); return { rectFill: n ? getComputedStyle(n).fill : null, node: t ? getComputedStyle(t).fill : null, svgs: document.querySelectorAll('[data-mdx-node="mermaid"] svg').length, label }; }, label);
    const dark0 = await q('dark-screen');
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await p.emulateMedia({ media: 'print' });
    await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const during = await q('during'); const printing = await p.evaluate(() => window.__mdwe.editor.isPrinting());
    await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    const after = await q('after'); const stillPrinting = await p.evaluate(() => window.__mdwe.editor.isPrinting());
    await p.emulateMedia({ media: null });
    console.log('svg fills dark/during/after:', JSON.stringify([dark0, during, after]), 'isPrinting', printing, stillPrinting);
    expect(during.svgs).toBe(1); expect(after.svgs).toBe(1);
    expect(lum(dark0.rectFill), 'dark svg node fill dark on screen').toBeLessThan(120);
    expect(lum(during.rectFill), 'during print: node fill light').toBeGreaterThan(180);
    expect(after.rectFill, 'after: dark DOM restored').toBe(dark0.rectFill);
    expect(printing).toBe(true); expect(stillPrinting).toBe(false);
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    expect(clean(r)).toEqual([]);
  });
});
const MMSEL = '[data-mdx-node="mermaid"]';

// =====================================================================================================================
// D. Page breaks
// =====================================================================================================================
test.describe('D. page breaks', () => {
  test('headings never orphaned at page bottom; table rows, blockquotes, list items and diagrams are not split across pages', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const parts = ['# Break Test'];
    for (let s = 1; s <= 40; s++) {
      parts.push(`## Section ${s} HEAD`);
      parts.push(Array.from({ length: 1 + (s % 4) }, (_, k) => `Body ${s}.${k} ` + filler(30 + ((s * 7 + k * 13) % 50), 'w')).join('\n\n'));
      if (s % 8 === 3) { // table: every row is a tall wrapped cell with START/END markers
        parts.push('| Id | Detail |\n| --- | --- |\n' + Array.from({ length: 8 }, (_, k) => `| T${s}R${k} | T${s}R${k}START ${filler(60, 'z')} T${s}R${k}END |`).join('\n'));
      }
      if (s % 8 === 5) parts.push(fence(`flowchart TD\n  X${s}1[X${s}N1] --> X${s}2[X${s}N2]\n  X${s}2 --> X${s}3[X${s}N3]\n  X${s}3 --> X${s}4[X${s}N4]\n  X${s}4 --> X${s}5[X${s}N5]`));
      if (s % 8 === 7) parts.push(`> Q${s}START quote ${filler(40, 'q')}\n> more Q${s}END`);
      if (s % 8 === 1) parts.push(Array.from({ length: 6 }, (_, k) => `- LI${s}x${k}START ${filler(25, 'l')} LI${s}x${k}END`).join('\n'));
    }
    await loadDoc(p, parts.join('\n\n') + '\n', 5);
    const f = await makePdf(p, 'breaks'); const pages = pdfPageText(f); const n = pages.length; raster(f, 'breaks', 45, 3);
    console.log('breaks PDF pages', n);
    expect(n).toBeGreaterThan(8);
    const nonEmpty = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
    // 1) headings not last on a page
    const orphans = []; pages.forEach((t, i) => { const ls = nonEmpty(t); const last = ls[ls.length - 1] || ''; if (/^Section \d+ HEAD$/.test(last) || /^Break Test$/.test(last)) orphans.push(`page ${i + 1}: ${last}`); });
    console.log('orphaned headings:', JSON.stringify(orphans)); expect(orphans).toEqual([]);
    // 2) marker pairs on the same page
    const pageOf = (m) => pages.findIndex((t) => t.includes(m));
    const split = [];
    for (let s = 1; s <= 40; s++) {
      if (s % 8 === 3) for (let k = 0; k < 8; k++) { const a = pageOf(`T${s}R${k}START`), b = pageOf(`T${s}R${k}END`); if (a < 0 || b < 0) split.push(`missing T${s}R${k}`); else if (a !== b) split.push(`table row T${s}R${k} p${a + 1}->p${b + 1}`); }
      if (s % 8 === 5) { const ps = [1, 2, 3, 4, 5].map((k) => pageOf(`X${s}N${k}`)); if (ps.includes(-1)) split.push('missing diagram ' + s); else if (new Set(ps).size > 1) split.push(`diagram ${s} pages ${ps.map((x) => x + 1)}`); }
      if (s % 8 === 7) { const a = pageOf(`Q${s}START`), b = pageOf(`Q${s}END`); if (a !== b || a < 0) split.push(`quote ${s} p${a + 1}->p${b + 1}`); }
      if (s % 8 === 1) for (let k = 0; k < 6; k++) { const a = pageOf(`LI${s}x${k}START`), b = pageOf(`LI${s}x${k}END`); if (a !== b || a < 0) split.push(`list item ${s}.${k} p${a + 1}->p${b + 1}`); }
    }
    console.log('split elements:', JSON.stringify(split)); expect(split).toEqual([]);
  });

  test('small code blocks near page bottoms (INFO: CSS deliberately allows code to break): count blocks split across pages, all text present', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const parts = ['# Code breaks'];
    for (let s = 1; s <= 30; s++) { parts.push(Array.from({ length: 1 + (s % 3) }, (_, k) => `P${s}.${k} ` + filler(40 + s, 'w')).join('\n\n')); parts.push('```txt\n' + Array.from({ length: 8 }, (_, k) => `C${s}L${k} code line ${k}`).join('\n') + '\n```'); }
    await loadDoc(p, parts.join('\n\n') + '\n');
    const f = await makePdf(p, 'codebreaks'); const pages = pdfPageText(f);
    const pageOf = (m) => pages.findIndex((t) => t.includes(m));
    const split = []; for (let s = 1; s <= 30; s++) { const a = pageOf(`C${s}L0 `), b = pageOf(`C${s}L7 `); if (a < 0 || b < 0) throw new Error('code block ' + s + ' missing'); if (a !== b) split.push(`C${s}: p${a + 1}->p${b + 1}`); }
    console.log(`CODE (8 lines, fits on a page): ${split.length}/30 split across pages (allowed by print.css break-inside:auto, orphans/widows 3):`, JSON.stringify(split));
    test.info().annotations.push({ type: 'info', description: `8-line code blocks split across pages: ${split.length}/30 ${JSON.stringify(split)}` });
    expect(pages.length).toBeGreaterThan(3);
  });

  test('large diagram scales to the printable page width (svg <= 680px in a 680px print layout), nothing in the margins, diagram text complete', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const WIDE = 'flowchart LR\n' + Array.from({ length: 14 }, (_, i) => `  W${i}[Wide node number ${i} with a fairly long label] --> W${i + 1}[Wide node number ${i + 1} with a fairly long label]`).join('\n');
    await loadDoc(p, '# Scale\n\n' + fence(WIDE) + '\n\n' + fence(FLOW_BODY) + '\n\nEnd.\n', 2);
    const screenW = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node="mermaid"] svg')].map((s) => Math.round(s.getBoundingClientRect().width)));
    await p.setViewportSize({ width: 680, height: 900 }); // Letter (816px) - 2 x 18mm margins (68px) = 680 CSS px printable width
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(200);
    const m = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node="mermaid"] svg')].map((s) => { const b = s.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) }; }));
    console.log('svg widths on screen', JSON.stringify(screenW), 'in 680px print layout', JSON.stringify(m));
    expect(screenW[0], 'the wide diagram is wider than the printable width on screen').toBeGreaterThan(680);
    for (const s of m) { expect(s.w, 'svg width <= printable width').toBeLessThanOrEqual(681); expect(s.right).toBeLessThanOrEqual(681); }
    await p.emulateMedia({ media: null }); await p.setViewportSize({ width: 1200, height: 800 });
    const f = await makePdf(p, 'scale'); const stats = raster(f, 'scale', 60, 2); const T = norm(pdfText(f));
    expect(stats.filter((s) => s.inkRight > 0 || s.inkLeft > 0).map((s) => s.file), 'no ink in margins (nothing clipped or overflowing)').toEqual([]);
    expect(T).toContain('Wide node number 0 with'); expect(T).toContain('Wide node number 14 with'); for (const l of FLOW_LABELS) expect(compact(T)).toContain(compact(l));
    expect(clean(r)).toEqual([]);
  });

  test('very long code line wraps inside the page (no ink in margins, text complete)', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# Wide\n\n```txt\nLONGLINESTART ' + 'abcdefghij'.repeat(30) + ' LONGLINEEND\n```\n\nEnd.\n');
    const f = await makePdf(p, 'longline'); const stats = raster(f, 'longline', 60, 1); const T = compact(pdfText(f));
    expect(stats.filter((s) => s.inkRight > 0 || s.inkLeft > 0).map((s) => s.file)).toEqual([]);
    expect(T).toContain('LONGLINESTART'); expect(T).toContain('LONGLINEEND');
  });

  // [BUG-32] wide table with unbreakable cell content: columns beyond the page width are silently cut off in the PDF (found by this probe)
  const wideTable = (cols, rows, w) => '| ' + Array.from({ length: cols }, (_, i) => `H${i}`).join(' | ') + ' |\n| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n' + Array.from({ length: rows }, (_, k) => '| ' + Array.from({ length: cols }, (_, i) => `cell${k}${i} ` + 'x'.repeat(w)).join(' | ') + ' |').join('\n');
  test('[BUG-32] wide table (9 columns of 14-char unbreakable words): every column is printed (none cut off at the page edge)', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# Wide\n\n' + wideTable(9, 4, 14) + '\n\nEnd.\n');
    const f = await makePdf(p, 'wide-table-9col'); raster(f, 'wide-table-9col', 60, 1); const T = compact(pdfText(f));
    const missing = []; for (let i = 0; i < 9; i++) { if (!T.includes('H' + i)) missing.push('H' + i); for (let k = 0; k < 4; k++) if (!T.includes(`cell${k}${i}`)) missing.push(`cell${k}${i}`); }
    const tw = await (async () => { await p.emulateMedia({ media: 'print' }); const v = await p.evaluate(() => ({ table: document.querySelector('table').getBoundingClientRect().width, min: Math.min(...[...document.querySelectorAll('th')].map((t) => t.getBoundingClientRect().width)), vw: innerWidth })); await p.emulateMedia({ media: null }); return v; })();
    console.log('9-col table: missing from PDF:', JSON.stringify(missing), 'print layout (viewport-wide) table width', JSON.stringify(tw));
    expect(missing, 'columns/cells lost in the PDF').toEqual([]);
  });
  test('wide table with 8 columns and wrappable text prints fully (control for BUG-32)', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# Wide8\n\n' + wideTable(8, 4, 3) + '\n\nEnd.\n');
    const f = await makePdf(p, 'wide-table-8col'); const T = compact(pdfText(f));
    for (let i = 0; i < 8; i++) { expect(T).toContain('H' + i); expect(T).toContain(`cell3${i}`); }
  });
});

// =====================================================================================================================
// E. Long document
// =====================================================================================================================
test.describe('E. long document', () => {
  test('320 paragraphs + 4 diagrams + 4 math blocks + tables: PDF within time budget, page count sane, all content present', async ({ ext }) => {
    test.setTimeout(240000);
    const r = await openPrint(ext); const p = r.page;
    const parts = ['# Big Doc BIGTOP'];
    for (let i = 1; i <= 320; i++) {
      parts.push((i === 1 ? 'BIG-FIRST ' : i === 320 ? 'BIG-LAST ' : '') + para(i));
      if (i % 80 === 40) parts.push(fence(i === 40 ? FLOW_BODY : i === 120 ? SEQ : `flowchart LR\n  B${i}A[Big ${i} A] --> B${i}B[Big ${i} B] --> B${i}C[Big ${i} C]`));
      if (i % 80 === 60) parts.push(`$$\\sum_{k=1}^{${i}} k = \\frac{${i}(${i}+1)}{2}$$`);
      if (i % 100 === 0) parts.push(LONG_TABLE);
    }
    const doc = parts.join('\n\n') + '\n';
    const t0 = Date.now(); await loadDoc(p, doc, 8); const tLoad = Date.now() - t0;
    const t1 = Date.now(); await p.evaluate(() => window.__mdwe.editor.prepareForPrint()); const tPrep = Date.now() - t1;
    const t2 = Date.now(); const f = await makePdf(p, 'long320', { prepare: false }); const tPdf = Date.now() - t2;
    const n = pdfPages(f); const T = norm(pdfText(f));
    console.log(`long doc: load+render ${tLoad} ms, prepareForPrint ${tPrep} ms, pdf ${tPdf} ms, pages ${n}, bytes ${fs.statSync(f).size}`);
    expect(tPrep, 'prepareForPrint well under its 30 s cap').toBeLessThan(20000); expect(tPdf).toBeLessThan(60000);
    expect(n).toBeGreaterThan(10); expect(n).toBeLessThan(90);
    expect(T).toContain('BIGTOP'); expect(T).toContain('BIG-FIRST'); expect(T).toContain('BIG-LAST'); expect(T).toContain('Paragraph 160 lorem');
    for (const l of ['GDELT 2.0 Event Database', 'Hello Bob', 'Big 200 A', 'Big 280 C']) expect(compact(T)).toContain(compact(l));
    expect(await md(p)).toBe(doc); expect(clean(r)).toEqual([]);
    // button path is quick too
    await p.click('#btn-print'); await p.waitForTimeout(500); expect(await prCalls(p)).toBe(1);
  });
});

// =====================================================================================================================
// F. Source mode
// =====================================================================================================================
test.describe('F. whole-document Source mode', () => {
  test('Source toggle prints as monospace markdown text (mirror <pre>), toolbar/textarea/WYSIWYG hidden; Ctrl+P works from the textarea', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const SRC = '# Source Title SRCT\n\nSome **bold** text with [a link](https://example.com/s) and `code`.\n\n- item one\n- item two\n\n```js\nconst x = 1;\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    await loadDoc(p, SRC);
    await p.evaluate(() => window.__mdwe.editor.setSourceMode(true)); await expect(p.locator('.mdx-source')).toBeVisible();
    await p.locator('.mdx-source').click(); await p.keyboard.press('Control+p'); await p.waitForTimeout(500);
    expect(await prCalls(p)).toBe(1);
    await p.emulateMedia({ media: 'print' });
    const d = await p.evaluate(() => { const pre = document.querySelector('pre.mdx-print-source'); const cs = pre && getComputedStyle(pre); return { pre: cs && cs.display, family: cs && cs.fontFamily, text: pre && pre.textContent, ta: getComputedStyle(document.querySelector('.mdx-source')).display, wys: getComputedStyle(document.querySelector('.mdx-wysiwyg')).display, toolbar: getComputedStyle(document.querySelector('.mdx-toolbar')).display, ws: cs && cs.whiteSpace }; });
    console.log('source mode print DOM:', JSON.stringify({ ...d, text: (d.text || '').length + ' chars' }));
    expect(d.pre).toBe('block'); expect(d.family).toMatch(/mono|Menlo|Consolas/i); expect(d.ta).toBe('none'); expect(d.wys).toBe('none'); expect(d.toolbar).toBe('none'); expect(d.ws).toBe('pre-wrap');
    expect(d.text).toBe(SRC);
    await p.emulateMedia({ media: null });
    const f = await makePdf(p, 'source-mode'); const t = pdfText(f); const T = norm(t); const fonts = pdfFonts(f); raster(f, 'source-mode', 70);
    console.log('source PDF fonts:\n' + fonts);
    for (const s of ['# Source Title SRCT', '**bold**', '[a link](https://example.com/s)', '`code`', '- item one', '```js', 'const x = 1;', '| a | b |', '| - | - |']) expect(T, s).toContain(s);
    expect((t.match(/Source Title SRCT/g) || []).length, 'title only once (no rendered WYSIWYG copy)').toBe(1);
    expect(fonts, 'monospace font in PDF').toMatch(/Mono|Courier|Consolas|Menlo|Liberation Mono/i);
    expect(t).not.toMatch(/Formatting|Print \/ PDF|Open from Drive|Toggle Markdown/);
    expect(await md(p)).toBe(SRC); expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    // back to WYSIWYG prints the rendered doc
    await p.evaluate(() => window.__mdwe.editor.setSourceMode(false));
    const f2 = await makePdf(p, 'source-off'); const t2 = pdfText(f2);
    expect(t2).toContain('Source Title SRCT'); expect(t2).not.toContain('# Source Title'); expect(t2).not.toContain('**bold**');
    expect(clean(r)).toEqual([]);
  });

  test('Source mode in dark theme prints dark text on white', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# Dark Source\n\ntext\n'); await setDark(p); await p.evaluate(() => window.__mdwe.editor.setSourceMode(true));
    const f = await makePdf(p, 'source-dark'); const st = raster(f, 'source-dark', 60);
    console.log('dark source stats', JSON.stringify(st.map((s) => ({ white: +s.white.toFixed(3), dark: +s.dark.toFixed(4) }))));
    expect(st[0].white).toBeGreaterThan(0.95); expect(st[0].dark).toBeGreaterThan(0.00002); expect(pdfText(f)).toContain('# Dark Source');
  });
});

// =====================================================================================================================
// G. print links
// =====================================================================================================================
test.describe('G. setPrintLinks', () => {
  const LINKS = 'See [Example page](https://example.com/page), [Secure](http://insecure.example.net/a?b=1), [Mail me](mailto:jasser@example.com), [Jump](#top-anchor) and <https://auto.example.org/z>.\n';
  test('setPrintLinks(false/default): no URLs printed; setPrintLinks(true): " (url)" after http(s)/mailto links only (not #anchors); false again removes them; doc unchanged', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, '# Links\n\n' + LINKS + '\n[js](javascript:alert(1)) end.\n');
    const before = await md(p);
    expect(await p.evaluate(() => typeof window.__mdwe.editor.setPrintLinks)).toBe('function');
    const f0 = await makePdf(p, 'links-default'); const T0 = norm(pdfText(f0));
    console.log('default link text:', T0.slice(0, 200));
    expect(T0).toContain('Example page'); expect(T0).not.toContain('https://example.com/page'); expect(T0).not.toContain('jasser@example.com'); expect(T0).not.toContain('insecure.example.net/a');
    await p.evaluate(() => window.__mdwe.editor.setPrintLinks(true));
    expect(await p.evaluate(() => document.querySelector('.mdx-root').hasAttribute('data-print-links'))).toBe(true);
    const f1 = await makePdf(p, 'links-on'); const T1 = norm(pdfText(f1)); const C1 = compact(T1); raster(f1, 'links-on', 70);
    console.log('links ON text:', T1.slice(0, 300));
    expect(T1).toContain('Example page (https://example.com/page)'); expect(T1).toContain('(http://insecure.example.net/a?b=1)'); expect(C1).toContain(compact('Mail me (mailto:jasser@example.com)'));
    expect(T1).toContain('https://auto.example.org/z'); expect(C1).toContain(compact('https://auto.example.org/z (https://auto.example.org/z)'));
    expect(T1).not.toContain('#top-anchor'); expect(T1).not.toContain('javascript:');
    expect(await md(p), 'markdown unchanged by setPrintLinks').toBe(before);
    await p.evaluate(() => window.__mdwe.editor.setPrintLinks(false));
    expect(await p.evaluate(() => document.querySelector('.mdx-root').hasAttribute('data-print-links'))).toBe(false);
    const f2 = await makePdf(p, 'links-off'); const T2 = norm(pdfText(f2));
    expect(T2).not.toContain('https://example.com/page'); expect(T2).not.toContain('mailto:');
    // on screen the URLs are never shown (only in print media)
    await p.evaluate(() => window.__mdwe.editor.setPrintLinks(true));
    const scr = await p.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror a'), '::after').content);
    expect(scr === 'none' || scr === 'normal' || scr === '""', 'no ::after content on screen: ' + scr).toBe(true);
    await p.evaluate(() => window.__mdwe.editor.setPrintLinks(false));
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// H. safety
// =====================================================================================================================
test.describe('H. safety', () => {
  test('printing does not mutate the document: markdown byte-identical, isModified/dirty/draft unchanged, no onChange, DOM of diagrams restored; light and dark', async ({ ext }) => {
    for (const dark of [false, true]) {
      const r = await openPrint(ext); const p = r.page;
      await loadDoc(p, DOC_CONTENT, 4); if (dark) await setDark(p);
      await p.evaluate(() => { window.__chg = 0; const ed = window.__mdwe.editor.tiptap; ed.on('update', () => window.__chg++); });
      await settle(p);
      const snap = async () => ({ md: await md(p), mod: await p.evaluate(() => window.__mdwe.editor.isModified()), st: await p.evaluate(() => ({ dirty: window.__mdwe.state.dirty, savedText: window.__mdwe.state.savedText, name: window.__mdwe.state.name })), draft: await storageGet(p, 'mdwe.draft'), title: await p.title(), fname: await p.locator('#filename').getAttribute('class') });
      const b = await snap();
      await p.click('#btn-print'); await p.waitForTimeout(500);
      await p.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await p.emulateMedia({ media: 'print' });
      const f = await makePdf(p, 'safety-' + (dark ? 'dark' : 'light'), { prepare: true });
      await p.emulateMedia({ media: null }); await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await p.waitForTimeout(1200); // > autosave debounce
      const a = await snap(); const chg = await p.evaluate(() => window.__chg);
      console.log((dark ? 'dark' : 'light'), 'before/after equal:', JSON.stringify(b) === JSON.stringify(a), 'tiptap update events', chg);
      expect(a.md).toBe(b.md); expect(a.md).toBe(DOC_CONTENT); expect(a.mod).toBe(false); expect(a).toEqual(b);
      expect(chg, 'no ProseMirror doc updates caused by printing').toBe(0);
      expect(await p.evaluate(() => window.__mdwe.editor.isPrinting())).toBe(false);
      expect(await p.locator('[data-mdx-node="mermaid"] svg').count()).toBe(2);
      expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
      await p.close();
    }
  });

  test('printing an edited (dirty) document keeps the dirty state and draft, and does not save', async ({ ext }) => {
    const r = await openPrint(ext, { fsa: { openContent: '# Base\n\ntext\n', openName: 'b.md' } }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('b.md');
    await focusPM(p); await p.keyboard.type(' EDITED'); await p.waitForTimeout(1200);
    const before = { md: await md(p), draft: await storageGet(p, 'mdwe.draft.file'), cls: await p.locator('#filename').getAttribute('class') };
    expect(before.cls).toContain('dirty'); expect(before.draft).toBeTruthy();
    await p.click('#btn-print'); await p.keyboard.press('Control+p'); await p.waitForTimeout(800);
    const f = await makePdf(p, 'dirty'); expect(pdfText(f)).toContain('EDITED');
    await p.waitForTimeout(1000);
    const after = { md: await md(p), draft: await storageGet(p, 'mdwe.draft.file'), cls: await p.locator('#filename').getAttribute('class') };
    expect(after).toEqual(before);
    expect(await p.evaluate(() => window.__fsa.writes.length)).toBe(0); expect(r.downloads).toEqual([]);
  });

  test('no network requests to non-extension origins while printing (button, Ctrl+P, PDF, dark, source, links); 0 CSP violations', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    await loadDoc(p, DOC_CONTENT, 4); await setDark(p);
    const n0 = r.reqs.length;
    await p.click('#btn-print'); await p.keyboard.press('Control+p');
    await p.evaluate(() => window.__mdwe.editor.setPrintLinks(true));
    await makePdf(p, 'net-1');
    await p.evaluate(() => { window.__mdwe.editor.setPrintLinks(false); window.__mdwe.editor.setSourceMode(true); });
    await makePdf(p, 'net-2');
    console.log('requests during print:', r.reqs.length - n0, 'external:', JSON.stringify(external(r)));
    expect(external(r)).toEqual([]); expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });

  test('manifest unchanged by the print feature: CSP exactly script-src \'self\'; object-src \'self\'; permissions storage+identity; host_permissions googleapis only; identical to git HEAD', async () => {
    const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    expect(m.content_security_policy).toEqual({ extension_pages: "script-src 'self'; object-src 'self'" });
    expect(m.permissions).toEqual(['storage', 'identity']); expect(m.host_permissions).toEqual(['https://www.googleapis.com/*']);
    expect(m.web_accessible_resources).toEqual([]); expect(m.oauth2.scopes).toEqual(['https://www.googleapis.com/auth/drive']);
    let head = null; try { head = execFileSync('git', ['show', 'HEAD:extension/manifest.json'], { cwd: ROOT }).toString(); } catch { /* not a git checkout */ }
    if (head) expect(m, 'manifest identical to the committed one').toEqual(JSON.parse(head));
    // no print permission or new API surface: extension JS has no chrome.tabs/printing/debugger usage
    const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'); expect(bg).not.toMatch(/chrome\.(printing|debugger|pageCapture)/);
    // built bundle: print code introduces no eval / remote urls
    const assets = fs.readdirSync(path.join(EXT, 'editor', 'assets')).filter((x) => /^index-.*\.js$/.test(x)); console.log('index bundles:', assets);
    expect(assets.length, 'only one index bundle').toBe(1);
    const js = fs.readFileSync(path.join(EXT, 'editor', 'assets', assets[0]), 'utf8');
    expect(js).toContain('prepareForPrint'); expect(js).toContain('setPrintLinks');
    expect(js).not.toMatch(/\beval\(|new Function\(/);
    const css = fs.readdirSync(path.join(EXT, 'editor', 'assets')).filter((x) => /^index-.*\.css$/.test(x)).map((x) => fs.readFileSync(path.join(EXT, 'editor', 'assets', x), 'utf8')).join('\n');
    expect(css).toMatch(/@media print/); expect(css).not.toMatch(/url\(\s*['"]?https?:/);
  });
});

// =====================================================================================================================
// I. print tables (BUG-32 hardening): wide / unbreakable / URL / code cells, light + dark, margins, row breaks, alignment, nesting, images, diagrams+math
// =====================================================================================================================
test.describe('I. print tables', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const ROWS = 3;
  const HDR = (i) => `HD${pad(i)}`;
  // token generators (letters+digits only, so markdown never sees emphasis/escapes); every token is unique per (kind,row,col)
  const KINDS = {
    word: { label: 'unbreakable words', cell: (r, i) => `UW${r}c${pad(i)}` + 'x'.repeat(14), md: (t) => t },
    url: { label: 'long URLs', cell: (r, i) => `https://example.com/very/long/path/segment/r${r}c${pad(i)}/index.html?token=abcdef0123456789abcdef0123456789`, md: (t) => t },
    code: { label: 'long inline code', cell: (r, i) => `some_long_identifier_name_r${r}_c${pad(i)}_with_no_spaces_at_all`, md: (t) => '`' + t + '`' },
  };
  const tableMd = (cols, kind, { rows = ROWS } = {}) => {
    const K = KINDS[kind];
    return '| ' + Array.from({ length: cols }, (_, i) => HDR(i)).join(' | ') + ' |\n| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n' +
      Array.from({ length: rows }, (_, r) => '| ' + Array.from({ length: cols }, (_, i) => K.md(K.cell(r, i))).join(' | ') + ' |').join('\n');
  };
  const tokensOf = (cols, kind, { rows = ROWS } = {}) => { const t = []; for (let i = 0; i < cols; i++) t.push(HDR(i)); for (let r = 0; r < rows; r++) for (let i = 0; i < cols; i++) t.push(KINDS[kind].cell(r, i)); return t; };
  // pdftotext -raw = content-stream order (cell after cell), so mid-word wrapped cells stay contiguous; whitespace/hyphens stripped before comparing
  const rawText = (f, o = {}) => execFileSync('pdftotext', ['-raw', ...(o.first ? ['-f', String(o.first), '-l', String(o.first)] : []), f, '-'], { maxBuffer: 1 << 28 }).toString('utf8');
  const rawPages = (f) => Array.from({ length: pdfPages(f) }, (_, i) => rawText(f, { first: i + 1 }));
  const missingTokens = (T, tokens) => { const C = compact(T); return tokens.filter((t) => !C.includes(compact(t))); };
  /** Column-aware extraction for tables that wrap cells over several lines: pdftotext (even -raw) emits line by line ACROSS the row, which interleaves
   *  the wrapped pieces of neighbouring cells. Here word boxes (-bbox) are bucketed by column x-range (fixed layout => equal columns) and read top-to-bottom,
   *  page by page, so each column's text is the concatenation of its cells in order. Returns one whitespace-free string per column. */
  function columnTexts(f, cols) {
    const x = execFileSync('pdftotext', ['-bbox', f, '-'], { maxBuffer: 1 << 28 }).toString();
    const PT = 0.75, left = (612 - 680 * PT) / 2, cw = 680 * PT / cols; const out = Array.from({ length: cols }, () => []); let pg = 0;
    for (const line of x.split('\n')) {
      if (/<page /.test(line)) { pg++; continue; }
      const m = /xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">(.*)<\/word>/.exec(line); if (!m) continue;
      const cx = (+m[1] + +m[3]) / 2; const ci = Math.min(cols - 1, Math.max(0, Math.floor((cx - left) / cw)));
      out[ci].push({ pg, y: +m[2], x: +m[1], w: m[4].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') });
    }
    return out.map((ws) => compact(ws.sort((a, b) => a.pg - b.pg || Math.round(a.y) - Math.round(b.y) || a.x - b.x).map((w) => w.w).join('')));
  }
  /** tokens (one per row/col) that are not found in their own column's text, in order */
  const missingByColumn = (f, cols, kind, rows = ROWS) => { const ct = columnTexts(f, cols); const miss = []; for (let i = 0; i < cols; i++) for (const t of [HDR(i), ...Array.from({ length: rows }, (_, r) => KINDS[kind].cell(r, i))]) if (!ct[i].includes(compact(t))) miss.push(`col${i}:${t}`); return miss; };
  /** measure tables in the 680px (= Letter minus 2x18mm) print layout: geometry + any cell whose content overflows its box */
  async function printGeom(p) {
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint());
    await p.setViewportSize({ width: 680, height: 900 }); await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(250);
    const g = await p.evaluate(() => {
      const root = document.querySelector('.ProseMirror').getBoundingClientRect();
      return [...document.querySelectorAll('.ProseMirror table')].map((t) => {
        const b = t.getBoundingClientRect(); const cells = [...t.querySelectorAll('th, td')];
        const first = [...t.rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().width * 10) / 10);
        return { left: b.left, right: b.right, width: b.width, cols: first, docLeft: root.left, docRight: root.right,
          overflowCells: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length, tblScroll: t.scrollWidth - t.clientWidth, nCells: cells.length,
          parentOverflow: getComputedStyle(t.parentElement).overflowX, fixed: getComputedStyle(t).tableLayout };
      });
    });
    await p.emulateMedia({ media: null }); await p.setViewportSize({ width: 1200, height: 800 });
    return g;
  }
  const noMarginInk = (stats) => stats.filter((s) => s.inkRight > 0 || s.inkLeft > 0).map((s) => s.file);

  // ---- 1. matrix: 8/9/12/20 columns x {words, URLs, inline code} x {light, dark}
  for (const dark of [false, true]) for (const cols of [8, 9, 12, 20]) {
    test(`${cols}-column tables (unbreakable words + long URLs + long inline code), ${dark ? 'dark' : 'light'}: every header/cell token printed, table inside page box, nothing in the margins`, async ({ ext }) => {
      const r = await openPrint(ext); const p = r.page;
      const kinds = Object.keys(KINDS);
      await loadDoc(p, '# Wide ' + cols + '\n\n' + kinds.map((k) => `Table of ${KINDS[k].label} TBLINTRO${k.toUpperCase()}\n\n` + tableMd(cols, k)).join('\n\n') + '\n\nEnd TBLEND.\n');
      expect(await p.locator('.ProseMirror table').count()).toBe(3);
      expect(await p.locator('.ProseMirror table').first().locator('tr:first-child > th').count(), 'header cells parsed').toBe(cols);
      if (dark) await setDark(p);
      const geo = await printGeom(p);
      const name = `tbl-${cols}col-${dark ? 'dark' : 'light'}`;
      const f = await makePdf(p, name); const stats = raster(f, name, 60, 1); const T = rawText(f);
      const miss = {}; for (const k of kinds) miss[k] = missingTokens(T, tokensOf(cols, k));
      // cells wrapped over several lines: also check per column (each token must sit in its own column), tokens not found in whole-page text are re-checked there
      for (const k of kinds) if (miss[k].length) { const byCol = missingByColumn(f, cols, k); miss[k] = miss[k].filter((t) => byCol.some((b) => b.endsWith(':' + t))); }
      console.log(name, 'pages', pdfPages(f), 'missing:', JSON.stringify(miss), 'geometry:', JSON.stringify(geo.map((g) => ({ w: Math.round(g.width), right: Math.round(g.right), ovf: g.overflowCells, of: g.nCells, minCol: Math.min(...g.cols), fixed: g.fixed }))));
      for (const k of kinds) expect(miss[k], `${cols} cols ${k}: tokens lost from PDF`).toEqual([]);
      expect(compact(T)).toContain('TBLEND');
      for (const g of geo) {
        expect(g.right, 'table right edge within the 680px printable width').toBeLessThanOrEqual(g.docRight + 1); expect(g.left).toBeGreaterThanOrEqual(g.docLeft - 1);
        expect(g.overflowCells, 'no cell whose content is wider than the cell (would spill into the next column / margin)').toBe(0);
        expect(g.tblScroll, 'table has no horizontal scroll overflow').toBeLessThanOrEqual(1);
        expect(g.fixed).toBe('fixed');
        expect(Math.min(...g.cols), 'no collapsed column').toBeGreaterThan(680 / cols * 0.6);
      }
      expect(noMarginInk(stats), 'ink in the left/right margin strips').toEqual([]);
      if (dark) expect(stats[0].white, 'dark theme prints on white').toBeGreaterThan(0.6);
      expect(clean(r)).toEqual([]); expect(await csp(p)).toEqual([]);
    });
  }

  // ---- 1b. all pages (not only page 1) are clear of the margins, 20 columns with many rows
  test('20-column table spanning several pages: every page has clean margins, all rows and tokens present', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page; const rows = 60;
    await loadDoc(p, '# Tall wide\n\n' + tableMd(20, 'word', { rows }) + '\n\nEnd.\n');
    const f = await makePdf(p, 'tbl-20col-tall'); const n = pdfPages(f); const stats = raster(f, 'tbl-20col-tall', 50, 1);
    const miss = missingByColumn(f, 20, 'word', rows);
    console.log('20col x 60 rows pages', n, 'missing', miss.length, 'pages with margin ink', noMarginInk(stats));
    expect(n).toBeGreaterThan(1); expect(miss).toEqual([]); expect(noMarginInk(stats)).toEqual([]);
  });

  // ---- 2. link cells with print URLs on (each token then appears twice: text + " (url)")
  test('setPrintLinks(true) with 9 columns of long link text: text + printed URLs all present, still inside the margins', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page; const cols = 9;
    const url = (i) => `https://example.com/path/to/resource/c${pad(i)}/index.html?session=abcdef0123456789abcdef`;
    const md9 = '| ' + Array.from({ length: cols }, (_, i) => HDR(i)).join(' | ') + ' |\n| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n| ' + Array.from({ length: cols }, (_, i) => `[${url(i)}](${url(i)})`).join(' | ') + ' |\n';
    await loadDoc(p, '# Links in cells\n\n' + md9 + '\nEnd.\n'); await p.evaluate(() => window.__mdwe.editor.setPrintLinks(true));
    const f = await makePdf(p, 'tbl-links'); const stats = raster(f, 'tbl-links', 60, 1); const C = compact(rawText(f));
    const count = (s) => C.split(compact(s)).length - 1;
    const bad = Array.from({ length: cols }, (_, i) => [i, count(url(i))]).filter(([, c]) => c < 2);
    console.log('link cells: occurrences per url (text + printed) ', JSON.stringify(Array.from({ length: cols }, (_, i) => count(url(i)))));
    expect(bad, 'each url printed as link text and again as " (url)"').toEqual([]); expect(noMarginInk(stats)).toEqual([]);
  });

  // ---- 3. normal short content still lays out normally
  test('normal 4-column table (short content): natural widths, words never broken mid-word, header shaded, cells readable, single page; light and dark', async ({ ext }) => {
    const NORMAL = '| Name | Quantity | Price | Notes |\n| --- | --- | --- | --- |\n| Widget | 12 | 3.50 | Standard blue widget for general use |\n| Gadget | 7 | 12.00 | Premium gadget with extended warranty |\n| Gizmo | 150 | 0.99 | Bulk pricing applies above one hundred units |\n| Doohickey | 3 | 45.00 | Special order item, ships in two weeks |';
    const WORDS = ['Name', 'Quantity', 'Price', 'Notes', 'Widget', 'Gadget', 'Gizmo', 'Doohickey', 'Standard', 'general', 'Premium', 'extended', 'warranty', 'Bulk', 'pricing', 'applies', 'hundred', 'units', 'Special', 'order', 'weeks', '3.50', '12.00', '45.00', '0.99', '150'];
    for (const dark of [false, true]) {
      const r = await openPrint(ext); const p = r.page;
      await loadDoc(p, '# Normal table NORMTOP\n\n' + NORMAL + '\n\nAfter NORMEND.\n'); if (dark) await setDark(p);
      const geo = (await printGeom(p))[0];
      const name = 'tbl-normal-' + (dark ? 'dark' : 'light'); const f = await makePdf(p, name); const stats = raster(f, name, 70, 1);
      const T = norm(pdfText(f)); const words = T.split(/\s+/);
      console.log(name, 'pages', pdfPages(f), 'col widths px', JSON.stringify(geo.cols), 'table width', Math.round(geo.width));
      const broken = WORDS.filter((w) => !words.includes(w)); expect(broken, 'words missing or split mid-word: ' + broken.join(',')).toEqual([]);
      expect(pdfPages(f)).toBe(1);
      expect(geo.width, 'table fills the printable width').toBeGreaterThan(680 * 0.97); expect(geo.right).toBeLessThanOrEqual(geo.docRight + 1);
      expect(Math.min(...geo.cols), 'no degenerate column (>= 15% of table)').toBeGreaterThan(geo.width * 0.15); expect(Math.max(...geo.cols)).toBeLessThan(geo.width * 0.6);
      expect(geo.overflowCells).toBe(0);
      expect(noMarginInk(stats)).toEqual([]); expect(stats[0].white).toBeGreaterThan(0.9);
      // the notes column wraps to at most 3 lines per row (readable, not a tall sliver)
      const noteLines = await (async () => { await p.emulateMedia({ media: 'print' }); await p.setViewportSize({ width: 680, height: 900 }); const v = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].slice(1).map((tr) => { const c = tr.cells[3]; return Math.round(c.getBoundingClientRect().height / parseFloat(getComputedStyle(c).lineHeight)); })); await p.emulateMedia({ media: null }); await p.setViewportSize({ width: 1200, height: 800 }); return v; })();
      console.log(name, 'notes cell heights in lines', JSON.stringify(noteLines)); expect(Math.max(...noteLines)).toBeLessThanOrEqual(4);
      await p.close();
    }
  });

  // ---- 4. rows never split across pages; header row stays with the first body row
  test('multi-page 9- and 12-column tables: every row (START..END markers, wrapped over several lines) stays on one page; header kept with first row', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const mk = (cols, tag, rows) => '| ' + Array.from({ length: cols }, (_, i) => `HH${tag}${pad(i)}`).join(' | ') + ' |\n| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n' +
      Array.from({ length: rows }, (_, k) => '| ' + Array.from({ length: cols }, (_, i) => i === 0 ? `RS${tag}${pad(k)}Q ${filler(6, 'a')}` : i === cols - 1 ? `${filler(6, 'z')} RE${tag}${pad(k)}Q` : `mid${tag}${pad(k)}${pad(i)}` + 'y'.repeat(16)).join(' | ') + ' |').join('\n');
    const parts = ['# Row breaks']; for (let s = 0; s < 8; s++) { parts.push(Array.from({ length: 3 + s * 2 }, (_, k) => para(k)).join('\n\n')); parts.push('| HDR' + s + ' | B |\n| - | - |\n| FIRSTROW' + s + ' | x |\n| second' + s + ' | y |'); }
    await loadDoc(p, parts.join('\n\n') + '\n\n' + mk(9, 'N', 45) + '\n\n' + mk(12, 'T', 45) + '\n\nEnd.\n');
    const f = await makePdf(p, 'tbl-rowbreaks'); const pages = rawPages(f).map(compact); const n = pages.length; raster(f, 'tbl-rowbreaks', 40, 2);
    const pageOf = (m) => pages.findIndex((t) => t.includes(m));
    const bad = []; let multi = 0;
    for (const [tag, rows] of [['N', 45], ['T', 45]]) for (let k = 0; k < rows; k++) { const a = pageOf(`RS${tag}${pad(k)}Q`), b = pageOf(`RE${tag}${pad(k)}Q`); if (a < 0 || b < 0) bad.push(`missing ${tag}${k}`); else if (a !== b) bad.push(`row ${tag}${k} p${a + 1}->p${b + 1}`); }
    for (const tag of ['N', 'T']) { const set = new Set(Array.from({ length: 45 }, (_, k) => pageOf(`RS${tag}${pad(k)}Q`))); multi += set.size > 1 ? 1 : 0; }
    const hdrBad = []; for (let s = 0; s < 8; s++) { const a = pageOf('HDR' + s), b = pageOf('FIRSTROW' + s); if (a < 0 || b < 0 || a !== b) hdrBad.push(`table ${s}: header p${a + 1}, first row p${b + 1}`); }
    console.log('row-break PDF pages', n, 'tables spanning pages', multi, 'split rows', JSON.stringify(bad), 'header separated from first row', JSON.stringify(hdrBad));
    expect(n).toBeGreaterThan(4); expect(multi, 'both big tables really span several pages').toBe(2);
    expect(bad).toEqual([]); expect(hdrBad).toEqual([]);
  });

  // ---- 5. images and code inside cells
  test('table cells containing an image and inline code: image scaled into its cell and printed, code wraps, nothing clipped', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page; const cols = 6;
    const codes = Array.from({ length: cols }, (_, i) => `const_variable_name_c${pad(i)}_assigned_value_here`);
    const md6 = '| ' + Array.from({ length: cols }, (_, i) => HDR(i)).join(' | ') + ' |\n| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n' +
      '| ' + Array.from({ length: cols }, (_, i) => i % 2 === 0 ? `![blue ${i}](data:image/svg+xml;base64,${BLUE_SVG})` : '`' + codes[i] + '`').join(' | ') + ' |\n' +
      '| ' + Array.from({ length: cols }, (_, i) => i % 2 === 0 ? 'plain' + i + ' `' + codes[i] + '`' : `![b](data:image/svg+xml;base64,${BLUE_SVG}) cap${i}`).join(' | ') + ' |\n';
    await loadDoc(p, '# Images in table\n\n' + md6 + '\nEnd.\n');
    await p.waitForFunction(() => [...document.images].filter((i) => i.getAttribute('src')).every((i) => i.complete && i.naturalWidth > 0));
    const nimg = await p.locator('.ProseMirror td img[src]').count(); expect(nimg, 'images parsed inside cells').toBe(6);
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint()); await p.setViewportSize({ width: 680, height: 900 }); await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(250);
    const g = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td img[src]')].map((im) => { const c = im.closest('td').getBoundingClientRect(); const b = im.getBoundingClientRect(); return { w: Math.round(b.width), cell: Math.round(c.width), inside: b.right <= c.right + 0.5 && b.left >= c.left - 0.5 }; }));
    const ovf = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td, .ProseMirror th')].filter((c) => c.scrollWidth > c.clientWidth + 1).length);
    await p.emulateMedia({ media: null }); await p.setViewportSize({ width: 1200, height: 800 });
    console.log('image in cell geometry', JSON.stringify(g), 'overflowing cells', ovf);
    expect(g.every((x) => x.inside), 'each image fits inside its cell').toBe(true); expect(ovf).toBe(0);
    const f = await makePdf(p, 'tbl-images'); const stats = raster(f, 'tbl-images', 80, 1); const C = compact(rawText(f));
    console.log('blue px', stats[0].blue);
    expect(stats[0].blue, 'blue image pixels printed').toBeGreaterThan(300); expect(noMarginInk(stats)).toEqual([]);
    for (const t of [...Array.from({ length: cols }, (_, i) => HDR(i)), ...codes, 'plain0', 'cap1', 'cap5']) expect(C, t).toContain(compact(t));
  });

  // ---- 6. tables nested in blockquote / list
  test('wide tables inside a blockquote and inside list items (incl. nested list): all tokens printed, inside the margins, no clipped cells', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page; const cols = 9;
    const t = tableMd(cols, 'word', { rows: 2 });
    const quoted = t.split('\n').map((l) => '> ' + l).join('\n');
    const inList = t.split('\n').map((l) => '  ' + l).join('\n');
    const inNested = t.replace(/UW/g, 'NW').split('\n').map((l) => '    ' + l).join('\n');
    const doc = `# Nested tables\n\n> Quote intro QINTRO\n>\n${quoted}\n\n- List item LINTRO\n\n${inList}\n\n- Outer OUTERINTRO\n  - Inner INNERINTRO\n\n${inNested}\n\nEnd NESTEND.\n`;
    await loadDoc(p, doc);
    const where = await p.evaluate(() => ({ total: document.querySelectorAll('.ProseMirror table').length, inQuote: document.querySelectorAll('.ProseMirror blockquote table').length, inList: document.querySelectorAll('.ProseMirror li table').length }));
    console.log('nested tables parsed:', JSON.stringify(where)); expect(where.inQuote, 'table inside blockquote parsed').toBe(1); expect(where.inList, 'tables inside list items parsed').toBe(2);
    const geo = await printGeom(p);
    const f = await makePdf(p, 'tbl-nested'); const stats = raster(f, 'tbl-nested', 60, 1); const T = rawText(f);
    const miss = missingTokens(T, [...tokensOf(cols, 'word', { rows: 2 }), ...Array.from({ length: 2 }, (_, r) => Array.from({ length: cols }, (_, i) => KINDS.word.cell(r, i).replace('UW', 'NW'))).flat(), 'QINTRO', 'LINTRO', 'OUTERINTRO', 'INNERINTRO', 'NESTEND']);
    console.log('nested PDF missing', JSON.stringify(miss), 'geometry', JSON.stringify(geo.map((g) => ({ l: Math.round(g.left), r: Math.round(g.right), w: Math.round(g.width), ovf: g.overflowCells }))));
    expect(miss).toEqual([]);
    for (const g of geo) { expect(g.right).toBeLessThanOrEqual(g.docRight + 1); expect(g.overflowCells).toBe(0); }
    expect(noMarginInk(stats)).toEqual([]);
  });

  // ---- 7. alignment
  test('column alignment (left / center / right) survives in print: DOM text-align and PDF glyph positions; markdown round-trips', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page;
    const AL = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| LEFTAAA | CENTERBBB | RIGHTCCC |\n| l2 | c2 | r2 |\n| LEFTDDD | CENTEREEE | RIGHTFFF |\n';
    const doc = '# Align\n\n' + AL + '\nEnd.\n';
    await loadDoc(p, doc); const mdBack = await md(p); console.log('alignment markdown round-trip equal:', mdBack === doc, JSON.stringify(mdBack.split('\n').slice(2, 4)));
    expect(mdBack).toBe(doc);
    await p.evaluate(() => window.__mdwe.editor.prepareForPrint()); await p.setViewportSize({ width: 680, height: 900 }); await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(250);
    const d = await p.evaluate(() => { const t = document.querySelector('.ProseMirror table'); return { align: [...t.rows[2].cells].map((c) => getComputedStyle(c).textAlign), head: [...t.rows[0].cells].map((c) => getComputedStyle(c).textAlign), cols: [...t.rows[0].cells].map((c) => { const b = c.getBoundingClientRect(); return [b.left, b.right]; }), pad: getComputedStyle(t.rows[2].cells[0]).paddingLeft }; });
    await p.emulateMedia({ media: null }); await p.setViewportSize({ width: 1200, height: 800 });
    console.log('print text-align body/head', JSON.stringify(d.align), JSON.stringify(d.head), 'cols', JSON.stringify(d.cols));
    expect(d.align).toEqual(['left', 'center', 'right']);
    const f = await makePdf(p, 'tbl-align'); const bbox = execFileSync('pdftotext', ['-bbox', f, '-'], { maxBuffer: 1 << 26 }).toString();
    const wordBox = (w) => { const m = new RegExp(`xMin="([\\d.]+)" yMin="[\\d.]+" xMax="([\\d.]+)" yMax="[\\d.]+">${w}</word>`).exec(bbox); return m ? { x0: +m[1], x1: +m[2] } : null; };
    const PT = 0.75, OFF = (612 - 680 * PT) / 2; // px -> pt, page margin in pt
    const col = d.cols.map(([a, b]) => [a * PT + OFF, b * PT + OFF]);
    const pos = {};
    [['LEFTAAA', 0, 'left'], ['LEFTDDD', 0, 'left'], ['CENTERBBB', 1, 'center'], ['CENTEREEE', 1, 'center'], ['RIGHTCCC', 2, 'right'], ['RIGHTFFF', 2, 'right']].forEach(([w, ci, kind]) => {
      const b = wordBox(w); pos[w] = b && { ...b, dl: b.x0 - col[ci][0], dr: col[ci][1] - b.x1, dc: (b.x0 + b.x1) / 2 - (col[ci][0] + col[ci][1]) / 2, kind };
    });
    console.log('word positions (pt) relative to their column:', JSON.stringify(pos));
    for (const [w, v] of Object.entries(pos)) {
      expect(v, w + ' found in PDF').toBeTruthy();
      if (v.kind === 'left') { expect(v.dl).toBeGreaterThanOrEqual(0); expect(v.dl).toBeLessThan(12); }
      if (v.kind === 'center') expect(Math.abs(v.dc)).toBeLessThan(3);
      if (v.kind === 'right') { expect(v.dr).toBeGreaterThanOrEqual(0); expect(v.dr).toBeLessThan(12); }
    }
  });

  // ---- 8. tables + diagrams + math together
  for (const dark of [false, true]) test(`wide table + normal table + mermaid diagrams + math in one document (${dark ? 'dark' : 'light'}): everything prints, margins clean`, async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page; const cols = 12;
    const doc = '# Mixed MIXTOP\n\n' + tableMd(cols, 'word') + '\n\n' + fence(FLOW_BODY) + '\n\nInline $E=mc^2$ then a normal table:\n\n| Name | Qty | Notes |\n| --- | ---: | :---: |\n| Widget | 12 | first row cell |\n| Gadget | 7 | second row cell |\n\n$$\\int_0^\\infty e^{-x^2}dx=\\frac{\\sqrt\\pi}{2}$$\n\n' + tableMd(9, 'url', { rows: 2 }) + '\n\n' + fence(SEQ) + '\n\nEnd MIXEND.\n';
    await loadDoc(p, doc, 4); if (dark) await setDark(p);
    const name = 'tbl-mixed-' + (dark ? 'dark' : 'light'); const f = await makePdf(p, name); const stats = raster(f, name, 60, 3);
    const raw = rawText(f); const T = norm(pdfText(f)); const fonts = pdfFonts(f);
    const miss = [...missingTokens(raw, tokensOf(cols, 'word')), ...missingTokens(raw, tokensOf(9, 'url', { rows: 2 }))];
    console.log(name, 'pages', pdfPages(f), 'missing table tokens', JSON.stringify(miss));
    expect(miss).toEqual([]);
    for (const l of FLOW_LABELS) expect(compact(T), 'diagram label ' + l).toContain(compact(l));
    expect(T).toContain('Hello Bob'); expect(T).toContain('Hi Alice'); expect(fonts).toMatch(/KaTeX_/); expect(T).not.toMatch(/\\int|\\frac|\$\$/);
    for (const s of ['Widget', 'Gadget', 'first row cell', 'second row cell', 'MIXTOP', 'MIXEND']) expect(compact(T)).toContain(compact(s));
    expect(T).not.toMatch(/flowchart TD|sequenceDiagram|-->/);
    expect(noMarginInk(stats)).toEqual([]);
    expect(await md(p)).toBe(doc); expect(clean(r)).toEqual([]);
  });

  // ---- 9. printing never edits the doc
  test('printing wide tables leaves the document untouched (markdown identical, not dirty), screen layout unchanged', async ({ ext }) => {
    const r = await openPrint(ext); const p = r.page; const doc = '# T\n\n' + tableMd(12, 'word') + '\n';
    await loadDoc(p, doc);
    const scr0 = await p.evaluate(() => { const w = document.querySelector('.tableWrapper'); const t = w.querySelector('table'); return { ov: getComputedStyle(w).overflowX, fixed: getComputedStyle(t).tableLayout, scroll: w.scrollWidth > w.clientWidth }; });
    await makePdf(p, 'tbl-untouched');
    const scr1 = await p.evaluate(() => { const w = document.querySelector('.tableWrapper'); const t = w.querySelector('table'); return { ov: getComputedStyle(w).overflowX, fixed: getComputedStyle(t).tableLayout, scroll: w.scrollWidth > w.clientWidth }; });
    console.log('screen table before/after print', JSON.stringify(scr0), JSON.stringify(scr1));
    expect(scr1, 'screen layout of the table identical before/after printing').toEqual(scr0);
    expect(await md(p)).toBe(doc); expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
  });
});
