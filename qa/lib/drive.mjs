// Drive test helpers: FakeDrive (Node-side Google Drive v3 emulator served through Playwright context.route),
// chrome.identity stub (init script), in-page mock of the api.js surface, and openDriveEditor().
import fs from 'node:fs';
import path from 'node:path';
import { SCREENS } from './fixture.mjs';

const FOLDER = 'application/vnd.google-apps.folder';
const FOLDER_MIME_EQ = "mimeType = 'application/vnd.google-apps.folder'";
export const DRIVE_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// ------------------------------------------------------------------------------------------------
// FakeDrive: in-memory Drive. `log` records every request that reached it.
// ------------------------------------------------------------------------------------------------
export class FakeDrive {
  // opts.defaultFolders (default true): seed two root folders FOLD1 "Notes" and FOLD2 "Work" (what the 10-drive tests expect).
  constructor(files = [], opts = {}) {
    this.files = new Map();                // non-folder files only (10-drive asserts on its size)
    this.dirs = new Map();                 // folders (incl. trashed / shared-drive ones)
    this.sharedDrives = new Map();         // id -> { id, name }
    this.ROOT_ID = '0AQAmyDriveRootId';    // real Drive reports the *actual* root id in `parents`, and accepts the alias 'root' in queries/get
    this.log = []; this.hooks = []; this.cors = true; this.minGen = 1; this.alwaysAuthFail = false; this.pageSize = 0;
    this.sharedRootResolvable = true;      // files.get(<shared drive id>) returns the drive name (real Drive does with supportsAllDrives=true)
    this.nameMatch = 'substring';          // 'token-prefix' mimics real Drive `contains` (word-prefix matching)
    this.strictQuery = true;               // malformed `q` -> 400 invalid (like Drive). Catches unescaped quotes / lone backslashes.
    this.maxUrl = 0;                       // >0: requests whose URL is longer get 414
    this.incompleteSearch = false;         // add incompleteSearch:true to corpora=allDrives responses
    this.emptyPages = 0;                   // N: each folder list first serves N empty pages that still carry a nextPageToken (Drive may do this)
    this.forbidden = new Set();            // ids whose files.get answers 403
    this.t0 = Date.parse('2026-09-29T12:00:00.000Z'); this.tick = 0; this.nextId = 1; this.nextDir = 1;
    for (const f of files) this.add(f);
    if (opts.defaultFolders !== false) { this.addFolder({ id: 'FOLD1', name: 'Notes' }); this.addFolder({ id: 'FOLD2', name: 'Work' }); }
  }
  // ---- folders (test-side emulator extension for folder search) ----
  addFolder({ id, name, parents, trashed = false, driveId, accessed = true }) {
    id = id || 'dir' + this.nextDir++;
    const f = { id, name, mimeType: FOLDER, parents: parents === undefined ? ['root'] : parents, trashed, driveId, accessed, modifiedTime: this.now(), version: 1, body: Buffer.alloc(0), canEdit: true };
    this.dirs.set(id, f); return f;
  }
  addSharedDrive({ id, name }) { this.sharedDrives.set(id, { id, name }); return id; }
  // tree('Projects/2026/Q3') creates (or reuses) the chain under `root` and returns the leaf. Ids are the joined path.
  tree(p, { under = 'root', driveId } = {}) {
    let parent = under, leaf = null;
    const segs = p.split('/'); let acc = '';
    for (const seg of segs) {
      acc = acc ? acc + '/' + seg : seg; const id = 'T:' + (under === 'root' ? '' : under + ':') + acc;
      leaf = this.dirs.get(id) || this.addFolder({ id, name: seg, parents: [parent], driveId });
      parent = id;
    }
    return leaf;
  }
  // ---- request views ----
  folderReqs() { return this.log.filter((l) => l.path === '/drive/v3/files' && l.method === 'GET' && l.q && l.q.includes(FOLDER_MIME_EQ)); }
  searchReqs() { return this.folderReqs().filter((l) => / and name contains '/.test(l.q)); }
  searchQs() { return this.searchReqs().map((l) => l.q); }
  lookups(id) { return this.log.filter((l) => l.method === 'GET' && /^\/drive\/v3\/files\/[^/]+$/.test(l.path) && l.search.alt !== 'media' && (id === undefined || decodeURIComponent(l.path.split('/').pop()) === id)); }
  // ---- hook helpers (per-request delay / hold / error injection) ----
  delay(pred, ms) { this.hooks.push(async (e) => { if (pred(e)) await new Promise((r) => setTimeout(r, typeof ms === 'function' ? ms(e) : ms)); }); }
  // hold(pred) -> { release(), releaseAll(), held() }: matching requests wait until released (release order = any order the test chooses).
  hold(pred) {
    const waiting = []; let open = false;
    this.hooks.push(async (e) => { if (!open && pred(e)) await new Promise((res) => waiting.push({ e, res })); });
    return { held: () => waiting.map((w) => w.e), release: (i = 0) => { const [w] = waiting.splice(i, 1); w && w.res(); return !!w; }, releaseAll: () => { open = true; while (waiting.length) waiting.shift().res(); }, count: () => waiting.length };
  }
  // inject(pred, { status, reason, message, abort, times }) -> { count, off() }
  inject(pred, { status = 500, reason, message, abort, times = Infinity } = {}) {
    const c = { count: 0, on: true, off() { c.on = false; } };
    this.hooks.push((e) => { if (c.on && c.count < times && pred(e)) { c.count++; return abort ? { abort } : { status, reason, message }; } });
    return c;
  }
  now() { return new Date(this.t0 + (++this.tick) * 1000).toISOString(); }
  add({ id, name, text = '', canEdit = true, mimeType = 'text/markdown', parents }) {
    id = id || 'file' + this.nextId++;
    const f = { id, name, mimeType, body: Buffer.from(text, 'utf8'), modifiedTime: this.now(), version: 1, canEdit, parents: parents || ['root'], trashed: false };
    this.files.set(id, f); return f;
  }
  text(id) { return this.files.get(id).body.toString('utf8'); }
  bytes(id) { return this.files.get(id).body; }
  remoteEdit(id, text) { const f = this.files.get(id); f.body = Buffer.from(text, 'utf8'); f.modifiedTime = this.now(); f.version++; return f; }
  meta(f) { return { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: String(f.body.length), version: String(f.version), parents: f.parents, capabilities: { canEdit: f.canEdit } }; }
  reqs(pred = () => true) { return this.log.filter(pred); }
  writes() { return this.log.filter((l) => (l.method === 'PATCH' || (l.method === 'POST' && l.path.startsWith('/upload/'))) && l.status < 300); }
  attempts(method) { return this.log.filter((l) => l.method === method); }


  // ------------------------------------------------------------------------------------------------
  // Folder search emulation (test-side). A faithful-enough subset of Drive v3 files.list `q` grammar:
  //   term   := field op value | value 'in' parents          (field: name|mimeType|trashed|fullText ; op: = != contains)
  //   expr   := term { ('and'|'or') term } with parentheses ; strings are '...' with \' and \\ as the only escapes.
  // Anything else -> 400 "Invalid Value" (strictQuery), which is what makes escaping bugs visible.
  // ------------------------------------------------------------------------------------------------
  static parseQ(q) {
    const toks = []; let i = 0; const bad = (m) => { const e = new Error(m); e.invalidQuery = true; throw e; };
    while (i < q.length) {
      const c = q[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '(' || c === ')') { toks.push({ t: c }); i++; continue; }
      if (c === "'") {
        let v = ''; i++; let closed = false;
        while (i < q.length) {
          const d = q[i];
          if (d === '\\') { const n = q[i + 1]; if (n === "'" || n === '\\') { v += n; i += 2; continue; } bad('Invalid escape \\' + (n || 'EOF')); }
          if (d === "'") { closed = true; i++; break; }
          v += d; i++;
        }
        if (!closed) bad('Unterminated string');
        toks.push({ t: 'str', v }); continue;
      }
      const m = /^(!=|=|[A-Za-z_][A-Za-z0-9_]*)/.exec(q.slice(i));
      if (!m) bad('Unexpected character ' + JSON.stringify(c) + ' at ' + i);
      toks.push({ t: 'word', v: m[1] }); i += m[1].length;
    }
    let k = 0; const peek = () => toks[k], next = () => toks[k++];
    const term = () => {
      const a = next(); if (!a) bad('Unexpected end');
      if (a.t === '(') { const e = expr(); const r = next(); if (!r || r.t !== ')') bad('Missing )'); return e; }
      if (a.t === 'str') { const w = next(); const f = next(); if (!w || w.v !== 'in' || !f || f.v !== 'parents') bad('Expected "in parents"'); return { k: 'in', v: a.v }; }
      if (a.t === 'word') {
        const op = next(); if (!op || op.t !== 'word' || !['=', '!=', 'contains'].includes(op.v)) bad('Bad operator after ' + a.v);
        const val = next(); if (!val) bad('Missing value');
        if (val.t === 'str') return { k: 'cmp', f: a.v, op: op.v, v: val.v };
        if (val.t === 'word' && (val.v === 'true' || val.v === 'false')) return { k: 'cmp', f: a.v, op: op.v, v: val.v === 'true' };
        bad('Bad value');
      }
      bad('Unexpected token');
    };
    const and = () => { let l = term(); while (peek() && peek().t === 'word' && peek().v === 'and') { next(); l = { k: 'and', l, r: term() }; } return l; };
    const expr = () => { let l = and(); while (peek() && peek().t === 'word' && peek().v === 'or') { next(); l = { k: 'or', l, r: and() }; } return l; };
    const ast = expr(); if (k !== toks.length) bad('Trailing tokens'); return ast;
  }
  // Drive: `trashed` is true for an item trashed explicitly OR via a trashed parent folder.
  effTrashed(f, depth = 0) { if (f.trashed) return true; const par = (f.parents || [])[0]; const pf = par && depth < 50 ? this.dirs.get(par) : null; return pf ? this.effTrashed(pf, depth + 1) : false; }
  isRootId(x) { return x === 'root' || x === this.ROOT_ID; }
  outParents(f) { return (f.parents || []).map((x) => (x === 'root' ? this.ROOT_ID : x)); }
  evalQ(ast, f) {
    switch (ast.k) {
      case 'and': return this.evalQ(ast.l, f) && this.evalQ(ast.r, f);
      case 'or': return this.evalQ(ast.l, f) || this.evalQ(ast.r, f);
      case 'in': return (f.parents || []).some((x) => x === ast.v || (this.isRootId(x) && this.isRootId(ast.v)));
      case 'cmp': {
        if (ast.f === 'name') {
          const a = String(f.name).toLowerCase(), b = String(ast.v).toLowerCase();
          if (ast.op === 'contains') return this.nameMatch === 'token-prefix' ? a.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(b)) : a.includes(b);
          return ast.op === '=' ? f.name === ast.v : f.name !== ast.v;
        }
        if (ast.f === 'mimeType') return ast.op === '=' ? f.mimeType === ast.v : ast.op === '!=' ? f.mimeType !== ast.v : String(f.mimeType).includes(ast.v);
        if (ast.f === 'trashed') { const t = this.effTrashed(f); return ast.op === '=' ? t === ast.v : t !== ast.v; }
        const e = new Error('Invalid field ' + ast.f); e.invalidQuery = true; throw e;
      }
    }
    return false;
  }
  // Folder-list request (q contains mimeType = folder). Handles name search, browse (in parents), shared-drive params, orderBy, fields, paging.
  listFolderQuery(u, done, err) {
    const sp = u.searchParams; const q = sp.get('q') || '';
    let ast; try { ast = FakeDrive.parseQ(q); } catch (e) { if (e.invalidQuery && this.strictQuery) return err(400, 'Invalid Value', 'invalid'); throw e; }
    const orderBy = sp.get('orderBy');
    const ORDERS = ['createdTime', 'folder', 'modifiedByMeTime', 'modifiedTime', 'name', 'name_natural', 'quotaBytesUsed', 'recency', 'sharedWithMeTime', 'starred', 'viewedByMeTime'];
    if (orderBy) for (const part of orderBy.split(',')) { const [k, dir] = part.trim().split(/\s+/); if (!ORDERS.includes(k) || (dir && dir !== 'desc')) return err(400, 'Invalid Value', 'invalidOrderBy'); }
    const corpora = sp.get('corpora'); const sup = sp.get('supportsAllDrives') === 'true', inc = sp.get('includeItemsFromAllDrives') === 'true';
    if (corpora === 'drive' && !sp.get('driveId')) return err(400, 'driveId must be specified when corpora=drive', 'invalid');
    if (corpora && !['user', 'domain', 'drive', 'allDrives'].includes(corpora)) return err(400, 'Invalid Value', 'invalid');
    const visible = (f) => {
      if (!f.driveId) return corpora !== 'drive'; // My Drive items are not in a `drive` corpus
      if (!sup || !inc) return false;
      if (!corpora || corpora === 'user') return f.accessed !== false; // documented: `user` = items the user has accessed
      if (corpora === 'allDrives') return true;
      if (corpora === 'drive') return f.driveId === sp.get('driveId');
      return false;
    };
    let list = [...this.dirs.values(), ...this.files.values()].filter((f) => visible(f) && this.evalQ(ast, f));
    const nat = orderBy && /name_natural/.test(orderBy), desc = orderBy && /desc/.test(orderBy);
    const cmp = nat ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
    if (orderBy && /name/.test(orderBy)) list.sort((a, b) => (desc ? -1 : 1) * cmp(a, b) || a.id.localeCompare(b.id)); else list.sort((a, b) => a.id.localeCompare(b.id));
    const size = this.pageSize || Math.min(1000, Number(sp.get('pageSize')) || 100);
    // page token: "<qhash>:<emptyLeft>:<offset>"  (invalid / foreign tokens are rejected like Drive does)
    const qh = this.hash(q + '|' + corpora + '|' + orderBy);
    let off = 0, emptyLeft = this.emptyPages; const pt = sp.get('pageToken');
    if (pt) { const m = /^([0-9a-f]+):(\d+):(\d+)$/.exec(pt); if (!m || m[1] !== qh) return err(400, 'Invalid Value', 'invalid'); emptyLeft = Number(m[2]); off = Number(m[3]); }
    else if (emptyLeft) { return done(200, { files: [], nextPageToken: `${qh}:${emptyLeft - 1}:0`, ...(this.incompleteSearch && corpora === 'allDrives' ? { incompleteSearch: true } : {}) }); }
    else emptyLeft = 0;
    if (pt && emptyLeft > 0 && off === 0) return done(200, { files: [], nextPageToken: `${qh}:${emptyLeft - 1}:0` });
    const slice = list.slice(off, off + size);
    const fields = this.fieldsOf(sp.get('fields'), 'files');
    const out = slice.map((f) => this.project(f.mimeType === FOLDER ? { id: f.id, name: f.name, mimeType: f.mimeType, parents: this.outParents(f), trashed: !!f.trashed, driveId: f.driveId } : this.meta(f), fields));
    const body = { files: out }; if (off + size < list.length) body.nextPageToken = `${qh}:0:${off + size}`;
    if (this.incompleteSearch && corpora === 'allDrives') body.incompleteSearch = true;
    return done(200, body);
  }
  hash(s) { let h = 5381; for (const c of s) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(16); }
  // "nextPageToken,files(id,name,parents)" -> Set('id','name','parents') for the `files` (or top-level) resource; null = everything
  fieldsOf(fields, inside) {
    if (!fields) return null;
    if (inside) { const m = new RegExp(inside + '\\(([^)]*)\\)').exec(fields); return m ? new Set(m[1].split(',').map((x) => x.trim().split('/')[0])) : new Set(); }
    return new Set(fields.split(',').map((x) => x.trim().split('/')[0]));
  }
  project(obj, fields) { if (!fields) return obj; const o = {}; for (const k of Object.keys(obj)) if (fields.has(k)) o[k] = obj[k]; return o; }
  // GET /files/:id for folders, the My Drive root alias and shared-drive roots. Returns true if handled.
  dirLookup(id, u, done, err) {
    const sp = u.searchParams; const sup = sp.get('supportsAllDrives') === 'true';
    const fields = this.fieldsOf(sp.get('fields'));
    if (this.forbidden.has(id)) { err(403, 'The user does not have sufficient permissions for this file.', 'insufficientFilePermissions'); return true; }
    if (this.isRootId(id)) { done(200, this.project({ id: this.ROOT_ID, name: 'My Drive', mimeType: FOLDER }, fields)); return true; }
    if (this.sharedDrives.has(id)) {
      if (!sup || !this.sharedRootResolvable) { err(404, 'File not found: ' + id + '.', 'notFound'); return true; }
      done(200, this.project({ id, name: this.sharedDrives.get(id).name, mimeType: FOLDER, driveId: id }, fields)); return true;
    }
    const f = this.dirs.get(id); if (!f) return false;
    if (f.driveId && !sup) { err(404, 'File not found: ' + id + '.', 'notFound'); return true; }
    done(200, this.project({ id: f.id, name: f.name, mimeType: FOLDER, parents: this.outParents(f), trashed: !!f.trashed, driveId: f.driveId }, fields)); return true;
  }

  async handle(route) {
    const req = route.request(); const u = new URL(req.url()); const method = req.method();
    const H = this.cors ? { ...DRIVE_CORS } : {};
    const fulfill = (status, body, extra = {}) => route.fulfill({ status, headers: { ...H, ...extra }, contentType: extra['content-type'] || 'application/json', body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    if (method === 'OPTIONS') { this.log.push({ method, host: u.host, path: u.pathname, status: 204, preflight: true }); return route.fulfill({ status: this.cors ? 204 : 405, headers: H }); }
    const hdr = req.headers();
    const buf = req.postDataBuffer();
    const entry = { method, host: u.host, path: u.pathname, search: Object.fromEntries(u.searchParams), q: u.searchParams.get('q'), url: req.url(), t: Date.now(), auth: hdr.authorization, ct: hdr['content-type'], body: buf, status: 0 };
    this.log.push(entry);
    const done = (status, body, extra) => { entry.status = status; return fulfill(status, body, extra); };
    const err = (status, message, reason) => done(status, { error: { code: status, message, errors: reason ? [{ reason, message }] : [] } });
    for (const h of this.hooks) { const r = await h(entry, this); if (r) { if (r.abort) { entry.status = -1; return route.abort(r.abort === true ? 'internetdisconnected' : r.abort); } return err(r.status, r.message || 'injected ' + r.status, r.reason); } }
    if (this.maxUrl && req.url().length > this.maxUrl) return err(414, 'Request-URI Too Large');
    if (u.host === 'oauth2.googleapis.com') return done(200, {});
    const m = /^Bearer TOK(\d+)$/.exec(entry.auth || '');
    if (this.alwaysAuthFail || !m || Number(m[1]) < this.minGen) return err(401, 'Invalid Credentials');
    const p = u.pathname;
    if (p === '/drive/v3/about') return done(200, { user: { emailAddress: 'tester@example.com', displayName: 'Tester' } });
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      if (q.includes(FOLDER_MIME_EQ)) return this.listFolderQuery(u, done, err);
      let list;
      {
        const uq = / and name contains '((?:[^'\\]|\\.)*)'/.exec(q);
        list = [...this.files.values()].filter((f) => !f.trashed && (!uq || f.name.toLowerCase().includes(uq[1].replace(/\\(.)/g, '$1').toLowerCase())))
          .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map((f) => this.meta(f));
      }
      const size = this.pageSize || Number(u.searchParams.get('pageSize')) || 50; const off = Number(u.searchParams.get('pageToken') || 0);
      const page = list.slice(off, off + size);
      return done(200, { files: page, nextPageToken: off + size < list.length ? String(off + size) : undefined });
    }
    let mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (mm && method === 'GET' && this.dirLookup(decodeURIComponent(mm[1]), u, done, err)) return;
    if (mm && method === 'GET') {
      const f = this.files.get(decodeURIComponent(mm[1])); if (!f || f.trashed) return err(404, 'File not found', 'notFound');
      if (u.searchParams.get('alt') === 'media') return done(200, f.body, { 'content-type': 'text/markdown; charset=UTF-8' });
      return done(200, this.meta(f));
    }
    mm = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (mm && method === 'PATCH') {
      const f = this.files.get(decodeURIComponent(mm[1])); if (!f) return err(404, 'File not found', 'notFound');
      if (!f.canEdit) return err(403, 'The user does not have sufficient permissions for this file.', 'insufficientFilePermissions');
      f.body = buf || Buffer.alloc(0); f.modifiedTime = this.now(); f.version++; return done(200, this.meta(f));
    }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      const b = /boundary=(.+)$/.exec(entry.ct || '')?.[1]; const s = (buf || Buffer.alloc(0)).toString('utf8');
      const rx = new RegExp('^--' + b + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--' + b + '\\r\\nContent-Type: ([^\\r\\n]+)\\r\\n\\r\\n([\\s\\S]*)\\r\\n--' + b + '--$');
      const pm = rx.exec(s); if (!pm) return err(400, 'bad multipart');
      const meta = JSON.parse(pm[1]); entry.meta = meta; entry.content = pm[3]; entry.contentType = pm[2];
      const f = this.add({ name: meta.name, text: pm[3], mimeType: meta.mimeType, parents: meta.parents });
      return done(200, this.meta(f));
    }
    return err(404, 'unhandled ' + method + ' ' + p);
  }
}
export const failWith = (pred, status, extra = {}) => (e) => (pred(e) ? { status, ...extra } : undefined);

