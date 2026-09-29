import { insertNodeAndOpen, MERMAID_SAMPLE } from './mermaid-math.js';
// Toolbar for the editor. Pure DOM, no innerHTML with dynamic content, no inline handlers (CSP-safe).
const ICONS = {
  bold: 'B', italic: 'I', strike: 'S', code: '</>', codeBlock: '{ }', bullet: '• List', ordered: '1. List',
  task: '☑ Tasks', quote: '❝', link: 'Link', image: 'Image', table: 'Table', hr: '―',
  diagram: 'Diagram', mathInline: '∑ Math', mathBlock: '∑ Block',
  undo: '↶', redo: '↷', source: 'Markdown',
  addRow: '+Row', delRow: '−Row', addCol: '+Col', delCol: '−Col', delTable: '✕Tbl',
};

export function createToolbar(editor, { onToggleSource, isSourceMode }) {
  const bar = document.createElement('div');
  bar.className = 'mdx-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formatting');

  const buttons = []; // { el, isActive?, canRun? }

  const sep = () => { const s = document.createElement('span'); s.className = 'mdx-sep'; bar.appendChild(s); };
  function btn({ key, title, run, active, can, cls = '', keep = false, label }) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'mdx-btn ' + cls;
    el.textContent = label || ICONS[key] || key;
    el.title = title;
    el.setAttribute('aria-label', title);
    el.dataset.cmd = key;
    if (keep) el.dataset.keep = '1';
    // keep editor selection when clicking toolbar
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => { run(); });
    bar.appendChild(el);
    buttons.push({ el, active, can });
    return el;
  }
  const chain = () => editor.chain().focus();

  // --- block type select ---
  const sel = document.createElement('select');
  sel.className = 'mdx-btn mdx-select';
  sel.title = 'Block type'; sel.setAttribute('aria-label', 'Block type'); sel.dataset.cmd = 'block';
  for (const [v, t] of [['p', 'Paragraph'], ['1', 'Heading 1'], ['2', 'Heading 2'], ['3', 'Heading 3']]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === 'p') chain().setParagraph().run(); else chain().setHeading({ level: Number(v) }).run();
  });
  bar.appendChild(sel);
  sep();

  btn({ key: 'undo', title: 'Undo (Ctrl+Z)', run: () => chain().undo().run(), can: () => editor.can().undo() });
  btn({ key: 'redo', title: 'Redo (Ctrl+Shift+Z)', run: () => chain().redo().run(), can: () => editor.can().redo() });
  sep();
  btn({ key: 'bold', title: 'Bold (Ctrl+B)', run: () => chain().toggleBold().run(), active: () => editor.isActive('bold') });
  btn({ key: 'italic', title: 'Italic (Ctrl+I)', cls: 'mdx-i', run: () => chain().toggleItalic().run(), active: () => editor.isActive('italic') });
  btn({ key: 'strike', title: 'Strikethrough', cls: 'mdx-s', run: () => chain().toggleStrike().run(), active: () => editor.isActive('strike') });
  btn({ key: 'code', title: 'Inline code', cls: 'mdx-mono', run: () => chain().toggleCode().run(), active: () => editor.isActive('code') });
  btn({ key: 'codeBlock', title: 'Code block', cls: 'mdx-mono', run: () => chain().toggleCodeBlock().run(), active: () => editor.isActive('codeBlock') });
  sep();
  btn({ key: 'bullet', title: 'Bullet list', run: () => chain().toggleBulletList().run(), active: () => editor.isActive('bulletList') });
  btn({ key: 'ordered', title: 'Numbered list', run: () => chain().toggleOrderedList().run(), active: () => editor.isActive('orderedList') });
  btn({ key: 'task', title: 'Task list', run: () => chain().toggleTaskList().run(), active: () => editor.isActive('taskList') });
  btn({ key: 'quote', title: 'Blockquote', run: () => chain().toggleBlockquote().run(), active: () => editor.isActive('blockquote') });
  btn({ key: 'hr', title: 'Horizontal rule', run: () => chain().setHorizontalRule().run() });
  sep();

  // --- popover with a single URL input (link / image) ---
  const pop = document.createElement('form');
  pop.className = 'mdx-popover'; pop.hidden = true;
  const lab = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'text'; input.autocomplete = 'off'; input.spellcheck = false;
  const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'mdx-primary'; ok.textContent = 'OK';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
  pop.append(lab, input, ok, remove, cancel);
  let popMode = null;

  function openPop(mode) {
    popMode = mode;
    if (mode === 'link') {
      lab.textContent = 'Link URL';
      input.placeholder = 'https://…';
      input.value = editor.getAttributes('link').href || '';
      remove.hidden = !editor.isActive('link');
    } else {
      lab.textContent = 'Image URL';
      input.placeholder = 'https://…/image.png';
      input.value = '';
      remove.hidden = true;
    }
    pop.hidden = false;
    input.focus(); input.select();
  }
  function closePop(refocus = true) {
    pop.hidden = true; popMode = null;
    if (refocus) editor.commands.focus();
  }
  const safeUrl = (u) => {
    u = u.trim();
    if (!u) return '';
    if (/^\s*(javascript|vbscript|data:text\/html)/i.test(u)) return '';
    return u;
  };
  pop.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = safeUrl(input.value);
    const mode = popMode;
    closePop();
    if (mode === 'link') {
      if (!url) chain().extendMarkRange('link').unsetLink().run();
      else if (editor.state.selection.empty && !editor.isActive('link')) {
        chain().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
      } else chain().extendMarkRange('link').setLink({ href: url }).run();
    } else if (mode === 'image' && url) {
      chain().setImage({ src: url, alt: '' }).run();
    }
  });
  remove.addEventListener('click', () => { closePop(); chain().extendMarkRange('link').unsetLink().run(); });
  cancel.addEventListener('click', () => closePop());
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } });

  btn({ key: 'link', title: 'Link (Ctrl+K)', run: () => openPop('link'), active: () => editor.isActive('link') });
  btn({ key: 'image', title: 'Insert image by URL', run: () => openPop('image') });
  sep();
  btn({ key: 'diagram', title: 'Insert Mermaid diagram', run: () => insertNodeAndOpen(editor, 'mermaidBlock', { code: MERMAID_SAMPLE }, { block: true }), can: () => editor.can().insertContent({ type: 'mermaidBlock' }) });
  btn({ key: 'mathInline', title: 'Insert inline math ($…$)', run: () => {
    const { from, to, empty } = editor.state.selection;
    const sel = empty ? '' : editor.state.doc.textBetween(from, to, ' ').trim();
    insertNodeAndOpen(editor, 'mathInline', { src: sel && !/[$\n]/.test(sel) ? sel : 'x^2', delim: '$' }, { block: false });
  } });
  btn({ key: 'mathBlock', title: 'Insert block math ($$…$$)', run: () => insertNodeAndOpen(editor, 'mathBlock', { src: 'E = mc^2' }, { block: true }) });
  sep();
  btn({ key: 'table', title: 'Insert table (3×3)', run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), can: () => editor.can().insertTable() });
  const inTable = () => editor.isActive('table');
  btn({ key: 'addRow', title: 'Add row below', run: () => chain().addRowAfter().run(), can: inTable });
  btn({ key: 'delRow', title: 'Delete row', run: () => chain().deleteRow().run(), can: inTable });
  btn({ key: 'addCol', title: 'Add column right', run: () => chain().addColumnAfter().run(), can: inTable });
  btn({ key: 'delCol', title: 'Delete column', run: () => chain().deleteColumn().run(), can: inTable });
  btn({ key: 'delTable', title: 'Delete table', run: () => chain().deleteTable().run(), can: inTable });

  const spacer = document.createElement('span'); spacer.className = 'mdx-spacer'; bar.appendChild(spacer);
  const srcBtn = btn({ key: 'source', title: 'Toggle Markdown source', keep: true, run: () => onToggleSource() });
  srcBtn.setAttribute('aria-pressed', 'false');
  bar.appendChild(pop);

  function refresh() {
    const src = isSourceMode();
    for (const b of buttons) {
      if (b.el === srcBtn) continue;
      const on = !src && b.active ? !!b.active() : false;
      b.el.classList.toggle('is-active', on);
      b.el.setAttribute('aria-pressed', String(on));
      b.el.disabled = src || (b.can ? !b.can() : false);
    }
    srcBtn.classList.toggle('is-active', src);
    srcBtn.setAttribute('aria-pressed', String(src));
    sel.disabled = src;
    if (!src) sel.value = editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2'
      : editor.isActive('heading', { level: 3 }) ? '3' : 'p';
  }
  editor.on('transaction', refresh);
  editor.on('selectionUpdate', refresh);
  refresh();

  return {
    el: bar,
    refresh,
    openLink: () => openPop('link'),
    destroy() { editor.off('transaction', refresh); editor.off('selectionUpdate', refresh); bar.remove(); },
  };
}
