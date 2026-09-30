// Mermaid diagrams + KaTeX math as TipTap nodes (atoms with vanilla-DOM node views; no innerHTML except library output
// that is sanitized by the library: Mermaid securityLevel 'strict' and KaTeX trust:false).
//
//   mermaidBlock  block atom   attrs { code, fence, info }   markdown: ```mermaid ... ```   (verbatim, fence style kept)
//   mathInline    inline atom  attrs { src, delim }          markdown: $src$  or  $$src$$ written inside a paragraph
//   mathBlock     block atom   attrs { src }                 markdown: $$<src>$$  (src verbatim; may span lines)
//
// Stable test hooks: [data-mdx-node="mermaid|math-inline|math-block"], .mdx-mermaid-render, .mdx-math-render,
// [data-mdx-action="toggle-source"], .mdx-mermaid-source / .mdx-math-source, .mdx-error[data-mdx-error="mermaid|math"].
import { Node, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { encodeRaw } from './markdown-fixes.js';
import { renderMermaid, renderMath, errorEl, renderMermaidSvg, getCachedMermaidSvg } from './renderers.js';
import {
  matchInlineMath, matchBlockMath, blockMathStart, sanitizeInlineMath, sanitizeBlockMath, looksLikeMermaid,
} from './math-syntax.js';

export const MERMAID_SAMPLE = 'flowchart LR\n    A[Start] --> B{Choice}\n    B -->|Yes| C[Done]\n    B -->|No| A';
const DEBOUNCE_MS = 350;

// ---- per-editor registry of live node views (flush pending edits before serializing; re-render on theme change) ----
const registry = new WeakMap(); // Editor -> Set<controller>
const ctrlOfDom = new WeakMap(); // node-view root element -> controller
const regFor = (editor) => { let s = registry.get(editor); if (!s) registry.set(editor, (s = new Set())); return s; };
/** Commit any source textarea whose debounced commit is still pending (called before every serialization). */
export function flushEdits(editor) { const s = registry.get(editor); if (s) for (const c of [...s]) c.flush(); }
/** Re-render all diagrams for the editor's current theme (call after data-theme changed). */
export function refreshTheme(editor) { const s = registry.get(editor); if (s) for (const c of [...s]) c.rerender(); }
// ---- printing (see EDITOR_NOTES.md "Print") ----
/** Resolves when every node view has finished its (async) render and - in the dark theme - the light SVG variant of every rendered diagram is cached. Never rejects. */
export async function prepareNodesForPrint(editor) {
  flushEdits(editor);
  const ctrls = () => [...(registry.get(editor) || [])];
  for (let i = 0; i < 5; i++) { await Promise.all(ctrls().map((c) => c.whenRendered())); if (ctrls().every((c) => c.settled())) break; }
  await Promise.all(ctrls().map((c) => c.prepareLight()));
}
/** SYNCHRONOUS: swap the dark diagrams to their cached light SVG (class mdx-print-fallback when a light SVG is not cached). Idempotent. */
export function swapNodesForPrint(editor) { const s = registry.get(editor); if (s) for (const c of [...s]) c.printSwap(); }
/** SYNCHRONOUS: put back exactly the DOM nodes that were on screen before swapNodesForPrint. Idempotent. */
export function restoreNodesAfterPrint(editor) { const s = registry.get(editor); if (s) for (const c of [...s]) c.printRestore(); }
/** Open the source editor of the node view rendered at doc position `pos` (used by the insert actions). */
export function openSourceAt(editor, pos) {
  const dom = editor.view.nodeDOM(pos);
  const c = dom && ctrlOfDom.get(dom);
  if (c) c.open();
}

/** Insert a node at the selection and open its source editor. Inline nodes replace the selection (its text becomes the source). */
export function insertNodeAndOpen(editor, name, attrs, { block }) {
  const { state } = editor;
  const from = state.selection.from;
  const content = block ? [{ type: name, attrs }, { type: 'paragraph' }] : { type: name, attrs };
  if (!editor.chain().focus().insertContent(content).run()) return false;
  let best = null;
  editor.state.doc.descendants((n, pos) => { if (n.type.name === name && pos >= from - 2 && (best === null || pos <= editor.state.selection.from)) best = pos; return true; });
  if (best !== null) openSourceAt(editor, best);
  return true;
}
const NODE_NAMES = new Set(['mermaidBlock', 'mathInline', 'mathBlock']);
const enterOpens = (editor) => {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || !NODE_NAMES.has(sel.node.type.name)) return false;
  openSourceAt(editor, sel.from);
  return true;
};

