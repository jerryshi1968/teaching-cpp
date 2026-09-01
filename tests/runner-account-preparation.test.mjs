import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../deploy/prepare-runner-account-20260831.sh', import.meta.url), 'utf8');
const embedded = /<<'CPP_ACCOUNT_NODE'\n([\s\S]+)\nCPP_ACCOUNT_NODE\n$/.exec(script);
assert.ok(embedded, '安装脚本中的 Node 检查代码应可提取');
const { inspectMap, assertOnlyNewRow, sliceText, checkSiteValues } = await import('data:text/javascript;base64,' + Buffer.from(embedded[1]).toString('base64'));
const passwd = 'root:x:0:0:root:/root:/bin/bash\napphttp:x:1000:1000::/home/apphttp:/bin/bash\n';
const original = '# 已有执行用户，必须保留\napphttp:100000:65536\n';
const added = 'cpp-runner:200000:65536\n';

test('现有 apphttp 映射与拟分配范围互不重叠，检查不改动原文', () => {
  assert.doesNotThrow(() => inspectMap(original, passwd));
  assert.doesNotThrow(() => assertOnlyNewRow(original, original + added, added));
});

for (const [range, code] of [
  ['other:199999:2\n', 'MAPPING_RANGE_CONFLICT'],
  ['other:265535:1\n', 'MAPPING_RANGE_CONFLICT'],
  ['other:200001:12\n', 'MAPPING_RANGE_CONFLICT'],
  ['other:100000:200000\n', 'MAPPING_RANGE_CONFLICT'],
  ['cpp-runner:300000:65536\n', 'RUNNER_MAPPING_EXISTS'],
  ['other:200000:0\n', 'MAPPING_RANGE_INVALID'],
  ['other:4294967290:20\n', 'MAPPING_RANGE_INVALID'],
  ['other:abc:65536\n', 'MAPPING_FORMAT']
]) {
  test('拒绝不安全的映射：' + range.trim(), () => {
    assert.throws(() => inspectMap(range, passwd), { code });
  });
}

test('允许与拟分配范围相邻但不重叠的首尾边界', () => {
  assert.doesNotThrow(() => inspectMap('before:199999:1\nafter:265536:65536\n', passwd));
});

test('真实账号或组的数字 ID 占用拟映射范围时拒绝', () => {
  assert.throws(() => inspectMap(original, passwd + 'other:x:200100:200100::/other:/sbin/nologin\n'), { code: 'MAPPING_REAL_ID_CONFLICT' });
  assert.throws(() => inspectMap(original, 'other:x:265535:\n'), { code: 'MAPPING_REAL_ID_CONFLICT' });
});

test('不接受溢出的真实用户 ID', () => {
  assert.throws(() => inspectMap(original, 'other:x:999999999999999999:0::/:/bin/bash\n'), { code: 'IDENTITY_ID_INVALID' });
});

test('拒绝改写旧映射、丢失旧注释、改变旧行顺序', () => {
  for (const modified of [original.replace('100000', '100001'), original.replace('# 已有执行用户，必须保留\n', ''), 'apphttp:100000:65536\n# 已有执行用户，必须保留\n']) {
    assert.throws(() => assertOnlyNewRow(original, modified + added, added), { code: 'EXISTING_ACCOUNT_ROWS_CHANGED' });
  }
});

test('拒绝缺少新行、重复新行及给新账号分配错误范围', () => {
  assert.throws(() => assertOnlyNewRow(original, original, added), { code: 'ACCOUNT_ROW_COUNT' });
  assert.throws(() => assertOnlyNewRow(original, original + added + added, added), { code: 'ACCOUNT_ROW_COUNT' });
  assert.throws(() => assertOnlyNewRow(original, original + 'cpp-runner:100000:65536\n', added), { code: 'ACCOUNT_ROW_UNEXPECTED' });
});

test('旧注释内含新账号行文本也完整保留，只识别真正的新行', () => {
  const before = '# 举例 ' + added + original;
  assert.doesNotThrow(() => assertOnlyNewRow(before, before + added, added));
});

test('账号文件只允许追加新账号，不允许修改原账号密码字段', () => {
  const before = 'root:HASH:20000:0:99999:7:::\n';
  const row = 'cpp-runner:!:20000::::::\n';
  assert.doesNotThrow(() => assertOnlyNewRow(before, before + row));
  assert.throws(() => assertOnlyNewRow(before, before.replace('HASH', 'CHANGED') + row), { code: 'EXISTING_ACCOUNT_ROWS_CHANGED' });
});

test('资源单元拒绝 root、非法数值及路径注入形式的 UID', () => {
  for (const value of [0, -1, 65534, NaN, '994/../../other', '994']) {
    assert.throws(() => sliceText(value), { code: 'RUNNER_UID_INVALID' });
  }
  assert.doesNotThrow(() => sliceText(994));
});

test('仅接受已启用保存、未启用运行的生产网站状态', () => {
  const p5 = { status: 'OK', db_check: 'Database Active' };
  const cpp = { mode: 'production', writesEnabled: true, runEnabled: false };
  assert.doesNotThrow(() => checkSiteValues(p5, cpp));
  for (const override of [{ runEnabled: true }, { runEnabled: 'false' }, { mode: 'demo' }, { writesEnabled: false }]) {
    assert.throws(() => checkSiteValues(p5, { ...cpp, ...override }), { code: 'CPP_GATES_CHANGED' });
  }
  assert.throws(() => checkSiteValues({ status: 'OK', db_check: 'Unavailable' }, cpp), { code: 'P5_HEALTH_FAILED' });
});
