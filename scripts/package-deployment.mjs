import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// 只复制明确允许的应用目录，禁止把本机依赖、密钥、演示数据或历史备份带到服务器。
const root = path.resolve(import.meta.dirname, '..');
const releases = path.join(root, 'releases');
const releaseName = process.argv[2] || `teaching-cpp-predeploy-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
if (!/^teaching-cpp-predeploy-[A-Za-z0-9-]+$/.test(releaseName)) throw new Error('部署包名称不合法');
const archiveName = `${releaseName}.tar.gz`;
const archivePath = path.join(releases, archiveName);
const roots = ['backend', 'shared', 'runner', 'frontend', 'scripts', 'deploy', 'docs', 'tests', 'compat'];
const ignored = new Set(['node_modules', '.git', '.npm-cache', 'storage', 'runner-data', 'backups', 'tools', 'runtime', 'logs', 'coverage']);
const extensions = /\.(mjs|js|jsx|css|html|json|md|sql|sh|service|example|tgz|sha256)$/;
const files = ['package.json', 'package-lock.json', 'README.md'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function collect(relative) {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`部署包不接受符号链接：${name}`);
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile() && (extensions.test(entry.name) || entry.name === 'Containerfile')) files.push(name);
  }
}

for (const relative of roots) await collect(relative);
for (const required of ['backend/migrations/002_cpp_multifile.sql', 'backend/src/migrate.mjs', 'frontend/dist/index.html', 'frontend/src/project-source.mjs', 'frontend/src/multifile.css', 'runner/src/podman.mjs', 'shared/contracts.mjs', 'deploy/prepare-first-install.sh', 'deploy/production.env.example']) {
  if (!files.includes(required)) throw new Error(`部署包缺少 ${required}；请先构建前端`);
}
if (!files.some(name => /^frontend\/dist\/assets\//.test(name))) throw new Error('没有前端构建资源');
files.sort();
await fs.mkdir(releases, { recursive: true });
try { await fs.access(archivePath); throw new Error('同名部署包已存在；请使用新名称，不覆盖已有交付物'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const stage = await fs.mkdtemp(path.join(releases, '.build-'));
const fileList = path.join(releases, `.files-${randomUUID()}.txt`);

try {
  const entries = [];
  for (const relative of files) {
    if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split('/').includes('..')) throw new Error(`不支持的打包路径：${relative}`);
    const source = path.join(root, relative);
    const realSource = await fs.realpath(source);
    const fromRoot = path.relative(await fs.realpath(root), realSource);
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) throw new Error(`文件越出项目目录：${relative}`);
    const bytes = await fs.readFile(source);
    if (relative.endsWith('.sh') && bytes.includes(13)) throw new Error(`Linux 脚本必须使用 LF 换行：${relative}`);
    const destination = path.join(stage, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    entries.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false });
  if (revision.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(revision.stdout)) throw new Error('无法读取来源基准提交');
  const worktree = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', shell: false });
  if (worktree.status !== 0) throw new Error('无法读取来源工作树状态');
  const manifest = {
    kind: 'multifile-release-candidate', release: releaseName, createdAt: new Date().toISOString(),
    sourceRevision: revision.stdout.trim(), sourceState: worktree.stdout.trim() ? 'working-tree' : 'committed',
    productionExecuted: false, databaseConnected: false, servicesStarted: false, deploymentDirectoryModified: false,
    snapshotSchemaVersion: 2,
    note: '离线交付候选包；已固定完整多文件源码、迁移、Runner、前端构建与测试材料。未读取或修改生产环境，上线前仍须根据服务器实际基线生成只读预检与发布脚本。',
    files: entries
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(stage, 'deployment-manifest.json'), manifestBytes);
  entries.push({ path: 'deployment-manifest.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes) });
  await fs.writeFile(path.join(stage, 'DEPLOYMENT-FILES.sha256'), entries.map(item => `${item.sha256}  ${item.path}\n`).join(''));
  const archiveFiles = [...entries.map(item => item.path), 'DEPLOYMENT-FILES.sha256'];
  await fs.writeFile(fileList, `${archiveFiles.join('\n')}\n`);
  const packed = spawnSync('tar', ['-czf', archivePath, '-C', stage, '-T', fileList], { encoding: 'utf8', shell: false });
  if (packed.status !== 0) throw new Error(`打包失败：${packed.stderr || packed.error?.message || packed.status}`);
  const listed = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8', shell: false });
  if (listed.status !== 0) throw new Error(`压缩包检查失败：${listed.stderr}`);
  const actual = listed.stdout.split(/\r?\n/).filter(Boolean).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...archiveFiles].sort())) throw new Error('压缩包内容与允许列表不一致');
  const verifyStage = await fs.mkdtemp(path.join(releases, '.verify-'));
  try {
    const extracted = spawnSync('tar', ['-xzf', archivePath, '-C', verifyStage], { encoding: 'utf8', shell: false });
    if (extracted.status !== 0) throw new Error(`压缩包离线解包失败：${extracted.stderr || extracted.error?.message || extracted.status}`);
    for (const entry of entries) {
      const target = path.join(verifyStage, ...entry.path.split('/'));
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes) throw new Error(`压缩包文件类型或大小不符：${entry.path}`);
      if (sha256(await fs.readFile(target)) !== entry.sha256) throw new Error(`压缩包文件摘要不符：${entry.path}`);
    }
    const checksumBytes = await fs.readFile(path.join(verifyStage, 'DEPLOYMENT-FILES.sha256'), 'utf8');
    if (checksumBytes !== entries.map(item => `${item.sha256}  ${item.path}\n`).join('')) throw new Error('压缩包内部校验清单不符');
  } finally {
    const realReleases = await fs.realpath(releases);
    const realVerifyStage = await fs.realpath(verifyStage);
    if (path.dirname(realVerifyStage) !== realReleases || !path.basename(realVerifyStage).startsWith('.verify-')) throw new Error('校验目录安全检查失败，不自动删除');
    await fs.rm(realVerifyStage, { recursive: true });
  }
  const bytes = await fs.readFile(archivePath);
  const digest = sha256(bytes);
  await fs.writeFile(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`);
  console.log(JSON.stringify({ archive: archivePath, checksumFile: `${archivePath}.sha256`, bytes: bytes.length, fileCount: archiveFiles.length, sha256: digest, sourceRevision: manifest.sourceRevision, sourceState: manifest.sourceState, offlineVerified: true, productionExecuted: false }, null, 2));
} finally {
  // Windows 删除前确认临时目录确实位于本项目 releases 内，且只删除本次创建的暂存目录。
  const realReleases = await fs.realpath(releases);
  const realStage = await fs.realpath(stage);
  if (path.dirname(realStage) !== realReleases || !path.basename(realStage).startsWith('.build-')) throw new Error('暂存目录安全检查失败，不自动删除');
  await fs.rm(realStage, { recursive: true });
  await fs.unlink(fileList).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
