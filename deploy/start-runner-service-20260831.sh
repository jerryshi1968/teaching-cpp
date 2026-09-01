#!/usr/bin/env bash
# 只启动 cpp-runner 的内部执行服务；网站运行开关保持关闭，两个网站及用户管理器不重启。
# 自动生成私有通信密钥，不联网、不修改数据库、不更新软件，不删除旧镜像或验证记录。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux && test "$(id -u)" -eq 0 || { printf '请在 Linux 服务器原来的 root 会话执行。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --start-runner-service <<'CPP_RUNNER_SERVICE_NODE'
import fs from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';

export const ROOT = '/var/www/teaching-cpp-backend', HOME_DIR = '/var/www/teaching-cpp-runner';
export const UNIT = 'teaching-cpp-runner.service';
export const UNIT_FILE = HOME_DIR + '/.config/systemd/user/' + UNIT;
export const ENV_FILE = ROOT + '/.env.runner';
export const IMAGE = 'sha256:c8579da6d7ec08b0ca85310d947bcea10450288b6b1f96167029fa42e22556fe';
const NODE = ROOT + '/tools/node/bin/node', DATA = HOME_DIR + '/runner-data';
const PREVIOUS = ROOT + '/backups/compiler-check-03-1PGlAA', LOCK = ROOT + '/backups/runner-service-start.lock';
export const SOURCE_HASHES = Object.freeze({
  'runner/src/server.mjs': '8c5e49771a2dc667fe65f24f14b455968f9db261d3f487d33c5ed2dd4430eda2',
  'runner/src/cpu-budget.mjs': '2b4d6da57db00d3ff5707ec6bfe338ea70058741ef5a4620a571dd1e2b6b3c4b',
  'runner/src/config.mjs': '7ad1a3d895a578229fcd01f2662f49544d3ebbe6203150ffaf9936df9bf3f623',
  'runner/src/app.mjs': '09cddeeceec6ef42602f8a631a26779102b0f634ee067404d924e74192c6a26f',
  'runner/package.json': '2523f199a0f36604b6067f5707b36500875f9249809ee1b1780f1389845d302a',
  'package.json': 'ca92c3b800d2d8b8753b2f63893e1ce547650aeb76ba5937bafae756807a039d',
  'package-lock.json': 'f21c8fc02eb2a46a00900285db742f43a001af874771cf6c6dcb992b4f92febb'
});
export const RUNNER_ENV = Object.freeze({ HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus', TMPDIR: HOME_DIR + '/tmp' });
export const CASES = Object.freeze([
  { name: '内部接口 C++17 编译及标准输入输出', code: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}', stdin: '12 30\n', state: 'completed', stdout: '42\n' },
  { name: '内部接口 CPU 超时', code: 'int main(){volatile unsigned long long n=0;for(;;){++n;}}', stdin: '', state: 'time_limit', stdout: '' },
  { name: '内部接口主动返回 137 不误判', code: 'int main(){return 137;}', stdin: '', state: 'runtime_error', stdout: '' }
]);
let checks, repair, record, logFd, lockFd, token, before, installed = false, startRequested = false, enableRequested = false;
let phase = '初始检查';
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(value) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'RUNNER_SERVICE_FAILED'; }
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = () => new Promise(resolve => setTimeout(resolve, 500));
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function log(value) { const line = new Date().toISOString() + ' ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n'; process.stdout.write(line); if (logFd !== undefined) fs.writeSync(logFd, line); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(value) { phase = value; log(value); }
function redact(text) { let value = String(text || ''); if (token) value = value.split(token).join('[内部密钥已隐藏]'); return checks?.diagnosticHelpers.redact(value, 6000) || value.slice(0, 6000); }

export function unitText() {
  return `# 此文件是 cpp-runner 普通用户的 systemd --user 单元，不能作为 root 系统单元直接启动。
[Unit]
Description=Rootless C++ sandbox runner
After=network.target
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=exec
WorkingDirectory=${ROOT}
# 密钥由应用从 .env.runner 读取，不放在命令行或 systemd Environment 中。
ExecStart=/usr/bin/env -i ${Object.entries(RUNNER_ENV).map(([key, value]) => key + '=' + value).join(' ')} ${NODE} ${ROOT}/runner/src/server.mjs
Restart=on-failure
RestartSec=10
UMask=0077
Delegate=yes
KillMode=mixed
TimeoutStopSec=90
LimitNOFILE=4096
TasksMax=256
StandardOutput=journal
StandardError=journal
SyslogIdentifier=teaching-cpp-runner
# rootless Podman 的 newuidmap/newgidmap 需要创建用户命名空间。
# 不要为本单元添加 NoNewPrivileges、PrivateUsers 或阻断用户命名空间的限制。
# 容器本身由代码逐项限制；总 CPU/内存限制应同时施加到 cpp-runner 用户 slice。

[Install]
WantedBy=default.target
`;
}
export function envText(secret) {
  ensure(/^[A-Za-z0-9_-]{64}$/.test(secret || ''), 'GENERATED_TOKEN_INVALID');
  return '# 仅提供给 cpp-runner；不包含数据库密码或网站登录密钥。\nRUNNER_PORT=5280\nRUNNER_DATA_ROOT=' + DATA + '\nRUNNER_TOKEN=' + secret + '\nCPP_COMPILER_IMAGE=' + IMAGE + '\n';
}
export function checkRepair(value, post) {
  ensure(value?.stage === 'cpu-budget-repaired-and-verified' && value.checks === 18 && value.containers === 0 && value.runEnabled === false && value.image === IMAGE, 'PREVIOUS_REPAIR_INCOMPLETE');
  ensure(value.moduleSha256 === SOURCE_HASHES['runner/src/cpu-budget.mjs'] && value.serverSha256 === SOURCE_HASHES['runner/src/server.mjs'], 'PREVIOUS_CODE_CHANGED');
  ensure(post?.unchanged === true && post.runEnabled === false, 'PREVIOUS_POSTCHECK_INCOMPLETE');
}
export function checkService(value, enabled) {
  ensure(value.LoadState === 'loaded' && value.ActiveState === 'active' && value.SubState === 'running' && /^[1-9][0-9]*$/.test(value.MainPID || ''), 'SERVICE_NOT_RUNNING');
  ensure(value.FragmentPath === UNIT_FILE && !value.DropInPaths && value.NeedDaemonReload === 'no' && value.NRestarts === '0', 'SERVICE_CONFIGURATION_CHANGED');
  ensure(value.Delegate === 'yes' && value.NoNewPrivileges === 'no' && value.Restart === 'on-failure' && value.KillMode === 'mixed', 'SERVICE_SETTINGS_INVALID');
  ensure(value.UnitFileState === (enabled ? 'enabled' : 'disabled'), 'SERVICE_ENABLE_STATE_INVALID');
  ensure(value.ControlGroup?.startsWith('/user.slice/user-994.slice/user@994.service/') && value.ControlGroup.endsWith('/' + UNIT), 'SERVICE_CGROUP_INVALID');
}
export function checkListener(text, pid) {
  const rows = text.trim().split('\n').filter(Boolean);
  ensure(rows.length === 1 && rows[0].trim().split(/\s+/)[3] === '127.0.0.1:5280' && new RegExp('\\bpid=' + pid + ',').test(rows[0]), 'LISTENER_NOT_PRIVATE_OR_WRONG_PROCESS');
}
export function checkHealth(response) {
  ensure(response.status === 200 && response.body?.ready === true && response.body.busy === false && response.body.image === IMAGE && response.cache === 'no-store', 'RUNNER_HEALTH_INVALID');
}
export function checkJob(item, result, jobId) {
  ensure(result?.id === jobId && result.state === item.state && result.stdout === item.stdout && result.stderr === '' && typeof result.finished_at === 'string', 'HTTP_JOB_RESULT_MISMATCH');
  if (item.state === 'runtime_error') ensure(result.message === '程序退出码：137', 'HTTP_EXIT_RESULT_MISMATCH');
}
async function loadChecks() {
  const file = ROOT + '/deploy/resume-compiler-containers-20260831-02.sh';
  const stat = fs.lstatSync(file); ensure(stat.isFile() && stat.uid === 0 && stat.nlink === 1 && !(stat.mode & 0o022) && fs.realpathSync(file) === file, 'HELPER_UNSAFE');
  const bytes = fs.readFileSync(file); ensure(sha(bytes) === '814b2f79e5c25e95a65fdb7796d2b38f488a2c32009e29ee3ab7b14c147eb116', 'HELPER_CHANGED');
  const body = /<<'CPP_COMPILER_CHECK_NODE'\n([\s\S]+)\nCPP_COMPILER_CHECK_NODE\n$/.exec(bytes.toString())?.[1]; ensure(body, 'HELPER_FORMAT');
  const extra = '\nexport { loadChecks, old, imageHelpers, accountHelpers, repairHelpers, rootlessHelpers, diagnosticHelpers, observeWorker };\nexport function bindService(folder,fd){record=folder;logFd=fd;}';
  checks = await import('data:text/javascript;base64,' + Buffer.from(body + extra).toString('base64'));
  checks.bindService(record, logFd); await checks.loadChecks();
  const repairFile = ROOT + '/deploy/repair-compiler-cpu-20260831.sh';
  checks.checkSource(repairFile, '509d7577a875252578bf1a5d2b2c18763e42fb5c12959ade013e35ac715f5b43');
  repair = await checks.old.loadHelpers(repairFile, '509d7577a875252578bf1a5d2b2c18763e42fb5c12959ade013e35ac715f5b43', 'CPP_CPU_REPAIR_NODE');
}
function userCommand(executable, args, accept = [0]) {
  let result;
  try { result = { status: 0, stdout: execFileSync('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', executable, ...args], { env: RUNNER_ENV, cwd: ROOT, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }; }
  catch (error) { result = { status: error.status, signal: error.signal, code: error.code, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }; }
  if (!accept.includes(result.status) || result.signal || result.code) { save('user-command-error-' + randomBytes(4).toString('hex') + '.json', { executable, status: result.status, code: result.code, signal: result.signal, stdout: redact(result.stdout), stderr: redact(result.stderr) }); log('用户命令失败：' + executable + '；退出码：' + result.status + '；' + redact(result.stderr)); throw Object.assign(new Error(), { code: 'USER_COMMAND_FAILED' }); }
  return result;
}
const ctl = args => userCommand('/usr/bin/systemctl', ['--user', ...args]).stdout;
function serviceState(acceptMissing = false) {
  const keys = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'UnitFileState', 'NRestarts', 'Delegate', 'NoNewPrivileges', 'Restart', 'KillMode', 'ControlGroup'];
  const result = userCommand('/usr/bin/systemctl', ['--user', 'show', ...keys.map(key => '--property=' + key), '--', UNIT], acceptMissing ? [0, 1] : [0]);
  return checks.rootlessHelpers.parseProperties(result.stdout);
}
function processIdentity(value) {
  const status = fs.readFileSync('/proc/' + value.MainPID + '/status', 'utf8');
  for (const [key, id] of [['Uid', 994], ['Gid', 991]]) ensure(new RegExp('^' + key + ':\\s+' + [id, id, id, id].join('\\s+') + '\\s*$', 'm').test(status), 'SERVICE_IDENTITY_INVALID');
  ensure(fs.realpathSync('/proc/' + value.MainPID + '/exe') === fs.realpathSync(NODE), 'SERVICE_NODE_INVALID');
  const args = fs.readFileSync('/proc/' + value.MainPID + '/cmdline').toString().split('\0').filter(Boolean);
  ensure(args.length === 2 && args[0] === NODE && args[1] === ROOT + '/runner/src/server.mjs', 'SERVICE_ENTRY_INVALID');
  ensure(fs.readFileSync('/proc/' + value.MainPID + '/cgroup', 'utf8').trim() === '0::' + value.ControlGroup, 'SERVICE_PROCESS_CGROUP_INVALID');
  checkListener(checks.old.run('ss', ['-H', '-lntp', '( sport = :5280 )']), value.MainPID);
}
async function guardWorker(root, home, image) {
  const fs = await import('node:fs'), { execFileSync } = await import('node:child_process');
  const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error(), { code }); };
  try {
    ensure(process.platform === 'linux' && process.getuid() === 994 && process.getgid() === 991, 'GUARD_USER_INVALID');
    ensure(fs.readFileSync('/proc/self/cgroup', 'utf8').trim().startsWith('0::/user.slice/user-994.slice/user@994.service/'), 'GUARD_CGROUP_INVALID');
    await import('file://' + root + '/runner/src/app.mjs');
    await import('file://' + root + '/runner/src/config.mjs');
    const call = args => JSON.parse(execFileSync('/usr/bin/podman', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    const info = call(['info', '--format=json']), inspect = call(['image', 'inspect', image]), containers = call(['ps', '-a', '--format=json']);
    ensure(Array.isArray(containers) && containers.length === 0 && inspect.length === 1, 'GUARD_CONTAINERS_NOT_EMPTY');
    let denied = false;
    try { fs.accessSync(root + '/.env', fs.constants.R_OK); } catch (error) { if (error.code === 'EACCES') denied = true; else throw error; }
    ensure(denied, 'WEBSITE_CONFIG_READABLE');
    const disk = fs.statfsSync(home); ensure(disk.bavail * disk.bsize >= 4 * 1024 ** 3, 'DISK_SPACE_LOW');
    process.stdout.write(JSON.stringify({ info, inspect: inspect[0], containers: 0, dependencies: true, websiteConfigDenied: true }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ error: /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'GUARD_FAILED' }) + '\n'); process.exitCode = 1; }
}
export const guardSource = () => '(' + guardWorker.toString() + ')(' + [ROOT, HOME_DIR, IMAGE].map(value => JSON.stringify(value)).join(',') + ');';
async function inspectStore(label, imageLabel) {
  const unit = 'cpp-runner-service-check-' + randomBytes(6).toString('hex') + '.service';
  save('guard-unit-' + label + '.json', { unit });
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + unit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=45', '--property=TimeoutStopSec=10', '--property=WorkingDirectory=' + ROOT, '/usr/bin/env', '-i', ...Object.entries(RUNNER_ENV).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', guardSource()];
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/setpriv', args, { env: RUNNER_ENV, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', overflow = false;
    child.stdout.on('data', bytes => { stdout += bytes.toString(); if (stdout.length > 1024 ** 2) { overflow = true; stdout = stdout.slice(-(1024 ** 2)); } });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-65536); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'GUARD_START_FAILED' })));
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr, overflow }));
  });
  save('guard-output-' + label + '.json', result);
  if (result.stderr) log('用户检查服务信息：' + redact(result.stderr));
  let value; try { value = JSON.parse(result.stdout); } catch { throw Object.assign(new Error(), { code: 'GUARD_OUTPUT_INVALID' }); }
  if (value.error) throw Object.assign(new Error(), { code: safeCode(value.error) });
  ensure(result.status === 0 && !result.signal && !result.overflow && value.dependencies && value.websiteConfigDenied && value.containers === 0, 'GUARD_INCOMPLETE');
  checks.imageHelpers.checkHostInfo(value.info, 2);
  checks.checkTeachingImage(value.inspect, IMAGE, checks.imageHelpers.PIN, checks.old.DIFF_IDS, imageLabel);
  return value;
}
export function request(path, secret, method = 'GET', body, port = 5280) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { ...(secret === undefined ? {} : { Authorization: 'Bearer ' + secret }), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) };
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; if (text.length > 512 * 1024) req.destroy(Object.assign(new Error(), { code: 'HTTP_RESPONSE_TOO_LARGE' })); });
      res.on('error', reject);
      res.on('end', () => { try { resolve({ status: res.statusCode, cache: res.headers['cache-control'], body: JSON.parse(text) }); } catch { reject(Object.assign(new Error(), { code: 'HTTP_RESPONSE_INVALID' })); } });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(), { code: 'HTTP_TIMEOUT' })), 5000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end(bytes);
  });
}
async function ready(enabled = false) {
  const deadline = Date.now() + 45000; let last;
  while (Date.now() < deadline) {
    const state = serviceState();
    if (state.NRestarts !== '0' || ['failed', 'inactive', 'deactivating'].includes(state.ActiveState)) { save('service-not-ready-' + randomBytes(4).toString('hex') + '.json', state); log({ serviceState: state }); throw Object.assign(new Error(), { code: 'SERVICE_START_FAILED' }); }
    try { const health = await request('/health', token); checkHealth(health); const current = serviceState(); checkService(current, enabled); processIdentity(current); return current; }
    catch (error) { last = error; if (!['ECONNREFUSED', 'ECONNRESET', 'HTTP_TIMEOUT'].includes(error.code)) throw error; }
    await delay();
  }
  throw Object.assign(new Error(), { code: 'SERVICE_READINESS_TIMEOUT', cause: last });
}
async function exercise() {
  for (const secret of [undefined, 'incorrect-internal-token']) {
    ensure((await request('/health', secret)).status === 401, 'UNAUTHENTICATED_HEALTH_ALLOWED');
    ensure((await request('/jobs', secret, 'POST', {})).status === 401, 'UNAUTHENTICATED_JOB_ALLOWED');
  }
  log('通过：无密钥及错误密钥均被拒绝，内部健康检查正常；未展示密钥。');
  const results = [];
  for (const item of CASES) {
    const id = randomUUID(), body = { id, code: item.code, stdin: item.stdin, profileId: 'cpp17', image: IMAGE };
    save('http-job-submission-' + id + '.json', body);
    const submitted = await request('/jobs', token, 'POST', body); ensure(submitted.status === 202 && submitted.body.id === id, 'HTTP_JOB_NOT_ACCEPTED');
    const deadline = Date.now() + 45000; let result;
    while (Date.now() < deadline) {
      const current = await request('/jobs/' + id, token); ensure(current.status === 200 && current.body.id === id, 'HTTP_JOB_NOT_FOUND');
      if (!['compiling', 'running', 'stopping'].includes(current.body.state)) { result = current.body; break; }
      await delay();
    }
    save('http-job-result-' + id + '.json', result || { id, error: 'HTTP_JOB_TIMEOUT' });
    if (result?.state !== item.state || result?.stdout !== item.stdout) log('接口测试状态不符：' + redact(JSON.stringify({ name: item.name, expected: item.state, actual: result?.state, compiler: result?.compiler_output, stderr: result?.stderr, message: result?.message })));
    checkJob(item, result, id); checkHealth(await request('/health', token));
    const repeated = await request('/jobs', token, 'POST', body);
    ensure(repeated.status === 202 && JSON.stringify(repeated.body) === JSON.stringify(result), 'HTTP_JOB_REPEATED_EXECUTION');
    results.push(result); log('通过：' + item.name);
  }
  return results;
}
function writeNew(file, bytes, gid, mode) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fchownSync(fd, 0, gid); fs.fchmodSync(fd, mode); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function userDirectory(file) {
  if (!exists(file)) { fs.mkdirSync(file, { mode: 0o700 }); fs.chownSync(file, 994, 991); }
  checks.old.directory(file, 994, 0o700, 991);
}
function unchanged() {
  for (const [file, digest] of Object.entries(before.hashes)) ensure(checks.old.hash(file) === digest, 'EXISTING_FILE_CHANGED');
  checks.accountHelpers.assertNssUnchanged(before.nss);
  const manager = checks.old.manager(); checks.repairHelpers.checkManager(manager, true); checks.old.limits();
  ensure(manager.MainPID === before.manager.MainPID && JSON.stringify(checks.old.pm2Snapshot()) === JSON.stringify(before.pm2), 'EXISTING_PROCESS_CHANGED');
  checks.old.websites();
}
function installedUnchanged() {
  ensure(checks.old.hash(UNIT_FILE) === sha(unitText()) && checks.old.hash(ENV_FILE) === sha(envText(token)), 'NEW_CONFIGURATION_CHANGED');
  const stat = fs.lstatSync(ENV_FILE); ensure(stat.uid === 0 && stat.gid === 991 && (stat.mode & 0o777) === 0o640, 'RUNNER_CONFIG_PERMISSIONS_INVALID');
}
function journal() {
  try { const text = checks.old.run('/usr/bin/journalctl', ['--no-pager', '-o', 'short-iso', '-n', '100', '_UID=994', '_SYSTEMD_USER_UNIT=' + UNIT]); const clean = redact(text); save('service-journal-' + randomBytes(4).toString('hex') + '.json', { text: clean }); if (clean.trim()) log('执行服务日志摘要：\n' + clean); } catch { log('执行服务日志暂未取得，其他记录保留。'); }
}
async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  for (const [file, uid, mode] of [[ROOT, 0, 0o755], [ROOT + '/logs', 995, 0o750], [ROOT + '/backups', 0, 0o700]]) { const stat = fs.lstatSync(file); ensure(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === mode && fs.realpathSync(file) === file, 'DIRECTORY_UNEXPECTED'); }
  ensure(!exists(LOCK), 'SERVICE_INSTALL_ALREADY_STARTED_DO_NOT_REPEAT');
  const logPath = ROOT + '/logs/runner-service-start-' + randomBytes(6).toString('hex') + '.log'; logFd = fs.openSync(logPath, 'wx', 0o600); log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/runner-service-start-'); log('私有操作记录：' + record);
  step('只读预检：18 项通过记录、执行入口、账号限额、原网站与空闲端口'); await loadChecks();
  const { old } = checks;
  old.directory(HOME_DIR, 994, 0o700, 991); old.directory('/run/user/994', 994, 0o700); old.directory(DATA, 994, 0o700, 991); old.directory(PREVIOUS, 0, 0o700);
  checkRepair(old.readJson(PREVIOUS + '/result.json'), old.readJson(PREVIOUS + '/website-postcheck.json'));
  const verified = repair.checkVerification(old.readJson(PREVIOUS + '/worker-output.json'), [...checks.CASES, ...repair.EXTRA_CASES], checks.checkCase);
  ensure(JSON.stringify(verified) === JSON.stringify(old.readJson(PREVIOUS + '/verification.json')), 'VERIFICATION_RECORD_CHANGED');
  const previousLock = old.readJson(ROOT + '/backups/compiler-check-03.lock');
  ensure(previousLock.record === PREVIOUS && Number.isSafeInteger(previousLock.pid) && previousLock.pid > 1 && !exists('/proc/' + previousLock.pid), 'PREVIOUS_TASK_NOT_STOPPED');
  const worker = checks.observeWorker(old.readJson(PREVIOUS + '/worker-unit.json').unit); old.checkInactiveUnit(worker.exit, worker.values, worker.processes);
  const imageLabel = old.readJson(ROOT + '/backups/compiler-check-02-PRb5s6/worker-unit.json').label;
  checks.checkTeachingImage(verified.inspect, IMAGE, checks.imageHelpers.PIN, old.DIFF_IDS, imageLabel);
  for (const [file, digest] of Object.entries({ ...checks.SOURCE_HASHES, ...SOURCE_HASHES })) checks.checkSource(ROOT + '/' + file, digest);
  ensure(old.run(NODE, ['--version']).trim() === 'v24.20.0', 'NODE_VERSION_CHANGED');
  ensure(old.run('id', ['-u', 'cpp-runner']).trim() === '994' && old.run('id', ['-g', 'cpp-runner']).trim() === '991' && old.run('id', ['-G', 'cpp-runner']).trim() === '991', 'RUNNER_ACCOUNT_CHANGED');
  ensure(!exists(ENV_FILE) && !exists(UNIT_FILE) && !exists(UNIT_FILE + '.d') && !exists(HOME_DIR + '/.config/systemd/user/default.target.wants/' + UNIT), 'RUNNER_CONFIGURATION_ALREADY_EXISTS');
  ensure(fs.readdirSync(DATA).length === 0 && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_DATA_OR_PORT_IN_USE');
  const state = serviceState(true); ensure(state.LoadState === 'not-found' && state.ActiveState === 'inactive' && state.MainPID === '0', 'RUNNER_UNIT_ALREADY_EXISTS');
  ensure(old.run('/usr/bin/loginctl', ['show-user', '994', '--property=Linger', '--value']).trim() === 'yes', 'LINGER_NOT_ENABLED');
  const manager = old.manager(); checks.repairHelpers.checkManager(manager, true); old.limits();
  const files = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf', PREVIOUS + '/result.json', PREVIOUS + '/verification.json', ...Object.keys({ ...checks.SOURCE_HASHES, ...SOURCE_HASHES }).map(file => ROOT + '/' + file)];
  before = { hashes: Object.fromEntries(files.map(file => [file, old.hash(file)])), nss: checks.accountHelpers.nssSnapshot(), pm2: old.pm2Snapshot(), manager }; old.websites(); save('before.json', before);
  lockFd = fs.openSync(LOCK, 'wx', 0o600); fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, record }) + '\n');
  step('在账号限额内核对固定镜像、零容器及运行依赖，不下载或编译'); await inspectStore('before', imageLabel); unchanged();
  step('新增私有通信配置和 cpp-runner 用户服务；密钥不显示、不写入网站配置');
  token = randomBytes(48).toString('base64url');
  writeNew(ENV_FILE, envText(token), 991, 0o640);
  for (const file of [HOME_DIR + '/.config', HOME_DIR + '/.config/systemd', HOME_DIR + '/.config/systemd/user']) userDirectory(file);
  writeNew(UNIT_FILE, unitText(), 0, 0o644); installed = true;
  ensure(userCommand('/usr/bin/test', ['-r', ENV_FILE]).status === 0, 'RUNNER_CONFIG_NOT_READABLE');
  old.run('/usr/bin/setpriv', ['--reuid', '995', '--regid', '992', '--clear-groups', '/usr/bin/test', '!', '-r', ENV_FILE]);
  ctl(['daemon-reload']);
  const prepared = serviceState(); save('service-loaded.json', prepared); ensure(prepared.LoadState === 'loaded' && prepared.FragmentPath === UNIT_FILE && !prepared.DropInPaths && prepared.UnitFileState === 'disabled', 'NEW_UNIT_NOT_LOADED');
  installedUnchanged();
  step('只启动 teaching-cpp-runner 用户服务，等待隔离自检和 127.0.0.1:5280 就绪');
  startRequested = true; ctl(['start', '--no-block', UNIT]);
  const first = await ready(); save('service-first-start.json', first);
  const results = await exercise(); save('http-verification.json', { authenticated: true, unauthenticatedRejected: true, results });
  await inspectStore('after-jobs', imageLabel);
  ensure(fs.readdirSync(DATA + '/work').length === 0, 'WORK_DIRECTORY_NOT_EMPTY');
  step('仅重启刚新增的执行服务，核对任务记录恢复；两个网站和用户管理器保持');
  ctl(['restart', '--no-block', UNIT]);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { const current = serviceState(); if (current.ActiveState === 'active' && current.SubState === 'running' && current.MainPID !== first.MainPID && current.MainPID !== '0') break; await delay(); }
  const final = await ready(); ensure(final.MainPID !== first.MainPID, 'SERVICE_RESTART_NOT_CONFIRMED');
  for (const result of results) { const restored = await request('/jobs/' + result.id, token); ensure(restored.status === 200 && JSON.stringify(restored.body) === JSON.stringify(result), 'JOB_RECOVERY_FAILED'); }
  await inspectStore('after-restart', imageLabel); unchanged(); installedUnchanged();
  step('全部检查通过，只为新增执行服务保存开机启动设置，不修改 PM2');
  enableRequested = true; ctl(['enable', UNIT]); const enabled = serviceState(); checkService(enabled, true); processIdentity(enabled); checkHealth(await request('/health', token));
  ensure(enabled.MainPID === final.MainPID, 'SERVICE_CHANGED_DURING_ENABLE'); unchanged(); installedUnchanged();
  save('result.json', { stage: 'internal-runner-service-ready', unit: UNIT, unitFile: UNIT_FILE, envFile: ENV_FILE, unitSha256: sha(unitText()), image: IMAGE, uid: 994, port: 5280, bind: '127.0.0.1', enabled: true, runEnabled: false, containers: 0, previous: PREVIOUS, service: enabled, testJobIds: results.map(row => row.id), websitesUnchanged: true, pm2: before.pm2 });
  log('执行服务准备完成：cpp-runner 普通账号，127.0.0.1:5280，仅接受内部密钥认证。');
  log('真实 HTTP 编译、CPU 超时、137 对照及执行服务重启后记录恢复通过；无残留容器。');
  log('只为新增执行服务设置开机启动，未重启服务器；真实重启机器后的恢复尚未验证。');
  log('两个网站与用户管理器未重启；1 GiB / 1 核 / 256 任务 / swap 0 保持。');
  log('网页编译运行仍关闭，网站配置及业务数据库未改；下一步才连接网站并开放运行。');
  log('请发回完整输出，不要重跑。私有记录：' + record);
}
async function containFailure() {
  if (installed) journal();
  if (startRequested) {
    try {
      ensure(serviceState().FragmentPath === UNIT_FILE && checks.old.hash(UNIT_FILE) === sha(unitText()), 'OWN_SERVICE_NOT_CONFIRMED');
      if (enableRequested) { try { ctl(['disable', UNIT]); } catch (error) { log('新增服务开机设置撤回未确认：' + safeCode(error.code)); } }
      ctl(['stop', '--no-block', UNIT]);
      const deadline = Date.now() + 110000; let stopped = false, progress = Date.now();
      while (Date.now() < deadline) {
        const state = serviceState();
        if (['inactive', 'failed'].includes(state.ActiveState) && state.MainPID === '0' && state.ControlPID === '0') { stopped = true; save('failure-service-state.json', state); break; }
        if (Date.now() - progress > 15000) { log('正在等待本次新增执行服务停止；不操作其他服务。'); progress = Date.now(); }
        await delay();
      }
      ensure(stopped, 'SERVICE_STOP_UNCONFIRMED'); log('已停止本次新增的执行服务；配置和测试记录保留，不自动删除容器或锁。');
    } catch (error) { log('新增服务停止未确认：' + safeCode(error.code) + '；请保留现场。'); }
  }
  if (before) { try { unchanged(); log('失败后复核：两个网站、原配置、用户管理器和总限额保持。'); } catch (error) { log('原站复核未确认：' + safeCode(error.code)); } }
}
if (process.argv[2] === '--start-runner-service') {
  const heartbeat = setInterval(() => { if (logFd !== undefined) log('操作仍在进行；阶段：' + phase); }, 15000);
  try { await main(); }
  catch (error) { log('执行服务准备未完成；阶段：' + phase + '；错误码：' + safeCode(error.code)); await containFailure(); if (record) log('私有操作记录：' + record); log('本脚本未开启网页运行。不要重跑或删除记录，请发回完整输出。'); process.exitCode = 1; }
  finally { clearInterval(heartbeat); if (lockFd !== undefined) fs.closeSync(lockFd); if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_RUNNER_SERVICE_NODE
