# QA REPORT — Markdown WYSIWYG Chrome extension (MD Extension QA)

Run: 2026-09-29 ~10:50 ET, `cd qa && npm test` (Playwright 1.x, bundled Chromium 153 headless-shell via `channel:'chromium'`, persistent context, `--load-extension`, 1 worker, ~2 min).
Historic header (first run). See Summary below for the latest build.
Raw log: `qa/out/full-run.log`, machine-readable: `qa/results.json`, screenshots: `qa/screens/`.

## PRINT ROUND 5 — BUG-32 fix verification (2026-09-30 ~09:40-10:30 ET; build `index-DR2BNDPO.js` md5 688f21b4200ede73740648f6e05b9be0, only index bundle; `dist/md-editor-ext.zip` 09:35 == extension/ (`diff -r` of unzipped: clean); manifest identical to git HEAD, CSP `script-src 'self'; object-src 'self'`, permissions storage+identity, host_permissions googleapis only)
**FINAL: `cd qa && npm test` -> 269 passed / 0 failed (269 total), 12.8 min** (raw log `qa/out/full-run-r5.log`). Before adding tests the unchanged suite was **251/251 passed** (11.7 min, `qa/out/full-run-r5-before-new-tests.log`): the `[BUG-32]` probe now passes and the flaky `03-editor` "link via toolbar popover" test passed in both full runs (no hardening needed; earlier failure remains a one-off selection race, not seen again).
- **#32 VERIFIED FIXED** (see ../BUGS.md). 18 new tests in `tests/12-print.spec.mjs` section "I. print tables" (all pass; 251 + 18 = 269). Nothing in src/ or extension/ was touched or rebuilt.
- New tests: (1) 8/9/12/20-column tables x {unbreakable words, long https URLs with query strings, long inline code} x {light, dark} = 8 tests: every header + cell token present in the PDF (whitespace/hyphen-free, and per-column via `pdftotext -bbox` because a wrapped cell interleaves with its neighbours in plain text order), print-layout geometry in a 680px viewport (table right edge <= printable width, `table-layout: fixed`, no cell with scrollWidth > clientWidth, no collapsed column), raster: ink in left/right margin strips == 0, dark theme prints on white. (2) 20 columns x 60 rows over several pages: margins clean on every page, all tokens. (3) 9 columns of long link text with `setPrintLinks(true)`: link text and " (url)" both printed. (4) normal 4-column table (light+dark): 1 page, four equal 170px columns filling 680px, every word present as a whole word in pdftotext (nothing broken mid-word), no degenerate column (>=15% and <60% of the width), notes column wraps to <=4 lines. (5) 45-row 9- and 12-column tables spanning pages plus 8 small tables: no row split across a page (START/END markers on same page), header row kept with first body row. (6) cells with images and inline code: image scaled inside its cell (88px in a 113px cell), blue pixels printed, code wraps, no overflowing cells. (7) wide table inside a blockquote and in list + nested-list items: all tokens, right edge <= page, no overflow. (8) left/center/right alignment: markdown round-trips byte-identical, print `text-align` left/center/right, and PDF glyph boxes sit at the left edge / centre / right edge of their column. (9) 12-col word table + 9-col URL table + normal table + 2 mermaid diagrams + inline/block KaTeX in one doc, light and dark: all table tokens, all 16 flowchart labels, sequence text, KaTeX fonts, no source text, margins clean. (10) printing leaves markdown identical / not modified and the on-screen table layout unchanged (print rules are `@media print` only; on screen the table is still the scrolling `.tableWrapper`).
- Regression spot checks (already in the suite, all pass): print button, Ctrl/Cmd+P (main editor + the 4 per-block fields), dark-mode light print (computed + PDF), print links, page-break test, large-diagram scaling, manifest/bundle test.
- Observations (INFO, not bugs): (a) with 20 columns each column is only ~34px wide, so long tokens wrap every 4-5 characters (text is complete but hard to read) - inherent to fixed layout; consider landscape or a smaller font for >12 columns if it matters; (b) columns are equal width in print (fixed layout ignores content), e.g. a narrow "Qty" column is as wide as "Notes" - the price of the fix; short-content tables still look normal (4 x 170px). (c) plain `pdftotext` (non `-raw`) reflows wrapped table cells across neighbours; harness uses -bbox column buckets.
- Test-only harness additions: `columnTexts/missingByColumn/printGeom` helpers inside section I; `img[src]` selector (ProseMirror adds `img.ProseMirror-separator` to paragraphs with images).
- Manual-only: real Ctrl+P/Print dialog in headed Chrome (headless stubs `window.print`; `page.pdf()` uses the same print CSS but not Chrome's print preview UI, paper size/margin/scale choices, "Background graphics" toggle), a physical printer, and visual review of 12-20 column tables (`qa/screens/print-tbl-*.png`, `qa/out/print-tbl-*.pdf`).

## PRINT / SAVE AS PDF (round 4, 2026-09-30 ~09:0x-09:40 ET; build `index-CqPh5u-r.js` md5 22ab3784e499ba488b47b6e222d95b9d, only index bundle, `dist/md-editor-ext.zip` 08:54 == extension/ (`diff -r` clean), manifest identical to git HEAD, CSP `script-src 'self'; object-src 'self'`)
**Full suite `cd qa && npm test` -> 249 passed / 2 failed (251 total), 11.7 min** (raw log `qa/out/full-run-r4.log`). Previous 221 + 30 new print tests (`tests/12-print.spec.mjs`).
- The 2 failures: (1) `[BUG-32]` in 12-print = **real, new bug** (probe; see ../BUGS.md #32); (2) `03-editor` "link via toolbar popover" = **flaky test-side race, not a print regression** (failed once inside the full run: the selection was lost before the link popover, so the URL was inserted as text `site[https://...]`; passes 3/3 alone and 2/2 as a whole file; 03-editor does not touch print code). All 221 previous tests otherwise pass -> no regression from the print work.
- 12-print alone: 29 pass / 1 fail (BUG-32 probe), ~1.5 min. No skips: Editor Dev's styles have landed so nothing is `[PENDING-STYLES]` any more (the spec has no skip logic; every test runs against the real `prepareForPrint/setPrintLinks/isPrinting`).
- Method: `window.print` stubbed + counted by an init script (headless has no dialog); documents printed with Chromium `page.pdf()` in print media (Letter, `preferCSSPageSize`), analysed with poppler (`pdftotext`, `pdfinfo`, `pdffonts`, `pdftoppm` -> `lib/print-stats.py` = white/dark/blue pixel ratios + ink in the left/right margin strips). PDFs: `qa/out/print-*.pdf` (30+), rasters: `qa/screens/print-*.png`. Test-only fixes while writing (no app change): pdftotext re-wraps and drops hyphens inside long labels (compare whitespace/hyphen-free), thresholds for pastel diagram pages (~76% white), autosave of a file-less doc is in `mdwe.draft` (file-backed in `mdwe.draft.file`), diagram/list markers must not contain hyphens.
### Verdicts per area
| area | tests | verdict |
|---|---|---|
| A page side: `#btn-print` (exists, visible, enabled, title "Print or save as PDF (Ctrl+P)", role button name /print/, in #filebar) | 1 | PASS - click -> `window.print` exactly once per click, 0 console errors, 0 CSP violations |
| A Ctrl+P / Cmd+P (metaKey): main editor, mermaid textarea, block-math textarea, inline-math input, whole-doc Source textarea | 2 | PASS - each prints exactly once, `defaultPrevented` true, pending field edit kept; Ctrl+Shift+P / Ctrl+Alt+P do NOT print; native chords Ctrl+A/Z/C/X still work in fields and never print; Ctrl+P triggers no save/open/download |
| A order: `prepareForPrint` awaited before `window.print` (log `prep-start, prep-end, print`); re-entrancy guard (Ctrl+P, Ctrl+P, click -> 1 print); rejecting prepare -> still prints + status "Print preparation failed" | 1 | PASS |
| A empty doc / Drive dialog open / Drive dialog in error state | 3 | PASS - no crash; PDF has no UI text; dialog+overlay+file bar computed `display:none` in print media, doc text present, dialog text absent from PDF |
| A print media: file bar, #status, #drive-status, #dropzone, toolbar, .mdx-source hidden; editor host grows (overflow visible, height >= 3x screen, scrollHeight == height) | 1 | PASS |
| A 150 paragraphs + 3 tables: pages > 1 (7 pages), first + last paragraph and all 150 paragraphs in pdftotext, no UI text, 0 pages with ink in margins | 1 | PASS |
| B content: headings, bullet/ordered/nested lists, task list (2 checkboxes), table, code (highlighted), blockquote, data-URI image (blue pixels), links, Jasser's flowchart (all 16 labels) + sequence diagram as rendered SVG text (no `flowchart TD`/`-->`/`participant` source text), KaTeX inline+block (KaTeX_* fonts embedded, no `$..$`/`\int`), no "Edit source"/"Done"/block label bars/toolbar text | 4 | PASS |
| B bad diagram + bad math + `\undefinedcmd`: no crash; error boxes print "Mermaid syntax error..." / "Math error..." with source as plain text; no edit UI | 1 | PASS |
| C dark: computed print styles light (html/body/root/ProseMirror white, text/th/td/katex dark, code+th backgrounds light, links dark-blue, `color-scheme: light`), screen theme untouched | 1 | PASS |
| C dark PDF: white pages (85-98% white; diagram page 76% because of pastel fills), dark text present, diagram labels + sequence text present; also without `prepareForPrint` (plain Ctrl+P after theme switch: invert fallback) still white | 1 | PASS |
| C `beforeprint` swaps dark diagram to LIGHT svg synchronously (node fill lum <120 on screen -> >180 in print), `afterprint` restores the exact dark fill; `isPrinting()` true/false | 1 | PASS |
| D no heading last on a page (26-page doc, 40 headings); 8-row table with tall cells (no row split), diagrams (5 nodes on one page), blockquotes, list items (6 x 5 lists) never split | 1 | PASS - 0 orphans, 0 split elements |
| D code blocks (8 lines, would fit on a page): 4/30 split across a page boundary | 1 | INFO - allowed by print.css (`break-inside:auto`, orphans/widows 3), documented by Editor Dev; logged, not a failure |
| D large diagram scaling: wide LR flowchart is >680px on screen; in a 680px print layout all SVGs <= 680px wide and right edge <= 680; no ink in margins in the PDF; all labels present | 1 | PASS |
| D long unbroken code line wraps in the box (no ink in margins, text complete) | 1 | PASS |
| D wide tables: 8 columns wrappable text | 1 | PASS (control) |
| D wide table 9 columns of 14 unbreakable chars | 1 | **FAIL = BUG #32** last column (H8, cell08..cell38) is cut off in the PDF |
| E 320 paragraphs + 4 diagrams + 4 math blocks + 3 tables | 1 | PASS - render+load ~ 3 s, `prepareForPrint` and PDF in seconds (well under 20 s / 60 s budgets), page count sane (>10, <90), start/middle/end + diagram/math content present, markdown unchanged |
| F Source mode: `pre.mdx-print-source` visible, monospace (mono font embedded in the PDF), pre-wrap, textarea + WYSIWYG + toolbar hidden, PDF text contains the exact markdown source (`# Title`, `**bold**`, `[a link](url)`, fences, table pipes), title only once; switching back prints rendered doc without markup; dark-theme source prints dark-on-white | 2 | PASS |
| G `setPrintLinks(true)`: " (url)" after http(s) and mailto links (also bare autolinks), NOT after `#anchor`/`javascript:`; default and `setPrintLinks(false)` print no URLs; no `::after` content on screen; markdown unchanged | 1 | PASS |
| H document not mutated: markdown byte-identical, `isModified()` false, `state.dirty/savedText/name`, draft storage, tab title and `#filename` class identical before/after (light + dark), 0 ProseMirror `update` events, diagram DOM restored, `isPrinting()` false after; dirty doc stays dirty with its draft and print does not save/download | 2 | PASS |
| H no requests to non-extension origins during button/Ctrl+P/PDF/dark/source/links; 0 CSP violations; 0 console errors | 1 | PASS |
| H manifest: CSP exactly `script-src 'self'; object-src 'self'`, permissions exactly `storage, identity`, host_permissions exactly googleapis, no web_accessible_resources, identical to git HEAD; single index bundle; no eval/new Function; CSS has @media print and no remote url() | 1 | PASS |
### Bugs
- **#32 [OPEN] wide tables lose right-most column(s) in print** (details/fix idea in ../BUGS.md). Probe `[BUG-32]` fails until fixed.
### Manual-only (cannot be verified headlessly)
Real Chrome print preview dialog (the harness stubs `window.print` and uses `page.pdf()`; the real dialog's own paper-size/scale/margins/"Headers and footers"/"Background graphics" toggles are outside the page: Editor Dev's `@page{margin:18mm}` is only a default, and with "Background graphics" off Chrome drops code/table-header shading); actually clicking Save as PDF in the dialog and opening the file; paper sizes other than Letter (A4: 210mm) and landscape; whether `beforeprint`/`afterprint` fire in the real dialog (dark->light diagram swap is verified via dispatched events + `prepareForPrint`); Ctrl+P being intercepted by the real browser before the page in a normal tab (harness verifies the page handler + `preventDefault`); printing from a `file://` content-script page; visual review of screens/print-content-p*.png, print-dark-content-p*.png, print-source-mode.png, print-links-on.png, print-wide-table-9col.png, print-errors.png; Chrome's own page-break heuristics on very tall diagrams (>90vh are scaled down); header-row repetition (impossible: TipTap tables have no thead).

## LATEST (round 3, ~17:5x ET, build `index-Dd0_7FZz.js` md5 27314a76cb999bb099408d7259de679f, zip 17:24 identical to extension/ (`diff -r` clean, 133 files / 136 zip entries), only index bundle in assets, CSP `script-src 'self'; object-src 'self'` unchanged): `cd qa && npm test` -> **221 passed / 0 failed (221 total), 10.0 min** (raw log `qa/out/full-run-r3.log`)
- Run 1 (untouched suite, before adding tests): **214/214** - the `[BUG-31]` probe flipped green. Then +7 tests (section 12e in `11-mermaid-math.spec.mjs`, 57 tests in that file now) -> 221/221. Per file: 01-static 11, 02-loads 5, 03-editor 13, 04-roundtrip 24, 05-fileio 12, 06-draft 14, 07-content-script 3, 08-screenshots 1, 09-probes 12, 10-drive 69, 11-mermaid-math 57.
- **#31 VERIFIED FIXED** (details: ../BUGS.md "Round-3 verification"): 25 themeCSS/url()-config variants (key case, init/initialize/config, multi-line, multiple, YAML front matter, JSON/unicode/CSS escapes, themeVariables/fontFamily/flowchart url(), @import, sequence/class/pie/gantt) -> 0 non-extension requests (events + route interception); original repro clean; legit `theme:dark`, front matter title/theme, themeVariables colours still take effect; markdown byte-identical after unedited open+save (local + Drive 0 PATCH) and after an edit elsewhere; invalid-JSON risky directives: no crash / no leak; Jasser's flowchart, sequence, pie, class, gantt render in light + dark; #26-#29 regressions pass. **No new bugs.**
- Test-side notes (no app change): `{"flowchart":{"curve":"linear"}}` has no visible effect in this mermaid build even with stock mermaid (checked in isolation), so that case only asserts it renders; legit-effect assertions use theme/themeVariables instead. Drive helper exposes `external` (not `reqs`).
- Manual-only: visual check of screens/round3-legit-config.png and round3-dark-all-diagrams.png; real-Chrome (headed) confirmation that no request to a tracker host appears in DevTools > Network when opening a doc with a themeCSS directive; real Drive/OAuth; file:// access toggle; real clipboard paste; native Ctrl+S "Save page as" suppression.

## Previous LATEST (16:5x ET, 213 passed / 1 failed = the then-open #31 probe):
(build `index-3Oh89ym1.js`) ## LATEST (16:5x ET, build `index-3Oh89ym1.js` md5 99b89e852fec59109c616c8b870f6b72, zip 16:25 identical to extension/ (`diff -r` clean, 133 files / 136 zip entries), CSP `script-src 'self'; object-src 'self'` unchanged): `cd qa && npm test` -> **213 passed / 1 failed (214 total), 9.3 min**
- Run 1 (untouched suite, before adding tests): **200/200** (was 198/200): [BUG-26] and [BUG-27] now PASS.
- Then +14 tests added to `qa/tests/11-mermaid-math.spec.mjs` (49 pass + 1 fail there): 12a #26 (5), 12b #27 (2), 12c #28 (3), 12d #29 (3), plus `[BUG-31]` probe (fails = real, new residual bug). Per file: 01-static 11/11, 02-loads 5/5, 03-editor 13/13, 04-roundtrip 24/24, 05-fileio 12/12, 06-draft 14/14, 07-content-script 3/3, 08-screenshots 1/1, 09-probes 12/12, 10-drive 69/69, 11-mermaid-math 49/50.
- **Verdicts:** #26 VERIFIED FIXED, #27 VERIFIED FIXED, #28 VERIFIED FIXED, #29 VERIFIED FIXED for `<img>/<video>/<iframe>/CSS url()` in labels; **new #31 OPEN**: `%%{init:{"themeCSS":"... url(https://...)"}}%%` still makes remote requests (test `[BUG-31]`). Details: ../BUGS.md "Round-2 verification".
- Regression spot checks (all green in the same run): unedited open+save byte-identical for all fixtures (local + Drive: 04-roundtrip, 11 sec.4, 10-drive), lazy loading (cold open loads only the entry bundle, no mermaid/katex/fonts), no eval / new Function / string timers in any JS file, manifest CSP exact, 0 CSP violations (12a-12d also assert `securitypolicyviolation` = []), Ctrl+S in the main editor, Ctrl+Z after open does not blank the doc, dark mode contrast test, earlier diagrams (flowchart/sequence/pie/class/gantt) render in light + dark.
- Test-side fixes while writing the new tests (no app change): native-chords test must not empty a math field (an empty math source deletes the node by design) and must not assume Esc reverts already-committed edits; Drive-emulator test must not read `window.__csp` (not installed on that page helper); `[url()` variants that are mermaid *syntax errors* (classDef/style with url()) replaced by valid vectors.
- Manual-only: real Chrome tab: Ctrl+S / Ctrl+O inside a field really suppresses the browser's "Save page as..." (harness verifies `defaultPrevented`, not the native dialog); real clipboard paste inside fields (headless clipboard); real Drive/OAuth; file:// access toggle; visual check of the new error boxes and sanitized SVGs (screens/math-errors-round2.png, mermaid-sanitized-round2.png, round2-dark-all-diagrams.png).

## Previous LATEST (15:5x ET, build `index-DUoBI84v.js` md5 396724ea90aa427abf00bb3211707bf5 = Mermaid + KaTeX): `cd qa && npm test` -> 198 passed / 2 failed (200 total), 8.4 min
Per file: 01-static 11/11, 02-loads 5/5, 03-editor 13/13, 04-roundtrip 24/24 (15 + 9 new mermaid/math fixtures picked up automatically), 05-fileio 12/12, 06-draft 14/14, 07-content-script 3/3, 08-screenshots 1/1, 09-probes 12/12, 10-drive 69/69, **11-mermaid-math 34/36**.
**All 155 previously-passing tests still pass** (3 needed TEST-side fixes, no app change: see "Test-only changes" in the Mermaid section). The 2 failures are intentional bug probes for real bugs: **#26** (Ctrl+S inside a per-block source field does nothing) and **#27** (`\undefinedcmd` not flagged as math error). Details below in "Mermaid + KaTeX" and in ../BUGS.md #26-#30.

## Previous summary (full run 14:21-14:27 ET, `cd qa && npm test`, 1 worker, 5.6 min): **155 passed / 0 failed (155 total)**
Build under test: `extension/editor/assets/index-BTJ1MUpn.js` (md5 eb893cece011793d9b17de14d3fe0499, built 14:02:59 ET; includes Editor Dev exact-original `getMarkdown()/isModified()/markSaved()` and Extension Dev fixes for #19-#23). Raw log `qa/out/full-run.log`, `qa/results.json`.
Per file: 01-static 11/11, 02-loads 5/5, 03-editor 13/13, 04-roundtrip 15/15, 05-fileio 12/12, 06-draft 14/14, 07-content-script 3/3, 08-screenshots 1/1, 09-probes 12/12, 10-drive 69/69 (65 + 4 new).
Previous run (13:46, build index-Dil2WIl_.js): 146 pass / 5 fail (the five [BUG-19..23] probes); those five now PASS.
**Drive bugs #19-#23: all VERIFIED FIXED** (their [BUG-n] tests pass unmodified except #21's soft assertion, see below). **Byte-for-byte unedited save: 0 of 18 docs change** (Drive: 0 PATCH, bytes identical; local FSA save: 0 changed); Ctrl+Z right after open blanked 0/18 (Drive) and 0/18 (local); `isModified()` false after open for 18/18; unedited Drive Ctrl+S -> status "No changes to save".
Test changes this round (tests only; extension/ and src/ untouched):
- lib/fixture.mjs: `ext` fixture now loads a **test-only copy of extension/** whose manifest `oauth2.client_id` is non-placeholder (api.js short-circuits `YOUR_CLIENT_ID*` before calling chrome.identity, which would otherwise make every token-mock test fail with not-configured); `extReal` fixture = manifest as shipped. `requestfailed` filter now tolerates pure-network failures on external http(s) URLs (ERR_NAME_NOT_RESOLVED, ERR_INTERNET_DISCONNECTED, ERR_BLOCKED_BY_ORB, connection errors...), collected in `netNoise` instead of failing (example.com/a.png in fixture 01-basic).
- 03 source toggle: source mode returns textarea text verbatim (no trailing \n) - intended; after a WYSIWYG edit output is canonical again (asserted).
- 09 CRLF: unedited CRLF doc round-trips as CRLF and isModified()==false; after one edit output is LF-only (asserted + logged).
- 10: readFile-failure expectation `existing doc` (no trailing \n); CRLF Drive test: unedited = CRLF, Ctrl+S = no PATCH; after edit = LF-only; [BUG-21] soft assertion "drive link not null after reload" replaced by "editor empty after reload" (after the fix nothing stale is restored, so an empty un-linked doc is correct).
- 10 new (4): 18-doc unedited Drive probe, 18-doc unedited local probe, "No changes to save" + markSaved second-save skip, placeholder client id as shipped (0 identity calls, 0 network).
Also still to run by hand: `npm run test:drive` (not re-run this round). Real-Drive / real-Chrome-identity items are NOT counted (see Manual).

## Results per test
> NOTE: per-test tables below are the historic 10:50 list except rows updated to current results (all currently PASS); see Summary for latest totals.

### 01-static.spec.mjs
| result | test |
|---|---|
| PASS | manifest valid + permissions exactly ["storage","identity"], host_permissions exactly ["https://www.googleapis.com/*"] (was: storage only) |
| PASS | oauth2: scopes exactly [drive]; client_id present - **still the placeholder `YOUR_CLIENT_ID.apps.googleusercontent.com`** |
| PASS | pinned key derives to EXTENSION_ID.txt (egbgaoinpgdhchefefmlakihmbddmnfc) |
| PASS | CSP present, strict, no unsafe-eval/unsafe-inline/remote |
| PASS | editor page built: index.html exists |
| PASS | no inline <script>, inline on*= handlers, javascript: URLs in extension HTML |
| PASS | no remote URLs loaded by html/css; report http(s) strings in JS |
| PASS | eval / new Function / setTimeout(string) in extension JS (report facts) |
| PASS | innerHTML/outerHTML/insertAdjacentHTML sinks in hand-written code (info) |
| PASS | Drive code: bundle URLs limited to the 3 Drive endpoints + SVG ns + comment/doc links; no gapi/GSI/Picker loader |
| PASS | Drive code: drive-ui CSS/HTML has no remote refs; drive buttons + #drive-status present |

### 02-loads.spec.mjs
| result | test |
|---|---|
| PASS | service worker registers with expected URL |
| PASS | editor page loads without console/page errors or failed requests |
| PASS | editor page has no remote network requests |
| PASS | toolbar action click opens editor tab (via chrome.action.onClicked) |
| PASS | background: open-in-editor message only accepts file:// urls |

### 03-editor.spec.mjs
| result | test |
|---|---|
| PASS | typing plain text |
| PASS | bold / italic / strike / inline code via toolbar |
| PASS | bold via Ctrl+B on selection |
| PASS | heading via block select (H1,H2,H3, back to paragraph) |
| PASS | bullet, ordered, task list, blockquote, hr |
| PASS | table insert + type in cells + add row/col |
| PASS | link via toolbar popover (selection) and Ctrl+K (empty selection inserts url) |
| PASS | image via URL popover |
| PASS | code block via toolbar (with ``` inside content uses longer fence) |
| PASS | undo / redo toolbar |
| PASS | source toggle: shows markdown, edits round-trip back into WYSIWYG |
| PASS | [BUG-7] single source toggle (top-bar #btn-source removed); state.source follows editor |
| PASS | theme toggle sets html[data-theme], editor root theme, persists in chrome.storage.local |

### 04-roundtrip.spec.mjs
| result | test |
|---|---|
| PASS | fixture 01-basic.md: idempotent + no content loss |
| PASS | fixture 02-lists.md: idempotent + no content loss |
| PASS | fixture 03-code.md: idempotent + no content loss |
| PASS | fixture 04-table.md: idempotent + no content loss |
| PASS | fixture 05-mixed.md: idempotent + no content loss |
| PASS | fixture 06-normalize.md: idempotent + no content loss |
| PASS | fixture 07-nested.md: idempotent + no content loss |
| PASS | fixture 08-table-align.md: idempotent + no content loss |
| PASS | fixture 09-escapes.md: idempotent + no content loss |
| PASS | fixture known-adjacent-lists.md: idempotent + no content loss |
| PASS | Editor Dev roundtrip.test.mjs (node/jsdom) runs |
| PASS | [BUG-9] escaped block-start chars keep their meaning after serialize (\#, \-, 1\., \+, \---) |

### 05-fileio.spec.mjs
| result | test |
|---|---|
| PASS | Open via #fallback-input (no FSA): loads content, name, not dirty |
| PASS | dirty indicator: #filename.dirty + title bullet toggle on edit / revert / save |
| PASS | drag-drop simulation (DataTransfer with File) opens file |
| PASS | drag-drop with dirty doc asks to confirm (dialog handled) |
| PASS | #btn-download triggers download whose content equals getMarkdown() |
| PASS | Download filename: opened name kept; non-md name gets .md appended |
| PASS | Save-as without FSA falls back to download; Ctrl+S / Ctrl+O / Ctrl+Shift+S do not crash |
| PASS | FSA stub: Ctrl+O opens via showOpenFilePicker; edit; Ctrl+S writes back to SAME handle (no Save As prompt) |
| PASS | FSA stub: untitled doc + Ctrl+S -> Save As picker -> writes; name updates; subsequent Ctrl+S reuses handle |
| PASS | FSA stub: Save As (Ctrl+Shift+S) always prompts; Open cancelled (AbortError) is silent |
| PASS | Open while Source mode is on (BUGS #6): state stays consistent and content shows |
| PASS | Write failure on save surfaces status message, keeps dirty |

### 06-draft.spec.mjs
| result | test |
|---|---|
| PASS | autosave: edit -> after >800ms chrome.storage.local[mdwe.draft] holds getMarkdown() |
| PASS | reload restores draft and marks dirty |
| PASS | Save (FSA stub) clears draft; reload afterwards starts empty |
| PASS | reverting edits back to saved text removes the draft |
| PASS | BUG#1 verify: opening ?src=file:// keeps an existing draft (no silent deletion) |
| PASS | BUG#1 follow-up: draft kept after ?src open is restored on next plain open |
| PASS | BUG#1 side effect probe: after ?src open, a later Save/edit-revert overwrites or clears the kept draft? |
| PASS | BUG#2 verify: malformed %-sequence in ?src no longer throws in decodeURIComponent (name falls back to raw) |
| PASS | ?src with %20 decodes filename |
| PASS | BUG#4 verify: ?src doc status says Ctrl+S will ask where to save; Ctrl+S -> Save As picker |
| PASS | ?src fetch failure: real file:// (no file-URL access in this harness) reports error gracefully |
| PASS | [BUG-11] BUG#3 residual: type then unload immediately (<250ms onChange debounce) -> is text kept in draft? |
| PASS | BUG#3 probe: type, wait 400ms (onChange fired, autosave pending), then close -> draft flushed? |
| PASS | draft persists ALL edit types incl. source-mode edits |

### 07-content-script.spec.mjs
| result | test |
|---|---|
| PASS | missing file via ?src: graceful error, editor usable |
| PASS | file:///tmp/test.md: "Edit in Markdown Editor" button appears and opens the editor with content |
| PASS | content script: injected once, no duplicate button on .markdown, not on .txt |

### 08-screenshots.spec.mjs
| result | test |
|---|---|
| PASS | screenshots: light, dark, source (light+dark) |

### 09-probes.spec.mjs
| result | test |
|---|---|
| PASS | untrusted markdown: raw HTML / javascript: links do not execute or create live handlers/scripts |
| PASS | remote image in markdown triggers a network request when document is opened (privacy info) |
| PASS | [BUG-8] task list layout: checkbox and text on the same line (light + dark) |
| PASS | [BUG-7b] exactly one visible source toggle in UI |
| PASS | Source mode: Save/Download uses textarea content; dirty logic works when only source edited |
| PASS | Tab in source textarea inserts 2 spaces (does not leave field) |
| PASS | large document (2000 paragraphs + 200-row table): load + type latency |
| PASS | unicode / emoji / CRLF input survives; CRLF normalized |
| PASS | Ctrl+S when not focused in editor (focus on toolbar button) still handled and default prevented |
| PASS | Open cancelled via fallback input (no file) is silent |
| PASS | [BUG-8b] task-list CSS selectors match rendered DOM (li[data-type=taskItem]) |
| PASS | [BUG-10] raw HTML / comments / footnotes survive open+save |

## Evidence / facts by area

### 1. Static / permissions / CSP — PASS
- manifest_version 3, `permissions == ["storage","identity"]`, `host_permissions == ["https://www.googleapis.com/*"]` (Drive; test 01 updated 13:3x ET), `oauth2.scopes == [".../auth/drive"]`, `oauth2.client_id` = placeholder, no optional perms / externally_connectable, `web_accessible_resources: []`, all referenced files exist.
- CSP `extension_pages: "script-src 'self'; object-src 'self'"` (no unsafe-eval/inline, no remote).
- `extension/editor/index.html`: 1 external module script (`./assets/index-*.js`), 1 stylesheet; **no inline `<script>`, no `on*=` attributes, no `javascript:`**, no remote refs.
- Bundle (now 1.50 MB, 46.4k lines incl. Drive api + drive-ui, unminified): **0 occurrences of `eval(`, `new Function(`, `Function("…`, `setTimeout("string")`, `document.write(`** (scanned every .js under extension/). No `importScripts`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, dynamic remote import/fetch. `WebAssembly` appears only as a highlight.js language name. `innerHTML` used only inside ProseMirror internals (clipboard/parsing), not in hand-written code (`background.js`, `content.js` have no HTML sinks). The only http(s) strings in non-comment code are the 3 Drive endpoints (`https://www.googleapis.com/drive/v3`, `.../upload/drive/v3`, `https://oauth2.googleapis.com/revoke?token=`), the SVG namespace, and library error/console text (prosemirror.net#generatable, highlight.js/marked issue links); everything else (prosemirror.net, github.com, php.net, docs.python.org, spec.commonmark.org, …) is comments/doc links (prosemirror.net, github.com, php.net, docs.python.org, spec.commonmark.org, …).
- Runtime: opening the editor issues exactly 3 requests, all `chrome-extension://` (html, js, css).

### 2. Loads — PASS
SW registered at `chrome-extension://<id>/background.js`; editor page has 0 console errors / page errors / failed requests; title `Untitled.md — Markdown Editor`. `chrome.action.onClicked` has a listener; dispatching it from the SW opens a tab at `/editor/index.html` (a real toolbar-icon click cannot be automated — see Manual). `open-in-editor` message: https://, javascript:, non-string rejected (no navigation); `file:///tmp/x.md` navigates the sender tab to `editor/index.html?src=<encoded>`.

### 3. Editor — PASS (12/12 after harness fix; note: ProseMirror needs an async tick after Shift+Home/Ctrl+A before Ctrl+B sees the selection — test issue, not an app bug)
Typing; bold/italic/strike/code toolbar → `**b** *i* ~~s~~ `c``; Ctrl+B; heading select H1-H3/paragraph; bullet/ordered/task list (`- [ ]`, click checkbox → `- [x]`), blockquote, hr; table insert/type/+col/+row/delete (serialized as padded GFM table); link popover (+ `javascript:` URL rejected, Ctrl+K), image popover, code block (longer fence used when content contains ```), undo/redo; source toggle shows exact markdown, textarea edits round-trip to WYSIWYG, getMarkdown in source mode returns textarea text; single source toggle in sync (`state.source == editor.isSourceMode()`, aria-pressed); theme toggle sets `html[data-theme]`, `.mdx-root[data-theme]`, persists `chrome.storage.local['mdwe.theme']` and survives reload.

### 4. Round-trip — 8/10 fixtures pass; `09-escapes.md` FAIL (BUG-9); `known-adjacent-lists.md` reported (known, not asserted)
Checks per fixture: 3 passes idempotent; word/number tokens all preserved (no content loss); ProseMirror doc(original) == doc(reparse(output)).
| fixture | exact | idempotent | tokens kept | structure kept |
|---|---|---|---|---|
| 01-basic | ws-only diff | yes | yes | yes |
| 02-lists, 03-code | exact | yes | yes | yes |
| 04-table, 05-mixed, 08-table-align | no (table column padding) | yes | yes | yes |
| 06-normalize | no (setext→ATX, `*`/`+`→`-`, `1)`→`1.`, `__b__`→`**b**`, `***`→`---`, indented code→fenced, `<url>`→`[url](url)`) | yes | yes | yes |
| 07-nested | no (blank-line normalisation) | yes | yes | yes |
| 09-escapes | no | yes | yes | **NO**: `1\. not a list` → `1. not a list` = orderedList after reopen; `\#` likewise (BUG-9) |
| known-adjacent-lists | no | **NO** (2 lists merge) | yes | no (documented known issue) |
`src/editor/roundtrip.test.mjs` (jsdom): exit 0, "10 docs: 2 exact, 7 normalized (stable), 0 failed/unstable" (its checker does not compare structure, so it does not see BUG-9).
Extra probes (facts, `node`-independent, run in built editor): `\-`, `\+`, `1\)`, `\---`, `a\n\=\=\=` all lose their escape and change structure; `\>`→`&gt;`; raw HTML: `<!-- c -->` dropped, `<details><summary>` tags dropped, `<sub>/<kbd>` tags dropped, footnotes become literal escaped text (BUG-10).

### 5. File I/O — PASS (12/12)
Fallback `#fallback-input` open (setInputFiles / filechooser), drag-drop via DataTransfer (+ confirm dialog when dirty), `#btn-download` file content == `getMarkdown()`, name `Untitled.md`, `notes.txt`→`notes.txt.md`, no-FSA Save-As/Ctrl+S fall back to download, Ctrl+O opens chooser, Ctrl+Shift+S; `#filename.dirty` + `• ` title toggles (and clears when edit reverted); FSA stub: Ctrl+O→edit→Ctrl+S writes to the SAME handle twice with 0 Save-As prompts; untitled → Save-As once then handle reused; Open cancel (AbortError) silent; write failure shows `Save failed: disk full` and stays dirty; Ctrl+O while Source on stays consistent (BUGS #6 not reproduced).

### 6. Draft — PASS (13/13 after fixes)
Draft absent at 400 ms, present after 800 ms debounce with `{text,name,savedAt}`; reload restores draft, dirty, `• ` title, status "Restored autosaved draft"; Save clears draft (reload starts empty); reverting edits removes draft; source-mode edits are drafted.
BUGS #1 VERIFIED FIXED (draft survives `?src=` load and is restored on next plain open) but see #12 (single slot overwritten on first edit). #2 VERIFIED FIXED (`file:///tmp/bad%E0%A4%A.md` loads; name falls back to raw). #4 VERIFIED FIXED (status text + Save-As). #3/#11 VERIFIED FIXED on 10:48 build (type-then-immediately-close now keeps draft).
Real `?src=file:///tmp/x.md`: in this harness the fetch **works** (extension page reads the file) → content loaded, status "Opened x.md (read-only source: Ctrl+S will ask where to save)". Non-existent file → status "Could not read file (enable "Allow access to file URLs" …): Failed to fetch", editor stays usable, only the browser's own net::ERR_FILE_NOT_FOUND console line.

### 7. Content script — PASS in harness / MANUAL for default-off state
Playwright Chromium serves `file:///tmp/test.md` as `text/markdown` 200 and renders it as text; content script injected; `#__mdwe_btn` "✎ Edit in Markdown Editor" present (exactly one on .markdown; none on .txt); click → tab navigates to `editor/index.html?src=file%3A%2F%2F%2Ftmp%2Ftest.md` and editor contains `# Test file\n\nhello from disk\n`, filename `test.md`.
NOT verifiable here: default state of "Allow access to file URLs" (off in real Chrome), whether branded Chrome renders vs downloads `.md`.

### 8. Screenshots — DONE
`qa/screens/editor-light.png`, `editor-dark.png`, `source-light.png`, `source-dark.png`, `editor-dark-dirty-table.png`, plus BUG-8 evidence `bug8-task-list-before.png` / `bug8-task-list-with-suggested-css.png`. (screens are regenerated by test 08 on every run; bug8-* were generated once manually.)

### Extra probes (09)
- Untrusted markdown: `<script>`, `<img onerror>`, `<iframe>`, `javascript:` links → nothing executes (`__pwned` stays 0), no script/iframe/onerror nodes rendered, link href sanitized to empty in DOM (raw text preserved in markdown).
- Remote image `![t](https://tracker.example/pixel.png)` triggers a network request immediately on open (info, BUGS #13). Relative images (`img/local.png`) fail to load (ERR_FILE_NOT_FOUND).
- Large doc (2000 paragraphs + 200-row table, 140 KB): setMarkdown 460 ms, getMarkdown 254 ms, 5 keystrokes 110 ms.
- CRLF/unicode/emoji preserved; Tab in source textarea inserts 2 spaces; Ctrl+S with focus on a toolbar button is handled; Open cancel via fallback input silent; source-mode download uses textarea text.
- Task list layout FAIL (BUG-8): `li` has only `data-checked`, CSS targets `li[data-type="taskItem"]` so checkbox and text are stacked (text ~20 px below checkbox in both themes).

## Manual (not automatable here)
1. Real toolbar-icon click in branded Chrome (Playwright cannot click browser chrome; onClicked listener + dispatch verified).
2. Load unpacked in real Chrome: with "Allow access to file URLs" OFF the Edit button must not appear / `?src=` must show the friendly error; ON → button works.
3. Whether Chrome renders or downloads `file:///…/x.md` (BUGS #5).
4. Real File System Access pickers (only stubbed here): permission prompt on `requestPermission`, overwriting an actual file, drag-drop of a real file with `getAsFileSystemHandle`.
5. Visual review of screenshots at other viewport sizes / OS dark-mode default (`prefers-color-scheme`).

## Bugs (see ../BUGS.md for details)
OPEN: #8 task-list layout [low-med], #9 escapes dropped → structure change [med], #10 HTML comments/tags/footnotes lost [med], #12 draft slot overwritten [low], #13 relative/remote images [info], #14 javascript: preserved in md [info].
FIXED & VERIFIED: #1, #2, #3, #4, #7, #11. NOT REPRODUCED: #6. PARTIAL/MANUAL: #5.

## Final re-run before Drive (11:5x ET): 82 passed, 0 failed (historical; superseded by the summary at the top).

# Google Drive (qa/tests/10-drive.spec.mjs + updated 01-static) 

## How it is tested (what was and was not run)
- **(M) mock**: `window.__mdwe.driveApi = window.__drv.api`, an in-page fake with exactly the api.js surface (lib/drive.mjs `installMock`); used for dialog/UI/state logic. 24 tests.
- **(R) real**: the *bundled real* `createDriveApi()` with a stubbed `chrome.identity` (init script; models signed-in, token generations TOK1/TOK2..., `runtime.lastError`) and a Node-side Drive v3 emulator (`FakeDrive`, files/about/upload PATCH/multipart POST, read-only, 401/403/404/429/abort injection) behind `context.route(/^https:\/\/(www|oauth2)\.googleapis\.com\//)`. Real request shapes/headers/bodies are asserted (Bearer token, `uploadType=media|multipart`, `Content-Type`, exact bytes, call order metadata-GET -> PATCH). 41 tests (real api incl. drafts, fidelity, real-Chromium-identity report). No real Google endpoint was contacted (every request to googleapis.com is fulfilled by the emulator; `r.external` asserted to contain nothing else).
- **Not real**: Google's actual auth/consent, real Drive semantics (`name contains`, revisions, `modifiedTime` granularity), real `chrome.identity` in branded Chrome. In headless Playwright Chromium the real `chrome.identity.getAuthToken({interactive:true})` never returns (dialog sits at "Signing in…" >6 s, 0 requests) - reported, not asserted.
- `npm run test:drive` (project root): 13/13 pass.

## Drive results (69 tests in 10-drive.spec.mjs: 69 PASS as of 14:2x ET; 13:5x run was 60 PASS / 5 FAIL = the #19-#23 probes)
| area | result |
|---|---|
| Buttons `#btn-drive-open`/`#btn-drive-save`/`#drive-status`, no Drive traffic at load, 0 console errors | PASS |
| Open: list newest-first, debounced search (query passed, quote-escaped `it\'s`), pick -> content byte-exact, filename, not dirty, `state.drive={id,modifiedTime,canEdit}`, status "Opened x from Drive" | PASS (M+R) |
| Open: dblclick/Esc/Cancel, Ctrl+S behind dialog inert, dirty doc -> "Discard unsaved changes?" (dismiss = dialog never opens), readFile failure keeps picker open with banner and current doc intact, pagination + failing next page Retry | PASS |
| Save in place: Ctrl+S and `#btn-drive-save` and `#btn-save` -> `saveFile(id,text,{expectedModifiedTime})`, real wire: GET meta then PATCH `text/markdown`, exact body; baseline = PATCH response modifiedTime; 2nd save uses new baseline; not dirty; `mdwe.draft.file` cleared | PASS |
| Badge `#drive-status .gdui-status[data-state]`: saving (gated in flight), saved ("Saved to Drive HH:MM"), error ("save failed - …"), offline, conflict, signed-out; never claims success, dirty kept on every error | PASS |
| Conflict dialog (alertdialog, 4 choices, focus on Cancel; screenshots light/dark): Cancel/Esc/backdrop = nothing written, edits + dirty + conflict badge kept, next Ctrl+S re-detects; Overwrite = `force:true` write, baseline advances; Reload = asks confirm, dismiss keeps edits, accept loads remote clean; Save-copy = "Copy of x.md" via createFile, original untouched, doc re-pointed to copy; cancel name dialog = nothing; overwrite network failure = offline badge, remote untouched. Never silently overwrites | PASS (M+R) |
| 401: expired token -> `removeCachedAuthToken` + new token + one retry (list/read/save all recover); repeated 401 -> exactly 2 requests then friendly "signed out" badge, no PATCH, no loop; next Ctrl+S recovers when server is fine again | PASS |
| Offline (route abort): open dialog "offline" + Retry recovers; save -> offline badge, editor text + dirty + draft preserved, later Ctrl+S succeeds; PATCH aborted after successful metadata check = not success | PASS |
| Read-only (`canEdit:false`): "Read-only" row badge, status notice, Save -> Save-a-copy dialog ("Copy of x.md"), zero PATCH; file turns read-only after open / server 403 insufficientFilePermissions -> "read-only file" badge, dirty kept | PASS |
| 429 / 403 rateLimit -> "rate limited" (dialog + badge); 403 forbidden -> "permission denied"; 500 -> message | PASS (fix #15 verified) |
| Not configured (mock `not-configured`): dialog "Google Drive isn't set up yet … README", no Sign-in button, theme/typing/source/local Save-As all still work, `Save to Drive` shows the same | PASS |
| **Not configured with Chrome's real message "Invalid OAuth2 Client ID." (what the shipped placeholder produces)** | PASS [BUG-19] fixed ("isn't set up yet", no Sign-in button) |
| chrome.identity missing entirely -> Sign-in click -> "isn't set up yet"; no crash; typing works | PASS |
| Sign-in cancelled ("The user did not approve access.") -> "Sign-in cancelled", retry works (2 interactive calls) | PASS |
| Sign out: revoke POST `oauth2.googleapis.com/revoke?token=TOK1`, removeCachedAuthToken, clearAllCachedAuthTokens, dialog "Signed out"/Sign in again; Save after sign-out -> "signed out" badge, no write, edits kept | PASS |
| Signed-out badge offers a way to sign in | PASS [BUG-23] fixed (1 'Sign in' action) |
| First Save to Drive of untitled doc: name dialog default `Untitled.md`, `my notes` -> `my notes.md`, multipart with exact markdown, `state.drive` set, handle null, filename updated, clean, later Ctrl+S = PATCH (no second create); folder pick -> `parents:[FOLD2]`; invalid name `a/b` rejected; create failing (429) leaves doc untitled+dirty, retry works | PASS |
| Typing during in-flight save keeps dirty + drafted (uploaded text excluded); double Ctrl+S = 1 PATCH | PASS |
| Autosave of Drive doc goes to `mdwe.draft.file` incl. `drive` link, does not touch `mdwe.draft`; reload restores it linked (dirty), Ctrl+S saves in place, conflict dialog if remote changed meanwhile | PASS |
| Opening a Drive file deletes a kept untitled draft with no prompt | PASS [BUG-20] fixed |
| First Save to Drive leaves stale `mdwe.draft`; reload restores it dirty and un-linked (duplicate trap) | PASS [BUG-21] fixed |
| Local FSA handle open: Ctrl+S saves locally, 0 googleapis requests, no badge; Drive doc -> Ctrl+O local drops the link; Ctrl+Shift+S from Drive doc = local Save As, Drive untouched. (Note: local doc "Save to Drive" re-targets Ctrl+S to Drive and drops the handle) | PASS |
| CORS: works with a server that sends NO CORS headers and 0 preflights (host_permissions) | PASS |
| DOCUMENTED #17: change between metadata GET and PATCH is overwritten | PASS (pins current best-effort behaviour) |
| Ctrl+S on an unedited Drive doc must not upload | PASS [BUG-22] fixed (0/18 PATCHed) |

### Fidelity / normalization report (real api, no-op save = open from Drive, press Ctrl+S, no edits)
Byte-for-byte preserved: 02-lists, 03-code, 11-raw-html, 12-footnotes, and my special docs: escapes (`\#`, `\-`, `1\.`, `\>`, `Snake_case_word`), raw HTML block/`<!-- comment -->`/`<details>`/`<sub>`/`<kbd>`, footnotes (`[^1]`, `[^two]` + definitions), YAML front matter. **Changed** (normalized on write): 01-basic, 04-table (padding), 05-mixed, 06-normalize, 07-nested, 08-table-align, 09-escapes, 10-escapes-block, known-adjacent-lists, and reference-style links (`[the site][ref]` + definition -> inline `[the site](url "Title")`; `<https://…>` autolink kept). All 18 no-op saves still sent a PATCH (BUG-22).
Other measured facts: CRLF file -> editor text has no `\r`, written back LF-only on first edit (no-op stays LF too since it re-serializes); UTF-8 BOM dropped and not re-added; unicode (accents, CJK, emoji, combining, NBSP, ligature) byte-exact in PATCH and multipart; multipart text containing `\r\n--mdwe…` keeps framing; single-word edit diff limited to the normalized lines (01-basic +1 line, 02-lists +1, 05-mixed 3/3, 11-raw-html 1/1, 12-footnotes 1/1).

## Screenshots (qa/screens/)
`drive-dialog-light.png`, `drive-dialog-dark.png` (Open from Drive: 5 rows incl. read-only + long name), `drive-save-dialog-light.png`, `drive-save-dialog-dark.png`, `drive-conflict-light.png`, `drive-conflict-dark.png`, `drive-dialog-notconfigured-light.png` (mock), `drive-dialog-notconfigured-real.png` (shows BUG-19 "Sign-in failed" text). Regenerated on every run.
Visual review of the light conflict + dark open dialog: themed correctly, names truncated with ellipsis, read-only badge visible, Cancel focused in conflict dialog. (Relative times read "6 hours ago" because the emulator's fixed 12:00Z timestamps are older than the box clock; irrelevant.)

## Drive bugs (details/repro/fix in ../BUGS.md)
VERIFIED FIXED (14:2x ET, build BTJ1MUpn): #19, #20, #21, #22, #23. New: #24 (cosmetic: placeholder client id only reported as 'not set up' after clicking Sign in), #25 (note: exact-original behaviour changes).
VERIFIED FIXED: #15 (429 -> quota). Emulator-verified only: #16 (client-side .md filter). DOCUMENTED and pinned: #17. #18 (non-Chrome identity): not verifiable headless, manual.

## Manual (Drive; cannot be automated here - no OAuth client id, real Google account)
1. Create OAuth client (Chrome extension type, ID egbgaoinpgdhchefefmlakihmbddmnfc), `npm run set-client-id`, rebuild, load in **branded Chrome**: consent screen (unverified-app warning, test user), token issue, 7-day test-user expiry.
2. Real Drive: listing (`name contains` prefix-token behaviour for `notes.md`, files with mimeType text/plain / octet-stream, shared-drive files, pagination >50), opening a Google Doc (should be filtered), `capabilities.canEdit` on view-only shared files, `modifiedTime` precision/equality after PATCH (baseline uses PATCH response), new-revision behaviour, folder browsing incl. shared drives.
3. Real `chrome.identity` behaviour: interactive prompt UX, "Invalid OAuth2 Client ID." wording with the actual placeholder (BUG-19), sign-out vs. Chrome profile account, behaviour in Chromium/Edge/Brave (#18), incognito ("Identity API is disabled in incognito").
4. Real conflict with a second device/tab editing the same file; real 401 after token revocation in myaccount.google.com; real rate limiting.
5. Visual check of the Drive dialogs at other viewport sizes / with screen reader.


## Addendum 14:2x ET - Fidelity / normalization (supersedes the 13:5x table above)
Build BTJ1MUpn: no-op save (open, no edit, Ctrl+S) over the 18 docs (13 editor fixtures incl. known-adjacent-lists + 5 special constructs): Drive **0/18 PATCHed, 0/18 bytes changed**; local (FSA stub) **0/18 changed**; getMarkdown()==original for 18/18, isModified()==false 18/18, Ctrl+Z x2 after open never blanks/alters (0/18 Drive, 0/18 local). Previously 18/18 PATCHed and 10/18 changed. CRLF file: unedited stays CRLF and is not uploaded; after one edit the doc is serialized LF-only.


---
# Mermaid + KaTeX (qa/tests/11-mermaid-math.spec.mjs, 36 tests; build index-DUoBI84v.js, zip 15:28)

Hooks verified in code (src/editor/mermaid-math.js, renderers.js): `[data-mdx-node="mermaid|math-inline|math-block"]`, `.mdx-mermaid-render` (svg) / `.mdx-math-render` (`.katex`), per-block `[data-mdx-action="toggle-source"]` ("Edit source" / "Done"; inline math: hover-only pencil, or click the formula), `textarea.mdx-mermaid-source`, `textarea.mdx-math-source`, `input.mdx-math-source`, `.mdx-error[data-mdx-error="mermaid|math"]`, `data-mdx-rendered="ok|error"`. Harness: headless Chromium `--load-extension` (same `ext` fixture), FSA stub for local save, FakeDrive for Drive save; own collectors for requests/responses/`securitypolicyviolation`/console.

| # | area | result |
|---|---|---|
| 1 | Jasser's flowchart (with newlines): 1 SVG, 3 `.cluster`, 10 nodes, 12 edges, 1 dotted edge, all 17 node/subgraph/edge labels present (incl. `T_E=14, T_I=60`, `BBS / UGC / Census 2022`, `Causal Benchmark & Holdout Scoring`), no error, no stray `<body>` nodes, unedited markdown byte-identical | PASS |
| 1 | **Single-line collapsed** version in a fence: **inline error** `Mermaid syntax error: Parse error on line 1: flowchart TD subgraph Data Layer ... got 'subgraph'` (`data-mdx-rendered=error`, no SVG); no crash, no page/console error, source kept verbatim, doc stays editable. Collapsed **bare paste** (no fence): NOT wrapped in a diagram block (by design), inserted as plain text (with `[`/`]` escaped as `\[` `\]`). Multi-line bare paste: auto-wrapped in ```mermaid + rendered | PASS (reported) |
| 2 | sequenceDiagram, pie, classDiagram, gantt (+ stateDiagram-v2, erDiagram, mindmap, journey, `~~~mermaid`, ```` ```Mermaid ````) all render SVG with expected labels, markdown unchanged | PASS |
| 3 | KaTeX inline `$E=mc^2$`, block `$$\int_0^\infty e^{-x^2}dx=\frac{\sqrt\pi}{2}$$`, `\begin{aligned}` render `.katex` (+ `.katex-display`, MathML annotation == source); typing `$x^2$` converts to node; toolbar Diagram / ∑ Math / ∑ Block insert | PASS |
| 4 | Unedited open + save byte-identical: 7 docs (LF, **CRLF**, trailing whitespace on fences/text/`$$`, no final newline, `~~~`/```` ```` ```` fences with info string, invalid diagram/LaTeX, dollar/code) x {local FSA: getMarkdown==orig, isModified false, Ctrl+Z x2, per-block toggle open/close, Ctrl+S bytes; Drive emulator: 0 PATCH, bytes identical}. After one edit elsewhere: fences/math kept verbatim, output re-parses to the same PM doc (idempotent). Only diff seen: the final blank-line/EOL normalisation of the edited paragraph | PASS |
| 5 | Edit via per-block source: markdown gets edited fence immediately (flush before `getMarkdown()`), "Done" re-renders new labels, caret lands after the node and typing works (`typed after` lands in a new paragraph next to `After.`), Ctrl+Z x N walks back to original source and never blanks the doc, Esc reverts, Ctrl+Enter closes, empty source = empty block no error; inline math click->input->Enter, block math textarea, emptying inline math removes node; saved to local + Drive with edited fence/`$$w+1$$` | PASS |
| 6 | Dark mode: mermaid re-renders with mermaid `dark` theme on toggle and back on light; measured contrast of 30 label/shape pairs per theme: worst light 10.8:1, worst dark **4.43:1** (edge labels on their semi-transparent background) - all >= 3; KaTeX colour == paragraph colour in both themes (dark 16.0:1); error text dark 8.3:1 (light 3.9:1). Screenshots: `screens/mermaid-math-{light,dark}.png`, `mermaid-flowchart-{light,dark}.png`, `mermaid-math-errors.png`, `math-light.png`. Visually reviewed dark: readable, light node text on dark nodes | PASS |
| 7 | Malformed: bad mermaid (2 kinds + collapsed) -> inline `.mdx-error[data-mdx-error=mermaid]`; `\frac{`, `\begin{aligned} a &=`, `\left( x` -> `.mdx-error[data-mdx-error=math]`; valid diagrams before/after still render, good inline math still renders, no page error, no console output at all, no stray body nodes, rest of doc editable, fixing the bad diagram via source renders it. **`\undefinedcmd` is NOT flagged (BUG #27)** | PASS + FAIL probe #27 |
| 8 | False positives: `$5 and $10`, price lists/ranges (`$5-$10`, `$3.50`, `$1,000`, `US$5`, `$ 5 $`, `20$`), `$` in inline code + ```js/```javascript/```latex/```text/~~~js/unlabelled fences, `\$a\$`, lone `$`, ```` ```mermaidjs ````/```` ```mermaid-not ````, mermaid fence nested in a ````text fence, indented code: 0 math/mermaid nodes, 0 katex, 0 svg, **no mermaid/katex chunk fetched**; unedited byte-identical; after an edit still 0 nodes on re-parse, literals kept (normalisations seen, all pre-existing: `\$5`->`$5` (harmless, still not math), `~~~js`->```` ```js ````, indented code -> fenced). Ambiguous cases (report): `$100 and 5$` and `$a$b` DO become math (pandoc-like rule: closing `$` not followed by digit); `$$a$$ text` inline math; math in bold splits marks (known limitation); math in table cell / list / blockquote OK; mermaid fence inside list item and blockquote OK; unedited round trip identical in all 11 | PASS |
| 9 | Security: hostile diagrams (`click A href "javascript:..."`, `click B call fn()`, `<img onerror>`, `<script>`, `<a href=javascript:>`, `%%{init:{securityLevel:"loose"}}%%` override attempt, sequence-diagram HTML) + hostile LaTeX (`\href{javascript:}`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlStyle`): **0** window.__pwn flags, **0** dialogs (no alert), 0 `<script>`, 0 `onerror`/`on*` attributes, 0 javascript: hrefs, clicking nodes runs nothing; `\href`/`\url` with trust:false -> error/plain; hostile source kept verbatim in markdown. Requests: **0 non-extension** requests in every render session; **0 `securitypolicyviolation`**, 0 CSP console messages; 11 KaTeX woff2 fonts fetched from `chrome-extension://<id>/editor/assets/` all 200, no ttf/woff fallback fetched, `document.fonts` shows KaTeX_Main/Math/AMS/... loaded, all 59 `url()` refs in the CSS exist, none remote. Static: manifest CSP still exactly `script-src 'self'; object-src 'self'`, permissions/host_permissions/web_accessible_resources unchanged; **66 JS files (12.0 MB) scanned: 0** `eval(`, `new Function(`, `Function("...")`, `Function(x)()`, string `setTimeout`, `document.write`, `unsafe-eval`, `importScripts`, WebSocket/XHR/sendBeacon; all 47 dynamic `import()` specifiers relative. Caveat: `<img src=https://remote>` in a mermaid label IS fetched (BUG #29 info) | PASS |
| 10 | Lazy loading: cold open of the editor (typing, code/table/list docs, `$5 and $10`): **only `index-DUoBI84v.js` (1.52 MB) + `index-BgwsAwTr.css`**; no mermaid/katex/diagram chunk, 0 KaTeX fonts; median cold open->ready 85 ms (5 runs). Math-only doc: `katex-*.js` + 2 fonts, no mermaid. Flowchart doc: `mermaid.core` + flowDiagram + 10 helper chunks = 12 of 64 JS files (4.56 of 12.0 MB) in ~0.5-0.6 s; 2nd flowchart: 0 new requests; pie adds `pieDiagram` + `cynefin` (1.3 MB shared) + 4 small; all 200 | PASS |
| 11 | Existing features: drag-drop of a mermaid/math file (renders, clean, byte-identical; dirty drop asks "Discard unsaved changes?"); autosave draft holds fences/`$$` intact incl. per-block-source edits, reload restores dirty + re-renders; source edit pending at Ctrl+S time is flushed; whole-doc Source view shows verbatim markdown, edits there re-render on return, 3x toggling stable, per-block-open + whole-doc toggle OK; `file://` content script button -> editor renders (content byte-identical); `?src=` route; Ctrl+B / bold after diagrams. **BUG #26** and CRLF+Source (BUG #28, pre-existing) reported | PASS + FAIL probe #26 |

## Real bugs (details/repro in ../BUGS.md)
- **#26 [low-med]** Ctrl+S / Ctrl+O ignored while focus is inside a per-block source field (mermaid textarea, math textarea/input): `stopPropagation()` on all keys; `defaultPrevented=false` -> also risks the browser's own Save dialog. Probe `[BUG-26]` FAILS (0 writes in all 3 field types).
- **#27 [low]** `\undefinedcmd` rendered red but not tagged `.mdx-error`/`data-mdx-rendered=error` (only `.katex-error` is detected). Probe `[BUG-27]` FAILS.
- #28 [low, pre-existing] CRLF -> LF when the whole-doc Source view is toggled (also for plain docs). #29 [info/privacy] remote `<img>` in a mermaid label is fetched on open. #30 [note] size: extension/ 13 MB, zip 3.3 MB (was 0.37), plain flowchart lazily loads 4.56 MB incl. 3.17 MB `elk`.

## Test-only changes this round (src/ and extension/ untouched)
- `04-roundtrip` needed no change (auto-picks the 9 new fixtures 13-20 + known-math-in-emphasis: 24/24 incl. `roundtrip.test.mjs` "22 docs: 11 exact, 9 normalized (stable), 0 failed").
- `10-drive` `docs()` hard-coded 18 docs -> now excludes the 9 mermaid/math fixtures (the same 18-doc probe as before; mermaid/math byte-identity is covered by 11).
- `01-static` "Drive code: bundle has no unexpected URLs" and "...no setAttribute('style')": the lazily loaded vendor chunks (mermaid, chevrotain, katex, lodash) contain library doc/issue/licence links in error strings and SVG `setAttribute("style")`; allow-list extended for NON-entry chunks (github, chevrotain.io, wikipedia, langium, lodash, w3.org, eclipse, ...) and the style check restricted to the entry bundle. The entry bundle keeps the original strict allow-list; 11-mermaid-math scans all chunks for eval/Function/network APIs and non-relative import().
- `lib/fixture.mjs` `extReal`: the shipped manifest now carries a real-looking client id (14:28) so the "manifest as shipped = placeholder" test could no longer pass; `extReal` now makes a copy with `YOUR_CLIENT_ID.apps.googleusercontent.com` when the shipped one is not the placeholder.
- 11: `focus('end')` in TipTap is asynchronous -> helper waits for `document.activeElement` to be ProseMirror (a test race found by `--repeat-each`, not an app bug).

## Only verifiable manually
1. Real branded Chrome: visual quality of diagrams / KaTeX at other zoom levels, OS dark mode default, very large diagrams (performance on 200+ nodes), print.
2. Whether Ctrl+S inside a diagram/math source field actually opens Chrome's "Save page as" (BUG #26; the headless test only proves `defaultPrevented=false` and 0 writes).
3. Real clipboard paste from another app (Playwright dispatches a synthetic ClipboardEvent): Shift+paste, rich-text (text/html) clipboard containing diagram text, paste of CRLF text.
4. Chrome Web Store upload/review with the 13 MB / 135-file package; extension load time on a slow disk (66 JS files exist but only 1 is read at startup).
5. Font rendering of KaTeX in the real browser (headless verifies fonts load, not glyph shapes), IME/composition typing inside math inputs, screen-reader output of the SVG/MathML.

---
# Drive folder search (qa/tests/13-drive-search.spec.mjs, 46 tests; 2026-09-30 13:3x-13:51 ET)

**Build under test:** `extension/editor/assets/index-DdqL4zgr.js` (md5 e2ea7f28..., 13:11:50), `dist/md-editor-ext.zip` 13:11:52 == `extension/` (`diff -r` clean, 133 files), `extension/manifest.json` byte-identical to git HEAD (permissions `storage`,`identity`; host `https://www.googleapis.com/*`; CSP and oauth2 unchanged). src/ and extension/ untouched by QA.
**Result:** full `npm test` (run 13:34-13:51, log `qa/out/full-run-drive-search.log`): **312 pass / 3 fail (315)**. Previous 269 all still pass (incl. 10-drive 66/66); the 3 failures are the intentional probes `[BUG-33]`, `[BUG-34]`, `[BUG-35]` (new 13: 43 pass / 3 probe-fail). No `[PENDING-UI]` skips remain: the UI landed, all 22 UI tests ran for real.

## Harness
- `lib/drive.mjs` FakeDrive extended (test-side only): folder objects (`addFolder`, `tree('A/B/C')`, `addSharedDrive`), real `q` grammar parser (strings allow only `\'` and `\\`; anything else -> HTTP 400, so escaping bugs surface), `name contains` (case-insensitive substring; `nameMatch='token-prefix'` available), `mimeType =`, `trashed =` (incl. trashed-via-parent), `in parents`, `orderBy` validation (name/name_natural), `fields` projection, `pageSize`/opaque `pageToken` bound to the query (garbage token -> 400), empty pages that still carry a token (`emptyPages`), shared-drive params (`corpora`, `supportsAllDrives`, `includeItemsFromAllDrives`; `user` corpus = accessed items only, per docs; `allDrives`; `drive`+`driveId`; `incompleteSearch`), `files.get` for folders / `root` alias (real root id) / shared-drive roots, 403 per id (`forbidden`), URL-length cap (414), hook helpers `delay()`, `hold()` (release in any order, for stale-response tests), `inject({status,reason,abort,times})`. Existing tests unchanged except 10-drive's dialog selector `input.gdui-input` -> `input.gdui-input:not([data-role=folder-search])` (the dialog now has two inputs; test-side only). 10-drive 66/66 green.

## API tests (24; window.__mdwe.driveApi, real createDriveApi)
hits / case-insensitive / multiple / key set `{id,name,path}`; no results -> `{folders:[],nextPageToken:null}`; blank & whitespace-only (space, tab, newline, NBSP, EM SPACE) == browse (request identical to HEAD: `'root' in parents`, orderBy name, pageSize 100, fields `nextPageToken,files(id,name)`, no path, no parent lookups); padded query trimmed; search ignores parentId; escaping table of 16 hostile queries (quote, dquote, backslash, backslash-quote combos, trailing backslash, %, &, #, emoji, CJK, `x' or name contains '`, `') or trashed = true or ('`, `a%27b`, `?q=1&x=2`) -> sent escaped, matched literally only, 0 emulator 400s, no injection; 5,000-char query OK and 414 -> DriveError(http,414); trashed / trashed-parent / md / Google Doc / shortcut / image excluded; pagination (130 folders = 3 pages, all unique, stable order, same q, empty-page-with-token, bad token -> 400); shared-drive folders + path starting with drive name; unresolvable root / no parents -> path undefined; path depth 1/3, same-name folders different paths; 8-level limit; 403 parent -> undefined; sequential cache (repeat/sibling searches do not re-fetch); errors (401 refresh once then 'auth' + sign-in message after exactly 2 attempts, 403 reason, 403/429 rate limit -> quota, 500/503/400 -> http, abort -> offline, signed out -> 'Sign in to Google Drive first' with 0 requests, parent-lookup 500 never fails a search); recents (order, dedupe-to-front, limit 8, root/null/id-less ignored, optional path, stored at `driveRecentFolders`, corrupt storage tolerated); createFile into a searched folder auto-adds `{id,name,path}` (not for root, not for a failed save), survives reload; no new manifest permissions; only googleapis contacted.

## UI tests (22; [data-role=folder-search], `[data-action=clear-search|up|more|retry|signin|save]`, `li.gdui-row[data-kind=result|folder|recent]`)
layout (search box above crumbs/list; name field + Save/Cancel intact); debounce (fast typing = 1 request with final text, prefix never sent; request leaves after ~300 ms; 450 ms pause = 2 requests; Enter flushes without a duplicate); trim / whitespace-only = browse with no request; rows show name + path, same-name folders distinguishable, Up disabled while searching, first row preselected, live region; single click selects only, dblclick / Enter picks (dest = `path / name`, search cleared) and Save POSTs `parents:[id]`; arrows keep focus in the box, Enter never saves, first Esc clears, second Esc closes, Esc on empty closes; Enter on empty box / no results does nothing, Enter in name field still saves; clear button (visible only with text, restores browsing at current subfolder, focuses box, cancels pending and in-flight queries); stale responses in both orders and a stale error never overwrite newer results; Searching / empty / error(500)+Retry / offline+Retry / 403 / 429 / persistent-401 Sign in states, Save still works after an error, 401 mid-search refreshes transparently; Load more (50 -> 100 -> 120, no dupes, failing page -> "Couldn't load more" + Retry); Recent (first 5, root only, hidden while searching and in subfolders, dblclick picks, searched+saved folder becomes Recent #1, deduped; malformed/corrupt storage harmless); focus management (never drops to body, Tab/Shift+Tab trapped, close returns focus to the toolbar button); light+dark contrast (input/path/name/dest >= 14:1 light, >= 10:1 dark; placeholder 4.61 / 3.85; subhead 5.4/5.8; clear 6.0/7.0) + screenshots `qa/screens/drive-search-*.png`; 25x rapid open/close with typing / Esc mid-request / late responses: 0 console errors, no leftover overlay, pending debounce never fires after close; unedited Drive doc Ctrl+S -> "No changes to save", 0 requests; read-only "Copy of" through search writes the ORIGINAL bytes to the chosen folder, 0 PATCH; drafts untouched by typing in the box, cleared by a save into a searched folder, Ctrl+S inside the dialog does not leak; XSS (`<img onerror>`, `<script>`, `<svg onload>`, markdown, entities in folder names AND parent paths -> text only in rows, crumb, hint, empty state; `window.__xss` never set); 500 folders in one page: typed -> rendered 1.8 s (incl. 300 ms debounce), 40 ArrowDown 0.3 s, typing in name field 0.1 s, re-search 0.8 s, 10 Load-more pages OK; Up/breadcrumb after a search pick.

## Real bugs (BUGS.md #33-#35, all OPEN, all API-side; UI verdict: no UI bug found)
- **#33 [low-med, confirm on live Drive]** no `corpora` (default `user`) -> shared-drive folders the user never opened are not found; needs `corpora=allDrives` (+ `incompleteSearch` handling). Probe `[BUG-33]`.
- **#34 [low-med]** parent lookups not de-duplicated: 40 results under one parent = 80 parallel `files.get` (500 results = 1000). Cache the in-flight promise. Probe `[BUG-34]`.
- **#35 [low]** a transient parent-lookup failure (500/429/offline) is cached as "unresolvable" for the life of the tab -> path stays blank. Probe `[BUG-35]`.
- Info: >8-level paths drop the topmost ancestors silently (no ellipsis, "My Drive" lost); `addRecentFolder` get-then-set loses a recent under concurrent saves (4/5) but the UI serialises saves; real Drive `contains` is word-prefix, so "roj" will not find "Projects" (emulator is substring unless `nameMatch='token-prefix'`).

## Request strings the API sends (from qa/out/drive-search-requests.json)
Always `GET https://www.googleapis.com/drive/v3/files?q=<below>&orderBy=name_natural&pageSize=50&fields=nextPageToken,files(id,name,parents)&supportsAllDrives=true&includeItemsFromAllDrives=true[&pageToken=...]` with `Authorization: Bearer <token>`; no `corpora`, no `driveId`. `q` is always prefixed with `mimeType = 'application/vnd.google-apps.folder' and trashed = false and `:
| typed | q suffix |
|---|---|
| `proj` | `name contains 'proj'` |
| `Q3 plan` | `name contains 'Q3 plan'` |
| `it's` | `name contains 'it\'s'` |
| `say "hi"` | `name contains 'say "hi"'` |
| `back\slash` | `name contains 'back\\slash'` |
| `\'` | `name contains '\\\''` |
| `x' or name contains '` | `name contains 'x\' or name contains \''` |
| `100% & #1` / `café 日本` / `📁` | unchanged inside the quotes (URL-encoded on the wire) |
| `  pad  ` | `name contains 'pad'` (trimmed) |
| `` / `   ` (browse) | `'root' in parents`, orderBy=name, pageSize=100, fields=nextPageToken,files(id,name) |
Parent lookups: `GET /drive/v3/files/<id>?fields=id,name,parents&supportsAllDrives=true`. Recents key: `chrome.storage.local.driveRecentFolders`.

## Only verifiable manually
1. Real Google account: `name contains` word-prefix semantics, `name_natural` ordering, shared-drive coverage (#33), `incompleteSearch`, rate-limit behaviour of the parent-lookup burst (#34), real parents (My Drive root id vs `root` alias, multi-parent folders: api uses `parents[0]`).
2. Screen reader output of the listbox / `aria-activedescendant` / live region; IME composition in the search box; real-device focus ring visibility.
3. Visual polish of path truncation in a 420 px dialog with very long paths (screenshots `qa/screens/drive-search-*.png` are the only automated evidence).

---
## Drive folder search - round 2 (fixes for #33/#34/#35; 2026-09-30 13:55-14:18 ET)
**Build:** `index-BMAUomhp.js` (md5 35c7a5d0...), `dist/md-editor-ext.zip` 13:53 == `extension/` (diff -r clean, 133 files), manifest byte-identical to git HEAD, no `eval(`/`new Function(` in the bundle. src/ and extension/ untouched by QA.
**Runs:** 13 + 10 together: 121/121 pass (13 min 5.9); FULL `npm test` (log `out/full-run-drive-search-fix.log`): **321 / 321 pass** (was 312 pass + 3 probe failures; 315 -> 321 tests: +6 new tests). All three `[BUG-3x]` probes now pass.
**Verdicts:** #33 VERIFIED FIXED, #34 VERIFIED FIXED, #35 VERIFIED FIXED. No new bugs.
- #33: search adds `corpora=allDrives`; never-accessed shared-drive folders found (emulator: `user` corpus = accessed only, `allDrives` = all member drives, per Drive docs table: includeItemsFromAllDrives=true + corpora=allDrives + supportsAllDrives=true is a documented valid combination); mixed My Drive + shared hits: union, no dupes; `incompleteSearch:true` passed through on the `listFolders` result only when Drive sends it; UI test: with incompleteSearch the dialog renders normally (no error state, not surfaced - acceptable).
- #34: 40 siblings -> exactly 2 `files.get` (parent + root); 500 results over 60 distinct ancestors -> 61 lookups, max 1 per id; concurrent searches share in-flight lookups; repeat search 0 lookups.
- #35: 500 / abort (offline) / 429 on a lookup -> path undefined once, next search resolves; siblings share the one failed in-flight lookup (1 request); retry = parent+root once; success cached. Info: a permanently 403 parent is retried once per search (bounded).
**Regression checks:** only `corpora=allDrives` was added to search requests (param key set asserted exactly: q, orderBy, pageSize, fields, supportsAllDrives, includeItemsFromAllDrives, corpora; no driveId); `corpora=allDrives` on every page of a paginated search; blank/whitespace browse request unchanged (no corpora, same keys as HEAD); all escaping rows unchanged. 
**New typical request:** `GET https://www.googleapis.com/drive/v3/files?q=mimeType = 'application/vnd.google-apps.folder' and trashed = false and name contains 'proj'&orderBy=name_natural&pageSize=50&fields=nextPageToken,files(id,name,parents)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives` (tricky queries differ only in the escaped string; see table above). Test changes: updated request-shape assertions, renamed probes to positive assertions, +mixed corpus, +incompleteSearch API and UI, +500-result dedupe, +concurrent dedupe, +failed-then-retried lookup tests.
**Manual-only (unchanged + new):** real shared drives (membership with thousands of items: does `allDrives` actually return partial/`incompleteSearch` results or slow responses), real Drive's word-prefix `contains`, rate limits, screen reader / IME; whether to surface `incompleteSearch` in the UI is a product call (not shown today).


---
# New note per click (QA 2026-10-01 09:52-11:3x ET)
**Build:** `extension/editor/assets/index-BCILrRUb.js` (md5 31f3e46d..., 09:50:49), `dist/md-editor-ext.zip` 09:50 == `extension/` (diff -r clean, 133 files). `extension/manifest.json` is **byte-identical to git HEAD**: permissions exactly `storage`, `identity`; host `https://www.googleapis.com/*`; CSP `script-src 'self'; object-src 'self'` unchanged; content scripts unchanged (file:///*.md, *.markdown). **No `commands` entry: Alt+N is NOT declared in the manifest** (not rebindable at chrome://extensions/shortcuts; it is an in-page keydown handler and only works while an editor page has focus). No `eval(` / `new Function(` in the bundle or `background.js`; `editor/index.html` has exactly one module script. Changed vs HEAD: `background.js`, `editor/index.html`, built assets (sources `src/page/{main.js,drafts.js (new),index.html,page.css}`).
**Harness:** `qa/tests/14-new-note.spec.mjs` (61 tests) + new helper module `qa/lib/notes.mjs` (context-wide dialog/error hook, `clickIcon`, `info`, storage helpers, Save-As-`suggestedName` recorder `fsaRecorder`, stop-service-worker). "Icon click" = the REAL `chrome.action.onClicked` listeners invoked in the service worker via `chrome.action.onClicked.dispatch(activeTab)` (same as spec 02): a physical toolbar click is not possible headlessly. The in-page New button / Alt+N use the real DOM path (click / keyboard.press('Alt+n')).
**Runs:** spec 14: 61 tests = 51 pass + 10 failing `[BUG-nn]` probes. FULL `npm test` (log `out/full-run-new-note.log`): **371 passed / 11 failed of 382** (321 old + 61 new). 10 failures = intentional bug probes (below). The 11th, `03-editor › link via toolbar popover`, is a pre-existing timing flake unrelated to this feature (selection+popover under load: got `site[https://example.com/a](...)`); it passes alone and in a re-run of all of spec 03 (13/13). All 321 previously passing tests otherwise still pass.
## Per-area verdicts
| Area | Verdict |
|---|---|
| A. icon click -> new independent tabs (tab1 text/draft untouched, tab2 empty+focused+unmodified, no beforeunload, never reuses plain/?doc/?src tabs, placed after active tab, legacy slots not clobbered) | PASS |
| B. rapid clicks (5 in one tick, 7 with 0-10 ms gaps, 5 New-button clicks/dblclick via message path) | PASS: distinct Untitled-N, uuids, slots, no gaps |
| C. naming counter (1,2,3; monotonic after closing; stored-draft numbers skipped incl. legacy keys and `.MD`; non-matching names ignored; session cleared -> restart at 1 but stored numbers skipped; title, file bar, Save As `suggestedName`; after save name/title update, slot cleared, normal file, Ctrl+S in place) | PASS except **#37** (session reset + still-open untouched tab -> duplicate name) |
| D. reload restore (content, name, slot, URL; empty note stays empty; 2 tabs independent; `?new` rewrite; garbled/missing params; `?doc=` weird ids) | PASS except **#36** (negative/huge n) and **#43** (two tabs on same ?doc=) |
| E. autosave isolation / storage (only own slot written; never `mdwe.draft`; theme shared; no entry for untouched/erased/whitespace notes, 20 tabs -> 0 keys) | PASS |
| F. Drafts dialog (lists closed-with-text only; title/preview/"just now"; Esc/overlay/Close; focus on Close; empty state; Discard confirm text, cancel keeps, confirm removes; legacy-slot adoption incl. drive link; XSS inert; dark mode contrast >= 13:1; 102 drafts incl. a 2 MB one in ~65 ms) | PASS except **#38, #39, #41, #42** |
| G. concurrency (draft open in A not listed in B; reload keeps lock; appears after close) | PASS for the lock; **#39** (double Open -> 2 live editors), **#40** (stale Discard) |
| H. regressions (manifest/zip/bundle, plain load + legacy slot, ?src= local, ?src= over ?new=, Drive-linked draft restore, Save to Drive / Open from Drive in a new-note tab, Print, Mermaid/KaTeX, Source, Ctrl+S/O, drag-drop, Alt+N/New button with unsaved text, Alt+N conflicts, pre-update legacy drafts, content.js unchanged + open-in-editor still navigates to ?src=) | PASS |
| I. edge (SW stopped via CDP then icon/message/burst-of-5 on cold start; 50 tabs in ~3 s; history.length / Back / forward; locks) | PASS |
## Bugs (details, repro, fix in BUGS.md)
#36 negative/huge `n` accepted (low). #37 duplicate `Untitled-1` after session reset (low-med). #38 legacy `mdwe.draft` of a still-open plain tab offered by Drafts (med). #39 Open twice -> two editors on one slot; row stays enabled after Open (med). #40 stale-dialog Discard removes a live draft (low-med). #41 stale `Drafts (N)` count after Open (low). #42 long file name overflows the Drafts dialog (low). #43 two tabs on one `?doc=` (duplicate tab/restored tab) share a slot (med).
## Exact storage keys observed
`chrome.storage.local`: `mdwe.draft.doc.<uuid>` = `{text, name, savedAt, drive}` (one per note with text, removed when the text becomes empty/saved); legacy `mdwe.draft`, `mdwe.draft.file` (same record shape); `mdwe.theme`; `driveRecentFolders` (unchanged). `chrome.storage.session`: `mdwe.untitledNext` (next number). Web Locks: `mdwe-doc-<uuid>` (exclusive, held by each ?doc= tab forever). Nothing else was written; an untouched new note writes nothing.
## Only verifiable manually
1. A real toolbar-icon click (pinned and unpinned/overflow-menu icon, icon in a second window / incognito if allowed, `index+1` placement with several windows, window focus) - tests call the same listener from the service worker. 2. Alt+N with a real keyboard in a real Chrome (Alt+N may be consumed by the OS/window manager on Linux/Windows menus; it is not at chrome://extensions/shortcuts because it is not a `commands` entry). 3. Real browser restart with session restore (counter reset, restored `?doc=` tabs, #37 for real; are restored tabs given their lock before Drafts is opened?), crash recovery. 4. Real service-worker idle shutdown (~30 s) followed by a toolbar click (we stop it via CDP). 5. Multiple windows / profile switches; Duplicate tab in the tab strip (#43 reproduced by loading the URL twice). 6. Visual check of the Drafts dialog (`qa/screens/14-drafts-*.png`). 7. Real Drive account for Save/Open in a new-note tab (emulator only).


---
# New note per click - ROUND 2 (QA 2026-10-01 11:35-12:35 ET)
**Build:** `extension/editor/assets/index-DrD0oqKO.js` (md5 25dbb4da..., 11:33:21, the only `index-*.js`; one module script), `dist/md-editor-ext.zip` 11:33 == `extension/` (diff -r clean, 133 files). `manifest.json` and `content.js` byte-identical to git HEAD: permissions exactly `storage`,`identity`, CSP `script-src 'self'; object-src 'self'`, no `commands` (Alt+N still an in-page shortcut). No `eval(`/`new Function(` in bundle or `background.js`. Changed: `background.js`, `editor/index.html`, bundle (sources `src/page/{main.js,drafts.js}`, `page.css`).
**Runs:** spec 14 = 94 tests (61 from round 1 + 33 new): 90 pass, 3 fail, 1 skipped. FULL `npm test` (log `out/full-run-new-note-r2.log`, 19.8 min): **411 passed / 3 failed / 1 skipped of 415** (was 371 pass + 11 fail of 382). All 321 pre-existing tests pass, including `03-editor > link via toolbar popover` (no flake this time). Failing tests = `[BUG-44]` x2 (G + J3) and `[BUG-45]` (K); skipped = `chrome.tabs.discard` (terminates the headless context; manual).
## Round-1 bugs: verdicts
| Bug | Verdict | Evidence |
|---|---|---|
| #36 n range / uuid | FIXED | ?new=-5, 0, abc, 1e3, 99999999999999999999, ?n=-3 all `Untitled-1.md`; `?doc=` non-uuid rejected (with `new` -> fresh uuid note, without -> plain page load); only uuid slots are ever created |
| #37 duplicate Untitled-1 after session reset | FIXED | `mdwe-num-N` shared locks; number skipped with session cleared, released on close/crash, kept across reload; duplicate-tab copies share the number until both close |
| #38 legacy draft of open plain tab offered | FIXED (side effect: new #45) | plain + ?src= tabs hold shared locks on both legacy slots; two plain tabs at once fine; hidden while any is open, listed at once after the last closes |
| #39 double Open | FIXED for slot drafts (residual #44 for legacy drafts) | row removed on click, dblclick / two dialogs -> exactly 1 tab; stale row opens nothing; count/empty state immediate |
| #40 stale Discard | FIXED | confirm then alert "was opened in a tab in the meantime, so it was not discarded", slot + live tab intact; Discard in the opening window refused |
| #41 stale count | FIXED for dialog actions | `Drafts (N)` right after Open/Discard and equal to dialog later. Info: a background tab does not learn that another tab's close made a draft visible until a storage write (locks are not observable) |
| #42 long name | FIXED | 117/300-char, words, emoji, RTL names: scrollWidth == clientWidth (558), ellipsis + title, Open/Discard inside box and clickable |
| #43 duplicate tab | FIXED | fresh uuid + copy of text (+Drive link) + status "This note is open in another tab: working on a copy" (visible only briefly, then 'Draft autosaved'); type in both, reload both -> independent; restoring a closed tab takes its original slot; simultaneous loads -> one original + one copy; busy original cannot deadlock (ifAvailable) |
## New bugs
**#44** legacy draft Opened from two dialogs at once -> second tab is an EMPTY note (no data loss). **#45** a ?src=/plain tab hides BOTH legacy drafts (also the one it does not own) from every Drafts dialog while open. Details/repro/fix in BUGS.md.
## Lock-design regression hunt (K) - no deadlock / leak found
Lock names/modes exact (`exclusive mdwe-slot:<key>` + `shared mdwe-num-N` per doc tab; `shared mdwe-slot:mdwe.draft` + `...draft.file` per plain/?src tab; nothing pending); 10 plain + 10 doc tabs ready in 1.7 s; 10x reload/F5 never produces a "copy"; page crash (all extension tabs, one renderer) releases every lock and drafts are listed + Open restores; history navigation away/back releases and re-takes; 50 tabs = 100 locks, Drafts opens in 73 ms, closing 49 without beforeunload lists exactly the typed notes; Save As keeps locks, re-edit writes the same slot; plain-tab Ctrl+O switches to mdwe.draft.file without lock gaps; legacy Open keeps Drive link and Save to Drive uses same id + stored modifiedTime; ?src= + Drive flows unchanged; Drafts works from plain/?src= tabs.
## Focus / a11y
Focus trap verified (Tab/Shift+Tab cycle among Open/Discard/Close, also with only Close; never leaves the dialog); Esc, Close, overlay click, Enter-on-Close return focus to the editor (after one frame); focus stays in the dialog after Discard; `aria-modal=true`.
## Only verifiable manually
Real toolbar click (pinned/unpinned, several windows); real Alt+N keypress (not in manifest, OS may swallow Alt+N); real browser restart / session restore (#37 for real, restored duplicate tabs); Chrome's tab Duplicate menu; **real tab discarding / Memory Saver** (`chrome.tabs.discard` kills the headless context here, so the lock-release-while-tab-shell-remains case is untested: expectation = draft listed, reactivated tab reloads on its slot or as a copy if opened meanwhile); real bfcache (extension pages are not bfcache eligible when they hold locks? untested); real service-worker idle shutdown; real Drive.