const h = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const themeOf = (editor) => {
  try { const t = editor.view.dom.closest('[data-theme]'); return t && t.dataset.theme === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
};

/** Shared node-view scaffold: root, header (label + toggle), render box, source field; open/close/commit/debounce. */
function makeView({ node, editor, getPos, kind, label, field, cls, srcCls, renderCls, inline, attr, readSrc, commitValue, doRender, onKeyEnter }) {
  let cur = node;
  let isOpen = false, timer = null, destroyed = false, renderSeq = 0, lastKey = null;
  const dom = h(inline ? 'span' : 'div', `mdx-node ${cls}`, { 'data-mdx-node': kind });
  dom.contentEditable = 'false';
  const toggle = h('button', 'mdx-node-toggle', { type: 'button', 'data-mdx-action': 'toggle-source', 'aria-expanded': 'false' });
  toggle.setAttribute('aria-label', `Edit ${label} source`); toggle.title = `Edit ${label} source`;
  toggle.textContent = inline ? '✎' : 'Edit source';
  toggle.addEventListener('mousedown', (e) => e.preventDefault());
  const box = h(inline ? 'span' : 'div', renderCls);
  const input = field === 'input' ? h('input', srcCls, { type: 'text', autocomplete: 'off' }) : h('textarea', srcCls);
  input.spellcheck = false; input.hidden = true;
  input.setAttribute('aria-label', `${label} source`);
  if (inline) dom.append(box, input, toggle);
  else {
    const head = h('div', 'mdx-node-head');
    const lab = h('span', 'mdx-node-label'); lab.textContent = label;
    head.append(lab, toggle);
    dom.append(head, box, input);
  }

  const pos = () => { const p = getPos(); return typeof p === 'number' ? p : null; };
  const valueOfNode = () => readSrc(cur);

  function commit() {
    clearTimeout(timer); timer = null;
    const p = pos();
    if (p === null || destroyed) return;
    const raw = input.value;
    if (raw === valueOfNode()) return;
    const next = commitValue(raw);
    const { state, view } = editor;
    if (next === null) { // empty math -> remove the node
      view.dispatch(state.tr.delete(p, p + cur.nodeSize));
      return;
    }
    view.dispatch(state.tr.setNodeMarkup(p, undefined, { ...cur.attrs, [attr]: next }));
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(commit, DEBOUNCE_MS); }

  function setOpen(on, { focus = true, select = false } = {}) {
    if (on === isOpen) return;
    isOpen = on;
    dom.classList.toggle('mdx-editing', on);
    input.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (!inline) toggle.textContent = on ? 'Done' : 'Edit source';
    if (on) {
      input.value = valueOfNode();
      if (!inline) input.rows = Math.max(3, Math.min(20, input.value.split('\n').length + 1));
      if (focus) { input.focus(); if (select) input.select(); }
    } else {
      commit();
    }
  }
  function close(refocus) {
    if (!isOpen) return;
    const p = pos();
    setOpen(false);
    if (refocus && p !== null) {
      // put the caret right after the node, back in the document
      try {
        const after = Math.min(editor.state.doc.content.size, p + (editor.state.doc.nodeAt(p)?.nodeSize ?? 1));
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(after), 1)));
      } catch { /* node was removed */ }
      editor.view.focus();
    }
  }

  toggle.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (isOpen) close(true); else setOpen(true); });
  box.addEventListener('click', () => { if (!isOpen) setOpen(true, { select: inline }); });
  input.addEventListener('input', schedule);
  input.addEventListener('blur', () => { if (isOpen) { const wasOpen = isOpen; if (inline) setOpen(false); else commit(); void wasOpen; } });
  // Ctrl/Cmd chords that are the field's own native editing keys: keep them inside the field (no bubbling to the page).
  const NATIVE_CHORD = /^(z|y|a|c|v|x|arrowleft|arrowright|arrowup|arrowdown|home|end|backspace|delete|enter| )$/;
  input.addEventListener('keydown', (e) => {
    const chord = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (chord && !NATIVE_CHORD.test((e.key || '').toLowerCase())) {
      // BUG-26: page-level shortcuts (Ctrl/Cmd+S, Ctrl/Cmd+Shift+S, Ctrl/Cmd+O, ...) must still reach `document`.
      // Commit the pending source edit first so the handler's getMarkdown()/save sees the text just typed.
      // No preventDefault here: the page handler decides (and prevents the browser's own "Save page").
      commit();
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); input.value = valueOfNode(); close(true); }
    else if (e.key === 'Enter' && onKeyEnter && onKeyEnter(e)) { e.preventDefault(); close(true); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(true); }
  });

  let renderP = Promise.resolve(), settledSeq = 0;
  let saved = null;            // print: the on-screen child nodes of `box` while the light variant is shown
  let lightTimer = null;
  function render(force = false) { const p = renderNow(force); renderP = p; return p; }
  function dropPrintSwap() { saved = null; box.classList.remove('mdx-print-fallback'); }
  async function renderNow(force = false) {
    const theme = themeOf(editor);
    const key = `${theme}\0${valueOfNode()}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const seq = ++renderSeq;
    const tmp = h(inline ? 'span' : 'div');
    const res = await doRender(tmp, valueOfNode(), theme, cur);
    if (destroyed || seq !== renderSeq) return;
    dropPrintSwap();
    box.replaceChildren(...tmp.childNodes);
    dom.classList.toggle('mdx-has-error', !res.ok);
    dom.dataset.mdxRendered = res.ok ? 'ok' : 'error';
    settledSeq = seq;
    if (kind === 'mermaid' && res.ok && theme === 'dark') scheduleLight();
  }
  const isDarkMermaid = () => kind === 'mermaid' && themeOf(editor) === 'dark' && !!box.querySelector('svg') && dom.dataset.mdxRendered === 'ok';
  /** dark editor: pre-render the light variant when the browser is idle so beforeprint can swap synchronously */
  function scheduleLight() {
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => {
      lightTimer = null;
      const go = () => { if (!destroyed && isDarkMermaid()) renderMermaidSvg(valueOfNode(), 'light'); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else go();
    }, 1500);
  }

  const ctrl = {
    async whenRendered() { let p; do { p = renderP; try { await p; } catch { /* render never throws */ } } while (p !== renderP); },
    settled() { return settledSeq === renderSeq; },
    async prepareLight() { if (isDarkMermaid()) await renderMermaidSvg(valueOfNode(), 'light'); },
    printSwap() {
      if (saved || !isDarkMermaid()) return;
      const light = getCachedMermaidSvg(valueOfNode(), 'light');
      saved = [...box.childNodes];
      if (light) { box.replaceChildren(); box.innerHTML = light; } // the dark nodes stay referenced in `saved`
      else box.classList.add('mdx-print-fallback');                 // not cached: CSS invert fallback
    },
    printRestore() {
      if (saved) { box.replaceChildren(...saved); }
      saved = null; box.classList.remove('mdx-print-fallback');
    },
    flush() { if (isOpen && input.value !== valueOfNode()) commit(); },
    rerender() { render(true); },
    open() { setOpen(true, { select: inline }); },
  };
  regFor(editor).add(ctrl); ctrlOfDom.set(dom, ctrl);
  renderP = Promise.resolve().then(() => (destroyed ? undefined : render(true)));

  return {
    dom,
    update(n) {
      if (n.type !== cur.type) return false;
      cur = n;
      if (isOpen && document.activeElement !== input && input.value !== valueOfNode()) input.value = valueOfNode(); // undo/redo
      else if (!isOpen) input.value = valueOfNode();
      render();
      return true;
    },
    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
    stopEvent(e) { const t = e.target; return !!(t && (t === input || t === toggle || (t.closest && t.closest('.mdx-node-head')))); },
    ignoreMutation: () => true,
    destroy() { destroyed = true; clearTimeout(timer); clearTimeout(lightTimer); registry.get(editor)?.delete(ctrl); },
  };
}

// ------------------------------------------------------------------------------------------------ Mermaid
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^\n]*)/;
const isMermaidLang = (lang) => /^mermaid$/i.test(lang || '');
/** marked `code` token -> mermaidBlock attrs, or null when the token is not a fenced mermaid block. */
export function mermaidFromToken(token) {
  if (!token || !isMermaidLang(token.lang)) return null;
  const m = FENCE_OPEN.exec(token.raw || '');
  if (!m) return null; // indented code etc.
  return { code: token.text || '', fence: m[1], info: m[2].trim() || 'mermaid' };
}

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addKeyboardShortcuts() { return { Enter: () => enterOpens(this.editor) }; },
  addAttributes() {
    return { code: { default: '' }, fence: { default: '```' }, info: { default: 'mermaid' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-mdx-node="mermaid"]', getAttrs: (el) => ({ code: el.getAttribute('data-code') || '' }), priority: 60 }];
  },
  renderHTML({ node }) {
    // clipboard / getHTML() form only (the live editor uses the node view below)
    return ['div', { 'data-mdx-node': 'mermaid', 'data-code': node.attrs.code }, ['pre', {}, node.attrs.code]];
  },
  renderText: ({ node }) => node.attrs.code,
  addNodeView() {
    const editor = this.editor;
    return ({ node, getPos }) => makeView({
      node, editor, getPos, kind: 'mermaid', label: 'Mermaid', field: 'textarea', inline: false, attr: 'code',
      cls: 'mdx-mermaid', srcCls: 'mdx-mermaid-source', renderCls: 'mdx-mermaid-render',
      readSrc: (n) => n.attrs.code,
      commitValue: (v) => v,
      doRender: (box, code, theme) => renderMermaid(box, code, theme),
    });
  },
  // ```mermaid fences arrive as marked `code` tokens: SafeCodeBlock (extensions.js) routes them here via mermaidFromToken().
  renderMarkdown: (node) => {
    const a = node.attrs;
    const code = a.code || '';
    let longest = 2;
    for (const m of code.matchAll(/[`~]+/g)) longest = Math.max(longest, m[0].length);
    const ch = (a.fence || '`')[0] === '~' ? '~' : '`';
    const fence = ch.repeat(Math.max(3, (a.fence || '').length, longest + 1));
    return `${fence}${a.info || 'mermaid'}\n${code ? code + '\n' : ''}${fence}`;
  },
  addCommands() {
    return {
      insertMermaid: (code = MERMAID_SAMPLE) => ({ chain }) => chain()
        .insertContent([{ type: 'mermaidBlock', attrs: { code } }, { type: 'paragraph' }]).run(),
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('mdxMermaidPaste'),
      props: {
        // Pasting bare diagram text (flowchart/graph/sequenceDiagram/... on the first line, multi-line) wraps it in a
        // mermaid block. Shift+paste (plain-text paste) skips this; inside code blocks it never applies.
        handlePaste: (view, event) => {
          if (view.input && view.input.shiftKey) return false;
          const text = event.clipboardData && event.clipboardData.getData('text/plain');
          if (!text || !looksLikeMermaid(text)) return false;
          const { $from } = view.state.selection;
          if ($from.parent.type.spec.code) return false;
          const code = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').replace(/\s+$/, '');
          return this.editor.chain().insertContent([{ type: 'mermaidBlock', attrs: { code } }, { type: 'paragraph' }]).run();
        },
      },
    })];
  },
});

// ------------------------------------------------------------------------------------------------ Math (inline)
const inlineMathRule = new InputRule({
  // typing the closing $ of `$x$` converts it (same pandoc rule; the "not followed by a digit" part is checked at parse time)
  find: /(?<![\\$])\$(?![\s$])([^$\n`]*?[^\s$\\`])\$$/,
  handler: ({ state, range, match }) => {
    const type = state.schema.nodes.mathInline;
    if (!type || !matchInlineMath(match[0].slice(match[0].indexOf('$')))) return null;
    state.tr.replaceWith(range.from, range.to, type.create({ src: match[1], delim: '$' }));
    return undefined;
  },
});

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addKeyboardShortcuts() { return { Enter: () => enterOpens(this.editor) }; },
  addAttributes() { return { src: { default: '' }, delim: { default: '$' } }; },
  parseHTML() {
    return [{ tag: 'span[data-mdx-node="math-inline"]', getAttrs: (el) => ({ src: el.getAttribute('data-src') || '', delim: el.getAttribute('data-delim') || '$' }), priority: 60 }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-mdx-node': 'math-inline', 'data-src': node.attrs.src, 'data-delim': node.attrs.delim }, node.attrs.delim + node.attrs.src + node.attrs.delim];
  },
  renderText: ({ node }) => node.attrs.delim + node.attrs.src + node.attrs.delim,
  addNodeView() {
    const editor = this.editor;
    return ({ node, getPos }) => makeView({
      node, editor, getPos, kind: 'math-inline', label: 'math', field: 'input', inline: true, attr: 'src',
      cls: 'mdx-math mdx-math-inline', srcCls: 'mdx-math-source', renderCls: 'mdx-math-render',
      readSrc: (n) => n.attrs.src,
      commitValue: (v) => { const s = sanitizeInlineMath(v); return s ? s : null; },
      doRender: (box, tex) => renderMath(box, tex, false),
      onKeyEnter: () => true,
    });
  },
  markdownTokenName: 'mathInline',
  markdownTokenizer: {
    name: 'mathInline',
    level: 'inline',
    start: (src) => { // first `$` that is not backslash-escaped
      for (let i = src.indexOf('$'); i >= 0; i = src.indexOf('$', i + 1)) {
        let b = 0; while (src[i - 1 - b] === '\\') b++;
        if (b % 2 === 0) return i;
      }
      return -1;
    },
    tokenize: (src) => {
      const m = matchInlineMath(src);
      return m ? { type: 'mathInline', raw: m.raw, text: m.src, delim: m.delim } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('mathInline', { src: token.text ?? '', delim: token.delim || '$' }),
  renderMarkdown: (node) => {
    const d = node.attrs.delim === '$$' ? '$$' : '$';
    return `${d}${sanitizeInlineMath(node.attrs.src)}${d}`;
  },
  addInputRules() { return [inlineMathRule]; },
  addCommands() {
    return {
      insertMathInline: (src = 'x^2') => ({ chain }) => chain().insertContent({ type: 'mathInline', attrs: { src, delim: '$' } }).run(),
    };
  },
});

// ------------------------------------------------------------------------------------------------ Math (block)
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addKeyboardShortcuts() { return { Enter: () => enterOpens(this.editor) }; },
  addAttributes() { return { src: { default: '' } }; },
  parseHTML() {
    return [{ tag: 'div[data-mdx-node="math-block"]', getAttrs: (el) => ({ src: el.getAttribute('data-src') || '' }), priority: 60 }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-mdx-node': 'math-block', 'data-src': node.attrs.src }, `$$${node.attrs.src}$$`];
  },
  renderText: ({ node }) => `$$${node.attrs.src}$$`,
  addNodeView() {
    const editor = this.editor;
    return ({ node, getPos }) => makeView({
      node, editor, getPos, kind: 'math-block', label: 'Math', field: 'textarea', inline: false, attr: 'src',
      cls: 'mdx-math mdx-math-block', srcCls: 'mdx-math-source', renderCls: 'mdx-math-render',
      readSrc: (n) => n.attrs.src,
      commitValue: (v) => { const s = sanitizeBlockMath(v); return s.trim() ? s : null; },
      doRender: (box, tex) => renderMath(box, tex, true),
    });
  },
  markdownTokenName: 'mathBlock',
  markdownTokenizer: {
    name: 'mathBlock',
    level: 'block',
    start: (src) => blockMathStart(src),
    tokenize: (src) => {
      const m = matchBlockMath(src);
      return m ? { type: 'mathBlock', raw: m.raw, text: m.src } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode('mathBlock', { src: token.text ?? '' }),
  renderMarkdown: (node) => {
    // verbatim: `$$E=mc^2$$` and `$$\nmulti\nline\n$$` both come back byte-for-byte; blank lines survive normalizeMarkdownOutput
    return encodeRaw(`$$${sanitizeBlockMath(node.attrs.src)}$$`);
  },
  addCommands() {
    return {
      insertMathBlock: (src = 'E = mc^2') => ({ chain }) => chain()
        .insertContent([{ type: 'mathBlock', attrs: { src } }, { type: 'paragraph' }]).run(),
    };
  },
});

export { errorEl };
