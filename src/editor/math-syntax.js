// Pure (DOM-free, KaTeX-free) math delimiter rules shared by the markdown tokenizers (math.js) and the text escaper
// (markdown-fixes.js). Pandoc-like `$` rule:
//   * opening `$` must not be followed by whitespace (nor by another `$`),
//   * closing `$` must not be preceded by whitespace and must not be followed by a digit,
//   * `\$` is a literal dollar (handled by the markdown escape rule before these tokenizers ever see it),
//   * inline math never spans a line break and never contains a backtick (so it cannot swallow a code span).
// `$$...$$` inline works the same (no whitespace after the opening / before the closing `$$`).

/** Inline `$$x$$` (display delimiter written inside a paragraph). */
const INLINE_DD = /^\$\$(?!\s)((?:\\.|[^$\\\n`])+?)(?<!\s)\$\$/;
/** Inline `$x$`. */
const INLINE_D = /^\$(?![\s$])((?:\\.|[^$\\\n`])+?)(?<!\s)\$(?!\d)/;

/** Try to match inline math at the START of `src`. -> { raw, src, delim } | null. */
export function matchInlineMath(src) {
  if (src.charCodeAt(0) !== 36) return null;
  const m = INLINE_DD.exec(src) || INLINE_D.exec(src);
  if (!m) return null;
  return { raw: m[0], src: m[1], delim: m[0].startsWith('$$') ? '$$' : '$' };
}

/** Block math: `$$` at line start (<=3 spaces), inner text up to the FIRST `$$`, which must end its line. -> { raw, src } | null. */
const BLOCK = /^ {0,3}\$\$((?:(?!\$\$)[\s\S])+?)\$\$[ \t]*(?:\n|$)/;
export function matchBlockMath(src) {
  const m = BLOCK.exec(src);
  if (!m || !m[1].trim()) return null;
  return { raw: m[0], src: m[1] };
}

/** Index of the first line start in `src` where block math begins, or -1 (used by marked to interrupt paragraphs). */
export function blockMathStart(src) {
  let i = 0;
  while (i <= src.length) {
    if (/^ {0,3}\$\$/.test(src.slice(i, i + 5)) && matchBlockMath(src.slice(i))) return i;
    const nl = src.indexOf('\n', i);
    if (nl < 0) return -1;
    i = nl + 1;
  }
  return -1;
}

/**
 * Indices of `$` characters in a plain TEXT node that would be read as math delimiters if written unescaped.
 * The serializer writes those as `\$` so literal text `\$x\$` survives a round trip and typed "$a$" text stays text.
 */
export function mathDelimiterIndexes(text) {
  const out = new Set();
  for (let i = text.indexOf('$'); i >= 0 && i < text.length; i = text.indexOf('$', i + 1)) {
    const m = matchInlineMath(text.slice(i));
    if (!m) continue;
    const d = m.delim.length;
    for (let k = 0; k < d; k++) { out.add(i + k); out.add(i + m.raw.length - 1 - k); }
    i += m.raw.length - 1;
  }
  return out;
}

/** Make text safe to sit between inline delimiters: single line, no bare `$`, no edge whitespace / trailing backslash. */
export function sanitizeInlineMath(text) {
  let s = String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();
  s = s.replace(/\\[\s\S]|\$/g, (m) => (m === '$' ? '\\$' : m)); // bare $ -> \$ (escapes stay)
  s = s.replace(/(^|[^\\])((?:\\\\)*)\\$/, '$1$2');               // drop one dangling trailing backslash
  return s.trim();
}

/** Block math source can be anything except an (unescaped) `$$`. */
export function sanitizeBlockMath(text) {
  return String(text ?? '').replace(/\$\$/g, '$\\$');
}

/** Mermaid diagram keywords (first non-blank line) for paste detection. */
const MERMAID_FIRST = /^\s*(?:(?:flowchart|graph)[ \t]+(?:TB|TD|BT|RL|LR)\b|(?:sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|gitGraph|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|quadrantChart|mindmap|timeline|gantt|journey|kanban)[ \t]*(?:\n|$)|pie[ \t]+(?:showData|title\b)|pie[ \t]*\n)/;
export function looksLikeMermaid(text) {
  const t = String(text ?? '').replace(/^\uFEFF/, '');
  if (!/\n/.test(t.trim())) return false; // single-line (collapsed) paste is NOT wrapped: Mermaid needs line breaks
  const first = t.replace(/^(?:\s*%%[^\n]*\n)+/, ''); // leading %% comments / directives
  return MERMAID_FIRST.test(first);
}
