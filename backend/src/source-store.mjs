import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { id } from './validation.mjs';
import { AppError } from './errors.mjs';

export class SourceStore {
  constructor(root, minFreeBytes = 0) { this.root = path.resolve(root); this.minFreeBytes = minFreeBytes; }
  file(revision) { return path.join(this.root, `${id(revision)}.json`); }
  async init() { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); }
  async write(revision, value) {
    await this.init();
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > 512 * 1024) throw new AppError(413, 'SNAPSHOT_TOO_LARGE', '转义后的代码和输入合计超过 512KB，请减少内容');
    const stat = await fs.statfs(this.root);
    if (stat.bavail * stat.bsize < this.minFreeBytes + Buffer.byteLength(data)) throw new AppError(507, 'STORAGE_FULL', '存储空间不足，代码未保存，运行未提交');
    const target = this.file(revision);
    const handle = await fs.open(target, 'wx', 0o600);
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    catch (error) { await handle.close(); await fs.unlink(target).catch(() => {}); throw error; }
    await handle.close();
    if (process.platform === 'linux') {
      const directory = await fs.open(this.root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    return Buffer.byteLength(data);
  }
  async read(revision) {
    const handle = await fs.open(this.file(revision), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 512 * 1024) throw new Error('Invalid source snapshot');
      return JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  }
  async remove(revision) { await fs.unlink(this.file(revision)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  async removeOrphans(known, ageMs) {
    const now = Date.now();
    for (const name of await fs.readdir(this.root)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name) || known.has(name.slice(0, -5))) continue;
      const stat = await fs.lstat(path.join(this.root, name));
      if (now - stat.mtimeMs > ageMs) await fs.unlink(path.join(this.root, name));
    }
  }
}
