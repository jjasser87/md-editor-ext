// Round-trip test: markdown -> TipTap doc -> markdown, in jsdom (no bundler needed).
// Run: node src/editor/roundtrip.test.mjs   (exit code 1 if any doc changes beyond documented normalizations)
import { JSDOM } from 'jsdom';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'MutationObserver',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'Range', 'Text', 'DocumentFragment', 'Selection',
  'KeyboardEvent', 'MouseEvent', 'Event', 'CustomEvent', 'HTMLElement', 'SVGElement', 'NodeFilter', 'XMLSerializer']) {
  if (!(k in globalThis) || k === 'navigator') {
    try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch {}
  }
}
if (!document.createRange) document.createRange = dom.window.document.createRange;
// jsdom lacks layout APIs ProseMirror probes
const emptyRect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
dom.window.Range.prototype.getBoundingClientRect = () => emptyRect;
dom.window.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
dom.window.Element.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });

globalThis.__MDX_NO_MERMAID__ = true; // jsdom cannot lay out SVG; real rendering is covered by the headless Chromium check
const { Editor } = await import('@tiptap/core');
const { getExtensions, normalizeMarkdownOutput } = await import('./extensions.js');

const editor = new Editor({
  element: document.getElementById('root'),
  extensions: getExtensions({ withPlaceholder: false }),
  contentType: 'markdown',
  content: '',
});

const docOf = (md) => { editor.commands.setContent(md, { contentType: 'markdown' }); return JSON.stringify(editor.getJSON()); };
const roundtrip = (md) => {
  editor.commands.setContent(md, { contentType: 'markdown' });
  return normalizeMarkdownOutput(editor.getMarkdown());
};

// Whitespace-insensitive-ish canonical form for comparison of *known* cosmetic normalizations.
const canon = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
let exact = 0, normalized = 0, failed = 0;
const verbose = process.argv.includes('-v');

for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8');
  let out, out2;
  try { out = roundtrip(src); out2 = roundtrip(out); }
  catch (e) { console.log(`ERROR ${f}: ${e.stack}`); failed++; continue; }
  if (process.argv.includes('-p')) console.log(`----- ${f} (pass 1) -----\n${out}----- (pass 2) -----\n${out2}`);
  const idempotent = out === out2;
  // Structure check (BUG-9): the ProseMirror doc of the ORIGINAL must equal the doc re-parsed from the serialized output.
  if (!f.startsWith('known-')) {
    const d0 = docOf(src), d1 = docOf(out);
    if (d0 !== d1) { failed++; console.log(`STRUCTURE   ${f} (doc changed after serialize+reparse)`); showDoc(d0, d1); continue; }
  }
  if (out === src) { exact++; console.log(`EXACT       ${f}`); }
  else if (f.startsWith('known-')) { console.log(`KNOWN-ISSUE ${f} (expected; not counted)`); showDiff(src, out); continue; }
  else if (idempotent && canon(out) === canon(src)) { normalized++; console.log(`WHITESPACE  ${f} (blank-line/trailing-space only)`); }
  else if (idempotent) { normalized++; console.log(`NORMALIZED  ${f} (stable after 1st pass)`); showDiff(src, out); }
  else { failed++; console.log(`UNSTABLE    ${f} (2nd pass differs)`); showDiff(out, out2); }
  if (verbose && out !== src && idempotent) showDiff(src, out);
}

function showDoc(a, b) {
  const t = (d) => JSON.parse(d).content.map((n) => n.type + (n.attrs && n.attrs.level ? n.attrs.level : '')).join(',');
  console.log(`   orig: ${t(a)}\n   new:  ${t(b)}`);
}

function showDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = Math.max(A.length, B.length);
  let shown = 0;
  for (let i = 0; i < n && shown < 40; i++) {
    if (A[i] !== B[i]) { console.log(`   L${i + 1}: - ${JSON.stringify(A[i] ?? '')}\n        + ${JSON.stringify(B[i] ?? '')}`); shown++; }
  }
}

