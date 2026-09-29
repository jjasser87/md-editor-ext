import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// mermaid's lodash dependency uses Function("return this")(), which needs eval-like CSP permission and trips the no-eval scan; globalThis is equivalent in a module.
const noFunctionThis = { name: 'no-function-return-this', renderChunk(code) {
  const re = /Function\((["'])return this\1\)\(\)/g;
  return re.test(code) ? { code: code.replace(re, 'globalThis'), map: null } : null; } };

// Bundles src/page (editor page) + src/editor (TipTap) into extension/editor/.
// Static files (manifest.json, background.js, content.js, icons/) live in extension/ untouched.
export default defineConfig({
  root: resolve(__dirname, 'src/page'),
  base: './',
  publicDir: false,
  plugins: [noFunctionThis],
  build: {
    outDir: resolve(__dirname, 'extension/editor'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    modulePreload: { polyfill: false }, // no inline polyfill -> MV3 CSP safe
    rollupOptions: { input: resolve(__dirname, 'src/page/index.html') },
  },
});
