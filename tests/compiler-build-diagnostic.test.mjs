import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const source = fs.readFileSync(new URL('../deploy/diagnose-compiler-build-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_BUILD_DIAG_NODE'\n([\s\S]+)\nCPP_BUILD_DIAG_NODE\n$/.exec(source)?.[1];
assert.ok(body);
const { redact, buildRecord, task, properties, classify, websiteSummary } = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const record = rows => ({ status: 1, stdout: rows.map(row => JSON.stringify(row)).join('\n') });
const build = { event: 'build-result', result: { code: 125, stdout: 'STEP 1/5: FROM fixed-image\n', stderr: 'Error: example build failure\n', signal: null, reason: null } };

test('提取真正的构建 stderr、退出码和进度，不把外层摘要冒充原因', () => {
  const output = buildRecord(record([build, { event: 'error', code: 'IMAGE_BUILD_FAILED', phase: 'build' }, { event: 'remaining-containers', value: [] }]));
  assert.equal(output.buildExit, 125);
  assert.equal(output.stderr, 'Error: example build failure\n');
  assert.equal(output.stdout, 'STEP 1/5: FROM fixed-image\n');
  assert.equal(output.checksPassed, 0);
  assert.equal(output.complete, false);
  assert.deepEqual(output.recordedContainers, [0]);
});
test('缺失、重复或损坏的构建记录不能猜测为某种错误', () => {
  for (const rows of [[], [build, build], [{ event: 'build-result', result: { code: 1 } }]]) assert.throws(() => buildRecord(record(rows)), { code: 'BUILD_RESULT_MISSING_OR_AMBIGUOUS' });
  assert.throws(() => buildRecord({ status: 1, stdout: '{truncated' }), SyntaxError);
});
test('构建错误保留换行，去除终端控制符并遮蔽常见凭据', () => {
  const text = '\x1b[31mError: denied\x1b[0m\nDB_PASSWORD="private value" RUNNER_TOKEN=abc123 https://alice:password@example.test/a?token=secret\nAuthorization: Bearer long-secret';
  const safe = redact(text);
  assert.ok(safe.includes('Error: denied\n'));
  for (const token of ['\x1b', 'private value', 'abc123', 'alice:password', 'token=secret', 'long-secret']) assert.ok(!safe.includes(token), token);
  assert.ok(safe.includes('[REDACTED]'));
  assert.equal(redact('x'.repeat(15000)).length, 12000);
});
test('只允许本次验证任务的单元与目录，不接受其他服务或路径跳转', () => {
  const label = '0123456789ab';
  assert.equal(task({ label, unit: 'cpp-compiler-check-' + label + '.service' }).area, '/var/www/teaching-cpp-runner/compiler-check-' + label);
  for (const value of [{ label, unit: 'p5js-backend.service' }, { label: '../root', unit: 'cpp-compiler-check-../root.service' }, {}]) assert.throws(() => task(value), { code: 'WORKER_SCOPE_INVALID' });
});
test('任务状态不能把未知或未完成进程扫描误记为停止', () => {
  const gone = { LoadState: 'not-found', ActiveState: 'inactive' };
  const idle = { complete: true, pids: [] };
  assert.equal(classify(1, gone, idle), '任务已回收');
  assert.equal(classify(0, { LoadState: 'loaded', ActiveState: 'failed', MainPID: '0', ControlPID: '0' }, idle), '任务已停止');
  assert.equal(classify(0, gone, { complete: true, pids: [12] }), '仍有进程或活动任务');
  assert.equal(classify(1, gone, { complete: false, pids: [] }), '无法确认');
  assert.equal(classify(null, gone, idle), '无法确认');
  assert.equal(classify(0, {}, idle), '无法确认');
});
test('只展示选择的 systemd 属性，拒绝重复值和终端控制符', () => {
  assert.deepEqual(properties('LoadState=not-found\nActiveState=inactive\nEnvironment=DB_PASSWORD=hidden\n'), { LoadState: 'not-found', ActiveState: 'inactive' });
  assert.throws(() => properties('LoadState=loaded\nLoadState=not-found\n'), { code: 'PROPERTY_FORMAT' });
  assert.throws(() => properties('ActiveState=\x1b[31mactive'), { code: 'PROPERTY_FORMAT' });
});
test('健康状态使用现有站点协议，缺少执行开关不能当成关闭', () => {
  assert.equal(websiteSummary('p5js', { status: 'OK', db_check: 'Database Active' }).healthy, true);
  assert.equal(websiteSummary('p5js', { status: 'OK' }).healthy, false);
  assert.deepEqual(websiteSummary('cpp', { mode: 'production', writesEnabled: true, runEnabled: false }), { site: 'cpp', production: true, writesEnabled: true, executionDisabled: true });
  assert.equal(websiteSummary('cpp', {}).executionDisabled, false);
});
test('原构建脚本保持用户已经上传的版本', () => {
  const digest = createHash('sha256').update(fs.readFileSync(new URL('../deploy/verify-compiler-containers-20260831.sh', import.meta.url))).digest('hex');
  assert.equal(digest, '7619e68b594636617cee2f21a6623ff736ea9ecdf033abc55eba70690621ca1d');
});
