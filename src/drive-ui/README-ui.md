# Drive UI (`src/drive-ui/`)

Dependency-free ES modules; CSP-safe (DOM via `createElement`, styling via classes in `dialog.css`, no inline scripts/style attributes, no eval, no remote assets). Importing any module pulls in `dialog.css` (Vite extracts it). Not imported by the page yet.

Files: `index.js` (all exports), `dialog.js` (Open + Save dialogs), `conflict.js`, `status.js` (badge), `common.js` (modal shell: focus trap / Esc / inert background, formatting, error classification), `dialog.css`, `demo.html|demo.js|demo.css|vite.demo.config.js`, `verify.mjs` (headless Playwright check).

Theme: pass `theme: 'light'|'dark'` (default: reads `document.documentElement.dataset.theme`). Colors are `--gd-*` variables on `.gdui[data-theme]` matching page.css (`#111827/#1f2937/#374151`, accent `#2563eb` / `#60a5fa`). The status badge uses the page's `--bar-fg/--bar-border/--accent` when present.

## Exports (named + default object from `index.js`)

```js
import { openDriveDialog, saveToDriveDialog, confirmConflict, createDriveStatus,
         statusForError, DRIVE_ERROR_STATUS, DRIVE_STATES, normalizeDriveName } from '../drive-ui/index.js';
```

### `openDriveDialog({ api, theme, onPick? }) -> Promise<{id,name,modifiedTime,size,canEdit}|null>`
Modal "Open from Drive". `null` on Cancel / Esc / backdrop. Enter, double-click or **Open** resolves with the selected file.
- Optional `onPick(file)`: if it returns a promise the dialog stays open showing "Opening…" and closes when it resolves; if it rejects the dialog stays open with the error banner (so main.js can `readFile` inside it and keep the dialog on failure). Without `onPick` it just resolves.
- Search box debounced 300 ms -> `api.listFiles({ query, pageToken })` (`query` trimmed; empty = recent). "Load more" passes `nextPageToken`.
- Rows: name (+ "Read-only" badge if `canEdit === false`), relative modified time (`title` = full date), size.
- Keyboard: type to search; ArrowUp/Down/PageUp/PageDown move selection (works from the search box and the list; `aria-activedescendant`), Enter opens, Esc closes, Tab/Shift+Tab trapped inside; page behind is `inert`; focus returns to the opener.
- States: signed-out (button -> `api.signIn()` then reload), loading spinner, empty, error + Retry, offline (`navigator.onLine === false` or `DriveError 'offline'`; auto-reloads on the `online` event), 'Load more' failure keeps the loaded list and offers Retry.
- Error mapping (`DriveError.code`): `auth`/`auth-cancelled`/401 -> sign-in prompt; `not-configured` -> "Google Drive isn't set up yet: the extension needs an OAuth client ID, see README." (no button); `forbidden`/403 -> permission message (+ Retry, Sign in again); `offline`; `quota` -> rate-limit message; `not-found`; anything else -> message + Retry.
- Footer: "Sign out" link (only when `isSignedIn()` is truthy; calls `api.signOut()`), account label in header when `api.getAccountLabel()` exists (optional, failures ignored).

