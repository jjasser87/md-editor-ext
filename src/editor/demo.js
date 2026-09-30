// Standalone demo: `npx vite src/editor` (dev server) or `npx vite build --config ...` — no extension APIs used.
import { createEditor } from './index.js';

const SAMPLE = `# Demo

Some **bold**, *italic*, ~~strike~~ and \`code\` with a [link](https://example.com).

- [x] task done
- [ ] task todo
  - nested

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`js
console.log('hi');
\`\`\`

> quote

---

## Diagrams and math

\`\`\`mermaid
flowchart LR
    A[Write] --> B{Render?}
    B -->|Yes| C[SVG]
    B -->|No| A
\`\`\`

Inline $e^{i\\pi} + 1 = 0$ next to a price of $5 and $10.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`;
const $ = (id) => document.getElementById(id);
let theme = 'light';
const ed = createEditor($('host'), {
  markdown: localStorage.getItem('demo-md') ?? SAMPLE,
  theme,
  onChange: (md) => { localStorage.setItem('demo-md', md); $('stat').textContent = `changed ${new Date().toLocaleTimeString()} (${md.length} chars)`; },
});
$('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; ed.setTheme(theme); document.body.style.colorScheme = theme; };
$('dump').onclick = () => console.log(ed.getMarkdown());
$('print').onclick = async () => { await ed.prepareForPrint(); window.print(); }; // same call order as the extension's Print button
$('plinks').onchange = (e) => ed.setPrintLinks(e.target.checked);
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); $('print').click(); } });
window.demoEditor = ed;
