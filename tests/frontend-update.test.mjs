import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activateFrontend, assertProductionConfig, CURRENT_FRONTEND_FILES, restoreFrontend, SOURCE_COMMIT, VERSION } from '../deploy/frontend-update-20260906-02/guard.mjs';
import { verifyMaterials } from '../deploy/frontend-update-20260906-02/update.mjs';

test('新前端发布材料固定来源提交、构建文件及四个 vendor 包', () => {
  const materials = verifyMaterials();
  assert.equal(materials.packaged, false);
  assert.equal(materials.frontend.release, VERSION);
  assert.equal(materials.frontend.sourceCommit, SOURCE_COMMIT);
  assert.deepEqual(CURRENT_FRONTEND_FILES, [
    { path: 'index.html', sha256: 'bb4e171acdc9335bce83e93ed31d9ca5fe6cb55ef8983241915367dacb9c1eff', bytes: 730 },
    { path: 'assets/editor-CEb1qCln.js', sha256: 'a4f87f4e7e78487ae7c68129471f58fa0292f73b035260cb75a96e5fb7fe1ebb', bytes: 533408 },
    { path: 'assets/index-smUevea3.css', sha256: '72079e9a955e81b735f370c73a93fdde33feddad736947090f4e61a6b320ec54', bytes: 51863 },
    { path: 'assets/index-DfFosam-.js', sha256: '37c52dbad7c8bf390819524509e1cb72d848b6c91a3440f95421c5df717eafc9', bytes: 252608 }
  ]);
  assert.equal(materials.frontend.files.length, 4);
  assert.equal(materials.source.files.filter(file => file.path.endsWith('.tgz')).length, 4);
});

test('生产预检只接受保存和运行均已启用的当前状态', () => {
  assert.deepEqual(assertProductionConfig({ mode: 'production', writesEnabled: true, runEnabled: true }), { mode: 'production', writesEnabled: true, runEnabled: true });
  for (const config of [
    { mode: 'demo', writesEnabled: true, runEnabled: true },
    { mode: 'production', writesEnabled: false, runEnabled: true },
    { mode: 'production', writesEnabled: true, runEnabled: false }
  ]) assert.throws(() => assertProductionConfig(config));
});

test('前端目录切换保留旧版并能把失败新版换回旧版', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-frontend-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const staging = path.join(root, 'staging');
  const previous = path.join(root, 'previous');
  const failed = path.join(root, 'failed');
  await fs.mkdir(current);
  await fs.mkdir(staging);
  await fs.writeFile(path.join(current, 'version'), 'old');
  await fs.writeFile(path.join(staging, 'version'), 'new');
  activateFrontend({ current, staging, previous });
  assert.equal(await fs.readFile(path.join(current, 'version'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(previous, 'version'), 'utf8'), 'old');
  restoreFrontend({ current, previous, failed });
  assert.equal(await fs.readFile(path.join(current, 'version'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(failed, 'version'), 'utf8'), 'new');
});

test('新发布程序不包含服务重启、Apache 重载或数据库命令', async () => {
  const source = await fs.readFile(new URL('../deploy/frontend-update-20260906-02/update.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /run\(['"]systemctl['"]/);
  assert.doesNotMatch(source, /run\(PM2, \[['"](?:save|start|stop|restart|reload|delete)['"]/);
  assert.doesNotMatch(source, /\b(?:mysql|mysqldump|db:migrate)\b/i);
  assert.match(source, /fs\.chmodSync\(staging, 0o755\)/);
  assert.match(source, /fs\.chmodSync\(staging \+ '\/assets', 0o755\)/);
});

test('Windows 本地只执行材料检查，生产预检在读取服务器前拒绝', () => {
  const script = fileURLToPath(new URL('../deploy/frontend-update-20260906-02/update.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--check-only'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /未读取生产配置、未连接服务、未修改文件/);
  if (process.platform === 'win32') {
    const preflight = spawnSync(process.execPath, [script, '--preflight'], { encoding: 'utf8' });
    assert.equal(preflight.status, 1);
    assert.match(preflight.stderr, /PRODUCTION_PLATFORM_REQUIRED/);
    assert.doesNotMatch(preflight.stderr, /\.env|PM2_HOME|Authorization|Cookie/);
  }
});
