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
| tests/10-drive.spec.mjs | Google Drive: mock api + real createDriveApi() against an in-process Drive emulator (lib/drive.mjs: FakeDrive, chrome.identity stub, installMock) |

## Manual checks that cannot be automated here
See REPORT.md "Manual".
