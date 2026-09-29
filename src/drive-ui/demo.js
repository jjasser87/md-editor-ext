// Standalone demo with a fake in-memory api that mimics src/drive/api.js (DriveError codes).
// ?mode=normal|slow|error|401|403|auth|notconfigured|offline|empty|many|nofolders|signedout   &theme=dark|light
import { openDriveDialog, saveToDriveDialog, confirmConflict, createDriveStatus } from './index.js';

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') || 'normal';
const theme = qs.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delay = () => sleep(mode === 'slow' ? 1500 : 60);

class DriveError extends Error { constructor(code, message, extra = {}) { super(message); this.name = 'DriveError'; this.code = code; Object.assign(this, extra); } }
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const NAMES = ['README.md', 'meeting-notes.md', 'todo.md', 'blog-draft.markdown', 'Project plan — Q4.md', 'a-very-long-file-name-that-should-be-truncated-with-an-ellipsis-because-it-does-not-fit.md', 'journal.md', 'recipes.md', 'cheatsheet.md', 'ideas.md'];
let files = mode === 'empty' ? [] : NAMES.map((name, i) => ({ id: 'f' + i, name, modifiedTime: ago([2, 35, 300, 2000, 9000, 20000, 60000, 400000, 900000, 5000][i]), size: [120, 2048, 15000, 640000, 30, 7777, 1200, 4000000, 99, 1024][i], canEdit: i !== 3 }));
if (mode === 'many') files = Array.from({ length: 130 }, (_, i) => ({ id: 'm' + i, name: `note-${String(i + 1).padStart(3, '0')}.md`, modifiedTime: ago(i * 90), size: 100 * (i + 1), canEdit: true }));
let signedIn = mode !== 'signedout' && mode !== '401' && mode !== 'auth';
let failedOnce = false;
const PAGE = 50;

export const api = {
  async isSignedIn() { await sleep(20); return signedIn; },
  async signIn() { await sleep(300); if (mode === 'notconfigured') throw new DriveError('not-configured', 'no client id'); signedIn = true; return true; },
  async signOut() { await sleep(100); signedIn = false; },
  async getAccountLabel() { return 'jasser@example.com'; },
  async listFiles({ query = '', pageToken } = {}) {
    (window.__calls ||= []).push({ fn: 'listFiles', query, pageToken });
    await delay();
    if (mode === 'notconfigured') throw new DriveError('not-configured', 'chrome.identity: bad client id');
    if (mode === 'offline') throw new DriveError('offline', 'Network error');
    if (mode === '401' || mode === 'auth') { if (!signedIn) throw new DriveError('auth', 'Sign in first'); }
    if (mode === '403') throw new DriveError('forbidden', 'Insufficient permissions', { status: 403 });
    if (mode === 'error' && !(failedOnce)) { failedOnce = true; throw new DriveError('http', 'HTTP 500: backend exploded', { status: 500 }); }
    if (mode === 'moreerror' && pageToken && !failedOnce) { failedOnce = true; throw new DriveError('http', 'HTTP 500'); }
    const q = query.toLowerCase();
    const all = files.filter((f) => f.name.toLowerCase().includes(q));
    const start = pageToken ? Number(pageToken) : 0;
    const slice = all.slice(start, start + PAGE);
    return { files: slice, nextPageToken: start + PAGE < all.length ? String(start + PAGE) : null };
  },
  async listFolders({ parentId = 'root' } = {}) {
    await delay();
    if (mode === 'nofolders') return { folders: [], nextPageToken: null };
    if (parentId === 'root') return { folders: [{ id: 'd1', name: 'Documents' }, { id: 'd2', name: 'Notes' }, { id: 'd3', name: 'Work / Reports' }], nextPageToken: null };
    return { folders: [{ id: parentId + '-a', name: 'Archive' }, { id: parentId + '-b', name: '2026' }], nextPageToken: null };
  },
};
window.__api = api;

const result = (v) => { $('result').textContent = JSON.stringify(v); window.__result = v; };
$('btn-open').onclick = async () => result(await openDriveDialog({ api, theme: document.documentElement.dataset.theme }));
$('btn-save').onclick = async () => result(await saveToDriveDialog({ api, defaultName: 'Untitled', theme: document.documentElement.dataset.theme }));
$('btn-conflict').onclick = async () => result(await confirmConflict({ name: 'Project plan — Q4.md', remoteModifiedTime: ago(4), localModifiedTime: ago(65), theme: document.documentElement.dataset.theme }));
$('btn-theme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; };

const status = createDriveStatus($('drive-status-host'));
window.__status = status;
const cycle = [['idle'], ['saving'], ['saved'], ['error', 'HTTP 500'], ['offline'], ['conflict'], ['signed-out'], ['signed-out', { code: 'not-configured', message: 'not set up (see README)' }], ['error', { message: 'read-only file', action: { label: 'Retry', onClick: () => result('retry clicked') } }]];
let ci = 2; status.set('saved');
$('btn-states').onclick = () => { const [s, d] = cycle[ci++ % cycle.length]; status.set(s, d); };
