import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../deploy/diagnose-runner-account-20260831.sh', import.meta.url), 'utf8');
const embedded = /<<'CPP_DIAGNOSTIC_NODE'\n([\s\S]+)\nCPP_DIAGNOSTIC_NODE\n$/.exec(source);
assert.ok(embedded);
const { summarizeAccount, mappingSummary, publicLogLines } = await import('data:text/javascript;base64,' + Buffer.from(embedded[1]).toString('base64'));

test('账号诊断只返回身份与目录，不返回 passwd 的密码字段', () => {
  const value = summarizeAccount('cpp-runner:PRIVATE_HASH:994:991:PRIVATE_GECOS:/var/www/teaching-cpp-runner:/sbin/nologin\n');
  assert.deepEqual(value, { valid: true, account: 'cpp-runner', uid: 994, gid: 991, home: '/var/www/teaching-cpp-runner', shell: '/sbin/nologin' });
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
});

test('错误账号或格式不在诊断中冒充 cpp-runner', () => {
  for (const text of ['', 'root:x:0:0::/root:/bin/bash', 'cpp-runner:x:unknown:unknown::/:/bin/bash']) assert.deepEqual(summarizeAccount(text), { valid: false });
});

test('已有新账号映射与其他账号抢占拟分配范围分别报告', () => {
  const value = mappingSummary('apphttp:100000:65536\ncpp-runner:200000:65536\nprivate-user:250000:10\n');
  assert.equal(value.count, 3);
  assert.equal(value.conflictingOtherRanges, 1);
  assert.deepEqual(value.known.map(row => row.account), ['apphttp', 'cpp-runner']);
  assert.ok(!JSON.stringify(value).includes('private-user'));
});

test('损坏映射只报告数量，不回显损坏行或其中的未知内容', () => {
  const value = mappingSummary('# 保留注释\nPRIVATE_CONTENT\nother:200000:0\nother:4294967290:100\n');
  assert.equal(value.malformed, 3);
  assert.equal(value.count, 0);
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
});

test('日志只摘取错误位置、退出码和完成标记，不原样输出环境或子命令信息', () => {
  const lines = publicLogLines('2026-08-31T01:00:00Z 准备未完成；阶段：只读预检；错误码：NOT_REGULAR_FILE\nDB_PASSWORD=PRIVATE_SECRET\n2026-08-31T01:00:01Z 系统命令退出码：1\nraw stderr PRIVATE_SECRET\n2026-08-31T01:00:02Z 账号准备完成：cpp-runner，UID=994\n');
  assert.deepEqual(lines, ['准备未完成；阶段：只读预检；错误码：NOT_REGULAR_FILE', '系统命令退出码：1', '日志记录：账号准备完成']);
  assert.ok(!JSON.stringify(lines).includes('PRIVATE'));
});
