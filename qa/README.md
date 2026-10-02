# md-editor-ext QA harness

Automated Playwright tests for the MV3 Markdown WYSIWYG extension in `../extension/` (build first: `cd .. && npm run build`).
Nothing outside `qa/` is modified by the harness (except `../BUGS.md` which QA appends to by hand).

## Setup (once)
```bash
cd /workspace/md-editor-ext/qa
npm install
npx playwright install chromium          # bundled Chromium / headless shell (Chrome 137+ branded builds ignore --load-extension)
# `--with-deps` was NOT needed on this box.
```

## Run
```bash
npm test                                            # everything (~2 min, 1 worker, headless)
npx playwright test tests/03-editor.spec.mjs        # one file
npx playwright test -g "BUG#1"                      # by title
npx playwright test --headed                        # needs a display (or: xvfb-run -a npx playwright test)
```
Outputs: console log per test (facts/diffs printed), `results.json`, screenshots in `screens/`, round-trip outputs in `out/roundtrip-*.md`.
Exit code is non-zero if any test fails. **Some tests are intentionally "bug probes" that fail until the bug is fixed** (titles start with `[BUG-n]`, see `../BUGS.md`).

## How the extension is loaded
`lib/fixture.mjs` → `chromium.launchPersistentContext(tmpdir, { channel: 'chromium', headless: true, args: ['--disable-extensions-except=…', '--load-extension=…'] })`
(new headless, no xvfb needed). Extension id is taken from the service-worker URL. Each test gets a fresh profile.
Helpers: `openDriveEditor(ext,{drive,identity,mock,...})` (lib/drive.mjs), `openEditor(ext, {query, init, arg, after})` (collects console errors/dialogs, `addInitScript`), `fsaStub()` (in-memory File System Access `showOpenFilePicker`/`showSaveFilePicker` with `window.__fsa` recording writes), `md()/setMd()/storageGet()`.

