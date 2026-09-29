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

## Google Drive setup (optional)
Drive editing needs your own Google OAuth client. The extension works fully without it (local files, drag-drop, autosave).

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and enable the **Google Drive API**.
2. **OAuth consent screen**: choose External, fill in the basics, add the scope `https://www.googleapis.com/auth/drive`, and add your Google account under **Test users**.
3. **Credentials > Create credentials > OAuth client ID**, type **Chrome extension**, Item ID = the extension ID in `EXTENSION_ID.txt` (`egbgaoinpgdhchefefmlakihmbddmnfc`; it is pinned by the `key` field in `manifest.json`, so it is the same on every machine).
4. Put the client ID into the manifest and rebuild:
   ```
   npm run set-client-id -- 1234567890-abc.apps.googleusercontent.com
   npm run release
   ```
5. Reload the extension in `chrome://extensions`, then use **Open from Drive** and sign in.

Notes and limits:
- Sign-in uses `chrome.identity.getAuthToken`, which only works in **Google Chrome** (not Chromium, Edge or Brave).
- The `drive` scope is a Google *restricted* scope. It is fine for personal use with yourself as a test user (Google may show an "unverified app" warning; tokens for test users expire after 7 days). Publishing to the Chrome Web Store would require Google's OAuth verification and security assessment. The narrower `drive.file` scope needs Google's Picker, which loads remote script and is incompatible with this extension's no-remote-code CSP.
- Saving checks Drive's `modifiedTime` first and asks before overwriting a file that changed since you opened it. That check is not atomic (Drive's API has no If-Match for media uploads), so a change landing in the milliseconds between the check and the write can still be overwritten.
- Extra permissions used for Drive: `identity` and host access to `https://www.googleapis.com/*` only.

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
