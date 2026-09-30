// Lazy renderers for Mermaid (SVG) and KaTeX (HTML+MathML). Both libraries are loaded with dynamic import() so the
// editor's startup bundle stays small (Vite code-splits them into separate chunks). No eval / inline script is used.
// Output strings come from Mermaid (securityLevel 'strict' => DOMPurify-sanitized SVG) and KaTeX (trust:false).

let mermaidP = null;
let katexP = null;
const loadMermaid = () => (mermaidP ||= Promise.all([import('mermaid'), import('dompurify')])
  .then(([m, dp]) => { installPurifyHook(dp.default || dp); return m.default || m; })
  .catch((e) => { mermaidP = null; throw e; }));
const loadKatex = () => (katexP ||= import('katex').then((m) => m.default || m).catch((e) => { katexP = null; throw e; }));

// jsdom / unit tests can't lay out SVG: they set globalThis.__MDX_NO_MERMAID__ = true to skip the real render.
const mermaidDisabled = () => !!globalThis.__MDX_NO_MERMAID__;

export function errorEl(kind, message, tag = 'div') {
  const e = document.createElement(tag);
  e.className = 'mdx-error';
  e.dataset.mdxError = kind;
  e.setAttribute('role', 'status');
  e.textContent = String(message).slice(0, 600); // text only, never markup
  return e;
}

