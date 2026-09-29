// Markdown <-> ProseMirror fidelity layer on top of @tiptap/markdown (BUG-9 escapes/autolinks, BUG-10 raw HTML / footnotes).
// Everything here is pure JS bundled by Vite: no eval, no inline script, and raw HTML is NEVER injected as markup
// (raw nodes render their source as escaped *text* inside read-only chips).
import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Link } from '@tiptap/extension-link';

// ------------------------------------------------------------------------------------------------
// Text escaping (serializer side)
// ------------------------------------------------------------------------------------------------
const PUNCT = /[!-/:-@[-`{-~]/;
const isWs = (c) => c !== undefined && /\s/.test(c);
const isAlnum = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const ENTITY_AT = /&(?:lt|gt|quot|amp);/y; // the only entities @tiptap/markdown decodes on parse

/** Escape characters that would create *inline* markdown syntax. Deliberately minimal (see EDITOR_NOTES). */
export function escapeInline(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], p = text[i - 1], n = text[i + 1];
    switch (c) {
      case '\\': out += (n === undefined || n === '\n' || PUNCT.test(n)) ? '\\\\' : '\\'; break;
      case '*': case '~': out += (isWs(p) && isWs(n)) ? c : '\\' + c; break;         // spaced `2 * 3` cannot open/close emphasis
      case '_': out += ((isAlnum(p) && isAlnum(n)) || (isWs(p) && isWs(n))) ? c : '\\_'; break; // intra-word snake_case is inert
      case '`': case '[': case ']': out += '\\' + c; break;
      case '<': out += (n === undefined || /[A-Za-z/!?]/.test(n)) ? '\\<' : '<'; break; // only tag/autolink starts need it (no &lt; churn)
      case '&': ENTITY_AT.lastIndex = i; out += ENTITY_AT.test(text) ? '&amp;' : '&'; break;
      default: out += c;
    }
  }
  return out;
}

/** Escape a leading block marker of one (already inline-escaped) line so it stays literal text. */
function escapeLineStart(line) {
  const m = /^( {0,3})([\s\S]*)$/.exec(line);
  const ind = m[1], rest = m[2];
  if (rest.startsWith('\\')) return line;
  let r;
  if (/^#{1,6}(?=\s|$)/.test(rest)) r = '\\' + rest;                       // \# heading
  else if (rest.startsWith('>')) r = '\\' + rest;                           // \> quote
  else if (/^[-+*](?=\s|$)/.test(rest)) r = '\\' + rest;                    // \- \+ list bullets
  else if (/^(?:-+|=+)\s*$/.test(rest)) r = '\\' + rest;                    // \--- hr / setext underline
  else if ((r = /^(\d{1,9})([.)])(?=\s|$)/.exec(rest))) r = r[1] + '\\' + rest.slice(r[1].length); // 1\. / 1\)
  else return line;
  return ind + r;
}

