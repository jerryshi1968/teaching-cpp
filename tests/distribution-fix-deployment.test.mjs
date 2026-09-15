import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyMaterials, VERSION } from '../deploy/distribution-fix-20260915-01/update.mjs';

test('分发修正包只固定一个后端文件和已发布多文件基线', () => {
  const materials = verifyMaterials();
  assert.equal(VERSION, 'distribution-fix-20260915-01');
  assert.equal(materials.packaged, false);
  assert.equal(materials.manifest.applicationFile.path, 'backend/src/service.mjs');
  assert.equal(materials.manifest.migration.id, '002_cpp_multifile');
  assert.equal(materials.manifest.frontendFiles.length, 4);
});

test('分发修正只重启 C++ 后端，不操作 Runner、p5.js、迁移或前端', async () => {
  const source = await fs.readFile(new URL('../deploy/distribution-fix-20260915-01/update.mjs', import.meta.url), 'utf8');
  assert.match(source, /run\(PM2, \['restart', String\(context\.processes\.cpp\.id\)\]\)/);
  assert.doesNotMatch(source, /runnerCommand\(\['restart'/);
  assert.doesNotMatch(source, /PM2, \['restart', ['"]p5js-backend/);
  assert.doesNotMatch(source, /migrate\.mjs.*--apply/);
  assert.doesNotMatch(source, /activateFrontend|renameSync\([^\n]*FRONTEND_ROOT/);
});

test('分发修正包本地只允许材料检查', () => {
  const script = fileURLToPath(new URL('../deploy/distribution-fix-20260915-01/update.mjs', import.meta.url));
  const checked = spawnSync(process.execPath, [script, '--check-only'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /未读取生产配置、未连接数据库或服务、未修改文件/);
  if (process.platform === 'win32') {
    const preflight = spawnSync(process.execPath, [script, '--preflight'], { encoding: 'utf8' });
    assert.equal(preflight.status, 1);
    assert.match(preflight.stderr, /PRODUCTION_PLATFORM_REQUIRED/);
  }
});
