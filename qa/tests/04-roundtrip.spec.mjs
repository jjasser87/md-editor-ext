// 4. Round-trip of every fixture through the *built* editor: setMarkdown -> getMarkdown, idempotence + no content loss.
import { test, expect } from '../lib/fixture.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/fixture.mjs';

const dir = path.join(ROOT, 'src/editor/fixtures');
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
// Content tokens: words/numbers only (drops markdown punctuation, table pipes, escapes). Order-preserving.
const tokens = (s) => (s.replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).filter((t) => !/^(?:x|X)$/.test(t) || true);
const canonTbl = (s) => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
const results = [];

for (const f of fixtures) {
  test(`fixture ${f}: idempotent + no content loss`, async ({ editor: { page, errors } }) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const [p1, p2, p3] = await page.evaluate((src) => {
      const e = window.__mdwe.editor; const o = [];
      let cur = src; for (let i = 0; i < 3; i++) { e.setMarkdown(cur); cur = e.getMarkdown(); o.push(cur); } return o;
    }, src);
    // Structural check: doc parsed from the ORIGINAL vs doc parsed from the SERIALIZED output must be identical (catches lost escapes that change meaning).
    const [d0, d1] = await page.evaluate(([a, b]) => { const e = window.__mdwe.editor; e.setMarkdown(a); const x = JSON.stringify(e.tiptap.getJSON()); e.setMarkdown(b); return [x, JSON.stringify(e.tiptap.getJSON())]; }, [src, p1]);
    const structSame = d0 === d1;
    if (!structSame) { const t = (d) => JSON.parse(d).content.map((n) => n.type + (n.attrs && n.attrs.level ? n.attrs.level : '')).join(','); console.log(`${f}: STRUCTURE CHANGED after serialize+reparse\n   orig blocks: ${t(d0)}\n   reparsed:    ${t(d1)}`); }
    const idem = p1 === p2 && p2 === p3;
    const st = { file: f, exact: p1 === src, wsOnly: canonTbl(p1) === canonTbl(src), idem };
    const a = tokens(src), b = tokens(p1);
    const missing = a.filter((t, i) => b[i] !== t);
    st.tokensSame = true;
    { const ms0 = new Map(); for (const t of b) ms0.set(t, (ms0.get(t) || 0) + 1); }
    { const ms = new Map(); for (const t of b) ms.set(t, (ms.get(t) || 0) + 1); st.lost = a.filter((t) => { const c = ms.get(t) || 0; if (c) { ms.set(t, c - 1); return false; } return true; }); st.tokensSame = st.lost.length === 0; }
    results.push(st);
    fs.mkdirSync(path.join(ROOT, 'qa/out'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'qa/out', `roundtrip-${f}`), p1);
    console.log(`${f}: exact=${st.exact} whitespaceOnly=${st.wsOnly} idempotent=${idem} tokensPreserved=${st.tokensSame} structurePreserved=${structSame}${st.lost ? ' LOST=' + JSON.stringify(st.lost) : ''}`);
    if (!st.exact) {
      const A = src.split('\n'), B = p1.split('\n'); let n = 0;
      for (let i = 0; i < Math.max(A.length, B.length) && n < 25; i++) if (A[i] !== B[i]) { console.log(`   L${i + 1}: - ${JSON.stringify(A[i] ?? '')}\n         + ${JSON.stringify(B[i] ?? '')}`); n++; }
    }
    // relative images (img/local.png) legitimately fail to load from chrome-extension:// origin -> see BUGS.md
    expect(errors.filter((e) => !/img\/local\.png|net::ERR_FILE_NOT_FOUND/.test(e))).toEqual([]);
    if (f.startsWith('known-')) { test.info().annotations.push({ type: 'known-issue', description: 'fixture marked known-* by Editor Dev; not asserted' }); return; }
    expect(structSame, 'doc(original) == doc(reparse(serialized))').toBe(true);
    expect(idem, 'idempotent (pass2==pass1==pass3)').toBe(true);
    expect(st.tokensSame, 'content tokens preserved; lost=' + JSON.stringify(st.lost)).toBe(true);
  });
}

test('Editor Dev roundtrip.test.mjs (node/jsdom) runs', () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['src/editor/roundtrip.test.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 90000 }); }
  catch (e) { code = e.status ?? 1; out = (e.stdout || '') + (e.stderr || ''); }
  console.log('roundtrip.test.mjs exit=' + code + '\n' + out);
  expect(code).toBe(0);
});

test('[BUG-9] escaped block-start chars keep their meaning after serialize (\\#, \\-, 1\\., \\+, \\---)', async ({ editor: { page } }) => {
  const cases = ['\\# not heading\n', '\\- not list\n', '\\+ plus\n', '1\\. not list\n', '1\\) paren\n', '\\---\n'];
  const bad = [];
  for (const c of cases) {
    const r = await page.evaluate((c) => { const e = window.__mdwe.editor; e.setMarkdown(c); const a = JSON.stringify(e.tiptap.getJSON()); const o = e.getMarkdown(); e.setMarkdown(o); return { o, same: a === JSON.stringify(e.tiptap.getJSON()) }; }, c);
    if (!r.same) bad.push(`${JSON.stringify(c)} -> ${JSON.stringify(r.o)}`);
  }
  console.log('escape cases that change structure after save+reload:', JSON.stringify(bad, null, 1));
  expect(bad).toEqual([]);
});