// ---- Explicit assertions -------------------------------------------------------------------------
let asserts = 0;
const check = (name, cond, detail = '') => { asserts++; if (!cond) { failed++; console.log(`ASSERT FAIL ${name} ${detail}`); } };
const rt = (md) => roundtrip(md);
const first = (md) => JSON.parse(docOf(md)).content.map((n) => n.type);

// BUG-9: escaped block-start chars stay literal text (single paragraph) and are re-emitted escaped
for (const c of ['\\# not heading', '\\- x', '\\+ x', '\\* x', '1\\. not a list', '1\\) paren', '\\---', '\\> quote', '\\## h2']) {
  const o = rt(c + '\n');
  check(`escape kept: ${c}`, o === c + '\n', JSON.stringify(o));
  check(`escape structure: ${c}`, first(o).join() === 'paragraph', first(o).join());
}
check('no &gt; entity', !/&gt;|&lt;/.test(rt('\\> quote and a \\<b\\> tag\n')));
check('inert _ and * untouched', rt('Snake_case_word and 2 * 3 * 4.\n') === 'Snake_case_word and 2 * 3 * 4.\n');
check('real emphasis chars still escaped', rt('a \\*b\\* and \\_c\\_ d\n') === 'a \\*b\\* and \\_c\\_ d\n', rt('a \\*b\\* and \\_c\\_ d\n'));
check('autolink <https://x> preserved', rt('<https://x>\n') === '<https://x>\n', rt('<https://x>\n'));
check('bare url preserved', rt('see https://x.org/a_b\n') === 'see https://x.org/a_b\n', rt('see https://x.org/a_b\n'));
check('normal link unaffected', rt('[https://x](https://x)\n') === '[https://x](https://x)\n');

// BUG-10: raw HTML / comments / footnotes verbatim
for (const [name, md] of Object.entries({
  comment: '<!-- keep me -->\n\ntext\n',
  multilineComment: '<!--\n\nfoo\n\n-->\n\ntext\n',
  details: '<details><summary>S</summary>\n\nbody\n\n</details>\n',
  divCenter: '<div align=center>\n<img src="a.png">\n</div>\n',
  sub: 'H<sub>2</sub>O and <kbd>Ctrl</kbd>\n',
  inlineComment: 'a <!-- c --> b\n',
  footnote: 'Foot[^1]\n\n[^1]: the note\n',
  scriptText: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n',
})) {
  const o = rt(md);
  check(`raw verbatim: ${name}`, o === md, JSON.stringify(o));
  check(`raw stable: ${name}`, rt(o) === o);
}
{ // raw HTML must never become live DOM markup
  editor.commands.setContent('<div onclick="x()"><script>window.__x=1</script></div>\n\nH<sub onmouseover=y()>2</sub><iframe src=x></iframe>\n', { contentType: 'markdown' });
  const live = editor.view.dom.querySelectorAll('script, iframe, object, embed, [onclick], [onmouseover], [onerror]');
  check('no live script/iframe/on* in DOM', live.length === 0, editor.view.dom.innerHTML);
  check('raw chips present', !!document.querySelector('.mdx-raw'));
}

