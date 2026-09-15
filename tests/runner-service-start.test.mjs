import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { createRunnerApp } from '../runner/src/app.mjs';
import { JobManager } from '../runner/src/jobs.mjs';
import { fixture } from './helpers.mjs';

const file = new URL('../deploy/start-runner-service-20260831.sh', import.meta.url);
const bytes = fs.readFileSync(file), text = bytes.toString();
const body = /<<'CPP_RUNNER_SERVICE_NODE'\n([\s\S]+)\nCPP_RUNNER_SERVICE_NODE\n$/.exec(text)?.[1];
assert.ok(body);
const start = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const sha = value => createHash('sha256').update(value).digest('hex');
function service() {
  return { LoadState: 'loaded', ActiveState: 'active', SubState: 'running', MainPID: '12345', FragmentPath: start.UNIT_FILE, DropInPaths: '', NeedDaemonReload: 'no', NRestarts: '0', Delegate: 'yes', NoNewPrivileges: 'no', Restart: 'on-failure', KillMode: 'mixed', UnitFileState: 'disabled', ControlGroup: '/user.slice/user-994.slice/user@994.service/app.slice/' + start.UNIT };
}
function repairResult() {
  return { stage: 'cpu-budget-repaired-and-verified', checks: 18, containers: 0, runEnabled: false, image: start.IMAGE, moduleSha256: start.SOURCE_HASHES['runner/src/cpu-budget.mjs'], serverSha256: start.SOURCE_HASHES['runner/src/server.mjs'] };
}
async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

test('单文件 LF/UTF8 可解析，历史摘要不接受新版执行入口', () => {
  assert.equal(bytes[0], 35); assert.equal(text.includes('\r'), false);
  assert.doesNotThrow(() => new vm.Script(start.guardSource()));
  for (const [name, digest] of Object.entries(start.SOURCE_HASHES)) {
    const current = sha(fs.readFileSync(new URL('../' + name, import.meta.url)));
    if (name === 'package-lock.json') { assert.equal(digest, 'f21c8fc02eb2a46a00900285db742f43a001af874771cf6c6dcb992b4f92febb', name); assert.notEqual(current, digest, '历史部署包不能接受尚未重新打包的依赖锁文件'); }
    else if (name === 'runner/src/app.mjs') assert.notEqual(current, digest, '历史部署包不能接受新版多文件任务入口');
    else assert.equal(current, digest, name);
  }
});

test('只接受18项完整修正记录、固定镜像、新入口以及网站不变记录', () => {
  start.checkRepair(repairResult(), { unchanged: true, runEnabled: false });
  for (const mutate of [v => { v.checks = 12; }, v => { v.containers = 1; }, v => { v.runEnabled = true; }, v => { v.image = 'sha256:' + 'a'.repeat(64); }, v => { v.serverSha256 = '0'.repeat(64); }]) {
    const value = repairResult(); mutate(value); assert.throws(() => start.checkRepair(value, { unchanged: true, runEnabled: false }));
  }
  assert.throws(() => start.checkRepair(repairResult(), { unchanged: false, runEnabled: false }));
});

test('新配置仅含执行器配置；密钥不进入服务命令或环境声明', () => {
  const secret = randomBytes(48).toString('base64url'), config = dotenv.parse(start.envText(secret)), unit = start.unitText();
  assert.deepEqual(config, { RUNNER_PORT: '5280', RUNNER_DATA_ROOT: start.HOME_DIR + '/runner-data', RUNNER_TOKEN: secret, CPP_COMPILER_IMAGE: start.IMAGE });
  assert.ok(!unit.includes(secret)); assert.ok(!/^Environment(?:File)?=/m.test(unit));
  assert.ok(unit.includes('ExecStart=/usr/bin/env -i HOME=' + start.HOME_DIR));
  assert.ok(unit.includes(start.ROOT + '/tools/node/bin/node ' + start.ROOT + '/runner/src/server.mjs'));
  assert.ok(!/^(User=root|NoNewPrivileges=yes|PrivateUsers=yes)=?/m.test(unit));
  const original = fs.readFileSync(new URL('../deploy/teaching-cpp-runner.service', import.meta.url), 'utf8');
  for (const line of original.split('\n').filter(line => line.startsWith('#'))) assert.ok(unit.includes(line));
  for (const secret of ['', 'x'.repeat(63), 'x'.repeat(65), 'x'.repeat(63) + '\n', 'x'.repeat(62) + '$(']) assert.throws(() => start.envText(secret));
});

