// npm run set-client-id -- 1234-abc.apps.googleusercontent.com
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const id = process.argv[2];
if (!id || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) { console.error('Usage: npm run set-client-id -- <CLIENT_ID>.apps.googleusercontent.com'); process.exit(1); }
const p = resolve(import.meta.dirname, '../extension/manifest.json');
const m = JSON.parse(readFileSync(p, 'utf8'));
m.oauth2 = { ...(m.oauth2 || {}), client_id: id, scopes: ['https://www.googleapis.com/auth/drive'] };
writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
console.log('client_id set in extension/manifest.json');
