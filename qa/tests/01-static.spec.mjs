// 1. Static: manifest, permissions, CSP, remote URLs, eval/new Function, inline script/handlers.
import { test, expect } from '@playwright/test';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { EXT } from '../lib/fixture.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const all = walk(EXT);
const htmlFiles = all.filter((f) => f.endsWith('.html'));
const jsFiles = all.filter((f) => /\.(m?js)$/.test(f));
const report = { findings: [] };
const ctxLine = (src, idx) => { const ln = src.slice(0, idx).split('\n').length; return { ln, text: src.split('\n')[ln - 1].trim().slice(0, 160) }; };

test('manifest valid + permissions exactly ["storage","identity"] (Drive), nothing else', () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name && manifest.version).toBeTruthy();
  expect(manifest.permissions).toEqual(['storage', 'identity']);
  expect(manifest.host_permissions).toEqual(['https://www.googleapis.com/*']);
  expect(manifest.optional_host_permissions).toBeUndefined();
  expect(manifest.optional_permissions).toBeUndefined();
  expect(manifest.background.service_worker).toBeTruthy();
  for (const f of [manifest.background.service_worker, ...Object.values(manifest.icons || {}), ...manifest.content_scripts.flatMap((c) => c.js || [])])
    expect(fs.existsSync(path.join(EXT, f)), `manifest references missing file ${f}`).toBe(true);
  expect(manifest.externally_connectable).toBeUndefined();
  expect(manifest.web_accessible_resources || []).toEqual([]);
  // content scripts unchanged: only local markdown files
  expect(manifest.content_scripts.flatMap((c) => c.matches)).toEqual(['file:///*.md', 'file:///*.markdown']);
});

test('oauth2: scopes exactly [drive]; client_id present (placeholder allowed - reported)', () => {
  expect(manifest.oauth2, 'oauth2 block').toBeTruthy();
  expect(manifest.oauth2.scopes).toEqual(['https://www.googleapis.com/auth/drive']);
  expect(typeof manifest.oauth2.client_id).toBe('string');
  expect(manifest.oauth2.client_id.length).toBeGreaterThan(0);
  expect(manifest.oauth2.client_id).toMatch(/\.apps\.googleusercontent\.com$/);
  const placeholder = /^YOUR_CLIENT_ID\./.test(manifest.oauth2.client_id);
  console.log(`oauth2.client_id = ${manifest.oauth2.client_id}  -> ${placeholder ? 'STILL THE PLACEHOLDER (Drive sign-in cannot work until npm run set-client-id)' : 'real-looking client id'}`);
  test.info().annotations.push({ type: 'client_id_placeholder', description: String(placeholder) });
});

test('pinned key derives to the ID in EXTENSION_ID.txt (sha256(DER)[0..16) hex 0-f -> a-p)', () => {
  expect(manifest.key, 'manifest.key').toBeTruthy();
  const der = Buffer.from(manifest.key, 'base64');
  expect(der.toString('base64')).toBe(manifest.key); // canonical base64
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  const id = [...hex].map((c) => 'abcdefghijklmnop'[parseInt(c, 16)]).join('');
  const want = fs.readFileSync(path.join(EXT, '..', 'EXTENSION_ID.txt'), 'utf8').trim();
  expect(id).toBe(want);
  console.log('derived extension id', id);
});

test('CSP present, strict, no unsafe-eval/unsafe-inline/remote', () => {
  const csp = manifest.content_security_policy?.extension_pages;
  expect(csp).toBeTruthy();
  expect(csp).toBe("script-src 'self'; object-src 'self'");
  expect(Object.keys(manifest.content_security_policy)).toEqual(['extension_pages']);
  expect(csp).toMatch(/script-src 'self'/);
  expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|wasm-unsafe-eval|https?:|\*/);
});

test('editor page built: index.html exists', () => {
  expect(fs.existsSync(path.join(EXT, 'editor', 'index.html')), 'extension/editor/index.html missing (not built)').toBe(true);
});

