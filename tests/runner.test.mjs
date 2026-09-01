import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { fixture, image } from './helpers.mjs';
import { JobManager } from '../runner/src/jobs.mjs';
import { createRunnerApp } from '../runner/src/app.mjs';
import { PodmanSandbox, containerOptions, verifyCgroups, LIMITS, command } from '../runner/src/podman.mjs';
const body = () => ({ id: randomUUID(), code: 'int main(){}', stdin: '', profileId: 'cpp17', image });
async function setup(t, adapter) {
  const { root } = await fixture(t);
  const config = { dataRoot: root, image, token: 'synthetic-runner-token-for-unit-tests', uid: 1001, gid: 1001, podman: '/usr/bin/podman', minFreeBytes: 0 };
  const manager = new JobManager(config, { cleanup: async () => {}, removeWork: async () => {}, ...adapter });
  await manager.init(); return { config, manager };
}

test('编译和运行参数均无网络、无特权、内存/进程/CPU上限；运行目录只读', () => {
  const cfg = { uid: 1001, gid: 1001 };
  for (const phase of ['compile', 'run']) {
    const args = containerOptions(cfg, `cpp-job-${randomUUID()}-${phase}`, phase, '/safe/job');
    for (const arg of ['--network=none', '--http-proxy=false', '--timeout', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--pids-limit', '--memory', '--cpus=1', '--log-driver=none']) assert.ok(args.includes(arg));
    assert.ok(args.includes(`/safe/job:/work:${phase === 'run' ? 'ro' : 'rw'},nosuid,nodev,Z`));
    assert.ok(!args.some(value => value.startsWith('--dns')), 'Podman 禁止 network=none 与 DNS 参数组合');
    verifyCgroups(`${LIMITS[phase].memory}\n${LIMITS[phase].pids}\n100000 100000\n0`, phase);
  }
  assert.throws(() => verifyCgroups('max\nmax\nmax 100000\nmax'), /未实际生效/);
  assert.throws(() => verifyCgroups('268435456\n16\n200000 100000\n0'), /未实际生效/);
});

test('取消请求先到达时，迟到的运行提交不会执行；接口必须持有内部令牌', async t => {
  let count = 0;
  const { config, manager } = await setup(t, { execute: async () => { count++; return { state: 'completed' }; } });
  const client = request(createRunnerApp(manager, config));
  const job = body();
  await client.post('/jobs').send(job).expect(401);
  await client.post(`/jobs/${job.id}/cancel`).set('Authorization', `Bearer ${config.token}`).send({}).expect(200);
  const response = await client.post('/jobs').set('Authorization', `Bearer ${config.token}`).send(job).expect(202);
  assert.equal(response.body.state, 'cancelled'); assert.equal(count, 0);
});

test('运行服务持久化去重、单槽位、主动停止与重启恢复', async t => {
  let count = 0;
  const { manager, config } = await setup(t, { execute: async (job, signal) => {
    count++;
    await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
    return { state: 'cancelled' };
  } });
  const job = body();
  await manager.submit(job);
  await manager.submit(job);
  await assert.rejects(manager.submit({ ...job, code: 'different' }), error => error.code === 'REQUEST_CONFLICT');
  await assert.rejects(manager.submit(body()), error => error.code === 'BUSY');
  const work = manager.current.promise;
  assert.equal((await manager.cancel(job.id)).state, 'stopping');
  await work;
  assert.equal((await manager.get(job.id)).state, 'cancelled'); assert.equal(count, 1);
  const recovered = new JobManager(config, { cleanup: async () => {}, removeWork: async () => {}, execute: async () => { throw new Error('should not run'); } });
  await recovered.init();
  assert.equal((await recovered.submit(job)).state, 'cancelled');
});

test('无法确认容器停止时保持停止中，禁止新任务，清理确认后才释放', async t => {
  let failed = true;
  const { manager } = await setup(t, { execute: async () => ({ state: 'completed', stdout: 'ok' }), cleanup: async () => { if (failed) throw new Error('simulated engine unavailable'); } });
  const job = body(); await manager.submit(job); await manager.current.promise;
  assert.equal((await manager.get(job.id)).state, 'stopping');
  await assert.rejects(manager.submit(body()), error => error.code === 'BUSY');
  failed = false; await manager.retryCleanup();
  assert.equal((await manager.get(job.id)).state, 'completed'); assert.equal(manager.current, null);
});

test('输出洪泛与墙钟超时会终止附着进程，不无限积累内存', async () => {
  const output = await command(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { outputLimit: 1024 });
  assert.equal(output.reason, 'output'); assert.equal(Buffer.byteLength(output.stdout), 1024);
  const timeout = await command(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 });
  assert.equal(timeout.reason, 'time');
});

test('编译失败绝不启动二进制；执行服务拒绝伪造镜像与路径', async t => {
  const { config } = await setup(t, {});
  const sandbox = new PodmanSandbox(config);
  const phases = [];
  sandbox.stage = async (job, phase) => { phases.push(phase); return { code: 1, stdout: '', stderr: 'main.cpp:1:1: error: invalid' }; };
  const result = await sandbox.execute(body(), new AbortController().signal, async () => {});
  assert.equal(result.state, 'compile_error'); assert.deepEqual(phases, ['compile']);
  await assert.rejects(sandbox.execute({ ...body(), image: 'evil' }, new AbortController().signal, async () => {}), /镜像/);
  assert.throws(() => sandbox.work('../../etc'), error => error.code === 'INVALID_ID');
});

test('rootless/cgroup/seccomp 任一不足，预检拒绝执行', async () => {
  const sandbox = new PodmanSandbox({ podman: '/usr/bin/podman' }, async () => ({ code: 0, stdout: JSON.stringify({ host: { security: { rootless: false, seccompEnabled: true }, cgroupVersion: 'v2' } }), stderr: '' }));
  await assert.rejects(sandbox.preflight(), /rootless/);
});
