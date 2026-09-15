import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { id, snapshot } from './validation.mjs';
import { MAX_SNAPSHOT_BYTES } from '../../shared/contracts.mjs';
import { AppError } from './errors.mjs';

export class SourceStore {
  constructor(root, minFreeBytes = 0) { this.root = path.resolve(root); this.minFreeBytes = minFreeBytes; }
  file(revision) { return path.join(this.root, `${id(revision)}.json`); }
  marker(revision) { return path.join(this.root, '.gc', `${id(revision)}.delete`); }
  async init() { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); await fs.mkdir(path.join(this.root, '.gc'), { recursive: true, mode: 0o700 }); }
  async write(revision, value) {
    await this.init();
    const data = JSON.stringify(snapshot(value));
    if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) throw new AppError(413, 'SNAPSHOT_TOO_LARGE', '项目快照超过 1MB，请减少文件或输入内容');
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
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SNAPSHOT_BYTES) throw new Error('Invalid source snapshot');
      return snapshot(JSON.parse(await handle.readFile('utf8')));
    } finally { await handle.close(); }
  }
  async remove(revision) {
    await this.init();
    const marker = this.marker(revision);
    await fs.writeFile(marker, '', { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await fs.unlink(this.file(revision)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(marker).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  async removeEventually(revision) { try { await this.remove(revision); return true; } catch { return false; } }
  async retryPending() {
    await this.init();
    for (const name of await fs.readdir(path.join(this.root, '.gc'))) {
      if (!/^[0-9a-f-]{36}\.delete$/.test(name)) continue;
      await this.removeEventually(name.slice(0, -7));
    }
  }
  async removeOrphans(known, ageMs) {
    const now = Date.now();
    for (const name of await fs.readdir(this.root)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name) || known.has(name.slice(0, -5))) continue;
      const stat = await fs.lstat(path.join(this.root, name));
      if (now - stat.mtimeMs > ageMs) await fs.unlink(path.join(this.root, name));
    }
  }
}
