# QA REPORT — Markdown WYSIWYG Chrome extension (MD Extension QA)

Run: 2026-09-29 ~10:50 ET, `cd qa && npm test` (Playwright 1.x, bundled Chromium 153 headless-shell via `channel:'chromium'`, persistent context, `--load-extension`, 1 worker, ~2 min).
Build under test: `extension/editor/assets/index-mr2HYmiP.js` (built 10:45 ET, after Extension Dev removed top-bar `#btn-source`; Editor Dev's BUG-8/9/10 fixes NOT yet included).
Raw log: `qa/out/full-run.log`, machine-readable: `qa/results.json`, screenshots: `qa/screens/`.

## Summary: 74 passed / 5 failed (total 79)
All 5 failures are deliberate bug probes for OPEN bugs (see ../BUGS.md): BUG-8 (x2), BUG-9 (x2), BUG-10 (x1). No unexplained failures. Earlier in the session the harness also caught BUG-7 and BUG-11; both now pass after the Extension Dev fixes (verified on this build).
Real-Chrome-only items (see Manual) are not counted.

## Results per test

### 01-static.spec.mjs
| result | test |
|---|---|
| PASS | manifest valid + permissions only ["storage"] |
| PASS | CSP present, strict, no unsafe-eval/unsafe-inline/remote |
| PASS | editor page built: index.html exists |
| PASS | no inline <script>, inline on*= handlers, javascript: URLs in extension HTML |
| PASS | no remote URLs loaded by html/css; report http(s) strings in JS |
| PASS | eval / new Function / setTimeout(string) in extension JS (report facts) |
| PASS | innerHTML/outerHTML/insertAdjacentHTML sinks in hand-written code (info) |

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
| FAIL | fixture 09-escapes.md: idempotent + no content loss |
| PASS | fixture known-adjacent-lists.md: idempotent + no content loss |
| PASS | Editor Dev roundtrip.test.mjs (node/jsdom) runs |
| FAIL | [BUG-9] escaped block-start chars keep their meaning after serialize (\#, \-, 1\., \+, \---) |

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
| FAIL | [BUG-8] task list layout: checkbox and text on the same line (light + dark) |
| PASS | [BUG-7b] exactly one visible source toggle in UI |
| PASS | Source mode: Save/Download uses textarea content; dirty logic works when only source edited |
| PASS | Tab in source textarea inserts 2 spaces (does not leave field) |
| PASS | large document (2000 paragraphs + 200-row table): load + type latency |
| PASS | unicode / emoji / CRLF input survives; CRLF normalized |
| PASS | Ctrl+S when not focused in editor (focus on toolbar button) still handled and default prevented |
| PASS | Open cancelled via fallback input (no file) is silent |
| FAIL | [BUG-8b] task-list CSS selectors match rendered DOM (li[data-type=taskItem]) |
| FAIL | [BUG-10] raw HTML / comments / footnotes survive open+save |

## Evidence / facts by area

### 1. Static / permissions / CSP — PASS
- manifest_version 3, `permissions == ["storage"]`, no host_permissions / optional perms / externally_connectable, `web_accessible_resources: []`, all referenced files exist.
- CSP `extension_pages: "script-src 'self'; object-src 'self'"` (no unsafe-eval/inline, no remote).
- `extension/editor/index.html`: 1 external module script (`./assets/index-*.js`), 1 stylesheet; **no inline `<script>`, no `on*=` attributes, no `javascript:`**, no remote refs.
- Bundle (1.43 MB, ~44.9k lines, unminified): **0 occurrences of `eval(`, `new Function(`, `Function("…`, `setTimeout("string")`, `document.write(`** (scanned every .js under extension/). No `importScripts`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, dynamic remote import/fetch. `WebAssembly` appears only as a highlight.js language name. `innerHTML` used only inside ProseMirror internals (clipboard/parsing), not in hand-written code (`background.js`, `content.js` have no HTML sinks). The only http(s) strings in the bundle are library comments/doc links (prosemirror.net, github.com, php.net, docs.python.org, spec.commonmark.org, …).
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

## Final re-run (11:5x ET, build with Editor Dev BUG-8/9/10 fixes)
Full suite: 82 passed, 0 failed. BUG-8, 9, 10, 12 verified fixed. Remaining open: #13, #14 (info, documented), #5 (manual: file-URL access toggle, real Chrome .md render/download).