// ---- Mermaid + math (nodes, delimiters, false positives) ------------------------------------------------------
{
  const types = (md) => { docOf(md); const t = []; editor.state.doc.descendants((n) => { t.push(n.type.name); }); return t; };
  const has = (md, t) => types(md).includes(t);
  const fx = (f) => readFileSync(join(dir, f), 'utf8');
  check('mermaid fence -> mermaidBlock', has('```mermaid\nflowchart TD\n  A-->B\n```\n', 'mermaidBlock'));
  check('~~~mermaid fence -> mermaidBlock', has('~~~mermaid\ngraph LR\n  A-->B\n~~~\n', 'mermaidBlock'));
  check('mermaid verbatim (code with blank lines, ```` fence)', rt('````mermaid\nflowchart TD\n\n  A-->B\n````\n') === '````mermaid\nflowchart TD\n\n  A-->B\n````\n', rt('````mermaid\nflowchart TD\n\n  A-->B\n````\n'));
  check('mermaid flowchart fixture: 1 node, source intact', (() => { docOf(fx('13-mermaid-flowchart.md')); let c = null; editor.state.doc.descendants((n) => { if (n.type.name === 'mermaidBlock') c = n.attrs.code; }); return c && c.includes('subgraph Data Layer') && c.includes('BBS / UGC / Census 2022') && c.includes('T_E=14, T_I=60') && c.includes('Causal Benchmark & Holdout Scoring') && (c.match(/subgraph /g) || []).length === 3; })());
  check('js/other fences are NOT mermaid', !has('```js\nx\n```\n', 'mermaidBlock') && has('```js\nx\n```\n', 'codeBlock'));
  check('mermaid inside a longer fence is code', !has(fx('20-math-in-code.md'), 'mermaidBlock'));
  check('inline math node', has('a $x^2$ b\n', 'mathInline') && rt('a $x^2$ b\n') === 'a $x^2$ b\n');
  check('$$inline$$ keeps delimiter', rt('a $$x$$ b\n') === 'a $$x$$ b\n' && has('a $$x$$ b\n', 'mathInline'));
  check('block math node', has('$$x^2$$\n', 'mathBlock') && !has('$$x^2$$\n', 'mathInline'));
  check('multiline block math node + exact', has(fx('18-math-multiline.md'), 'mathBlock') && rt(fx('18-math-multiline.md')) === fx('18-math-multiline.md'));
  check('block math interrupts a paragraph', (() => { const t = types('text\n$$\nx\n$$\n'); return t.includes('mathBlock'); })());
  for (const md of ['It costs $5 and $10.\n', 'between $5 and $10 there\n', '$ 5 $\n', 'a $x $ b\n', '20$ and $30\n', 'a $3.50 or $1,000 b\n', 'only $ one\n', '$5\n\n$10\n']) {
    check(`no math false positive: ${JSON.stringify(md)}`, !has(md, 'mathInline') && !has(md, 'mathBlock'), types(md).join());
    check(`dollar text verbatim: ${JSON.stringify(md)}`, rt(md) === md, JSON.stringify(rt(md)));
  }
  check('closing $ followed by digit is not math', !has('$a$1 and $b$\n', 'mathInline') || types('$a$1 and $b$\n').filter((t) => t === 'mathInline').length === 1);
  check('escaped \\$ is literal and verbatim', !has('\\$a\\$ b\n', 'mathInline') && rt('\\$a\\$ b\n') === '\\$a\\$ b\n', rt('\\$a\\$ b\n'));
  check('code span dollars untouched', !has('`$x$` and `$$y$$`\n', 'mathInline') && rt('`$x$` and `$$y$$`\n') === '`$x$` and `$$y$$`\n');
  check('fenced/indented code dollars untouched', (() => { const m = fx('20-math-in-code.md'); const t = types(m); return !t.includes('mathInline') && !t.includes('mathBlock'); })());
  check('$$ x $$ alone on a line is block math, verbatim', has('$$ x $$\n', 'mathBlock') && rt('$$ x $$\n') === '$$ x $$\n');
  check('math needs no newline inside inline', !has('a $x\ny$ b\n', 'mathInline'));
  check('typed text "$a$" survives as text (escaped on save)', (() => {
    editor.commands.setContent('', { contentType: 'markdown' });
    editor.commands.insertContent('cost $a$ and $b$');
    const o = normalizeMarkdownOutput(editor.getMarkdown());
    docOf(o);
    let math = false; editor.state.doc.descendants((n) => { if (n.type.name === 'mathInline') math = true; });
    return o === 'cost \\$a\\$ and \\$b\\$\n' && !math;
  })(), '');
  check('insert commands serialize with original delimiters', (() => {
    editor.commands.setContent('', { contentType: 'markdown' });
    editor.commands.insertMermaid(); editor.commands.insertMathBlock(); 
    const o = normalizeMarkdownOutput(editor.getMarkdown());
    return /^```mermaid\nflowchart LR\n[\s\S]*\n```\n\n\$\$E = mc\^2\$\$\n$/.test(o);
  })());
  check('mermaid empty code serializes as valid fence', (() => { editor.commands.setContent({ type: 'doc', content: [{ type: 'mermaidBlock', attrs: { code: '' } }] }); return normalizeMarkdownOutput(editor.getMarkdown()) === '```mermaid\n```\n'; })());
  check('mermaid code containing ``` grows the fence', (() => { editor.commands.setContent({ type: 'doc', content: [{ type: 'mermaidBlock', attrs: { code: 'a\n```\nb' } }] }); return normalizeMarkdownOutput(editor.getMarkdown()) === '````mermaid\na\n```\nb\n````\n'; })());
  const { looksLikeMermaid, sanitizeInlineMath, sanitizeBlockMath } = await import('./math-syntax.js');
  check('paste detection: flowchart/sequence/graph', looksLikeMermaid('flowchart TD\n  A-->B') && looksLikeMermaid('sequenceDiagram\n  A->>B: hi') && looksLikeMermaid('graph LR\nA-->B') && looksLikeMermaid('%% c\nerDiagram\nA ||--o{ B : x'));
  check('paste detection: not prose / not single-line collapsed', !looksLikeMermaid('graph theory is fun\nreally') && !looksLikeMermaid('flowchart TD A --> B --> C') && !looksLikeMermaid('hello\nworld'));
  check('sanitizeInlineMath', sanitizeInlineMath(' a $ b\nc \\') === 'a \\$ b c' && sanitizeBlockMath('a$$b') === 'a$\\$b');
}

