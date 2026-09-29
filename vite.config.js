import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Bundles src/page (editor page) + src/editor (TipTap) into extension/editor/.
// Static files (manifest.json, background.js, content.js, icons/) live in extension/ untouched.
export default defineConfig({
  root: resolve(__dirname, 'src/page'),
  base: './',
  publicDir: false,
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