test('服务必须是指定普通用户单元，意外重启、覆盖配置或禁用委派都不能通过', () => {
  start.checkService(service(), false);
  start.checkService({ ...service(), UnitFileState: 'enabled' }, true);
  for (const change of [{ MainPID: '0' }, { NRestarts: '1' }, { FragmentPath: '/etc/systemd/system/' + start.UNIT }, { DropInPaths: '/tmp/override.conf' }, { Delegate: 'no' }, { NoNewPrivileges: 'yes' }, { ControlGroup: '/system.slice/' + start.UNIT }, { UnitFileState: 'enabled' }, { ActiveState: 'failed' }]) assert.throws(() => start.checkService({ ...service(), ...change }, false));
});

test('监听检查拒绝公网/IPv6通配监听、其他进程和多个监听', () => {
  const row = 'LISTEN 0 511 127.0.0.1:5280 0.0.0.0:* users:(("node",pid=12345,fd=20))';
  start.checkListener(row, '12345');
  for (const value of ['', row.replace('127.0.0.1', '0.0.0.0'), row.replace('127.0.0.1:5280', '[::]:5280'), row.replace('12345', '123456'), row + '\n' + row]) assert.throws(() => start.checkListener(value, '12345'));
});

test('真实 HTTP 客户端和应用认证：无密钥拒绝，正确密钥健康检查与输出可校验', async t => {
  const { root } = await fixture(t), secret = randomBytes(48).toString('base64url');
  let executed = 0;
  const config = { dataRoot: root, image: start.IMAGE, token: secret };
  const adapter = { cleanup: async () => {}, removeWork: async () => {}, execute: async () => { executed++; return { state: 'completed', stdout: '42\n', stderr: '' }; } };
  const manager = new JobManager(config, adapter); await manager.init();
  const port = await listen(t, createRunnerApp(manager, config));
  for (const key of [undefined, 'wrong']) {
    assert.equal((await start.request('/health', key, 'GET', undefined, port)).status, 401);
    assert.equal((await start.request('/jobs', key, 'POST', {}, port)).status, 401);
  }
  assert.equal(executed, 0);
  start.checkHealth(await start.request('/health', secret, 'GET', undefined, port));
  const id = randomUUID(), item = start.CASES[0], job = { id, code: item.code, stdin: item.stdin, profileId: 'cpp17', image: start.IMAGE };
  assert.equal((await start.request('/jobs', secret, 'POST', job, port)).status, 202);
  if (manager.current) await manager.current.promise;
  const completed = await start.request('/jobs/' + id, secret, 'GET', undefined, port); start.checkJob(item, completed.body, id);
  assert.deepEqual((await start.request('/jobs', secret, 'POST', job, port)).body, completed.body); assert.equal(executed, 1);
  const recovered = new JobManager(config, adapter); await recovered.init();
  const secondPort = await listen(t, createRunnerApp(recovered, config));
  assert.deepEqual((await start.request('/jobs/' + id, secret, 'GET', undefined, secondPort)).body, completed.body);
  assert.deepEqual((await start.request('/jobs', secret, 'POST', job, secondPort)).body, completed.body); assert.equal(executed, 1);
});

