import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuUsage, cpuStatPath, containerState, cpuLimitedCommand, CpuMeteredSandbox } from '../runner/src/cpu-budget.mjs';
import { PodmanSandbox, LIMITS } from '../runner/src/podman.mjs';

const id = 'a'.repeat(64), name = 'cpp-job-12345678-1234-1234-1234-123456789abc-run';
const group = '/user.slice/user-994.slice/user@994.service/app.slice/libpod-' + id + '.scope/container';
const config = { uid: 994, podman: '/usr/bin/podman' };
const inspect = (running = true, oom = false) => [{ Name: name, Id: id, State: { Running: running, Status: running ? 'running' : 'exited', Pid: running ? 1234 : 0, OOMKilled: oom, ExitCode: running ? 0 : 137 } }];

function harness({ phase = 'run', values = [1000, 3000001], result = { code: 137, reason: null, stdout: '', stderr: '' }, oom = false, readingError, wrongGroup, finishAfterSample = false, missingAfterExit = false } = {}) {
  const currentName = name.replace(/-run$/, '-' + phase), args = ['start', '--attach', '--interactive', currentName];
  let resolve, running = true, samples = 0, kills = 0, active = false;
  const attached = new Promise(done => { resolve = done; }), calls = [], events = [];
  const execute = async (program, argv, options) => {
    calls.push({ program, argv, options });
    if (argv[0] === 'start') { active = true; return attached; }
    if (argv[0] === 'inspect') { const rows = inspect(running, oom); rows[0].Name = currentName; return { code: 0, reason: null, stdout: JSON.stringify(rows) }; }
    if (argv[0] === 'kill') { kills++; running = false; resolve(result); return { code: 0, reason: null }; }
    throw new Error('Unexpected command: ' + argv[0]);
  };
  const readFile = async file => {
    assert.equal(active, true);
    if (file.startsWith('/proc/')) return '0::' + (wrongGroup || group) + '\n';
    if (missingAfterExit) { running = false; resolve(result); throw Object.assign(new Error(), { code: 'ENOENT' }); }
    if (readingError) throw readingError;
    const value = values[Math.min(samples++, values.length - 1)];
    if (finishAfterSample) { running = false; resolve(result); }
    return typeof value === 'number' ? 'usage_usec ' + value + '\nuser_usec 0\nsystem_usec 0\n' : value;
  };
  const monitoring = { readFile, pause: async () => {}, onCpuLimit: value => events.push(value) };
  return { run: () => cpuLimitedCommand(config, config.podman, args, {}, execute, monitoring), calls, events, killed: () => kills, resolve: () => { running = false; resolve(result); } };
}

test('仅使用内核usage_usec，拒绝重复、缺失、负值和非整数', () => {
  assert.equal(cpuUsage('usage_usec 12345\nuser_usec 11000\nsystem_usec 1345\n'), 12345);
  for (const text of ['', 'usage_usec -1', 'usage_usec 1.1', 'usage_usec 1\nusage_usec 2', 'usage_usec 999999999999999999999']) assert.throws(() => cpuUsage(text), { code: 'CPU_STAT_INVALID' });
});

test('计数范围绑定实际容器ID和执行账号，允许scope内子目录', () => {
  assert.equal(cpuStatPath('0::' + group + '\n', 994, id), '/sys/fs/cgroup' + group.slice(0, -10) + '/cpu.stat');
  for (const text of ['0::/', '0::' + group.replace('994', '995'), '0::' + group.replace(id, 'b'.repeat(64)), '0::' + group + '/../other', '0::' + group + ' (deleted)', '0::' + group + '\n0::' + group]) assert.throws(() => cpuStatPath(text, 994, id), { code: 'CPU_SCOPE_INVALID' });
});

test('inspect必须是目标容器，运行时必须有有效宿主PID', () => {
  assert.equal(containerState(inspect(), name).pid, 1234);
  const invalid = inspect(); invalid[0].State.Pid = 0;
  assert.throws(() => containerState(invalid, name), { code: 'CPU_PID_INVALID' });
  assert.throws(() => containerState(inspect(), 'other'), { code: 'CPU_CONTAINER_INVALID' });
});