// ------------------------------------------------------------------------------------------------
// chrome.identity stub (init script). Models: signed-in flag, token generations (TOK1, TOK2, ...), lastError.
// cfg: { signedIn, error, interactiveError, missing }
// ------------------------------------------------------------------------------------------------
export function identityInit(cfg = {}) {
  const id = window.__id = { signedIn: cfg.signedIn !== false, gen: 1, calls: [], removed: [], clearAll: 0, error: cfg.error || null, interactiveError: cfg.interactiveError || null };
  Object.defineProperty(chrome.runtime, 'lastError', { get: () => window.__lastErr || undefined, configurable: true });
  if (cfg.missing) { chrome.identity = undefined; return; }
  chrome.identity = {
    getAuthToken(opts, cb) {
      id.calls.push({ interactive: !!(opts && opts.interactive) });
      setTimeout(() => {
        const fail = (m) => { window.__lastErr = { message: m }; try { cb(undefined); } finally { window.__lastErr = null; } };
        if (id.error) return fail(id.error);
        if (opts && opts.interactive) { if (id.interactiveError) return fail(id.interactiveError); id.signedIn = true; return cb('TOK' + id.gen); }
        if (!id.signedIn) return fail('The user is not signed in.');
        cb('TOK' + id.gen);
      }, 0);
    },
    removeCachedAuthToken({ token }, cb) { id.removed.push(token); if (token === 'TOK' + id.gen) id.gen++; setTimeout(cb, 0); },
    clearAllCachedAuthTokens(cb) { id.clearAll++; id.signedIn = false; id.gen++; setTimeout(cb, 0); },
  };
}

