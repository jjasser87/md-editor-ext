// Public API: createEditor(containerEl, { markdown, onChange, theme }) -> editor handle.
import { Editor } from '@tiptap/core';
import { getExtensions, normalizeMarkdownOutput } from './extensions.js';
import { detectWarnings } from './markdown-fixes.js';
import { createToolbar } from './toolbar.js';
import './editor.css';

const DEBOUNCE_MS = 250;

export function createEditor(containerEl, { markdown = '', onChange, onWarnings, theme = 'light' } = {}) {
  if (!containerEl) throw new Error('createEditor: container element required');

  const root = document.createElement('div');
  root.className = 'mdx-root';
  root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  const body = document.createElement('div'); body.className = 'mdx-body';
  const wys = document.createElement('div'); wys.className = 'mdx-wysiwyg';
  const src = document.createElement('textarea');
  src.className = 'mdx-source'; src.hidden = true; src.spellcheck = false;
  src.setAttribute('aria-label', 'Markdown source');
  body.append(wys, src);
  containerEl.appendChild(root);

  let sourceMode = false;
  let silent = false;       // true while applying programmatic content
  let timer = null;
  let destroyed = false;

  const wysMarkdown = () => normalizeMarkdownOutput(editor.getMarkdown());
  const getMarkdown = () => (sourceMode ? src.value : wysMarkdown());

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (!destroyed && onChange) onChange(getMarkdown()); }, DEBOUNCE_MS);
  }
  let warnings = [];
  function loadIntoEditor(md) {
    silent = true;
    try { editor.commands.setContent(md || '', { contentType: 'markdown', emitUpdate: false }); }
    finally { silent = false; }
    try { warnings = detectWarnings(editor.markdown, md || ''); } catch { warnings = []; }
    if (onWarnings) { try { onWarnings(warnings.slice()); } catch { /* host callback errors must not break loading */ } }
  }

  const editor = new Editor({
    element: wys,
    extensions: getExtensions(),
    content: '',
    contentType: 'markdown',
    onUpdate: () => { if (!silent) schedule(); },
  });

  const toolbar = createToolbar(editor, { onToggleSource: () => setSourceMode(!sourceMode), isSourceMode: () => sourceMode });
  root.append(toolbar.el, body);
  loadIntoEditor(markdown);

  src.addEventListener('input', () => schedule());
  src.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { // insert 2 spaces instead of leaving the textarea
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = src;
      src.setRangeText('  ', s, en, 'end');
      schedule();
    }
  });
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k' && !sourceMode) {
      e.preventDefault(); toolbar.openLink();
    }
  };
  wys.addEventListener('keydown', onKey);

  function setMarkdown(md) {
    md = md == null ? '' : String(md);
    if (sourceMode) src.value = md; // WYSIWYG reloaded when leaving source mode
    else loadIntoEditor(md);
    if (sourceMode) loadIntoEditor(md); // keep both in sync
    clearTimeout(timer); timer = null; // programmatic change: no onChange
  }
  function setSourceMode(on) {
    on = !!on;
    if (on === sourceMode) return;
    if (on) {
      src.value = wysMarkdown();
      sourceMode = true;
      wys.hidden = true; src.hidden = false;
      root.classList.add('mdx-source-mode');
      src.focus();
    } else {
      const text = src.value;
      // Only rebuild the doc if the text was actually edited, to avoid gratuitous normalization.
      if (text !== wysMarkdown()) loadIntoEditor(text);
      sourceMode = false;
      src.hidden = true; wys.hidden = false;
      root.classList.remove('mdx-source-mode');
      editor.commands.focus();
    }
    toolbar.refresh();
  }

  return {
    getMarkdown,
    setMarkdown,
    /** Non-blocking notices about constructs of the last loaded document that are NOT preserved verbatim: [{code, message}]. */
    getWarnings: () => warnings.slice(),
    setTheme(t) { root.dataset.theme = t === 'dark' ? 'dark' : 'light'; },
    focus() { sourceMode ? src.focus() : editor.commands.focus(); },
    setSourceMode,
    isSourceMode: () => sourceMode,
    destroy() {
      destroyed = true; clearTimeout(timer);
      toolbar.destroy(); editor.destroy(); root.remove();
    },
    // escape hatch (tests/debugging)
    get tiptap() { return editor; },
  };
}