test('接口校验拒绝CPU误报、错误输出、错编号以及未完成状态', () => {
  const id = randomUUID();
  for (const item of start.CASES) {
    const result = { id, state: item.state, stdout: item.stdout, stderr: '', finished_at: new Date().toISOString(), message: item.state === 'runtime_error' ? '程序退出码：137' : '' };
    start.checkJob(item, result, id);
    for (const change of [{ id: randomUUID() }, { state: 'system_error' }, { stdout: 'bad' }, { finished_at: null }, { stderr: 'bad' }]) assert.throws(() => start.checkJob(item, { ...result, ...change }, id));
  }
  for (const body of [{ ready: false, busy: false, image: start.IMAGE }, { ready: true, busy: true, image: start.IMAGE }, { ready: true, busy: false, image: 'wrong' }]) assert.throws(() => start.checkHealth({ status: 200, cache: 'no-store', body }));
});

test('真实 HTTP 客户端拒绝非JSON返回和超大响应，不把主站回退当成健康', async t => {
  const port = await listen(t, http.createServer((req, res) => { res.end(req.url === '/big' ? 'x'.repeat(600000) : '<html>fallback</html>'); }));
  await assert.rejects(start.request('/health', undefined, 'GET', undefined, port), { code: 'HTTP_RESPONSE_INVALID' });
  await assert.rejects(start.request('/big', undefined, 'GET', undefined, port), { code: 'HTTP_RESPONSE_TOO_LARGE' });
});

test('用户检查程序在Windows先拒绝，绝不导入执行器入口或调用Linux工具', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', start.guardSource()], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stdout), { error: 'GUARD_USER_INVALID' });
});

test('Linux安装入口在Windows先拒绝，不读取服务器配置或启动服务', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-', '--start-runner-service'], { input: body, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 1); assert.match(result.stdout, /LINUX_ROOT_REQUIRED/); assert.doesNotMatch(result.stdout, /私有操作记录：/);
});

async function failureScenario({ owned = true, disableFails = false } = {}) {
  const source = /async function containFailure\(\) \{[\s\S]+?\n\}\nif \(process.argv/.exec(body)?.[0].replace(/\nif \(process.argv$/, '');
  assert.ok(source);
  const calls = [], messages = [], digest = sha(start.unitText());
  const context = { installed: true, startRequested: true, enableRequested: true, before: {}, UNIT: start.UNIT, UNIT_FILE: start.UNIT_FILE, sha, unitText: start.unitText, journal: () => calls.push('journal'), checks: { old: { hash: () => digest } }, ensure: (ok, code) => { if (!ok) throw Object.assign(new Error(), { code }); }, safeCode: code => code, save: () => {}, unchanged: () => calls.push('websites'), delay: async () => {}, log: message => messages.push(message), serviceState: () => ({ FragmentPath: owned ? start.UNIT_FILE : '/unknown', ActiveState: 'inactive', MainPID: '0', ControlPID: '0' }), ctl: args => { calls.push(args.join(' ')); if (disableFails && args[0] === 'disable') throw Object.assign(new Error(), { code: 'DISABLE_FAILED' }); } };
  await vm.runInNewContext(source + '\ncontainFailure()', context);
  return { calls, messages };
}

test('开机设置撤回失败仍会停止本次新增服务，并复核原站', async () => {
  const result = await failureScenario({ disableFails: true });
  assert.deepEqual(result.calls, ['journal', 'disable ' + start.UNIT, 'stop --no-block ' + start.UNIT, 'websites']);
  assert.ok(result.messages.some(message => message.includes('开机设置撤回未确认')));
  assert.ok(result.messages.some(message => message.includes('已停止本次新增')));
});

test('不能确认单元是本次安装时不停止未知服务，明确报告并复核原站', async () => {
  const result = await failureScenario({ owned: false });
  assert.deepEqual(result.calls, ['journal', 'websites']);
  assert.ok(result.messages.some(message => message.includes('OWN_SERVICE_NOT_CONFIRMED')));
  assert.ok(!result.messages.some(message => message.includes('已停止本次新增')));
});
