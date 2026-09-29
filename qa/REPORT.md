# QA REPORT — Markdown WYSIWYG Chrome extension (MD Extension QA)

Run: 2026-09-29 ~10:50 ET, `cd qa && npm test` (Playwright 1.x, bundled Chromium 153 headless-shell via `channel:'chromium'`, persistent context, `--load-extension`, 1 worker, ~2 min).
Historic header (first run). See Summary below for the latest build.
Raw log: `qa/out/full-run.log`, machine-readable: `qa/results.json`, screenshots: `qa/screens/`.

## Summary (latest full run 14:21-14:27 ET, `cd qa && npm test`, 1 worker, 5.6 min): **155 passed / 0 failed (155 total)**
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