/** Full text encoding for a text node. `first` = node starts a line of a paragraph; `hlast` = last text of a heading. */
export function escapeText(text, { first = false, hlast = false } = {}) {
  let s = escapeInline(text);
  s = s.split('\n').map((line, i) => (i === 0 && !first ? line : escapeLineStart(line))).join('\n');
  if (hlast) s = s.replace(/(^|[ \t])(#+)[ \t]*$/, (_, a, h) => `${a}\\${h}`); // trailing #'s would be read as a closing sequence
  return s;
}

/** Annotate the JSON doc (in place) with block-start info and validate autolink marks. */
export function prepareDoc(node) {
  if (!node || !Array.isArray(node.content)) return node;
  const c = node.content;
  if (node.type === 'paragraph' || node.type === 'heading') {
    for (let i = 0; i < c.length; i++) {
      const n = c[i];
      if (n.type !== 'text') continue;
      if (node.type === 'paragraph' && !(n.marks && n.marks.length) && (i === 0 || c[i - 1].type === 'hardBreak')) n._first = true;
      if (node.type === 'heading' && i === c.length - 1) n._hlast = true;
    }
    for (let i = 0; i < c.length; i++) {
      const n = c[i];
      const link = n.type === 'text' && (n.marks || []).find((m) => m.type === 'link');
      if (!link || !link.attrs || !link.attrs.mdAuto) continue;
      const href = link.attrs.href || '', t = n.text || '';
      const same = (o) => o && o.type === 'text' && (o.marks || []).some((m) => m.type === 'link' && m.attrs && m.attrs.href === href);
      const textOk = t === href || href === 'mailto:' + t || (link.attrs.mdAuto === 'bare' && href === 'http://' + t);
      if (n.marks.length !== 1 || !textOk || same(c[i - 1]) || same(c[i + 1]) || link.attrs.title) {
        // marks/attrs objects are shared with the live ProseMirror doc: replace, never mutate
        n.marks = n.marks.map((m) => (m === link ? { ...m, attrs: { ...m.attrs, mdAuto: null } } : m));
      }
    }
  }
  for (const ch of c) prepareDoc(ch);
  return node;
}

// ------------------------------------------------------------------------------------------------
// Link: remember `<https://x>` / bare-URL autolinks so they serialize as they were written
// ------------------------------------------------------------------------------------------------
export const SafeLink = Link.extend({
  addAttributes() {
    return { ...this.parent?.(), mdAuto: { default: null, rendered: false, keepOnSplit: false } };
  },
  parseMarkdown: (token, h) => {
    const attrs = { href: token.href, title: token.title || null };
    const raw = token.raw || '';
    if (raw.startsWith('<')) attrs.mdAuto = 'angle';
    else if (raw && !raw.startsWith('[') && raw === token.text && !token.title) attrs.mdAuto = 'bare';
    return h.applyMark('link', h.parseInline(token.tokens || []), attrs);
  },
  renderMarkdown: (node, h) => {
    const a = node.attrs || {};
    if (a.mdAuto === 'angle') return `<${h.renderChildren(node)}>`;
    if (a.mdAuto === 'bare') return h.renderChildren(node);
    const href = a.href ?? '', title = a.title ?? '';
    const text = h.renderChildren(node);
    return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
  },
});

// ------------------------------------------------------------------------------------------------
// Raw HTML / footnotes / front matter: atom nodes that keep the source verbatim
// ------------------------------------------------------------------------------------------------
// Blank (or whitespace-only) lines inside raw source are wrapped in private-use sentinels so that
// normalizeMarkdownOutput()'s blank-line collapsing cannot alter them; it restores them at the end.
// Fence-looking lines inside raw HTML get a \uE002 prefix so the code-fence tracker in normalizeMarkdownOutput ignores them.
export const encodeRaw = (raw) => String(raw ?? '')
  .replace(/^[ \t]*$/gm, (m) => `\uE000${m}\uE001`)
  .replace(/^(?=[ \t]*(?:`{3,}|~{3,}))/gm, '\uE002');
export const restoreRaw = (md) => md.replace(/\uE000([^\uE001\n]*)\uE001/g, '$1').replace(/\uE002/g, '');

const LABELS = { html: 'HTML', comment: 'Comment', footnote: 'Footnote', frontmatter: 'Front matter' };
const kindOfHtml = (raw) => (/^\s*<!--/.test(raw) ? 'comment' : 'html');
// Inline tags TipTap already maps to real marks/nodes (handled by @tiptap/markdown as before); everything else is preserved raw.
const NATIVE_INLINE = new Set(['br', 'em', 'i', 'strong', 'b', 's', 'del', 'strike', 'code']);
const WARN_INLINE = new Set([...NATIVE_INLINE].filter((t) => t !== 'br'));
const INLINE_TAG = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s+[A-Za-z_:][\w:.-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/;
const FN_DEF = /^\[\^[^\]\s]+\]:[^\n]*(?:\n(?:[ \t]{4,}[^\n]*|\[\^[^\]\s]+\]:[^\n]*|[ \t]*(?=\n[ \t]{4,})))*/;
const FRONT = /^---[ \t]*\n(?=[ \t]*[\w-]+[ \t]*:)(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/;

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() { return { raw: { default: '' }, kind: { default: 'html' } }; },
  parseHTML() {
    return [{ tag: 'div[data-mdx-raw-block]', getAttrs: (el) => ({ raw: el.getAttribute('data-mdx-raw') || '', kind: el.getAttribute('data-mdx-kind') || 'html' }) }];
  },
  renderHTML({ node }) {
    const { raw, kind } = node.attrs;
    return ['div', {
      class: `mdx-raw mdx-raw-block mdx-raw-${kind}`, 'data-mdx-raw-block': '', 'data-mdx-raw': raw, 'data-mdx-kind': kind,
      contenteditable: 'false',
    }, ['span', { class: 'mdx-raw-label' }, `${LABELS[kind] || 'Raw'} (read-only)`], ['pre', { class: 'mdx-raw-text' }, raw]]; // text nodes only
  },
  renderText: ({ node }) => node.attrs.raw,
  markdownTokenName: 'rawBlock',
  markdownTokenizer: {
    name: 'rawBlock',
    level: 'block',
    start: (src) => { const m = /(?:^|\n)\[\^[^\]\s]+\]:/.exec(src); return m ? m.index + (m[0][0] === '\n' ? 1 : 0) : -1; },
    tokenize: (src, tokens) => {
      let m;
      if (!tokens.length && (m = FRONT.exec(src))) return { type: 'rawBlock', kind: 'frontmatter', raw: m[0], text: m[0].replace(/\s+$/, '') };
      if ((m = FN_DEF.exec(src))) return { type: 'rawBlock', kind: 'footnote', raw: m[0], text: m[0] };
      return undefined;
    },
  },
  parseMarkdown: (token, h) => h.createNode('rawBlock', { raw: token.text ?? '', kind: token.kind || 'html' }),
  renderMarkdown: (node) => encodeRaw(node.attrs.raw),
});

export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { raw: { default: '' }, kind: { default: 'html' } }; },
  parseHTML() {
    return [{ tag: 'span[data-mdx-raw-inline]', getAttrs: (el) => ({ raw: el.getAttribute('data-mdx-raw') || '', kind: el.getAttribute('data-mdx-kind') || 'html' }) }];
  },
  renderHTML({ node }) {
    const { raw, kind } = node.attrs;
    return ['span', {
      class: `mdx-raw mdx-raw-inline mdx-raw-${kind}`, 'data-mdx-raw-inline': '', 'data-mdx-raw': raw, 'data-mdx-kind': kind,
      contenteditable: 'false', title: `${LABELS[kind] || 'Raw'} (read-only)`,
    }, raw]; // escaped text, never markup
  },
  renderText: ({ node }) => node.attrs.raw,
  markdownTokenName: 'rawInline',
  markdownTokenizer: {
    name: 'rawInline',
    level: 'inline',
    start: (src) => src.search(/<|\[\^/),
    tokenize: (src) => {
      let m;
      if (src.startsWith('[^')) {
        if ((m = /^\[\^[^\]\s]+\]/.exec(src))) return { type: 'rawInline', kind: 'footnote', raw: m[0], text: m[0] };
        return undefined;
      }
      if (src.startsWith('<!--') && (m = /^<!--[\s\S]*?-->/.exec(src))) return { type: 'rawInline', kind: 'comment', raw: m[0], text: m[0] };
      if ((m = INLINE_TAG.exec(src)) && !NATIVE_INLINE.has(m[2].toLowerCase())) return { type: 'rawInline', kind: 'html', raw: m[0], text: m[0] };
      return undefined;
    },
  },
  parseMarkdown: (token, h) => h.createNode('rawInline', { raw: token.text ?? '', kind: token.kind || 'html' }),
  renderMarkdown: (node) => String(node.attrs.raw ?? ''),
});

/** Block-level HTML tokens (`<details>`, `<div align=center>`, comments, ...) -> RawBlock. */
export const RawHtmlBlockParser = Extension.create({
  name: 'rawHtmlBlockParser',
  markdownTokenName: 'html',
  parseMarkdown: (token, h) => {
    if (!token.block) return null; // inline html keeps the stock behaviour
    const raw = String(token.text ?? token.raw ?? '').replace(/\s+$/, '');
    if (!raw.trim()) return null;
    return h.createNode('rawBlock', { raw, kind: kindOfHtml(raw) });
  },
});

// ------------------------------------------------------------------------------------------------
// Markdown extension with the patched serializer
// ------------------------------------------------------------------------------------------------
export const MarkdownFixed = Markdown.extend({
  onBeforeCreate() {
    this.parent?.();
    const editor = this.editor;
    const manager = editor.markdown;
    if (!manager || manager.__mdxPatched) return;
    manager.__mdxPatched = true;
    manager.encodeTextForMarkdown = function (text, node, parentNode) {
      const marks = node.marks || [];
      const inCode = (parentNode?.type != null && this.codeTypes.has(parentNode.type)) || marks.some((m) => this.codeTypes.has(typeof m === 'string' ? m : m.type));
      if (inCode) return text;
      if (marks.some((m) => m.type === 'link' && m.attrs && m.attrs.mdAuto)) return text; // autolink text must stay raw
      return escapeText(text, { first: !!node._first, hlast: !!node._hlast });
    };
    editor.getMarkdown = () => manager.serialize(prepareDoc(editor.getJSON()));
  },
});

// ------------------------------------------------------------------------------------------------
// Warnings for constructs that are NOT preserved verbatim
// ------------------------------------------------------------------------------------------------
/** Returns [{code, message}]. Cheap regex prefilter first; lexes only when something suspicious is present. */
export function detectWarnings(manager, md) {
  const out = [];
  if (!md || !manager || !manager.instance) return out;
  const mayHaveDef = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S/m.test(md);
  const mayHaveHtml = /<[A-Za-z]/.test(md);
  if (!mayHaveDef && !mayHaveHtml) return out;
  let tokens;
  try { tokens = manager.instance.lexer(md); } catch { return out; }
  let defs = false, converted = new Set();
  const walk = (t) => {
    if (Array.isArray(t)) { t.forEach(walk); return; }
    if (!t || typeof t !== 'object') return;
    if (t.type === 'def') defs = true;
    if (t.type === 'html' && !t.block) { const m = INLINE_TAG.exec(String(t.raw || '')); if (m && WARN_INLINE.has(m[2].toLowerCase())) converted.add(m[2].toLowerCase()); }
    for (const k of ['tokens', 'items', 'header', 'rows']) if (t[k]) walk(t[k]);
  };
  walk(tokens);
  if (defs) out.push({ code: 'reference-links', message: 'Reference-style links/definitions were converted to inline links; the link targets are kept but the [ref] syntax is not.' });
  if (converted.size) out.push({ code: 'html-converted', message: `Inline HTML (<${[...converted].join('>, <')}>) was converted to Markdown equivalents; extra attributes are dropped.` });
  return out;
}
