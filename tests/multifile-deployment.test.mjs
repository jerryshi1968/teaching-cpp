import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activateFrontend, assertReleaseManifest, installApplicationFiles, restoreApplicationFiles, restoreFrontend, VERSION } from '../deploy/multifile-update-20260915-02/guard.mjs';

test('历史多文件正式包固定已发布基线并拒绝后续分发修正源码', () => {
  const script = fileURLToPath(new URL('../deploy/multifile-update-20260915-02/update.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--check-only'], { encoding: 'utf8' });
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /ERR_ASSERTION/);
  assert.equal(VERSION, 'multifile-update-20260915-02');
});

test('应用文件与新迁移可安装，失败恢复时旧字节完整还原且移除新文件', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-multifile-deployment-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payloadRoot = path.join(root, 'payload');
  const backupRoot = path.join(root, 'backup');
  const applicationFiles = [
    { path: 'backend/src/app.mjs', currentSha256: '0'.repeat(64), currentBytes: 3, sha256: '1'.repeat(64), bytes: 3 }
  ];
  const migration = { path: 'backend/migrations/002_cpp_multifile.sql', sha256: '2'.repeat(64), bytes: 3 };
  const manifest = { applicationFiles, migration };
  await fs.mkdir(path.join(root, 'backend/src'), { recursive: true });
  await fs.mkdir(path.join(root, 'backend/migrations'), { recursive: true });
  await fs.mkdir(path.join(payloadRoot, 'backend/src'), { recursive: true });
  await fs.mkdir(path.join(payloadRoot, 'backend/migrations'), { recursive: true });
  await fs.mkdir(backupRoot);
  await fs.writeFile(path.join(root, applicationFiles[0].path), 'old');
  await fs.writeFile(path.join(payloadRoot, applicationFiles[0].path), 'new');
  await fs.writeFile(path.join(payloadRoot, migration.path), 'sql');
  installApplicationFiles({ root, payloadRoot, backupRoot, manifest, durable: false });
  assert.equal(await fs.readFile(path.join(root, applicationFiles[0].path), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(root, migration.path), 'utf8'), 'sql');
  restoreApplicationFiles({ root, backupRoot, manifest, durable: false });
  assert.equal(await fs.readFile(path.join(root, applicationFiles[0].path), 'utf8'), 'old');
  await assert.rejects(fs.access(path.join(root, migration.path)));
});

test('前端原子切换后可把失败新版移开并恢复旧版', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-multifile-frontend-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const staging = path.join(root, 'staging');
  const previous = path.join(root, 'previous');
  const failed = path.join(root, 'failed');
  await fs.mkdir(current); await fs.mkdir(staging);
  await fs.writeFile(path.join(current, 'version'), 'old');
  await fs.writeFile(path.join(staging, 'version'), 'new');
  activateFrontend({ current, staging, previous });
  assert.equal(await fs.readFile(path.join(current, 'version'), 'utf8'), 'new');
  restoreFrontend({ current, previous, failed });
  assert.equal(await fs.readFile(path.join(current, 'version'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(failed, 'version'), 'utf8'), 'new');
});

test('发布顺序固定为迁移、Runner、C++ 后端、前端，不重启 p5.js 或修改配置', async () => {
  const source = await fs.readFile(new URL('../deploy/multifile-update-20260915-02/update.mjs', import.meta.url), 'utf8');
  const migrate = source.indexOf("progress('应用 002_cpp_multifile 加法迁移')");
  const runner = source.indexOf("runnerCommand(['restart', RUNNER_UNIT])", migrate);
  const backend = source.indexOf("run(PM2, ['restart', String(context.processBaseline.cpp.id)])", runner);
  const frontend = source.indexOf('activateFrontend({ current: FRONTEND_ROOT', backend);
  assert.ok(migrate > 0 && migrate < runner && runner < backend && backend < frontend);
  assert.doesNotMatch(source, /PM2, \['restart', ['"]p5js-backend/);
  assert.doesNotMatch(source, /writeFileSync\([^\n]*(?:\.env|dump\.pm2|systemd)/);
  assert.match(source, /START TRANSACTION READ ONLY/);
  assert.match(source, /all\.map\(item => item\.name\)\.sort\(\), \[CPP_NAME, 'p5js-backend'\]\.sort\(\)/);
  assert.match(source, /--backup-confirmed/);
  assert.match(source, /--production-reviewed/);
});

test('历史多文件正式包在源码变化后拒绝再次生成或执行', () => {
  const script = fileURLToPath(new URL('../deploy/multifile-update-20260915-02/update.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--check-only'], { encoding: 'utf8' });
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /ERR_ASSERTION/);
  if (process.platform === 'win32') {
    const preflight = spawnSync(process.execPath, [script, '--preflight'], { encoding: 'utf8' });
    assert.equal(preflight.status, 1);
    assert.match(preflight.stderr, /ERR_ASSERTION/);
    assert.doesNotMatch(preflight.stderr, /\.env|PM2_HOME|Authorization|Cookie/);
  }
});
