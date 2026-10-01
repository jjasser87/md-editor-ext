// Google Drive v3 REST layer. No remote code: plain fetch + chrome.identity tokens.
// createDriveApi({ identity, fetch }) is injectable so tests can mock both.
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,version,parents,capabilities/canEdit';

export class DriveError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'DriveError'; this.code = code; Object.assign(this, extra); }
}
// codes: 'not-configured' | 'auth' | 'auth-cancelled' | 'offline' | 'not-found' | 'forbidden' | 'quota' | 'conflict' | 'read-only' | 'http'

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createDriveApi({ identity = globalThis.chrome && chrome.identity, fetch: f = globalThis.fetch.bind(globalThis), storage = globalThis.chrome && chrome.storage && chrome.storage.local } = {}) {
  const RECENT_KEY = 'driveRecentFolders', RECENT_MAX = 8;
  const folderCache = new Map(); // id -> Promise<{ name, parents } | null> (failures are evicted)
  let cachedToken = null;

  function getTokenRaw(interactive) {
    return new Promise((resolve, reject) => {
      if (!identity || !identity.getAuthToken) return reject(new DriveError('not-configured', 'chrome.identity is unavailable'));
      try { // shipped placeholder id: report "not set up" without a doomed identity call
        const cid = globalThis.chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().oauth2 && chrome.runtime.getManifest().oauth2.client_id;
        if (cid && /^YOUR_CLIENT_ID/.test(cid)) return reject(new DriveError('not-configured', 'Google OAuth client ID is not configured. See README "Google Drive setup".'));
      } catch { /* ignore */ }
      identity.getAuthToken({ interactive }, (res) => {
        const err = globalThis.chrome && chrome.runtime && chrome.runtime.lastError;
        const msg = (err && err.message) || '';
        const token = typeof res === 'string' ? res : res && res.token;
        if (token) return resolve(token);
        if (/client_id|bad client id|invalid_client|invalid oauth2 (?:client id|scopes?)|OAuth2 request failed.*invalid/i.test(msg)) return reject(new DriveError('not-configured', 'Google OAuth client ID is not configured. See README "Google Drive setup".'));
        if (/did not approve|user (?:cancel|denied)|closed|canceled|cancelled/i.test(msg)) return reject(new DriveError('auth-cancelled', 'Sign-in was cancelled'));
        reject(new DriveError('auth', msg || 'Not signed in to Google'));
      });
    });
  }
  async function token(interactive = false) {
    if (!cachedToken) cachedToken = await getTokenRaw(interactive);
    return cachedToken;
  }
  function dropToken(t) {
    return new Promise((resolve) => {
      const old = t || cachedToken; cachedToken = null;
      if (old && identity && identity.removeCachedAuthToken) identity.removeCachedAuthToken({ token: old }, () => resolve());
      else resolve();
    });
  }

  async function request(url, init = {}, { retry = true } = {}) {
    const t = await token(false).catch((e) => { if (e.code === 'auth') throw new DriveError('auth', 'Sign in to Google Drive first'); throw e; });
    let res;
    try { res = await f(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + t } }); }
    catch (e) { throw new DriveError('offline', 'Network error: could not reach Google Drive', { cause: e }); }
    if (res.status === 401 && retry) { await dropToken(t); return request(url, init, { retry: false }); } // expired token: refresh once
    if (res.ok) return res;
    let body = null; try { body = await res.json(); } catch { /* ignore */ }
    const reason = body && body.error && (body.error.errors && body.error.errors[0] && body.error.errors[0].reason);
    const message = (body && body.error && body.error.message) || res.statusText || 'HTTP ' + res.status;
    if (res.status === 401) { throw new DriveError('auth', 'Google session expired. Sign in again.', { status: 401 }); }
    if (res.status === 404) throw new DriveError('not-found', 'File not found (deleted, moved, or no access)', { status: 404 });
    if (res.status === 429) throw new DriveError('quota', 'Google Drive rate limit hit. Try again shortly.', { status: 429 });
    if (res.status === 403 && /rateLimit|quota|userRateLimit/i.test(reason || '')) throw new DriveError('quota', 'Google Drive rate limit hit. Try again shortly.', { status: 403 });
    if (res.status === 403) {
      if (/insufficientPermissions|insufficientScopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason + ' ' + message)) await dropToken(t); // stale token without the Drive scope: force a fresh consent on next sign-in
      throw new DriveError('forbidden', message, { status: 403, reason });
    }
    throw new DriveError('http', message, { status: res.status });
  }
  const json = async (url, init) => (await request(url, init)).json();

  const norm = (x) => ({ id: x.id, name: x.name, mimeType: x.mimeType, modifiedTime: x.modifiedTime, size: x.size != null ? Number(x.size) : undefined, version: x.version, parents: x.parents, canEdit: !x.capabilities || x.capabilities.canEdit !== false });

  // Folder name + parent ids. The in-flight promise is cached so concurrent lookups of one parent share one request (#34);
  // a failed lookup is evicted so a transient error is retried next time instead of sticking as "unresolvable" (#35).
  function folderInfo(id) {
    if (folderCache.has(id)) return folderCache.get(id);
    const pr = json(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent('id,name,parents')}&supportsAllDrives=true`)
      .then((j) => ({ name: j.name, parents: j.parents || [] }))
      .catch(() => { folderCache.delete(id); return null; });
    folderCache.set(id, pr);
    return pr;
  }
  // "My Drive / Projects / 2026" for a folder whose parent ids are given (max 8 levels; undefined if unknown).
  async function parentPath(parents) {
    const names = [];
    let cur = parents && parents[0];
    for (let d = 0; cur && d < 8; d++) {
      const info = await folderInfo(cur);
      if (!info) break;
      names.unshift(info.name);
      cur = info.parents[0];
    }
    return names.length ? names.join(' / ') : undefined;
  }

  const api = {
    async isSignedIn() { try { await token(false); return true; } catch { return false; } },
    async signIn() { await dropToken(); cachedToken = await getTokenRaw(true); return true; }, // drop Chrome's cached token first so a re-sign-in really re-consents
    async signOut() {
      const t = cachedToken || await getTokenRaw(false).catch(() => null);
      if (t) { try { await f('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch { /* best effort */ } }
      await dropToken(t);
      if (identity && identity.clearAllCachedAuthTokens) await new Promise((r) => identity.clearAllCachedAuthTokens(() => r()));
    },
    async getAccountLabel() {
      const j = await json(`${API}/about?fields=user(emailAddress,displayName)`);
      return (j.user && (j.user.emailAddress || j.user.displayName)) || '';
    },

    // Markdown-ish files (not Google Docs), optionally filtered by name. Newest first.
    async listFiles({ query = '', pageToken, parentId } = {}) {
      const parts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'", "mimeType != 'application/vnd.google-apps.document'",
        // Drive's `contains` matches whole-word prefixes and its tokenization of 'notes.md' is not documented, so match the
        // bare tokens AND the mime types broadly, then filter precisely by extension client-side (see filter below).
        "(name contains 'md' or name contains '.md' or name contains 'markdown' or name contains 'mdown' or mimeType = 'text/markdown' or mimeType = 'text/x-markdown')"];
      if (query.trim()) parts.push(`name contains '${q(query.trim())}'`);
      if (parentId) parts.push(`'${q(parentId)}' in parents`);
      const p = new URLSearchParams({ q: parts.join(' and '), orderBy: 'modifiedTime desc', pageSize: '50', fields: `nextPageToken,files(${FILE_FIELDS})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      if (pageToken) p.set('pageToken', pageToken);
      const j = await json(`${API}/files?${p}`);
      const files = (j.files || []).filter((x) => /\.(md|markdown|mdown)$/i.test(x.name) || /markdown/.test(x.mimeType || '')).map(norm);
      return { files, nextPageToken: j.nextPageToken || null };
    },
    // Browse (no query): children of parentId. With a non-empty `query`: search ALL folders by name (incl. shared drives),
    // ignore parentId, and attach `path` ("My Drive / Projects / 2026") to each result so same-named folders are distinguishable.
    async listFolders({ parentId = 'root', pageToken, query = '' } = {}) {
      const term = String(query || '').trim();
      const parts = ["mimeType = 'application/vnd.google-apps.folder'", 'trashed = false'];
      if (term) parts.push(`name contains '${q(term)}'`); else parts.push(`'${q(parentId)}' in parents`);
      const p = new URLSearchParams({ q: parts.join(' and '), orderBy: term ? 'name_natural' : 'name', pageSize: term ? '50' : '100', fields: `nextPageToken,files(id,name${term ? ',parents' : ''})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
      if (term) p.set('corpora', 'allDrives'); // search shared drives the user hasn't opened yet too (#33)
      if (pageToken) p.set('pageToken', pageToken);
      const j = await json(`${API}/files?${p}`);
      let folders = j.files || [];
      if (term) folders = await Promise.all(folders.map(async (x) => ({ id: x.id, name: x.name, path: await parentPath(x.parents) })));
      return { folders, nextPageToken: j.nextPageToken || null, ...(j.incompleteSearch ? { incompleteSearch: true } : {}) };
    },
    // Most recently used save destinations, newest first: [{ id, name, path? }].
    async getRecentFolders() {
      if (!storage) return [];
      try { const r = await storage.get(RECENT_KEY); return Array.isArray(r && r[RECENT_KEY]) ? r[RECENT_KEY] : []; } catch { return []; }
    },
    async addRecentFolder(f) {
      if (!storage || !f || !f.id || f.id === 'root') return;
      try {
        const cur = (await api.getRecentFolders()).filter((x) => x.id !== f.id);
        cur.unshift({ id: f.id, name: f.name, ...(f.path ? { path: f.path } : {}) });
        await storage.set({ [RECENT_KEY]: cur.slice(0, RECENT_MAX) });
      } catch { /* recents are best-effort */ }
    },

    async getMetadata(id) { return norm(await json(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`)); },
    // -> { id, name, text, modifiedTime, version, canEdit }
    async readFile(id) {
      const meta = await api.getMetadata(id);
      if (/^application\/vnd\.google-apps\./.test(meta.mimeType || '')) throw new DriveError('http', 'Google Docs files are not Markdown; export/convert first.');
      const res = await request(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
      return { ...meta, text: await res.text() };
    },
    // Save in place. If Drive's modifiedTime differs from the one we loaded, throw DriveError('conflict') unless force.
    // -> { id, name, modifiedTime, version }
    async saveFile(id, text, { expectedModifiedTime, force = false } = {}) {
      const cur = await api.getMetadata(id);
      if (cur.canEdit === false) throw new DriveError('read-only', 'You only have view access to this file');
      if (!force && expectedModifiedTime && cur.modifiedTime !== expectedModifiedTime) {
        throw new DriveError('conflict', 'This file changed in Drive since you opened it', { remoteModifiedTime: cur.modifiedTime, expectedModifiedTime });
      }
      const res = await request(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'text/markdown; charset=UTF-8' }, body: text,
      });
      return norm(await res.json());
    },
    // Create a new .md file (optionally inside parentId).
    async createFile(name, text, { parentId } = {}) {
      const n = /\.(md|markdown|mdown)$/i.test(name) ? name : name + '.md';
      const meta = { name: n, mimeType: 'text/markdown' }; if (parentId) meta.parents = [parentId];
      const b = 'mdwe' + Math.random().toString(36).slice(2);
      const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`;
      const res = await request(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body,
      });
      const created = norm(await res.json());
      if (parentId) folderInfo(parentId).then(async (info) => { if (info) await api.addRecentFolder({ id: parentId, name: info.name, path: await parentPath(info.parents) }); });
      return created;
    },
  };
  return api;
}

export const driveApi = createDriveApi;
