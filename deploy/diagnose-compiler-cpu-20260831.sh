#!/usr/bin/env bash
# 复用已构建的教学镜像，只运行三个固定诊断程序；不改应用代码、限额或网页运行开关。
# 保留旧记录和镜像；所有编译、程序执行及容器清理均限于 cpp-runner 的 rootless 环境。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux && test "$(id -u)" -eq 0 || { printf '请在 Linux 服务器原来的 root 会话执行。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --diagnose-compiler-cpu <<'CPP_CPU_DIAG_NODE'
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const NODE = ROOT + '/tools/node/bin/node';
const PREVIOUS = ROOT + '/backups/compiler-check-02-PRb5s6';
const LOCK = ROOT + '/backups/compiler-cpu-diagnostic.lock';
export const PINS = Object.freeze({
  verification: { file: 'deploy/resume-compiler-containers-20260831-02.sh', sha: '814b2f79e5c25e95a65fdb7796d2b38f488a2c32009e29ee3ab7b14c147eb116', marker: 'CPP_COMPILER_CHECK_NODE' },
  image: { file: 'deploy/prepare-gcc-base-image-20260831.sh', sha: 'fe0332f60b308410b871774f7de67c195cbed53d8ce47f89fb970d833492015b', marker: 'CPP_GCC_IMAGE_NODE' },
  offline: { file: 'deploy/import-gcc-base-image-20260831.sh', sha: 'e60a156fcfee77ee2c9ab26cbe5c43099d25b0e2eccdd7552daba5df387e8fd6', marker: 'CPP_GCC_IMPORT_NODE' }
});
export const PROBES = Object.freeze([
  { name: '默认信号行为的 CPU 忙循环', mode: 0 },
  { name: '捕获 SIGXCPU 后退出的对照程序', mode: 1 },
  { name: '主动返回 137 的短程序', mode: 2 }
]);
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus', TMPDIR: HOME_DIR + '/tmp' };
let record, logFd, lockFd, checks;
let phase = '初始检查';
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(value) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'CPU_DIAGNOSTIC_FAILED'; }
function log(value) { const line = new Date().toISOString() + ' ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n'; process.stdout.write(line); if (logFd !== undefined) fs.writeSync(logFd, line); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(value) { phase = value; log(value); }
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function readPinned(pin) {
  const file = ROOT + '/' + pin.file, stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && stat.nlink === 1 && !(stat.mode & 0o022) && stat.size < 256 * 1024 && fs.realpathSync(file) === file, 'HELPER_FILE_UNSAFE');
  const bytes = fs.readFileSync(file);
  ensure(createHash('sha256').update(bytes).digest('hex') === pin.sha, 'HELPER_CHANGED');
  return bytes.toString('utf8');
}
async function loadModule(pin, extra = '') {
  ensure(/^[A-Z_]+$/.test(pin.marker), 'HELPER_MARKER_INVALID');
  const body = new RegExp("<<'" + pin.marker + "'\\n([\\s\\S]+)\\n" + pin.marker + '\\n$').exec(readPinned(pin))?.[1];
  ensure(body, 'HELPER_FORMAT');
  return import('data:text/javascript;base64,' + Buffer.from(body + extra).toString('base64'));
}
export function previousEvidence(value, task, cases) {
  ensure(value?.status === 1 && !value.signal && typeof value.stdout === 'string' && value.stdout.length < 12 * 1024 ** 2, 'PREVIOUS_RESULT_INVALID');
  ensure(/^[a-f0-9]{12}$/.test(task?.label || '') && task.unit === 'cpp-compiler-check-' + task.label + '.service', 'PREVIOUS_TASK_INVALID');
  const rows = value.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const passes = rows.filter(row => row.event === 'pass'), results = rows.filter(row => row.event === 'case-result');
  const builds = rows.filter(row => row.event === 'build-result'), errors = rows.filter(row => row.event === 'error');
  const remaining = rows.filter(row => row.event === 'remaining-containers');
  ensure(passes.length === 12 && passes.every((row, i) => row.number === i + 1) && results.length === 8, 'PREVIOUS_PROGRESS_CHANGED');
  ensure(results.every((row, i) => row.name === cases[i]?.name && row.result?.state === (i < 7 ? cases[i].state : 'runtime_error')), 'PREVIOUS_CASES_CHANGED');
  ensure(results[7].name === 'CPU 时间上限' && results[7].result.message === '程序退出码：137', 'PREVIOUS_CPU_RESULT_CHANGED');
  ensure(builds.length === 1 && builds[0].result?.code === 0 && !builds[0].result.reason && !builds[0].result.signal, 'PREVIOUS_IMAGE_BUILD_UNCONFIRMED');
  ensure(errors.length === 1 && errors[0].code === 'CASE_RESULT_MISMATCH' && errors[0].phase === 'CPU 时间上限', 'PREVIOUS_FAILURE_CHANGED');
  ensure(remaining.length === 1 && Array.isArray(remaining[0].value) && remaining[0].value.length === 0 && !rows.some(row => ['complete', 'container-state-unconfirmed', 'cleanup-unconfirmed'].includes(row.event)), 'PREVIOUS_CLEANUP_UNCONFIRMED');
  const image = passes[0].details?.image, inspect = passes[0].details?.inspect;
  ensure(/^sha256:[a-f0-9]{64}$/.test(image?.imageId || '') && inspect, 'PREVIOUS_IMAGE_RECORD_INVALID');
  return { image, inspect, task, cpu: results[7].result, checksPassed: passes.length };
}
export function inspectionSummary(rows, name, phase) {
  ensure(['compile', 'run'].includes(phase) && Array.isArray(rows) && rows.length === 1, 'INSPECT_FORMAT');
  const item = rows[0], state = item?.State;
  ensure(String(item?.Name || '').replace(/^\//, '') === name && state && typeof state.Running === 'boolean' && typeof state.OOMKilled === 'boolean' && Number.isInteger(state.ExitCode), 'INSPECT_STATE_INVALID');
  return { phase, running: state.Running, exitCode: state.ExitCode, oomKilled: state.OOMKilled,
    startedAt: typeof state.StartedAt === 'string' ? state.StartedAt.slice(0, 64) : null,
    finishedAt: typeof state.FinishedAt === 'string' ? state.FinishedAt.slice(0, 64) : null };
}
export function probeCode(mode) {
  ensure([0, 1, 2].includes(mode), 'PROBE_MODE_INVALID');
  return '#define PROBE_MODE ' + mode + '\n' + String.raw`#include <cstdio>
#include <csignal>
#include <sys/resource.h>
#include <unistd.h>

extern "C" void cpuSignal(int) {
    const char text[] = "received=SIGXCPU\n";
    (void)!write(STDERR_FILENO, text, sizeof(text) - 1);
    _exit(152);
}
int main() {
    struct rlimit limit{};
    struct sigaction initial{};
    if (getrlimit(RLIMIT_CPU, &limit) != 0 || sigaction(SIGXCPU, nullptr, &initial) != 0) return 90;
    const char* disposition = initial.sa_handler == SIG_DFL ? "default" : initial.sa_handler == SIG_IGN ? "ignored" : "handler";
    std::printf("pid=%ld cpu_soft=%llu cpu_hard=%llu sigxcpu=%d sigkill=%d disposition=%s\n", (long)getpid(), (unsigned long long)limit.rlim_cur, (unsigned long long)limit.rlim_max, SIGXCPU, SIGKILL, disposition);
    std::fflush(stdout);
    if (PROBE_MODE == 2) return 137;
    if (PROBE_MODE == 1) {
        struct sigaction action{};
        action.sa_handler = cpuSignal;
        sigemptyset(&action.sa_mask);
        if (sigaction(SIGXCPU, &action, nullptr) != 0) return 91;
    }
    long long next = 0;
    for (;;) {
        for (unsigned i = 0; i < 100000; ++i) asm volatile("" ::: "memory");
        struct rusage usage{};
        if (getrusage(RUSAGE_SELF, &usage) != 0) return 92;
        const long long usec = ((long long)usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000000LL + usage.ru_utime.tv_usec + usage.ru_stime.tv_usec;
        if (usec >= next) {
            std::printf("cpu_usec=%lld\n", usec);
            std::fflush(stdout);
            next = usec + 250000;
        }
    }
}
`;
}
export function probeSummary(result, observations) {
  const text = String(result?.stdout || '');
  ensure(text.length <= 256 * 1024 && Array.isArray(observations), 'PROBE_OUTPUT_INVALID');
  const header = /^pid=(\d+) cpu_soft=(\d+) cpu_hard=(\d+) sigxcpu=(\d+) sigkill=(\d+) disposition=(default|ignored|handler)$/m.exec(text);
  const samples = [...text.matchAll(/^cpu_usec=(\d+)$/gm)].map(match => Number(match[1]));
  ensure(samples.every((value, i) => Number.isSafeInteger(value) && value >= 0 && (!i || value >= samples[i - 1])), 'CPU_SAMPLES_INVALID');
  return { state: result?.state ?? null, elapsedMs: result?.elapsed_ms ?? null,
    reported: header ? { pid: Number(header[1]), soft: Number(header[2]), hard: Number(header[3]), sigxcpu: Number(header[4]), sigkill: Number(header[5]), disposition: header[6] } : null,
    sampleCount: samples.length, lastCpuUsec: samples.length ? samples.at(-1) : null,
    signalHandlerObserved: /^received=SIGXCPU$/m.test(String(result?.stderr || '')), observations };
}
export function checkDiagnosticCompletion(result) {
  ensure(result?.status === 0 && !result.signal && typeof result.stdout === 'string', 'WORKER_NOT_COMPLETED');
  const rows = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  ensure(!rows.some(row => ['error', 'cleanup-unconfirmed', 'container-state-unconfirmed'].includes(row.event)), 'DIAGNOSTIC_INCOMPLETE');
  const probes = rows.filter(row => row.event === 'probe'), complete = rows.filter(row => row.event === 'complete');
  ensure(probes.length === PROBES.length && probes.every((row, i) => row.name === PROBES[i].name && row.summary?.reported?.pid === 1 && row.summary.reported.soft === 3 && row.summary.reported.hard === 4 && row.summary.observations.some(item => item.kind === 'attach' && item.phase === 'run')), 'PROBE_EVIDENCE_INCOMPLETE');
  ensure(complete.length === 1 && complete[0].probes === PROBES.length && complete[0].containers === 0 && complete[0].runEnabled === false, 'DIAGNOSTIC_INCOMPLETE');
  return { probes, final: complete[0] };
}
async function cpuWorker(unit, label, teaching, previousLabel) {
  const { randomUUID } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  const area = HOME_DIR + '/cpu-diagnostic-' + label;
  const call = args => execFileSync('/usr/bin/podman', ['--remote=false', ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
  const assertEmpty = () => ensure(JSON.parse(call(['ps', '--all', '--external', '--format=json'])).length === 0, 'CONTAINERS_REMAIN');
  let release, timer, sandbox, activeJob, confirmed = false;
  try {
    ensure(process.platform === 'linux' && process.getuid() === 994 && process.getgid() === 991, 'WORKER_USER_INVALID');
    const group = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
    ensure(group.startsWith('/user.slice/user-994.slice/user@994.service/') && group.endsWith('/' + unit), 'WORKER_CGROUP_INVALID');
    ensure(/^NoNewPrivs:\s+0\s*$/m.test(fs.readFileSync('/proc/self/status', 'utf8')), 'MAPPING_HELPERS_BLOCKED');
    const verification = await loadModule(PINS.verification), image = await loadModule(PINS.image), offline = await loadModule(PINS.offline);
    for (const [file, hash] of Object.entries(verification.SOURCE_HASHES)) verification.checkSource(ROOT + '/' + file, hash);
    const { acquireInstanceLock } = await import('file://' + ROOT + '/runner/src/instance-lock.mjs');
    release = await acquireInstanceLock(994); confirmed = true;
    image.checkHostInfo(JSON.parse(call(['info', '--format=json'])), 2); assertEmpty();
    offline.checkLoadedImage(JSON.parse(call(['image', 'inspect', image.PIN.configDigest.slice(7)]))[0], image.PIN, offline.DIFF_IDS);
    verification.checkTeachingImage(JSON.parse(call(['image', 'inspect', teaching.slice(7)]))[0], teaching, image.PIN, offline.DIFF_IDS, previousLabel);
    const disk = () => { const stat = fs.statfsSync(HOME_DIR), bytes = stat.bavail * stat.bsize; image.checkSpace(bytes, false); return Math.floor(bytes / 1024 ** 2); };
    disk();
    const started = Date.now();
    timer = setInterval(() => { try { emit({ event: 'progress', seconds: Math.floor((Date.now() - started) / 1000), freeMiB: disk() }); } catch { emit({ event: 'error', code: 'DISK_HEADROOM_INSUFFICIENT' }); process.exit(1); } }, 15000);
    fs.mkdirSync(area, { mode: 0o700 }); fs.mkdirSync(area + '/work', { mode: 0o700 });
    const { command, PodmanSandbox } = await import('file://' + ROOT + '/runner/src/podman.mjs');
    const config = { image: teaching, uid: 994, gid: 991, podman: '/usr/bin/podman', dataRoot: area, minFreeBytes: 4 * 1024 ** 3 };
    let observations = [];
    const tracked = async (executable, args, options) => {
      const result = await command(executable, args, options);
      if (activeJob) {
        const names = sandbox.names(activeJob), name = args.at(-1), index = names.indexOf(name);
        if (index !== -1 && args[0] === 'start') observations.push({ kind: 'attach', phase: index ? 'run' : 'compile', code: result.code, signal: result.signal, reason: result.reason });
        if (index !== -1 && args[0] === 'inspect' && !result.reason && result.code === 0) observations.push({ kind: 'inspect', ...inspectionSummary(JSON.parse(result.stdout), name, index ? 'run' : 'compile') });
      }
      return result;
    };
    sandbox = new PodmanSandbox(config, tracked);
    emit({ event: 'stage', name: '复核原执行器的实际容器限额；不改变参数' });
    await sandbox.preflight(); assertEmpty();
    for (const item of PROBES) {
      disk(); emit({ event: 'stage', name: item.name }); observations = []; activeJob = randomUUID();
      const job = { id: activeJob, code: probeCode(item.mode), stdin: '', profileId: 'cpp17', image: teaching };
      let result;
      try { result = await sandbox.execute(job, new AbortController().signal, async () => {}); }
      finally { await sandbox.cleanup(activeJob); await sandbox.removeWork(activeJob); }
      activeJob = undefined; assertEmpty();
      const summary = probeSummary(result, observations);
      emit({ event: 'probe', name: item.name, mode: item.mode, summary, result });
      ensure(summary.reported && observations.some(row => row.kind === 'attach' && row.phase === 'run'), 'PROBE_NOT_RUN');
    }
    ensure(fs.readdirSync(area + '/work').length === 0, 'WORK_DIRECTORIES_REMAIN');
    assertEmpty(); const info = JSON.parse(call(['info', '--format=json'])); image.checkHostInfo(info, 2);
    emit({ event: 'complete', probes: PROBES.length, image: teaching, area, containers: 0, runEnabled: false });
  } catch (error) {
    emit({ event: 'error', code: safeCode(error.code), detail: String(error.message || '').slice(0, 4000) });
    if (sandbox && activeJob) { try { await sandbox.cleanup(activeJob); await sandbox.removeWork(activeJob); } catch { emit({ event: 'cleanup-unconfirmed' }); } }
    if (confirmed) { try { emit({ event: 'remaining-containers', value: JSON.parse(call(['ps', '--all', '--external', '--format=json'])) }); } catch { emit({ event: 'container-state-unconfirmed' }); } }
    process.exitCode = 1;
  } finally { clearInterval(timer); if (release) release(); }
}
export function workerSource(unit, label, teaching, previousLabel) {
  ensure(/^[a-f0-9]{12}$/.test(label) && unit === 'cpp-cpu-diagnostic-' + label + '.service' && /^sha256:[a-f0-9]{64}$/.test(teaching) && /^[a-f0-9]{12}$/.test(previousLabel), 'WORKER_SCOPE_INVALID');
  return '(async()=>{const fs=await import("node:fs");const {createHash}=await import("node:crypto");const ROOT=' + JSON.stringify(ROOT) + ',HOME_DIR=' + JSON.stringify(HOME_DIR) + ',PINS=' + JSON.stringify(PINS) + ',PROBES=' + JSON.stringify(PROBES) + ';\n' +
    [ensure, safeCode, readPinned, loadModule, inspectionSummary, probeCode, probeSummary].map(fn => fn.toString()).join('\n') + '\nawait (' + cpuWorker.toString() + ')(' + [unit, label, teaching, previousLabel].map(value => JSON.stringify(value)).join(',') + ');})().catch(()=>{process.stderr.write("WORKER_BOOTSTRAP_FAILED\\n");process.exitCode=1;});';
}
function observe(unit) {
  ensure(/^cpp-(?:compiler-check|cpu-diagnostic)-[a-f0-9]{12}\.service$/.test(unit), 'WORKER_SCOPE_INVALID');
  let exit = 0, output;
  try { output = execFileSync('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', 'show', ...['LoadState', 'ActiveState', 'MainPID', 'ControlPID'].map(key => '--property=' + key), '--', unit], { env: runnerEnv, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { exit = error.status; output = String(error.stdout || ''); }
  const processes = { complete: true, pids: [] };
  for (const pid of fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name))) {
    try { const group = fs.readFileSync('/proc/' + pid + '/cgroup', 'utf8'); if (group.includes('/user.slice/user-994.slice/user@994.service/') && group.split(/[\n/]/).includes(unit)) processes.pids.push(Number(pid)); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) processes.complete = false; }
  }
  return { unit, exit, values: output.trim() ? checks.rootlessHelpers.parseProperties(output) : {}, processes };
}
async function runWorker(teaching, previousLabel) {
  const label = randomBytes(6).toString('hex'), unit = 'cpp-cpu-diagnostic-' + label + '.service'; save('worker-unit.json', { unit, label });
  const source = workerSource(unit, label, teaching, previousLabel);
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + unit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=300', '--property=TimeoutStopSec=30', '--property=WorkingDirectory=' + HOME_DIR, '/usr/bin/env', '-i', ...Object.entries(runnerEnv).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', source];
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/setpriv', args, { env: runnerEnv, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8'); let stdout = '', stderr = '', pending = '';
    child.stdout.on('data', bytes => {
      const text = decoder.write(bytes); stdout = (stdout + text).slice(-2 * 1024 ** 2); pending += text;
      for (;;) {
        const at = pending.indexOf('\n'); if (at < 0) break;
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try {
          const row = JSON.parse(line);
          if (row.event === 'stage') log('诊断阶段：' + checks.diagnosticHelpers.redact(row.name, 100));
          if (row.event === 'progress') log({ progress: row.seconds, freeMiB: row.freeMiB });
          if (row.event === 'probe') { log('诊断结果：' + checks.diagnosticHelpers.redact(row.name, 100)); log(JSON.stringify(row.summary)); log('程序输出（诊断样本）：\n' + checks.diagnosticHelpers.redact((row.result?.stdout || '') + (row.result?.stderr || '') + (row.result?.compiler_output || ''), 4000)); }
          if (row.event === 'error') { log('诊断错误码：' + safeCode(row.code)); if (row.detail) log('错误摘要：' + checks.diagnosticHelpers.redact(row.detail, 4000)); }
        } catch { /* 完整输出保存在本次私有记录，解析异常不冒充成功。 */ }
      }
    });
    child.stdout.on('end', () => { stdout += decoder.end(); });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-512 * 1024); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'WORKER_START_FAILED' })));
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  save('worker-output.json', result);
  if (result.status !== 0 && result.stderr) log('用户服务错误摘要：\n' + checks.diagnosticHelpers.redact(result.stderr, 4000));
  const deadline = Date.now() + 5000;
  for (;;) {
    const state = observe(unit);
    try { checks.old.checkInactiveUnit(state.exit, state.values, state.processes); save('worker-final-state.json', state); break; }
    catch (error) { if (Date.now() >= deadline) { save('worker-state-unconfirmed.json', state); throw error; } await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  return checkDiagnosticCompletion(result);
}
async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  for (const [file, uid, mode] of [[ROOT, 0, 0o755], [ROOT + '/logs', 995, 0o750], [ROOT + '/backups', 0, 0o700]]) { const stat = fs.lstatSync(file); ensure(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === mode && fs.realpathSync(file) === file, 'DIRECTORY_UNEXPECTED'); }
  ensure(!exists(LOCK), 'DIAGNOSTIC_ALREADY_STARTED_DO_NOT_REPEAT');
  const logPath = ROOT + '/logs/compiler-cpu-diagnostic-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600); log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/compiler-cpu-diagnostic-'); log('私有操作记录：' + record);
  step('只读预检：上次 12 项通过记录、CPU 退出错误、现有镜像和网站');
  // 只复用已交付脚本的函数；本入口参数不同，不执行其构建、导入或修复流程。
  checks = await loadModule(PINS.verification, '\nexport { loadChecks, old, imageHelpers, accountHelpers, repairHelpers, rootlessHelpers, diagnosticHelpers };\nexport function bindDiagnostic(folder, fd){record=folder;logFd=fd;}');
  checks.bindDiagnostic(record, logFd); await checks.loadChecks();
  const { old, imageHelpers, accountHelpers, repairHelpers, diagnosticHelpers } = checks;
  old.directory(PREVIOUS, 0, 0o700); old.directory(HOME_DIR, 994, 0o700); old.directory('/run/user/994', 994, 0o700);
  const oldLock = old.readJson(ROOT + '/backups/compiler-check-02.lock');
  ensure(oldLock.record === PREVIOUS && Number.isSafeInteger(oldLock.pid) && oldLock.pid > 1 && !exists('/proc/' + oldLock.pid), 'PREVIOUS_CONTROLLER_NOT_CONFIRMED_STOPPED');
  const previous = previousEvidence(old.readJson(PREVIOUS + '/worker-output.json'), old.readJson(PREVIOUS + '/worker-unit.json'), checks.CASES);
  checks.checkTeachingImage(previous.inspect, previous.image.imageId, imageHelpers.PIN, old.DIFF_IDS, previous.task.label);
  const task = diagnosticHelpers.task(previous.task); old.directory(task.area, 994, 0o700); old.directory(task.area + '/build', 994, 0o700);
  ensure(old.hash(task.area + '/build/Containerfile') === 'c20ac222f94847b5aa205fc9bede86158f97eab97afda06baef24fbb267d27f1' && checks.normalizeImageId(old.read(task.area + '/build/image.id').toString('utf8')) === previous.image.imageId, 'PREVIOUS_BUILD_FILES_CHANGED');
  const state = observe(previous.task.unit); old.checkInactiveUnit(state.exit, state.values, state.processes);
  const post = old.readJson(PREVIOUS + '/website-postcheck.json'); ensure(post.unchanged === true && post.runEnabled === false && !exists(PREVIOUS + '/result.json'), 'PREVIOUS_POSTCHECK_CHANGED');
  save('previous-evidence.json', { ...previous, taskState: state });
  log('前 12 项验证记录及旧任务结束状态已核对；复用教学镜像 ' + previous.image.imageId);
  for (const [file, hash] of Object.entries(checks.SOURCE_HASHES)) checks.checkSource(ROOT + '/' + file, hash);
  ensure(!exists(ROOT + '/.env.runner') && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_ALREADY_STARTED');
  const manager = old.manager(); repairHelpers.checkManager(manager, true); old.limits();
  const files = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf', ROOT + '/backups/compiler-check-02.lock', PREVIOUS + '/worker-output.json', PREVIOUS + '/worker-unit.json', PREVIOUS + '/website-postcheck.json', task.area + '/build/Containerfile', task.area + '/build/image.id', ...Object.keys(checks.SOURCE_HASHES).map(file => ROOT + '/' + file), ...Object.values(PINS).map(pin => ROOT + '/' + pin.file)];
  const hashes = Object.fromEntries(files.map(file => [file, old.hash(file)])), nss = accountHelpers.nssSnapshot(), pm2 = old.pm2Snapshot(); old.websites();
  save('before.json', { hashes, nss, pm2, manager });
  lockFd = fs.openSync(LOCK, 'wx', 0o600); fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, record }) + '\n');
  step('在原限制下运行三个固定诊断程序；不重新构建镜像，不改结果分类');
  let completed, failure;
  try { completed = await runWorker(previous.image.imageId, previous.task.label); } catch (error) { failure = error; }
  step('复核原文件、网站进程、用户管理器与总限额');
  for (const [file, hash] of Object.entries(hashes)) ensure(old.hash(file) === hash, 'EXISTING_FILE_CHANGED');
  accountHelpers.assertNssUnchanged(nss); const afterManager = old.manager(); repairHelpers.checkManager(afterManager, true); old.limits();
  ensure(afterManager.MainPID === manager.MainPID && JSON.stringify(old.pm2Snapshot()) === JSON.stringify(pm2), 'EXISTING_PROCESS_CHANGED');
  ensure(!exists(ROOT + '/.env.runner') && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_ALREADY_STARTED'); old.websites();
  save('website-postcheck.json', { unchanged: true, runEnabled: false, pm2, manager: afterManager });
  if (failure) throw failure;
  save('result.json', { stage: 'cpu-exit-diagnostic-collected', previous: PREVIOUS, ...completed, runEnabled: false });
  log('CPU 退出诊断采集完成，三个程序的结果已记录；这不是剩余四项验收通过。');
  log('两个网站与用户管理器未重启，原限制及应用代码未改动，网页编译运行仍关闭。');
  log('请发回完整输出；不重复执行、不删除旧镜像或记录。私有记录：' + record);
}
if (process.argv[2] === '--diagnose-compiler-cpu') {
  try { await main(); }
  catch (error) { log('诊断未完成；阶段：' + phase + '；错误码：' + safeCode(error.code)); if (record) log('私有操作记录：' + record); log('没有开启网页运行或修改应用代码。请保留现场并发回输出，不要重跑。'); process.exitCode = 1; }
  finally { if (lockFd !== undefined) fs.closeSync(lockFd); if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_CPU_DIAG_NODE