// ---- Byte-exact unedited save (createEditor baseline: getMarkdown() === loaded text while doc unchanged) ----------
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(
  "export async function load(url, ctx, next){ if (url.endsWith('.css')) return { format:'module', source:'export default \"\"', shortCircuit:true }; return next(url, ctx); }"));
const { createEditor } = await import('./index.js');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
{
  let bx = 0, editedCount = 0;
  for (const f of files) {
    const orig = readFileSync(join(dir, f), 'utf8');
    const host = document.createElement('div'); document.body.appendChild(host);
    let changes = 0;
    const ed = createEditor(host, { markdown: orig, onChange: () => changes++ });
    check(`byte-exact unedited (initial): ${f}`, ed.getMarkdown() === orig);
    check(`isModified false after load: ${f}`, ed.isModified() === false);
    // no-op interactions: selection, focus, source toggle both ways, theme
    ed.tiptap.commands.selectAll(); ed.tiptap.commands.focus('start'); ed.setTheme('dark'); ed.focus();
    ed.setSourceMode(true);
    check(`source mode returns text verbatim: ${f}`, ed.getMarkdown() === orig);
    ed.setSourceMode(false);
    check(`byte-exact after source toggle w/o edits: ${f}`, ed.getMarkdown() === orig);
    await tick(320);
    check(`no onChange on no-ops: ${f}`, changes === 0, String(changes));
    // setMarkdown resets the baseline
    ed.setMarkdown('# other\n'); ed.setMarkdown(orig);
    check(`byte-exact after setMarkdown: ${f}`, ed.getMarkdown() === orig);
    // edit: append a word to the last text position -> differs, equals normalized serialization, fires onChange
    const norm = normalizeMarkdownOutput(ed.tiptap.getMarkdown());
    ed.tiptap.commands.setTextSelection(1);
    ed.tiptap.commands.insertContent('X');
    const edited = ed.getMarkdown();
    check(`edited differs from original: ${f}`, edited !== orig);
    check(`edited == normalized serialization: ${f}`, edited === normalizeMarkdownOutput(ed.tiptap.getMarkdown()));
    check(`isModified true after edit: ${f}`, ed.isModified() === true);
    await tick(320);
    check(`onChange fired on edit: ${f}`, changes === 1, String(changes));
    // undo back to the original doc -> original bytes again
    ed.tiptap.commands.undo();
    check(`undo -> original bytes: ${f}`, ed.getMarkdown() === orig, JSON.stringify(ed.getMarkdown().slice(0, 60)));
    check(`undo -> isModified false: ${f}`, ed.isModified() === false);
    // edit again, markSaved: baseline moves to serialized output; further unedited reads are stable and not modified
    ed.tiptap.commands.insertContent('Y');
    const saved = ed.markSaved();
    check(`markSaved returns current output: ${f}`, saved === ed.getMarkdown());
    check(`isModified false after markSaved: ${f}`, ed.isModified() === false);
    ed.setSourceMode(true); ed.setSourceMode(false);
    check(`stable after markSaved+source toggle: ${f}`, ed.getMarkdown() === saved);
    if (ed.getMarkdown() === orig) bx++; else editedCount++;
    // source-mode edit: baseline becomes the exact source text
    ed.setSourceMode(true);
    const srcEl = host.querySelector('textarea.mdx-source');
    const custom = '* a\n*  b\n\nSetext\n======\n';
    srcEl.value = custom; srcEl.dispatchEvent(new dom.window.Event('input'));
    check(`source edit: isModified true: ${f}`, ed.isModified() === true);
    ed.setSourceMode(false);
    check(`source edit -> WYSIWYG unedited returns source text verbatim: ${f}`, ed.getMarkdown() === custom, JSON.stringify(ed.getMarkdown()));
    ed.destroy(); host.remove();
  }
  // ---- BUG-28: unedited CRLF file survives the whole-document Source toggle byte-for-byte ----
  {
    const crlf = '# T\r\n\r\ntext a\r\ntext b\r\n\r\n```mermaid\r\nflowchart LR\r\n  A --> B\r\n```\r\n\r\n$$x$$\r\n';
    const h = document.createElement('div'); document.body.appendChild(h);
    const e = createEditor(h, { markdown: crlf });
    check('#28 CRLF: exact initially, not modified', e.getMarkdown() === crlf && !e.isModified());
    e.setSourceMode(true);
    check('#28 CRLF: source view returns original CRLF text, textarea itself has no CR, not modified', e.getMarkdown() === crlf && !h.querySelector('textarea.mdx-source').value.includes('\r') && !e.isModified());
    e.setSourceMode(false);
    check('#28 CRLF: back from source w/o edits -> exact + not modified', e.getMarkdown() === crlf && !e.isModified());
    e.setSourceMode(true);
    const t = h.querySelector('textarea.mdx-source'); t.value += 'z\n'; t.dispatchEvent(new dom.window.Event('input'));
    check('#28 CRLF: edited in source -> modified, textarea text (LF) is what is returned', e.isModified() && e.getMarkdown().endsWith('$$x$$\nz\n'));
    e.setSourceMode(false);
    e.setMarkdown(crlf); e.setSourceMode(true); e.setMarkdown('a\r\nb\r\n');
    check('#28 setMarkdown while in source mode keeps exact text', e.getMarkdown() === 'a\r\nb\r\n');
    e.destroy(); h.remove();
  }
  // ---- BUG-26 (jsdom): Ctrl/Cmd+S/O bubble out of per-block fields after flushing the edit; native chords / plain keys stay inside ----
  {
    const h = document.createElement('div'); document.body.appendChild(h);
    const e = createEditor(h, { markdown: '```mermaid\nflowchart LR\n  A --> B\n```\n\nx $a$ y\n\n$$b$$\n' });
    await tick(20);
    const seen = [];
    const onDoc = (ev) => seen.push({ key: ev.key, md: e.getMarkdown(), prevented: ev.defaultPrevented });
    document.addEventListener('keydown', onDoc);
    const kd = (el, init) => { const ev = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(ev); return ev; };
    for (const [sel, marker] of [['textarea.mdx-mermaid-source', 'ZZ26A'], ['div[data-mdx-node="math-block"] textarea.mdx-math-source', 'ZZ26B'], ['span[data-mdx-node="math-inline"] input.mdx-math-source', 'ZZ26C']]) {
      const root = sel.split(' ')[0].startsWith('textarea') ? h : h.querySelector(sel.split(' ')[0]);
      const tgl = (sel.startsWith('textarea') ? h.querySelector('[data-mdx-node="mermaid"]') : root).querySelector('[data-mdx-action="toggle-source"]');
      tgl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      const f = h.querySelector(sel.replace(/^\S+ /, (m) => (sel.startsWith('textarea') ? m : m)));
      f.value = (f.value || '') + marker; f.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      seen.length = 0;
      const ev = kd(f, { key: 's', ctrlKey: true });
      check(`#26 ${sel}: Ctrl+S reaches document`, seen.length === 1 && !ev.defaultPrevented);
      check(`#26 ${sel}: pending edit already in getMarkdown() when the document handler runs`, seen.length === 1 && seen[0].md.includes(marker), JSON.stringify(seen[0] && seen[0].md));
      seen.length = 0; kd(f, { key: 'O', metaKey: true });
      check(`#26 ${sel}: Cmd+O reaches document`, seen.length === 1);
      seen.length = 0; kd(f, { key: 'S', ctrlKey: true, shiftKey: true });
      check(`#26 ${sel}: Ctrl+Shift+S reaches document`, seen.length === 1);
      seen.length = 0; for (const k of ['a', 'z', 'y', 'c', 'v', 'x']) kd(f, { key: k, ctrlKey: true }); kd(f, { key: 'q' });
      check(`#26 ${sel}: native editing chords + plain keys stay in the field`, seen.length === 0, JSON.stringify(seen.map((x) => x.key)));
      tgl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    document.removeEventListener('keydown', onDoc);
    e.destroy(); h.remove();
  }
  // ---- BUG-27 (jsdom + real KaTeX): unknown commands / bad LaTeX -> .mdx-error[math] with the raw source; valid math unaffected ----
  {
    const { renderMath } = await import('./renderers.js');
    for (const [tex, disp] of [['\\undefinedcmd', false], ['\\undefinedcmd{x}', true], ['\\frac{1', false], ['\\begin{aligned} a &= ', true], ['\\left( x', false], ['\\href{https://x.y}{z}', false], ['x^', true]]) {
      const box = document.createElement('div'); const r = await renderMath(box, tex, disp);
      const er = box.querySelectorAll('.mdx-error[data-mdx-error="math"]');
      check(`#27 error flagged (${disp ? 'block' : 'inline'}): ${tex}`, r.ok === false && er.length === 1 && !box.querySelector('.katex') && box.querySelector('.mdx-error-src').textContent === tex, JSON.stringify(box.innerHTML.slice(0, 200)));
    }
    for (const [tex, disp] of [['\\frac{a}{b}', false], ['\\sum_{i=0}^{n} i^2', true], ['\\int_0^1 x\\,dx', false], ['\\alpha+\\beta', false], ['\\mathbb{R}^n', false],
      ['\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', true], ['\\text{hello wörld ü}', false], ['\\sqrt[3]{x}', false], ['\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}', true], ['\\mathcal{A}\\cdot\\vec v', false], ['\\ce{x}'.replace('\\ce{x}', 'x')]]) {
      const box = document.createElement('div'); const r = await renderMath(box, tex, disp);
      check(`#27 valid math renders: ${tex}`, r.ok === true && box.querySelectorAll('.katex').length === 1 && box.querySelector('.mdx-error') === null, JSON.stringify(box.innerHTML.slice(0, 120)));
    }
  }
  // ---- BUG-29 (jsdom): SVG sanitizer strips every resource-loading construct before insertion ----
  {
    const { sanitizeSvgString } = await import('./renderers.js');
    const dirty = '<svg id="s"><style>@import url(https://e.x/a.css); .a{background:url(https://e.x/b.png)} .b{fill:url(#grad)}</style><defs><linearGradient id="grad"/></defs>'
      + '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="https://e.x/i.png"> keep <img src="data:image/png;base64,AAAA" alt="ok"><video src="https://e.x/v.mp4" poster="https://e.x/p.png"></video>'
      + '<iframe src="https://e.x/f"></iframe><div style="background:url(https://e.x/c.png);color:red">t</div><a href="https://e.x/link">l</a></div></foreignObject>'
      + '<image href="https://e.x/svgimg.png"/><image xlink:href="https://e.x/svgimg2.png"/><use href="https://e.x/sprite.svg#a"/><use href="#grad"/><path marker-end="url(#m)" d="M0 0"/></svg>';
    const out = sanitizeSvgString(dirty);
    check('#29 no remote URL survives the sanitizer except <a href>', !/e\.x\/(i|v|p|f|c|a|b|svgimg2?|sprite)/.test(out) && out.includes('https://e.x/link'), out);
    check('#29 img/video/iframe/image elements removed; data: img kept; text kept', !/<(video|iframe|image)\b/i.test(out) && (out.match(/<img\b/g) || []).length === 1 && out.includes('data:image/png') && out.includes('keep'), out);
    check('#29 fragment refs (gradient, marker, <use href="#x">) kept, css url(#) kept', out.includes('url(#grad)') && out.includes('href="#grad"') && out.includes('url(#m)') && !out.includes('sprite.svg'), out);
  }

  // ---- BUG-31 (jsdom): sanitizeMermaidSource strips themeCSS / url() config, keeps legit directives ----
  {
    const { sanitizeMermaidSource: sm } = await import('./renderers.js');
    const body = 'flowchart LR\n A-->B';
    const risky = ['%%{init: {"themeCSS": ".node{fill:url(https://e.x/a.png)}"}}%%\n' + body, '%%{initialize: {"themeCSS": "x"}}%%\n' + body, '%%{\n init: {\n "themeCSS": "a"\n }\n}%%\n' + body,
      '%%{config: {"themeCSS": "a"}}%%\n' + body, '%%{INIT: {"THEMECSS": "a"}}%%\n' + body, '%%{init: {"themeVariables": {"primaryColor": "url(https://e.x/a)"}}}%%\n' + body,
      '%%{init: {"fontFamily": "url(https://e.x/a)"}}%%\n' + body, '---\nconfig:\n  themeCSS: "a { b: url(https://e.x/a) }"\n---\n' + body, '---\nconfig:\n  themeCSS: |\n    a{b:url(https://e.x/a)}\n  theme: dark\n---\n' + body,
      '%%{init: {"theme\\u0043SS": "a"}}%%\n' + body, '%%{init: {bad json url(https://e.x/a)}}%%\n' + body];
    for (const r of risky) { const o = sm(r); check(`#31 sanitizeMermaidSource strips: ${JSON.stringify(r).slice(0, 60)}`, !/themeCSS|theme\\u0043|url\(|THEMECSS/i.test(o) && o.includes(body), JSON.stringify(o)); }
    const keep = ['%%{init: {"theme":"dark"}}%%\n' + body, '%%{init: {"themeVariables": {"primaryColor": "#ff0000"}, "flowchart": {"curve":"basis"}}}%%\n' + body, '---\ntitle: T\nconfig:\n  theme: forest\n---\n' + body, body, '%%{wrap}%%\n' + body];
    for (const k of keep) check(`#31 sanitizeMermaidSource keeps legit config byte-for-byte: ${JSON.stringify(k).slice(0, 50)}`, sm(k) === k, JSON.stringify(sm(k)));
    check('#31 mixed directive keeps theme, drops themeCSS', (() => { const o = sm('%%{init: {"theme":"dark","themeCSS":"a"}}%%\n' + body); return o.includes('"theme":"dark"') && !/themeCSS/.test(o); })());
    check('#31 yaml block scalar: theme after themeCSS kept', (() => { const o = sm('---\nconfig:\n  themeCSS: |\n    a{}\n  theme: dark\n---\n' + body); return o.includes('theme: dark') && !/themeCSS|a\{\}/.test(o); })());
  }

  // API misc
  const host = document.createElement('div'); document.body.appendChild(host);
  const ed = createEditor(host, { markdown: '' });
  check('empty doc round-trips as empty', ed.getMarkdown() === '' && !ed.isModified());
  ed.setMarkdown('a  \nb\n===\n\n* x\n'); check('setMarkdown verbatim', ed.getMarkdown() === 'a  \nb\n===\n\n* x\n');
  ed.destroy(); host.remove();
  console.log(`\nbyte-exact unedited check ran on ${files.length} fixtures`);
}

console.log(`\n${asserts} explicit assertions`);
console.log(`\n${files.length} docs: ${exact} exact, ${normalized} normalized (stable), ${failed} failed/unstable`);
editor.destroy();
process.exit(failed ? 1 : 0);
