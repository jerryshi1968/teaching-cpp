import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../deploy/diagnose-gcc-registry-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_REGISTRY_DIAG_NODE'\n([\s\S]+)\nCPP_REGISTRY_DIAG_NODE\n$/.exec(source)?.[1];
assert.ok(body);
const { errorSummary, workerSummary, selectProperties, classifyUnit, parseCurl, probeSource } = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const events = rows => ({ status: 1, signal: null, stdout: rows.map(row => JSON.stringify(row)).join('\n'), stderr: 'private raw command output' });
const rootless = { event: 'stage', value: 'rootless-checked' };
const failure = { event: 'error', code: 'IMAGE_PREPARATION_FAILED', causeCode: 'ETIMEDOUT', stderr: 'secret' };
const noProcesses = { pids: [], complete: true };

test('只有完整的元数据前置失败记录可以推定未调用 pull', () => {
  assert.equal(workerSummary(events([rootless, failure])).failedBeforePull, true);
  for (const rows of [[failure], [rootless], [rootless, { event: 'stage', value: 'official-manifest-verified' }, failure], [rootless, { event: 'progress' }, failure], [rootless, { event: 'complete' }, failure]]) assert.equal(workerSummary(events(rows)).failedBeforePull, false);
  const incomplete = events([rootless, failure]); incomplete.stdout += '\ntruncated';
  assert.equal(workerSummary(incomplete).failedBeforePull, false);
  assert.ok(!JSON.stringify(workerSummary(events([rootless, failure]))).includes('secret'));
});

test('提取 AggregateError 中各地址的错误码，但不回显秘密、URL 或堆栈', () => {
  const value = { name: 'TypeError', message: 'private-token', stack: 'private-token', cause: { name: 'AggregateError', code: 'ETIMEDOUT', errors: [{ code: 'ETIMEDOUT', address: '192.0.2.1', port: 443, syscall: 'connect', headers: { Authorization: 'private-token' } }, { code: 'ENETUNREACH', address: '2001:db8::1', port: 443 }] } };
  const result = errorSummary(value);
  assert.deepEqual(result.map(row => row.code), ['UNSPECIFIED', 'ETIMEDOUT', 'ETIMEDOUT', 'ENETUNREACH']);
  assert.deepEqual(result.filter(row => row.family).map(row => row.family), [4, 6]);
  assert.ok(!JSON.stringify(result).includes('private-token'));
  assert.equal(errorSummary({ code: 'https://user:secret@example.org', address: 'secret.example.org' })[0].code, 'UNSPECIFIED');
});

test('循环及大量嵌套错误不会使诊断无限递归或打印无界输出', () => {
  const value = { code: 'ETIMEDOUT' }; value.cause = value;
  assert.equal(errorSummary(value).length, 1);
  value.errors = Array.from({ length: 1000 }, () => ({ code: 'ENETUNREACH', errors: Array.from({ length: 1000 }, () => ({ code: 'ETIMEDOUT' })) }));
  assert.ok(errorSummary(value).length <= 24);
});

test('已回收单元、活动进程和无法查询必须区分，不能仅凭失败退出判定停止', () => {
  const absent = { LoadState: 'not-found', ActiveState: 'inactive' };
  assert.equal(classifyUnit(1, absent, noProcesses), 'unit-collected');
  assert.equal(classifyUnit(1, absent, { pids: [123], complete: true }), 'processes-present');
  assert.equal(classifyUnit(1, absent, { pids: [], complete: false }), 'unknown');
  assert.equal(classifyUnit(null, absent, noProcesses), 'unknown');
  assert.equal(classifyUnit(1, {}, noProcesses), 'unknown');
  assert.equal(classifyUnit(0, { ActiveState: 'deactivating', MainPID: '0' }, noProcesses), 'unit-running');
});

test('失败单元只有确认无主进程、控制进程或残留进程时才记为停止', () => {
  const stopped = { LoadState: 'loaded', ActiveState: 'failed', MainPID: '0', ControlPID: '0' };
  assert.equal(classifyUnit(0, stopped, noProcesses), 'unit-stopped');
  assert.equal(classifyUnit(0, { ...stopped, ControlPID: '123' }, noProcesses), 'unit-running');
  assert.equal(classifyUnit(0, { ...stopped, MainPID: undefined }, noProcesses), 'unknown');
});

test('仓库 401 表示认证挑战，不误报网络不通；认证接口仍需 200', () => {
  const result = { exit: 0, stdout: '401|192.0.2.1|0|0.01|0.02|0.03|0.04' };
  assert.equal(parseCurl(result, 'registry').expectedResponse, true);
  assert.equal(parseCurl(result, 'auth').expectedResponse, false);
  assert.equal(parseCurl(result, 'auth').httpsReached, true);
  const rateLimited = { ...result, stdout: result.stdout.replace('401|', '429|') };
  assert.equal(parseCurl(rateLimited, 'registry').httpsReached, true);
  assert.equal(parseCurl(rateLimited, 'registry').expectedResponse, false);
});

test('失败的 curl、TLS 校验失败和异常输出不能当作 HTTPS 验证成功', () => {
  const result = { exit: 0, stdout: '200|192.0.2.1|0|0.01|0.02|0.03|0.04' };
  assert.equal(parseCurl({ ...result, exit: 28 }, 'auth').httpsReached, false);
  assert.equal(parseCurl({ ...result, stdout: result.stdout.replace('|0|', '|60|') }, 'auth').httpsReached, false);
  const bad = parseCurl({ exit: 1, stdout: 'secret-response-body' }, 'auth');
  assert.equal(bad.error, 'CURL_OUTPUT_UNEXPECTED');
  assert.ok(!JSON.stringify(bad).includes('secret-response-body'));
});

test('只输出选定 systemd 属性；重复或混入多行的属性不用于状态判断', () => {
  assert.deepEqual(selectProperties('LoadState=loaded\nEnvironment=PASSWORD=secret\nExecStart=private\nMainPID=0\n', ['LoadState', 'MainPID']), { LoadState: 'loaded', MainPID: '0' });
  assert.throws(() => selectProperties('LoadState=loaded\nLoadState=not-found\n', ['LoadState']), { code: 'DUPLICATE_PROPERTY' });
  assert.throws(() => selectProperties('MainPID=0\u001b[31m\n', ['MainPID']), { code: 'PROPERTY_FORMAT' });
});

test('实际发送给普通用户 Node 的诊断程序可解析，所需 DNS API 存在', async () => {
  const generated = probeSource();
  assert.doesNotThrow(() => new vm.Script(generated.replace("import { isIP } from 'node:net';\n", '')));
  const dns = await import('node:dns/promises');
  assert.equal(typeof dns.getDefaultResultOrder, 'function');
});
