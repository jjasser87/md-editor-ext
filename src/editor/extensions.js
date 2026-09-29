// Shared TipTap extension set (used by the browser editor AND the node round-trip test).
import StarterKit from '@tiptap/starter-kit';
import { MarkdownFixed, SafeLink, RawBlock, RawInline, RawHtmlBlockParser, restoreRaw } from './markdown-fixes.js';
import { TableKit, Table, renderTableToMarkdown } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { MermaidBlock, MathInline, MathBlock, mermaidFromToken } from './mermaid-math.js';

export const lowlight = createLowlight(common);

// --- Fixes for @tiptap/markdown serializer edge cases -------------------------------------------
// 1) Fenced code: use a fence longer than any backtick run inside the code (else ``` in code breaks the doc).
const SafeCodeBlock = CodeBlockLowlight.extend({
  // fenced ```mermaid blocks become mermaidBlock nodes (verbatim source + original fence); everything else is a normal code block
  parseMarkdown: (token, h) => {
    const mm = mermaidFromToken(token);
    if (mm) return h.createNode('mermaidBlock', mm);
    if (token.raw && !token.raw.startsWith('```') && !token.raw.startsWith('~~~') && token.codeBlockStyle !== 'indented') return [];
    return h.createNode('codeBlock', { language: token.lang || null }, token.text ? [h.createTextNode(token.text)] : []);
  },
  renderMarkdown: (node, h) => {
    const lang = (node.attrs && node.attrs.language) || '';
    const body = node.content ? h.renderChildren(node.content) : '';
    let longest = 2;
    for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
    const fence = '`'.repeat(longest + 1);
    return `${fence}${lang}\n${body}\n${fence}`;
  },
});

// 2) Tables: literal `|` inside a cell must be written as `\|` or the row gains an extra column.
const SafeTable = Table.extend({
  renderMarkdown: (node, h) =>
    renderTableToMarkdown(node, {
      ...h,
      renderChildren: (...a) => h.renderChildren(...a).replace(/\\?\|/g, '\\|'),
    }),
});

/**
 * Cosmetic cleanup of serializer output: collapse runs of blank lines to one (outside fenced code),
 * strip trailing spaces except hard breaks (2+ spaces before newline are kept), single trailing newline.
 */
export function normalizeMarkdownOutput(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let fence = null;
  for (const line of lines) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { out.push(line); if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^\s*[`~]+\s*$/.test(line)) fence = null; continue; }
    if (m) { fence = m[1]; out.push(line); continue; }
    if (line.trim() === '') { if (out.length && out[out.length - 1] === '') continue; out.push(''); continue; }
    out.push(line);
  }
  while (out.length && out[0].trim() === '') out.shift();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.length ? restoreRaw(out.join('\n')) + '\n' : '';
}

export function getExtensions({ placeholder = 'Start writing…', withPlaceholder = true } = {}) {
  const exts = [
    StarterKit.configure({
      codeBlock: false, // replaced by CodeBlockLowlight
      underline: false, // no markdown representation -> would not round-trip
      link: false, // replaced by SafeLink (remembers <autolink>/bare-URL form for the serializer)
    }),
    SafeLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    SafeCodeBlock.configure({ lowlight, defaultLanguage: null }),
    TableKit.configure({ table: false }),
    SafeTable.configure({ resizable: false }),
    TaskList,
    TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
    Image.configure({ inline: false, allowBase64: true }),
    MermaidBlock, MathInline, MathBlock,
    RawBlock, RawInline, RawHtmlBlockParser, // verbatim raw HTML / footnotes / front matter (read-only chips)
    MarkdownFixed.configure({ markedOptions: { gfm: true, breaks: false } }),
  ];
  if (withPlaceholder) exts.push(Placeholder.configure({ placeholder }));
  return exts;
}
