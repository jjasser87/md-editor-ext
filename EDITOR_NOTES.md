# Editor module notes (Editor Dev)

## Stack
TipTap v3 (`@tiptap/core`, `starter-kit`, official `@tiptap/markdown` (marked-based), `extension-table`, `extension-list` (TaskList/TaskItem),
`extension-image`, `extension-placeholder`, `extension-code-block-lowlight` + `lowlight`). Fully bundled; built bundle has no eval/new Function/remote code.
Underline is disabled (no markdown form). Link comes from StarterKit (openOnClick false).

## API — `src/editor/index.js`
```js
import { createEditor } from './editor/index.js';   // also imports ./editor.css (Vite extracts it)
const ed = createEditor(containerEl, { markdown = '', onChange, onWarnings, theme = 'light' });
ed.getMarkdown(); ed.setMarkdown(md); ed.setTheme('light'|'dark'); ed.focus();
ed.isModified(); ed.markSaved(); ed.getWarnings(); ed.setSourceMode(bool); ed.isSourceMode(); ed.destroy(); ed.tiptap /* raw TipTap Editor, for tests */
```
- `onChange(markdown)` is debounced (250 ms) and fires ONLY on user edits (typing, toolbar, source textarea). Not on `setMarkdown`/`setTheme`; `setMarkdown` also cancels a pending onChange.
- `getMarkdown()` is always current (in source mode returns the textarea text verbatim; no debounce).
- **Byte-exact unedited save (2026-09-29):** the editor keeps a baseline `{baseMd, baseDoc}` = the exact text last parsed (initial `markdown`, `setMarkdown`, source->WYSIWYG re-parse, `markSaved`) and the ProseMirror doc it produced. `getMarkdown()` in WYSIWYG mode returns `baseMd` verbatim while `editor.state.doc.eq(baseDoc)`; otherwise it serializes the whole doc (normalized, as before). Undo back to the baseline doc therefore returns the original bytes again. Selection/focus/theme/source-toggle without edits change neither `getMarkdown()` nor fire `onChange`. Loading content is not an undo step (`addToHistory:false`), so Ctrl+Z cannot blank a freshly opened file.
- `isModified()` (additive): `getMarkdown() !== <text of last setMarkdown/markSaved/initial load>`. `markSaved()` (additive): sets that saved-text and the doc baseline to the current `getMarkdown()` output and returns it, so a later unedited `getMarkdown()` is byte-exact w.r.t. what was saved (callers can skip the save when `!isModified()`). Called in source mode it records the textarea text; the doc baseline is set when leaving source mode.
- Source mode: on entering, textarea = `getMarkdown()` (original bytes if unedited). Leaving re-parses only if the text differs; the baseline becomes exactly that source text.
- Source mode: plain textarea; switching back re-parses only if the text was changed. Toolbar is disabled in source mode.
- Theme: `data-theme` on `.mdx-root`; all colors are CSS variables (`--mdx-*`) in `editor.css`.
- Ctrl+K opens the in-page link input (no window.prompt). Image = URL input popover.

## Files
- `src/editor/index.js` API, panes, source toggle, debounce
- `src/editor/markdown-fixes.js` escaping, autolinks, raw HTML/footnote nodes, warnings (see below)
- `src/editor/extensions.js` extension set + serializer fixes + `normalizeMarkdownOutput` (shared with node test)
- `src/editor/toolbar.js`, `src/editor/editor.css`
- `src/editor/demo.html|demo.js|demo.css|vite.demo.config.js` standalone demo (`npx vite --config src/editor/vite.demo.config.js`)
- `src/editor/roundtrip.test.mjs` + `src/editor/fixtures/*.md` — `node src/editor/roundtrip.test.mjs [-v|-p]` (jsdom; exit 1 on failure/unstable). Files named `known-*.md` are reported but not counted.

