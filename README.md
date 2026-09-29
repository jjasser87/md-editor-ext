# Markdown WYSIWYG Editor (Chrome extension, MV3)

Open, edit and save local Markdown files in a WYSIWYG editor, right in Chrome.

## Features
- WYSIWYG editing (TipTap, fully bundled, no remote code) with toolbar: headings, bold/italic/strike, code, lists, task lists, quotes, links, images, tables, horizontal rules
- Markdown source toggle, light/dark theme
- Open/save real files via the File System Access API (Save writes back to the same file), drag-and-drop, Save as / Download fallback
- Autosaved draft (chrome.storage.local); unsaved work is restored
- On `file://*.md` pages an "Edit in Markdown Editor" button opens the file in the editor (enable "Allow access to file URLs" for the extension in `chrome://extensions`)
- GFM round-trip: tables, task lists, fenced code; raw HTML and footnotes are preserved verbatim (shown read-only)
- Minimal permissions: `storage` only. Strict CSP (`script-src 'self'`).

## Install (load unpacked)
1. Download `dist/md-editor-ext.zip` and unzip it, or build it yourself (below).
2. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the `extension/` folder (or the unzipped folder).
3. Click the toolbar icon to open the editor.

## Build
```
npm install
npm run build      # bundles src/ into extension/editor/
npm run release    # build + dist/md-editor-ext.zip
```

## Layout
- `extension/` manifest, background, content script, icons; `extension/editor/` is the Vite build output
- `src/page/` editor page (file I/O, autosave, drag-drop, theme, shortcuts)
- `src/editor/` TipTap editor module and round-trip tests (`node src/editor/roundtrip.test.mjs`)
- `qa/` Playwright suite (`cd qa && npm install && npm test`) and `qa/REPORT.md`
- `BUGS.md`, `EDITOR_NOTES.md`, `SCAFFOLD.md`, `PLAN.md` project notes

## Known limits
See `EDITOR_NOTES.md` and `BUGS.md` (relative image paths in files opened via `?src=` don't resolve; remote images load when a document is opened).
