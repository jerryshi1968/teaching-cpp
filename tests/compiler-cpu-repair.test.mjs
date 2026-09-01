import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function embedded(file, marker) {
  const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const body = new RegExp("<<'" + marker + "'\\n([\\s\\S]+)\\n" + marker + '\\n$').exec(text)?.[1];
  assert.ok(body); return import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
}
const repair = await embedded('../deploy/repair-compiler-cpu-20260831.sh', 'CPP_CPU_REPAIR_NODE');
const original = await embedded('../deploy/resume-compiler-containers-20260831-02.sh', 'CPP_COMPILER_CHECK_NODE');
const image = await embedded('../deploy/prepare-gcc-base-image-20260831.sh', 'CPP_GCC_IMAGE_NODE');
const offline = await embedded('../deploy/import-gcc-base-image-20260831.sh', 'CPP_GCC_IMPORT_NODE');
const { patchEntry, MODULE_BASE64, MODULE_SHA, SERVER_BEFORE, SERVER_AFTER, IMAGE, EXTRA_CASES, checkDiagnosis, buildWorkerSource, checkVerification } = repair;
const sha = value => createHash('sha256').update(value).digest('hex');
const cases = [...original.CASES, ...EXTRA_CASES];
const label = '0123456789ab', job = '12345678-1234-1234-1234-123456789abc';

function diagnosis() {
  return { stage: 'cpu-exit-diagnostic-collected', previous: '/var/www/teaching-cpp-backend/backups/compiler-check-02-PRb5s6', runEnabled: false, final: { image: IMAGE, containers: 0, runEnabled: false }, probes: [0, 1, 2].map(mode => ({ mode, summary: {
    state: mode === 1 ? 'time_limit' : 'runtime_error', signalHandlerObserved: mode === 1, lastCpuUsec: [3763405, 2762565, null][mode],
    reported: { pid: 1, soft: 3, hard: 4, disposition: 'default' },
    observations: [{ kind: 'attach', phase: 'run', reason: null, signal: null }, { kind: 'inspect', phase: 'run', exitCode: mode === 1 ? 152 : 137, running: false, oomKilled: false }]
  } })) };
}
function events() {
  const value = { name: 'cpp-job-' + job + '-run', phase: 'run', usageUsec: 3012345, limitUsec: 3000000 };
  return [
    ...Array.from({ length: 18 }, (_, i) => ({ event: 'pass', number: i + 1 })),
    ...cases.map(item => ({ event: 'case-result', name: item.name, result: { id: job, state: item.state, stdout: item.output || '', stderr: '', compiler_output: item.state === 'compile_error' ? 'error: invalid syntax' : '' } })),
    { event: 'cpu-limit', value },
    { event: 'complete', checks: 18, containers: 0, runEnabled: false, image: { imageId: IMAGE }, cpuEvents: [value] }
  ];
}
const record = rows => ({ status: 0, signal: null, stdout: rows.map(row => JSON.stringify(row)).join('\n') });

test('安装负载与本地计量模块一致，入口只替换一条导入，其他字节保持', () => {
  const payload = Buffer.from(MODULE_BASE64, 'base64');
  assert.equal(sha(payload), MODULE_SHA);
  assert.ok(payload.equals(fs.readFileSync(new URL('../runner/src/cpu-budget.mjs', import.meta.url))));
  const current = fs.readFileSync(new URL('../runner/src/server.mjs', import.meta.url));
  const before = Buffer.from(current.toString().replace("import { CpuMeteredSandbox as PodmanSandbox } from './cpu-budget.mjs';", "import { PodmanSandbox } from './podman.mjs';"));
  assert.equal(sha(before), SERVER_BEFORE); assert.equal(sha(current), SERVER_AFTER); assert.ok(patchEntry(before).equals(current));
  assert.throws(() => patchEntry(Buffer.concat([before, Buffer.from('\n')])), { code: 'RUNNER_ENTRY_CHANGED' });
});