### `saveToDriveDialog({ api, defaultName, theme }) -> Promise<{name, parentId?}|null>`
Name input (Enter saves; `.md` appended unless it ends in `.md/.markdown/.mdown`, same rule as `api.createFile`; `/` and `\` rejected). If `api.listFolders` exists a folder browser is shown (Enter/double-click enters folder, "↑ Up", breadcrumb; selected location = current folder). `parentId` is omitted for My Drive. If signed out, shows "Sign in with Google". Folder listing failures never block saving to the current location.

### `confirmConflict({ name, remoteModifiedTime, localModifiedTime?, theme? }) -> Promise<'overwrite'|'reload'|'save-copy'|'cancel'>`
`role="alertdialog"`, four buttons, focus starts on **Cancel**, Esc = `'cancel'` (backdrop click does nothing), ArrowUp/Down move between buttons.

### `createDriveStatus(containerEl) -> { set(state, detail), setError(err), state, el, destroy() }`
States: `idle` (hidden), `saving` "Saving to Drive…", `saved` "Saved to Drive 12:04", `error` "Drive: save failed — <msg>", `offline` "Drive: offline — will retry", `conflict`, `signed-out` "Drive: signed out". Container gets a `<span aria-live="polite">` wrapper.
`detail` (optional): string message | `Date`/timestamp/ISO (for `saved`: time shown, default now) | `Error`/DriveError | `{ message, code, time, action: { label, onClick } }` (`action` renders a small link-button, e.g. Retry / Sign in).
`DRIVE_ERROR_STATUS` maps DriveError codes to states: `not-configured|auth|auth-cancelled -> 'signed-out'`, `offline -> 'offline'`, `conflict -> 'conflict'`, `read-only|forbidden|quota|not-found|http (and unknown) -> 'error'`. `statusForError(err) -> {state, detail}` / `status.setError(err)` apply it.

## `api` contract (matches `src/drive/api.js` `createDriveApi()`)

| method | used by | notes |
|---|---|---|
| `listFiles({query, pageToken, parentId?}) -> {files:[{id,name,modifiedTime,size?,canEdit?,...}], nextPageToken?}` | open | required. UI never passes `parentId`. |
| `isSignedIn() -> boolean \| Promise<boolean>` | open, save | optional; if absent the UI relies on errors (`auth`) |
| `signIn()` | open, save | rejects with `DriveError` (`auth-cancelled`, `not-configured`, ...) |
| `signOut()` | open | optional |
| `getAccountLabel()` | open | optional, sync or async |
| `listFolders({parentId='root', pageToken}) -> {folders:[{id,name}], nextPageToken?}` | save | optional |

Errors: anything with `.code` (`not-configured|auth|auth-cancelled|offline|not-found|forbidden|quota|conflict|read-only|http`) or numeric `.code/.status` of 401/403/404. The UI only calls the api methods above; `readFile/saveFile/createFile/getMetadata` are for main.js.

## Integration steps (main.js)

```js
import { openDriveDialog, saveToDriveDialog, confirmConflict, createDriveStatus } from '../drive-ui/index.js';
import { createDriveApi } from '../drive/api.js';
const api = createDriveApi();
const driveStatus = createDriveStatus(document.getElementById('status').parentElement); // or a new <span> in #filebar .group

// Open
const picked = await openDriveDialog({ api, theme: state.theme,
  onPick: async (f) => { doc = await api.readFile(f.id); } });        // dialog stays open & shows error if readFile throws
if (picked) { loadDoc({ handle: null, name: doc.name, text: doc.text }); drive = { id: doc.id, modifiedTime: doc.modifiedTime, canEdit: doc.canEdit }; driveStatus.set('idle'); }

// Save (existing Drive file)
driveStatus.set('saving');
try { const r = await api.saveFile(drive.id, text, { expectedModifiedTime: drive.modifiedTime }); drive.modifiedTime = r.modifiedTime; driveStatus.set('saved'); }
catch (e) {
  if (e.code === 'conflict') {
    driveStatus.set('conflict');
    const choice = await confirmConflict({ name: state.name, remoteModifiedTime: e.remoteModifiedTime, localModifiedTime: drive.loadedAt, theme: state.theme });
    if (choice === 'overwrite') { const r = await api.saveFile(drive.id, text, { force: true }); ... driveStatus.set('saved'); }
    else if (choice === 'reload') { const d = await api.readFile(drive.id); loadDoc(...); }
    else if (choice === 'save-copy') { const t = await saveToDriveDialog({ api, defaultName: 'Copy of ' + state.name, theme }); if (t) { const r = await api.createFile(t.name, text, { parentId: t.parentId }); ... } }
    else driveStatus.set('conflict');   // cancel: leave badge, dirty stays
  } else driveStatus.setError(e);       // offline / auth / forbidden / read-only ...
}

// First save of an untitled doc
const t = await saveToDriveDialog({ api, defaultName: state.name, theme: state.theme });
if (t) { const r = await api.createFile(t.name, text, { parentId: t.parentId }); }
```
Notes: buttons for Drive (e.g. "Open from Drive", "Save to Drive") still need to be added to `index.html`/`main.js` by the owner of those files. Keep theme in sync by passing `state.theme` on each call (dialogs are short-lived). The modal sets `inert` on `document.body` children while open and stops keydown propagation, so Ctrl+S/Ctrl+O in `main.js` don't fire behind it (document-level listeners that use the capture phase would still see them).

## Demo / verification

```
npx vite build --config src/drive-ui/vite.demo.config.js     # -> /tmp/md-drive-ui-demo
node src/drive-ui/verify.mjs                                 # Playwright from qa/node_modules; screenshots -> qa/out/drive-ui/
npx vite --config src/drive-ui/vite.demo.config.js           # interactive
```
Demo query string: `?mode=normal|slow|error|401|403|notconfigured|offline|empty|many|nofolders|signedout&theme=dark`.
