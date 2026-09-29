import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, 'dist/md-editor-ext.zip');
if (existsSync(out)) rmSync(out);
execSync(`python3 -c "import shutil,sys;shutil.make_archive(sys.argv[1][:-4],'zip',sys.argv[2])" "${out}" "${resolve(root, 'extension')}"`, { stdio: 'inherit' });
console.log('wrote', out);
