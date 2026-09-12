import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyMaterials } from './update.mjs';
import { SOURCE_COMMIT, VERSION } from './guard.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const releases = path.join(root, 'releases');
const archiveName = `teaching-cpp-${VERSION}.tar.gz`;
const archivePath = path.join(releases, archiveName);
const checksumPath = archivePath + '.sha256';
const materialNames = ['README.md', 'frontend-manifest.json', 'guard.mjs', 'MATERIALS.sha256', 'package.mjs', 'source-manifest.json', 'update.mjs'];
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

const frontend = verifyMaterials().frontend;
const source = verifyMaterials().source;
assert.equal(run('git', ['rev-parse', `${SOURCE_COMMIT}^{commit}`]), SOURCE_COMMIT, '找不到已验证的前端来源提交');
run('git', ['merge-base', '--is-ancestor', SOURCE_COMMIT, 'HEAD']);
run('git', ['merge-base', '--is-ancestor', SOURCE_COMMIT, 'origin/main']);
run('git', ['diff', '--quiet', SOURCE_COMMIT, '--', 'package-lock.json', 'frontend/package.json', 'frontend/src', 'frontend/vendor']);
for (const file of source.files) run('git', ['ls-files', '--error-unmatch', file.path]);

await fs.mkdir(releases, { recursive: true });
for (const target of [archivePath, checksumPath]) {
  try { await fs.access(target); throw new Error(`同名发布材料已存在，不覆盖：${target}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const stage = await fs.mkdtemp(path.join(releases, '.frontend-update-'));
const listFile = path.join(releases, `.frontend-update-files-${randomUUID()}.txt`);

try {
  const deployRelative = `deploy/${VERSION}`;
  const entries = [];
  for (const name of materialNames) {
    const relative = `${deployRelative}/${name}`;
    const bytes = await copy(native(relative), path.join(stage, ...relative.split('/')));
    entries.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
  }
  for (const file of frontend.files) {
    const relative = `${deployRelative}/payload/${file.path}`;
    const bytes = await copy(native(`frontend/dist/${file.path}`), path.join(stage, ...relative.split('/')));
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256);
    entries.push({ path: relative, sha256: file.sha256, bytes: file.bytes });
  }
  for (const file of source.files) {
    const relative = `${deployRelative}/source/${file.path}`;
    const bytes = await copy(native(file.path), path.join(stage, ...relative.split('/')));
    assert.equal(bytes.length, file.bytes);
    assert.equal(sha256(bytes), file.sha256);
    entries.push({ path: relative, sha256: file.sha256, bytes: file.bytes });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const releaseChecksumRelative = `${deployRelative}/RELEASE-FILES.sha256`;
  const releaseChecksum = entries.map(item => `${item.sha256}  ${item.path}\n`).join('');
  await fs.writeFile(path.join(stage, ...releaseChecksumRelative.split('/')), releaseChecksum, { flag: 'wx' });
  const archiveEntries = [...entries.map(item => item.path), releaseChecksumRelative].sort();
  await fs.writeFile(listFile, archiveEntries.join('\n') + '\n', { flag: 'wx' });
  run(process.execPath, [path.join(stage, ...deployRelative.split('/'), 'update.mjs'), '--check-only'], { cwd: stage });
  run('tar', ['-czf', archivePath, '-C', stage, '-T', listFile]);
  const listed = run('tar', ['-tzf', archivePath]).split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(listed, archiveEntries, '压缩包内容与固定清单不同');
  const archive = await fs.readFile(archivePath);
  const digest = sha256(archive);
  await fs.writeFile(checksumPath, `${digest}  ${archiveName}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ archive: archivePath, checksumFile: checksumPath, bytes: archive.length, fileCount: archiveEntries.length, sha256: digest, sourceCommit: SOURCE_COMMIT, productionExecuted: false }, null, 2));
} finally {
  const realReleases = await fs.realpath(releases);
  const realStage = await fs.realpath(stage);
  if (path.dirname(realStage) !== realReleases || !path.basename(realStage).startsWith('.frontend-update-')) throw new Error('暂存目录安全检查失败，不自动删除');
  await fs.rm(realStage, { recursive: true });
  await fs.unlink(listFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
