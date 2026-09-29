// Drive test helpers: FakeDrive (Node-side Google Drive v3 emulator served through Playwright context.route),
// chrome.identity stub (init script), in-page mock of the api.js surface, and openDriveEditor().
import fs from 'node:fs';
import path from 'node:path';
import { SCREENS } from './fixture.mjs';

export const DRIVE_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// ------------------------------------------------------------------------------------------------
// FakeDrive: in-memory Drive. `log` records every request that reached it.
// ------------------------------------------------------------------------------------------------
export class FakeDrive {
  constructor(files = []) {
    this.files = new Map(); this.folders = [{ id: 'FOLD1', name: 'Notes' }, { id: 'FOLD2', name: 'Work' }];
    this.log = []; this.hooks = []; this.cors = true; this.minGen = 1; this.alwaysAuthFail = false; this.pageSize = 0;
    this.t0 = Date.parse('2026-09-29T12:00:00.000Z'); this.tick = 0; this.nextId = 1;
    for (const f of files) this.add(f);
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

  async handle(route) {
    const req = route.request(); const u = new URL(req.url()); const method = req.method();
    const H = this.cors ? { ...DRIVE_CORS } : {};
    const fulfill = (status, body, extra = {}) => route.fulfill({ status, headers: { ...H, ...extra }, contentType: extra['content-type'] || 'application/json', body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    if (method === 'OPTIONS') { this.log.push({ method, host: u.host, path: u.pathname, status: 204, preflight: true }); return route.fulfill({ status: this.cors ? 204 : 405, headers: H }); }
    const hdr = req.headers();
    const buf = req.postDataBuffer();
    const entry = { method, host: u.host, path: u.pathname, search: Object.fromEntries(u.searchParams), url: req.url(), auth: hdr.authorization, ct: hdr['content-type'], body: buf, status: 0 };
    this.log.push(entry);
    const done = (status, body, extra) => { entry.status = status; return fulfill(status, body, extra); };
    const err = (status, message, reason) => done(status, { error: { code: status, message, errors: reason ? [{ reason, message }] : [] } });
    for (const h of this.hooks) { const r = await h(entry, this); if (r) { if (r.abort) { entry.status = -1; return route.abort(r.abort === true ? 'internetdisconnected' : r.abort); } return err(r.status, r.message || 'injected ' + r.status, r.reason); } }
    if (u.host === 'oauth2.googleapis.com') return done(200, {});
    const m = /^Bearer TOK(\d+)$/.exec(entry.auth || '');
    if (this.alwaysAuthFail || !m || Number(m[1]) < this.minGen) return err(401, 'Invalid Credentials');
    const p = u.pathname;
    if (p === '/drive/v3/about') return done(200, { user: { emailAddress: 'tester@example.com', displayName: 'Tester' } });
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      let list;
      if (/mimeType = 'application\/vnd\.google-apps\.folder' and/.test(q)) list = this.folders.map((f) => ({ id: f.id, name: f.name }));
      else {
        const uq = / and name contains '((?:[^'\\]|\\.)*)'/.exec(q);
        list = [...this.files.values()].filter((f) => !f.trashed && (!uq || f.name.toLowerCase().includes(uq[1].replace(/\\(.)/g, '$1').toLowerCase())))
          .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).map((f) => this.meta(f));
      }
      const size = this.pageSize || Number(u.searchParams.get('pageSize')) || 50; const off = Number(u.searchParams.get('pageToken') || 0);
      const page = list.slice(off, off + size);
      return done(200, { files: page, nextPageToken: off + size < list.length ? String(off + size) : undefined });
    }
    let mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
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
