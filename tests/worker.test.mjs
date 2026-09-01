import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, image } from './helpers.mjs';
import { RunWorker } from '../backend/src/worker.mjs';
import { JobManager } from '../runner/src/jobs.mjs';
import { createRunnerApp } from '../runner/src/app.mjs';

test('业务队列到独立执行 HTTP 接口再到历史结果的完整协议', async t => {
  const { service, student, root, config } = await fixture(t);
  const runnerConfig = { dataRoot: root, image, token: 'synthetic-internal-token-for-http-test' };
  let executions = 0;
  const manager = new JobManager(runnerConfig, { cleanup: async () => {}, removeWork: async () => {}, execute: async (job, signal, onPhase) => {
    executions++; assert.equal(job.stdin, '12 30'); await onPhase('running');
    return { state: 'completed', stdout: '42\n', elapsed_ms: 12 };
  } });
  await manager.init();
  const server = createRunnerApp(manager, runnerConfig).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  config.runnerUrl = `http://127.0.0.1:${server.address().port}`; config.runnerToken = runnerConfig.token;
  const project = await service.createProject(student, { name: 'protocol' });
  const run = await service.saveAndRun(student, project.id, { ...project, stdin: '12 30', requestId: randomUUID() });
  const worker = new RunWorker(service, config);
  await worker.tick();
  if (manager.current) await manager.current.promise;
  await worker.tick();
  const result = await service.getRun(student, run.id);
  assert.equal(result.state, 'completed'); assert.equal(result.stdout, '42\n'); assert.equal(executions, 1);
  const history = await service.runs(student, project.id);
  assert.equal(history[0].id, run.id); assert.equal(history[0].stdout, undefined);
});

test('网络中断不能冒充已停止或释放槽位', async t => {
  const { service, student, config } = await fixture(t);
  const project = await service.createProject(student, { name: 'network' });
  const run = await service.saveAndRun(student, project.id, { ...project, requestId: randomUUID() });
  const worker = new RunWorker(service, config);
  worker.request = async () => { throw new Error('simulated network outage'); };
  await worker.tick();
  assert.equal((await service.getRun(student, run.id)).state, 'compiling');
  await service.stopRun(student, run.id); await worker.tick();
  assert.equal((await service.getRun(student, run.id)).state, 'stopping');
  assert.equal((await service.nextRun()).id, run.id);
});