test('CPU实际用量达到3秒才发出停止，并记录超时依据', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.reason, 'time'); assert.equal(result.code, 137); assert.equal(result.cpuLimit.usageUsec, 3000001);
  assert.equal(h.killed(), 1); assert.equal(h.events.length, 1);
  assert.deepEqual(h.calls.find(call => call.argv[0] === 'kill').argv, ['kill', '--signal', 'KILL', name]);
});

test('编译阶段使用15秒预算，不套用运行阶段预算', async () => {
  const h = harness({ phase: 'compile', values: [4000000, 15000001] });
  const result = await h.run(); assert.equal(result.cpuLimit.limitUsec, LIMITS.compile.cpu * 1000000); assert.equal(h.killed(), 1);
});

test('主动返回137或伪造CPU输出均保持原结果，不改成超时', async () => {
  const result = { code: 137, reason: null, stdout: 'cpu_usec=999999999\nreceived=SIGXCPU\n', stderr: '', elapsed: 5000 };
  const h = harness({ values: [12000], result, finishAfterSample: true });
  assert.deepEqual(await h.run(), result); assert.equal(h.killed(), 0); assert.equal(h.events.length, 0);
});

test('CPU与OOM同时出现时不覆盖内存判定所需的原结果', async () => {
  const h = harness({ oom: true }); const result = await h.run();
  assert.equal(result.code, 137); assert.equal(result.reason, null); assert.equal(h.killed(), 1);
});

test('取消、输出上限与墙钟超时优先于CPU监测结果', async () => {
  for (const reason of ['cancel', 'output', 'time']) {
    const h = harness({ result: { code: null, reason, stdout: '', stderr: '' } });
    assert.equal((await h.run()).reason, reason);
  }
});

test('监测权限错误或错误范围会停止目标，不伪报CPU超时', async () => {
  const denied = harness({ readingError: Object.assign(new Error('denied'), { code: 'EACCES' }) });
  await assert.rejects(denied.run(), { code: 'EACCES' }); assert.equal(denied.killed(), 1);
  const scope = harness({ wrongGroup: '/user.slice/user-994.slice/user@994.service/app.slice' });
  await assert.rejects(scope.run(), { code: 'CPU_SCOPE_INVALID' }); assert.equal(scope.killed(), 1);
});

test('内核计数倒退时停止执行并报告错误', async () => {
  const h = harness({ values: [10000, 5000] });
  await assert.rejects(h.run(), { code: 'CPU_COUNTER_REVERSED' }); assert.equal(h.killed(), 1);
});

test('自然退出导致计数文件消失时，不把正常竞争误报监测故障', async () => {
  const h = harness({ missingAfterExit: true, result: { code: 0, reason: null, stdout: 'ok', stderr: '' } });
  assert.equal((await h.run()).code, 0); assert.equal(h.killed(), 0);
});

test('进程已退出但附着命令尚未关闭时，接受内核的deleted路径竞争', async () => {
  let resolve, inspected = 0;
  const attached = new Promise(done => { resolve = done; });
  const execute = async (program, args) => {
    if (args[0] === 'start') return attached;
    assert.equal(args[0], 'inspect'); inspected++;
    if (inspected === 2) resolve({ code: 0, reason: null, stdout: 'ok', stderr: '' });
    return { code: 0, reason: null, stdout: JSON.stringify(inspect(inspected === 1)) };
  };
  const result = await cpuLimitedCommand(config, config.podman, ['start', '--attach', '--interactive', name], {}, execute, {
    readFile: async () => '0::' + group + ' (deleted)\n', pause: async () => {}
  });
  assert.equal(result.code, 0); assert.equal(inspected, 2);
});

test('其他命令原样转交，基础执行器及容器参数未被替换', async () => {
  let called;
  const args = ['rm', '--force', '--ignore', name], options = { timeout: 20000 };
  await cpuLimitedCommand(config, config.podman, args, options, async (...value) => { called = value; return { code: 0 }; });
  assert.deepEqual(called, [config.podman, args, options]);
  assert.equal(CpuMeteredSandbox.prototype.stage, PodmanSandbox.prototype.stage);
  assert.equal(CpuMeteredSandbox.prototype.execute, PodmanSandbox.prototype.execute);
  assert.equal(CpuMeteredSandbox.prototype.preflight, PodmanSandbox.prototype.preflight);
  await assert.rejects(cpuLimitedCommand(config, config.podman, ['start', '--all'], {}, async () => {}), { code: 'CPU_START_SCOPE_INVALID' });
});
