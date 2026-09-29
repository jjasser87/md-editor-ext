# Scaffold (Extension Dev)
- extension/  manifest.json, background.js, content.js, icons/  (static, hand-written)
- extension/editor/  BUILD OUTPUT from Vite (don't hand-edit)
- src/page/  index.html, main.js (file I/O, autosave, drag-drop, theme, shortcuts), files.js, page.css
- src/editor/  Editor Dev owns. main.js imports `createEditor` from ../editor/index.js
  Needs: getMarkdown, setMarkdown, setTheme, setSourceMode(bool) (or toggleSource), destroy; onChange fires on user edits.
- Build: `npm install && npm run build` -> extension/ loadable. `npm run release` also writes dist/md-editor-ext.zip
- Test hook: window.__mdwe.{state,editor} on the editor page. Elements: #btn-open #btn-save #btn-saveas #btn-download #btn-source #btn-theme #filename #status #editor-host
- Permissions: storage only. CSP: script-src 'self'. file://*.md content script adds an Edit button (needs "Allow access to file URLs").
