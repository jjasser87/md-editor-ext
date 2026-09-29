// Standalone demo:  npx vite --config src/drive-ui/vite.demo.config.js         (dev server)
//                   npx vite build --config src/drive-ui/vite.demo.config.js   (-> /tmp/md-drive-ui-demo)
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname);
export default defineConfig({
  root, base: './',
  build: { outDir: '/tmp/md-drive-ui-demo', emptyOutDir: true, modulePreload: { polyfill: false }, rollupOptions: { input: resolve(root, 'demo.html') } },
});
