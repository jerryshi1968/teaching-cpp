import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
async function check(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.npm-cache', 'storage', 'runner-data', '.git'].includes(item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await check(file);
    else if (item.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
await check(root);
console.log('JavaScript 语法检查通过；JSX 由 npm run build 检查。');
