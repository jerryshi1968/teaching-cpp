import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function inspect(version, mode = 'disabled', scenario = 'normal') {
  const file = path.join(import.meta.dirname, 'fixtures/write-enable-db-check.mjs');
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', file, version, mode, scenario], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('模拟 MySQL 预处理限制，原版检查在开始事务时复现 ER_UNSUPPORTED_PS', () => {
  const result = inspect('01');
  assert.equal(result.exitCode, 1);
  assert.equal(result.output[0].code, 'ER_UNSUPPORTED_PS');
  assert.deepEqual(result.events.map(event => event.method), ['getConnection', 'execute', 'release', 'end']);
  assert.equal(result.events[1].sql, 'START TRANSACTION READ ONLY');
});

for (const mode of ['disabled', 'enabled']) {
  test(`修正版 ${mode} 检查用文本协议控制事务，业务 SELECT 仍预处理且限时`, () => {
    const result = inspect('02', mode);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.output, [{ ok: true }]);
    const sql = result.events.filter(event => event.sql);
    assert.deepEqual(sql.filter(event => event.method === 'query').map(event => event.sql), ['START TRANSACTION READ ONLY', 'ROLLBACK']);
    assert.ok(sql.filter(event => event.method === 'execute').every(event => event.sql.startsWith('SELECT ')));
    assert.ok(sql.every(event => event.timeout === 10000));
    assert.equal(sql[0].sql, 'START TRANSACTION READ ONLY');
    assert.equal(sql.at(-1).sql, 'ROLLBACK');
    assert.deepEqual(result.events.slice(-2).map(event => event.method), ['release', 'end']);
    assert.equal(sql.some(event => event.sql === 'SELECT 1 FROM cpp_documents LIMIT 1'), mode === 'disabled');
  });
}

for (const [scenario, expected] of [
  ['start-error', 'SIMULATED_START_ERROR'],
  ['migration-incomplete', 'DB_MIGRATION_MISMATCH'],
  ['existing-document', 'CPP_DATA_ALREADY_EXISTS'],
  ['existing-run', 'RUN_RECORD_UNEXPECTED'],
  ['rollback-error', 'SIMULATED_ROLLBACK_ERROR']
]) {
  test(`修正版检查 ${scenario} 时仍报失败并关闭连接池，不跳过检查`, () => {
    const result = inspect('02', 'disabled', scenario);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output[0].code, expected);
    assert.deepEqual(result.events.slice(-2).map(event => event.method), ['release', 'end']);
  });
}

test('新检查只修正两条事务调用，其余逻辑与原注释逐字保留', () => {
  const root = path.resolve(import.meta.dirname, '../deploy');
  const before = fs.readFileSync(path.join(root, 'write-enable-20260831-01/check-db.mjs'), 'utf8');
  const after = fs.readFileSync(path.join(root, 'write-enable-20260831-02/check-db.mjs'), 'utf8');
  let expected = before;
  for (const sql of ['START TRANSACTION READ ONLY', 'ROLLBACK']) expected = expected.replace("await query('" + sql + "');", "await connection.query({ sql: '" + sql + "', timeout: 10000 });");
  assert.equal(after, expected);
  assert.deepEqual(fs.readFileSync(path.join(root, 'write-enable-20260831-02/guard.mjs')), fs.readFileSync(path.join(root, 'write-enable-20260831-01/guard.mjs')));
});
