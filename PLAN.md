# Markdown WYSIWYG Chrome Extension — plan

Goal: MV3 Chrome extension that opens/edits/saves .md files in a WYSIWYG editor.

## Scope v0.1
- Full-tab editor page (extension page), opened from toolbar icon, and auto-opens local file://*.md files via an "Edit" button/redirect.
- WYSIWYG editing (TipTap or Milkdown, bundled — no remote code) with toolbar: headings, bold/italic/strike, code, lists, task lists, quote, links, images, tables, hr.
- Source-markdown toggle (split or tab), light/dark theme.
- Open/save real files via File System Access API (showOpenFilePicker / createWritable), drag-drop, "Save as / Download"; autosave draft to chrome.storage.local.
- Round-trip fidelity: GFM (tables, task lists, fenced code).

## Layout (shared box): /workspace/md-editor-ext/
- extension/  (manifest.json, background.js, editor/ html+js+css, icons/)
- src/ + build config (Vite) if bundling needed; output to extension/
- tests/ (round-trip + Playwright)
- dist/md-editor-ext.zip

## Roles
- MD Editor Dev: editor UI + markdown round-trip.
- MD Extension Dev: manifest, file I/O, storage, build/packaging.
- MD Extension QA: tests, permissions/CSP review, bug reports.

## Rules
- Minimal permissions (storage; optional file URL access). No remote code, no CDNs.
- Room updates <=3 short messages; put details in files under /workspace/md-editor-ext/.
