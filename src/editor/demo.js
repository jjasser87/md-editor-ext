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
window.demoEditor = ed;
