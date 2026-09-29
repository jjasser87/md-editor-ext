// 11. Mermaid diagrams + KaTeX math (build index-DUoBI84v.js). Hooks verified in src/editor/mermaid-math.js + renderers.js:
//   [data-mdx-node="mermaid|math-inline|math-block"], .mdx-mermaid-render (svg), .mdx-math-render (.katex),
//   [data-mdx-action="toggle-source"] ("Edit source"/"Done"; inline math: pencil, hover-only), textarea.mdx-mermaid-source / textarea.mdx-math-source / input.mdx-math-source,
//   .mdx-error[data-mdx-error="mermaid|math"], data-mdx-rendered="ok|error".
// Same harness as the other specs (lib/fixture.mjs `ext`, lib/drive.mjs FakeDrive, fsaStub). Never edits src/ or extension/.
import { test, expect, md, setMd, storageGet, fsaStub, fsaArgs, EXT, SCREENS } from '../lib/fixture.mjs';
import { openDriveEditor, FakeDrive } from '../lib/drive.mjs';
import fs from 'node:fs'; import path from 'node:path';

const pm = (p) => p.locator('#editor-host .ProseMirror');
const settle = (p) => p.waitForTimeout(400); // > onChange debounce (250) and node-view commit debounce (350)
const MM = '[data-mdx-node="mermaid"]';
const MI = '[data-mdx-node="math-inline"]';
const MB = '[data-mdx-node="math-block"]';
const shotTo = async (p, name, loc) => { fs.mkdirSync(SCREENS, { recursive: true }); await (loc || p).screenshot({ path: path.join(SCREENS, name) }); };
const bootErrOk = (e) => !/ERR_FILE_NOT_FOUND/.test(e);

// ---------------------------------------------------------------- documents
// Jasser's flowchart, exactly as pasted (with newlines).
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
const FLOW_LABELS = ['Data Layer', 'Modeling Paradigms', 'Evaluation', 'GDELT 2.0 Event Database', 'division_daily_aggregated.csv', 'SEIR Ground-Truth Labels',
  'BBS / UGC / Census 2022', '5D SIEGE Vectors', 'SEIR NetLogo ABM', 'Temporal Persistence Baseline', 'Lagged L2 Logistic Regression', 'Hawkes-Lite Point Process',
  'Causal Benchmark & Holdout Scoring', 'Raw Event Counts', 'Threshold Mapping T_E=14, T_I=60', 'Static Features', 'Offline Validation Only'];
const FLOW_MD = '# Diagram\n\n```mermaid\n' + FLOW_BODY + '\n```\n\nAfter the diagram.\n';
const fence = (body, lang = 'mermaid') => '```' + lang + '\n' + body + '\n```';
const SEQ = 'sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: Hello Bob\n    Bob-->>Alice: Hi Alice';
const PIE = 'pie title Pets adopted\n    "Dogs" : 386\n    "Cats" : 85\n    "Rats" : 15';
const CLS = 'classDiagram\n    class Animal {\n      +String name\n      +eat()\n    }\n    class Dog\n    Animal <|-- Dog';
const GANTT = 'gantt\n    title Release plan\n    dateFormat YYYY-MM-DD\n    section Build\n    Design :a1, 2026-01-01, 5d\n    Code   :after a1, 7d';
const MATH_INLINE = 'Energy $E=mc^2$ here.';
const MATH_BLOCK = '$$\\int_0^\\infty e^{-x^2}dx=\\frac{\\sqrt\\pi}{2}$$';
const ALIGNED = '$$\n\\begin{aligned}\na &= b + c \\\\\nd &= e + f\n\\end{aligned}\n$$';
const BAD_MM = 'flowchart TD\n    A[Start --> B{{\n    this is not valid ))) mermaid';
const COLLAPSED = FLOW_BODY.replace(/\s*\n\s*/g, ' ');

