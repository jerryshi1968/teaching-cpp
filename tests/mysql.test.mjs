import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from 'mysql2/promise';
import { fixture } from './helpers.mjs';
import { readConfig } from '../backend/src/config.mjs';
import { MysqlRepository } from '../backend/src/repository.mjs';
import { CppService } from '../backend/src/service.mjs';

test('可选 MySQL 8 测试：真实事务、版本检查、复制与隔离查询', { skip: process.env.CPP_MYSQL_TEST !== '1' }, async t => {
  const config = readConfig();
  assert.equal(config.mode, 'test'); assert.match(config.db.database, /_test$/);
  const local = await fixture(t);
  const repo = new MysqlRepository(createPool(config.db));
  await repo.checkSchema();
  const service = new CppService(repo, local.sources, { ...config, runEnabled: false });
  const student = await service.user(2);
  const created = [];
  t.after(async () => { try { for (const project of created) await service.deleteProject(student, project.id); } finally { await repo.close(); } });
  const project = await service.createProject(student, { name: 'temporary SQL contract check' }); created.push(project);
  assert.equal(project.project_type, 'cpp');
  const saved = await service.saveProject(student, project.id, { ...project, code: 'int main(){return 0;}' });
  assert.equal(saved.version, 2);
  await assert.rejects(service.saveProject(student, project.id, { ...project, code: 'stale' }), error => error.code === 'VERSION_CONFLICT');
  const copy = await service.copyProject(student, project.id, {}); created.push(copy);
  assert.notEqual(copy.id, project.id); assert.equal(copy.code, 'int main(){return 0;}');
});
