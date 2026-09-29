// node tests/drive/api.test.mjs  — unit tests for src/drive/api.js with mocked chrome.identity + fetch
import assert from 'node:assert/strict';
import { createDriveApi, DriveError } from '../../src/drive/api.js';

let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };
const resp = (status, body, text) => ({ status, ok: status >= 200 && status < 300, statusText: 'S' + status, json: async () => body, text: async () => text ?? JSON.stringify(body) });
function mk({ tokens = ['T1', 'T2'], handler }) {
  const calls = []; let ti = 0, removed = [];
  globalThis.chrome = { runtime: { lastError: null } };
  const identity = { getAuthToken: (o, cb) => cb(tokens[Math.min(ti++, tokens.length - 1)]), removeCachedAuthToken: (o, cb) => { removed.push(o.token); cb(); }, clearAllCachedAuthTokens: (cb) => cb() };
  const fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init, calls.length); };
  return { api: createDriveApi({ identity, fetch }), calls, removed };
}
const meta = (o = {}) => ({ id: 'f1', name: 'a.md', mimeType: 'text/markdown', modifiedTime: '2026-01-01T00:00:00.000Z', version: '3', size: '5', capabilities: { canEdit: true }, ...o });

await t('listFiles builds md query, escapes quotes, filters non-md, returns nextPageToken', async () => {
  const { api, calls } = mk({ handler: () => resp(200, { nextPageToken: 'N', files: [meta(), meta({ id: 'x', name: 'photo.png', mimeType: 'image/png' })] }) });
  const r = await api.listFiles({ query: "it's", pageToken: 'P' });
  assert.equal(r.files.length, 1); assert.equal(r.nextPageToken, 'N');
  const u = new URL(calls[0].url); const q = u.searchParams.get('q');
  assert.match(q, /trashed = false/); assert.match(q, /name contains 'it\\'s'/); assert.equal(u.searchParams.get('pageToken'), 'P');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer T1');
});
await t('readFile returns text + metadata; rejects Google Docs', async () => {
  const { api } = mk({ handler: (u) => u.includes('alt=media') ? resp(200, null, '# hi') : resp(200, meta()) });
  const r = await api.readFile('f1'); assert.equal(r.text, '# hi'); assert.equal(r.modifiedTime, '2026-01-01T00:00:00.000Z');
  const m2 = mk({ handler: () => resp(200, meta({ mimeType: 'application/vnd.google-apps.document' })) });
  await assert.rejects(m2.api.readFile('f1'), (e) => e.code === 'http');
});
await t('saveFile PATCHes media upload with text/markdown when unchanged', async () => {
  const { api, calls } = mk({ handler: (u, init) => init.method === 'PATCH' ? resp(200, meta({ modifiedTime: '2026-02-02T00:00:00.000Z' })) : resp(200, meta()) });
  const r = await api.saveFile('f1', '# new', { expectedModifiedTime: '2026-01-01T00:00:00.000Z' });
  const p = calls.find((c) => c.init.method === 'PATCH'); assert.match(p.url, /upload\/drive\/v3\/files\/f1\?uploadType=media/); assert.equal(p.init.body, '# new'); assert.match(p.init.headers['Content-Type'], /text\/markdown/);
  assert.equal(r.modifiedTime, '2026-02-02T00:00:00.000Z');
});
await t('saveFile conflict when remote modifiedTime changed; no PATCH sent; force overrides', async () => {
  const h = (u, init) => init.method === 'PATCH' ? resp(200, meta({ modifiedTime: 'NEW' })) : resp(200, meta({ modifiedTime: 'REMOTE' }));
  const { api, calls } = mk({ handler: h });
  await assert.rejects(api.saveFile('f1', 'x', { expectedModifiedTime: 'OLD' }), (e) => e.code === 'conflict' && e.remoteModifiedTime === 'REMOTE');
  assert.equal(calls.filter((c) => c.init.method === 'PATCH').length, 0);
  await api.saveFile('f1', 'x', { expectedModifiedTime: 'OLD', force: true });
  assert.equal(calls.filter((c) => c.init.method === 'PATCH').length, 1);
});
await t('saveFile read-only file -> read-only error', async () => {
  const { api } = mk({ handler: () => resp(200, meta({ capabilities: { canEdit: false } })) });
  await assert.rejects(api.saveFile('f1', 'x'), (e) => e.code === 'read-only');
});
await t('401 refreshes token once and retries', async () => {
  let n = 0; const { api, calls, removed } = mk({ handler: () => (++n === 1 ? resp(401, { error: { message: 'expired' } }) : resp(200, { files: [] })) });
  await api.listFiles(); assert.equal(calls.length, 2); assert.deepEqual(removed, ['T1']); assert.equal(calls[1].init.headers.Authorization, 'Bearer T2');
});
await t('persistent 401 -> auth error; 404 -> not-found; 403 -> forbidden; 403 rateLimit -> quota', async () => {
  await assert.rejects(mk({ handler: () => resp(401, {}) }).api.listFiles(), (e) => e.code === 'auth');
  await assert.rejects(mk({ handler: () => resp(404, {}) }).api.readFile('x'), (e) => e.code === 'not-found');
  await assert.rejects(mk({ handler: () => resp(403, { error: { message: 'no', errors: [{ reason: 'insufficientFilePermissions' }] } }) }).api.listFiles(), (e) => e.code === 'forbidden');
  await assert.rejects(mk({ handler: () => resp(403, { error: { message: 'slow', errors: [{ reason: 'userRateLimitExceeded' }] } }) }).api.listFiles(), (e) => e.code === 'quota');
});
await t('429 -> quota', async () => {
  await assert.rejects(mk({ handler: () => resp(429, {}) }).api.listFiles(), (e) => e.code === 'quota');
});
await t('list query broad, client filter keeps only md-like names', async () => {
  const { api, calls } = mk({ handler: () => resp(200, { files: [meta({ name: 'notes.md' }), meta({ id: 'y', name: 'md-guide.pdf', mimeType: 'application/pdf' }), meta({ id: 'z', name: 'README', mimeType: 'text/markdown' }), meta({ id: 'w', name: 'a.MARKDOWN', mimeType: 'text/plain' })] }) });
  const r = await api.listFiles(); assert.deepEqual(r.files.map((f) => f.name), ['notes.md', 'README', 'a.MARKDOWN']);
  assert.match(new URL(calls[0].url).searchParams.get('q'), /name contains 'md'/);
});
await t('network failure -> offline', async () => {
  const { api } = mk({ handler: () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(api.listFiles(), (e) => e.code === 'offline');
});
await t('createFile sends multipart with name, parent, .md appended', async () => {
  const { api, calls } = mk({ handler: () => resp(200, meta({ id: 'new', name: 'n.md' })) });
  const r = await api.createFile('n', '# t', { parentId: 'P1' }); assert.equal(r.id, 'new');
  const c = calls[0]; assert.match(c.url, /uploadType=multipart/); assert.match(c.init.headers['Content-Type'], /^multipart\/related; boundary=/);
  assert.match(c.init.body, /"name":"n\.md"/); assert.match(c.init.body, /"parents":\["P1"\]/); assert.match(c.init.body, /# t/);
});
await t('isSignedIn / signIn / not-configured mapping', async () => {
  globalThis.chrome = { runtime: { lastError: null } };
  const bad = createDriveApi({ identity: { getAuthToken: (o, cb) => { chrome.runtime.lastError = { message: 'OAuth2 request failed: Service responded with error: bad client id' }; cb(undefined); } }, fetch: async () => resp(200, {}) });
  assert.equal(await bad.isSignedIn(), false);
  await assert.rejects(bad.signIn(), (e) => e.code === 'not-configured');
  chrome.runtime.lastError = null;
  const canc = createDriveApi({ identity: { getAuthToken: (o, cb) => { chrome.runtime.lastError = { message: 'The user did not approve access.' }; cb(undefined); } }, fetch: async () => resp(200, {}) });
  await assert.rejects(canc.signIn(), (e) => e.code === 'auth-cancelled');
  chrome.runtime.lastError = null;
});
await t('listFolders + getAccountLabel', async () => {
  const { api } = mk({ handler: (u) => u.includes('/about') ? resp(200, { user: { emailAddress: 'a@b.c' } }) : resp(200, { files: [{ id: 'd', name: 'Docs' }] }) });
  assert.equal(await api.getAccountLabel(), 'a@b.c'); assert.deepEqual((await api.listFolders()).folders, [{ id: 'd', name: 'Docs' }]);
});
console.log(pass + ' passed'); 