## Serializer fixes applied on top of @tiptap/markdown
1. Code fence length grows past any backtick run inside the code (upstream breaks docs containing ```).
2. Table cells: literal `|` is written as `\|` (upstream added a phantom column; unstable on 2nd pass).
3. Output post-processing: blank-line runs collapsed, single trailing newline.

## Round-trip fidelity layer (2026-09-29, BUG-8/9/10) — `markdown-fixes.js`
- **Warnings API (add-only):** `ed.getWarnings()` -> `[{code, message}]` for the last loaded doc (`setMarkdown`/initial `markdown`); optional `onWarnings(list)` callback fires on each load. Codes: `reference-links` (`[a][ref]` + `[ref]: url` are inlined), `html-converted` (`<em>/<b>/<strong>/<i>/<s>/<del>/<strike>/<code>` become Markdown marks; extra attributes dropped). Host may show a non-blocking notice; nothing else changed in the API.
- **Text escaping (BUG-9):** `getMarkdown()` uses a custom text serializer (patched onto the `@tiptap/markdown` manager). Leading block markers at the start of a paragraph line are backslash-escaped (`\#`, `\>`, `\-`, `\+`, `\*`, `1\.`, `1\)`, `\---`); trailing `#` in headings escaped; no `&lt;/&gt;` entities (`<` is escaped as `\<` only before a letter, `/`, `!`, `?`); `_` is escaped except intra-word or between spaces; `*`/`~` except between spaces; `` ` `` `[` `]` `\` still escaped; `&` only escaped when it would form `&lt; &gt; &quot; &amp;`. `Snake_case_word and 2 * 3 * 4.` is unchanged.
- **Autolinks:** the Link extension is replaced by `SafeLink` (extends StarterKit Link) with an extra non-rendered `mdAuto` attr (`angle` = `<https://x>`, `bare` = bare URL / www / email). They are written back in the original form as long as the link text equals the URL and has no other marks; otherwise they serialize as `[t](url)`.
- **Raw HTML / footnotes / front matter (BUG-10):** atom nodes `rawBlock` and `rawInline` (attrs `raw`, `kind`) store the source verbatim and serialize byte-for-byte. Block HTML (`<details>`, `<div align=center>…</div>`, multi-line comments, `<script>` text…), `[^1]: def` (with 4-space continuation lines) and leading `---\nkey: v\n---` front matter -> `rawBlock`; inline comments, non-native tags (`<sub> <kbd> <u> <span> <a> <img>`… each open/close tag is its own chip) and `[^1]` refs -> `rawInline`. Rendered as read-only dashed chips/boxes (`.mdx-raw*` in editor.css) whose content is **escaped text** (only `textContent`, never innerHTML); the raw source also sits in a `data-mdx-raw` attribute (inert). No script/iframe/on* can be created. Blank lines inside raw blocks survive `normalizeMarkdownOutput` via private-use sentinels (`\uE000..\uE001`, restored at the end; fence-looking lines get `\uE002`).
- **Tests:** `roundtrip.test.mjs` now (1) compares the ProseMirror JSON of the original vs the re-parsed serialized output for every fixture (STRUCTURE failure), (2) runs ~40 explicit assertions (escapes, verbatim raw HTML/comments/footnotes, no live markup in DOM). Fixtures added: `10-escapes-block.md`, `11-raw-html.md`, `12-footnotes.md`.
- **Task list CSS (BUG-8):** selectors now `.ProseMirror ul[data-type="taskList"] > li` / `> li > label` / `> li > div` / `> li[data-checked="true"] > div`; additionally `TaskItem` is configured with `HTMLAttributes: {'data-type':'taskItem'}` so the old `li[data-type=taskItem]` selector (used by QA probe BUG-8b) also matches. Verified light+dark in headless Chromium (checkbox/text on one line, checked = muted + line-through).

## Known normalizations (first pass, then stable)
- Bullets `*`/`+` -> `-`; setext headings -> ATX; `__b__`->`**b**`, `_i_`->`*i*`; `1)` -> `1.`; `***` hr -> `---`.
- Indented code blocks -> fenced.
- Tables re-padded/aligned; alignment `:---:` preserved. Cell hard breaks -> `<br>`.
- Escapes: only *unneeded* escapes are dropped (`\*`/`\_` in spaces or intra-word become plain `*`/`_`; `\#` mid-line becomes `#`; `\&`, `\<` before a non-tag char, `\\` before a non-punctuation char). Block-start escapes are kept.
- `&copy;`-style entities stay as written; `&amp; &lt; &gt; &quot;` are decoded on load (so `&amp;` -> `&`, `&lt;b&gt;` -> `\<b>`); reference links inlined; `<em>/<b>` -> `*`/`**`.
- Loose lists: blank line between items is lost; a second paragraph inside a list item gets a whitespace-only line.
- Fenced code inside a list item loses the blank line after the item.
- Hard break = two trailing spaces (kept).
- main.js compares `getMarkdown()` with its `savedText`; with the byte-exact baseline an unedited doc equals the original text, so it is not dirty.

## Known issues
- **Whole-file normalization on first edit:** the byte-exact guarantee only holds while the document is unchanged. As soon as the user edits anything, the *entire* file is re-serialized (table padding, setext->ATX, reference links inlined, bullet markers, loose/tight lists, indented->fenced code, etc. — see "Known normalizations"), not just the edited part. Per-block source-range preservation is not implemented.
- Adjacent bullet lists with different markers (`*` then `+`) merge into one list.
- Raw HTML: preserved verbatim but shown as read-only chips (not rendered, not editable in WYSIWYG; edit in Source mode). Markdown *inside* an HTML block that has no blank-line separation (e.g. `<details>` + text on adjacent lines) is part of the raw chip; when blank-line separated, the inner markdown is parsed normally and the open/close tags are separate chips. HTML inside a list item/blockquote is preserved but re-indented with the container's normal prefix only (blank lines inside a blockquote raw block may gain a `>` line). `<em>/<b>/<strong>/<i>/<s>/<del>/<code>` inline HTML is still converted to Markdown marks (warning `html-converted`).
- Footnotes are literal chips (no popup/numbering); a definition must start at column 0 (`[^id]: text`, continuation lines indented 4+ spaces). Reference-style links are inlined (warning `reference-links`).
- `*[^1]*` (emphasis wrapping a footnote ref) drops the emphasis; a footnote def glued directly under a paragraph line gets a blank line between.
- Front matter is preserved as a `Front matter` chip only when the doc starts with `---\nkey:`; other cases (`---` + text) are still hr.
- Escape edge cases: `\` before a non-punctuation char loses its backslash (harmless). Structure-changing text is otherwise covered by the doc-structure test.
- Relative images (`![](img/x.png)`) still fail to load from `chrome-extension://` (BUG-13, not editor-fixable); QA fixture 09 logs a `Failed to load resource` console.error for it that the QA filter (`img/local.png` in message text) cannot match — that test fails on the console-error assertion only.
- Bundle ~1.4 MB (lowlight `common`); could trim languages.
- No table column resize.

## Test results (2026-09-29, after BUG-8/9/10 work)
- roundtrip: 13 docs (4 exact, 8 normalized-but-stable, 0 failed; 1 known issue) + ~40 explicit assertions. Build OK. QA Playwright (qa/, 82 tests): 81 pass / 1 fail — the remaining failure is `fixture 09-escapes.md` on its console-error assertion only (relative image `img/local.png` -> ERR_FILE_NOT_FOUND, BUG-13; QA's filter matches the URL but Chrome's message doesn't contain it). Structure/idempotence/token checks for that fixture pass. All [BUG-8/8b/9/10] probes pass.

## Earlier test results (2026-09-29)
- roundtrip: 10 docs: 2 exact, 7 normalized-but-stable, 0 unstable/failed (+1 documented known issue).
- `npm run build`: OK -> extension/editor. No eval/new Function in bundle.
- Headless Chrome (Playwright) on demo build: setMarkdown/setTheme don't fire onChange; typing does; toolbar bold/table/add-row/image popover work; source toggle round-trips both ways; no console errors.

## Integration (Extension Dev)
None required: `src/page/main.js` already imports `createEditor`; Vite picks up the CSS import. `#editor-host` is a flex child with definite height (fine).

## Test results (byte-exact baseline)
- roundtrip: 13 docs (4 exact, 8 normalized-stable, 0 failed; 1 known issue) + 265 assertions, incl. per fixture through `createEditor` in jsdom: unedited == original bytes (initial, after setMarkdown, after source toggle, source mode text), no onChange on no-ops, edit -> differs and equals normalized serialization + onChange fires + isModified, undo -> original bytes, markSaved, source-edit baseline. (Test registers a tiny node loader hook to stub `.css` imports.)