// ---------------------------------------------------------------- Mermaid
// BUG-29: no diagram may make the browser fetch a remote resource (privacy: an untrusted .md must not phone home).
// Mermaid keeps <img>/<image>/href in HTML labels even with securityLevel 'strict', and it inserts the label markup into
// the live document *while rendering* (temp measuring div under <body>), so stripping the finished SVG is too late.
// Two layers:
//  1. a hook on the DOMPurify instance mermaid itself uses (same bundled module) strips every resource-loading
//     attribute that is not a data: URI / #fragment before mermaid ever builds a DOM node from the label text;
//  2. the finished SVG string is parsed into a DETACHED document (DOMParser: inert, nothing is fetched), stripped again
//     (also <style> @import / url(), style="...url()"), and only then inserted into the page.
// <a href> is kept (a click navigates; it is not fetched automatically). htmlLabels stay ON so labels still look right.
const LOAD_ATTRS = ['src', 'srcset', 'href', 'xlink:href', 'poster', 'background', 'data', 'action', 'formaction', 'ping', 'longdesc', 'usemap'];
const LOAD_TAGS = new Set(['picture', 'source', 'video', 'audio', 'track', 'iframe', 'frame', 'object', 'embed', 'link', 'script', 'feimage']);
const SAFE_REF = /^\s*(#|data:image\/(png|gif|jpe?g|webp);)/i; // fragment refs (markers, gradients, <use href="#x">) and inline images only
const CSS_URL = /url\(\s*(['"]?)(?!\s*(#|data:))[^)]*\)/gi;
const CSS_IMPORT = /@import\s+[^;]*;?/gi;
const cleanCss = (css) => css.replace(CSS_IMPORT, '').replace(CSS_URL, 'none');

function stripElement(el, removeTags = true) {
  const tag = el.localName ? el.localName.toLowerCase() : '';
  if (removeTags && LOAD_TAGS.has(tag)) { el.remove(); return; }
  if (removeTags && (tag === 'img' || tag === 'image')) { // kept only when it is an inline data: image
    const ref = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('xlink:href') || '';
    if (!SAFE_REF.test(ref) || ref.trim().startsWith('#')) { el.remove(); return; }
  }
  const isAnchor = tag === 'a';
  for (const name of [...el.getAttributeNames()]) {
    const lname = name.toLowerCase();
    const v = el.getAttribute(name) || '';
    if (LOAD_ATTRS.includes(lname) && !(isAnchor && (lname === 'href' || lname === 'xlink:href')) && !SAFE_REF.test(v)) el.removeAttribute(name);
    else if (lname === 'style' && /url\(|@import/i.test(v)) el.setAttribute(name, cleanCss(v));
  }
}

let purifyHooked = false;
function installPurifyHook(DOMPurify) {
  if (purifyHooked || !DOMPurify || typeof DOMPurify.addHook !== 'function') return;
  purifyHooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => { if (node && node.nodeType === 1) stripElement(node, false); }); // attributes only: never remove nodes under DOMPurify's iterator
}

/** Parse the SVG string into an inert detached document, strip anything that could load a remote resource, return markup. */
export function sanitizeSvgString(svg) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${svg}`, 'text/html');
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!el.isConnected) continue;
    if (el.localName === 'style') el.textContent = cleanCss(el.textContent || '');
    stripElement(el);
  }
  return doc.body.innerHTML;
}

// ---- BUG-31: config that reaches mermaid through the diagram text ----
// `%%{init: {"themeCSS": ".node rect{fill:url(https://x/y.png)}"}}%%` (or the same in YAML front matter `config:`) makes mermaid
// put a <style> with that CSS into its temporary measuring element in the LIVE document, so url() in it is fetched during render
// (before any post-processing can see it). Two independent layers, both mermaid-input only (the markdown source is never touched):
//  1. mermaid.initialize({ secure: [...defaults, 'themeCSS'] }): mermaid deletes secure keys from every diagram directive / front
//     matter config *after parsing them*, so it also covers escaped spellings (\u0043) that no regex could enumerate;
//  2. sanitizeMermaidSource() strips the risky config out of the text handed to parse()/render(): themeCSS keys (any case, quoted
//     any way), every config string value containing url()/@import/`\` CSS escapes, in %%{init|initialize|config: ...}%% directives
//     (single or multi line) and in the `---\nconfig: ...\n---` front matter. Unparseable/odd directives are dropped whole (fail closed).
//     Legit directives (theme, themeVariables colours, flowchart, ...) are kept.
export const MERMAID_SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'themeCSS'];
const RISKY_VALUE = /url\s*\(|@import|\\|expression\s*\(|image-set\s*\(|src\s*\(/i;
const RISKY_KEY = /theme\s*css/i;
const DIRECTIVE_RE = /%{2}\{((?:(?!\}%{2})[\s\S])*)\}%{2}/g;
const FRONT_RE = /^([^\S\n\r]*)-{3}[^\S\n\r]*[\n\r]+([\s\S]*?)[\n\r]\1-{3}[^\S\n\r]*(?=[\n\r]|$)/;

function scrubObject(v) {
  if (Array.isArray(v)) return v.map(scrubObject);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      if (RISKY_KEY.test(k) || /^__|proto|constr/.test(k)) continue;
      if (typeof val === 'string' && (RISKY_VALUE.test(val) || RISKY_KEY.test(val))) continue; // drop the key (an empty colour would break mermaid's colour maths)
      o[k] = scrubObject(val);
    }
    return o;
  }
  return typeof v === 'string' && (RISKY_VALUE.test(v) || RISKY_KEY.test(v)) ? '' : v;
}
function scrubDirectiveBody(body) {
  const m = /^\s*(\w+)\s*:\s*([\s\S]*?)\s*$/.exec(body);
  if (!m || !/^(init|initialize|config)$/i.test(m[1])) return undefined;             // `%%{wrap}%%`, `%%{x}%%`...: not config, keep
  const [, name, arg] = m;
  if (!RISKY_VALUE.test(arg) && !RISKY_KEY.test(arg)) return undefined;              // ordinary init (theme, flowchart...): keep verbatim
  let parsed;
  try { parsed = JSON.parse(arg); } catch { try { parsed = JSON.parse(arg.replace(/'/g, '"')); } catch { return ''; } }          // cannot prove it is safe -> drop the directive
  const clean = scrubObject(parsed);
  return Object.keys(clean).length ? `${name}: ${JSON.stringify(clean)}` : '';
}
function scrubFrontMatter(text) {
  // YAML: drop `themeCSS: ...` entries (key quoted or not, value inline or as an indented / block continuation) and any config
  // line whose value is risky. Continuation lines = more indented than the key line (or blank).
  const lines = text.split(/\r?\n/); const out = []; let skipIndent = -1;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    if (skipIndent >= 0) { if (!line.trim() || indent > skipIndent) continue; skipIndent = -1; }
    if (RISKY_KEY.test(line.split(':')[0]) || RISKY_VALUE.test(line) || /theme\s*css/i.test(line)) { skipIndent = indent; continue; }
    out.push(line);
  }
  return out.join('\n');
}
/** Diagram text -> text for mermaid with theme CSS / url() config removed. Pure; returns the input unchanged if nothing matched. */
export function sanitizeMermaidSource(code) {
  let text = String(code);
  const fm = FRONT_RE.exec(text);
  if (fm && (RISKY_VALUE.test(fm[2]) || RISKY_KEY.test(fm[2]))) {
    const inner = scrubFrontMatter(fm[2]);
    text = `${fm[1]}---\n${inner}\n${fm[1]}---` + text.slice(fm[0].length);
  }
  return text.replace(DIRECTIVE_RE, (all, body) => {
    const r = scrubDirectiveBody(body);
    return r === undefined ? all : (r ? `%%{${r}}%%` : '');
  });
}

let mmdSeq = 0;
let mmdQueue = Promise.resolve(); // mermaid.render is not re-entrant: serialize all renders
const mmdCache = new Map();       // `${theme}\0${code}` -> svg string (bounded)
const CACHE_MAX = 120;      // both themes are cached per diagram (dark editor keeps a light variant for printing)

/** A cached SVG is reused for several nodes: give each copy its own id (its <style> and marker refs are scoped by it). */
function uniqueSvgIds(svg) {
  const m = /\sid="(mdx-mmd-\d+)"/.exec(svg);
  if (!m) return svg;
  return svg.replace(new RegExp(m[1] + '(?!\\d)', 'g'), `mdx-mmd-${++mmdSeq}`);
}

/** Remove anything mermaid appended to <body> for render `id` (temp measuring div `d<id>`, error bomb svg, ...). */
function cleanupMermaidTemp(id) {
  for (const sel of [`#d${id}`, `#${id}`, `#i${id}`]) {
    document.querySelectorAll(sel).forEach((n) => { if (n.parentNode === document.body || !n.closest('.mdx-mermaid-render')) n.remove(); });
  }
}

/**
 * Render `code` into `container`. Resolves { ok: true } or { ok: false, message }; never rejects, never throws.
 * `theme`: editor theme ('dark' -> mermaid 'dark', otherwise 'default').
 */
export function renderMermaid(container, code, theme) {
  const mTheme = theme === 'dark' ? 'dark' : 'default';
  const run = async () => {
    if (!String(code).trim()) { container.replaceChildren(); return { ok: true, empty: true }; }
    if (mermaidDisabled()) { container.replaceChildren(errorEl('mermaid', 'Diagram rendering is disabled in this environment.')); return { ok: false, message: 'disabled' }; }
    const cached = mmdCache.get(`${mTheme}\0${code}`);
    if (cached) { container.innerHTML = uniqueSvgIds(cached); return { ok: true, cached: true }; }
    const r = await svgJob(code, theme);
    if (!r.ok) { container.replaceChildren(errorEl('mermaid', `Mermaid syntax error: ${r.message}`)); return r; }
    container.innerHTML = r.svg;
    return { ok: true };
  };
  const p = mmdQueue.then(run, run);
  mmdQueue = p.catch(() => {});
  return p;
}

/** SYNC cache lookup of the finished SVG of `code` in `theme` ('dark' | anything else = light); a fresh copy with unique ids, or null. */
export function getCachedMermaidSvg(code, theme) {
  const svg = mmdCache.get(`${theme === 'dark' ? 'dark' : 'default'}\0${code}`);
  return svg ? uniqueSvgIds(svg) : null;
}

/** Render (or fetch from the cache) the SVG of `code` for `theme` WITHOUT touching the DOM (other than mermaid's own temp nodes,
 *  removed again). Used for the light print variant. Resolves {ok:true, svg} | {ok:false, message}; never rejects. Serialized with
 *  every other mermaid render (mermaid keeps global theme state). */
export function renderMermaidSvg(code, theme) { return enqueue(() => svgJob(code, theme)); }
async function svgJob(code, theme) {
  const mTheme = theme === 'dark' ? 'dark' : 'default';
  const key = `${mTheme}\0${code}`;
  {
    if (!String(code).trim()) return { ok: true, svg: '' };
    if (mermaidDisabled()) return { ok: false, message: 'disabled' };
    const cached = mmdCache.get(key);
    if (cached) return { ok: true, svg: uniqueSvgIds(cached) };
    const id = `mdx-mmd-${++mmdSeq}`;
    try {
      const mermaid = await loadMermaid();
      // initialize() every time: theme is global state in mermaid and must follow the requested theme.
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: mTheme,
        suppressErrorRendering: true, // don't append mermaid's own "syntax error" bomb graphic to the page
        logLevel: 'fatal',
        secure: MERMAID_SECURE_KEYS,   // BUG-31: diagram directives / front matter can never set themeCSS (see above)
      });
      const mCode = sanitizeMermaidSource(code); // text for mermaid only; `code` (the markdown source) is untouched
      await mermaid.parse(mCode);           // throws on invalid syntax
      const { svg: rawSvg } = await mermaid.render(id, mCode);
      const svg = sanitizeSvgString(rawSvg);
      if (mmdCache.size >= CACHE_MAX) mmdCache.delete(mmdCache.keys().next().value);
      mmdCache.set(key, svg);
      return { ok: true, svg: uniqueSvgIds(svg) };
    } catch (err) {
      return { ok: false, message: (err && (err.message || err.str)) || String(err) };
    } finally {
      cleanupMermaidTemp(id);
    }
  }
}
function enqueue(job) { const p = mmdQueue.then(job, job); mmdQueue = p.catch(() => {}); return p; }

