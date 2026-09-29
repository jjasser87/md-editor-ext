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

console.log(`\n${asserts} explicit assertions`);
console.log(`\n${files.length} docs: ${exact} exact, ${normalized} normalized (stable), ${failed} failed/unstable`);
editor.destroy();
process.exit(failed ? 1 : 0);