// ---------------------------------------------------------------- page helper (own collectors: requests, responses, CSP events, console)
async function openMM(ext, { init, arg, query = '', blockDialogs = false } = {}) {
  const page = await ext.ctx.newPage();
  const r = { page, errors: [], msgs: [], reqs: [], resps: [], failed: [], dialogs: [], netNoise: [] };
  page.on('console', (m) => { r.msgs.push(m.type() + ': ' + m.text()); if (m.type() === 'error') r.errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => r.errors.push('pageerror: ' + e.message));
  page.on('request', (q) => r.reqs.push(q.url()));
  page.on('response', (s) => r.resps.push({ url: s.url(), status: s.status() }));
  page.on('requestfailed', (q) => { r.failed.push(q.url() + ' ' + ((q.failure() && q.failure().errorText) || '')); r.errors.push('requestfailed: ' + q.url()); });
  page.on('dialog', (d) => { r.dialogs.push(d.type() + ': ' + d.message()); d.accept(); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  if (init) await page.addInitScript(init, arg);
  await page.goto(`chrome-extension://${ext.extId}/editor/index.html${query}`);
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  return r;
}
// Wait until every mermaid/math node has finished rendering (data-mdx-rendered set).
const rendered = (p, minNodes = 1, timeout = 60000) => p.waitForFunction((n) => { const ns = [...document.querySelectorAll('[data-mdx-node]')]; return ns.length >= n && ns.every((x) => x.dataset.mdxRendered); }, minNodes, { timeout });
const csp = (p) => p.evaluate(() => window.__csp);
const svgText = (loc) => loc.evaluate((el) => (el.querySelector('svg') || { textContent: '' }).textContent);
const assetReqs = (r) => r.reqs.filter((u) => /\/editor\/assets\//.test(u)).map((u) => u.split('/assets/')[1]);
const strayBody = (p) => p.evaluate(() => [...document.body.children].map((c) => c.tagName + (c.id ? '#' + c.id : '')).filter((t) => !/^(HEADER|MAIN|DIV#dropzone|INPUT#fallback-input|SCRIPT|DIV#drive|DIALOG)/i.test(t)));
const clean = (r) => r.errors.filter(bootErrOk);
// TipTap's focus() is applied asynchronously (rAF/timeout): wait until the ProseMirror root really is document.activeElement before typing (test race, not an app bug)
const focusAt = async (p, pos) => { await p.evaluate((pos) => window.__mdwe.editor.tiptap.commands.focus(pos), pos); await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('ProseMirror')); await p.waitForTimeout(60); };
const focusEnd = (p) => focusAt(p, 'end');
const focusStart = (p) => focusAt(p, 'start');
const nodeCount = (p, sel) => p.locator(sel).count();

// =====================================================================================================================
// 1. Jasser's flowchart
// =====================================================================================================================
test.describe('1. flowchart', () => {
  test('multi-line ```mermaid flowchart renders an SVG with all node / subgraph / edge labels, no errors, no stray DOM', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, FLOW_MD);
    await rendered(p);
    await expect(p.locator(MM)).toHaveCount(1);
    const box = p.locator(MM + ' .mdx-mermaid-render');
    await expect(box.locator('svg')).toHaveCount(1);
    await expect(p.locator(MM + ' .mdx-error')).toHaveCount(0);
    await expect(p.locator(MM)).toHaveAttribute('data-mdx-rendered', 'ok');
    const t = await svgText(box);
    const missing = FLOW_LABELS.filter((l) => !t.includes(l));
    console.log('flowchart labels missing from svg text:', JSON.stringify(missing));
    expect(missing).toEqual([]);
    expect(await box.locator('svg .cluster').count(), '3 subgraph clusters').toBe(3);
    expect(await box.locator('svg .node').count(), '10 nodes').toBeGreaterThanOrEqual(10);
    expect(await box.locator('svg .edgePaths path, svg path.flowchart-link').count(), 'edges').toBeGreaterThanOrEqual(12); // 12 edges in the source
    const dashed = await box.locator('svg path.edge-pattern-dotted').count();
    console.log('dotted edge paths:', dashed);
    expect(dashed).toBeGreaterThanOrEqual(1);
    const bb = await box.locator('svg').boundingBox(); console.log('flowchart svg size', JSON.stringify(bb));
    expect(bb.width).toBeGreaterThan(200); expect(bb.height).toBeGreaterThan(200);
    expect(await strayBody(p), 'no stray mermaid nodes left in <body>').toEqual([]);
    expect(await md(p)).toBe(FLOW_MD); // unedited
    await shotTo(p, 'mermaid-flowchart-light.png');
    expect(clean(r)).toEqual([]);
  });

  test('single-line COLLAPSED paste (all newlines -> spaces): fenced -> what happens (report), no crash, doc still editable', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const doc = '# Collapsed\n\n```mermaid\n' + COLLAPSED + '\n```\n\nAfter.\n';
    await setMd(p, doc);
    await rendered(p);
    const hasSvg = await p.locator(MM + ' svg').count();
    const err = await p.locator(MM + ' .mdx-error[data-mdx-error="mermaid"]').allInnerTexts();
    console.log(`COLLAPSED fenced flowchart: svg=${hasSvg} inlineError=${err.length ? JSON.stringify(err[0].slice(0, 300)) : 'none'} data-mdx-rendered=${await p.locator(MM).getAttribute('data-mdx-rendered')}`);
    // Either outcome is acceptable, but exactly one of them, and never a crash.
    expect(hasSvg + err.length).toBeGreaterThanOrEqual(1);
    expect(await md(p)).toBe(doc); // nothing lost / altered
    expect(await strayBody(p)).toEqual([]);
    await shotTo(p, 'mermaid-collapsed-error.png', p.locator(MM));
    await p.locator('#editor-host .ProseMirror > p', { hasText: 'After.' }).click(); await p.keyboard.press('Control+End'); await p.keyboard.type(' still typing');
    await settle(p);
    expect(await md(p)).toContain('After. still typing');
    expect(await md(p)).toContain('```mermaid\n' + COLLAPSED + '\n```');
    expect(clean(r)).toEqual([]);
  });

  test('paste (clipboard event): bare multi-line diagram text is wrapped in a mermaid block; single-line collapsed text is pasted as plain text', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const paste = (text) => p.evaluate((t) => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.querySelector('#editor-host .ProseMirror').dispatchEvent(ev); return ev.defaultPrevented;
    }, text);
    await pm(p).click();
    const handled = await paste(FLOW_BODY);
    await rendered(p);
    console.log('multi-line bare paste handled by editor (preventDefault):', handled, '| mermaid nodes:', await nodeCount(p, MM), '| svg:', await nodeCount(p, MM + ' svg'));
    expect(await nodeCount(p, MM)).toBe(1);
    expect(await nodeCount(p, MM + ' svg')).toBe(1);
    expect(await md(p)).toContain('```mermaid\nflowchart TD\n    subgraph Data Layer');
    // collapsed: not wrapped
    await setMd(p, ''); await pm(p).click();
    const handled2 = await paste(COLLAPSED);
    await settle(p);
    const n = await nodeCount(p, MM);
    const out = await md(p);
    console.log('collapsed single-line bare paste: editor handled=', handled2, 'mermaid nodes=', n, '| markdown starts:', JSON.stringify(out.slice(0, 80)));
    expect(n, 'collapsed paste must not silently become a broken diagram block').toBe(0);
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// 2. other diagram types
// =====================================================================================================================
test('2. sequenceDiagram, pie, classDiagram, gantt (+ stateDiagram, erDiagram, mindmap, journey, ~~~ fence, uppercase info) render SVG in one doc', async ({ ext }) => {
  const r = await openMM(ext); const p = r.page;
  const cases = [
    ['sequence', SEQ, ['Alice', 'Bob', 'Hello Bob']],
    ['pie', PIE, ['Dogs', 'Cats', 'Pets adopted']],
    ['class', CLS, ['Animal', 'Dog', 'String name']],
    ['gantt', GANTT, ['Release plan', 'Design']],
    ['state', 'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Busy : go\n    Busy --> [*]', ['Idle', 'Busy']],
    ['er', 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE : contains', ['CUSTOMER', 'ORDER']],
    ['mindmap', 'mindmap\n  root((Root))\n    Branch A\n    Branch B', ['Root', 'Branch A']],
    ['journey', 'journey\n    title My day\n    section Work\n      Code: 5: Me', ['My day']],
  ];
  const doc = cases.map(([, b]) => fence(b)).join('\n\n') + '\n\n~~~mermaid\ngraph LR\n  T1-->T2\n~~~\n\n```Mermaid\ngraph LR\n  U1-->U2\n```\n';
  await setMd(p, doc);
  await rendered(p, cases.length + 2);
  const nodes = p.locator(MM);
  expect(await nodes.count()).toBe(cases.length + 2);
  const res = [];
  for (let i = 0; i < cases.length + 2; i++) {
    const n = nodes.nth(i);
    const svg = await n.locator('svg').count(); const err = await n.locator('.mdx-error').count();
    const t = svg ? await svgText(n) : '';
    const name = i < cases.length ? cases[i][0] : (i === cases.length ? '~~~fence' : 'Mermaid-uppercase');
    const need = i < cases.length ? cases[i][2] : (i === cases.length ? ['T1', 'T2'] : ['U1', 'U2']);
    res.push({ name, svg, err, missing: need.filter((x) => !t.includes(x)) });
  }
  console.log('diagram types:', JSON.stringify(res));
  for (const x of res) { expect(x.err, x.name + ' error').toBe(0); expect(x.svg, x.name + ' svg').toBe(1); expect(x.missing, x.name + ' labels').toEqual([]); }
  expect(await md(p)).toBe(doc);
  expect(await strayBody(p)).toEqual([]);
  console.log('assets loaded for these 10 diagrams:', assetReqs(r).length);
  expect(clean(r)).toEqual([]);
});

// =====================================================================================================================
// 3. KaTeX
// =====================================================================================================================
test.describe('3. KaTeX', () => {
  test('inline $E=mc^2$, block $$\\int...$$ and \\begin{aligned} render .katex (MathML + HTML), keep source in markdown', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const doc = `${MATH_INLINE}\n\n${MATH_BLOCK}\n\n${ALIGNED}\n\nTail text.\n`;
    await setMd(p, doc);
    await rendered(p, 3);
    await expect(p.locator(MI + ' .mdx-math-render .katex')).toHaveCount(1);
    await expect(p.locator(MB + ' .mdx-math-render .katex')).toHaveCount(2);
    await expect(p.locator(MB + ' .mdx-math-render .katex-display')).toHaveCount(2);
    expect(await nodeCount(p, '.mdx-error')).toBe(0);
    const inl = await p.locator(MI + ' .katex-mathml annotation').first().textContent();
    const blk = await p.locator(MB + ' .katex-mathml annotation').first().textContent();
    const ali = await p.locator(MB + ' .katex-mathml annotation').nth(1).textContent();
    console.log('annotations:', JSON.stringify([inl, blk, ali]));
    expect(inl).toBe('E=mc^2'); expect(blk).toBe('\\int_0^\\infty e^{-x^2}dx=\\frac{\\sqrt\\pi}{2}');
    expect(ali).toContain('\\begin{aligned}');
    expect(await p.locator(MB + ' .katex .mtable, ' + MB + ' .katex .col-align-r').count(), 'aligned renders a table-like layout').toBeGreaterThan(0);
    // inline node sits inside the paragraph text
    expect(await p.locator('#editor-host .ProseMirror > p').first().evaluate((e) => e.textContent.includes('Energy') && !!e.querySelector('.katex'))).toBe(true);
    const bb = await p.locator(MB + ' .katex').first().boundingBox(); expect(bb.width).toBeGreaterThan(50); expect(bb.height).toBeGreaterThan(10);
    expect(await md(p)).toBe(doc);
    await shotTo(p, 'math-light.png');
    expect(await csp(p)).toEqual([]);
    expect(clean(r)).toEqual([]);
  });

  test('typing $x^2$ converts to an inline math node; toolbar Diagram / ∑ Math / ∑ Block insert nodes; markdown contains them', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await pm(p).click(); await p.keyboard.type('val $x^2$ ok');
    await rendered(p);
    expect(await nodeCount(p, MI)).toBe(1);
    await settle(p);
    expect(await md(p)).toBe('val $x^2$ ok\n');
    // toolbar
    for (const c of ['diagram', 'mathInline', 'mathBlock']) expect(await nodeCount(p, `.mdx-toolbar [data-cmd="${c}"]`), c).toBe(1);
    await setMd(p, 'x\n'); await pm(p).click(); await p.keyboard.press('Control+End');
    await p.click('.mdx-toolbar [data-cmd="diagram"]');
    await expect(p.locator(MM + ' textarea.mdx-mermaid-source')).toBeVisible();
    await p.click(MM + ' [data-mdx-action="toggle-source"]'); // Done
    await rendered(p);
    await expect(p.locator(MM + ' svg')).toHaveCount(1);
    await p.click('.mdx-toolbar [data-cmd="mathBlock"]');
    await expect(p.locator(MB + ' textarea.mdx-math-source')).toBeVisible();
    await p.click(MB + ' [data-mdx-action="toggle-source"]');
    await rendered(p, 2);
    await p.click('.mdx-toolbar [data-cmd="mathInline"]');
    await expect(p.locator(MI + ' input.mdx-math-source')).toBeVisible();
    await p.keyboard.press('Enter');
    await rendered(p, 3); await settle(p);
    const out = await md(p);
    console.log('toolbar-inserted markdown:', JSON.stringify(out));
    expect(out).toMatch(/```mermaid\nflowchart LR/); expect(out).toContain('$$E = mc^2$$'); expect(out).toContain('$x^2$');
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// 4. byte-identical unedited open + save (local FSA + Drive emulator)
// =====================================================================================================================
const BYTE_DOCS = {
  'lf-flow-math': FLOW_MD + '\nInline $a+b$ and\n\n' + MATH_BLOCK + '\n\n' + ALIGNED + '\n',
  'crlf': '# CRLF doc\r\n\r\n```mermaid\r\nflowchart TD\r\n    A[Start] --> B[End]\r\n```\r\n\r\nInline $E=mc^2$ text  \r\n\r\n$$\r\n\\frac{a}{b}\r\n$$\r\n\r\nend\r\n',
  'trailing-ws': '# WS   \n\n```mermaid   \nflowchart TD   \n    A --> B   \n\n\n    B --> C\n```   \n\n\n\nText with trailing spaces   \nand $x^2$   \n\n$$  \n\\alpha  \n$$   \n\n\n',
  'no-final-newline': 'para $y$\n\n```mermaid\ngraph LR\n  A-->B\n```',
  'tilde-fence-info': '~~~mermaid title="x"\ngraph LR\n  A-->B\n~~~\n\n````mermaid\nsequenceDiagram\n  A->>B: hi\n````\n\n$$ x $$\n\n$$y$$ trailing\n',
  'invalid': fence(BAD_MM) + '\n\n$\\frac{$ and $\\undefinedcmd$\n',
  'dollars': 'costs $5 and $10, `$x$`, \\$a\\$ and\n\n```js\nconst a = `$${b}`; // $c$\n```\n',
};
test.describe('4. unedited open+save is byte-identical', () => {
  test('local file (FSA stub): Ctrl+O -> (wait for diagrams) -> Ctrl+S writes exactly the original bytes; Ctrl+Z / source toggle without edits do not alter', async ({ ext }) => {
    const bad = [];
    for (const [name, text] of Object.entries(BYTE_DOCS)) {
      const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: name + '.md' }) }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText(name + '.md');
      await p.waitForFunction(() => { const ns = [...document.querySelectorAll('[data-mdx-node]')]; return ns.every((x) => x.dataset.mdxRendered); }, null, { timeout: 60000 });
      await settle(p);
      const a = await md(p); const mod = await p.evaluate(() => window.__mdwe.editor.isModified());
      await focusEnd(p); await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await settle(p);
      const afterUndo = await md(p);
      // open + close the first per-block source without edits
      const tog = p.locator('[data-mdx-node="mermaid"] [data-mdx-action="toggle-source"], [data-mdx-node="math-block"] [data-mdx-action="toggle-source"]').first();
      let afterToggle = text;
      if (await tog.count()) { await tog.click(); await settle(p); await tog.click(); await settle(p); afterToggle = await md(p); }
      // whole-doc source toggle and back
      await p.click('.mdx-toolbar [data-cmd="source"]'); const srcTxt = await p.locator('textarea.mdx-source').inputValue(); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
      const afterSrc = await md(p);
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      const w = await p.evaluate(() => ({ writes: window.__fsa.writes.map((x) => x.text), file: Object.values(window.__fsa.files)[0] }));
      const status = await p.locator('#status').innerText();
      const issues = [];
      if (a !== text) issues.push('getMarkdown!=orig'); if (mod) issues.push('isModified'); if (afterUndo !== text) issues.push('after Ctrl+Z');
      if (afterToggle !== text) issues.push('after per-block toggle');
      // NOTE: <textarea>.value always normalizes CRLF -> LF (HTML spec), so the whole-doc Source view of a CRLF file is LF; entering+leaving it converts the file (BUG #28, pre-existing, not mermaid-specific)
      const srcCrlfKnown = /\r\n/.test(text);
      if (srcTxt !== text && !srcCrlfKnown) issues.push('source textarea!=orig'); if (afterSrc !== text && !srcCrlfKnown) issues.push('after source toggle');
      if (srcCrlfKnown) { console.log(`LOCAL ${name}: CRLF whole-doc source toggle: textarea has CR=${/\r/.test(srcTxt)} afterSrc has CR=${/\r/.test(afterSrc)} saved file has CR=${/\r/.test(w.file)} (orig had CRLF)`); }
      else { if (w.file !== text) issues.push('file bytes changed'); if (w.writes.length && w.writes[w.writes.length - 1] !== text) issues.push('written bytes differ'); }
      console.log(`LOCAL ${name}: writes=${w.writes.length} status=${JSON.stringify(status)} issues=${JSON.stringify(issues)} errors=${JSON.stringify(clean(r))}`);
      if (issues.length) bad.push(name + ': ' + issues.join(','));
      expect(clean(r), name).toEqual([]);
      await p.close();
    }
    expect(bad).toEqual([]);
  });

  test('Drive emulator: open -> Ctrl+S: 0 PATCH, Drive bytes identical (all docs); an edit outside the diagrams then saves, keeping fences / math', async ({ ext }) => {
    const bad = [];
    for (const [name, text] of Object.entries(BYTE_DOCS)) {
      const d = new FakeDrive([{ id: 'x', name: name + '.md', text }]);
      const r = await openDriveEditor(ext, { drive: d }); const p = r.page;
      await p.click('#btn-drive-open'); await p.locator('.gdui-dialog .gdui-row', { hasText: name + '.md' }).first().click();
      await p.locator('.gdui-dialog [data-action="open"]').click(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
      await p.waitForFunction(() => [...document.querySelectorAll('[data-mdx-node]')].every((x) => x.dataset.mdxRendered), null, { timeout: 60000 });
      await settle(p);
      await p.keyboard.press('Control+s'); await p.waitForTimeout(600);
      const patched = d.attempts('PATCH').length; const same = d.bytes('x').equals(Buffer.from(text, 'utf8'));
      const cur = await md(p);
      const issues = []; if (patched) issues.push('PATCHed ' + patched); if (!same) issues.push('bytes changed'); if (cur !== text) issues.push('getMarkdown!=orig');
      console.log(`DRIVE ${name}: PATCH=${patched} bytesSame=${same} issues=${JSON.stringify(issues)}`);
      if (issues.length) bad.push(name + ': ' + issues.join(','));
      expect(r.errors.filter(bootErrOk), name).toEqual([]);
      await p.close();
    }
    expect(bad).toEqual([]);
  });

  test('after ONE edit elsewhere the whole doc is re-serialized: fences, math and diagrams survive semantically (report normalization diff); save is idempotent', async ({ ext }) => {
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: BYTE_DOCS['lf-flow-math'], openName: 'a.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('a.md'); await rendered(p, 4);
    await focusEnd(p); await p.keyboard.type(' EDIT');
    await settle(p);
    const out = await md(p); const orig = BYTE_DOCS['lf-flow-math'];
    const A = orig.split('\n'), B = out.split('\n'); const diffs = [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) diffs.push(`L${i + 1}: - ${JSON.stringify(A[i] ?? '')} + ${JSON.stringify(B[i] ?? '')}`);
    console.log('edit elsewhere: normalization diff vs original:\n' + diffs.slice(0, 20).join('\n'));
    expect(out).toContain('```mermaid\n' + FLOW_BODY + '\n```');
    expect(out).toContain(MATH_BLOCK); expect(out).toContain('$a+b$'); expect(out).toContain('EDIT');
    await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
    expect(await p.evaluate(() => window.__fsa.files['a.md'])).toBe(out);
    // reopen the saved output: byte-identical and same PM doc
    const again = await p.evaluate((o) => { const e = window.__mdwe.editor; e.setMarkdown(o); const j1 = JSON.stringify(e.tiptap.getJSON()); const o2 = e.getMarkdown(); e.setMarkdown(orig => orig, ''); return { o2 }; }, out).catch(() => null);
    void again;
    const idem = await p.evaluate((o) => { const e = window.__mdwe.editor; e.setMarkdown(o); const one = e.getMarkdown(); const j = JSON.stringify(e.tiptap.getJSON()); e.setMarkdown(one); return { same: one === o, j: j === JSON.stringify(e.tiptap.getJSON()) }; }, out);
    expect(idem).toEqual({ same: true, j: true });
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// 5. editing via source toggles
// =====================================================================================================================
test.describe('5. source editing', () => {
  test('mermaid: Edit source -> change -> markdown has edited fence; Done re-renders with new label; typing after the diagram works; Ctrl+Z ok', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const doc = '# T\n\n' + fence('graph LR\n  A[Alpha] --> B[Beta]') + '\n\nAfter.\n';
    await setMd(p, doc); await rendered(p);
    expect(await svgText(p.locator(MM))).toContain('Alpha');
    const tog = p.locator(MM + ' [data-mdx-action="toggle-source"]');
    await expect(tog).toHaveText('Edit source');
    await tog.click();
    const ta = p.locator(MM + ' textarea.mdx-mermaid-source');
    await expect(ta).toBeVisible(); await expect(tog).toHaveText('Done'); await expect(tog).toHaveAttribute('aria-expanded', 'true');
    expect(await ta.inputValue()).toBe('graph LR\n  A[Alpha] --> B[Beta]');
    await ta.fill('graph LR\n  A[Gamma] --> B[Beta] --> C[Delta]');
    // getMarkdown() flushes pending commit (no need to wait for the debounce)
    expect(await md(p)).toContain('```mermaid\ngraph LR\n  A[Gamma] --> B[Beta] --> C[Delta]\n```');
    await tog.click(); await expect(ta).toBeHidden(); await expect(tog).toHaveText('Edit source');
    await p.waitForFunction(() => document.querySelector('[data-mdx-node="mermaid"] svg')?.textContent.includes('Delta'), null, { timeout: 30000 });
    const t = await svgText(p.locator(MM)); expect(t).toContain('Gamma'); expect(t).not.toContain('Alpha');
    await settle(p);
    // caret after the node: typing goes into the document after the diagram
    await p.keyboard.type('typed after');
    await settle(p);
    let out = await md(p);
    console.log('after typing:', JSON.stringify(out));
    expect(out).toContain('```\n\ntyped after');
    expect(out).toContain('After.');
    expect(await nodeCount(p, MM + ' svg')).toBe(1);
    // Ctrl+Z: removes typing, then eventually the source edit; doc never blanked, diagram stays valid
    const seen = [];
    for (let i = 0; i < 6; i++) { await p.keyboard.press('Control+z'); await settle(p); seen.push(await md(p)); }
    console.log('Ctrl+Z sequence (last):', JSON.stringify(seen[seen.length - 1]));
    expect(seen[0]).not.toContain('typed after');
    expect(seen.some((s) => s.includes('A[Alpha] --> B[Beta]\n```') && !s.includes('Gamma')), 'undo reaches the original diagram source').toBe(true);
    expect(seen[seen.length - 1]).toContain('# T');
    await p.keyboard.press('Control+Shift+z'); await settle(p);
    expect(clean(r)).toEqual([]);
  });

  test('mermaid: Esc in the source reverts + closes; Ctrl+Enter closes; empty source -> empty block (no error)', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const doc = fence('graph LR\n  A-->B') + '\n\nx\n';
    await setMd(p, doc); await rendered(p);
    const tog = p.locator(MM + ' [data-mdx-action="toggle-source"]'); const ta = p.locator(MM + ' textarea.mdx-mermaid-source');
    await tog.click(); await ta.fill('graph LR\n  A-->Z'); await p.keyboard.press('Escape');
    await expect(ta).toBeHidden(); expect(await md(p)).toBe(doc);
    await tog.click(); await ta.fill('graph LR\n  Q-->R'); await p.keyboard.press('Control+Enter'); await expect(ta).toBeHidden();
    expect(await md(p)).toContain('Q-->R');
    await tog.click(); await ta.fill(''); await tog.click(); await settle(p);
    const out = await md(p); console.log('empty diagram source ->', JSON.stringify(out.slice(0, 60)), '| errors in node:', await nodeCount(p, MM + ' .mdx-error'));
    expect(await nodeCount(p, MM + ' .mdx-error')).toBe(0);
    expect(clean(r)).toEqual([]);
  });

  test('inline math: click -> input, edit, Enter commits; block math: Edit source textarea; both reflected in markdown and re-rendered', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, 'A $a^2$ B\n\n$$b+c$$\n\nEnd.\n'); await rendered(p, 2);
    const box = await p.locator(MI + ' .mdx-math-render').boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const inp = p.locator(MI + ' input.mdx-math-source'); await expect(inp).toBeVisible();
    expect(await inp.inputValue()).toBe('a^2');
    await inp.fill('\\sqrt{z}'); await p.keyboard.press('Enter');
    await expect(inp).toBeHidden();
    await p.waitForFunction(() => document.querySelector('[data-mdx-node="math-inline"] annotation')?.textContent === '\\sqrt{z}');
    expect(await md(p)).toContain('A $\\sqrt{z}$ B');
    // typing continues after the inline node
    await p.keyboard.type('!'); await settle(p); expect(await md(p)).toMatch(/\$\\sqrt\{z\}\$!? ?B|\$\\sqrt\{z\}\$ B/);
    // block
    const tog = p.locator(MB + ' [data-mdx-action="toggle-source"]'); await tog.click();
    const ta = p.locator(MB + ' textarea.mdx-math-source'); expect(await ta.inputValue()).toBe('b+c');
    await ta.fill('\\frac{1}{2}\n+ x'); await tog.click();
    await p.waitForFunction(() => document.querySelector('[data-mdx-node="math-block"] annotation')?.textContent.includes('\\frac{1}{2}'));
    expect(await md(p)).toContain('$$\\frac{1}{2}\n+ x$$');
    // emptying inline math removes the node
    const b2 = await p.locator(MI + ' .mdx-math-render').boundingBox(); await p.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await p.locator(MI + ' input.mdx-math-source').fill(''); await p.keyboard.press('Enter'); await settle(p);
    expect(await nodeCount(p, MI)).toBe(0);
    expect(clean(r)).toEqual([]);
  });

  test('edited via toggle then saved (local FSA + Drive emulator): file holds the edited fence/math; reopened it renders identically', async ({ ext }) => {
    const text = '# S\n\n' + fence('graph LR\n  A-->B') + '\n\n$q$ and\n\n$$w$$\n';
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: 's.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('s.md'); await rendered(p, 3);
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await p.locator(MM + ' textarea.mdx-mermaid-source').fill('graph LR\n  A-->B\n  B-->NEWNODE'); await p.locator(MM + ' [data-mdx-action="toggle-source"]').click();
    await p.locator(MB + ' [data-mdx-action="toggle-source"]').click(); await p.locator(MB + ' textarea.mdx-math-source').fill('w+1'); await p.locator(MB + ' [data-mdx-action="toggle-source"]').click();
    await settle(p);
    await expect(p.locator('#filename')).toHaveClass(/dirty/);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
    const saved = await p.evaluate(() => window.__fsa.files['s.md']);
    console.log('saved:', JSON.stringify(saved));
    expect(saved).toContain('B-->NEWNODE\n```'); expect(saved).toContain('$$w+1$$'); expect(saved).toContain('$q$'); expect(saved).not.toContain('$$w$$');
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    // Drive
    const d = new FakeDrive([{ id: 'x', name: 's.md', text }]);
    const r2 = await openDriveEditor(ext, { drive: d }); const p2 = r2.page;
    await p2.click('#btn-drive-open'); await p2.locator('.gdui-dialog .gdui-row', { hasText: 's.md' }).first().click(); await p2.locator('.gdui-dialog [data-action="open"]').click(); await p2.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await rendered(p2, 3);
    await p2.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await p2.locator(MM + ' textarea.mdx-mermaid-source').fill('graph LR\n  A-->B\n  B-->DRV'); await p2.locator(MM + ' [data-mdx-action="toggle-source"]').click();
    await settle(p2); await p2.keyboard.press('Control+s'); await p2.waitForTimeout(700);
    expect(d.attempts('PATCH').length).toBe(1);
    const t = d.text('x'); console.log('Drive saved:', JSON.stringify(t));
    expect(t).toContain('B-->DRV\n```'); expect(t).toContain('$$w$$'); expect(t).toContain('$q$');
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// 6. dark mode
// =====================================================================================================================
test.describe('6. dark mode', () => {
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const DOC = FLOW_MD + '\n' + fence(SEQ) + '\n\n' + fence(PIE) + '\n\nInline $E=mc^2$ and\n\n' + MATH_BLOCK + '\n\n$\\frac{$ bad\n';
  // in-page: effective colour pairs for labels
  const probe = () => {
    const parse = (s) => { const m = String(s).match(/[\d.]+/g); if (!m || /none|transparent/.test(s)) return null; const a = m.length > 3 ? Number(m[3]) : 1; return { c: m.slice(0, 3).map(Number), a }; };
    const root = document.querySelector('.mdx-root');
    const pageBg = parse(getComputedStyle(root).backgroundColor);
    const blend = (top, under) => top.a >= 1 ? top.c : top.c.map((v, i) => Math.round(v * top.a + under[i] * (1 - top.a)));
    const nodeBg = parse(getComputedStyle(document.querySelector('[data-mdx-node="mermaid"]')).backgroundColor) || pageBg;
    const under = nodeBg.a >= 1 ? nodeBg.c : pageBg.c;
    const out = { pageBg: pageBg.c, under, pairs: [] };
    const txtColor = (el) => { const cs = getComputedStyle(el); const isSvgText = el.namespaceURI.includes('svg') && el.tagName.toLowerCase() === 'text'; return parse(isSvgText ? cs.fill : cs.color); };
    document.querySelectorAll('[data-mdx-node="mermaid"] svg').forEach((svg, si) => {
      const kind = ['flow', 'sequence', 'pie'][si] || 'diagram' + si;
      // shape-based (node / cluster) labels
      svg.querySelectorAll('.node, .cluster, .actor, .note').forEach((g) => {
        const lab = g.querySelector('.nodeLabel, .cluster-label span, .cluster-label text, text, span, p'); const shape = g.querySelector('rect, polygon, path, circle, ellipse');
        if (!lab || !shape) return;
        const fill = parse(getComputedStyle(shape).fill); const fg = txtColor(lab); if (!fg) return;
        const bg = fill ? blend(fill, under) : under;
        out.pairs.push({ kind, cls: (g.getAttribute('class') || g.tagName).split(' ')[0], text: (lab.textContent || '').trim().slice(0, 30), fg: fg.c, bg });
      });
      svg.querySelectorAll('.edgeLabel').forEach((g) => {
        const lab = g.querySelector('.edgeLabel, span, p, text') || g; const fg = txtColor(lab); if (!fg) return;
        const bgc = parse(getComputedStyle(lab).backgroundColor) || parse(getComputedStyle(g).backgroundColor);
        const rect = g.querySelector('rect'); const rf = rect && parse(getComputedStyle(rect).fill);
        const bg = bgc ? blend(bgc, under) : rf ? blend(rf, under) : under;
        if ((g.textContent || '').trim()) out.pairs.push({ kind, cls: 'edgeLabel', text: g.textContent.trim().slice(0, 30), fg: fg.c, bg });
      });
      svg.querySelectorAll('.pieTitleText, .legend text, .slice, .messageText, .actor-line, .loopText').forEach((t) => {
        const fg = txtColor(t); if (fg && (t.textContent || '').trim()) out.pairs.push({ kind, cls: (t.getAttribute('class') || t.tagName).split(' ')[0], text: t.textContent.trim().slice(0, 30), fg: fg.c, bg: under });
      });
    });
    const k = document.querySelector('.mdx-node .katex'); out.katex = k ? { fg: parse(getComputedStyle(k).color).c, bg: under, fonts: getComputedStyle(k).fontFamily } : null;
    const kb = document.querySelector('.mdx-math-block .katex-html .mord'); out.katexBlock = kb ? parse(getComputedStyle(kb).color).c : null;
    const inl = document.querySelector('[data-mdx-node="math-inline"] .katex'); out.katexInline = inl ? { fg: parse(getComputedStyle(inl).color).c, para: parse(getComputedStyle(inl.closest('p')).color).c } : null;
    const err = document.querySelector('.mdx-error'); out.err = err ? { fg: parse(getComputedStyle(err).color).c, bg: (parse(getComputedStyle(err).backgroundColor) || { c: under }).c } : null;
    out.theme = { html: document.documentElement.dataset.theme, root: root.dataset.theme };
    return out;
  };
  test('light vs dark: mermaid re-renders with matching theme, label contrast >= 3 (nodes/clusters/edges), KaTeX + error colour readable; screenshots', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, DOC); await rendered(p, 6);
    const light = await p.evaluate(probe);
    await shotTo(p, 'mermaid-math-light.png');
    await p.click('#btn-theme');
    await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark');
    await p.waitForTimeout(500); await rendered(p, 6);
    // dark re-render: svg from dark theme -> style block mentions dark colours / node fill not the light default
    await p.waitForFunction(() => { const s = document.querySelector('[data-mdx-node="mermaid"] svg'); return s && s.querySelector('.node rect, .node polygon'); });
    const dark = await p.evaluate(probe);
    await shotTo(p, 'mermaid-math-dark.png');
    await shotTo(p, 'mermaid-flowchart-dark.png', p.locator(MM).first());
    const fmt = (o) => o.pairs.map((x) => ({ ...x, ratio: Number(contrast(x.fg, x.bg).toFixed(2)) }));
    const L = fmt(light), D = fmt(dark);
    const worst = (a) => a.slice().sort((x, y) => x.ratio - y.ratio).slice(0, 6).map((x) => `${x.kind}/${x.cls} "${x.text}" ${x.ratio}`);
    console.log('theme attrs light', JSON.stringify(light.theme), 'dark', JSON.stringify(dark.theme));
    console.log('LIGHT pairs:', L.length, 'worst:', JSON.stringify(worst(L)));
    console.log('DARK  pairs:', D.length, 'worst:', JSON.stringify(worst(D)));
    console.log('KaTeX colour light', JSON.stringify(light.katex), 'dark', JSON.stringify(dark.katex), 'dark block', JSON.stringify(dark.katexBlock), 'inline vs para', JSON.stringify(dark.katexInline));
    const kr = contrast(dark.katex.fg, dark.katex.bg); const er = contrast(dark.err.fg, dark.err.bg);
    console.log(`KaTeX dark contrast ${kr.toFixed(2)}; error text dark ${er.toFixed(2)} (light ${contrast(light.err.fg, light.err.bg).toFixed(2)}); page bg dark ${JSON.stringify(dark.pageBg)}`);
    expect(dark.pageBg.every((v) => v < 60), 'dark page background').toBe(true);
    expect(D.length, 'dark contrast pairs found').toBeGreaterThan(8);
    expect(L.length).toBeGreaterThan(8);
    for (const [nm, arr] of [['light', L], ['dark', D]]) {
      const bad = arr.filter((x) => x.ratio < 3);
      expect.soft(bad, `${nm}: labels with contrast < 3`).toEqual([]);
    }
    expect(kr, 'KaTeX readable in dark (>=7)').toBeGreaterThanOrEqual(7);
    expect(contrast(dark.katexInline.fg, dark.katex.bg)).toBeGreaterThanOrEqual(7);
    expect(er, 'error text contrast dark').toBeGreaterThanOrEqual(3);
    // svg differs between themes (dark theme actually applied to mermaid)
    const fills = await p.evaluate(() => { const n = document.querySelector('[data-mdx-node="mermaid"] .node rect, [data-mdx-node="mermaid"] .node polygon'); return getComputedStyle(n).fill; });
    console.log('first node fill in dark:', fills);
    // toggling back to light restores
    await p.click('#btn-theme'); await expect(p.locator('html')).toHaveAttribute('data-theme', 'light'); await p.waitForTimeout(500); await rendered(p, 6);
    const light2 = fmt(await p.evaluate(probe));
    expect(light2.filter((x) => x.ratio < 3)).toEqual([]);
    expect(await md(p)).toBe(DOC);
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// 7. malformed input
// =====================================================================================================================
test('7. malformed mermaid + LaTeX: inline .mdx-error, no page error, other diagrams/math still render, doc editable, no stray DOM', async ({ ext }) => {
  const r = await openMM(ext); const p = r.page;
  const doc = [fence('graph LR\n  OK1-->OK2'), fence(BAD_MM), fence('graph LR\n  OK3-->OK4'), fence(COLLAPSED), fence(''),
    'inline bad $\\frac{$ and $\\undefinedcmd$ and good $x+1$ end', '$$\\frac{$$', '$$\\undefinedcmd{x}$$', '$$\\begin{aligned} a &= $$', '\\left( unbalanced $\\left( x$'].join('\n\n') + '\n\nTail paragraph.\n';
  await setMd(p, doc); await rendered(p, 9);
  const mmErr = await p.locator(MM + ' .mdx-error[data-mdx-error="mermaid"]').count();
  const mmSvg = await p.locator(MM + ' svg').count();
  const mathErr = await p.locator('.mdx-error[data-mdx-error="math"]').count();
  console.log(`mermaid nodes=${await nodeCount(p, MM)} svg=${mmSvg} inlineErrors=${mmErr}; math nodes=${await nodeCount(p, MI + ',' + MB)} errors=${mathErr}; good inline math ok=${await nodeCount(p, MI + '[data-mdx-rendered="ok"]')}`);
  const errTexts = await p.locator('.mdx-error').allInnerTexts(); console.log('error texts:', JSON.stringify(errTexts.map((t) => t.slice(0, 90))));
  expect(mmSvg, 'valid diagrams still render').toBeGreaterThanOrEqual(2);
  expect(await svgText(p.locator(MM).nth(0))).toContain('OK2'); expect(await svgText(p.locator(MM).nth(2))).toContain('OK4');
  await expect(p.locator(MM).nth(1).locator('.mdx-error[data-mdx-error="mermaid"]')).toHaveCount(1);
  await expect(p.locator(MM).nth(1).locator('svg')).toHaveCount(0);
  expect(mathErr, 'bad LaTeX flagged (\\frac{ x2, \\begin{aligned} unterminated, \\left( unbalanced; \\undefinedcmd is BUG-27 and not counted here)').toBeGreaterThanOrEqual(4);
  // good inline math next to bad still renders
  await expect(p.locator(MI + ' .katex:not(.mdx-error)', { hasText: 'x' }).first()).toBeVisible();
  expect(await strayBody(p)).toEqual([]);
  expect(await p.evaluate(() => document.querySelectorAll('body > svg, body > div[id^="dmdx"], [id^="dmdx-mmd"]').length)).toBe(0);
  // editable after errors
  await focusEnd(p); await p.keyboard.type(' more');
  await settle(p); expect(await md(p)).toContain('Tail paragraph. more');
  // fixing the bad diagram through its source renders it
  const bad = p.locator(MM).nth(1);
  await bad.locator('[data-mdx-action="toggle-source"]').click(); await bad.locator('textarea').fill('graph LR\n  FIXED1-->FIXED2'); await bad.locator('[data-mdx-action="toggle-source"]').click();
  await p.waitForFunction(() => document.querySelectorAll('[data-mdx-node="mermaid"]')[1].querySelector('svg'), null, { timeout: 30000 });
  await expect(bad.locator('.mdx-error')).toHaveCount(0);
  await shotTo(p, 'mermaid-math-errors.png');
  // page-level: no exception, no console errors (mermaid logLevel fatal / suppressErrorRendering)
  console.log('console messages during malformed test:', JSON.stringify(r.msgs.slice(0, 10)));
  expect(clean(r)).toEqual([]);
  expect(await csp(p)).toEqual([]);
});

// =====================================================================================================================
// 8. false positives
// =====================================================================================================================
test.describe('8. false positives', () => {
  const CASES = [
    'It costs $5 and $10 in total.',
    'Prices: $5, $10, $15 and $20.',
    'Range $5-$10 or $5,$10 or $3.50 or $1,000 or US$5 and $ 5 $ and 20$ and $30.',
    'Shell `echo $HOME and $PATH` and `$x^2$` and `$$y$$`.',
    'Escaped \\$a\\$ and \\$5 and \\$10 stay literal.',
    'A lone $ and another $ here.',
    '```js\nconst price = `$${amount}`; // $a$ and $$b$$\n```',
    '```javascript\nlet s = "$x$";\n```',
    '```latex\n$$\n\\frac{a}{b}\n$$\n```',
    '```text\n$x$ and $y$\n```',
    '~~~js\n$a$\n~~~',
    '```mermaidjs\ngraph LR\n  A-->B\n```',
    '```mermaid-not\ngraph LR\n  A-->B\n```',
    '````text\n```mermaid\ngraph LR\n  A-->B\n```\n````',
    '    indented $c$ code',
    '```\nno lang $z$\n```',
  ];
  const DOC = CASES.join('\n\n') + '\n';
  test('none of these become math/mermaid nodes; unedited round-trip byte-identical; after an edit semantics preserved', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, DOC); await settle(p); await p.waitForTimeout(300);
    const counts = await p.evaluate(() => ({ mm: document.querySelectorAll('[data-mdx-node]').length, katex: document.querySelectorAll('.katex').length, svg: document.querySelectorAll('.mdx-mermaid-render svg').length, code: document.querySelectorAll('pre code').length }));
    const types = await p.evaluate(() => { const o = {}; window.__mdwe.editor.tiptap.state.doc.descendants((n) => { o[n.type.name] = (o[n.type.name] || 0) + 1; }); return o; });
    console.log('false-positive doc node types:', JSON.stringify(types), JSON.stringify(counts));
    expect(counts.mm, 'no math/mermaid nodes').toBe(0); expect(counts.katex).toBe(0); expect(counts.svg).toBe(0);
    expect(await md(p)).toBe(DOC);
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    // per-case: each stays text-only after an edit; semantics (re-parse of output has 0 math/mermaid nodes) and each literal survives
    await focusStart(p); await p.keyboard.type('EDIT ');
    await settle(p);
    const out = await md(p);
    const after = await p.evaluate((o) => { const e = window.__mdwe.editor; e.setMarkdown(o); const t = {}; e.tiptap.state.doc.descendants((n) => { t[n.type.name] = (t[n.type.name] || 0) + 1; }); return t; }, out);
    console.log('after edit, re-parsed node types:', JSON.stringify(after));
    expect(after.mathInline || 0).toBe(0); expect(after.mathBlock || 0).toBe(0); expect(after.mermaidBlock || 0).toBe(0);
    const A = DOC.split('\n'), B = out.split('\n'); const diffs = [];
    for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i] && !(i === 0)) diffs.push(`L${i + 1}: - ${JSON.stringify(A[i] ?? '')} + ${JSON.stringify(B[i] ?? '')}`);
    console.log('normalization diff after edit (false-positive doc):', diffs.length ? '\n' + diffs.join('\n') : 'none (besides EDIT line)');
    for (const must of ['It costs $5 and $10 in total.', '`echo $HOME and $PATH`', '`$x^2$`', '`$$y$$`', '\\$a\\$', 'const price = `$${amount}`; // $a$ and $$b$$', '```javascript', '```mermaidjs', '```mermaid-not', '````text\n```mermaid', 'indented $c$ code'])
      expect.soft(out, 'literal kept after edit: ' + must).toContain(must);
    expect(clean(r)).toEqual([]);
    expect(assetReqs(r).filter((u) => /mermaid|katex/i.test(u)), 'no mermaid/katex chunk needed for false positives').toEqual([]);
  });

  test('ambiguous / edge cases (report): "$100 and 5$", "$a$b", "$$a$$ x", math in emphasis / list / blockquote / table cell, fence inside list/blockquote', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const cases = ['$100 and 5$', '$a$b', '$$a$$ text', '**bold $x$ text**', '- item $x$\n- ```mermaid', '> quote $x$\n>\n> ```mermaid\n> graph LR\n>   A-->B\n> ```', '| a | b |\n|---|---|\n| $x$ | $y$ |', '- item\n\n  ```mermaid\n  graph LR\n    A-->B\n  ```', '```mermaid\n```', '```mermaid\ngraph LR\n  A-->B', 'Text $x$$y$ and $$$'];
    const rep = [];
    for (const c of cases) {
      const o = await p.evaluate(async (c) => { const e = window.__mdwe.editor; e.setMarkdown(c); await new Promise((r) => setTimeout(r, 900)); const t = {}; e.tiptap.state.doc.descendants((n) => { t[n.type.name] = (t[n.type.name] || 0) + 1; }); return { same: e.getMarkdown() === c, types: t, rendered: document.querySelectorAll('.katex').length, svg: document.querySelectorAll('.mdx-mermaid-render svg').length }; }, c);
      rep.push({ c, ...o });
      // idempotency after an edit-free reparse of serialized output (structure stable)
      const st = await p.evaluate((c) => { const e = window.__mdwe.editor; e.setMarkdown(c); e.tiptap.commands.insertContentAt(0, 'X'); const o1 = e.getMarkdown(); e.setMarkdown(o1); const j1 = JSON.stringify(e.tiptap.getJSON()); const o2 = (() => { e.tiptap.commands.insertContentAt(0, 'Y'); return e.getMarkdown(); })(); return { o1, o2 }; }, c);
      void st;
    }
    for (const x of rep) console.log(`  ${JSON.stringify(x.c)} -> unedited-identical=${x.same} nodes=${JSON.stringify(x.types)} katex=${x.rendered} svg=${x.svg}`);
    for (const x of rep) expect(x.same, 'unedited round trip: ' + JSON.stringify(x.c)).toBe(true);
    expect(clean(r)).toEqual([]);
  });
});

// CRLF + whole-doc Source view (pre-existing behaviour, verified with NO mermaid/math in the doc -> not a regression of this build).
test('CRLF: unedited CRLF file (with mermaid/math) saved without touching Source = CRLF bytes; plain CRLF doc + Source toggle behaves the same as a mermaid one (report BUG #28)', async ({ ext }) => {
  const res = {};
  for (const [name, text] of [['plain', '# T\r\n\r\npara one\r\n\r\n- a\r\n- b\r\n'], ['mermaid', BYTE_DOCS.crlf]]) {
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: name + '.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText(name + '.md'); await settle(p);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(400);
    const unedited = await p.evaluate((n) => window.__fsa.files[n + '.md'], name);
    await p.click('.mdx-toolbar [data-cmd="source"]'); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
    const dirtyAfter = await p.evaluate(() => window.__mdwe.state.dirty || window.__mdwe.editor.isModified());
    await p.keyboard.press('Control+s'); await p.waitForTimeout(400);
    const afterSrc = await p.evaluate((n) => window.__fsa.files[n + '.md'], name);
    res[name] = { uneditedCRLF: unedited === text, afterSourceToggleCRLF: afterSrc === text, afterSourceToggleHasCR: /\r/.test(afterSrc), dirtyAfter };
    await p.close();
  }
  console.log('CRLF + source toggle:', JSON.stringify(res));
  expect(res.plain.uneditedCRLF).toBe(true); expect(res.mermaid.uneditedCRLF).toBe(true);
  // both behave identically (so mermaid support did not introduce it)
  expect(res.mermaid.afterSourceToggleHasCR).toBe(res.plain.afterSourceToggleHasCR);
});

// KaTeX renders an UNDEFINED command (not a parse error) as red text (errorColor) even with throwOnError:false; renderers.js only
// tags `.katex-error` spans, so `\undefinedcmd` gets no .mdx-error / data-mdx-error / data-mdx-rendered="error" (see BUGS.md #27).
test('[BUG-27] \\undefinedcmd (inline + block) must be flagged with .mdx-error[data-mdx-error="math"] like \\frac{ is', async ({ ext }) => {
  const r = await openMM(ext); const p = r.page;
  await setMd(p, 'a $\\undefinedcmd$ b and $\\frac{$ c\n\n$$\\undefinedcmd{x}$$\n\n$$\\frac{$$\n');
  await rendered(p, 4);
  const info = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node^="math"]')].map((n) => ({ tex: n.querySelector('annotation')?.textContent || n.textContent.slice(0, 20), rendered: n.dataset.mdxRendered, mdxErr: n.querySelectorAll('.mdx-error[data-mdx-error="math"]').length, redText: [...n.querySelectorAll('.katex-html *')].some((e) => getComputedStyle(e).color === 'rgb(204, 0, 0)') })));
  console.log('math error flagging:', JSON.stringify(info));
  await shotTo(p, 'math-undefinedcmd.png');
  for (const x of info) { expect(x.mdxErr, `${x.tex}: .mdx-error present`).toBeGreaterThan(0); expect(x.rendered, `${x.tex}: data-mdx-rendered`).toBe('error'); }
  expect(clean(r)).toEqual([]);
});

// =====================================================================================================================
// 9. security
// =====================================================================================================================
test.describe('9. security', () => {
  const HOSTILE = [
    fence('graph LR\n  A[Click me] --> B[Other]\n  click A href "javascript:window.__pwn=1;alert(1)"\n  click B call window.__pwn2()\n'),
    fence('graph LR\n  X["<img src=x onerror=window.__pwn3=1;alert(3)>hostile"] --> Y["<script>window.__pwn4=1;alert(4)</script>script"]\n  Z["<a href=\'javascript:window.__pwn5=1\'>jslink</a>"] --> Y\n  style X fill:#f00,stroke:#333\n'),
    fence('%%{init: {"securityLevel":"loose", "flowchart":{"htmlLabels":true}} }%%\ngraph LR\n  P["<img src=x onerror=window.__pwn6=1;alert(6)>loose"] --> Q\n  click P href "javascript:window.__pwn7=1"'),
    fence('sequenceDiagram\n  A->>B: <img src=x onerror=window.__pwn8=1>hi\n  Note over A: <script>window.__pwn9=1</script>'),
    'Math: $\\href{javascript:window.__pwn10=1}{click}$ and $\\url{https://evil.example/x}$ and $\\includegraphics{https://evil.example/x.png}$ and $\\htmlClass{evil}{y}$ and $\\htmlStyle{color:red}{z}$\n\n$$\\href{https://evil.example/}{link}\\ \\text{<img src=x onerror=window.__pwn11=1>}$$\n',
  ].join('\n\n') + '\n';

  test('untrusted diagrams/math: securityLevel strict -> no script/onerror/javascript: link/foreignObject-injected markup; no alert; no global flag; no external requests', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, HOSTILE);
    await rendered(p, 6);
    await p.waitForTimeout(800); // let any (unwanted) onerror handler fire
    const flags = await p.evaluate(() => Object.keys(window).filter((k) => /^__pwn/.test(k)).map((k) => k + '=' + window[k]));
    const dom = await p.evaluate(() => {
      const host = document.querySelector('#editor-host');
      const q = (sel) => host.querySelectorAll(sel).length;
      const hrefs = [...host.querySelectorAll('[href],[xlink\\:href]')].map((e) => (e.getAttribute('href') || e.getAttribute('xlink:href') || '')).filter((h) => /^\s*javascript:/i.test(h));
      const onattrs = [...host.querySelectorAll('.mdx-node *')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).map((e) => e.tagName);
      return { scripts: q('.mdx-node script'), imgOnerr: q('.mdx-node img[onerror]'), imgs: q('.mdx-node img'), iframes: q('.mdx-node iframe, .mdx-node object, .mdx-node embed'), jsHrefs: hrefs, onattrs, anchors: q('.mdx-node a'), fo: q('.mdx-node foreignObject') };
    });
    console.log('hostile: window flags =', JSON.stringify(flags), '| dialogs =', JSON.stringify(r.dialogs), '| DOM =', JSON.stringify(dom));
    const outcomes = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node]')].map((n) => n.dataset.mdxNode + ':' + n.dataset.mdxRendered + (n.querySelector('.mdx-error') ? '(err: ' + n.querySelector('.mdx-error').textContent.slice(0, 80).replace(/\n/g, ' ') + ')' : '')));
    console.log('hostile render outcomes:', JSON.stringify(outcomes));
    expect(flags, 'no injected code ran').toEqual([]);
    expect(r.dialogs, 'no alert/confirm/prompt').toEqual([]);
    expect(dom.scripts).toBe(0); expect(dom.imgOnerr).toBe(0); expect(dom.iframes).toBe(0); expect(dom.jsHrefs).toEqual([]); expect(dom.onattrs).toEqual([]);
    // click on rendered nodes must not run anything either
    const boxes = p.locator('.mdx-mermaid-render svg .node');
    for (let i = 0; i < Math.min(await boxes.count(), 4); i++) await boxes.nth(i).click({ force: true, timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(300);
    expect(await p.evaluate(() => Object.keys(window).filter((k) => /^__pwn/.test(k)))).toEqual([]);
    expect(r.dialogs).toEqual([]);
    const ext_ = r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u));
    console.log('non-extension requests during hostile render:', JSON.stringify(ext_));
    expect(ext_, 'no requests to non-extension origins').toEqual([]);
    expect(await csp(p), 'no CSP violations').toEqual([]);
    expect(r.msgs.filter((m) => /Content Security Policy|Refused to/i.test(m))).toEqual([]);
    // <img src=x> (onerror stripped) survives in htmlLabels under 'strict' and resolves to chrome-extension://<id>/editor/x (own origin, harmless 404)
    expect(clean(r).filter((e) => !/requestfailed: chrome-extension:\/\/[a-p]{32}\/editor\/x$/.test(e))).toEqual([]);
    // markdown round-trip keeps the hostile source verbatim (inert text)
    expect(await md(p)).toBe(HOSTILE);
  });

  test('normal render session: every request is chrome-extension:// (or blob/data); no CSP violation events or console CSP messages; KaTeX fonts served from the extension origin with 200', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const doc = FLOW_MD + '\n' + fence(SEQ) + '\n\n' + fence(PIE) + '\n\n' + fence(GANTT) + '\n\n' + fence(CLS) + '\n\n' + MATH_INLINE + '\n\n' + MATH_BLOCK + '\n\n' + ALIGNED + '\n\n$\\mathbf{B}\\mathcal{L}\\mathbb{R}\\mathfrak{g}\\mathsf{s}\\mathtt{t}\\mathit{i}\\sum_{i=0}^{n}\\left(\\frac{1}{2}\\right)^i \\int_0^1 \\sqrt[3]{x}$\n';
    await setMd(p, doc); await rendered(p, 9);
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
    const bad = r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u));
    console.log('non-extension requests:', JSON.stringify(bad), '| total requests:', r.reqs.length);
    expect(bad).toEqual([]);
    const fontResps = r.resps.filter((x) => /KaTeX_.*\.(woff2?|ttf)/.test(x.url));
    const fontNames = [...new Set(fontResps.map((x) => x.url.split('/').pop().replace(/-[\w-]{8}\./, '.')))];
    console.log('KaTeX font requests:', fontResps.length, JSON.stringify(fontNames));
    expect(fontResps.length).toBeGreaterThan(0);
    expect(fontResps.every((x) => x.url.startsWith(`chrome-extension://${ext.extId}/editor/assets/`) && x.status === 200), 'fonts from extension origin, 200').toBe(true);
    expect(fontResps.filter((x) => /\.ttf$|\.woff$/.test(x.url)).length, 'woff2 preferred: no ttf/woff fallback fetched').toBe(0);
    expect(r.resps.filter((x) => x.status >= 400)).toEqual([]);
    expect(r.failed).toEqual([]);
    const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.style + ' ' + f.weight));
    console.log('document.fonts loaded:', JSON.stringify(fonts));
    expect(fonts.some((f) => /KaTeX_Main/.test(f)) && fonts.some((f) => /KaTeX_Math/.test(f))).toBe(true);
    expect(await p.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true);
    expect(await csp(p)).toEqual([]);
    expect(r.msgs.filter((m) => /Content Security Policy|Refused to|unsafe-eval|EvalError/i.test(m))).toEqual([]);
    expect(clean(r)).toEqual([]);
    // every referenced font url in the built css exists in extension/editor/assets
    const css = fs.readdirSync(path.join(EXT, 'editor/assets')).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(EXT, 'editor/assets', f), 'utf8')).join('\n');
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, '')).filter((u) => !/^data:/.test(u));
    const missing = urls.filter((u) => !fs.existsSync(path.join(EXT, 'editor/assets', u.replace(/^\.\//, '').split(/[?#]/)[0])));
    console.log('css url() refs:', urls.length, 'missing files:', JSON.stringify(missing));
    expect(missing).toEqual([]);
    expect(urls.filter((u) => /^(https?:)?\/\//.test(u))).toEqual([]);
  });

  test('static: manifest CSP still exactly script-src \'self\'; object-src \'self\' (no unsafe-eval/inline/wasm/remote), no new permissions / web_accessible_resources; no eval/new Function/Function("...") in ANY built chunk; no remote import()/fetch', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
    expect(manifest.content_security_policy.sandbox).toBeUndefined();
    expect(manifest.permissions).toEqual(['storage', 'identity']); expect(manifest.host_permissions).toEqual(['https://www.googleapis.com/*']);
    expect(manifest.web_accessible_resources || []).toEqual([]);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const js = walk(EXT).filter((f) => /\.m?js$/.test(f));
    const hits = [];
    const rxs = [/(?<![\w$.])eval\s*\(/g, /new\s+Function\s*\(/g, /(?<![\w$.])Function\s*\(\s*["'`]/g, /(?<![\w$.])Function\s*\(\s*[a-z_$][\w$]*\s*\)\s*\(/gi, /set(?:Timeout|Interval)\s*\(\s*["'`]/g, /document\.write\s*\(/g, /unsafe-eval/g, /importScripts\s*\(/g, /new\s+WebSocket|XMLHttpRequest|sendBeacon/g];
    for (const f of js) { const src = fs.readFileSync(f, 'utf8'); for (const rx of rxs) { rx.lastIndex = 0; let m; while ((m = rx.exec(src))) { const ln = src.slice(0, m.index).split('\n').length; const line = src.split('\n')[ln - 1].trim(); if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; hits.push(`${path.basename(f)}:${ln} ${rx.source.slice(0, 22)} :: ${line.slice(0, 110)}`); } } }
    console.log(`scanned ${js.length} JS files (${(js.reduce((a, f) => a + fs.statSync(f).size, 0) / 1e6).toFixed(1)} MB); dynamic-code / network-API hits:\n` + (hits.join('\n') || 'NONE'));
    expect(hits).toEqual([]);
    // dynamic import() targets must be relative chunks only
    const dyn = []; for (const f of js) { for (const m of fs.readFileSync(f, 'utf8').matchAll(/import\(\s*(["'`])([^"'`]+)\1/g)) dyn.push(m[2]); }
    console.log('dynamic import specifiers:', dyn.length, 'non-relative:', JSON.stringify(dyn.filter((d) => !/^\.\//.test(d))));
    expect(dyn.filter((d) => !/^\.\//.test(d))).toEqual([]);
    // every chunk referenced by the entry exists
    const html = fs.readFileSync(path.join(EXT, 'editor/index.html'), 'utf8');
    expect(html).toMatch(/<script type="module"[^>]*src="\.\/assets\/index-[\w-]+\.js"/);
    expect(/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html), 'no inline script').toBe(false);
    for (const f of js.filter((x) => !/elk-/.test(x))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) expect(fs.existsSync(path.join(path.dirname(f), m[1])), `${path.basename(f)} references missing ${m[1]}`).toBe(true);
    // (elk-*.js is skipped: its "./elk-api.js" strings are browserify-style internal require() keys inside the bundle, not files)
    // mermaid hard-coded remote URL strings in chunks that could be fetched at run time (report only)
    const remote = new Set(); for (const f of js) for (const m of fs.readFileSync(f, 'utf8').matchAll(/["'`](https?:\/\/[^"'`\s]+)["'`]/g)) if (!/w3\.org|localhost/.test(m[1])) remote.add(m[1]);
    console.log('http(s) string literals in bundles (info, not fetched):', remote.size, JSON.stringify([...remote].slice(0, 25)));
  });

  test('mermaid runtime config: securityLevel strict is honoured even if the diagram tries an init directive to loosen it (already covered by hostile test) and the doc-level %%{init}%% cannot enable htmlLabels script execution', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, fence('%%{init: {"securityLevel":"loose"} }%%\ngraph LR\n  A["<b onclick=window.__pwn12=1>bold</b>"] --> B') + '\n'); await rendered(p);
    const info = await p.evaluate(() => ({ onclick: document.querySelectorAll('.mdx-node [onclick]').length, tags: [...document.querySelectorAll('.mdx-node foreignObject b')].length, flag: window.__pwn12 }));
    console.log('loose-init attempt:', JSON.stringify(info));
    expect(info.onclick).toBe(0); expect(info.flag).toBeUndefined();
    expect(clean(r)).toEqual([]);
  });
});

// =====================================================================================================================
// 10. performance / lazy loading
// =====================================================================================================================
test.describe('10. lazy chunks + performance', () => {
  const chunkSize = (n) => { try { return fs.statSync(path.join(EXT, 'editor/assets', n)).size; } catch { return 0; } };
  test('editor first-load without diagram/math content does NOT fetch mermaid/katex (or any diagram) chunks; typing plain text neither', async ({ ext }) => {
    const t0 = Date.now();
    const r = await openMM(ext); const p = r.page;
    const ready = Date.now() - t0;
    await pm(p).click(); await p.keyboard.type('plain text, costs $5 and $10'); await settle(p); await p.waitForTimeout(500);
    await setMd(p, '# H\n\n- a\n- b\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    await p.waitForTimeout(600);
    const chunks = assetReqs(r); const js = chunks.filter((f) => f.endsWith('.js')); const css = chunks.filter((f) => f.endsWith('.css')); const fonts = chunks.filter((f) => /^KaTeX_/.test(f));
    const bytes = js.reduce((a, f) => a + chunkSize(f), 0);
    console.log(`first load (no mermaid content): ready in ${ready} ms; JS chunks=${JSON.stringify(js)} (${(bytes / 1e6).toFixed(2)} MB), css=${JSON.stringify(css)}, katex fonts=${fonts.length}`);
    expect(js.length, 'only the entry chunk').toBe(1);
    expect(js[0]).toMatch(/^index-.*\.js$/);
    expect(chunks.filter((f) => /mermaid|katex|cytoscape|elk|dagre|Diagram|cynefin|architecture|_baseUniq|kanban|sequence|flow|gantt|pie/i.test(f))).toEqual([]);
    expect(fonts, 'no KaTeX font fetched until math is rendered').toEqual([]);
    expect(await p.evaluate(() => document.querySelectorAll('[data-mdx-node]').length)).toBe(0);
    expect(clean(r)).toEqual([]);
  });
  test('math-only doc loads the katex chunk (+fonts) but NOT the mermaid chunk', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, 'Inline $E=mc^2$\n\n$$x^2$$\n'); await rendered(p, 2); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
    const chunks = assetReqs(r); console.log('math-only lazy assets:', JSON.stringify(chunks.map((c) => c.replace(/-[\w-]{8}(\.\w+)$/, '$1'))));
    expect(chunks.some((f) => /^katex-/.test(f))).toBe(true);
    expect(chunks.some((f) => /^mermaid\.core|cytoscape|elk|dagre/.test(f))).toBe(false);
    expect(clean(r)).toEqual([]);
  });
  test('flowchart doc lazily loads mermaid.core + only the needed diagram chunks (not all ~120), each with 200; second diagram of same type does not refetch; reports timing + bytes', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const before = assetReqs(r).length;
    const t0 = Date.now();
    await setMd(p, FLOW_MD); await rendered(p);
    const t1 = Date.now() - t0;
    const c1 = assetReqs(r).slice(before); const mm = c1.filter((f) => f.endsWith('.js'));
    const bytes = mm.reduce((a, f) => a + chunkSize(f), 0);
    const total = fs.readdirSync(path.join(EXT, 'editor/assets')).filter((f) => f.endsWith('.js')).length;
    const totalBytes = fs.readdirSync(path.join(EXT, 'editor/assets')).filter((f) => f.endsWith('.js')).reduce((a, f) => a + chunkSize(f), 0);
    console.log(`flowchart: first render ${t1} ms; lazy JS chunks=${mm.length}/${total} (${(bytes / 1e6).toFixed(2)} of ${(totalBytes / 1e6).toFixed(1)} MB): ${JSON.stringify(mm.map((f) => f.replace(/-[\w-]{8}\.js$/, '')))}`);
    expect(mm.some((f) => /^mermaid\.core-/.test(f))).toBe(true);
    console.log('OBSERVATION: elk chunk (3.17 MB, ELK layout engine) is fetched for a plain flowchart: ' + mm.some((f) => /^elk-/.test(f)));
    expect(mm.length).toBeLessThan(40);
    expect(mm.some((f) => /^(architectureDiagram|cynefin|kanban|ganttDiagram|sequenceDiagram|pieDiagram)/.test(f)), 'unrelated diagram chunks not loaded').toBe(false);
    expect(r.resps.filter((x) => x.status >= 400)).toEqual([]);
    // second doc of same type: cached, no new chunk requests
    const n2 = assetReqs(r).length; await setMd(p, FLOW_MD.replace('Diagram', 'Diagram2').replace('GDELT 2.0', 'GDELT 3.0')); await rendered(p);
    const t2 = Date.now();
    console.log('same-type re-render new asset requests:', assetReqs(r).length - n2);
    expect(assetReqs(r).length - n2).toBe(0);
    // adding a different type loads exactly its chunk(s)
    const n3 = assetReqs(r).length; await setMd(p, fence(PIE) + '\n'); await rendered(p); await p.waitForTimeout(300);
    const pie = assetReqs(r).slice(n3); console.log('pie adds:', JSON.stringify(pie));
    expect(pie.some((f) => /^pieDiagram/.test(f))).toBe(true); expect(pie.length).toBeLessThan(10);
    void t2;
    expect(clean(r)).toEqual([]);
  });
  test('startup timing (5 cold opens, no mermaid content): median ready time reported; bundle size facts', async ({ ext }) => {
    const ts = [];
    for (let i = 0; i < 5; i++) { const t0 = Date.now(); const r = await openMM(ext); ts.push(Date.now() - t0); await r.page.close(); }
    ts.sort((a, b) => a - b);
    const idx = fs.readdirSync(path.join(EXT, 'editor/assets')).filter((f) => /^index-.*\.js$/.test(f));
    const all = fs.readdirSync(path.join(EXT, 'editor/assets'));
    const sum = (rx) => all.filter((f) => rx.test(f)).reduce((a, f) => a + chunkSize(f), 0);
    console.log(`open->editor ready ms: ${JSON.stringify(ts)} median ${ts[2]}; entry ${JSON.stringify(idx.map((f) => [f, chunkSize(f)]))}; total js ${(sum(/\.js$/) / 1e6).toFixed(1)} MB in ${all.filter((f) => f.endsWith('.js')).length} files; fonts ${(sum(/^KaTeX_/) / 1e6).toFixed(2)} MB in ${all.filter((f) => /^KaTeX_/.test(f)).length} files; zip ${(fs.statSync(path.join(EXT, '..', 'dist/md-editor-ext.zip')).size / 1e6).toFixed(2)} MB`);
    expect(ts[2], 'median cold open < 5s').toBeLessThan(5000);
  });
});

// =====================================================================================================================
// 11. existing features with mermaid/math docs
// =====================================================================================================================
test.describe('11. existing features', () => {
  const DOC = '# Doc\n\n' + fence('graph LR\n  A[Drag]-->B[Drop]') + '\n\nInline $a^2+b^2$ text.\n\n' + MATH_BLOCK + '\n\nEnd.\n';
  test('drag-drop of a mermaid/math .md opens it, renders, not dirty, byte-identical; dropping onto a dirty doc asks to confirm', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await p.evaluate((t) => { const dt = new DataTransfer(); dt.items.add(new File([t], 'dropped.md', { type: 'text/markdown' })); for (const e of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(e, { dataTransfer: dt, bubbles: true, cancelable: true })); }, DOC);
    await expect(p.locator('#filename')).toHaveText('dropped.md'); await rendered(p, 3);
    await expect(p.locator(MM + ' svg')).toHaveCount(1); await expect(p.locator('.katex')).toHaveCount(2 + 0);
    expect(await md(p)).toBe(DOC); expect((await p.evaluate(() => window.__mdwe.state)).dirty).toBe(false);
    await expect(p.locator('#dropzone')).toBeHidden();
    // dirty then drop second file: confirm dialog (auto-accepted by helper)
    await focusEnd(p); await p.keyboard.type(' dirty'); await settle(p);
    await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['# Other\n'], 'other.md', { type: 'text/markdown' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
    await expect(p.locator('#filename')).toHaveText('other.md');
    expect(r.dialogs.length).toBeGreaterThanOrEqual(1); console.log('dialogs on dirty drop:', JSON.stringify(r.dialogs));
    expect(await nodeCount(p, '[data-mdx-node]')).toBe(0);
    expect(clean(r)).toEqual([]);
  });

  test('autosave / draft: edit a doc with mermaid+math -> draft has markdown (fence + $$ intact); reload restores it dirty and re-renders; edit via per-block source is drafted too; save clears', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, DOC); await rendered(p, 3);
    await focusEnd(p); await p.keyboard.type(' draftedtext');
    await expect.poll(() => storageGet(p, 'mdwe.draft'), { timeout: 5000 }).toBeTruthy();
    let d = await storageGet(p, 'mdwe.draft'); console.log('draft text:', JSON.stringify(d.text));
    expect(d.text).toContain('```mermaid\ngraph LR\n  A[Drag]-->B[Drop]\n```'); expect(d.text).toContain('$$\\int_0^\\infty'); expect(d.text).toContain('$a^2+b^2$'); expect(d.text).toContain('draftedtext');
    // per-block source edit is also drafted
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await p.locator(MM + ' textarea').fill('graph LR\n  A-->B\n  B-->DRAFTNODE'); await p.locator(MM + ' [data-mdx-action="toggle-source"]').click();
    await expect.poll(async () => (await storageGet(p, 'mdwe.draft')).text, { timeout: 6000 }).toContain('B-->DRAFTNODE');
    await p.evaluate(() => { window.onbeforeunload = null; });
    await p.reload(); await p.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    await expect.poll(() => md(p), { timeout: 5000 }).toContain('B-->DRAFTNODE');
    await rendered(p, 3);
    await expect(p.locator('#filename')).toHaveClass(/dirty/); await expect(p.locator('#status')).toContainText('Restored autosaved draft');
    expect(await svgText(p.locator(MM))).toContain('DRAFTNODE'); await expect(p.locator('.katex')).toHaveCount(2);
    const restored = await md(p); expect(restored).toContain('draftedtext'); expect(restored).toContain(MATH_BLOCK);
    expect(clean(r)).toEqual([]);
  });

  test('draft restored while a diagram is still rendering (reload immediately after edit) never loses the fence; unload right after per-block edit keeps it (flush before serialize)', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, DOC); await rendered(p, 3);
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await p.locator(MM + ' textarea').fill('graph LR\n  Q-->QUICK');
    // no wait: the node view's 350ms commit debounce is pending. Force autosave path (onChange) by typing after it:
    await focusEnd(p); await p.keyboard.type(' x');
    const mdNow = await md(p); expect(mdNow).toContain('Q-->QUICK');
    await expect.poll(async () => ((await storageGet(p, 'mdwe.draft')) || {}).text || '', { timeout: 6000 }).toContain('Q-->QUICK');
    expect(clean(r)).toEqual([]);
  });

  test('whole-doc Source view: mermaid/math show as markdown text verbatim, edit there -> back to WYSIWYG re-renders the new diagram/math; toggling repeatedly is stable', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    await setMd(p, DOC); await rendered(p, 3);
    await p.click('.mdx-toolbar [data-cmd="source"]');
    const ta = p.locator('textarea.mdx-source'); await expect(ta).toBeVisible();
    expect(await ta.inputValue()).toBe(DOC);
    await expect(p.locator('.mdx-toolbar [data-cmd="diagram"]')).toBeDisabled();
    const edited = DOC.replace('B[Drop]', 'B[Dropped]\n  B-->C[Third]').replace('a^2+b^2', 'c^2');
    await ta.fill(edited);
    expect(await md(p)).toBe(edited);
    await p.click('.mdx-toolbar [data-cmd="source"]'); await rendered(p, 3);
    expect(await svgText(p.locator(MM))).toContain('Third'); expect(await p.locator(MI + ' annotation').textContent()).toBe('c^2');
    expect(await md(p)).toBe(edited);
    for (let i = 0; i < 3; i++) { await p.click('.mdx-toolbar [data-cmd="source"]'); await p.click('.mdx-toolbar [data-cmd="source"]'); }
    await rendered(p, 3); expect(await md(p)).toBe(edited);
    // per-block toggle open when whole-doc source toggled: no crash
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await p.click('.mdx-toolbar [data-cmd="source"]');
    expect(await ta.inputValue()).toBe(edited); await p.click('.mdx-toolbar [data-cmd="source"]'); await rendered(p, 3);
    expect(clean(r)).toEqual([]);
  });

  test('after editing a diagram via its source and closing it, Ctrl+S saves the edit; bold via Ctrl+B in a normal paragraph still works; flush-before-save works', async ({ ext }) => {
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: DOC, openName: 'k.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3);
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); await p.locator(MM + ' textarea').fill('graph LR\n  A-->B\n  B-->CTRLS');
    await p.locator(MM + ' [data-mdx-action="toggle-source"]').click(); // close immediately (commit pending < debounce)
    await focusEnd(p); await p.keyboard.press('Control+b'); await p.keyboard.type('bold'); await settle(p);
    expect(await md(p)).toContain('**bold**'); expect(await md(p)).toContain('B-->CTRLS');
    await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
    const saved2 = await p.evaluate(() => window.__fsa.files['k.md']); expect(saved2).toContain('B-->CTRLS'); expect(saved2).toContain('**bold**');
    expect(clean(r)).toEqual([]);
  });

  test('[BUG-26] Ctrl+S / Ctrl+O pressed while focus is INSIDE a per-block source field (mermaid textarea, block-math textarea, inline-math input) must still save/open (and must not fall through to the browser "Save page as")', async ({ ext }) => {
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: DOC, openName: 'k.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3);
    // document-level listeners never see the event (the field's keydown handler calls stopPropagation) -> observe it on the focused field itself (later listener on the same target)
    await p.evaluate(() => { window.__defPrev = []; document.addEventListener('keydown', (e) => { if (e.ctrlKey && /^[so]$/i.test(e.key) && e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) setTimeout(() => window.__defPrev.push(e.key + ':' + e.defaultPrevented), 0); }, true); });
    const res = {};
    const fields = { mermaid: [MM + ' [data-mdx-action="toggle-source"]', MM + ' textarea', 'graph LR\n  A-->B\n  B-->F1'], blockMath: [MB + ' [data-mdx-action="toggle-source"]', MB + ' textarea', 'x+F2'] };
    for (const [k, [tog, field, val]] of Object.entries(fields)) {
      await p.locator(tog).click(); await p.locator(field).fill(val);
      const w0 = await p.evaluate(() => window.__fsa.writes.length); await p.evaluate(() => { window.__defPrev = []; });
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      res[k] = { writes: (await p.evaluate(() => window.__fsa.writes.length)) - w0, defaultPrevented: await p.evaluate(() => window.__defPrev) };
      await p.locator(tog).click(); await settle(p);
    }
    { // inline math input (opened by clicking the rendered math)
      const bx = await p.locator(MI + ' .mdx-math-render').boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
      await expect(p.locator(MI + ' input.mdx-math-source')).toBeVisible(); await p.locator(MI + ' input.mdx-math-source').fill('a^3');
      const w0 = await p.evaluate(() => window.__fsa.writes.length); await p.evaluate(() => { window.__defPrev = []; });
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      res.inlineMath = { writes: (await p.evaluate(() => window.__fsa.writes.length)) - w0, defaultPrevented: await p.evaluate(() => window.__defPrev) };
      await p.keyboard.press('Enter'); await settle(p);
    }
    console.log('Ctrl+S inside per-block source fields:', JSON.stringify(res));
    await shotTo(p, 'bug26-ctrl-s-in-diagram-source.png');
    for (const [k, v] of Object.entries(res)) { expect(v.writes, k + ': Ctrl+S inside source field saves').toBe(1); expect(v.defaultPrevented.every((x) => x.endsWith(':true')), k + ': browser default prevented').toBe(true); }
  });

  test('file:// content script + ?src=: a local .md containing mermaid + math -> "Edit in Markdown Editor" -> editor renders diagram and math, content byte-identical', async ({ ext }) => {
    const file = '/tmp/mdwe-mermaid-test.md';
    fs.writeFileSync(file, DOC);
    const page = await ext.ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('file://' + file).catch(() => {});
    const btn = page.locator('#__mdwe_btn');
    let appeared = true; try { await btn.waitFor({ timeout: 5000 }); } catch { appeared = false; }
    console.log('content-script button present on mermaid .md:', appeared);
    if (!appeared) { test.info().annotations.push({ type: 'manual', description: 'content script not injected in harness' }); test.skip(true, 'content script not injected -> MANUAL'); }
    await btn.click();
    await page.waitForURL(/chrome-extension:\/\/.*\/editor\/index\.html\?src=/, { timeout: 8000 });
    await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
    await page.waitForFunction(() => { const ns = [...document.querySelectorAll('[data-mdx-node]')]; return ns.length >= 3 && ns.every((x) => x.dataset.mdxRendered); }, null, { timeout: 60000 });
    expect(await page.evaluate(() => window.__mdwe.editor.getMarkdown())).toBe(DOC);
    await expect(page.locator(MM + ' svg')).toHaveCount(1); await expect(page.locator('.katex')).toHaveCount(2);
    expect(errs).toEqual([]);
    fs.rmSync(file, { force: true });
  });

  test('the ?src= route also renders directly via fetch stub (independent of file-URL access)', async ({ ext }) => {
    const r = await openMM(ext, { query: '?src=' + encodeURIComponent('file:///tmp/virtual-mm.md'), init: ({ map }) => { const of = window.fetch.bind(window); window.fetch = async (u, ...a) => { u = String(u); if (u.startsWith('file://')) return u in map ? new Response(map[u], { status: 200 }) : new Response('nf', { status: 404 }); return of(u, ...a); }; }, arg: { map: { 'file:///tmp/virtual-mm.md': DOC } } });
    const p = r.page; await rendered(p, 3);
    expect(await md(p)).toBe(DOC); await expect(p.locator('#filename')).toHaveText('virtual-mm.md');
    expect(clean(r)).toEqual([]);
  });
});

// Privacy probe: Mermaid strict mode keeps <img> in HTML labels (only handlers/scripts are stripped) -> a REMOTE image URL inside a diagram label is fetched
// as soon as the doc is opened (same class as BUG #13 for markdown images; a tracking-pixel / IP leak vector for untrusted .md files).
test('[INFO/BUG-29] remote <img> inside a mermaid HTML label / KaTeX \\includegraphics: does opening the doc contact a remote host?', async ({ ext }) => {
  const remote = [];
  await ext.ctx.route(/^https?:\/\/(?!chrome-extension)[^/]*tracker\.example\//, (route) => { remote.push(route.request().url()); route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }); });
  const r = await openMM(ext); const p = r.page;
  await setMd(p, fence('graph LR\n  A["<img src=\'https://tracker.example/mermaid-pixel.png\'>label"] --> B') + '\n\n$\\includegraphics{https://tracker.example/katex-pixel.png}$ and $\\href{https://tracker.example/l}{x}$\n');
  await rendered(p, 3); await p.waitForTimeout(1200);
  const hits = remote.concat(r.reqs.filter((u) => /tracker\.example/.test(u)));
  const imgs = await p.evaluate(() => [...document.querySelectorAll('.mdx-node img')].map((i) => i.getAttribute('src')));
  console.log('remote requests triggered by diagram/math content:', JSON.stringify([...new Set(hits)]), '| <img> in rendered nodes:', JSON.stringify(imgs));
  test.info().annotations.push({ type: 'privacy', description: 'remote requests from diagram label: ' + JSON.stringify([...new Set(hits)]) });
  // Not asserted as failure (documented like BUG #13); mermaid img is the only observed path, KaTeX (trust:false) must never fetch.
  expect(hits.filter((u) => /katex-pixel|\/l$/.test(u)), 'KaTeX must not fetch remote resources').toEqual([]);
  expect(await csp(p)).toEqual([]);
});

// =====================================================================================================================
// 12. Round-2 fixes (build index-3Oh89ym1.js): #26 Ctrl+S/O inside per-block fields, #27 math errors, #28 CRLF Source toggle, #29 mermaid label fetches
// =====================================================================================================================
const DOC26 = '# K\n\n' + fence('graph LR\n  A-->B') + '\n\nInline $a+b$ text.\n\n$$x+1$$\n\nend\n';
const openInlineMath = async (p) => { const bx = await p.locator(MI + ' .mdx-math-render').boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await expect(p.locator(MI + ' input.mdx-math-source')).toBeVisible(); };
const FIELDS26 = {
  mermaid: { open: (p) => p.locator(MM + ' [data-mdx-action="toggle-source"]').click(), field: MM + ' textarea.mdx-mermaid-source', val: 'graph LR\n  A-->B\n  B-->QF26', expect: 'B-->QF26\n```', close: (p) => p.locator(MM + ' [data-mdx-action="toggle-source"]').click() },
  blockMath: { open: (p) => p.locator(MB + ' [data-mdx-action="toggle-source"]').click(), field: MB + ' textarea.mdx-math-source', val: 'x+QF26', expect: '$$x+QF26$$', close: (p) => p.locator(MB + ' [data-mdx-action="toggle-source"]').click() },
  inlineMath: { open: openInlineMath, field: MI + ' input.mdx-math-source', val: 'a^QF26', expect: '$a^QF26$', close: (p) => p.keyboard.press('Enter') },
};

test.describe('12a. #26 verify: Ctrl+S / Ctrl+O inside per-block source fields', () => {
  test('local (FSA stub): Ctrl+S right after typing (no wait) writes the file WITH the pending edit, from mermaid textarea, block-math textarea, inline-math input; default prevented; doc not dirty afterwards', async ({ ext }) => {
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: DOC26, openName: 'k.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3);
    await p.evaluate(() => { window.__defPrev = []; document.addEventListener('keydown', (e) => { if (e.ctrlKey && /^[so]$/i.test(e.key)) setTimeout(() => window.__defPrev.push(e.key + ':' + e.defaultPrevented), 0); }, true); });
    const res = {};
    for (const [k, f] of Object.entries(FIELDS26)) {
      await f.open(p); await p.locator(f.field).fill(f.val); // NO settle: the 350 ms node-view debounce must not be needed
      const w0 = await p.evaluate(() => window.__fsa.writes.length); await p.evaluate(() => { window.__defPrev = []; });
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      const w = await p.evaluate(() => ({ n: window.__fsa.writes.length, last: window.__fsa.writes[window.__fsa.writes.length - 1]?.text }));
      res[k] = { writes: w.n - w0, hasEdit: (w.last || '').includes(f.expect), defPrev: await p.evaluate(() => window.__defPrev), dirty: await p.locator('#filename').getAttribute('class') };
      await f.close(p); await settle(p);
    }
    console.log('#26 local:', JSON.stringify(res));
    for (const [k, v] of Object.entries(res)) { expect(v.writes, k + ' writes').toBe(1); expect(v.hasEdit, k + ' saved text has the pending edit').toBe(true); expect(v.defPrev.some((x) => x.startsWith('s:true')), k + ' Ctrl+S default prevented').toBe(true); expect(v.dirty || '', k + ' not dirty after save').not.toMatch(/dirty/); }
    expect(await p.evaluate(() => window.__fsa.saveAsCalls)).toBe(0);
    expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });

  test('Drive emulator: Ctrl+S inside each field PATCHes exactly once with the pending edit', async ({ ext }) => {
    const d = new FakeDrive([{ id: 'x', name: 'k.md', text: DOC26 }]);
    const r = await openDriveEditor(ext, { drive: d }); const p = r.page;
    await p.click('#btn-drive-open'); await p.locator('.gdui-dialog .gdui-row', { hasText: 'k.md' }).first().click(); await p.locator('.gdui-dialog [data-action="open"]').click(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await rendered(p, 3); await settle(p);
    const res = {};
    for (const [k, f] of Object.entries(FIELDS26)) {
      await f.open(p); await p.locator(f.field).fill(f.val);
      const n0 = d.attempts('PATCH').length;
      await p.keyboard.press('Control+s'); await p.waitForTimeout(700);
      res[k] = { patches: d.attempts('PATCH').length - n0, hasEdit: d.text('x').includes(f.expect) };
      await f.close(p); await settle(p);
    }
    console.log('#26 drive:', JSON.stringify(res));
    for (const [k, v] of Object.entries(res)) { expect(v.patches, k + ' PATCH count').toBe(1); expect(v.hasEdit, k + ' Drive text has the edit').toBe(true); }
    expect(r.errors.filter(bootErrOk)).toEqual([]);
  });

  test('Ctrl+O inside each field triggers the open picker (fsa.opens++), and opens the file', async ({ ext }) => {
    const res = {};
    for (const [k, f] of Object.entries(FIELDS26)) {
      const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: DOC26, openName: 'k.md' }) }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3);
      await f.open(p); await p.locator(f.field).fill(f.val);
      const o0 = await p.evaluate(() => window.__fsa.opens);
      await p.evaluate(() => { window.__fsa.files['k.md'] = '# Reopened\n\nfresh\n'; });
      await p.keyboard.press('Control+o'); await p.waitForTimeout(600);
      res[k] = { opens: (await p.evaluate(() => window.__fsa.opens)) - o0, dialogs: r.dialogs.length };
      expect(clean(r), k).toEqual([]); await p.close();
    }
    console.log('#26 Ctrl+O:', JSON.stringify(res));
    for (const [k, v] of Object.entries(res)) expect(v.opens, k + ' opens').toBe(1);
  });

  test('native chords (Ctrl+A/Z/C/V/X) still work inside every field and trigger neither save nor open; typing letters/Enter/Esc still local', async ({ ext }) => {
    await ext.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `chrome-extension://${ext.extId}` }).catch(() => {});
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: DOC26, openName: 'k.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3);
    const o0 = await p.evaluate(() => window.__fsa.opens); const res = {};
    for (const [k, f] of Object.entries(FIELDS26)) {
      await f.open(p); const fl = p.locator(f.field); await fl.click(); await fl.press('Control+a');
      await p.keyboard.type('abc'); const afterType = await fl.inputValue();
      await p.keyboard.press('Control+z'); const afterUndo = await fl.inputValue();
      await p.keyboard.press('Control+a'); await p.keyboard.press('Control+c'); await p.keyboard.press('End'); await p.keyboard.press('Control+v');
      const afterPaste = await fl.inputValue();
      // cut a PARTIAL selection (emptying a math source removes the node after the commit debounce - by design, not a #26 issue)
      await fl.press('End'); await p.keyboard.type('xyz'); const before = await fl.inputValue(); await p.keyboard.press('Shift+ArrowLeft'); await p.keyboard.press('Shift+ArrowLeft'); await p.keyboard.press('Control+x'); const afterCut = await fl.inputValue();
      await p.keyboard.press('Control+z'); const afterUndoCut = await fl.inputValue();
      const sel = await fl.evaluate((el) => (el.selectionEnd - el.selectionStart) + '/' + el.value.length);
      res[k] = { afterType, afterUndo, afterPaste, before, afterCut, afterUndoCut, sel };
      // Esc reverts + closes (unchanged behaviour)
      await p.keyboard.press('Escape'); await settle(p);
    }
    console.log('#26 native chords:', JSON.stringify(res));
    for (const [k, v] of Object.entries(res)) {
      expect(v.afterType, k + ' Ctrl+A then typing replaces all').toBe('abc');
      expect(v.afterUndo, k + ' Ctrl+Z is handled natively (value changed)').not.toBe('abc');
      expect(v.afterCut.length, k + ' Ctrl+X cuts the 2-char selection').toBeGreaterThan(0);
      expect(v.afterUndoCut.length, k + ' Ctrl+Z after cut restores text').toBeGreaterThan(v.afterCut.length);
    }
    const clipRes = Object.values(res).map((v) => v.afterPaste);
    console.log('paste results (clipboard may be unavailable headless):', JSON.stringify(clipRes));
    expect(await p.evaluate(() => window.__fsa.writes.length), 'no save triggered by native chords').toBe(0);
    expect(await p.evaluate(() => window.__fsa.opens) - o0, 'no open triggered by native chords').toBe(0);
    expect(await p.locator('#filename').innerText()).toBe('k.md');
    // (Esc only reverts edits not yet committed by the 350 ms node-view debounce; here they were, so the doc legitimately holds the typed text - pre-existing behaviour, not asserted)
    expect(await p.evaluate(() => [...document.querySelectorAll('textarea.mdx-mermaid-source, textarea.mdx-math-source, input.mdx-math-source')].filter((e) => e.offsetParent !== null).length), 'all fields closed after Esc').toBe(0);
    expect(await p.locator('#filename').getAttribute('class')).toMatch(/dirty/); // edits kept and doc dirty, but nothing was saved
    expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });

  test('main editor (not in a field): Ctrl+S saves after typing; Ctrl+Z right after opening a mermaid+math doc does not blank it; Ctrl+K link still works and is not hijacked by per-block fields', async ({ ext }) => {
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: DOC26, openName: 'k.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('k.md'); await rendered(p, 3); await settle(p);
    await focusEnd(p); await p.keyboard.press('Control+z'); await p.keyboard.press('Control+z'); await settle(p);
    expect(await md(p)).toBe(DOC26); expect(await nodeCount(p, '[data-mdx-node]')).toBe(3);
    await p.keyboard.type(' MAINEDIT'); await settle(p);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
    const saved = await p.evaluate(() => window.__fsa.files['k.md']);
    expect(saved).toContain('end MAINEDIT'); expect(saved).toContain('```mermaid\ngraph LR'); expect(saved).toContain('$$x+1$$');
    await expect(p.locator('#filename')).not.toHaveClass(/dirty/);
    expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });
});

test.describe('12b. #27 verify: math error display', () => {
  test('\\undefinedcmd inline + block -> .mdx-error[data-mdx-error=math] + data-mdx-rendered=error (title = message, raw src shown); \\frac{ too; valid math (frac, sum, int, greek, mathbb, aligned, pmatrix, text, unicode) renders ok with .katex and no error; markdown unchanged; source still editable', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const valid = ['\\frac{a}{b}', '\\sum_{i=1}^n i', '\\int_0^1 x\\,dx', '\\alpha+\\beta', '\\mathbb{R}', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\text{héllo 世界}', '\\sqrt{x}', 'E=mc^2'];
    const doc = 'bad $\\undefinedcmd$ and $\\frac{$ end\n\n$$\\undefinedcmd{x}$$\n\n$$\\frac{$$\n\n' + valid.map((v) => '$' + v + '$').join(' ') + '\n\n$$\\begin{aligned}a&=b\\\\c&=d\\end{aligned}$$\n';
    await setMd(p, doc); await rendered(p, 4 + valid.length + 1);
    const info = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node^="math"]')].map((n) => ({ kind: n.dataset.mdxNode, rendered: n.dataset.mdxRendered, err: [...n.querySelectorAll('.mdx-error[data-mdx-error="math"]')].map((e) => ({ tag: e.tagName, title: e.title, txt: e.textContent.slice(0, 80), src: e.querySelector('code.mdx-error-src')?.textContent })), katex: n.querySelectorAll('.katex').length, hasErr: n.classList.contains('mdx-has-error') || !!n.querySelector('.mdx-has-error') })));
    console.log('#27 nodes:', JSON.stringify(info));
    const bad = info.slice(0, 4), good = info.slice(4);
    expect(bad.length).toBe(4);
    for (const x of bad) { expect(x.rendered).toBe('error'); expect(x.err.length).toBe(1); expect(x.err[0].title.length, 'tooltip message').toBeGreaterThan(3); expect(x.err[0].txt).toMatch(/Math error/i); }
    expect(bad[0].err[0].tag, 'inline error is a span').toBe('SPAN'); expect(bad[0].err[0].src).toContain('undefinedcmd'); expect(bad[2].err[0].tag, 'block error is a div').toBe('DIV');
    expect(good.length).toBe(valid.length + 1);
    for (const x of good) { expect(x.rendered).toBe('ok'); expect(x.err.length).toBe(0); expect(x.katex).toBeGreaterThan(0); }
    expect(await md(p)).toBe(doc);
    // source of an error node is still editable and fixing it clears the error
    await p.locator(MB).nth(0).locator('[data-mdx-action="toggle-source"]').click();
    await p.locator(MB).nth(0).locator('textarea.mdx-math-source').fill('\\alpha'); await p.locator(MB).nth(0).locator('[data-mdx-action="toggle-source"]').click(); await settle(p);
    await expect(p.locator(MB).nth(0)).toHaveAttribute('data-mdx-rendered', 'ok');
    expect(await md(p)).toContain('$$\\alpha$$');
    await shotTo(p, 'math-errors-round2.png');
    expect(await csp(p)).toEqual([]);
    expect(clean(r)).toEqual([]);
  });

  test('\\href, \\url, \\includegraphics, \\htmlClass/\\htmlId/\\htmlStyle/\\htmlData are shown as errors (inline + block), make 0 remote requests, produce no <a>/<img> element', async ({ ext }) => {
    const remote = []; await ext.ctx.route(/^https?:\/\/(?!chrome-extension)/, (route) => { remote.push(route.request().url()); route.fulfill({ status: 200, body: '' }); });
    const r = await openMM(ext); const p = r.page;
    const cmds = ['\\href{https://tracker.example/h}{x}', '\\url{https://tracker.example/u}', '\\includegraphics{https://tracker.example/i.png}', '\\htmlClass{c}{x}', '\\htmlId{i}{x}', '\\htmlStyle{color:red}{x}', '\\htmlData{k=v}{x}'];
    const doc = cmds.map((c) => 'in $' + c + '$ line').join('\n\n') + '\n\n' + cmds.map((c) => '$$' + c + '$$').join('\n\n') + '\n';
    await setMd(p, doc); await rendered(p, cmds.length * 2); await p.waitForTimeout(800);
    const info = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node^="math"]')].map((n) => ({ tex: (n.dataset.mdxSrc || n.textContent).slice(0, 30), rendered: n.dataset.mdxRendered, err: n.querySelectorAll('.mdx-error[data-mdx-error="math"]').length, a: n.querySelectorAll('a[href]').length, img: n.querySelectorAll('img').length })));
    console.log('#27 untrusted cmds:', JSON.stringify(info));
    expect(info.length).toBe(cmds.length * 2);
    for (const x of info) { expect(x.rendered, x.tex).toBe('error'); expect(x.err, x.tex).toBe(1); expect(x.a, 'no link').toBe(0); expect(x.img, 'no img').toBe(0); }
    expect(remote.concat(r.reqs.filter((u) => /tracker\.example/.test(u)))).toEqual([]);
    expect(await md(p)).toBe(doc);
    expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });
});

test.describe('12c. #28 verify: CRLF + whole-doc Source toggle', () => {
  const DOCS = { plain: '# T\r\n\r\npara one\r\n\r\n- a\r\n- b\r\n', mermaid: BYTE_DOCS.crlf, 'crlf-no-final-nl': 'a\r\n\r\nb $x$', mixed: 'lf line\n\r\ncrlf line\r\n\r\nlast\n' };
  test('local: unedited CRLF doc -> Source on/off (also 3x and while in Source) -> getMarkdown == original, isModified false, not dirty, Ctrl+S leaves file byte-identical', async ({ ext }) => {
    const rep = {};
    for (const [name, text] of Object.entries(DOCS)) {
      const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: name + '.md' }) }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText(name + '.md'); await p.waitForFunction(() => [...document.querySelectorAll('[data-mdx-node]')].every((x) => x.dataset.mdxRendered)); await settle(p);
      const st = () => p.evaluate(() => ({ mod: window.__mdwe.editor.isModified(), dirty: window.__mdwe.state.dirty, src: window.__mdwe.editor.isSourceMode() }));
      await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
      const inSrc = { st: await st(), md: await md(p), ta: await p.locator('textarea.mdx-source').inputValue() };
      await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
      const back = { st: await st(), md: await md(p) };
      for (let i = 0; i < 2; i++) { await p.click('.mdx-toolbar [data-cmd="source"]'); await p.click('.mdx-toolbar [data-cmd="source"]'); } await settle(p);
      const back3 = { st: await st(), md: await md(p) };
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      const w = await p.evaluate((n) => ({ file: window.__fsa.files[n + '.md'], writes: window.__fsa.writes.map((x) => x.text) }), name);
      const cls = await p.locator('#filename').getAttribute('class');
      rep[name] = { srcTaHasCR: /\r/.test(inSrc.ta), srcMdIsOrig: inSrc.md === text, srcModified: inSrc.st.mod, backMdIsOrig: back.md === text, backModified: back.st.mod, backDirty: back.st.dirty, back3Orig: back3.md === text, back3Mod: back3.st.mod, fileIdentical: w.file === text, writes: w.writes.length, lastWriteIdentical: w.writes.length ? w.writes[w.writes.length - 1] === text : null, dirtyClass: /dirty/.test(cls || '') };
      expect(inSrc.md, name + ' getMarkdown in Source (unedited)').toBe(text); expect(inSrc.st.mod, name + ' isModified in Source').toBe(false);
      expect(back.md, name + ' after leaving Source').toBe(text); expect(back.st.mod, name).toBe(false); expect(back.st.dirty, name + ' state.dirty').toBeFalsy();
      expect(back3.md, name + ' after 3 toggles').toBe(text); expect(back3.st.mod).toBe(false);
      expect(w.file, name + ' file bytes').toBe(text); if (w.writes.length) expect(w.writes[w.writes.length - 1]).toBe(text);
      expect(/dirty/.test(cls || ''), name + ' not dirty class').toBe(false);
      expect(clean(r), name).toEqual([]); await p.close();
    }
    console.log('#28 local:', JSON.stringify(rep));
  });

  test('local: editing in Source falls back to LF (whole doc), edit is kept, doc is dirty, save writes LF-only; edit-then-revert in Source; edit in WYSIWYG after toggle also LF', async ({ ext }) => {
    const text = DOCS.plain; const res = {};
    { // edit in Source
      const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: 'e.md' }) }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('e.md'); await settle(p);
      await p.click('.mdx-toolbar [data-cmd="source"]'); const ta = p.locator('textarea.mdx-source');
      await ta.click(); await p.keyboard.press('Control+End'); await p.keyboard.type('\nSRCEDIT\n'); await settle(p);
      const mid = await md(p); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
      const dirty = await p.evaluate(() => window.__mdwe.editor.isModified() || window.__mdwe.state.dirty);
      await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      const file = await p.evaluate(() => window.__fsa.files['e.md']);
      res.srcEdit = { midHasCR: /\r/.test(mid), midHasEdit: mid.includes('SRCEDIT'), dirty, fileHasCR: /\r/.test(file), fileHasEdit: file.includes('SRCEDIT'), file };
      expect(res.srcEdit.midHasEdit).toBe(true); expect(res.srcEdit.midHasCR, 'edited source is LF (fallback)').toBe(false); expect(dirty).toBe(true);
      expect(res.srcEdit.fileHasEdit).toBe(true); expect(res.srcEdit.fileHasCR, 'saved file LF-only after a Source edit').toBe(false);
      expect(file).toContain('# T\n\npara one\n\n- a\n- b'); expect(clean(r)).toEqual([]); await p.close();
    }
    { // edit in Source then revert by hand -> textarea equals srcNorm again
      const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: 'e2.md' }) }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('e2.md'); await settle(p);
      await p.click('.mdx-toolbar [data-cmd="source"]'); await p.locator('textarea.mdx-source').click(); await p.keyboard.press('Control+End'); await p.keyboard.type('Z'); await p.keyboard.press('Backspace'); await settle(p);
      const m2 = await md(p); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
      res.revert = { md: m2 === text ? 'orig(CRLF)' : JSON.stringify(m2), mod: await p.evaluate(() => window.__mdwe.editor.isModified()) };
      expect(m2 === text || m2 === text.replace(/\r\n/g, '\n'), 'either exact original or LF (no corruption, no lone CR)').toBe(true);
      expect(/\r(?!\n)/.test(m2)).toBe(false); expect(clean(r)).toEqual([]); await p.close();
    }
    { // WYSIWYG edit after a Source round trip
      const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: 'e3.md' }) }); const p = r.page;
      await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('e3.md'); await settle(p);
      await p.click('.mdx-toolbar [data-cmd="source"]'); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
      await focusEnd(p); await p.keyboard.type(' WYS'); await settle(p); await p.keyboard.press('Control+s'); await p.waitForTimeout(500);
      const f3 = await p.evaluate(() => window.__fsa.files['e3.md']); res.wys = { hasCR: /\r/.test(f3), hasEdit: f3.includes('WYS') };
      expect(res.wys.hasEdit).toBe(true); expect(res.wys.hasCR).toBe(false); await p.close();
    }
    console.log('#28 edit fallback:', JSON.stringify({ ...res, srcEdit: { ...res.srcEdit, file: undefined } }));
  });

  test('Drive emulator: CRLF doc, Source on/off unedited -> Ctrl+S sends 0 PATCH and Drive bytes stay CRLF-identical; after a Source edit, PATCH is LF-only', async ({ ext }) => {
    const text = DOCS.mermaid; const d = new FakeDrive([{ id: 'x', name: 'c.md', text }]);
    const r = await openDriveEditor(ext, { drive: d }); const p = r.page;
    await p.click('#btn-drive-open'); await p.locator('.gdui-dialog .gdui-row', { hasText: 'c.md' }).first().click(); await p.locator('.gdui-dialog [data-action="open"]').click(); await p.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await rendered(p, 3); await settle(p);
    await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(700);
    expect(d.attempts('PATCH').length, 'no PATCH for unedited doc').toBe(0); expect(d.bytes('x').equals(Buffer.from(text, 'utf8'))).toBe(true);
    await p.click('.mdx-toolbar [data-cmd="source"]'); await p.locator('textarea.mdx-source').click(); await p.keyboard.press('Control+End'); await p.keyboard.type('DRVSRC'); await settle(p); await p.click('.mdx-toolbar [data-cmd="source"]'); await settle(p);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(700);
    const t = d.text('x'); console.log('#28 drive after source edit:', JSON.stringify(t.slice(0, 80)), 'hasCR', /\r/.test(t));
    expect(d.attempts('PATCH').length).toBe(1); expect(t).toContain('DRVSRC'); expect(/\r/.test(t)).toBe(false);
    expect(r.errors.filter(bootErrOk)).toEqual([]);
  });
});

test.describe('12d. #29 verify: mermaid label sanitization makes no remote requests', () => {
  const T = 'https://tracker.example';
  const EVIL = [
    `flowchart LR\n  A["<img src='${T}/i-img.png'>img"] --> B["<video src='${T}/v.mp4' poster='${T}/v-poster.png'></video>vid"]\n  B --> C["<iframe src='${T}/f.html'></iframe>frm"]\n  C --> D["<div style='background:url(${T}/css-bg.png)'>css</div>"]\n  D --> E["<span style='border-image:url(${T}/css-bg2.png) 1'>css2</span>"]`,
    `flowchart TD\n  A["<audio src='${T}/a.mp3'></audio>aud"] --> B["<object data='${T}/o.swf'></object>obj"]\n  B --> C["<embed src='${T}/e.swf'>emb"]\n  C --> D["<link rel=stylesheet href='${T}/l.css'>lnk"]\n  D --> E["<img srcset='${T}/s1.png 1x, ${T}/s2.png 2x' src='${T}/s0.png'>set"]\n  E --> F["<svg><image href='${T}/svgimg.png'/></svg>svgimg"]\n  F --> G["<picture><source srcset='${T}/pic.png'><img src='${T}/pic2.png'></picture>pic"]`,
    `flowchart LR\n  A[x] --> B[y]\n  style B fill:#fff,stroke:#000`,
    `sequenceDiagram\n  participant A as <img src='${T}/seq.png'>Al\n  A->>A: <img src='${T}/seq2.png'> hi`,
    `classDiagram\n  class Animal["<img src='${T}/cls.png'>Animal"]`,
  ];
  test('remote <img>, <video>, <iframe>, CSS url() (+audio/object/embed/link/srcset/svg image/picture/classDef/style) in labels: 0 non-extension requests (request events + route interception), diagram still renders, markdown untouched', async ({ ext }) => {
    const remote = [];
    await ext.ctx.route(/^https?:\/\/(?!chrome-extension)/, (route) => { remote.push(route.request().url()); route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }); });
    const r = await openMM(ext); const p = r.page;
    const doc = '# evil\n\n' + EVIL.map((b) => fence(b)).join('\n\n') + '\n\nafter\n';
    await setMd(p, doc); await rendered(p, EVIL.length, 90000); await p.waitForTimeout(2000);
    const state = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node="mermaid"]')].map((n) => ({ rendered: n.dataset.mdxRendered, svg: n.querySelectorAll('svg').length, err: (n.querySelector('.mdx-error') || {}).textContent?.slice(0, 120), bad: [...n.querySelectorAll('img,video,iframe,audio,source,object,embed,link,picture,image,feImage')].map((e) => e.tagName + ':' + (e.getAttribute('src') || e.getAttribute('href') || e.getAttribute('xlink:href') || '')).filter((s) => !/:(data:image\/(png|gif|jpeg|webp);|)$/.test(s) && !/^[A-Z]+:#/.test(s)), urlCss: [...n.querySelectorAll('*')].filter((e) => /url\(\s*['"]?https?:/i.test(e.getAttribute('style') || '') || (e.tagName.toLowerCase() === 'style' && /url\(\s*['"]?https?:|@import/i.test(e.textContent))).length })));
    const nonExt = r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u));
    console.log('#29 requests non-extension (events):', JSON.stringify(nonExt), '| intercepted:', JSON.stringify(remote), '| per-diagram:', JSON.stringify(state));
    expect(nonExt, 'request events to non-extension origins').toEqual([]);
    expect(remote, 'route-intercepted remote requests').toEqual([]);
    expect(state.length).toBe(EVIL.length);
    state.forEach((s, i) => { expect(s.bad, `diagram ${i} leftover resource elements`).toEqual([]); expect(s.urlCss, `diagram ${i} leftover remote CSS url()`).toBe(0); });
    const errs = state.map((s, i) => [i, s.rendered, s.err]).filter((x) => x[1] !== 'ok');
    console.log('#29 diagrams not rendering ok (report):', JSON.stringify(errs));
    expect(state.filter((s) => s.rendered === 'ok').length, 'all variants render (labels sanitized, not the whole diagram dropped)').toBe(EVIL.length);
    expect(await md(p)).toBe(doc);
    expect(await csp(p)).toEqual([]); expect(r.msgs.filter((m) => /Content Security Policy|Refused to/i.test(m))).toEqual([]);
    await shotTo(p, 'mermaid-sanitized-round2.png');
    // still nothing after a dark-mode re-render and after opening/closing the source
    await p.click('#btn-theme'); await p.waitForTimeout(1500); await rendered(p, EVIL.length, 90000);
    await p.locator(MM).first().locator('[data-mdx-action="toggle-source"]').click(); await p.locator(MM).first().locator('[data-mdx-action="toggle-source"]').click(); await p.waitForTimeout(1500);
    expect(r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u)), 'after theme switch + source toggle').toEqual([]); expect(remote).toEqual([]);
    expect(clean(r).filter((e) => !/chrome-extension:\/\/[a-p]{32}\/editor\/x$/.test(e))).toEqual([]);
  });

  test('legitimate labels still render: <b>/<i>, <br/>, markdown strings, links in strict mode (<a href>, click href), unicode, edge labels; no request to the link targets', async ({ ext }) => {
    const remote = []; await ext.ctx.route(/^https?:\/\/(?!chrome-extension)/, (route) => { remote.push(route.request().url()); route.fulfill({ status: 200, body: '' }); });
    const r = await openMM(ext); const p = r.page;
    const body = 'flowchart LR\n  A["<b>BOLDTXT</b> and <i>ITALTXT</i><br/>SECONDLINE"] -->|"edge <b>lbl</b>"| B["`**MDBOLD** and _MDIT_`"]\n  B --> C["<a href=\'https://example.com/anchor\'>LINKTXT</a>"]\n  C --> D["Ünïcödé 世界 ✓"]\n  click D href "https://example.com/click" _blank';
    const doc = fence(body) + '\n\n' + fence('sequenceDiagram\n  Alice->>Bob: <b>bold msg</b><br/>two') + '\n';
    await setMd(p, doc); await rendered(p, 2); await p.waitForTimeout(800);
    const box = p.locator(MM).first(); const t = await svgText(box);
    const dom = await box.evaluate((n) => ({ b: n.querySelectorAll('svg b, svg strong').length, i: n.querySelectorAll('svg i, svg em').length, br: n.querySelectorAll('svg br').length, a: [...n.querySelectorAll('svg a')].map((a) => a.getAttribute('href') || a.getAttribute('xlink:href')), nodes: n.querySelectorAll('svg .node').length }));
    console.log('#29 legit:', JSON.stringify({ dom, textHas: ['BOLDTXT', 'ITALTXT', 'SECONDLINE', 'MDBOLD', 'MDIT', 'LINKTXT', 'Ünïcödé 世界 ✓', 'lbl'].map((k) => [k, t.includes(k)]) }));
    for (const k of ['BOLDTXT', 'ITALTXT', 'SECONDLINE', 'MDBOLD', 'MDIT', 'LINKTXT', 'Ünïcödé 世界 ✓', 'lbl']) expect(t, k).toContain(k);
    await expect(box).toHaveAttribute('data-mdx-rendered', 'ok'); expect(dom.nodes).toBe(4);
    expect(dom.b, '<b> kept').toBeGreaterThan(0); expect(dom.i, '<i> kept').toBeGreaterThan(0); expect(dom.br, '<br/> kept').toBeGreaterThan(0);
    expect(dom.a.filter((h) => /example\.com/.test(h || '')).length, 'links kept (<a href> or click href)').toBeGreaterThanOrEqual(1);
    await expect(p.locator(MM).nth(1)).toHaveAttribute('data-mdx-rendered', 'ok'); expect(await svgText(p.locator(MM).nth(1))).toContain('bold msg');
    expect(remote).toEqual([]); expect(r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u))).toEqual([]);
    expect(await md(p)).toBe(doc); expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });

  test('earlier diagrams (Jasser flowchart, sequence, pie, class, gantt) still render fully after the sanitizer + in dark mode; 3 clusters, all labels, 0 stray DOM, 0 external requests', async ({ ext }) => {
    const r = await openMM(ext); const p = r.page;
    const doc = FLOW_MD + '\n' + [SEQ, PIE, CLS, GANTT].map((b) => fence(b)).join('\n\n') + '\n\nInline $E=mc^2$ and\n\n' + MATH_BLOCK + '\n';
    await setMd(p, doc); await rendered(p, 7, 90000);
    const check = async (tag) => {
      const t0 = await svgText(p.locator(MM).nth(0));
      expect(FLOW_LABELS.filter((l) => !t0.includes(l)), tag + ' flow labels').toEqual([]);
      expect(await p.locator(MM).nth(0).locator('svg .cluster').count(), tag + ' clusters').toBe(3);
      const want = [['Alice', 'Hello Bob'], ['Dogs', 'Pets adopted'], ['Animal', 'String name'], ['Release plan', 'Design']];
      for (let i = 0; i < 4; i++) { const t = await svgText(p.locator(MM).nth(i + 1)); for (const w of want[i]) expect(t, `${tag} diagram ${i + 1} ${w}`).toContain(w); await expect(p.locator(MM).nth(i + 1)).toHaveAttribute('data-mdx-rendered', 'ok'); }
      await expect(p.locator(MM + ' .mdx-error')).toHaveCount(0); expect(await strayBody(p)).toEqual([]);
    };
    await check('light'); await p.click('#btn-theme'); await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark'); await p.waitForTimeout(800); await rendered(p, 7, 90000); await check('dark');
    await shotTo(p, 'round2-dark-all-diagrams.png');
    expect(r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u))).toEqual([]);
    expect(await md(p)).toBe(doc); expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });
});

