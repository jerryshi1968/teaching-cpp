import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPatch, mysqlOption, fingerprint, publication } from '../deploy/production-20260830-01/safety.mjs';

test('原文变化或混合换行拒绝发布，CRLF 和注释保持完整', () => {
  const reference = Buffer.from('// 原注释\nconst a = 1; // keep\n');
  const patched = Buffer.from('// 原注释\nconst a = 2; // keep\n');
  assert.equal(renderPatch(reference, reference, patched).toString(), patched.toString());
  const crlf = Buffer.from(reference.toString().replace(/\n/g, '\r\n'));
  assert.equal(renderPatch(crlf, reference, patched).toString(), patched.toString().replace(/\n/g, '\r\n'));
  assert.throws(() => renderPatch(Buffer.from('// changed\nconst a = 1; // keep\n'), reference, patched));
  assert.throws(() => renderPatch(Buffer.from('// 原注释\r\nconst a = 1; // keep\n'), reference, patched));
});

test('MySQL 选项值不把引号、反斜线或换行变成额外选项', () => {
  assert.equal(mysqlOption(' a#;"\\\nnext=value\r\t'), '" a#;\\"\\\\\\nnext=value\\r\\t"');
  assert.throws(() => mysqlOption('x\0y'));
  assert.throws(() => mysqlOption('x\by'));
});

test('数据指纹忽略返回行顺序，检测原值、缺失行和空值变化', () => {
  const rows = [{ id: 1, value: null }, { id: 2, value: '中文' }];
  const expected = fingerprint(rows, ['id', 'value']);
  assert.deepEqual(fingerprint([...rows].reverse(), ['id', 'value']), expected);
  assert.notDeepEqual(fingerprint(rows.slice(0, 1), ['id', 'value']), expected);
  assert.notDeepEqual(fingerprint([{ id: 1, value: '' }, rows[1]], ['id', 'value']), expected);
  assert.deepEqual(fingerprint(rows.map(row => ({ ...row, project_type: 'p5js' })), ['id', 'value']), expected);
});

const order = ['preflight', 'stop', 'backup', 'migrate', 'install', 'verify', 'resume', 'finish'];
for (const failure of order) {
  test('发布阶段失败不继续执行后续步骤：' + failure, async () => {
    const called = [];
    const actions = Object.fromEntries([...order, 'recover'].map(step => [step, async () => {
      called.push(step);
      if (step === failure) throw Object.assign(new Error(), { code: 'INJECTED_FAILURE' });
    }]));
    await assert.rejects(publication(actions), error => error.code === 'INJECTED_FAILURE');
    const expected = order.slice(0, order.indexOf(failure) + 1);
    if (failure !== 'preflight') expected.push('recover');
    assert.deepEqual(called, expected);
  });
}
test('恢复流程失败时保留原错误并明确标记人工处理', async () => {
  const actions = Object.fromEntries(order.map(step => [step, async () => {}]));
  actions.migrate = async () => { throw Object.assign(new Error(), { code: 'MIGRATION_FAILED' }); };
  actions.recover = async () => { throw Object.assign(new Error(), { code: 'DATA_CHANGED' }); };
  await assert.rejects(publication(actions), error => error.code === 'MIGRATION_FAILED' && error.recoveryCode === 'DATA_CHANGED');
});
test('正常发布只按预检、备份、迁移、安装和核验顺序执行', async () => {
  const called = [];
  const actions = Object.fromEntries([...order, 'recover'].map(step => [step, async () => { called.push(step); }]));
  await publication(actions);
  assert.deepEqual(called, order);
});