// ------------------------------------------------------------------------------------------------
// In-page mock of the createDriveApi() surface. Installed with page.evaluate(installMock, cfg) and then
// assigned: window.__mdwe.driveApi = window.__drv.  Control from tests via window.__drv.{fail,gate,files,calls}.
// ------------------------------------------------------------------------------------------------
export function installMock(cfg) {
  const err = (code, message, extra) => Object.assign(new Error(message || code), { name: 'DriveError', code }, extra || {});
  let tick = 0, nid = 100; const T0 = Date.parse('2026-09-29T12:00:00.000Z');
  const now = () => new Date(T0 + (++tick) * 1000).toISOString();
  const D = window.__drv = { calls: [], fail: {}, gate: {}, signedIn: cfg.signedIn !== false, signedOut: 0, pageSize: cfg.pageSize || 0, files: [], folders: [{ id: 'FOLD1', name: 'Notes' }, { id: 'FOLD2', name: 'Work' }] };
  const mkFile = (f) => ({ id: f.id || 'm' + nid++, name: f.name, text: f.text || '', mimeType: 'text/markdown', canEdit: f.canEdit !== false, modifiedTime: now(), version: 1, size: (f.text || '').length, parents: f.parents });
  D.files = (cfg.files || []).map(mkFile);
  D.remoteEdit = (id, text) => { const f = D.files.find((x) => x.id === id); f.text = text; f.modifiedTime = now(); f.version++; };
  const meta = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: f.text.length, version: String(f.version), parents: f.parents, canEdit: f.canEdit });
  const enter = async (m, args) => {
    D.calls.push({ m, args: JSON.parse(JSON.stringify(args === undefined ? null : args)) });
    if (D.gate[m]) { const g = D.gate[m]; await g; }
    const f = D.fail[m]; if (f) { if (f.once) delete D.fail[m]; throw err(f.code, f.message, f.extra); }
  };
  const byId = (id) => { const f = D.files.find((x) => x.id === id); if (!f) throw err('not-found', 'File not found (deleted, moved, or no access)'); return f; };
  const api = {
    async isSignedIn() { D.calls.push({ m: 'isSignedIn' }); return D.signedIn; },
    async signIn() { await enter('signIn'); D.signedIn = true; return true; },
    async signOut() { D.calls.push({ m: 'signOut' }); D.signedOut++; D.signedIn = false; },
    async getAccountLabel() { return 'tester@example.com'; },
    async listFiles({ query = '', pageToken } = {}) {
      await enter('listFiles', { query, pageToken });
      if (!D.signedIn) throw err('auth', 'Sign in to Google Drive first');
      const all = D.files.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())).slice().reverse();
      const off = Number(pageToken || 0), size = D.pageSize || 50;
      return { files: all.slice(off, off + size).map(meta), nextPageToken: off + size < all.length ? String(off + size) : null };
    },
    async listFolders({ parentId = 'root' } = {}) { await enter('listFolders', { parentId }); return { folders: parentId === 'root' ? D.folders : [], nextPageToken: null }; },
    async getMetadata(id) { await enter('getMetadata', { id }); return meta(byId(id)); },
    async readFile(id) { await enter('readFile', { id }); const f = byId(id); return { ...meta(f), text: f.text }; },
    async saveFile(id, text, { expectedModifiedTime, force = false } = {}) {
      await enter('saveFile', { id, text, expectedModifiedTime, force });
      const f = byId(id);
      if (!f.canEdit) throw err('read-only', 'You only have view access to this file');
      if (!force && expectedModifiedTime && f.modifiedTime !== expectedModifiedTime) throw err('conflict', 'This file changed in Drive since you opened it', { remoteModifiedTime: f.modifiedTime, expectedModifiedTime });
      f.text = text; f.modifiedTime = now(); f.version++; return meta(f);
    },
    async createFile(name, text, { parentId } = {}) {
      await enter('createFile', { name, text, parentId });
      const n = /\.(md|markdown|mdown)$/i.test(name) ? name : name + '.md';
      const f = mkFile({ name: n, text, parents: parentId ? [parentId] : ['root'] }); D.files.push(f); return meta(f);
    },
  };
  D.api = api; return true;
}