test('no inline <script>, inline on*= handlers, javascript: URLs in extension HTML', () => {
  expect(htmlFiles.length).toBeGreaterThan(0);
  for (const f of htmlFiles) {
    const s = fs.readFileSync(f, 'utf8');
    const inline = [...s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=/.test(m[1]) || m[2].trim());
    expect(inline.map((m) => m[0].slice(0, 80)), `inline script in ${f}`).toEqual([]);
    expect([...s.matchAll(/\son[a-z]+\s*=\s*["']/gi)].map((m) => m[0]), `inline handler in ${f}`).toEqual([]);
    expect(/javascript:/i.test(s), `javascript: URL in ${f}`).toBe(false);
    for (const m of s.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)=["']([^"']+)["']/gi)) expect(m[1], `remote ref in ${f}`).not.toMatch(/^(https?:)?\/\//);
  }
});

test('no remote URLs loaded by html/css; report http(s) strings in JS', () => {
  const remoteCode = [];
  for (const f of all.filter((f) => /\.(html|css)$/.test(f))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)|url\(\s*["']?(https?:\/\/[^)"']+)|@import\s+["'](https?:\/\/[^"']+)/gi)) remoteCode.push(`${path.relative(EXT, f)}: ${m[0]}`);
  }
  expect(remoteCode).toEqual([]);
  // JS: informational. Collect distinct hosts; flag dynamic remote loading patterns.
  const hosts = new Map(); const dyn = [];
  for (const f of jsFiles) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/https?:\/\/[a-z0-9.-]+[^\s"'`)]*/gi)) { const h = m[0].slice(0, 70); hosts.set(h, (hosts.get(h) || 0) + 1); }
    for (const m of s.matchAll(/\b(importScripts|import)\(\s*["'`]https?:|fetch\(\s*["'`]https?:|XMLHttpRequest|new\s+WebSocket\(|createElement\(\s*["']script["']\s*\)/g)) { const c = ctxLine(s, m.index); dyn.push(`${path.relative(EXT, f)}:${c.ln}: ${c.text}`); }
  }
  console.log('URL-like strings inside JS (informational, e.g. spec/namespace URLs):', JSON.stringify([...hosts.keys()], null, 1));
  console.log('Dynamic-loading patterns in JS:', JSON.stringify(dyn, null, 1));
  const dynRemote = dyn.filter((d) => /https?:/.test(d));
  expect(dynRemote, 'dynamic remote loading').toEqual([]);
});

test('eval / new Function / setTimeout(string) in extension JS (report facts)', () => {
  const hits = [];
  for (const f of jsFiles) {
    const s = fs.readFileSync(f, 'utf8');
    const re = /(?<![\w$.])eval\s*\(|new\s+Function\s*\(|(?<![\w$.])Function\s*\(\s*["'`]|set(?:Timeout|Interval)\s*\(\s*["'`]|document\.write\s*\(/g;
    for (const m of s.matchAll(re)) {
      const c = ctxLine(s, m.index);
      // skip comments
      if (/^\s*(\/\/|\*|\/\*)/.test(c.text)) { hits.push(`(comment) ${path.relative(EXT, f)}:${c.ln}: ${c.text}`); continue; }
      hits.push(`${path.relative(EXT, f)}:${c.ln}: ${c.text}`);
    }
  }
  console.log('eval/new Function/etc hits:', hits.length ? '\n' + hits.join('\n') : 'NONE');
  expect(hits.filter((h) => !h.startsWith('(comment)')), 'eval/new Function found').toEqual([]);
});

test('innerHTML/outerHTML/insertAdjacentHTML sinks in hand-written code (info)', () => {
  const files = ['background.js', 'content.js'].map((f) => path.join(EXT, f));
  for (const f of files) { const s = fs.readFileSync(f, 'utf8'); expect(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/.test(s), f).toBe(false); }
});

// Drive UI + api are new code in the bundle: every URL-like string that is NOT inside a comment must be one of the known kinds.
test('Drive code: bundle has no unexpected http(s) URLs outside comments; googleapis usage limited to the 3 known endpoints', () => {
  const ALLOWED_CODE = [
    /^https:\/\/www\.googleapis\.com\/drive\/v3$/, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3$/, /^https:\/\/oauth2\.googleapis\.com\/revoke\?token=$/,
    /^http:\/\/www\.w3\.org\/2000\/svg$/,              // SVG namespace for createElementNS (icons)
    /^https?:\/\/$/, /^https:\/\/…/, /^https:\/\/www?\.?$/,   // "https://" prefix strings / input placeholders (TipTap link/image popovers)
    /^https:\/\/prosemirror\.net\/docs\/guide\/#generatable$/, // ProseMirror error text
    /^https:\/\/github\.com\/highlightjs\/.*/, /^https:\/\/github\.com\/markedjs\/marked\.$/, // console.warn / error text in libs (never fetched)
  ];
  const offenders = []; const googleapis = new Set(); const seenComment = new Set();
  for (const f of jsFiles) {
    const lines = fs.readFileSync(f, 'utf8').split('\n'); let inBlock = false;
    lines.forEach((line, i) => {
      const t = line.trim();
      let isComment = inBlock;
      if (!inBlock && (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))) isComment = true;
      if (t.startsWith('/*') && !t.includes('*/')) inBlock = true; else if (inBlock && t.includes('*/')) inBlock = false;
      for (const m of line.matchAll(/https?:\/\/[^\s"'`)\]]*/g)) {
        if (/googleapis\.com/.test(m[0])) googleapis.add(m[0]);
        if (isComment) { seenComment.add(m[0].replace(/^(https?:\/\/[^/]+).*/, '$1')); continue; }
        // markdown-link style "[x](https://…)" in a JSDoc-in-template line is still a doc line; fall back to allow-list
        if (!ALLOWED_CODE.some((r) => r.test(m[0]))) offenders.push(`${path.relative(EXT, f)}:${i + 1}: ${m[0]}  <- ${t.slice(0, 100)}`);
      }
    });
  }
  console.log('googleapis.com URLs in bundle:', JSON.stringify([...googleapis]));
  console.log('hosts only in comments (doc links):', JSON.stringify([...seenComment].sort()));
  expect(offenders, 'unexpected non-comment URL strings').toEqual([]);
  // exactly the three Drive endpoints; nothing else on google domains (no accounts.google.com, no apis.google.com/gapi, no picker)
  expect([...googleapis].filter((u) => !/^https:\/\/(www\.googleapis\.com\/(upload\/)?drive\/v3|oauth2\.googleapis\.com\/revoke)/.test(u))).toEqual([]);
  for (const f of jsFiles) {
    const s = fs.readFileSync(f, 'utf8');
    expect(/apis\.google\.com|accounts\.google\.com\/gsi|gapi\.load|google\.picker/i.test(s), `gapi/GSI/Picker remote loader referenced in ${f}`).toBe(false);
  }
});

test('Drive code: no eval/inline handlers/remote assets in the drive-ui CSS + built page (re-check of new code)', () => {
  const css = all.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  expect(css.length).toBeGreaterThan(1000);
  expect(css.includes('gdui-dialog'), 'drive-ui css shipped in bundle').toBe(true);
  expect(/@import|url\(\s*["']?https?:|url\(\s*["']?\/\//i.test(css)).toBe(false);
  const html = fs.readFileSync(path.join(EXT, 'editor', 'index.html'), 'utf8');
  for (const id of ['btn-drive-open', 'btn-drive-save', 'drive-status']) expect(html).toContain(`id="${id}"`);
  const js = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  expect(/\.innerHTML\s*=\s*[^;]*(drive|Drive|gdui)/.test(js)).toBe(false);
  expect(/setAttribute\(\s*["']style["']|\.style\.cssText\s*=/.test(js.slice(js.indexOf('gdui')))).toBe(false); // drive-ui uses classes only (CSP-friendly)
});
