import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activateFrontend, assertFrontendManifest, assertProductionConfig, assertSourceManifest, CURRENT_FRONTEND_FILES, restoreFrontend, SOURCE_COMMIT, VERSION } from '../deploy/frontend-update-20260912-02/guard.mjs';

test('历史前端发布材料仍固定来源提交、构建文件及四个 vendor 包', async () => {
  const frontend = JSON.parse(await fs.readFile(new URL('../deploy/frontend-update-20260912-02/frontend-manifest.json', import.meta.url), 'utf8'));
  const source = JSON.parse(await fs.readFile(new URL('../deploy/frontend-update-20260912-02/source-manifest.json', import.meta.url), 'utf8'));
  assert.equal(frontend.release, VERSION);
  assert.equal(frontend.sourceCommit, SOURCE_COMMIT);
  assert.deepEqual(CURRENT_FRONTEND_FILES, [
    { path: 'index.html', sha256: '0e4c11af42627da5f7b07ea91fe13409476ca606252f8a8f30d42e627379433c', bytes: 730 },
    { path: 'assets/editor-CEb1qCln.js', sha256: 'a4f87f4e7e78487ae7c68129471f58fa0292f73b035260cb75a96e5fb7fe1ebb', bytes: 533408 },
    { path: 'assets/index-CPdgUZBF.css', sha256: 'd922d45d6160526764e10875ceb627ebac2ec3b4ad47ae01bbdb08c0614a410f', bytes: 52966 },
    { path: 'assets/index-zwCeYbEM.js', sha256: 'aa38d5c12248ab7ae8a3cb3c386dbdb5706ccb9262f730588bd44857b128de33', bytes: 284051 }
  ]);
  assert.equal(assertFrontendManifest(frontend), frontend);
  assert.equal(assertSourceManifest(source), source);
  assert.equal(frontend.files.length, 4);
  assert.equal(source.files.filter(file => file.path.endsWith('.tgz')).length, 4);
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
  const source = await fs.readFile(new URL('../deploy/frontend-update-20260912-02/update.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /run\(['"]systemctl['"]/);
  assert.doesNotMatch(source, /run\(PM2, \[['"](?:save|start|stop|restart|reload|delete)['"]/);
  assert.doesNotMatch(source, /\b(?:mysql|mysqldump|db:migrate)\b/i);
  assert.match(source, /fs\.chmodSync\(staging, 0o755\)/);
  assert.match(source, /fs\.chmodSync\(staging \+ '\/assets', 0o755\)/);
});

test('历史前端包拒绝已进入新版本的当前构建', () => {
  const script = fileURLToPath(new URL('../deploy/frontend-update-20260912-02/update.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--check-only'], { encoding: 'utf8' });
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /材料检查/);
  assert.doesNotMatch(checked.stderr, /\.env|PM2_HOME|Authorization|Cookie/);
});