test('诊断必须匹配真实CPU硬限结果、信号对照及非OOM状态', () => {
  checkDiagnosis(diagnosis());
  for (const mutate of [
    value => { value.probes[0].summary.observations[1].oomKilled = true; },
    value => { value.probes[0].summary.lastCpuUsec = 10000; },
    value => { value.probes[1].summary.signalHandlerObserved = false; },
    value => { value.probes[2].summary.state = 'time_limit'; },
    value => { value.final.image = image.PIN.configDigest; },
    value => { value.runEnabled = true; }
  ]) { const value = diagnosis(); mutate(value); assert.throws(() => checkDiagnosis(value)); }
});

test('工作程序复用指定教学镜像，删除构建调用，保留隔离与原16项用例', () => {
  const source = original.workerSource('cpp-compiler-check-' + label + '.service', label, image.PIN, offline.DIFF_IDS, image.checkHostInfo, image.checkSpace, offline.checkLoadedImage);
  const patched = buildWorkerSource(source, label, original.CASES);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.ok(patched.includes('const CASES=' + JSON.stringify(cases) + ';'));
  assert.ok(patched.includes("const imageId = '" + IMAGE + "'"));
  assert.ok(patched.includes("CpuMeteredSandbox: PodmanSandbox"));
  assert.ok(patched.includes('CPU_BUDGET_NOT_OBSERVED'));
  assert.ok(!patched.includes('const build = await command('));
  assert.ok(!patched.includes("fs.mkdirSync(area + '/build'"));
  for (const line of source.split('\n').filter(line => /^\s*\/\//.test(line) || line.includes('/*'))) assert.ok(patched.includes(line), line);
  assert.throws(() => buildWorkerSource(source.replace('const CASES=', 'const WRONG='), label, original.CASES), { code: 'WORKER_PATCH_AMBIGUOUS' });
});

test('CPU必须有绑定本次任务的内核计量事件，不能仅凭time_limit或通过数量验收', () => {
  checkVerification(record(events()), cases, original.checkCase);
  assert.throws(() => checkVerification(record(events().filter(row => row.event !== 'cpu-limit')), cases, original.checkCase), { code: 'CPU_BUDGET_NOT_OBSERVED' });
  const other = events(); other.find(row => row.event === 'cpu-limit').value.name = 'other';
  assert.throws(() => checkVerification(record(other), cases, original.checkCase), { code: 'CPU_BUDGET_NOT_OBSERVED' });
  const short = events(); short.find(row => row.event === 'cpu-limit').value.usageUsec = 2999999;
  assert.throws(() => checkVerification(record(short), cases, original.checkCase), { code: 'CPU_BUDGET_NOT_OBSERVED' });
});

test('剩余内存、输出、取消或137误报对照失败时，不能发布入口', () => {
  for (const name of ['主动返回 137 不误报超时', '伪造 CPU 输出不影响分类', ...original.CASES.filter(item => ['memory_limit', 'output_limit', 'cancelled'].includes(item.state)).map(item => item.name)]) {
    const rows = events(); rows.find(row => row.event === 'case-result' && row.name === name).result.state = 'system_error';
    assert.throws(() => checkVerification(record(rows), cases, original.checkCase));
  }
  assert.throws(() => checkVerification(record([...events(), { event: 'error', code: 'CPU_SCOPE_INVALID' }]), cases, original.checkCase), { code: 'CPU_SCOPE_INVALID' });
});

test('完整序列化用户程序在Windows上先拒绝，不执行Linux操作', { skip: process.platform !== 'win32' }, () => {
  const base = original.workerSource('cpp-compiler-check-' + label + '.service', label, image.PIN, offline.DIFF_IDS, image.checkHostInfo, image.checkSpace, offline.checkLoadedImage);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', buildWorkerSource(base, label, original.CASES)], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).code, 'WORKER_USER_INVALID');
});
