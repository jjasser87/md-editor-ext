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

---

# Mermaid + math (2026-09-29, Editor Dev)

## Nodes (files: `src/editor/mermaid-math.js`, `math-syntax.js`, `renderers.js`)
| node | kind | attrs | markdown |
|---|---|---|---|
| `mermaidBlock` | block atom | `code`, `fence` (`` ``` `` / `~~~` / longer), `info` (`mermaid`) | fenced block, info string `mermaid` (case-insensitive on parse), source verbatim, original fence kept (fence grows past any backtick run inside the code) |
| `mathInline` | inline atom | `src`, `delim` (`$` or `$$`) | `$src$` / `$$src$$` written inside a paragraph |
| `mathBlock` | block atom | `src` (verbatim, incl. newlines) | `$$` + src + `$$` — `$$E=mc^2$$`, `$$ x $$` and multi-line `$$\n...\n$$` round-trip byte-for-byte (blank lines inside survive via the raw sentinels) |

Fenced mermaid arrives as a marked `code` token; `SafeCodeBlock.parseMarkdown` (extensions.js) routes `lang=mermaid` fences to `mermaidBlock`; every other fence stays `codeBlock`. Unedited docs stay byte-identical via the existing baseline mechanism; after an edit the normal serialization emits the same fences / delimiters.

## Behaviour
- **Mermaid** (lazy `import('mermaid')` -> separate chunk; nothing loads until a diagram exists): before every render `initialize({startOnLoad:false, securityLevel:'strict', theme: dark?'dark':'default', suppressErrorRendering:true, logLevel:'fatal'})`, then `mermaid.parse()`, then `render()`. Renders are serialized (mermaid is not re-entrant) and cached per (theme, code). Temp nodes mermaid appends to `<body>` are removed in `finally` (verified: no stray body children). `setTheme()` re-renders all diagrams.
- **Invalid syntax** (including the single-line-collapsed paste `flowchart TD A --> B --> C`, which Mermaid cannot parse) -> `.mdx-error[data-mdx-error="mermaid"]` inside the node ("Mermaid syntax error: …"); the node keeps its source; nothing is thrown and no error DOM appears elsewhere. Fix it with the per-block source toggle.
- **Per-block source editing:** `[data-mdx-action="toggle-source"]` ("Edit source"/"Done") opens `textarea.mdx-mermaid-source`. Commit: debounced 350 ms, on toggle-close, Ctrl/Cmd+Enter, and before any `getMarkdown()`/`isModified()` (flushEdits). Esc reverts + closes. Enter on a selected node opens it.
- **Math:** KaTeX `output:'htmlAndMathml'`, `throwOnError:true` (caught), `strict:'ignore'`, untrusted commands (\href, \url, \includegraphics…) reported as errors. See 'Fixes round 2' for the error display. Inline: click -> `input.mdx-math-source`; Enter/blur commits, Esc reverts, empty removes the node. Block: toggle -> `textarea.mdx-math-source`. Math inherits the text colour (nothing to do for dark mode).
- **Delimiter rule (pandoc-like):** opening `$` not followed by whitespace/`$`; closing `$` not preceded by whitespace and not followed by a digit; no newline or backtick inside inline math; `\$` is a literal dollar; code spans and fenced/indented code are never scanned. `$5 and $10`, `$ 5 $`, `20$ and $30`, `$3.50` stay text. Block math: `$$` at line start (<= 3 spaces) up to the first `$$` that ends a line; it can interrupt a paragraph.
- **Serializer safety:** a literal `$` in ordinary text that would parse as math on reload (e.g. text typed as `$a$`) is written as `\$`. Typing `$x$` converts to an inline math node (input rule).
- **Toolbar:** `Diagram` (`[data-cmd="diagram"]`, inserts a sample `flowchart LR` and opens its source), `∑ Math` (`[data-cmd="mathInline"]`; uses selected text or `x^2`; opens the inline input), `∑ Block` (`[data-cmd="mathBlock"]`, `$$E = mc^2$$`). `title` + `aria-label` set; disabled in source mode. Commands: `insertMermaid(code?)`, `insertMathInline(src?)`, `insertMathBlock(src?)`.
- **Paste:** a plain-text clipboard whose first line (after optional `%%` lines) is a Mermaid header (`flowchart|graph TD/LR/…`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `erDiagram`, `gantt`, `pie`, `gitGraph`, `mindmap`, `timeline`, …) **and that has more than one line** is wrapped into a mermaid block automatically. Shift+paste and pasting inside code blocks skip this. A single-line/collapsed paste is NOT wrapped (Mermaid needs line breaks) — it is pasted as plain text.

## Test hooks (stable)
Mermaid: `[data-mdx-node="mermaid"]` > `.mdx-mermaid-render` (svg), `[data-mdx-action="toggle-source"]`, `textarea.mdx-mermaid-source`, `.mdx-error[data-mdx-error="mermaid"]`. Inline math: `span[data-mdx-node="math-inline"]` > `.mdx-math-render .katex`, toggle (shown on hover/edit), `input.mdx-math-source`. Block math: `div[data-mdx-node="math-block"]` > `.mdx-math-render .katex`, toggle, `textarea.mdx-math-source`. Math errors: `.mdx-error[data-mdx-error="math"]`. State: `data-mdx-rendered="ok|error"`; class `mdx-editing` while source is open. Note for Playwright: `locator.click()` on `.mdx-math-render` can fail actionability (KaTeX's hidden MathML layer) — use `page.mouse.click` at its bounding-box centre or click `[data-mdx-action=toggle-source]`/press Enter with the node selected.

## Tests
- `node src/editor/roundtrip.test.mjs` — fixtures 13–20 (+ `known-math-in-emphasis.md`) and ~60 new assertions (sets `globalThis.__MDX_NO_MERMAID__` so jsdom does not try SVG layout).
- `node src/editor/headless.check.mjs` (run `npm run build` first; uses Playwright from qa/node_modules, writes nothing into qa/): real Chromium + built extension — SVG, 3 subgraphs, labels with `/ = , &`, invalid -> inline error, `.katex`, dollar prices, fonts served from the extension, no request outside `chrome-extension://`, no CSP violations/console errors, dark re-render, source toggle/edit/re-render, toolbar inserts, bare-paste wrap.

## CSP
Manifest CSP is `script-src 'self'; object-src 'self'` — no `style-src`, so inline styles (Mermaid's `<style>` + `style=""` in SVG, KaTeX inline styles) are allowed; nothing has to be loosened; 0 `securitypolicyviolation` events. If a `style-src` is ever added it needs `'unsafe-inline'` (or style hashes are impossible: Mermaid generates them dynamically). No `unsafe-eval` needed. KaTeX CSS references fonts as `url(./KaTeX_*.woff2)` (relative, emitted into `extension/editor/assets/`); no `web_accessible_resources` needed for extension pages.

## Limitations
- Math inside emphasis/strong/links splits the marks around the node (`**bold $x$ text**` -> `**bold** $x$ **text**`), see `known-math-in-emphasis.md`. Math nodes are atoms (no marks inside).
- `$$a$$ text` on one line is a paragraph with inline `$$a$$`; block math needs `$$…$$` to end its line.
- Math source cannot contain a bare `$$` (block) or a newline (inline); editing sanitises to `$\$` / spaces.
- Mermaid output depends on the browser's SVG/`foreignObject` support; jsdom cannot render diagrams (tests stub it). Large diagrams re-render on each debounced commit.
- Bundle: `mermaid` adds ~120 lazy chunks (~11 MB unminified in `extension/editor/assets`, incl. `elk` 3.1 MB, `cynefin` 1.3 MB, `mermaid.core` 1.2 MB, `cytoscape` 0.96 MB, `katex` 0.48 MB + fonts); main `index-*.js` grew only ~0.0 MB (1.52 MB, unchanged) and is the only chunk loaded at startup.

## Fixes round 2 (BUG-26/27/28/29, 2026-09-29)
- **#26 Ctrl/Cmd+S / O in per-block source fields** (`mermaid-math.js` `makeView` keydown): any Ctrl/Cmd chord (no Alt) that is not one of the field's native editing keys (`z y a c v x`, arrows, home/end, backspace/delete, enter, space) now `commit()`s the pending edit synchronously and then propagates untouched (no `preventDefault`, no `stopPropagation`), so `src/page/main.js`'s document handler runs and its `getMarkdown()` already contains the text just typed (`getMarkdown` also `flushEdits`). Plain keys, Esc, Enter, Ctrl+Enter and native chords still stay in the field. The editor's own Ctrl+K handler ignores events from inside node views.
- **#27 math errors** (`renderers.js` `renderMath`): `throwOnError:true` inside try/catch (`strict:'ignore'`; `trust` is a callback that records and refuses `\href/\url/\includegraphics/\html*` so those are errors too instead of silent red text). On error the container holds `.mdx-error[data-mdx-error="math"]` (span inline / div block; `title` = message) with `Math error: <msg>` + `<code class="mdx-error-src">` showing the raw source; `data-mdx-rendered="error"` + `mdx-has-error` (same as mermaid). The node's source stays editable via the normal toggle; markdown is untouched. Valid math (frac, sum, int, greek, `\mathbb`, aligned, pmatrix, `\text` with unicode, …) covered by tests.
- **#29 mermaid remote fetches** (`renderers.js`): htmlLabels stay ON (turning them off breaks the labels/layout). Two layers: (1) `dompurify` (the same module instance mermaid uses, imported lazily beside mermaid) gets an `afterSanitizeAttributes` hook that drops every resource-loading attribute (`src srcset href xlink:href poster data background action …`) unless it is `#fragment` or `data:image/(png|gif|jpeg|webp);` (`<a href>` is kept: clicking is user-initiated); this runs *before* mermaid builds label DOM in its temporary measuring div under `<body>`, which is where the fetch used to happen. (2) `sanitizeSvgString()` parses the finished SVG into a detached `DOMParser` document, removes `iframe/video/audio/source/object/embed/link/script/picture/feImage` and any `<img>/<image>` that is not an inline data image, neutralises `@import` and `url(...)` (non-fragment, non-data) in `<style>` and `style=""`, and only then is the string cached and inserted. The markdown source is never modified. Headless test: zero requests to non-extension origins (request events AND `page.route` interception) for a diagram with `<img>`, `<video poster/src>`, `<iframe>`, and CSS `url()` labels; fixture 13 still renders 3 clusters and all labels.
- **#28 CRLF via whole-document Source toggle** (`index.js`): the Source `<textarea>` cannot hold CR, so the editor remembers the exact text it displayed (`srcExact`) plus the textarea-normalised form (`srcNorm`). While the textarea still equals `srcNorm`, `getMarkdown()`/leaving source mode use `srcExact` (original CRLF bytes, `isModified()` stays false, no re-parse). Any edit in the textarea falls back to the textarea text (LF) as before. `setMarkdown` in source mode refreshes both.
- **Tests added:** `roundtrip.test.mjs` (jsdom): #28 CRLF toggle, #26 key propagation for all three field types (+ flush check, native chords stay local), #27 error/valid render via real KaTeX, #29 `sanitizeSvgString` unit checks. `headless.check.mjs` (real Chromium): #26 (Ctrl+S/O/Shift+S/Cmd+O reach `document`, markdown seen there already has the edit), #27 (5 bad + 11 valid cases inline/block), #29 (request events + `page.route`, fixture-13 still fine), #28 (CRLF). Results: roundtrip 22 docs / 0 failed / 499 assertions; headless 80/80 (was 50).

## Bug #31 — mermaid `themeCSS` / url() config leak (2026-09-29) — `renderers.js`
- Cause: `%%{init: {"themeCSS": ".node rect{fill:url(https://…)}"}}%%` (or YAML front matter `config: themeCSS:`) makes mermaid put a `<style>` in its temporary measuring element in the LIVE document; Chromium fetches `url()` for matching nodes during render (before the DOMPurify hook / `sanitizeSvgString` can see it).
- Fix, two independent layers (each alone was verified to give 0 requests; both kept): (1) `mermaid.initialize({ secure: MERMAID_SECURE_KEYS })` = mermaid's default secure list + `themeCSS`, so mermaid itself deletes `themeCSS` from any diagram directive / front-matter config (also covers escaped spellings such as `theme\u0043SS`); (2) `sanitizeMermaidSource(code)` (exported, pure) runs on the text handed to `mermaid.parse/render` ONLY: in `%%{init|initialize|config: …}%%` directives (any case, single/multi-line, several directives) it drops `themeCSS` keys and any config string value containing `url(`, `@import`, a backslash, `expression(`, `image-set(`, `src(` (themeVariables, fontFamily, …); a risky directive that is not valid JSON is dropped whole (fail closed); in a `---\nconfig: …\n---` front matter it removes `themeCSS` entries (quoted key, inline value, `|`/`>` block scalars with continuation lines) and any risky line. Directives without a risky part (`{"theme":"dark"}`, `flowchart`, themeVariables colours…) are returned byte-for-byte and still work. The markdown source, `getMarkdown()`, the render cache key and the source textarea are untouched.
- Note: `url()` inside only a `.label` rule did not fire a request in Chromium; `.node rect` / `.node` rules do (the QA form), so the tests use those.
- Tests: `roundtrip.test.mjs` (jsdom): unit checks of `sanitizeMermaidSource` (11 hostile forms stripped, 5 legit forms byte-exact, mixed directive keeps theme, block scalar). `headless.check.mjs` (real Chromium; request events AND `page.route`): 15 variants (init themeCSS single rule / two rules / with legit theme / multi-line / `initialize` / `INIT` + single quotes / `config` / escaped key / themeVariables url() / fontFamily url() / two directives / front matter themeCSS / block scalar / quoted key + themeVariables / front matter + init) — each: 0 external requests, still renders with labels, no remote url() in the SVG, markdown byte-identical; `theme:"dark"` still changes the render (also inside a stripped directive and in front matter); fixture 13 still 3 clusters. With both layers disabled the new test fails (14 failures, requests to leak31-*.example seen); each layer alone passes.
- Extension Dev: only rebuild + re-zip needed (no manifest/other changes).
