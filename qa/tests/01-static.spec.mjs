// 1. Static: manifest, permissions, CSP, remote URLs, eval/new Function, inline script/handlers.
import { test, expect } from '@playwright/test';
import fs from 'node:fs'; import path from 'node:path';
import { EXT } from '../lib/fixture.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const all = walk(EXT);
const htmlFiles = all.filter((f) => f.endsWith('.html'));
const jsFiles = all.filter((f) => /\.(m?js)$/.test(f));
const report = { findings: [] };
const ctxLine = (src, idx) => { const ln = src.slice(0, idx).split('\n').length; return { ln, text: src.split('\n')[ln - 1].trim().slice(0, 160) }; };

test('manifest valid + permissions only ["storage"]', () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name && manifest.version).toBeTruthy();
  expect(manifest.permissions).toEqual(['storage']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toBeUndefined();
  expect(manifest.optional_permissions).toBeUndefined();
  expect(manifest.background.service_worker).toBeTruthy();
  for (const f of [manifest.background.service_worker, ...Object.values(manifest.icons || {}), ...manifest.content_scripts.flatMap((c) => c.js || [])])
    expect(fs.existsSync(path.join(EXT, f)), `manifest references missing file ${f}`).toBe(true);
  expect(manifest.externally_connectable).toBeUndefined();
  expect(manifest.web_accessible_resources || []).toEqual([]);
});

test('CSP present, strict, no unsafe-eval/unsafe-inline/remote', () => {
  const csp = manifest.content_security_policy?.extension_pages;
  expect(csp).toBeTruthy();
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
