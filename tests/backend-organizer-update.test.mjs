import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBackendManifest, CURRENT_BACKEND_FILES, installBackendFiles, restoreBackendFiles, SOURCE_COMMIT, VERSION } from '../deploy/backend-organizer-update-20260905-01/guard.mjs';

test('历史后端接口更新材料仍固定来源提交、生产基线和两个目标文件', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../deploy/backend-organizer-update-20260905-01/backend-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.deepEqual(CURRENT_BACKEND_FILES, [
    { path: 'backend/src/app.mjs', sha256: 'f4bcbfd5dc8f542a6d31aa79df939eb6efd69072119e78cb0171e852c49acdd3', bytes: 5629 },
    { path: 'backend/src/service.mjs', sha256: 'cc7b561eae114f069493905b6a402aed919e7a26df55056a5f60b0e8d7ca59d5', bytes: 22492 }
  ]);
  assert.equal(assertBackendManifest(manifest), manifest);
});

test('两个后端文件可从私有备份完整恢复', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cpp-backend-organizer-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payloadRoot = path.join(root, 'payload');
  const backupRoot = path.join(root, 'backup');
  const files = [
    { path: 'backend/src/app.mjs', currentSha256: '0'.repeat(64), currentBytes: 3, sha256: '1'.repeat(64), bytes: 3 },
    { path: 'backend/src/service.mjs', currentSha256: '2'.repeat(64), currentBytes: 3, sha256: '3'.repeat(64), bytes: 3 }
  ];
  for (const file of files) {
    const target = path.join(root, ...file.path.split('/'));
    const payload = path.join(payloadRoot, ...file.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(path.dirname(payload), { recursive: true });
    await fs.writeFile(target, `old`);
    await fs.writeFile(payload, `new`);
  }
  installBackendFiles({ root, payloadRoot, backupRoot, manifest: { files }, durable: false });
  assert.equal(await fs.readFile(path.join(root, 'backend/src/app.mjs'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(backupRoot, 'previous-backend/backend/src/app.mjs'), 'utf8'), 'old');
  restoreBackendFiles({ root, backupRoot, manifest: { files }, durable: false });
  assert.equal(await fs.readFile(path.join(root, 'backend/src/app.mjs'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(root, 'backend/src/service.mjs'), 'utf8'), 'old');
});

test('更新程序只允许重启指定 C++ 进程且不含数据库与服务器配置修改命令', async () => {
  const source = await fs.readFile(new URL('../deploy/backend-organizer-update-20260905-01/update.mjs', import.meta.url), 'utf8');
  assert.match(source, /run\(PM2, \['restart', String\([^)]+\.cpp\.id\)\]\)/);
  assert.equal(source.match(/run\(PM2, \['restart'/g)?.length, 2);
  assert.doesNotMatch(source, /['"]all['"]/);
  assert.doesNotMatch(source, /run\(PM2, \[['"](?:save|start|stop|reload|delete|restart all)['"]/);
  assert.doesNotMatch(source, /run\(['"]systemctl['"]/);
  assert.doesNotMatch(source, /run\(['"]httpd['"], \[['"](?:-k|reload|restart)/);
  assert.doesNotMatch(source, /\b(?:mysql|mysqldump|db:migrate)\b/i);
});

test('历史后端包拒绝已进入新版本的当前源码', () => {
  const script = fileURLToPath(new URL('../deploy/backend-organizer-update-20260905-01/update.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--check-only'], { encoding: 'utf8' });
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /材料检查/);
  assert.doesNotMatch(checked.stderr, /\.env|PM2_HOME|Authorization|Cookie/);
});
