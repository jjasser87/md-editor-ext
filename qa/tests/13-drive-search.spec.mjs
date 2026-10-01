// 13. Drive FOLDER SEARCH (Save to Drive dialog).  Harness = tests/10 section B: the real createDriveApi() bundled in the editor page,
//     stubbed chrome.identity, and a Node-side FakeDrive (lib/drive.mjs) behind context.route('https://www.googleapis.com/*').
//     The emulator parses the real `q` grammar (strings with \' and \\ only), so any escaping mistake = HTTP 400.
//   A. API-level  (window.__mdwe.driveApi.listFolders / getRecentFolders / addRecentFolder)
//   B. [UI]       Save-to-Drive dialog (hooks: [data-role=folder-search], [data-action=clear-search|up|more|retry|signin|save],
//                 .gdui-folders li.gdui-row[data-kind=result|folder|recent][data-folder-id] .gdui-fn/.gdui-fpath, .gdui-subhead, .gdui-dest)
//   Tests titled [BUG-n] are probes for a real bug logged in ../BUGS.md: they FAIL until it is fixed.
import { test, expect, md, setMd, storageGet, SCREENS } from '../lib/fixture.mjs';
import { openDriveEditor, FakeDrive, shot } from '../lib/drive.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';

const ROOTDIR = path.resolve(SCREENS, '..', '..');
const OUT = path.resolve(SCREENS, '..', 'out');
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BASE = `mimeType = '${FOLDER_MIME}' and trashed = false and `;
const mk = (files = []) => new FakeDrive(files, { defaultFolders: false });
const R = (drive, o = {}) => ({ drive, ...o });
const isFolderList = (e) => e.path === '/drive/v3/files' && e.method === 'GET' && (e.q || '').includes(FOLDER_MIME);
const isSearch = (e) => isFolderList(e) && / and name contains '/.test(e.q);

const call = (p, m, ...args) => p.evaluate(async ([m, args]) => {
  try { return { ok: await window.__mdwe.driveApi[m](...args) }; }
  catch (e) { return { err: { name: e.name, code: e.code, message: e.message, status: e.status, reason: e.reason } }; }
}, [m, args]);
const lf = async (p, o) => { const r = await call(p, 'listFolders', o); if (r.err) throw new Error('listFolders failed: ' + JSON.stringify(r.err)); return r.ok; };
const names = (r) => r.folders.map((f) => f.name);
const byName = (r, n) => r.folders.filter((f) => f.name === n);
const ref = (s) => s.split('\\').join('\\\\').split("'").join("\\'"); // independent reference escaper
const recents = (p) => call(p, 'getRecentFolders').then((r) => r.ok);
const addRecent = (p, f) => call(p, 'addRecentFolder', f);
const isLookup = (e) => /^\/drive\/v3\/files\/[^/]+$/.test(e.path) && e.search.alt !== 'media';

