import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function embedded(file, marker) {
  const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const body = new RegExp("<<'" + marker + "'\\n([\\s\\S]+)\\n" + marker + '\\n$').exec(text)?.[1];
  assert.ok(body);
  return { text, body, module: await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64')) };
}
const script = await embedded('../deploy/diagnose-compiler-cpu-20260831.sh', 'CPP_CPU_DIAG_NODE');
const verification = await embedded('../deploy/resume-compiler-containers-20260831-02.sh', 'CPP_COMPILER_CHECK_NODE');
const { PINS, PROBES, previousEvidence, inspectionSummary, probeCode, probeSummary, checkDiagnosticCompletion, workerSource } = script.module;
const image = 'sha256:' + 'a'.repeat(64), label = '0123456789ab';
const task = { label, unit: 'cpp-compiler-check-' + label + '.service' };
const record = (rows, status = 1) => ({ status, signal: null, stdout: rows.map(row => JSON.stringify(row)).join('\n') });
const previous = () => [
  { event: 'build-result', result: { code: 0, reason: null, signal: null } },
  ...Array.from({ length: 12 }, (_, i) => ({ event: 'pass', number: i + 1, details: i === 0 ? { image: { imageId: image }, inspect: { Id: image.slice(7) } } : {} })),
  ...verification.module.CASES.slice(0, 8).map((item, i) => ({ event: 'case-result', name: item.name, result: { state: i < 7 ? item.state : 'runtime_error', message: i === 7 ? '程序退出码：137' : '' } })),
  { event: 'error', code: 'CASE_RESULT_MISMATCH', phase: 'CPU 时间上限' },
  { event: 'remaining-containers', value: [] }
];
const header = 'pid=1 cpu_soft=3 cpu_hard=4 sigxcpu=24 sigkill=9 disposition=default\n';
const name = 'cpp-job-12345678-1234-1234-1234-123456789abc-run';

test('只接受已构建镜像、前12项通过且CPU返回137的已知中断', () => {
  const evidence = previousEvidence(record(previous()), task, verification.module.CASES);
  assert.equal(evidence.image.imageId, image);
  assert.equal(evidence.checksPassed, 12);
  assert.equal(evidence.cpu.state, 'runtime_error');
  for (const change of [
    rows => rows.filter(row => row.number !== 12),
    rows => rows.map(row => row.event === 'build-result' ? { ...row, result: { code: 1 } } : row),
    rows => rows.map(row => row.name === 'CPU 时间上限' ? { ...row, result: { state: 'time_limit' } } : row),
    rows => rows.map(row => row.event === 'error' ? { ...row, phase: '其他错误' } : row)
  ]) assert.throws(() => previousEvidence(record(change(previous())), task, verification.module.CASES));
});

test('不对未清理、完成、重复或被截断的旧记录启动新容器', () => {
  for (const addition of [
    { event: 'complete' }, { event: 'cleanup-unconfirmed' }, { event: 'container-state-unconfirmed' },
    { event: 'remaining-containers', value: [] }, { event: 'error', code: 'CASE_RESULT_MISMATCH', phase: 'CPU 时间上限' }
  ]) assert.throws(() => previousEvidence(record([...previous(), addition]), task, verification.module.CASES));
  const rows = previous(); rows.at(-1).value.push({ Id: 'unknown' });
  assert.throws(() => previousEvidence(record(rows), task, verification.module.CASES));
  assert.throws(() => previousEvidence({ status: 1, stdout: '{truncated' }, task, verification.module.CASES), SyntaxError);
  assert.throws(() => previousEvidence(record(previous()), { ...task, unit: 'p5js.service' }, verification.module.CASES));
});

test('退出观察保留OOM及真实退出信息，但不带出容器环境或命令', () => {
  const value = [{ Name: '/' + name, State: { Running: false, ExitCode: 137, OOMKilled: true, StartedAt: '2026-08-31T00:00:00Z', FinishedAt: '2026-08-31T00:00:01Z' }, Config: { Env: ['PASSWORD=hidden'], Cmd: ['private-command'] } }];
  const summary = inspectionSummary(value, name, 'run');
  assert.equal(summary.oomKilled, true); assert.equal(summary.exitCode, 137);
  assert.ok(!JSON.stringify(summary).includes('hidden')); assert.ok(!JSON.stringify(summary).includes('private-command'));
  assert.throws(() => inspectionSummary(value, 'other-container', 'run'), { code: 'INSPECT_STATE_INVALID' });
  assert.throws(() => inspectionSummary([value[0], value[0]], name, 'run'), { code: 'INSPECT_FORMAT' });
  delete value[0].State.OOMKilled;
  assert.throws(() => inspectionSummary(value, name, 'run'), { code: 'INSPECT_STATE_INVALID' });
});

test('区分CPU采样、捕获信号及主动返回137，不凭退出码推断原因', () => {
  const observed = [{ kind: 'inspect', phase: 'run', exitCode: 137, oomKilled: false }];
  const busy = probeSummary({ stdout: header + 'cpu_usec=1000\ncpu_usec=3751000\n', stderr: '', state: 'runtime_error', elapsed_ms: 4050 }, observed);
  assert.equal(busy.lastCpuUsec, 3751000); assert.equal(busy.reported.hard, 4); assert.equal(busy.state, 'runtime_error');
  const explicit = probeSummary({ stdout: header, stderr: '', state: 'runtime_error', elapsed_ms: 100 }, observed);
  assert.equal(explicit.lastCpuUsec, null); assert.equal(explicit.signalHandlerObserved, false);
  const caught = probeSummary({ stdout: header + 'cpu_usec=2800000\n', stderr: 'received=SIGXCPU\n', state: 'time_limit' }, []);
  assert.equal(caught.signalHandlerObserved, true);
  assert.ok(!Object.hasOwn(busy, 'cause'));
});

test('缺少CPU数据保留未知，倒退或越界采样拒绝解释', () => {
  assert.equal(probeSummary({ stdout: '', state: 'system_error' }, []).reported, null);
  assert.throws(() => probeSummary({ stdout: header + 'cpu_usec=3\ncpu_usec=2\n' }, []), { code: 'CPU_SAMPLES_INVALID' });
  assert.throws(() => probeSummary({ stdout: header + 'cpu_usec=99999999999999999999\n' }, []), { code: 'CPU_SAMPLES_INVALID' });
});

test('三个诊断程序固定且不修改任何资源限额或读取秘密文件', () => {
  for (const { mode } of PROBES) {
    const source = probeCode(mode);
    assert.ok(source.includes('#define PROBE_MODE ' + mode + '\n'));
    assert.ok(source.includes('getrlimit(RLIMIT_CPU'));
    assert.ok(source.includes('getrusage(RUSAGE_SELF'));
    assert.ok(!/\b(setrlimit|prlimit|system|popen|execve|getenv)\s*\(/.test(source));
  }
  for (const mode of [-1, 3, '0', '0\nunsafe', null]) assert.throws(() => probeCode(mode), { code: 'PROBE_MODE_INVALID' });
});

test('诊断完整性不要求伪造time_limit；三个样本与关闭开关必须齐全', () => {
  const rows = PROBES.map(item => ({ event: 'probe', name: item.name, summary: { state: 'runtime_error', reported: { pid: 1, soft: 3, hard: 4 }, observations: [{ kind: 'attach', phase: 'run', code: 137 }] } }));
  rows.push({ event: 'complete', probes: 3, containers: 0, runEnabled: false });
  assert.equal(checkDiagnosticCompletion(record(rows, 0)).probes.length, 3);
  for (const invalid of [rows.slice(1), [...rows, rows[0]], [...rows, { event: 'error' }], rows.map(row => row.event === 'complete' ? { ...row, runEnabled: true } : row)]) assert.throws(() => checkDiagnosticCompletion(record(invalid, 0)));
  assert.throws(() => checkDiagnosticCompletion(record(rows, 1)));
});

test('序列化后的用户服务程序可以解析；非Linux机器在执行容器前拒绝', () => {
  const source = workerSource('cpp-cpu-diagnostic-' + label + '.service', label, image, label);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.throws(() => workerSource('p5js.service', label, image, label), { code: 'WORKER_SCOPE_INVALID' });
  if (process.platform !== 'linux') {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 1); assert.ok(result.stdout.includes('WORKER_USER_INVALID'));
    assert.equal(result.stderr, '');
  }
});

test('旧材料摘要、原执行器与构建副本保持，辅助函数导出无入口副作用', async () => {
  for (const pin of Object.values(PINS)) {
    const bytes = fs.readFileSync(new URL('../' + pin.file, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha);
  }
  const replaced = new Set(['runner/src/podman.mjs', 'backend/src/validation.mjs', 'shared/contracts.mjs']);
  for (const [file, hash] of Object.entries(verification.module.SOURCE_HASHES)) {
    const actual = createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex');
    if (replaced.has(file)) assert.notEqual(actual, hash, file);
    else assert.equal(actual, hash, file);
  }
  const extra = '\nexport { loadChecks, old, imageHelpers, accountHelpers, repairHelpers, rootlessHelpers, diagnosticHelpers };\nexport function bindDiagnostic(folder, fd){record=folder;logFd=fd;}';
  const helpers = await import('data:text/javascript;base64,' + Buffer.from(verification.body + extra).toString('base64'));
  assert.equal(typeof helpers.loadChecks, 'function'); assert.equal(typeof helpers.bindDiagnostic, 'function'); assert.equal(helpers.old, undefined);
  assert.ok(!script.text.includes('\r')); assert.ok(!script.text.startsWith('\ufeff'));
});