## Files
| file | covers |
|---|---|
| tests/01-static.spec.mjs | manifest, permissions, CSP, remote URLs, eval/new Function, inline script/handlers |
| tests/02-loads.spec.mjs | SW registers, no console errors, no remote requests, action click → editor tab, background message validation |
| tests/03-editor.spec.mjs | typing, toolbar (bold/heading/lists/tasks/table/link/image/code block/undo), source toggle, theme |
| tests/04-roundtrip.spec.mjs | every `src/editor/fixtures/*.md` through built editor (idempotence, token loss, structure preserved) + runs `src/editor/roundtrip.test.mjs` |
| tests/05-fileio.spec.mjs | fallback input, drag-drop, download, dirty indicator, Ctrl+S/O, FSA stub same-handle save |
| tests/06-draft.spec.mjs | autosave/draft, restore, clear on save, `?src=` behaviour, BUGS #1–#4 verification |
| tests/07-content-script.spec.mjs | `file:///tmp/test.md` content-script button |
| tests/08-screenshots.spec.mjs | light/dark/source screenshots |
| tests/09-probes.spec.mjs | XSS/untrusted markdown, remote image, task-list layout, source sync, large doc, unicode, misc |
| tests/12-print.spec.mjs | Print / Save as PDF: button, Ctrl/Cmd+P, print-media shell, PDF content (pdftotext/pdftoppm), dark->light, page breaks, long doc, Source mode, setPrintLinks, safety |
| tests/11-mermaid-math.spec.mjs | Mermaid + KaTeX: render, paste, byte-identical save, source toggles, dark mode, malformed, false positives, security (strict/CSP/no network/fonts), lazy chunks, existing features |
| tests/13-drive-search.spec.mjs | Drive FOLDER SEARCH: api.listFolders({query}) request strings/escaping/pagination/paths/cache/errors/recents (real api.js vs FakeDrive) + Save-to-Drive dialog UI (debounce, stale, rows, pick, keyboard, clear, states, Recent, focus, dark, XSS, 500 rows) |
| tests/14-new-note.spec.mjs | NEW NOTE PER CLICK (94 tests): icon click / New button / Alt+N -> new tab `?new=N` -> `?doc=<uuid>&n=N`, numbering (round 3: lowest free N, no `mdwe.untitledNext`; see spec 15), per-tab slot `mdwe.draft.doc.<uuid>`, reload restore, Drafts dialog, concurrency, regressions, SW restart, 50 tabs (A-I); round 2: Web Locks `mdwe-slot:<key>` (doc = exclusive+ifAvailable, plain/?src= = shared on both legacy keys) and `mdwe-num-N`, duplicate-tab copy, Open/Discard races, focus trap, long names, crash/history/50-tab lock behaviour (J1-J3, K). `[BUG-44]`/`[BUG-45]` probes fail until fixed (helpers in lib/notes.mjs) |
| tests/15-untitled-numbering.spec.mjs | UNTITLED-N NUMBERING (106 tests, builds index-Cvo1EJ2m.js / index-DPbNKTra.js / index-azEHsZT0.js; round 5 adds claim locks (19), #51/#52 repro + allocNumber fallback (20), complaint/hammer/50 duplicates/FUZZ-3 (21); round 4 adds alloc-number, yield logic, reload race, Save As/Open release, FUZZ-2, 50-tab perf): lowest-free numbering that resets (5 empty notes open+closed -> Untitled-1; 1+3 open -> 2 then 4), stored-draft numbers kept (Drafts Open/Discard), rapid clicks / SW stop / reservation expiry (`mdwe.untitledPending`, aged timestamps + one real 31 s test), reload + click hammer, no-tabs reset, which stored records hold a number (blank/non-Untitled no, legacy yes), erase -> no draft, Save As from Untitled-3, reservation leaks, duplicate tab, seeded 200-step fuzz, title/file bar/suggestedName, regressions. Probes `[BUG-50]`/`[BUG-51]`/`[BUG-52]` fail or skip until fixed |
| tests/10-drive.spec.mjs | Google Drive: mock api + real createDriveApi() against an in-process Drive emulator (lib/drive.mjs: FakeDrive, chrome.identity stub, installMock) |

Helpers for spec 14 (`lib/notes.mjs`): `hook(ext)` (context-wide console/pageerror + every dialog recorded, `T.mode='dismiss'`), `clickIcon(ext,T,n)` (calls the real `chrome.action.onClicked` listeners in the SW via `.dispatch(activeTab)`; waits for n new editor tabs), `info(page)`, `local/lget/seed`, `session(ext)`, `fsaRecorder` (FSA stub that records `showSaveFilePicker` `suggestedName`). Round 2 helpers live in the spec itself (`lockInfo/heldNames` = `navigator.locks.query()` filtered to `mdwe*`, `draftKeys`, `statusRec` init script that records every #status text, `rowFor/rowKeys` which mirror the `data-draft-key` expando into `data-k`). Service worker is stopped with CDP `ServiceWorker.stopAllWorkers`.

## Manual checks that cannot be automated here
See REPORT.md "Manual".

## Round 3 notes (Untitled-N numbering, build index-Cvo1EJ2m.js)
- `lib/notes.mjs` new helpers: `PENDING_KEY` (`mdwe.untitledPending`), `pending(ext)` (reservation object from session storage), `noCounter(ext)` (asserts session storage holds nothing but the pending key, i.e. `mdwe.untitledNext` is never written).
- Spec 15 local helpers: `heldNums/settle` (the `mdwe-num-N` locks, read from the SW), `leakClicks(ext,n)` (real click handler with `chrome.tabs.create` stubbed = number handed out, tab never loads), `setPending` (age/forge reservations instead of waiting 30 s), `stopWorker/awaitSw` (CDP stopAllWorkers), `openDrafts/rowFor/draftsList`.
- Numbers are now RECYCLED: tests must close tabs/seed drafts to get a given N; never assume 'next click = highest + 1'. A stored draft with text and name Untitled-N.md holds N; remember a re-opened-from-Drafts row is hidden ~2.5 s (sleep before re-opening) and the dialog overlay must be closed (Escape) before the next `#btn-drafts` click.
- Full run: `npm test` ~26 min (log out/full-r3.log). Expected: 459 pass, 10 fail (BUG-44 x2, BUG-45, BUG-46 x3, BUG-47 x2, BUG-48, BUG-49 - all intentional probes), 1 skip.

## Round 4 notes
- `needAlloc(ext)` (spec 15) probes `alloc-number` once and `test.skip`s the 23 tests that depend on it while the background never answers (BUG-50); they run for real as soon as it is answered. Expected full run on the CURRENT build: 472 pass, 10 fail (BUG-44 x2, BUG-45, BUG-50 x6, BUG-52), 24 skip (1 discard + 23 blocked). After #50 is fixed expect more passes and possibly `[BUG-51]` (deterministic reload race) failing.
- `MDWE_EXT_DIR=/path/to/extension-copy npx playwright test ...` runs the harness against a patched COPY of extension/ (QA-only; used to validate the tests with the one-word `sendResponse` fix).
- Spec 04's `roundtrip.test.mjs` needs the repo-root `node_modules` (`npm ci` in /workspace/md-editor-ext) - after a box restart reinstall it, otherwise that one test fails with ERR_MODULE_NOT_FOUND. Also `cd qa && npm install && npx playwright install chromium`, `mkdir -p qa/out`.

## Round 5 notes
- `needAlloc` is gone: no spec-15 test self-skips any more (alloc-number is answered, #50 fixed). Expected full run on index-azEHsZT0.js: 519 pass, 3 fail (BUG-44 x2, BUG-45), 1 skip (chrome.tabs.discard); ~35 min (log out/full-r5.log).
- Claim locks: tests read them via `claimNames/settleClaims` and `window.__claims` (recorded by `recInit` wrapping `navigator.locks.request`); `heldNames` in spec 14 ignores `mdwe-claim-*`. `forgeHolder(ext, n, stamp)` fakes another holder of number n with an earlier/later stamp; `dropAlloc` drops alloc-number in the page to exercise the 2.5 s fallback.
- `openEditor` returns before the async init finishes: poll (`expect.poll`) for text/name of copy or ?new tabs. Do not click the icon every 10 ms in a loop for a second (80-150 tabs per round); use >= 120 ms.