// ---------------------------------------------------------------- KaTeX
/**
 * Render LaTeX into `container` (innerHTML set by KaTeX). Uses throwOnError:true so that EVERY problem (unknown command,
 * unbalanced braces, untrusted \href/\url, ...) is a ParseError we can report: KaTeX's non-throwing mode renders unknown
 * commands as plain red text with no marker. On error the raw source stays visible inside `.mdx-error[data-mdx-error=math]`.
 */
export async function renderMath(container, tex, displayMode) {
  const src = String(tex);
  let untrusted = null;
  try {
    const katex = await loadKatex();
    katex.render(src, container, {
      displayMode: !!displayMode,
      throwOnError: true,
      // trust:false makes KaTeX silently render \href/\url/\includegraphics/\htmlClass... as red text; record the attempt and report it
      trust: (ctx) => { untrusted = untrusted || ctx.command; return false; },
      strict: 'ignore',    // unicode text / \text quirks etc. are not errors and don't warn
      output: 'htmlAndMathml',
      maxExpand: 1000,
    });
    if (untrusted) throw new Error(`Command ${untrusted} is not allowed (links, images and HTML attributes are disabled)`);
    return { ok: true };
  } catch (err) {
    const message = String((err && (err.rawMessage || err.message)) || err);
    const box = errorEl('math', '', displayMode ? 'div' : 'span');
    box.title = message;
    const head = document.createElement('span'); head.className = 'mdx-error-msg'; head.textContent = `Math error: ${message}`;
    const code = document.createElement('code'); code.className = 'mdx-error-src'; code.textContent = src.slice(0, 400);
    box.append(head, ' ', code);
    container.replaceChildren(box);
    return { ok: false, message };
  }
}
