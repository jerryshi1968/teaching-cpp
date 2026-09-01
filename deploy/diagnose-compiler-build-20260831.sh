#!/usr/bin/env bash
# 只提取上次教学镜像构建错误和任务状态；除保存诊断日志外，不修改文件或配置。
# 不执行 Podman、不重新构建、不运行容器、不停止服务，不读取 .env 或进程环境变量。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux && test "$(id -u)" -eq 0 || { printf '请在 Linux 服务器原来的 root 会话执行。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --diagnose-compiler-build <<'CPP_BUILD_DIAG_NODE'
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = '/var/www/teaching-cpp-backend';
const RECORD = ROOT + '/backups/compiler-check-FEQ0jn';
const ORIGINAL_SHA = '7619e68b594636617cee2f21a6623ff736ea9ecdf033abc55eba70690621ca1d';
const CONTAINERFILE_SHA = '89400093593b873846787d97d59ae01f569a18190145b605d05b46a2dc2d26a8';
const env = { HOME: '/root', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SYSTEMD_PAGER: 'cat', SYSTEMD_COLORS: '0' };
const runnerEnv = { HOME: '/var/www/teaching-cpp-runner', USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus', SYSTEMD_PAGER: 'cat', SYSTEMD_COLORS: '0' };
const FIELDS = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'Result', 'ExecMainCode', 'ExecMainStatus'];
let logFd, logPath;
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function code(value) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'CHECK_FAILED'; }
function out(value) { const line = (typeof value === 'string' ? value : JSON.stringify(value)) + '\n'; process.stdout.write(line); if (logFd !== undefined) fs.writeSync(logFd, line); }
function section(title, action) { out('\n【' + title + '】'); try { return action(); } catch (error) { out({ checkFailed: code(error.code) }); return null; } }
function directory(file, uid, mode) { const stat = fs.lstatSync(file); ensure(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === mode && fs.realpathSync(file) === file, 'DIRECTORY_UNEXPECTED'); }
function read(file, privateFile = true) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fs.realpathSync(file) === file && stat.size <= 16 * 1024 ** 2, 'RECORD_FILE_UNEXPECTED');
  if (privateFile) ensure(stat.uid === 0 && (stat.mode & 0o077) === 0, 'PRIVATE_RECORD_REQUIRED');
  return fs.readFileSync(file, 'utf8');
}
function json(file) { return JSON.parse(read(file)); }
function command(program, args, commandEnv = env) {
  try { return { exit: 0, stdout: execFileSync(program, args, { cwd: ROOT, env: commandEnv, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (error) { return { exit: Number.isInteger(error.status) ? error.status : null, error: code(error.code), stdout: String(error.stdout || '') }; }
}
export function redact(value, limit = 12000) {
  // 构建使用的是固定公开镜像和无秘密上下文；仍去除终端控制符及常见凭据信息，避免误贴。
  return String(value || '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:[A-Z0-9_]{0,80}(?:PASSWORD|TOKEN|SECRET|API_KEY)|authorization)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s&,;]+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:password|token|secret|access_token|api_key)=)[^&\s]*/gi, '$1[REDACTED]')
    .slice(0, limit);
}
export function buildRecord(value) {
  ensure(value && typeof value.stdout === 'string' && value.stdout.length <= 12 * 1024 ** 2, 'WORKER_RECORD_FORMAT');
  const events = value.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const builds = events.filter(row => row.event === 'build-result');
  ensure(builds.length === 1 && builds[0].result && typeof builds[0].result.stderr === 'string' && typeof builds[0].result.stdout === 'string', 'BUILD_RESULT_MISSING_OR_AMBIGUOUS');
  const result = builds[0].result;
  return {
    workerExit: Number.isInteger(value.status) ? value.status : null,
    buildExit: Number.isInteger(result.code) ? result.code : null,
    signal: /^SIG[A-Z]+$/.test(result.signal || '') ? result.signal : null,
    stoppedBy: ['time', 'output', 'cancel'].includes(result.reason) ? result.reason : null,
    stdout: redact(result.stdout), stderr: redact(result.stderr),
    stdoutTruncated: result.stdout.length > 12000, stderrTruncated: result.stderr.length > 12000,
    checksPassed: events.filter(row => row.event === 'pass').length,
    complete: events.some(row => row.event === 'complete'),
    errors: events.filter(row => row.event === 'error').map(row => ({ code: code(row.code), phase: redact(row.phase, 200) })),
    recordedContainers: events.filter(row => row.event === 'remaining-containers').map(row => Array.isArray(row.value) ? row.value.length : null),
    containerStateUnconfirmed: events.some(row => row.event === 'container-state-unconfirmed')
  };
}
export function task(value) {
  ensure(/^[a-f0-9]{12}$/.test(value?.label || '') && value.unit === 'cpp-compiler-check-' + value.label + '.service', 'WORKER_SCOPE_INVALID');
  return { unit: value.unit, label: value.label, area: '/var/www/teaching-cpp-runner/compiler-check-' + value.label };
}
export function properties(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('='), name = line.slice(0, at);
    if (at < 1 || !FIELDS.includes(name)) continue;
    ensure(!Object.hasOwn(values, name) && /^[a-zA-Z0-9_ -]{0,160}$/.test(line.slice(at + 1)), 'PROPERTY_FORMAT');
    values[name] = line.slice(at + 1);
  }
  return values;
}
export function classify(exit, values, processes) {
  if (processes.pids.length || Number(values.MainPID) > 0 || Number(values.ControlPID) > 0 || ['active', 'activating', 'deactivating', 'reloading'].includes(values.ActiveState)) return '仍有进程或活动任务';
  if (!processes.complete || ![0, 1].includes(exit)) return '无法确认';
  if (values.LoadState === 'not-found' && values.ActiveState === 'inactive' && (!values.MainPID || values.MainPID === '0') && (!values.ControlPID || values.ControlPID === '0')) return '任务已回收';
  if (values.LoadState === 'loaded' && ['inactive', 'failed'].includes(values.ActiveState) && values.MainPID === '0' && values.ControlPID === '0') return '任务已停止';
  return '无法确认';
}
export function websiteSummary(name, value) {
  if (name === 'p5js') return { site: name, healthy: value?.status === 'OK' && value.db_check === 'Database Active', httpSuccess: true };
  ensure(name === 'cpp', 'UNKNOWN_WEBSITE');
  return { site: name, production: value?.mode === 'production', writesEnabled: value?.writesEnabled === true, executionDisabled: value?.runEnabled === false };
}
function processes(unit) {
  const result = { complete: true, pids: [] };
  for (const pid of fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name))) {
    try { const group = fs.readFileSync('/proc/' + pid + '/cgroup', 'utf8'); if (group.includes('/user.slice/user-994.slice/user@994.service/') && group.split(/[\n/]/).includes(unit)) result.pids.push(Number(pid)); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) result.complete = false; }
  }
  return result;
}
function fileInfo(file, expectedHash) {
  try {
    const stat = fs.lstatSync(file);
    const result = { path: file, type: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o777).toString(8), bytes: stat.size };
    if (expectedHash) result.matchesExpected = createHash('sha256').update(read(file, false)).digest('hex') === expectedHash;
    out(result);
  } catch (error) { out({ path: file, error: code(error.code) }); }
}
function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  directory(ROOT, 0, 0o755); directory(ROOT + '/logs', 995, 0o750); directory(ROOT + '/backups', 0, 0o700); directory(RECORD, 0, 0o700);
  logPath = ROOT + '/logs/compiler-build-diagnostic-' + randomBytes(6).toString('hex') + '.log'; logFd = fs.openSync(logPath, 'wx', 0o600);
  out('诊断日志：' + logPath); out('只读取上次构建记录和当前状态，不执行 Podman 或重新构建。');
  section('1. 原构建脚本是否一致', () => {
    const bytes = read(ROOT + '/deploy/verify-compiler-containers-20260831.sh', false);
    const sha = createHash('sha256').update(bytes).digest('hex'); out({ sha256: sha, matchesDeliveredScript: sha === ORIGINAL_SHA });
  });
  section('2. 构建错误原文（已做常见凭据脱敏）', () => {
    const value = buildRecord(json(RECORD + '/worker-output.json'));
    const { stdout, stderr, ...summary } = value; out(summary);
    out('构建 stdout：\n' + (stdout || '[空]')); out('构建 stderr：\n' + (stderr || '[空]'));
  });
  const current = section('3. 原任务名称与当前状态', () => {
    const current = task(json(RECORD + '/worker-unit.json'));
    const response = command('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', 'show', ...FIELDS.map(name => '--property=' + name), '--', current.unit], runnerEnv);
    const values = properties(response.stdout), pids = processes(current.unit);
    out({ unit: current.unit, queryExit: response.exit, values, processes: pids, state: classify(response.exit, values, pids) }); return current;
  });
  section('4. 构建目录与上次网站复核记录', () => {
    if (current) { fileInfo(current.area); fileInfo(current.area + '/build'); fileInfo(current.area + '/build/Containerfile', CONTAINERFILE_SHA); fileInfo(current.area + '/build/image.id'); }
    const value = json(RECORD + '/website-postcheck.json'); out({ previousWebsitesUnchanged: value.unchanged === true, previousExecutionDisabled: value.runEnabled === false });
  });
  section('5. 当前两个网站 HTTPS 状态', () => {
    for (const [name, endpoint] of [['p5js', 'health'], ['cpp', 'cpp/config']]) {
      const response = command('curl', ['-q', '--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '3', '--max-time', '7', 'https://tigao123.com/api/' + endpoint]);
      if (response.exit !== 0) { out({ site: name, httpCheckFailed: true, exit: response.exit }); continue; }
      const value = JSON.parse(response.stdout);
      out(websiteSummary(name, value));
    }
  });
  out('\n诊断结束：只新增上述日志，没有修改配置、重建镜像、启动容器或重启服务。');
  out('请发回完整输出；不要重跑原验证脚本，也不要删除镜像、测试目录或锁文件。');
}
if (process.argv[2] === '--diagnose-compiler-build') {
  try { main(); } catch (error) { out('诊断未完成，错误码：' + code(error.code)); process.exitCode = 1; }
  finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_BUILD_DIAG_NODE
