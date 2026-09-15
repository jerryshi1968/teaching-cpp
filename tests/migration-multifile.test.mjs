import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationPlans, applyMigration } from '../backend/src/migrate.mjs';

test('多文件迁移只增加 C++ 历史清理索引，不向共享 files 表写入正文', async () => {
  const plans = await migrationPlans();
  assert.deepEqual(plans.map(plan => plan.id), ['001_cpp', '002_cpp_multifile']);
  const sql = plans[1].sql;
  assert.match(sql, /ALTER TABLE cpp_revisions/); assert.match(sql, /ALTER TABLE cpp_runs/);
  assert.doesNotMatch(sql, /ALTER TABLE files|content|code/i);
});

test('002 迁移要求 001 已完成并用独立迁移记录幂等登记', async () => {
  const plan = (await migrationPlans())[1];
  const calls = [];
  const required = ['projects', 'files', 'cpp_documents', 'cpp_revisions', 'cpp_runs', 'cpp_schema_migrations'];
  const connection = {
    query: async sql => {
      calls.push(sql);
      if (sql.startsWith('SELECT VERSION')) return [[{ version: '8.4.0', db: 'teaching_cpp_test' }], []];
      if (sql.includes('information_schema.TABLES')) return [required.map(name => ({ name })), []];
      if (sql.includes("WHERE id='001_cpp'")) return [[{ state: 'complete' }], []];
      return [{ affectedRows: 1 }, []];
    },
    execute: async () => [[], []]
  };
  const result = await applyMigration(connection, plan.sql, plan.id);
  assert.equal(result.applied, true); assert.equal(result.statements, 2);
  assert.ok(calls.some(sql => sql.includes('idx_cpp_revisions_project_time')));
  assert.ok(calls.some(sql => sql.includes('idx_cpp_runs_project_time')));
});