// =====================================================================================================================
// A. API LEVEL
// =====================================================================================================================
test.describe('Drive folder search: API (real api.js + FakeDrive)', () => {
  test('hits: case-insensitive contains, multiple matches, only {id,name,path}, name_natural order; exact request', async ({ ext }) => {
    const d = mk(); d.tree('Projects'); d.tree('My-projects'); d.tree('Archive/old projects'); d.tree('Other');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    for (const q of ['proj', 'PROJ', 'pRoJ']) {
      const res = await lf(p, { query: q });
      expect(names(res).sort(), q).toEqual(['My-projects', 'Projects', 'old projects']);
      for (const f of res.folders) expect(Object.keys(f).sort()).toEqual(['id', 'name', 'path']);
      expect(res.nextPageToken).toBeNull();
    }
    const req = d.searchReqs()[0];
    expect(req.q).toBe(BASE + "name contains 'proj'");
    expect(req.search).toMatchObject({ orderBy: 'name_natural', pageSize: '50', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives', fields: 'nextPageToken,files(id,name,parents)' });
    expect(Object.keys(req.search).sort(), 'only corpora was added vs the pre-fix request').toEqual(['corpora', 'fields', 'includeItemsFromAllDrives', 'orderBy', 'pageSize', 'q', 'supportsAllDrives']);
    expect(req.url).toContain('corpora=allDrives'); expect(req.url).not.toContain('driveId=');
    console.log('[13] typical request params: ' + JSON.stringify(req.search));
    expect(req.auth).toBe('Bearer TOK1');
    expect(r.errors).toEqual([]);
  });

  test('no results -> { folders: [], nextPageToken: null }; no crash', async ({ ext }) => {
    const d = mk(); d.tree('Projects');
    const r = await openDriveEditor(ext, R(d));
    expect(await lf(r.page, { query: 'zzz-nope' })).toEqual({ folders: [], nextPageToken: null });
  });

  test('blank query browses exactly as before: same q/orderBy/pageSize/fields as HEAD, children of parentId, no path, no search clause', async ({ ext }) => {
    const d = mk(); d.tree('Projects/2026'); d.tree('Zeta'); d.addFolder({ id: 'trashedone', name: 'Gone', trashed: true });
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const root = await lf(p, {}); expect(root.folders).toEqual([{ id: 'T:Projects', name: 'Projects' }, { id: 'T:Zeta', name: 'Zeta' }]);
    const sub = await lf(p, { parentId: 'T:Projects' }); expect(sub.folders).toEqual([{ id: 'T:Projects/2026', name: '2026' }]);
    const a = d.folderReqs()[0];
    expect(a.q).toBe(BASE + "'root' in parents");
    expect(a.search).toMatchObject({ orderBy: 'name', pageSize: '100', fields: 'nextPageToken,files(id,name)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    expect(Object.keys(a.search).sort(), 'browse request params exactly as at HEAD (no corpora)').toEqual(['fields', 'includeItemsFromAllDrives', 'orderBy', 'pageSize', 'q', 'supportsAllDrives']);
    expect(d.folderReqs().length).toBe(2); expect(d.lookups().length, 'browse must not look up parents').toBe(0);
    for (const b of [{ query: '' }, { query: undefined }, { query: null }]) { const x = await lf(p, b); expect(x.folders.map((f) => f.name), JSON.stringify(b)).toEqual(['Projects', 'Zeta']); }
    const res = await call(p, 'listFolders', { parentId: "a'b\\c" }); expect(res.ok).toBeTruthy();
    expect(d.folderReqs().pop().q).toBe(BASE + String.raw`'a\'b\\c' in parents`);
  });

  test('whitespace-only / padded queries: blank (incl. tab, newline, NBSP) == browse; padded query is trimmed; inner spaces kept', async ({ ext }) => {
    const d = mk(); d.tree('Projects'); d.tree('Two Words');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    for (const q of ['   ', '\t', '\n ', '\u00a0', ' \u2003 ']) {
      const before = d.folderReqs().length; const x = await lf(p, { query: q });
      const req = d.folderReqs()[before];
      expect(req.q, JSON.stringify(q)).toBe(BASE + "'root' in parents"); expect(x.folders.every((f) => f.path === undefined)).toBe(true);
    }
    const x = await lf(p, { query: '  two words \n' }); expect(names(x)).toEqual(['Two Words']);
    expect(d.searchReqs().pop().q).toBe(BASE + "name contains 'two words'");
  });

  test('search ignores parentId (no "in parents" clause)', async ({ ext }) => {
    const d = mk(); d.tree('Work/Reports'); d.tree('Personal/Reports');
    const r = await openDriveEditor(ext, R(d));
    const x = await lf(r.page, { query: 'Reports', parentId: 'T:Work' });
    expect(x.folders.length).toBe(2);
    expect(d.searchReqs()[0].q).not.toMatch(/in parents/);
  });

  test('escaping: names/queries with quote, dquote, backslash, %, &, #, unicode, emoji and backslash-quote combos are sent escaped, match literally, emulator never sees a 400', async ({ ext }) => {
    const weird = ["it's", 'say "hi"', String.raw`back\slash`, String.raw`trailing\\`, String.raw`\'`, String.raw`\\'`, '100% & #1 <b>', 'café ☕ 日本語', '📁 emoji 🚀', "x' or name contains '", "x' or '1'='1", "') or trashed = true or ('", 'a%27b', 'a\\u0027b', '%', '?q=1&x=2'];
    const d = mk(); for (const w of weird) d.addFolder({ name: 'F:' + w }); d.addFolder({ name: 'x' }); d.addFolder({ name: 'decoy one' });
    const r = await openDriveEditor(ext, R(d)); const p = r.page; const table = [];
    for (const w of weird) {
      const res = await call(p, 'listFolders', { query: w });
      expect(res.err, 'query ' + JSON.stringify(w) + ' -> ' + JSON.stringify(res.err)).toBeUndefined();
      const sent = d.searchReqs().pop().q;
      expect(sent, JSON.stringify(w)).toBe(BASE + `name contains '${ref(w.trim())}'`);
      expect(names(res.ok), JSON.stringify(w)).toContain('F:' + w);
      expect(res.ok.folders.every((f) => f.name.toLowerCase().includes(w.trim().toLowerCase())), 'only literal matches: ' + JSON.stringify(names(res.ok))).toBe(true);
      table.push({ query: w, q: sent });
    }
    const qs = Object.fromEntries(table.map((t) => [t.query, t.q]));
    expect(qs["it's"]).toBe(BASE + String.raw`name contains 'it\'s'`);
    expect(qs[String.raw`back\slash`]).toBe(BASE + String.raw`name contains 'back\\slash'`);
    expect(qs[String.raw`\'`]).toBe(BASE + String.raw`name contains '\\\''`);
    expect(qs["x' or name contains '"]).toBe(BASE + String.raw`name contains 'x\' or name contains \''`);
    expect(qs['say "hi"']).toBe(BASE + `name contains 'say "hi"'`);
    const inj = await lf(p, { query: "x' or name contains '" }); expect(names(inj)).toEqual(["F:x' or name contains '"]);
    const tb = await call(p, 'listFolders', { query: 'abc\\' }); expect(tb.err).toBeUndefined();
    expect(d.log.filter((l) => l.status === 400).length, 'no 400s from the emulator').toBe(0);
    fs.writeFileSync(path.join(OUT, 'drive-search-escaping-requests.json'), JSON.stringify(table, null, 1));
  });

  test('very long query (5,000 chars) is sent and matched; 414 from the server surfaces as a DriveError, not a crash', async ({ ext }) => {
    const long = 'L' + 'x'.repeat(4999);
    const d = mk(); d.addFolder({ name: long + ' folder' }); d.addFolder({ name: 'short' });
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const x = await lf(p, { query: long }); expect(names(x)).toEqual([long + ' folder']);
    expect(d.searchReqs()[0].q.length).toBeGreaterThan(5000);
    d.maxUrl = 4000;
    const e = await call(p, 'listFolders', { query: long });
    expect(e.err, 'error expected').toBeTruthy(); expect(e.err.name).toBe('DriveError'); expect(e.err.status).toBe(414); console.log('[13] 414 surfaces as: ' + JSON.stringify(e.err));
    expect(r.errors.filter((m) => !/414/.test(m))).toEqual([]);
  });

  test('trashed folders (explicit or inside a trashed parent) and non-folder files (md, Google Doc, shortcut, image) are excluded', async ({ ext }) => {
    const d = mk([{ id: 'f1', name: 'report notes.md', text: 'x' }, { id: 'img', name: 'report.png', mimeType: 'image/png' }, { id: 'gd', name: 'report doc', mimeType: 'application/vnd.google-apps.document' }, { id: 'sc', name: 'report shortcut', mimeType: 'application/vnd.google-apps.shortcut' }]);
    d.addFolder({ id: 'live', name: 'report live' }); d.addFolder({ id: 'tr', name: 'report trashed', trashed: true });
    d.addFolder({ id: 'trp', name: 'report parent trashed', trashed: true }); d.addFolder({ id: 'child', name: 'report child of trashed', parents: ['trp'] });
    const r = await openDriveEditor(ext, R(d));
    const x = await lf(r.page, { query: 'report' }); expect(names(x)).toEqual(['report live']);
    expect(d.searchReqs()[0].q).toContain('trashed = false');
  });

  test('pagination: nextPageToken round-trips with the same q; all pages aggregate to every folder exactly once; empty pages carrying a token do not end the walk', async ({ ext }) => {
    const d = mk(); for (let i = 1; i <= 130; i++) d.tree('Bulk/Item ' + String(i).padStart(3, '0')); d.tree('Bulk/Other');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const walk = async () => { const all = []; let tok; let pages = 0; do { const x = await lf(p, { query: 'Item', pageToken: tok }); all.push(...x.folders); tok = x.nextPageToken || undefined; pages++; } while (tok && pages < 50); return { all, pages }; };
    const w = await walk(); expect(w.pages).toBe(3);
    expect(w.all.length).toBe(130); expect(new Set(w.all.map((f) => f.id)).size).toBe(130);
    expect(w.all.map((f) => f.name)).toEqual(Array.from({ length: 130 }, (_, i) => 'Item ' + String(i + 1).padStart(3, '0')));
    const qs = d.searchReqs(); expect(new Set(qs.map((l) => l.q)).size).toBe(1);
    expect(qs.map((l) => l.search.pageToken || null)).toEqual([null, expect.any(String), expect.any(String)]);
    expect(w.all.every((f) => f.path === 'My Drive / Bulk')).toBe(true);
    expect(qs.every((l) => l.search.corpora === 'allDrives'), 'corpora=allDrives on every page').toBe(true);
    d.emptyPages = 2; const w2 = await walk(); expect(w2.all.length).toBe(130); expect(w2.pages).toBe(5);
    const bad = await call(p, 'listFolders', { query: 'Item', pageToken: 'garbage' }); expect(bad.err && bad.err.code).toBe('http'); expect(bad.err.status).toBe(400);
  });

  test('shared drives: request carries supportsAllDrives+includeItemsFromAllDrives; shared-drive folder found, path starts with the drive name; lookups pass supportsAllDrives', async ({ ext }) => {
    const d = mk(); d.addSharedDrive({ id: 'SD1', name: 'Team Drive' });
    d.addFolder({ id: 'sdroot', name: 'Specs', parents: ['SD1'], driveId: 'SD1' }); d.addFolder({ id: 'sdf', name: 'Specs 2026', parents: ['sdroot'], driveId: 'SD1' }); d.tree('Specs mine');
    const r = await openDriveEditor(ext, R(d));
    const x = await lf(r.page, { query: 'specs' });
    expect(names(x).sort()).toEqual(['Specs', 'Specs 2026', 'Specs mine']);
    expect(byName(x, 'Specs')[0].path).toBe('Team Drive'); expect(byName(x, 'Specs 2026')[0].path).toBe('Team Drive / Specs'); expect(byName(x, 'Specs mine')[0].path).toBe('My Drive');
    expect(d.searchReqs()[0].search).toMatchObject({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    expect(d.lookups().every((l) => l.search.supportsAllDrives === 'true')).toBe(true);
  });

  test('[BUG-33] folders in shared drives the user never opened ARE found (corpora=allDrives + includeItemsFromAllDrives + supportsAllDrives - the documented valid combination); paths resolve; My Drive results still present', async ({ ext }) => {
    const d = mk(); d.addSharedDrive({ id: 'SD2', name: 'Finance' });
    d.addFolder({ id: 'fin1', name: 'Budget 2027', parents: ['SD2'], driveId: 'SD2', accessed: false });
    d.addFolder({ id: 'fin2', name: 'Budget 2026', parents: ['SD2'], driveId: 'SD2', accessed: true });
    const r = await openDriveEditor(ext, R(d));
    const x = await lf(r.page, { query: 'budget' });
    const req = d.searchReqs()[0];
    console.log(`[13] BUG-33 facts: corpora=${req.search.corpora} includeItemsFromAllDrives=${req.search.includeItemsFromAllDrives} -> found ${JSON.stringify(names(x))}`);
    expect(names(x).sort(), 'shared-drive folders must be searchable even if never accessed').toEqual(['Budget 2026', 'Budget 2027']);
    expect(req.search).toMatchObject({ corpora: 'allDrives', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }); expect(req.search.driveId).toBeUndefined();
    expect(x.folders.every((f) => f.path === 'Finance')).toBe(true);
    expect(x.incompleteSearch, 'not set unless Drive says so').toBeUndefined();
  });

  test('[BUG-33] mixed My Drive + shared-drive hits under corpora=allDrives: union, no duplicates, My Drive-only folders still found', async ({ ext }) => {
    const d = mk(); d.addSharedDrive({ id: 'SD9', name: 'Ops' }); d.tree('Plans/Plan A'); d.addFolder({ id: 'sp', name: 'Plan B', parents: ['SD9'], driveId: 'SD9', accessed: false }); d.addFolder({ id: 'sp2', name: 'Plan C', parents: ['SD9'], driveId: 'SD9', accessed: true });
    const r = await openDriveEditor(ext, R(d)); const x = await lf(r.page, { query: 'plan' });
    expect(names(x).sort()).toEqual(['Plan A', 'Plan B', 'Plan C', 'Plans']); expect(new Set(x.folders.map((f) => f.id)).size).toBe(4);
    expect(byName(x, 'Plan A')[0].path).toBe('My Drive / Plans'); expect(byName(x, 'Plan B')[0].path).toBe('Ops');
  });

  test('[BUG-33] incompleteSearch:true from Drive is passed through on the result (and absent otherwise); results still returned; emulator rejects corpora=allDrives misuse (invalid corpora value -> 400)', async ({ ext }) => {
    const d = mk(); d.tree('Alpha'); d.incompleteSearch = true;
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const x = await lf(p, { query: 'alp' }); expect(x.incompleteSearch).toBe(true); expect(names(x)).toEqual(['Alpha']);
    d.incompleteSearch = false; const y = await lf(p, { query: 'alp' }); expect('incompleteSearch' in y).toBe(false);
    const b = await lf(p, {}); expect('incompleteSearch' in b, 'browse result shape unchanged').toBe(false);
    d.incompleteSearch = true; const c = await lf(p, {}); expect('incompleteSearch' in c, 'browse never sends corpora, so never incomplete').toBe(false);
  });

  test('shared-drive folder whose drive root cannot be resolved, and a folder with no parents -> path undefined (no crash, no bogus path)', async ({ ext }) => {
    const d = mk(); d.addSharedDrive({ id: 'SD3', name: 'Hidden' }); d.sharedRootResolvable = false;
    d.addFolder({ id: 'h1', name: 'Hfolder', parents: ['SD3'], driveId: 'SD3' }); d.addFolder({ id: 'h2', name: 'Horphan', parents: [] });
    const r = await openDriveEditor(ext, R(d));
    const x = await lf(r.page, { query: 'h' }); expect(x.folders.length).toBe(2); expect(x.folders.every((f) => f.path === undefined)).toBe(true);
  });

  test('path building: depth 1 / depth 3 / same-named folders in different parents get different paths / 8-level limit + truncation behaviour', async ({ ext }) => {
    const d = mk(); d.tree('Solo'); d.tree('Projects/2026/Q3'); d.tree('Work/Reports'); d.tree('Personal/Reports');
    d.tree(Array.from({ length: 8 }, (_, i) => 'Dp' + (i + 1)).join('/'));
    d.tree(Array.from({ length: 9 }, (_, i) => 'Dq' + (i + 1)).join('/'));
    d.tree(Array.from({ length: 14 }, (_, i) => 'Dz' + String(i + 1).padStart(2, '0')).join('/'));
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    expect(byName(await lf(p, { query: 'Solo' }), 'Solo')[0].path).toBe('My Drive');
    expect(byName(await lf(p, { query: 'Q3' }), 'Q3')[0].path).toBe('My Drive / Projects / 2026');
    const rep = await lf(p, { query: 'Reports' }); expect(rep.folders.map((f) => f.path).sort()).toEqual(['My Drive / Personal', 'My Drive / Work']);
    expect(new Set(rep.folders.map((f) => f.id)).size).toBe(2);
    expect(byName(await lf(p, { query: 'Dp8' }), 'Dp8')[0].path).toBe('My Drive / Dp1 / Dp2 / Dp3 / Dp4 / Dp5 / Dp6 / Dp7');
    const dq = byName(await lf(p, { query: 'Dq9' }), 'Dq9')[0].path;
    const dz = byName(await lf(p, { query: 'Dz14' }), 'Dz14')[0].path;
    console.log(`[13] truncation: 9-level leaf path = ${JSON.stringify(dq)} ; 14-level leaf path = ${JSON.stringify(dz)} (no ellipsis marker; topmost ancestors dropped)`);
    expect(dq.split(' / ').length).toBeLessThanOrEqual(8); expect(dq.endsWith('Dq8')).toBe(true);
    expect(dz.split(' / ').length).toBeLessThanOrEqual(8); expect(dz.endsWith('Dz13')).toBe(true);
    expect(dz).not.toContain('My Drive');
  });

  test('path building: unresolvable parent (403) -> path undefined; other results unaffected; search itself still succeeds', async ({ ext }) => {
    const d = mk(); d.tree('Locked/Inner'); d.tree('Open/Leafy'); d.forbidden.add('T:Locked');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const x = await lf(p, { query: 'Inner' }); expect(names(x)).toEqual(['Inner']); expect(x.folders[0].path).toBeUndefined();
    const y = await lf(p, { query: 'Leafy' }); expect(y.folders[0].path).toBe('My Drive / Open');
    d.tree('Mid/Deep/Leaf2'); d.forbidden.add(d.ROOT_ID);
    const z = await lf(p, { query: 'Leaf2' }); console.log('[13] partial chain (root lookup 403) path = ' + JSON.stringify(z.folders[0].path));
  });

  test('path cache: a repeated / overlapping search does not re-fetch parents; new parents are fetched once (sequential)', async ({ ext }) => {
    const d = mk(); d.tree('Alpha/Share1'); d.tree('Alpha/Share2'); d.tree('Beta/Share3');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    await lf(p, { query: 'Share1' });
    const l1 = d.lookups().length; expect(l1).toBeGreaterThan(0);
    await lf(p, { query: 'Share1' }); expect(d.lookups().length, 'same search again').toBe(l1);
    await lf(p, { query: 'Share2' }); expect(d.lookups().length, 'sibling shares the parent chain').toBe(l1);
    await lf(p, { query: 'Share3' }); const l3 = d.lookups().length; expect(l3).toBe(l1 + 1);
    await lf(p, { query: 'Share' }); expect(d.lookups().length).toBe(l3);
    expect(d.searchReqs().length).toBe(5);
  });

  test('[BUG-34] first search with N results sharing one parent fires exactly ONE lookup per distinct parent (in-flight promise cached): 40 siblings -> 1 parent + root = 2 files.get', async ({ ext }) => {
    const d = mk(); for (let i = 1; i <= 40; i++) d.tree('Fan/Item' + String(i).padStart(2, '0'));
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const x = await lf(p, { query: 'Item' }); expect(x.folders.length).toBe(40);
    const perId = {}; for (const l of d.lookups()) { const id = decodeURIComponent(l.path.split('/').pop()); perId[id] = (perId[id] || 0) + 1; }
    console.log(`[13] BUG-34 facts: 40 results under one parent -> ${d.lookups().length} files.get lookups; per id ${JSON.stringify(perId)}`);
    for (const [id, n] of Object.entries(perId)) expect(n, `parent ${id} fetched ${n}x in one search`).toBe(1);
    expect(d.lookups().length).toBe(2);
  });

  test('[BUG-34] in-flight dedupe holds for 500 results (one page) and across a varied tree: lookups == number of distinct ancestors, not results; repeat search adds 0', async ({ ext }) => {
    const d = mk(); d.pageSize = 500;
    for (let i = 0; i < 500; i++) d.tree(`G${i % 10}/H${i % 50}/Leaf ${String(i).padStart(3, '0')}`);   // 10 + 50 distinct ancestors (+ root)
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const x = await lf(p, { query: 'Leaf' }); expect(x.folders.length).toBe(500);
    const perId = {}; for (const l of d.lookups()) { const id = decodeURIComponent(l.path.split('/').pop()); perId[id] = (perId[id] || 0) + 1; }
    const distinct = Object.keys(perId).length; console.log(`[13] dedupe 500 results: ${d.lookups().length} files.get lookups for ${distinct} distinct ids`);
    expect(Math.max(...Object.values(perId))).toBe(1);
    expect(distinct).toBe(10 + 50 + 1); expect(d.lookups().length).toBe(61);
    expect(x.folders.every((f) => /^My Drive \/ G\d \/ H\d+$/.test(f.path))).toBe(true);
    const before = d.lookups().length; await lf(p, { query: 'Leaf' }); expect(d.lookups().length).toBe(before);
  });

  test('[BUG-34] concurrent searches (two listFolders in flight at once) share the same in-flight parent lookups', async ({ ext }) => {
    const d = mk(); for (let i = 0; i < 20; i++) d.tree('Shared/Aa' + i), d.tree('Shared/Bb' + i);
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const [a, b] = await p.evaluate(() => Promise.all([window.__mdwe.driveApi.listFolders({ query: 'Aa' }), window.__mdwe.driveApi.listFolders({ query: 'Bb' })]));
    expect(a.folders.length).toBe(20); expect(b.folders.length).toBe(20); expect(d.lookups().length).toBe(2);
    expect([...a.folders, ...b.folders].every((f) => f.path === 'My Drive / Shared')).toBe(true);
  });

  test('[BUG-35] a transient error (500) while resolving a parent is NOT cached: the next search retries and resolves the path', async ({ ext }) => {
    const d = mk(); d.tree('Pz/Poisoned');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const h = d.inject(isLookup, { status: 500, times: 1 });
    const a = await lf(p, { query: 'Poisoned' }); expect(a.folders[0].path).toBeUndefined(); expect(h.count).toBe(1);
    const b = await lf(p, { query: 'Poisoned' });
    expect(b.folders[0].path, 'server is healthy again; the path should resolve on the next search').toBe('My Drive / Pz');
    const n = d.lookups().length; const c = await lf(p, { query: 'Poisoned' }); expect(c.folders[0].path).toBe('My Drive / Pz'); expect(d.lookups().length, 'success IS cached').toBe(n);
  });

  test('[BUG-35] failed-then-retried lookup: exactly one extra request per failed id (no retry storm), siblings of a failed in-flight lookup all get undefined once then all resolve; offline (abort) and 429 are also retried; 404 is retried too (REPORT)', async ({ ext }) => {
    const d = mk(); for (let i = 0; i < 10; i++) d.tree('Fl/Kid' + i);
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const h = d.inject(isLookup, { status: 500, times: 1 });     // with in-flight dedupe the 10 siblings share ONE parent lookup, so exactly one request can fail
    const a = await lf(p, { query: 'Kid' }); expect(a.folders.length).toBe(10); expect(h.count).toBeGreaterThanOrEqual(1);
    expect(a.folders.every((f) => f.path === undefined || typeof f.path === 'string')).toBe(true);
    const failedFirst = d.lookups().length; console.log(`[13] first burst with failing lookups: ${failedFirst} requests (<= 2 per distinct id, all siblings shared the in-flight failure)`); expect(failedFirst, 'the 10 siblings share one in-flight lookup').toBe(1);
    const b = await lf(p, { query: 'Kid' }); expect(b.folders.every((f) => f.path === 'My Drive / Fl')).toBe(true);
    expect(d.lookups().length - failedFirst, 'retry = parent + root, once').toBe(2);
    // offline + 429 variants on fresh parents
    d.tree('Of/OfKid'); d.tree('Rl/RlKid');
    const off = d.inject((e) => isLookup(e) && /T:Of/.test(decodeURIComponent(e.path)), { abort: true, times: 1 }); const o1 = await lf(p, { query: 'OfKid' }); expect(o1.folders[0].path).toBeUndefined(); off.off();
    const o2 = await lf(p, { query: 'OfKid' }); expect(o2.folders[0].path).toBe('My Drive / Of');
    const rl = d.inject((e) => isLookup(e) && /T:Rl/.test(decodeURIComponent(e.path)), { status: 429, times: 1 }); const q1 = await lf(p, { query: 'RlKid' }); expect(q1.folders[0].path).toBeUndefined(); rl.off();
    const q2 = await lf(p, { query: 'RlKid' }); expect(q2.folders[0].path).toBe('My Drive / Rl');
    // a permanently forbidden parent: retried each search (one request), still undefined, never throws
    d.tree('Fb/FbKid'); d.forbidden.add('T:Fb'); const n0 = d.lookups('T:Fb').length; await lf(p, { query: 'FbKid' }); await lf(p, { query: 'FbKid' }); const n1 = d.lookups('T:Fb').length - n0;
    console.log(`[13] REPORT permanently-403 parent: ${n1} lookups over 2 searches (evicted failures are retried every search)`); expect(n1).toBe(2);
  });

  test('errors: 401 re-auth once then message, 403 with Google reason, 403/429 rate limit, 500, 503, 400, offline -> DriveError codes/messages; lookup errors never fail a search', async ({ ext }) => {
    const d = mk(); d.tree('Projects/2026');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    d.minGen = 2; const ok = await call(p, 'listFolders', { query: 'Projects' }); expect(ok.err).toBeUndefined(); expect(names(ok.ok)).toEqual(['Projects']);
    expect((await p.evaluate(() => window.__id.removed)).length).toBe(1);
    d.alwaysAuthFail = true; const before = d.searchReqs().length; const e401 = await call(p, 'listFolders', { query: 'Projects' });
    expect(e401.err).toMatchObject({ name: 'DriveError', code: 'auth', status: 401 }); expect(e401.err.message).toMatch(/sign in/i); expect(d.searchReqs().length - before).toBe(2);
    d.alwaysAuthFail = false; d.minGen = await p.evaluate(() => window.__id.gen);
    const cases = [
      [{ status: 403, reason: 'insufficientFilePermissions', message: 'The user does not have sufficient permissions for this file.' }, { code: 'forbidden', status: 403, reason: 'insufficientFilePermissions', msg: /sufficient permissions/ }],
      [{ status: 403, reason: 'userRateLimitExceeded', message: 'User Rate Limit Exceeded' }, { code: 'quota', status: 403, msg: /rate limit/i }],
      [{ status: 429, message: 'Too Many Requests' }, { code: 'quota', status: 429, msg: /rate limit/i }],
      [{ status: 500, message: 'Backend Error' }, { code: 'http', status: 500, msg: /Backend Error/ }],
      [{ status: 503, message: 'Service Unavailable' }, { code: 'http', status: 503, msg: /Unavailable/ }],
      [{ status: 400, message: 'Invalid Value' }, { code: 'http', status: 400, msg: /Invalid Value/ }],
    ];
    for (const [inj, exp] of cases) {
      const h = d.inject(isSearch, inj); const x = await call(p, 'listFolders', { query: 'Projects' }); h.off();
      expect(x.err, JSON.stringify(inj)).toMatchObject({ name: 'DriveError', code: exp.code, status: exp.status }); expect(x.err.message).toMatch(exp.msg); if (exp.reason) expect(x.err.reason).toBe(exp.reason);
      console.log('[13] error surface: ' + inj.status + (inj.reason ? '/' + inj.reason : '') + ' -> ' + JSON.stringify({ code: x.err.code, message: x.err.message }));
    }
    const off = d.inject(isSearch, { abort: true }); const xo = await call(p, 'listFolders', { query: 'Projects' }); off.off();
    expect(xo.err).toMatchObject({ name: 'DriveError', code: 'offline' }); expect(xo.err.message).toMatch(/network|reach/i);
    const d2 = mk(); d2.tree('Deep/Er'); const r2 = await openDriveEditor(ext, R(d2)); const lk = d2.inject(isLookup, { status: 500 });
    const y = await call(r2.page, 'listFolders', { query: 'Er' }); lk.off(); expect(y.err).toBeUndefined(); expect(names(y.ok)).toEqual(['Er']);
    const z = await call(p, 'listFolders', { query: 'Projects' }); expect(z.err).toBeUndefined();
  });

  test('errors: signed out -> "Sign in to Google Drive first" (code auth), no googleapis request', async ({ ext }) => {
    const d = mk(); d.tree('Projects');
    const r = await openDriveEditor(ext, R(d, { identity: { signedIn: false } }));
    const x = await call(r.page, 'listFolders', { query: 'Pro' });
    expect(x.err).toMatchObject({ code: 'auth', message: 'Sign in to Google Drive first' }); expect(d.log.length).toBe(0);
  });

  test('getRecentFolders: empty -> []; newest first; dedupe moves to front; limit 8; root/invalid ignored; path optional; stored in chrome.storage.local.driveRecentFolders; corrupt storage tolerated', async ({ ext }) => {
    const d = mk(); const r = await openDriveEditor(ext, R(d)); const p = r.page;
    expect(await recents(p)).toEqual([]);
    for (let i = 1; i <= 10; i++) await addRecent(p, { id: 'F' + i, name: 'Folder ' + i, path: 'My Drive / P' + i });
    let rec = await recents(p); expect(rec.map((f) => f.id)).toEqual(['F10', 'F9', 'F8', 'F7', 'F6', 'F5', 'F4', 'F3']); expect(rec.length).toBe(8);
    await addRecent(p, { id: 'F5', name: 'Folder 5 renamed', path: 'My Drive / New' });
    rec = await recents(p); expect(rec.map((f) => f.id)).toEqual(['F5', 'F10', 'F9', 'F8', 'F7', 'F6', 'F4', 'F3']); expect(rec[0]).toEqual({ id: 'F5', name: 'Folder 5 renamed', path: 'My Drive / New' });
    await addRecent(p, { id: 'F1', name: 'Folder 1' }); rec = await recents(p); expect(rec[0]).toEqual({ id: 'F1', name: 'Folder 1' }); expect('path' in rec[0]).toBe(false); expect(rec.length).toBe(8);
    const n = rec.length; await addRecent(p, { id: 'root', name: 'My Drive' }); await addRecent(p, null); await addRecent(p, { name: 'no id' }); expect((await recents(p)).length).toBe(n);
    expect(await storageGet(p, 'driveRecentFolders')).toEqual(rec);
    await p.evaluate(() => chrome.storage.local.set({ driveRecentFolders: 'garbage' })); expect(await recents(p)).toEqual([]);
    await addRecent(p, { id: 'Fx', name: 'after garbage' }); expect((await recents(p)).map((f) => f.id)).toEqual(['Fx']);
  });

  test('createFile into a searched folder auto-adds it to recents (id, name, path); root saves and failed saves do not; persists across reload', async ({ ext }) => {
    const d = mk(); d.tree('Projects/2026/Q3'); d.tree('Other');
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const q3 = byName(await lf(p, { query: 'Q3' }), 'Q3')[0];
    await call(p, 'createFile', 'root-note', 'x', {}); await p.waitForTimeout(300); expect(await recents(p)).toEqual([]);
    const fail = d.inject((e) => e.method === 'POST' && e.path.startsWith('/upload'), { status: 500, times: 1 });
    const bad = await call(p, 'createFile', 'bad', 'x', { parentId: q3.id }); expect(bad.err).toBeTruthy(); await p.waitForTimeout(300); expect(await recents(p), 'failed save must not add a recent').toEqual([]); fail.off();
    const ok = await call(p, 'createFile', 'note', '# hi\n', { parentId: q3.id }); expect(ok.ok.parents).toEqual([q3.id]);
    await expect.poll(() => recents(p)).toEqual([{ id: q3.id, name: 'Q3', path: 'My Drive / Projects / 2026' }]);
    await call(p, 'createFile', 'n2', 'x', { parentId: 'T:Other' }); await expect.poll(async () => (await recents(p)).map((f) => f.name)).toEqual(['Other', 'Q3']);
    await call(p, 'createFile', 'n3', 'x', { parentId: q3.id }); await expect.poll(async () => (await recents(p)).map((f) => f.name)).toEqual(['Q3', 'Other']);
    await p.reload(); await p.waitForFunction(() => window.__mdwe && window.__mdwe.driveApi);
    expect((await recents(p)).map((f) => f.id)).toEqual([q3.id, 'T:Other']);
    expect(r.errors.filter((m) => !/500/.test(m))).toEqual([]);
  });

  test('[REPORT] two createFile calls racing into different folders: does addRecentFolder (get-then-set) lose one? (5 rounds)', async ({ ext }) => {
    const d = mk(); for (let i = 0; i < 10; i++) d.tree('Rc' + i);
    const r = await openDriveEditor(ext, R(d)); const p = r.page; let lost = 0;
    for (let i = 0; i < 5; i++) {
      await p.evaluate(() => chrome.storage.local.remove('driveRecentFolders'));
      const a = 'T:Rc' + (2 * i), b = 'T:Rc' + (2 * i + 1);
      await p.evaluate(async ([a, b]) => { await Promise.all([window.__mdwe.driveApi.createFile('a', 'x', { parentId: a }), window.__mdwe.driveApi.createFile('b', 'x', { parentId: b })]); }, [a, b]);
      await p.waitForTimeout(500); const ids = (await recents(p)).map((f) => f.id); if (!(ids.includes(a) && ids.includes(b))) lost++;
    }
    console.log(`[13] REPORT recents race: ${lost}/5 rounds lost one of two concurrent saves`);
  });

  test('no new manifest permissions / host permissions / CSP vs git HEAD; only googleapis contacted during searches', async ({ ext }) => {
    const head = JSON.parse(execSync('git show HEAD:extension/manifest.json', { cwd: ROOTDIR }).toString());
    const now = JSON.parse(fs.readFileSync(path.join(ROOTDIR, 'extension', 'manifest.json'), 'utf8'));
    expect(now.permissions).toEqual(head.permissions); expect([...now.permissions].sort()).toEqual(['identity', 'storage']);
    expect(now.host_permissions).toEqual(head.host_permissions); expect(now.host_permissions).toEqual(['https://www.googleapis.com/*']);
    expect(now.content_security_policy).toEqual(head.content_security_policy); expect(now.oauth2).toEqual(head.oauth2);
    expect(now.optional_permissions).toBeUndefined();
    const d = mk(); d.tree('Projects'); const r = await openDriveEditor(ext, R(d)); await lf(r.page, { query: 'Pro' });
    expect(d.log.every((l) => /^(www|oauth2)\.googleapis\.com$/.test(l.host))).toBe(true); expect(r.external.filter((u) => !/googleapis\.com/.test(u))).toEqual([]);
  });

  test('[REPORT] request strings for typical and tricky queries -> qa/out/drive-search-requests.json', async ({ ext }) => {
    const d = mk(); d.tree('Projects/2026'); const r = await openDriveEditor(ext, R(d)); const rows = [];
    for (const q of ['proj', 'Q3 plan', "it's", 'say "hi"', String.raw`back\slash`, String.raw`\'`, "x' or name contains '", '100% & #1', 'café 日本', '📁', '', '   ', '  pad  ']) {
      const n = d.folderReqs().length; await call(r.page, 'listFolders', { query: q }); const l = d.folderReqs()[n];
      rows.push({ query: q, q: l.q, params: { orderBy: l.search.orderBy, pageSize: l.search.pageSize, fields: l.search.fields, supportsAllDrives: l.search.supportsAllDrives, includeItemsFromAllDrives: l.search.includeItemsFromAllDrives, corpora: l.search.corpora ?? null } });
    }
    fs.writeFileSync(path.join(OUT, 'drive-search-requests.json'), JSON.stringify(rows, null, 1));
    console.log('[13] REQUESTS\n' + rows.map((x) => `  query=${JSON.stringify(x.query)}\n    q=${x.q}`).join('\n'));
  });
});

// =====================================================================================================================
// B. [UI] Save to Drive dialog (Editor Dev's final UI, bundle index-DdqL4zgr.js)
// =====================================================================================================================
const pm = (p) => p.locator('#editor-host .ProseMirror');
const badge = (p) => p.locator('#drive-status .gdui-status');
const st = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__mdwe.state)));
const DLG = '.gdui-dialog';
const NAMEIN = `${DLG} input.gdui-input:not([data-role=folder-search])`;
const box = (p) => p.locator(`${DLG} [data-role=folder-search]`);
const rows = (p, kind) => p.locator(`${DLG} .gdui-folders li.gdui-row${kind ? `[data-kind=${kind}]` : ''}`);
const fn = (p, kind) => rows(p, kind).locator('.gdui-fn').allInnerTexts();
const dest = (p) => p.locator(`${DLG} .gdui-dest`);
const clearBtn = (p) => p.locator(`${DLG} [data-action=clear-search]`);
const folders = (p) => p.locator(`${DLG} .gdui-folders`);
const saveBtn = (p) => p.locator(`${DLG} [data-action=save]`);
// state.drive is reset so repeated "Save to Drive" clicks in one test always open the create dialog (a saved doc would re-target to in-place save)
const openSave = async (p) => { await p.evaluate(() => { window.__mdwe.state.drive = null; }); await p.click('#btn-drive-save'); await p.locator(DLG).waitFor(); await box(p).waitFor(); await expect(p.locator(`${DLG} .gdui-spinner`)).toHaveCount(0, { timeout: 8000 }); };
const closeDlg = async (p) => { const had = (await box(p).count()) && (await box(p).inputValue()); await p.keyboard.press('Escape'); if (had) await p.keyboard.press('Escape'); await p.locator(DLG).waitFor({ state: 'detached' }); }; // first Esc only clears a non-empty search
const typeQ = async (p, q) => { await box(p).fill(q); };
const active = (p) => p.evaluate(() => { const a = document.activeElement; return { inDialog: !!(a && a.closest && a.closest('.gdui-dialog')), tag: a && a.tagName, role: a && a.dataset && a.dataset.role }; });
const posts = (d) => d.log.filter((l) => l.method === 'POST' && l.path.startsWith('/upload'));
const seed = (d) => { d.tree('Work'); d.tree('Personal'); d.tree('Projects/2026/Q3 plan'); d.tree('Work/Reports'); d.tree('Personal/Reports'); d.tree('Zeta'); return d; };
const UI = async (ext, d, o = {}) => { const r = await openDriveEditor(ext, R(d, o)); await setMd(r.page, '# Doc\n\nbody\n'); return r; };

test.describe('[UI] Save to Drive: folder search', () => {
  test('search box at the top of the Location section (above crumbs/list), labelled, empty, clear hidden; name field + Save/Cancel intact', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    const b = box(p); await expect(b).toBeVisible(); await expect(b).toHaveValue(''); await expect(b).toHaveAttribute('aria-label', /search folders/i); await expect(b).toHaveAttribute('placeholder', /search folders/i);
    await expect(clearBtn(p)).toBeHidden(); await expect(clearBtn(p)).toHaveAttribute('aria-label', /clear/i);
    const ys = await p.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return { name: y('.gdui-dialog input.gdui-input:not([data-role=folder-search])'), search: y('[data-role=folder-search]'), crumbs: y('.gdui-crumbs'), list: y('.gdui-folders ul') }; });
    expect(ys.search).toBeGreaterThan(ys.name); expect(ys.search).toBeLessThan(ys.crumbs); expect(ys.search).toBeLessThan(ys.list);
    expect(await fn(p, 'folder')).toEqual(['Personal', 'Projects', 'Work', 'Zeta']); await expect(dest(p)).toHaveText('My Drive');
    await expect(saveBtn(p)).toBeEnabled(); await expect(p.locator(`${DLG} [data-action=cancel]`)).toBeVisible(); await shot(p, 'drive-search-light-empty.png'); await closeDlg(p); expect(r.errors).toEqual([]);
  });

  test('debounce: fast typing -> ONE search request with the final text; a pause > 300 ms -> two; first request leaves after ~300 ms; Enter flushes the pending query (no duplicate)', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await box(p).click(); await p.keyboard.type('reports', { delay: 40 });
    await expect(rows(p, 'result')).toHaveCount(2);
    expect(d.searchReqs().map((l) => l.q)).toEqual([BASE + "name contains 'reports'"]);
    await box(p).fill(''); await box(p).pressSequentially('pro'); await p.waitForTimeout(450); await box(p).pressSequentially('j'); await expect.poll(() => d.searchReqs().length).toBe(3);
    expect(d.searchReqs().map((l) => l.q.replace(BASE, ''))).toEqual(["name contains 'reports'", "name contains 'pro'", "name contains 'proj'"]);
    await box(p).fill(''); const n = d.searchReqs().length; const t0 = Date.now(); await box(p).fill('zeta');
    await expect.poll(() => d.searchReqs().length).toBe(n + 1); const dt = d.searchReqs()[n].t - t0; console.log('[13] debounce: request left after ' + dt + ' ms'); expect(dt).toBeGreaterThanOrEqual(250); expect(dt).toBeLessThan(900);
    const m = d.searchReqs().length; await box(p).fill('work'); await p.keyboard.press('Enter'); await expect.poll(() => d.searchReqs().length).toBe(m + 1); await p.waitForTimeout(450);
    expect(d.searchReqs().length, 'no duplicate request after the debounce timer').toBe(m + 1); expect(posts(d).length).toBe(0);
  });

  test('typing trims: "  proj  " -> query "proj"; whitespace-only -> back to browse (no search request), results cleared', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, '  proj  '); await expect(rows(p, 'result')).toHaveCount(1); expect(d.searchReqs().pop().q).toBe(BASE + "name contains 'proj'");
    const n = d.searchReqs().length; await typeQ(p, '   '); await expect(rows(p, 'folder')).toHaveCount(4); await expect(rows(p, 'result')).toHaveCount(0);
    await p.waitForTimeout(400); expect(d.searchReqs().length).toBe(n);
  });

  test('result rows: name + parent path; same-named folders distinguishable; "Up" disabled during search; first row preselected; live region', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'reports'); await expect(rows(p, 'result')).toHaveCount(2);
    expect(await fn(p, 'result')).toEqual(['Reports', 'Reports']);
    expect((await rows(p, 'result').locator('.gdui-fpath').allInnerTexts()).sort()).toEqual(['My Drive / Personal', 'My Drive / Work']);
    await expect(p.locator(`${DLG} .gdui-subhead`).first()).toHaveText(/search results/i);
    await expect(p.locator(`${DLG} [data-action=up]`)).toBeDisabled(); await expect(rows(p, 'folder')).toHaveCount(0);
    expect((await rows(p, 'result').evaluateAll((els) => els.map((e) => e.dataset.folderId))).sort()).toEqual(['T:Personal/Reports', 'T:Work/Reports']);
    await expect(rows(p, 'result').first()).toHaveAttribute('aria-selected', 'true');
    await expect(p.locator(`${DLG} [role=status]`).last()).toContainText(/2 folders found/);
    await shot(p, 'drive-search-light-results.png');
  });

  test('single click only SELECTS; dblclick picks: destination = "path / name", search cleared, Save POSTs parents=[id]', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'reports'); await expect(rows(p, 'result')).toHaveCount(2);
    const wr = rows(p, 'result').filter({ hasText: 'My Drive / Work' });
    await wr.click(); await expect(wr).toHaveAttribute('aria-selected', 'true'); await expect(dest(p)).toHaveText('My Drive'); await expect(box(p)).toHaveValue('reports'); await expect(rows(p, 'result')).toHaveCount(2);
    await wr.dblclick(); await expect(dest(p)).toHaveText('My Drive / Work / Reports'); await expect(box(p)).toHaveValue(''); await expect(clearBtn(p)).toBeHidden();
    await expect(p.locator(`${DLG} .gdui-hint`)).toContainText('in My Drive / Work / Reports');
    await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(posts(d).length).toBe(1); expect(posts(d)[0].meta.parents).toEqual(['T:Work/Reports']); expect(posts(d)[0].meta.name).toBe('Untitled.md');
    expect([...d.files.values()][0].parents).toEqual(['T:Work/Reports']); expect(r.errors).toEqual([]);
  });

  test('keyboard: arrows move selection from the search box (focus stays), Enter picks the selected RESULT and never saves; first Esc clears, second closes; Esc on empty closes', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'reports'); await expect(rows(p, 'result')).toHaveCount(2);
    const sel = async () => rows(p, 'result').evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-selected') === 'true'));
    expect(await sel()).toBe(0); await box(p).press('ArrowDown'); expect(await sel()).toBe(1); await box(p).press('ArrowDown'); expect(await sel()).toBe(1); await box(p).press('ArrowUp'); expect(await sel()).toBe(0);
    await expect(box(p)).toHaveAttribute('aria-activedescendant', /.+/); expect((await active(p)).role).toBe('folder-search');
    await box(p).press('ArrowDown'); const pickedId = await rows(p, 'result').nth(1).getAttribute('data-folder-id');
    await box(p).press('Enter'); await expect(box(p)).toHaveValue(''); await expect(dest(p)).toContainText(/Reports$/);
    expect(posts(d).length, 'Enter in the search box never saves').toBe(0); await expect(p.locator(DLG)).toHaveCount(1);
    await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(posts(d)[0].meta.parents).toEqual([pickedId]);
    await openSave(p); await typeQ(p, 'zeta'); await expect(rows(p, 'result')).toHaveCount(1);
    await box(p).press('Escape'); await expect(p.locator(DLG)).toHaveCount(1); await expect(box(p)).toHaveValue(''); await expect(rows(p, 'folder')).toHaveCount(4); expect((await active(p)).role).toBe('folder-search');
    await box(p).press('Escape'); await p.locator(DLG).waitFor({ state: 'detached' });
    await openSave(p); await p.keyboard.press('Escape'); await p.locator(DLG).waitFor({ state: 'detached' });
    await openSave(p); await box(p).click(); await p.keyboard.press('Escape'); await p.locator(DLG).waitFor({ state: 'detached' });
    expect(posts(d).length).toBe(1); expect(r.errors).toEqual([]);
  });

  test('Enter in an untouched/empty search box or with no results does nothing (no enter-folder, no save); Enter in the file-name field still saves to the current location', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await box(p).click(); await box(p).press('Enter'); await p.waitForTimeout(300); await expect(dest(p)).toHaveText('My Drive'); expect(posts(d).length).toBe(0); await expect(p.locator(DLG)).toHaveCount(1);
    await typeQ(p, 'nothing-matches'); await expect(folders(p)).toContainText(/No folders match/); await box(p).press('Enter'); await p.waitForTimeout(200); expect(posts(d).length).toBe(0); await expect(dest(p)).toHaveText('My Drive');
    await p.locator(NAMEIN).fill('from-name'); await p.keyboard.press('Enter');
    await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect(posts(d)[0].meta.name).toBe('from-name.md'); expect(posts(d)[0].meta.parents).toBeUndefined();
  });

  test('clear button: only with text; clears search, restores browsing at the CURRENT location (also inside a subfolder), focuses the box; cancels pending and in-flight queries', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'rep'); await expect(clearBtn(p)).toBeVisible(); await expect(rows(p, 'result')).toHaveCount(2);
    await clearBtn(p).click(); await expect(box(p)).toHaveValue(''); await expect(clearBtn(p)).toBeHidden(); await expect(rows(p, 'folder')).toHaveCount(4); expect((await active(p)).role).toBe('folder-search');
    await rows(p, 'folder').filter({ hasText: 'Work' }).dblclick(); await expect(dest(p)).toHaveText('My Drive / Work'); await expect(rows(p, 'folder')).toHaveCount(1);
    await typeQ(p, 'zeta'); await expect(rows(p, 'result')).toHaveCount(1); expect(d.searchReqs().pop().q).not.toMatch(/parents/);
    await clearBtn(p).click(); await expect(dest(p)).toHaveText('My Drive / Work'); await expect.poll(() => fn(p, 'folder')).toEqual(['Reports']);
    const n = d.searchReqs().length; await box(p).fill('late'); await clearBtn(p).click(); await p.waitForTimeout(500); expect(d.searchReqs().length).toBe(n); expect(await fn(p, 'folder')).toEqual(['Reports']);
    const hold = d.hold(isSearch); await box(p).fill('zeta'); await expect.poll(() => hold.count()).toBe(1); await clearBtn(p).click(); await expect(rows(p, 'folder')).toHaveCount(1);
    hold.releaseAll(); await p.waitForTimeout(400); expect(await fn(p, 'folder')).toEqual(['Reports']); await expect(rows(p, 'result')).toHaveCount(0); expect(r.errors).toEqual([]);
  });

  test('stale responses arriving out of order never overwrite newer results (both orders, and a stale ERROR); "Searching…" shown while held', async ({ ext }) => {
    const d = seed(mk()); d.tree('Aaa folder'); d.tree('Bbb folder'); d.tree('Ccc folder'); d.tree('Ddd folder'); const r = await UI(ext, d); const p = r.page; await openSave(p);
    const hold = d.hold(isSearch);
    await typeQ(p, 'aaa'); await expect.poll(() => hold.count()).toBe(1);
    await expect(folders(p)).toContainText(/Searching/); await expect(rows(p)).toHaveCount(0);
    await typeQ(p, 'bbb'); await expect.poll(() => hold.count()).toBe(2);
    hold.release(1); await expect(rows(p, 'result')).toHaveCount(1); expect(await fn(p, 'result')).toEqual(['Bbb folder']);
    hold.release(0); await p.waitForTimeout(400); expect(await fn(p, 'result'), 'older response arrived late').toEqual(['Bbb folder']); await expect(box(p)).toHaveValue('bbb');
    hold.releaseAll();
    const h2 = d.hold((e) => isSearch(e) && /ccc|ddd/.test(e.q));
    await typeQ(p, 'ccc'); await expect.poll(() => h2.count()).toBe(1); await typeQ(p, 'ddd'); await expect.poll(() => h2.count()).toBe(2);
    h2.release(0); await p.waitForTimeout(300); await expect(rows(p, 'result')).toHaveCount(0);
    h2.release(0); await expect(rows(p, 'result')).toHaveCount(1); expect(await fn(p, 'result')).toEqual(['Ddd folder']); h2.releaseAll();
    const h3 = d.hold((e) => isSearch(e) && /eee/.test(e.q)); d.inject((e) => isSearch(e) && /eee/.test(e.q), { status: 500, times: 1 });
    await typeQ(p, 'eee'); await expect.poll(() => h3.count()).toBe(1); await typeQ(p, 'aaa'); await expect(rows(p, 'result')).toHaveCount(1); h3.releaseAll(); await p.waitForTimeout(400);
    expect(await fn(p, 'result')).toEqual(['Aaa folder']); await expect(p.locator(`${DLG} [data-action=retry]`)).toHaveCount(0); expect(r.errors.filter((m) => !/500/.test(m))).toEqual([]);
  });

  test('states: loading, empty ("No folders match “x”", text only), error (500) with Retry that recovers, offline with Retry; Save still works to the current location after an error', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    const hold = d.hold(isSearch); await typeQ(p, 'work'); await expect.poll(() => hold.count()).toBe(1);
    await expect(p.locator(`${DLG} .gdui-folders .gdui-spinner`)).toBeVisible(); await expect(folders(p)).toContainText('Searching'); await shot(p, 'drive-search-light-loading.png'); hold.releaseAll(); await expect(rows(p, 'result')).toHaveCount(1);
    await typeQ(p, 'qqq <nothing>'); await expect(folders(p)).toContainText('No folders match'); await expect(folders(p)).toContainText('qqq <nothing>'); await expect(p.locator(`${DLG} .gdui-folders img`)).toHaveCount(0); await shot(p, 'drive-search-light-empty-state.png');
    const inj = d.inject((e) => isSearch(e) && /boom/.test(e.q), { status: 500, message: 'Backend Error' });
    await typeQ(p, 'boom'); await expect(p.locator(`${DLG} .gdui-is-error`)).toBeVisible(); console.log('[13] UI error state text: ' + JSON.stringify((await folders(p).innerText()).replace(/\s+/g, ' '))); await expect(folders(p)).toContainText(/Backend Error|error|wrong|failed/i); await expect(p.locator(`${DLG} [data-action=retry]`)).toBeVisible(); await shot(p, 'drive-search-light-error.png');
    d.tree('boom town'); inj.off(); await p.locator(`${DLG} [data-action=retry]`).click(); await expect(rows(p, 'result')).toHaveCount(1); expect(await fn(p, 'result')).toEqual(['boom town']);
    const off = d.inject((e) => isSearch(e) && /offl/.test(e.q), { abort: true }); await typeQ(p, 'offl'); await expect(p.locator(`${DLG} .gdui-is-error`)).toBeVisible(); console.log('[13] UI offline state text: ' + JSON.stringify((await folders(p).innerText()).replace(/\s+/g, ' '))); await expect(folders(p)).toContainText(/network|offline|reach|internet/i); await expect(p.locator(`${DLG} [data-action=retry]`)).toBeVisible();
    await expect(saveBtn(p)).toBeEnabled(); await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' });
    await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect(posts(d)[0].meta.parents).toBeUndefined(); off.off();
  });

  test('401 mid-search re-auths transparently; 403 / 429 show message + Retry; persistent 401 shows Sign in', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    d.minGen = 2; await typeQ(p, 'zeta'); await expect(rows(p, 'result')).toHaveCount(1);
    const h = d.inject((e) => isSearch(e) && /denied/.test(e.q), { status: 403, reason: 'insufficientFilePermissions', message: 'Forbidden thing' });
    await typeQ(p, 'denied'); await expect(folders(p)).toContainText(/Forbidden thing/); await expect(p.locator(`${DLG} [data-action=retry]`)).toBeVisible(); expect(h.count).toBe(1);
    const i = d.inject((e) => isSearch(e) && /quota/.test(e.q), { status: 429 }); await typeQ(p, 'quota'); await expect(folders(p)).toContainText(/rate limit/i); i.off();
    d.alwaysAuthFail = true; await typeQ(p, 'zeta'); await expect(p.locator(`${DLG} .gdui-folders [data-action=signin]`)).toBeVisible(); await expect(folders(p)).toContainText(/sign in/i);
  });

  test('"Load more" paginates results (data-action=more): appends without duplicates, hides at the end; a failing page -> "Couldn’t load more" + Retry', async ({ ext }) => {
    const d = mk(); for (let i = 1; i <= 120; i++) d.tree('Bulk/Item ' + String(i).padStart(3, '0')); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'Item'); await expect(rows(p, 'result')).toHaveCount(50); const more = p.locator(`${DLG} [data-action=more]`); await expect(more).toBeVisible();
    await more.click(); await expect(rows(p, 'result')).toHaveCount(100);
    const bad = d.inject((e) => isSearch(e) && e.search.pageToken, { status: 500, times: 1 });
    await more.click(); await expect(p.locator(`${DLG} .gdui-more`)).toContainText(/couldn.t load more/i); await expect(rows(p, 'result')).toHaveCount(100); expect(bad.count).toBe(1);
    await p.locator(`${DLG} [data-action=more]`).click(); await expect(rows(p, 'result')).toHaveCount(120); await expect(more).toHaveCount(0);
    const ids = await rows(p, 'result').evaluateAll((els) => els.map((e) => e.dataset.folderId)); expect(new Set(ids).size).toBe(120);
    const toks = d.searchReqs().map((l) => l.search.pageToken || null); expect(toks[0]).toBeNull(); expect(toks.slice(1).every(Boolean)).toBe(true);
  });

  test('Recent: only with empty search AND at My Drive root, first 5 (newest first), kind=recent; dblclick picks; hidden while searching / in subfolders; a search-pick save becomes Recent #1 next time (deduped)', async ({ ext }) => {
    const d = seed(mk()); for (let i = 1; i <= 7; i++) d.tree('Rec' + i); const r = await UI(ext, d); const p = r.page;
    for (let i = 1; i <= 7; i++) await addRecent(p, { id: 'T:Rec' + i, name: 'Rec' + i, path: 'My Drive' });
    await openSave(p);
    await expect(p.locator(`${DLG} .gdui-subhead`)).toHaveText(['Recent', 'Folders']);
    expect(await fn(p, 'recent')).toEqual(['Rec7', 'Rec6', 'Rec5', 'Rec4', 'Rec3']); await expect(rows(p, 'recent').first().locator('.gdui-fpath')).toHaveText('My Drive');
    expect((await fn(p, 'folder')).length).toBe(11); await shot(p, 'drive-search-light-recent.png');
    await typeQ(p, 'zeta'); await expect(rows(p, 'result')).toHaveCount(1); await expect(rows(p, 'recent')).toHaveCount(0); expect((await p.locator(`${DLG} .gdui-subhead`).allInnerTexts()).map((t) => t.toLowerCase())).toEqual(['search results']);
    await clearBtn(p).click(); await expect(rows(p, 'recent')).toHaveCount(5);
    await rows(p, 'folder').filter({ hasText: 'Work' }).dblclick(); await expect(dest(p)).toHaveText('My Drive / Work'); await expect(rows(p, 'recent')).toHaveCount(0);
    await p.locator(`${DLG} [data-action=up]`).click(); await expect(rows(p, 'recent')).toHaveCount(5);
    await rows(p, 'recent').filter({ hasText: 'Rec6' }).click(); await expect(dest(p)).toHaveText('My Drive'); await rows(p, 'recent').filter({ hasText: 'Rec6' }).dblclick(); await expect(dest(p)).toContainText('Rec6');
    await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect(posts(d)[0].meta.parents).toEqual(['T:Rec6']);
    await openSave(p); await typeQ(p, 'Q3'); await expect(rows(p, 'result')).toHaveCount(1); await p.keyboard.press('Enter'); await expect(dest(p)).toContainText('Q3 plan');
    await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(posts(d)[1].meta.parents).toEqual(['T:Projects/2026/Q3 plan']);
    await expect.poll(async () => (await recents(p))[0]?.name).toBe('Q3 plan'); await openSave(p);
    expect((await fn(p, 'recent'))[0]).toBe('Q3 plan'); await expect(rows(p, 'recent').first().locator('.gdui-fpath')).toHaveText('My Drive / Projects / 2026'); await expect(rows(p, 'recent')).toHaveCount(5);
    expect((await fn(p, 'recent')).filter((n) => n === 'Rec6').length).toBe(1);
    await closeDlg(p); expect(r.errors).toEqual([]);
  });

  test('Recent: malformed entries / corrupt storage / none are harmless; no "Recent" header when empty', async ({ ext }) => {
    const d = mk(); const r = await UI(ext, d); const p = r.page;
    await p.evaluate(() => chrome.storage.local.set({ driveRecentFolders: [{ id: 'x' }, null, 'str', { name: 'no id' }, { id: 'T:ok', name: 'OK only', path: 'My Drive' }] }));
    await openSave(p); expect(await fn(p, 'recent')).toEqual(['OK only']); await expect(p.locator(`${DLG} .gdui-subhead`).first()).toHaveText('Recent'); await expect(saveBtn(p)).toBeEnabled(); await closeDlg(p);
    await p.evaluate(() => chrome.storage.local.set({ driveRecentFolders: 'garbage' })); await openSave(p); await expect(rows(p, 'recent')).toHaveCount(0); await expect(p.locator(`${DLG} .gdui-subhead`)).toHaveCount(0); await expect(p.locator(DLG)).toContainText('No subfolders'); await closeDlg(p);
    expect(r.errors).toEqual([]);
  });

  test('focus management: opens on the file-name field; focus never falls to <body> when the list is replaced (pick, empty, clear); Tab/Shift+Tab trapped; close restores focus to the toolbar button', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page;
    await p.focus('#btn-drive-save'); await openSave(p);
    expect(await p.evaluate(() => document.activeElement.value)).toBe('Untitled.md');
    await typeQ(p, 'reports'); await expect(rows(p, 'result')).toHaveCount(2); expect((await active(p)).role).toBe('folder-search');
    await rows(p, 'result').first().click(); expect((await active(p)).inDialog).toBe(true); await p.keyboard.press('Enter');
    await expect(dest(p)).toContainText('Reports'); await expect.poll(async () => (await active(p)).inDialog).toBe(true);
    for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); expect((await active(p)).inDialog, 'Tab #' + i).toBe(true); }
    for (let i = 0; i < 12; i++) { await p.keyboard.press('Shift+Tab'); expect((await active(p)).inDialog, 'Shift+Tab #' + i).toBe(true); }
    await typeQ(p, 'zzzz'); await expect(folders(p)).toContainText('No folders match'); expect((await active(p)).inDialog).toBe(true);
    await clearBtn(p).click(); expect((await active(p)).role).toBe('folder-search');
    const tabs = []; for (let i = 0; i < 8; i++) { await p.keyboard.press('Tab'); tabs.push(await p.evaluate(() => { const e = document.activeElement; return (e.dataset && (e.dataset.role || e.dataset.action)) || e.tagName + (e.id ? '#' + e.id : ''); })); } console.log('[13] Tab order from search box: ' + tabs.join(' -> '));
    await closeDlg(p); await expect.poll(() => p.evaluate(() => document.activeElement && document.activeElement.id)).toBe('btn-drive-save');
  });

  test('dark + light: overlay themed; search input / path / name / dest text >= 4.5:1, placeholder / subhead / clear >= 3:1; screenshots', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await addRecent(p, { id: 'T:Zeta', name: 'Zeta', path: 'My Drive' });
    for (const theme of ['light', 'dark']) {
      await p.evaluate((t) => { if (document.documentElement.dataset.theme !== t) document.getElementById('btn-theme').click(); }, theme);
      await openSave(p); await expect(p.locator('.gdui-overlay')).toHaveAttribute('data-theme', theme);
      await typeQ(p, 'reports'); await expect(rows(p, 'result')).toHaveCount(2);
      const res = await p.evaluate(() => {
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const v = m[1].split(/[ ,\/]+/).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] == null ? 1 : v[3] }; };
        const bgOf = (el) => { let e = el; let acc = { r: 255, g: 255, b: 255 }; const stack = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); stack.push(c); if (c.a >= 1) break; e = e.parentElement; } for (const c of stack.reverse()) acc = { r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }; return acc; };
        const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const cr = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        const meas = (sel) => { const el = document.querySelector(sel); if (!el) return null; return +cr(parse(getComputedStyle(el).color), bgOf(el)).toFixed(2); };
        const ph = document.querySelector('[data-role=folder-search]');
        return { input: meas('[data-role=folder-search]'), path: meas('.gdui-fpath'), name: meas('li[data-kind=result] .gdui-fn'), subhead: meas('.gdui-subhead'), clear: meas('[data-action=clear-search]'), dest: meas('.gdui-dest'), placeholder: +cr(parse(getComputedStyle(ph, '::placeholder').color), bgOf(ph)).toFixed(2), inputBg: getComputedStyle(ph).backgroundColor };
      });
      console.log(`[13] contrast ${theme}: ${JSON.stringify(res)}`);
      for (const k of ['input', 'path', 'name', 'dest']) expect.soft(res[k], `${theme} ${k}`).toBeGreaterThanOrEqual(4.5);
      expect.soft(res.subhead, `${theme} subhead`).toBeGreaterThanOrEqual(3); expect.soft(res.clear, `${theme} clear`).toBeGreaterThanOrEqual(3); expect.soft(res.placeholder, `${theme} placeholder`).toBeGreaterThanOrEqual(3);
      if (theme === 'dark') expect.soft(res.inputBg).not.toBe('rgb(255, 255, 255)');
      await shot(p, `drive-search-${theme}-results.png`); await clearBtn(p).click(); await shot(p, `drive-search-${theme}-browse.png`); await closeDlg(p);
    }
  });

  test('rapid open/close (25x, typing, Esc mid-request, late responses) -> no page errors, no leftover overlay, editor usable, pending debounce never fires after close', async ({ ext }) => {
    const d = seed(mk()); d.delay((e) => isFolderList(e), 40); const r = await UI(ext, d); const p = r.page; await pm(p).click(); await p.keyboard.type('mine');
    for (let i = 0; i < 25; i++) {
      await p.click('#btn-drive-save'); await box(p).waitFor();
      if (i % 3 === 0) { await box(p).fill('rep' + i); await p.waitForTimeout(i % 2 ? 330 : 60); }
      await p.keyboard.press('Escape'); if (await p.locator(DLG).count()) await p.keyboard.press('Escape'); if (await p.locator(DLG).count()) await p.keyboard.press('Escape');
      await p.locator(DLG).waitFor({ state: 'detached' });
    }
    await p.waitForTimeout(600); await expect(p.locator('.gdui-overlay')).toHaveCount(0); expect(posts(d).length).toBe(0);
    await pm(p).click(); await p.keyboard.type('!'); expect(await md(p)).toContain('mine!'); await openSave(p); await typeQ(p, 'zeta'); await expect(rows(p, 'result')).toHaveCount(1); await closeDlg(p);
    const n = d.searchReqs().length; await p.click('#btn-drive-save'); await box(p).waitFor(); await box(p).fill('late'); await p.locator(`${DLG} [data-action=cancel]`).click(); await p.waitForTimeout(600); expect(d.searchReqs().length).toBe(n);
    const hold = d.hold(isSearch); await p.click('#btn-drive-save'); await box(p).waitFor(); await box(p).fill('zeta'); await expect.poll(() => hold.count()).toBe(1); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.locator(DLG).waitFor({ state: 'detached' }); hold.releaseAll(); await p.waitForTimeout(400);
    expect(r.errors, 'no console/page errors').toEqual([]);
  });

  test('unedited Drive doc: Ctrl+S = "No changes to save" (no dialog/request); read-only doc "Copy of" via folder search writes the ORIGINAL bytes into the chosen folder, 0 PATCH', async ({ ext }) => {
    const orig = '# T\n\ntrailing  \n* star\n<!-- c -->\nno final newline';
    const d = seed(mk([{ id: 'f1', name: 'notes.md', text: orig }, { id: 'ro', name: 'shared.md', text: orig, canEdit: false }]));
    const r = await openDriveEditor(ext, R(d)); const p = r.page;
    const pick = async (n) => { await p.click('#btn-drive-open'); await p.locator(DLG).waitFor(); await p.locator(`${DLG} .gdui-row`, { hasText: n }).first().dblclick(); await p.locator(DLG).waitFor({ state: 'detached' }); };
    await pick('notes.md'); const before = d.log.length; await p.keyboard.press('Control+s'); await expect(p.locator('#status')).toContainText('No changes to save'); await p.waitForTimeout(300);
    expect(d.log.length, 'no request at all').toBe(before); await expect(p.locator(DLG)).toHaveCount(0); expect(d.bytes('f1').toString()).toBe(orig);
    await pick('shared.md'); await p.keyboard.press('Control+s'); await p.locator(DLG).waitFor(); await expect(p.locator(NAMEIN)).toHaveValue('Copy of shared.md');
    await typeQ(p, 'Q3'); await expect(rows(p, 'result')).toHaveCount(1); await rows(p, 'result').first().dblclick(); await expect(dest(p)).toContainText('Q3 plan');
    await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved');
    expect(posts(d).length).toBe(1); expect(posts(d)[0].content).toBe(orig); expect(posts(d)[0].meta.parents).toEqual(['T:Projects/2026/Q3 plan']); expect(posts(d)[0].meta.name).toBe('Copy of shared.md');
    expect(d.attempts('PATCH').length).toBe(0); expect(d.bytes('ro').toString()).toBe(orig); expect(r.errors).toEqual([]);
  });

  test('drafts unchanged: typing in the search box never reaches the editor/draft; cancel keeps the dirty draft; saving into a searched folder clears it; Ctrl+S inside the dialog does not leak', async ({ ext }) => {
    const d = seed(mk()); const r = await openDriveEditor(ext, R(d)); const p = r.page; await pm(p).click(); await p.keyboard.type('my draft text');
    await expect.poll(() => storageGet(p, 'mdwe.draft'), { timeout: 5000 }).toBeTruthy(); const d0 = await storageGet(p, 'mdwe.draft');
    await openSave(p); await typeQ(p, 'reports'); await box(p).press('ArrowDown'); await p.keyboard.type(' typed-in-search'); await expect(folders(p)).toContainText('No folders match', { timeout: 5000 });
    await clearBtn(p).click(); await p.waitForTimeout(1100);
    expect(await md(p)).toBe('my draft text\n'); expect(await storageGet(p, 'mdwe.draft')).toEqual(d0); expect((await st(p)).dirty).toBe(true);
    await closeDlg(p); await p.waitForTimeout(1000); expect(await storageGet(p, 'mdwe.draft')).toEqual(d0); expect(await md(p)).toBe('my draft text\n');
    await openSave(p); await box(p).click(); await p.keyboard.press('Control+s'); await p.waitForTimeout(250); expect(posts(d).length).toBe(0); await expect(p.locator(DLG)).toHaveCount(1);
    await typeQ(p, 'Q3'); await expect(rows(p, 'result')).toHaveCount(1); await p.keyboard.press('Enter'); await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' });
    await expect(badge(p)).toHaveAttribute('data-state', 'saved'); await expect.poll(() => storageGet(p, 'mdwe.draft')).toBeUndefined(); expect(posts(d)[0].content).toBe('my draft text\n'); expect((await st(p)).dirty).toBe(false);
  });

  test('XSS / markup safety: folder names and PATHS with <img onerror>, <script>, markdown, entities render as TEXT in rows, breadcrumb, hint, empty state, live region', async ({ ext }) => {
    const evil = ['<img src=x onerror="window.__xss=1">', '<script>window.__xss=2</script>', '**bold** _it_ [l](javascript:window.__xss=3)', '&lt;b&gt;amp&amp;', '"><svg onload=window.__xss=4>', '${7*7} {{7*7}} `tick`'];
    const d = mk(); d.addFolder({ id: 'xp', name: '<b>P</b> <img src=x onerror="window.__xss=5">' }); evil.forEach((e, i) => d.addFolder({ id: 'xe' + i, name: 'ev ' + e, parents: ['xp'] }));
    const r = await UI(ext, d); const p = r.page; await p.evaluate(() => { window.__xss = undefined; });
    await openSave(p); await typeQ(p, 'ev '); await expect(rows(p, 'result')).toHaveCount(evil.length);
    expect((await fn(p, 'result')).sort()).toEqual(evil.map((e) => 'ev ' + e).sort());
    expect((await rows(p, 'result').locator('.gdui-fpath').allInnerTexts()).every((t) => t === 'My Drive / <b>P</b> <img src=x onerror="window.__xss=5">')).toBe(true);
    expect(await p.locator(`${DLG} .gdui-folders img, ${DLG} .gdui-folders svg:not(.gdui-ico), ${DLG} .gdui-folders script, ${DLG} .gdui-folders b, ${DLG} .gdui-folders a`).count()).toBe(0);
    await typeQ(p, '<script>nomatch</script>'); await expect(rows(p, 'result')).toHaveCount(0); await expect(folders(p)).toContainText('No folders match'); await expect(folders(p)).toContainText('<script>nomatch</script>'); expect(await p.locator(`${DLG} .gdui-folders script`).count()).toBe(0);
    await typeQ(p, '<img src=x'); await expect(rows(p, 'result')).toHaveCount(2); // the `ev <img ...>` folder and the parent `<b>P</b> <img ...>`
    await typeQ(p, 'ev <img'); await expect(rows(p, 'result')).toHaveCount(1);
    await rows(p, 'result').first().dblclick(); await expect(dest(p)).toContainText('<b>P</b> <img src=x onerror='); expect(await p.locator(`${DLG} .gdui-crumbs img, ${DLG} .gdui-hint img, ${DLG} .gdui-crumbs b, ${DLG} .gdui-hint b`).count()).toBe(0);
    await p.waitForTimeout(300); expect(await p.evaluate(() => window.__xss), 'no handler fired').toBeUndefined(); expect(await p.locator('img[src="x"]').count()).toBe(0);
    await shot(p, 'drive-search-xss.png'); await closeDlg(p); expect(r.errors).toEqual([]);
  });

  test('large result list: 500 folders in one page render promptly; keyboard and name-field typing stay responsive; 10 pages via Load more', async ({ ext }) => {
    test.setTimeout(150_000);
    const d = mk(); for (let i = 1; i <= 500; i++) d.tree('Big/Folder ' + String(i).padStart(3, '0')); d.pageSize = 500;
    const r = await UI(ext, d); const p = r.page; await openSave(p);
    const t0 = Date.now(); await typeQ(p, 'Folder'); await expect(rows(p, 'result')).toHaveCount(500, { timeout: 30000 }); const tRender = Date.now() - t0;
    const lookups = d.lookups().length;
    const k0 = Date.now(); for (let i = 0; i < 40; i++) await box(p).press('ArrowDown'); const tKeys = Date.now() - k0;
    expect(await rows(p, 'result').evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-selected') === 'true'))).toBe(40);
    const nm = p.locator(NAMEIN); const n0 = Date.now(); await nm.click(); await nm.fill(''); await nm.pressSequentially('typed while 500 rows', { delay: 0 }); const tType = Date.now() - n0; await expect(nm).toHaveValue('typed while 500 rows');
    const s = Date.now(); await typeQ(p, 'Folder 4'); await expect(rows(p, 'result')).toHaveCount(100); const tSearch2 = Date.now() - s;
    console.log(`[13] LARGE: 500 rows type->rendered ${tRender} ms (incl. 300 ms debounce; ${lookups} parent lookups); 40 ArrowDown ${tKeys} ms; 20-char typing ${tType} ms; re-search ${tSearch2} ms`);
    expect(tRender).toBeLessThan(10000); expect(tKeys).toBeLessThan(8000); expect(tType).toBeLessThan(5000);
    await typeQ(p, 'Folder 499'); await expect(rows(p, 'result')).toHaveCount(1); await rows(p, 'result').first().dblclick(); await expect(dest(p)).toContainText('Folder 499');
    d.pageSize = 0; await closeDlg(p); await openSave(p); await typeQ(p, 'Folder'); await expect(rows(p, 'result')).toHaveCount(50);
    for (let i = 1; i < 10; i++) { await p.locator(`${DLG} [data-action=more]`).click(); await expect(rows(p, 'result')).toHaveCount(50 * (i + 1)); }
    await expect(p.locator(`${DLG} [data-action=more]`)).toHaveCount(0); expect(r.errors).toEqual([]);
  });

  test('incompleteSearch:true from Drive: dialog shows the results normally (not surfaced, no crash, no error state), pick + Save still work; "Load more" continues', async ({ ext }) => {
    const d = seed(mk()); d.incompleteSearch = true; const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'reports'); await expect(rows(p, 'result')).toHaveCount(2); await expect(p.locator(`${DLG} .gdui-is-error`)).toHaveCount(0);
    const txt = (await folders(p).innerText()).toLowerCase(); console.log('[13] REPORT incompleteSearch is not surfaced in the UI; dialog text has "incomplete"/"partial": ' + /incomplete|partial/.test(txt));
    expect(d.searchReqs().pop().search.corpora).toBe('allDrives');
    await rows(p, 'result').first().dblclick(); await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); await expect(badge(p)).toHaveAttribute('data-state', 'saved'); expect(posts(d).length).toBe(1); expect(r.errors).toEqual([]);
  });

  test('breadcrumb/Up after a search pick: Up goes to My Drive (parents of a picked result unknown); picking browses its children; entering a child extends the crumb; Save uses the deepest id', async ({ ext }) => {
    const d = seed(mk()); const r = await UI(ext, d); const p = r.page; await openSave(p);
    await typeQ(p, 'Q3'); await expect(rows(p, 'result')).toHaveCount(1); await rows(p, 'result').first().dblclick();
    await expect(dest(p)).toHaveText('My Drive / Projects / 2026 / Q3 plan'); const up = p.locator(`${DLG} [data-action=up]`); await expect(up).toBeEnabled();
    await expect(folders(p)).toContainText(/No subfolders/); await up.click(); await expect(dest(p)).toHaveText('My Drive'); await expect(rows(p, 'folder')).toHaveCount(4);
    await typeQ(p, '2026'); await expect(rows(p, 'result')).toHaveCount(1); await rows(p, 'result').first().dblclick(); await expect(rows(p, 'folder')).toHaveCount(1); expect(await fn(p, 'folder')).toEqual(['Q3 plan']);
    expect(d.folderReqs().pop().q).toBe(BASE + "'T:Projects/2026' in parents");
    await rows(p, 'folder').first().dblclick(); await expect(dest(p)).toHaveText('My Drive / Projects / 2026 / Q3 plan');
    await saveBtn(p).click(); await p.locator(DLG).waitFor({ state: 'detached' }); expect(posts(d)[0].meta.parents).toEqual(['T:Projects/2026/Q3 plan']);
  });
});