// #29 residual (found in round-2 QA, BUGS.md #31): the label/SVG sanitizer does not cover a doc-level %%{init}%% directive with themeCSS.
// mermaid injects that CSS into a <style> in its temporary measuring element inside the live document, so a url() in it is fetched during render.
test('[BUG-31] %%{init: {"themeCSS": "... url(https://remote) ..."}}%% in a mermaid block must not make a remote request (same class as #29)', async ({ ext }) => {
  const T = 'https://tracker.example'; const remote = [];
  await ext.ctx.route(/^https?:\/\/(?!chrome-extension)/, (route) => { remote.push(route.request().url()); route.fulfill({ status: 200, contentType: 'image/png', body: '' }); });
  const r = await openMM(ext); const p = r.page;
  await setMd(p, fence(`%%{init: {"themeCSS": ".node rect { fill: url(${T}/theme-rect.png) } .node { background: url(${T}/theme-bg.png) }"}}%%\nflowchart LR\n  A-->B`) + '\n');
  await rendered(p, 1); await p.waitForTimeout(1500);
  console.log('themeCSS remote requests:', JSON.stringify(remote));
  expect(r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u)), 'request events').toEqual([]);
  expect(remote, 'intercepted').toEqual([]);
});

// =====================================================================================================================
// 12e. #31 verify (round 3): themeCSS / url() config in %%{init}%% directives and YAML front matter
// =====================================================================================================================
test.describe('12e. #31 verify: mermaid init/config themeCSS + url() config never makes a remote request; legit config still works', () => {
  const NONEXT = (r) => r.reqs.filter((u) => !/^(chrome-extension|blob|data):/.test(u));
  const routeAll = async (ext) => { const remote = []; await ext.ctx.route(/^https?:\/\/(?!chrome-extension)/, (route) => { remote.push(route.request().url()); route.fulfill({ status: 200, contentType: 'image/png', body: '' }); }); return remote; };
  const css = (h) => `.node rect { fill: url(https://${h}/rect.png) } .node { background: url(https://${h}/bg.png) } .cluster rect { fill: url(https://${h}/cl.png) }`;
  // name -> diagram text; every host is unique per variant so a leak names the culprit
  const VARIANTS = {
    'repro (#31 original)': (h) => `%%{init: {"themeCSS": ".node rect { fill: url(https://${h}/x.png) } .node { background: url(https://${h}/y.png) }"}}%%\nflowchart LR\n  A-->B`,
    'uppercase key THEMECSS': (h) => `%%{init: {"THEMECSS": "${css(h)}"}}%%\nflowchart LR\n  A-->B`,
    'mixed case key ThemeCss': (h) => `%%{init: {"ThemeCss": "${css(h)}"}}%%\nflowchart LR\n  A-->B`,
    'INIT upper-case directive name': (h) => `%%{INIT: {"themeCSS": "${css(h)}"}}%%\nflowchart LR\n  A-->B`,
    'initialize directive': (h) => `%%{initialize: {"themeCSS": "${css(h)}"}}%%\nflowchart LR\n  A-->B`,
    'config directive': (h) => `%%{config: {"themeCSS": "${css(h)}"}}%%\nflowchart LR\n  A-->B`,
    'single-quoted json': (h) => `%%{init: {'themeCSS': '${css(h)}'}}%%\nflowchart LR\n  A-->B`,
    'multi-line directive': (h) => `%%{\n  init: {\n    "theme": "dark",\n    "themeCSS": "${css(h)}"\n  }\n}%%\nflowchart LR\n  A-->B`,
    'multiple directives': (h) => `%%{init: {"theme":"forest"}}%%\n%%{init: {"themeCSS": ".node rect { fill: url(https://${h}/a.png) }"}}%%\n%%{initialize: {"themeCSS": ".node { background: url(https://${h}/b.png) }"}}%%\nflowchart LR\n  A-->B`,
    'directive after the first line': (h) => `flowchart LR\n  %%{init: {"themeCSS": "${css(h)}"}}%%\n  A-->B`,
    'yaml front matter config: themeCSS (quoted)': (h) => `---\ntitle: T\nconfig:\n  themeCSS: "${css(h)}"\n---\nflowchart LR\n  A-->B`,
    'yaml front matter themeCSS block scalar': (h) => `---\nconfig:\n  themeCSS: |\n    .node rect { fill: url(https://${h}/a.png) }\n    .node { background: url(https://${h}/b.png) }\n---\nflowchart LR\n  A-->B`,
    'yaml front matter quoted key': (h) => `---\nconfig:\n  "themeCSS": '${css(h)}'\n---\nflowchart LR\n  A-->B`,
    'yaml front matter + init directive': (h) => `---\nconfig:\n  themeCSS: "${css(h)}"\n---\n%%{init: {"themeCSS": ".node rect{fill:url(https://${h}/z.png)}"}}%%\nflowchart LR\n  A-->B`,
    'json-escaped key theme\\u0043SS': (h) => `%%{init: {"theme\\u0043SS": "${css(h)}"}}%%\nflowchart LR\n  A-->B`,
    'json unicode-escaped value (u\\u0072l)': (h) => `%%{init: {"themeCSS": ".node rect { fill: u\\u0072l(https://${h}/a.png) } .node { background: \\u0075rl(https://${h}/b.png) }"}}%%\nflowchart LR\n  A-->B`,
    'css-escaped url (\\75 rl)': (h) => `%%{init: {"themeCSS": ".node rect { fill: \\\\75 rl(https://${h}/a.png) } .node { background: \\\\000075rl(https://${h}/b.png) }"}}%%\nflowchart LR\n  A-->B`,
    'themeVariables value url()': (h) => `%%{init: {"themeVariables": {"primaryColor": "url(https://${h}/pc.png)", "fontFamily": "url(https://${h}/ff.woff)"}}}%%\nflowchart LR\n  A-->B`,
    'fontFamily url() top-level': (h) => `%%{init: {"fontFamily": "x; } .node rect { fill: url(https://${h}/ff.png) } .node { background: url(https://${h}/ff2.png) } .z {"}}%%\nflowchart LR\n  A-->B`,
    'flowchart/other config url() + @import': (h) => `%%{init: {"flowchart": {"curve": "url(https://${h}/c.png)"}, "themeVariables": {"lineColor": "@import url(https://${h}/i.css)"}}}%%\nflowchart LR\n  A-->B`,
    'yaml front matter themeVariables/fontFamily url()': (h) => `---\nconfig:\n  fontFamily: "url(https://${h}/f.woff)"\n  themeVariables:\n    primaryColor: "url(https://${h}/p.png)"\n---\nflowchart LR\n  A-->B`,
    'sequence + themeCSS (.actor/.node)': (h) => `%%{init: {"themeCSS": ".actor { fill: url(https://${h}/a.png) } .node rect { fill: url(https://${h}/b.png) } rect { fill: url(https://${h}/c.png) }"}}%%\nsequenceDiagram\n  A->>B: hi`,
    'class + themeCSS': (h) => `%%{init: {"themeCSS": ".node rect { fill: url(https://${h}/a.png) } .classGroup rect { fill: url(https://${h}/b.png) }"}}%%\nclassDiagram\n  class Animal\n  Animal <|-- Dog`,
    'pie + themeCSS': (h) => `%%{init: {"themeCSS": ".pieCircle { fill: url(https://${h}/a.png) } .legend rect { fill: url(https://${h}/b.png) }"}}%%\npie\n  "A" : 1\n  "B" : 2`,
    'gantt + themeCSS': (h) => `%%{init: {"themeCSS": ".task { fill: url(https://${h}/a.png) } rect { fill: url(https://${h}/b.png) }"}}%%\ngantt\n  dateFormat YYYY-MM-DD\n  section S\n  T :a1, 2026-01-01, 3d`,
  };
  const names = Object.keys(VARIANTS);

  test(`themeCSS / url() config variants (${names.length}): 0 non-extension requests (request events + route interception), each still renders (or shows inline error), no leftover remote url() in SVG, markdown byte-identical, also after dark re-render + source toggle`, async ({ ext }) => {
    const remote = await routeAll(ext);
    const r = await openMM(ext); const p = r.page;
    const hosts = names.map((_, i) => `leak31-${i}.example`);
    const doc = '# v\n\n' + names.map((n, i) => fence(VARIANTS[n](hosts[i]))).join('\n\n') + '\n\nafter\n';
    await setMd(p, doc); await rendered(p, names.length, 120000); await p.waitForTimeout(2500);
    const state = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node="mermaid"]')].map((n) => ({ rendered: n.dataset.mdxRendered, svg: n.querySelectorAll('svg').length, err: (n.querySelector('.mdx-error') || {}).textContent?.slice(0, 100), urlCss: [...n.querySelectorAll('*')].filter((e) => /url\(\s*['"]?https?:|@import/i.test(e.getAttribute('style') || '') || (e.tagName.toLowerCase() === 'style' && /url\(\s*['"]?https?:|@import/i.test(e.textContent))).length })));
    const leaks = (list) => [...new Set(list.filter((u) => !/^(chrome-extension|blob|data):/.test(u)).map((u) => { const m = /leak31-(\d+)/.exec(u); return m ? names[+m[1]] : u; }))];
    console.log('#31 variants leaking (events):', JSON.stringify(leaks(r.reqs)), '| (intercepted):', JSON.stringify(leaks(remote)));
    console.log('#31 variants state:', JSON.stringify(state.map((s, i) => [names[i], s.rendered, s.err])));
    expect(leaks(r.reqs), 'variants that leaked (request events)').toEqual([]);
    expect(leaks(remote), 'variants that leaked (route)').toEqual([]);
    expect(state.length).toBe(names.length);
    state.forEach((s, i) => { expect(s.urlCss, `${names[i]}: leftover remote CSS url() in SVG`).toBe(0); expect(['ok', 'error'], `${names[i]} finished`).toContain(s.rendered); });
    const notOk = state.map((s, i) => [names[i], s.rendered]).filter((x) => x[1] !== 'ok');
    expect(notOk, 'every variant still renders a diagram (the directive is neutralised, not the whole diagram dropped)').toEqual([]);
    expect(await md(p), 'markdown source byte-identical').toBe(doc);
    await p.click('#btn-theme'); await p.waitForTimeout(1500); await rendered(p, names.length, 120000); await p.waitForTimeout(1500);
    await p.locator(MM).first().locator('[data-mdx-action="toggle-source"]').click(); await p.locator(MM).first().locator('[data-mdx-action="toggle-source"]').click(); await p.waitForTimeout(1500);
    expect(leaks(r.reqs), 'after dark re-render + source toggle').toEqual([]); expect(leaks(remote)).toEqual([]);
    expect(await md(p)).toBe(doc);
    expect(await csp(p)).toEqual([]); expect(await strayBody(p)).toEqual([]);
    expect(clean(r).filter((e) => !/chrome-extension:\/\/[a-p]{32}\/editor\/x$/.test(e))).toEqual([]);
  });

  test('the original #31 repro (.node rect fill url(https://tracker.example/x.png)), opened as a fresh page load (not via setMarkdown) and via the whole-doc Source view: nothing leaves the extension', async ({ ext }) => {
    const remote = await routeAll(ext);
    const T = 'https://tracker.example';
    const text = fence(`%%{init: {"themeCSS": ".node rect { fill: url(${T}/x.png) } .node { background: url(${T}/y.png) }"}}%%\nflowchart LR\n  A-->B`) + '\n';
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: text, openName: 'repro31.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('repro31.md'); await rendered(p, 1); await p.waitForTimeout(2000);
    await expect(p.locator(MM)).toHaveAttribute('data-mdx-rendered', 'ok');
    expect(await svgText(p.locator(MM))).toContain('A');
    // whole-doc Source view: edit the textarea to add another repro (re-render from source)
    await p.click('.mdx-toolbar [data-cmd="source"]'); const ta = p.locator('textarea.mdx-source'); await ta.fill(text + '\n' + fence(`%%{init: {"themeCSS": ".node rect{fill:url(${T}/z.png)}"}}%%\nflowchart TD\n  C-->D`) + '\n'); await p.click('.mdx-toolbar [data-cmd="source"]');
    await rendered(p, 2); await p.waitForTimeout(2000);
    console.log('#31 repro remote:', JSON.stringify(remote), 'events:', JSON.stringify(NONEXT(r)));
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]);
    expect(await p.locator(MM + '[data-mdx-rendered="ok"]').count()).toBe(2);
    expect(clean(r).filter((e) => !/chrome-extension:\/\/[a-p]{32}\/editor\/x$/.test(e))).toEqual([]);
  });

  // ---- legit directives keep working -------------------------------------------------------------------------------
  const nodeFill = (loc) => loc.evaluate((n) => { const el = n.querySelector('svg .node rect, svg .node polygon, svg .node path'); return el ? getComputedStyle(el).fill : null; });
  const rgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const bright = (c) => (c[0] + c[1] + c[2]) / 3;

  test('legit config still renders and takes effect: init {"theme":"dark"} (dark node fill vs default), {"flowchart":{"curve":"linear"}} (straight edge path), themeVariables colour, YAML front matter title + theme; no requests', async ({ ext }) => {
    const remote = await routeAll(ext);
    const r = await openMM(ext); const p = r.page;
    const bodies = [
      'flowchart LR\n  A[Alpha]-->B[Beta]',                                                                                 // 0 default (baseline)
      '%%{init: {"theme":"dark"}}%%\nflowchart LR\n  A[Alpha]-->B[Beta]',                                                    // 1 dark theme directive
      '%%{init: {"flowchart":{"curve":"linear"}}}%%\nflowchart LR\n  A[Alpha]-->B[Beta]\n  B-->C[Gamma]\n  A-->C',           // 2 linear edges
      '%%{init: {"theme":"base","themeVariables":{"lineColor":"#00ff00"}}}%%\nflowchart LR\n  A[Alpha]-->B[Beta]\n  B-->C[Gamma]\n  A-->C',   // 3 themeVariables lineColor (observable effect on edges)
      '---\ntitle: FrontMatterTitle\nconfig:\n  theme: dark\n---\nflowchart LR\n  A[Alpha]-->B[Beta]',                        // 4 YAML title + theme
      '%%{init: {"theme":"base","themeVariables":{"primaryColor":"#ff0000"}}}%%\nflowchart LR\n  A[Alpha]-->B[Beta]',         // 5 themeVariables colour
      '%%{init: {"theme":"dark"}}%%\n%%{init: {"themeCSS": ".node rect{fill:url(https://leak31-legit.example/a.png)}"}}%%\nflowchart LR\n  A[Alpha]-->B[Beta]', // 6 legit + risky: theme kept, css dropped
      '---\ntitle: FMOnly\n---\nflowchart LR\n  A[Alpha]-->B[Beta]',                                                           // 7 front matter title only
    ];
    const doc = bodies.map((b) => fence(b)).join('\n\n') + '\n';
    await setMd(p, doc); await rendered(p, bodies.length, 90000); await p.waitForTimeout(1500);
    const fills = []; for (let i = 0; i < bodies.length; i++) fills.push(await nodeFill(p.locator(MM).nth(i)));
    const t = []; for (let i = 0; i < bodies.length; i++) t.push(await svgText(p.locator(MM).nth(i)));
    const edgeStroke = (loc) => loc.evaluate((n) => { const e = n.querySelector('svg path.flowchart-link'); return e ? getComputedStyle(e).stroke : null; });
    const s3 = await edgeStroke(p.locator(MM).nth(3));
    console.log('#31 legit fills:', JSON.stringify(fills), '| lineColor edge stroke:', s3);
    for (let i = 0; i < bodies.length; i++) { await expect(p.locator(MM).nth(i), `diagram ${i}`).toHaveAttribute('data-mdx-rendered', 'ok'); expect(t[i], `diagram ${i} labels`).toContain('Alpha'); }
    expect(bright(rgb(fills[0])), 'baseline light node fill is light').toBeGreaterThan(200);
    expect(bright(rgb(fills[1])), '{"theme":"dark"} directive applied (dark node fill)').toBeLessThan(90);
    expect(bright(rgb(fills[4])), 'YAML front matter config.theme dark applied').toBeLessThan(90);
    expect(t[4], 'front matter title shown').toContain('FrontMatterTitle'); expect(t[7], 'front matter title only shown').toContain('FMOnly');
    const red = rgb(fills[5]); expect(red[0] > 200 && red[1] < 80 && red[2] < 80, `themeVariables primaryColor applied, got ${fills[5]}`).toBe(true);
    expect(bright(rgb(fills[6])), 'legit dark theme kept when a risky themeCSS directive sits next to it').toBeLessThan(90);
    expect(rgb(s3), `themeVariables lineColor applied to edges, got ${s3}`).toEqual([0, 255, 0]);
    // NOTE: {"flowchart":{"curve":"linear"}} renders fine but has no visible effect in this mermaid 12.0.0 build (identical edge paths to the default, also with stock mermaid without `secure`), so diagram 2 is only checked for 'renders + labels'
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]);
    expect(await md(p)).toBe(doc); expect(clean(r)).toEqual([]);
    await shotTo(p, 'round3-legit-config.png');
    // dark editor theme: still renders, still no request; explicit "theme":"default" via directive in dark editor is honoured or at least renders
    await p.click('#btn-theme'); await p.waitForTimeout(1200); await rendered(p, bodies.length, 90000);
    for (let i = 0; i < bodies.length; i++) await expect(p.locator(MM).nth(i), `dark ${i}`).toHaveAttribute('data-mdx-rendered', 'ok');
    expect(bright(rgb(await nodeFill(p.locator(MM).nth(1))))).toBeLessThan(90);
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]);
  });

  // ---- markdown source byte-identical --------------------------------------------------------------------------------
  const INIT_DOC = '# Init doc\n\nBefore paragraph.\n\n'
    + fence(`%%{init: {"themeCSS": ".node rect { fill: url(https://leak31-bytes.example/x.png) }", "theme":"dark", "themeVariables": {"fontFamily": "url(https://leak31-bytes.example/f.woff)"}}}%%\nflowchart LR\n  A-->B`) + '\n\n'
    + fence('%%{init: {"theme":"dark"}}%%\nflowchart LR\n  C-->D') + '\n\n'
    + '~~~mermaid\n---\nconfig:\n  themeCSS: ".node rect { fill: url(https://leak31-bytes.example/y.png) }"\n---\nflowchart LR\n  E-->F\n~~~\n\nInline $E=mc^2$ end.\n';
  test('markdown with themeCSS/init directives is byte-identical after unedited open + save: local file (FSA stub: file bytes, isModified) and Drive emulator (0 PATCH, bytes same); 0 requests', async ({ ext }) => {
    const remote = await routeAll(ext);
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: INIT_DOC, openName: 'init31.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('init31.md'); await rendered(p, 4); await settle(p); await p.waitForTimeout(1200);
    expect(await md(p), 'getMarkdown == original').toBe(INIT_DOC);
    expect(await p.evaluate(() => window.__mdwe.editor.isModified())).toBe(false);
    await p.keyboard.press('Control+s'); await p.waitForTimeout(600);
    const w = await p.evaluate(() => ({ writes: window.__fsa.writes.map((x) => x.text), file: window.__fsa.files['init31.md'] }));
    console.log('#31 local save: writes', w.writes.length, 'file identical:', w.file === INIT_DOC);
    if (w.writes.length) expect(w.writes[w.writes.length - 1]).toBe(INIT_DOC);
    expect(w.file ?? INIT_DOC).toBe(INIT_DOC);
    // open + close the risky block's own source editor without changes
    const tog = p.locator(MM).first().locator('[data-mdx-action="toggle-source"]'); await tog.click(); await settle(p);
    expect(await p.locator(MM).first().locator('textarea').first().inputValue(), 'per-block source shows the raw directive untouched').toContain('"themeCSS": ".node rect { fill: url(https://leak31-bytes.example/x.png) }"');
    await tog.click(); await settle(p); await p.waitForTimeout(800);
    expect(await md(p)).toBe(INIT_DOC);
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]); expect(clean(r)).toEqual([]);
    await p.close();

    const d = new FakeDrive([{ id: 'x', name: 'init31.md', text: INIT_DOC }]);
    const rd = await openDriveEditor(ext, { drive: d }); const pd = rd.page;
    await pd.click('#btn-drive-open'); await pd.locator('.gdui-dialog .gdui-row', { hasText: 'init31.md' }).first().click();
    await pd.locator('.gdui-dialog [data-action="open"]').click(); await pd.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await pd.waitForFunction(() => [...document.querySelectorAll('[data-mdx-node]')].every((x) => x.dataset.mdxRendered), null, { timeout: 60000 });
    await settle(pd); await pd.keyboard.press('Control+s'); await pd.waitForTimeout(700);
    console.log('#31 drive: PATCH', d.attempts('PATCH').length, 'bytes same', d.bytes('x').equals(Buffer.from(INIT_DOC, 'utf8')));
    expect(d.attempts('PATCH').length).toBe(0); expect(d.bytes('x').equals(Buffer.from(INIT_DOC, 'utf8'))).toBe(true);
    expect(await md(pd)).toBe(INIT_DOC);
    expect(rd.external.filter((u) => /leak31|tracker\.example/.test(u))).toEqual([]);
  });

  test('editing elsewhere in the doc keeps every init/themeCSS fence byte-for-byte in getMarkdown and in the saved file (local + Drive emulator); still 0 requests', async ({ ext }) => {
    const remote = await routeAll(ext);
    const r = await openMM(ext, { init: fsaStub(), arg: fsaArgs({ openContent: INIT_DOC, openName: 'init31.md' }) }); const p = r.page;
    await p.keyboard.press('Control+o'); await expect(p.locator('#filename')).toHaveText('init31.md'); await rendered(p, 4); await settle(p);
    await focusEnd(p); await p.keyboard.type(' EDITED-31'); await settle(p);
    const out = await md(p);
    const fences = INIT_DOC.match(/(```|~~~)mermaid[\s\S]*?\n\1/g);
    expect(fences.length).toBe(3);
    for (const f of fences) expect(out, 'fence kept byte-for-byte after edit elsewhere').toContain(f);
    expect(out).toContain('EDITED-31');
    await p.keyboard.press('Control+s'); await p.waitForTimeout(600);
    const saved = await p.evaluate(() => window.__fsa.files['init31.md']);
    expect(saved).toBe(out); for (const f of fences) expect(saved).toContain(f);
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]);
    await p.close();

    const d = new FakeDrive([{ id: 'x', name: 'init31.md', text: INIT_DOC }]);
    const rd = await openDriveEditor(ext, { drive: d }); const pd = rd.page;
    await pd.click('#btn-drive-open'); await pd.locator('.gdui-dialog .gdui-row', { hasText: 'init31.md' }).first().click();
    await pd.locator('.gdui-dialog [data-action="open"]').click(); await pd.locator('.gdui-dialog').waitFor({ state: 'detached' });
    await pd.waitForFunction(() => [...document.querySelectorAll('[data-mdx-node]')].every((x) => x.dataset.mdxRendered), null, { timeout: 60000 });
    await focusEnd(pd); await pd.keyboard.type(' EDITED-31'); await settle(pd); await pd.keyboard.press('Control+s'); await pd.waitForTimeout(800);
    const txt = d.bytes('x').toString('utf8');
    console.log('#31 drive after edit: PATCH', d.attempts('PATCH').length);
    expect(d.attempts('PATCH').length).toBe(1); expect(txt).toContain('EDITED-31'); for (const f of fences) expect(txt).toContain(f);
  });

  // ---- malformed directive with risky content -------------------------------------------------------------------------
  test('invalid-JSON / truncated directives with risky content do not crash the editor and do not leak: inline error or a rendered diagram; other diagrams + doc still fine', async ({ ext }) => {
    const remote = await routeAll(ext);
    const r = await openMM(ext); const p = r.page;
    const H = (i) => `leak31-bad${i}.example`;
    const bad = [
      `%%{init: {"themeCSS": ".node rect { fill: url(https://${H(0)}/a.png) }",, }}%%\nflowchart LR\n  A-->B`,                         // stray commas
      `%%{init: {themeCSS: '.node rect { fill: url(https://${H(1)}/a.png) }'}}%%\nflowchart LR\n  A-->B`,                       // unquoted key (JSON5 style)
      `%%{init: {"themeCSS": ".node rect { fill: url(https://${H(2)}/a.png) }"\nflowchart LR\n  A-->B`,                          // unterminated directive
      `%%{init: {"themeCSS": ".node rect { fill: url(https://${H(3)}/a.png) } .node { background: url(https://${H(3)}/b.png) }" "theme": "dark"}}%%\nflowchart LR\n  A-->B`, // missing comma
      `%%{init: this is not json url(https://${H(4)}/a.png) }%%\nflowchart LR\n  A-->B`,
      `---\nconfig: [unclosed\n  themeCSS: ".node rect { fill: url(https://${H(5)}/a.png) }"\n---\nflowchart LR\n  A-->B`,       // broken YAML
      `---\nconfig:\n  themeCSS: ".node rect { fill: url(https://${H(6)}/a.png) }\nflowchart LR\n  A-->B`,                         // unterminated front matter + unterminated string
      `%%{init: {"themeCSS": ".node rect { fill: url(https://${H(7)}/a.png) }"}}%%`,                                             // directive only, no diagram body
    ];
    const doc = '# bad\n\n' + bad.map((b) => fence(b)).join('\n\n') + '\n\n' + fence('flowchart LR\n  OK1-->OK2') + '\n\nend\n';
    await setMd(p, doc); await rendered(p, bad.length + 1, 90000); await p.waitForTimeout(2500);
    const state = await p.evaluate(() => [...document.querySelectorAll('[data-mdx-node="mermaid"]')].map((n) => ({ rendered: n.dataset.mdxRendered, svg: n.querySelectorAll('svg').length, err: (n.querySelector('.mdx-error') || {}).textContent?.slice(0, 90) })));
    console.log('#31 invalid-JSON directives:', JSON.stringify(state.map((s, i) => [i, s.rendered, s.err])));
    expect(NONEXT(r), 'request events').toEqual([]); expect(remote, 'route').toEqual([]);
    state.forEach((s, i) => expect(['ok', 'error'], `bad ${i} finished`).toContain(s.rendered));
    expect(state[state.length - 1].rendered, 'the good diagram after the bad ones still renders').toBe('ok');
    expect(await svgText(p.locator(MM).last())).toContain('OK1');
    expect(await strayBody(p)).toEqual([]);
    expect(await md(p)).toBe(doc);
    expect(clean(r).filter((e) => !/chrome-extension:\/\/[a-p]{32}\/editor\/x$/.test(e)), 'no page errors / console errors').toEqual([]);
    // editor is still usable
    await focusEnd(p); await p.keyboard.type(' typed-after'); await settle(p); expect(await md(p)).toContain('typed-after');
    // a bad directive made valid again in the block source renders and still leaks nothing
    await p.locator(MM).first().locator('[data-mdx-action="toggle-source"]').click();
    await p.locator(MM).first().locator('textarea').first().fill(`%%{init: {"theme":"dark"}}%%\nflowchart LR\n  FIXED-->B`); await settle(p); await p.waitForTimeout(600);
    await p.locator(MM).first().locator('[data-mdx-action="toggle-source"]').click(); await rendered(p, bad.length + 1, 60000);
    expect(await svgText(p.locator(MM).first())).toContain('FIXED');
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]);
  });

  // ---- earlier diagrams unaffected, light + dark --------------------------------------------------------------------------
  test('Jasser flowchart (3 clusters, all labels), sequence, pie, class, gantt still render in light + dark next to a themeCSS-directive diagram; 0 requests; #29 label hostile diagrams still clean', async ({ ext }) => {
    const remote = await routeAll(ext);
    const r = await openMM(ext); const p = r.page;
    const T = 'https://leak31-mix.example';
    const doc = FLOW_MD + '\n' + [SEQ, PIE, CLS, GANTT].map((b) => fence(b)).join('\n\n') + '\n\n'
      + fence(`%%{init: {"themeCSS": ".node rect{fill:url(${T}/a.png)}"}}%%\nflowchart LR\n  X-->Y`) + '\n\n'
      + fence(`flowchart LR\n  A["<img src='${T}/i.png'>img"] --> B["<div style='background:url(${T}/c.png)'>css</div>"]`) + '\n\nInline $E=mc^2$ and\n\n' + MATH_BLOCK + '\n';
    await setMd(p, doc); await rendered(p, 9, 90000);
    const check = async (tag) => {
      const t0 = await svgText(p.locator(MM).nth(0));
      expect(FLOW_LABELS.filter((l) => !t0.includes(l)), tag + ' flow labels').toEqual([]);
      expect(await p.locator(MM).nth(0).locator('svg .cluster').count(), tag + ' clusters').toBe(3);
      const want = [['Alice', 'Hello Bob'], ['Dogs', 'Pets adopted'], ['Animal', 'String name'], ['Release plan', 'Design']];
      for (let i = 0; i < 4; i++) { const t = await svgText(p.locator(MM).nth(i + 1)); for (const w of want[i]) expect(t, `${tag} diagram ${i + 1} ${w}`).toContain(w); await expect(p.locator(MM).nth(i + 1)).toHaveAttribute('data-mdx-rendered', 'ok'); }
      await expect(p.locator(MM).nth(5)).toHaveAttribute('data-mdx-rendered', 'ok'); await expect(p.locator(MM).nth(6)).toHaveAttribute('data-mdx-rendered', 'ok');
      await expect(p.locator(MM + ' .mdx-error')).toHaveCount(0); expect(await strayBody(p)).toEqual([]);
    };
    await check('light'); await p.click('#btn-theme'); await expect(p.locator('html')).toHaveAttribute('data-theme', 'dark'); await p.waitForTimeout(800); await rendered(p, 9, 90000); await check('dark');
    await shotTo(p, 'round3-dark-all-diagrams.png');
    expect(NONEXT(r)).toEqual([]); expect(remote).toEqual([]);
    expect(await md(p)).toBe(doc); expect(await csp(p)).toEqual([]); expect(clean(r)).toEqual([]);
  });
});