// ------------------------------------------------------------------------------------------------
// Open the editor page with optional FakeDrive routing and identity stub. Returns handles + request recorder.
// opts: { drive: FakeDrive, identity: cfg|false, mock: {files,...}, query, extraInit: [fn|[fn,arg]] }
// ------------------------------------------------------------------------------------------------
export async function openDriveEditor(ext, { drive, identity, mock, query = '', extraInit = [], autoDialog = 'accept' } = {}) {
  if (drive) {
    await ext.ctx.route(/^https:\/\/(www|oauth2)\.googleapis\.com\//, (route) => drive.handle(route));
  }
  const page = await ext.ctx.newPage();
  const errors = []; const dialogs = []; const external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { const u = r.url(); if (!/^(chrome-extension|blob|data):/.test(u)) external.push(r.method() + ' ' + u); });
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); autoDialog === 'dismiss' ? d.dismiss() : d.accept(); });
  if (identity !== false && (identity || drive)) await page.addInitScript(identityInit, identity || {});
  for (const e of extraInit) Array.isArray(e) ? await page.addInitScript(e[0], e[1]) : await page.addInitScript(e);
  await page.goto(`chrome-extension://${ext.extId}/editor/index.html${query}`);
  await page.waitForFunction(() => window.__mdwe && window.__mdwe.editor);
  if (mock) { await page.evaluate(installMock, mock); await page.evaluate(() => { window.__mdwe.driveApi = window.__drv.api; }); }
  return { page, errors, dialogs, external, drive, extId: ext.extId };
}

export const shot = async (page, name) => { fs.mkdirSync(SCREENS, { recursive: true }); await page.screenshot({ path: path.join(SCREENS, name) }); };
