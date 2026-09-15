import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { VERSION, verifyMaterials } from './update.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const releases = path.join(root, 'releases');
const archiveName = `teaching-cpp-${VERSION}.tar.gz`;
const archivePath = path.join(releases, archiveName);
const checksumPath = archivePath + '.sha256';
const materialNames = ['README.md', 'package.mjs', 'release-manifest.json', 'update.mjs'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const native = relative => path.join(root, ...relative.split('/'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} 检查失败：${result.stderr || result.error?.message || result.status}`);
  return result.stdout.trim();
}

async function copy(source, destination) {
  const bytes = await fs.readFile(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes, { flag: 'wx' });
  return bytes;
}

const materials = verifyMaterials();
assert.equal(materials.packaged, false);
assert.equal(run('git', ['rev-parse', 'HEAD']), materials.manifest.sourceRevision, '来源基准提交已变化');
run('git', ['diff', '--check']);
await fs.mkdir(releases, { recursive: true });
for (const target of [archivePath, checksumPath]) {
  try { await fs.access(target); throw new Error(`同名发布材料已存在，不覆盖：${target}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const stage = await fs.mkdtemp(path.join(releases, '.distribution-fix-'));
const listFile = path.join(releases, `.distribution-fix-files-${randomUUID()}.txt`);

try {
  const deployRelative = `deploy/${VERSION}`;
  const entries = [];
  for (const name of [...materialNames, 'MATERIALS.sha256']) {
    const relative = `${deployRelative}/${name}`;
    const bytes = await copy(native(relative), path.join(stage, ...relative.split('/')));
    entries.push({ path: relative, sha256: sha256(bytes) });
  }
  const payloadRelative = `${deployRelative}/payload/${materials.manifest.applicationFile.path}`;
  const payload = await copy(native(materials.manifest.applicationFile.path), path.join(stage, ...payloadRelative.split('/')));
  assert.equal(payload.length, materials.manifest.applicationFile.bytes);
  assert.equal(sha256(payload), materials.manifest.applicationFile.sha256);
  entries.push({ path: payloadRelative, sha256: sha256(payload) });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const releaseChecksumRelative = `${deployRelative}/RELEASE-FILES.sha256`;
  await fs.writeFile(path.join(stage, ...releaseChecksumRelative.split('/')), entries.map(item => `${item.sha256}  ${item.path}\n`).join(''), { flag: 'wx' });
  const archiveEntries = [...entries.map(item => item.path), releaseChecksumRelative].sort();
  await fs.writeFile(listFile, archiveEntries.join('\n') + '\n', { flag: 'wx' });
  run(process.execPath, [path.join(stage, ...deployRelative.split('/'), 'update.mjs'), '--check-only'], { cwd: stage });
  run('tar', ['-czf', archivePath, '-C', stage, '-T', listFile]);
  assert.deepEqual(run('tar', ['-tzf', archivePath]).split(/\r?\n/).filter(Boolean).sort(), archiveEntries);
  const archive = await fs.readFile(archivePath);
  const digest = sha256(archive);
  await fs.writeFile(checksumPath, `${digest}  ${archiveName}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ archive: archivePath, checksumFile: checksumPath, bytes: archive.length, fileCount: archiveEntries.length, sha256: digest, productionExecuted: false }, null, 2));
} finally {
  const realReleases = await fs.realpath(releases);
  const realStage = await fs.realpath(stage);
  if (path.dirname(realStage) !== realReleases || !path.basename(realStage).startsWith('.distribution-fix-')) throw new Error('暂存目录安全检查失败，不自动删除');
  await fs.rm(realStage, { recursive: true });
  await fs.unlink(listFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
