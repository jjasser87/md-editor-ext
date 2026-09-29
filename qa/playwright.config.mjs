import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
});
