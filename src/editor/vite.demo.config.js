// Standalone demo build/dev:  npx vite --config src/editor/vite.demo.config.js   (dev server)
//                             npx vite build --config src/editor/vite.demo.config.js  (-> /tmp/md-editor-demo)
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname);
export default defineConfig({
  root, base: './',
  build: { outDir: '/tmp/md-editor-demo', emptyOutDir: true, modulePreload: { polyfill: false }, rollupOptions: { input: resolve(root, 'demo.html') } },
});
