#!/usr/bin/env bash
# 只修复 cpp-runner（UID 994）缺少 CPU 委派的问题，保留原账号总限额。
# 仅重启该账号尚未承载容器的用户管理器；不重启网站，不启用 C++ 编译运行。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --repair-rootless-delegation <<'CPP_DELEGATION_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const RUNTIME = '/run/user/994';
const MANAGER = 'user@994.service';
const SLICE = 'user-994.slice';
const SLICE_CGROUP = '/user.slice/user-994.slice';
const MANAGER_CGROUP = SLICE_CGROUP + '/' + MANAGER;
const OVERRIDE_DIR = '/etc/systemd/system/' + MANAGER + '.d';
const OVERRIDE = OVERRIDE_DIR + '/90-teaching-cpp-delegate.conf';
const VENDOR = '/usr/lib/systemd/system/user@.service';
const VENDOR_DROPIN = '/usr/lib/systemd/system/user@.service.d/10-login-barrier.conf';
const LIMITS = '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf';
const RESUME = ROOT + '/deploy/resume-rootless-podman-20260831-02.sh';
const ACCOUNT_SCRIPT = ROOT + '/deploy/prepare-runner-account-20260831-02.sh';
const FAILED_RECORD = ROOT + '/backups/rootless-resume-hrUKkg';
const INIT_RECORD = ROOT + '/backups/rootless-init-X25XA6';
const MANAGER_FIELDS = ['Id', 'User', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlGroup', 'Delegate', 'DelegateControllers', 'DisableControllers', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload'];
const LIMIT_FIELDS = ['LoadState', 'ActiveState', 'MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'DropInPaths', 'ControlGroup', 'DisableControllers', 'NeedDaemonReload'];
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SYSTEMD_PAGER: 'cat', SYSTEMD_COLORS: '0' };
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: RUNTIME, DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + RUNTIME + '/bus' };
let logFd;
let record;
let phase = '初始检查';
let repairVerified = false;
let helpers;
let accountHelpers;

function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function log(message) {
  const line = new Date().toISOString() + ' ' + message + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function directory(file, uid, mode) {
  const stat = fs.lstatSync(file);
  ensure(stat.isDirectory() && fs.realpathSync(file) === file && stat.uid === uid && (stat.mode & 0o777) === mode, 'DIRECTORY_UNEXPECTED');
}
function readBuffer(file, privateFile = false) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fs.realpathSync(file) === file && stat.size < 2 * 1024 * 1024, 'FILE_UNEXPECTED');
  if (privateFile) ensure(stat.uid === 0 && (stat.mode & 0o077) === 0, 'PRIVATE_RECORD_REQUIRED');
  return fs.readFileSync(file);
}
function read(file, privateFile = false) { return readBuffer(file, privateFile).toString('utf8'); }
function hash(file) { return createHash('sha256').update(readBuffer(file)).digest('hex'); }
function readJson(file) { return JSON.parse(read(file, true)); }
function save(name, value) { fs.writeFileSync(path.join(record, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(message) { phase = message; log(message); if (record) fs.writeFileSync(record + '/phase.txt', message + '\n', { mode: 0o600 }); }
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch (error) {
    // 子命令原始错误只留在 root 私有记录，不公开密码、环境或任意 stderr。
    if (record) save('command-error-' + randomBytes(4).toString('hex') + '.json', { command, status: error.status, signal: error.signal, stderr: String(error.stderr || '') });
    throw Object.assign(new Error(), { code: 'COMMAND_' + path.basename(command).replace(/[^a-z0-9]/gi, '_').toUpperCase(), commandStatus: error.status });
  }
}
function properties(unit, fields) { return helpers.parseProperties(run('/usr/bin/systemctl', ['show', '--no-pager', ...helpers.propertyOptions(fields), '--', unit]), fields); }
function asRunner(args) { return run('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', ...args], { env: runnerEnv }); }
function words(text) { return typeof text === 'string' && text.trim() ? text.trim().split(/\s+/).sort() : []; }
function sameSet(left, right) { return JSON.stringify(words(left)) === JSON.stringify([...right].sort()); }

export function delegateText() {
  return '# 仅为 cpp-runner（UID 994）补充 CPU 委派，账号总限额仍由 user-994.slice 控制。\n[Service]\nDelegate=cpu memory pids\n';
}
export function checkManager(value, repaired) {
  ensure(value.Id === MANAGER && value.User === '994' && value.LoadState === 'loaded' && value.ActiveState === 'active' && value.SubState === 'running' && /^[1-9][0-9]*$/.test(value.MainPID || '') && value.ControlGroup === MANAGER_CGROUP, 'MANAGER_IDENTITY_OR_STATE_CHANGED');
  ensure(value.Delegate === 'yes' && sameSet(value.DelegateControllers, repaired ? ['cpu', 'memory', 'pids'] : ['memory', 'pids']) && value.DisableControllers === '' && value.NeedDaemonReload === 'no', 'DELEGATION_STATE_UNEXPECTED');
  ensure(value.FragmentPath === VENDOR && sameSet(value.DropInPaths, repaired ? [VENDOR_DROPIN, OVERRIDE] : [VENDOR_DROPIN]), 'MANAGER_SOURCE_CHANGED');
}
export function checkKernelDelegation(value, repaired) {
  const required = ['cpu', 'memory', 'pids'];
  ensure(['rootAvailable', 'rootEnabled', 'userAvailable', 'userEnabled', 'sliceAvailable'].every(key => typeof value[key] === 'string' && required.every(name => words(value[key]).includes(name))), 'ANCESTOR_CONTROLLERS_CHANGED');
  ensure(sameSet(value.sliceEnabled, repaired ? required : ['memory', 'pids']) && sameSet(value.managerAvailable, repaired ? required : ['memory', 'pids']), 'KERNEL_DELEGATION_UNEXPECTED');
}
export function checkRestartScope(units) {
  const allowed = new Set(['dbus.service', 'dbus-broker.service', 'systemd-tmpfiles-setup.service', 'systemd-tmpfiles-clean.service']);
  ensure(Array.isArray(units) && units.every(unit => typeof unit === 'string' && allowed.has(unit)), 'RUNNER_HAS_UNEXPECTED_SERVICE');
}
export async function repairSequence(actions) {
  // 任一核验失败立即停止，不重试、不进入后续初始化，也不扩大重启范围。
  await actions.preflight();
  await actions.backup();
  await actions.install();
  await actions.reload();
  await actions.checkLoaded();
  await actions.restart();
  await actions.verify();
  await actions.resume();
}
function kernelDelegation() {
  const pairs = { rootAvailable: '/cgroup.controllers', rootEnabled: '/cgroup.subtree_control', userAvailable: '/user.slice/cgroup.controllers', userEnabled: '/user.slice/cgroup.subtree_control', sliceAvailable: SLICE_CGROUP + '/cgroup.controllers', sliceEnabled: SLICE_CGROUP + '/cgroup.subtree_control', managerAvailable: MANAGER_CGROUP + '/cgroup.controllers' };
  return Object.fromEntries(Object.entries(pairs).map(([key, file]) => [key, fs.readFileSync('/sys/fs/cgroup' + file, 'utf8').trim()]));
}
function limitSnapshot() {
  const config = properties(SLICE, LIMIT_FIELDS);
  helpers.checkLimits(config, 'active');
  ensure(config.ControlGroup === SLICE_CGROUP && config.DisableControllers === '' && config.NeedDaemonReload === 'no', 'SLICE_CHANGED');
  const kernel = Object.fromEntries([['memory', 'memory.max'], ['swap', 'memory.swap.max'], ['cpu', 'cpu.max'], ['pids', 'pids.max']].map(([key, file]) => [key, fs.readFileSync('/sys/fs/cgroup' + SLICE_CGROUP + '/' + file, 'utf8').trim()]));
  helpers.checkCgroupLimits(kernel);
  return { config, kernel };
}
function checkSites() {
  const request = endpoint => JSON.parse(run('curl', ['--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', 'https://tigao123.com/api/' + endpoint]));
  accountHelpers.checkSiteValues(request('health'), request('cpp/config'));
  log('两个网站 HTTPS 正常；C++ 写入开启、编译运行关闭。');
}
function pm2Snapshot() {
  const daemon = read('/root/.pm2/pm2.pid').trim();
  ensure(/^[1-9][0-9]*$/.test(daemon) && exists('/proc/' + daemon), 'PM2_DAEMON_NOT_RUNNING');
  const rows = JSON.parse(run('pm2', ['jlist']));
  for (const name of ['p5js-backend', 'teaching-cpp-backend']) ensure(rows.filter(row => row.name === name && row.pm2_env?.status === 'online').length === 1, 'WEBSITE_PM2_NOT_ONLINE');
  const safe = rows.map(row => ({ id: row.pm_id, name: row.name, pid: row.pid, restarts: row.pm2_env?.restart_time, status: row.pm2_env?.status })).sort((a, b) => a.id - b.id);
  for (const row of safe.filter(row => row.pid > 0)) ensure(!fs.readFileSync('/proc/' + row.pid + '/cgroup', 'utf8').includes(SLICE_CGROUP + '/'), 'PM2_PROCESS_IN_RUNNER_SLICE');
  return safe;
}
function noWorkload() {
  for (const suffix of ['/runner-data', '/.config/systemd/user', '/.local/share', '/tmp']) {
    directory(HOME_DIR + suffix, 994, 0o700);
    ensure(fs.readdirSync(HOME_DIR + suffix).length === 0, 'RUNNER_DIRECTORY_NOT_EMPTY');
  }
  for (const file of [HOME_DIR + '/.config/environment.d', HOME_DIR + '/.config/containers/systemd', RUNTIME + '/containers', RUNTIME + '/libpod', RUNTIME + '/podman/podman.sock', ROOT + '/.env.runner']) ensure(!exists(file), 'PODMAN_ALREADY_TOUCHED');
  // 使用已在原脚本成功执行的 PATH 查找 ss；不假定它安装在 /usr/bin。
  ensure(run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_PORT_IN_USE');
  const output = asRunner(['list-units', '--type=service', '--state=active,activating,deactivating', '--plain', '--no-legend', '--no-pager']);
  const units = output.trim() ? output.trim().split('\n').map(line => line.trim().split(/\s+/)[0]) : [];
  log('cpp-runner 当前用户服务：' + JSON.stringify(units));
  checkRestartScope(units);
  return units;
}
async function loadHelpers(file, expected, marker) {
  ensure(hash(file) === expected, 'DELIVERED_SCRIPT_CHANGED');
  const text = read(file);
  const start = text.indexOf("<<'" + marker + "'\n");
  const end = text.lastIndexOf('\n' + marker + '\n');
  ensure(start >= 0 && end > start && end + marker.length + 2 === text.length, 'EMBEDDED_SCRIPT_FORMAT');
  const body = text.slice(start + marker.length + 5, end);
  // 当前参数不等于旧脚本的入口参数；只加载已校验的纯检查函数，不运行旧准备流程。
  return import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
}
async function resumeChecked() {
  step('CPU 委派与网站核验通过，自动接续原 Podman 检查；不下载镜像');
  ensure(hash(RESUME) === '5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de', 'RESUME_SCRIPT_CHANGED');
  const existing = new Set(fs.readdirSync(ROOT + '/backups'));
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/bash', [RESUME], { cwd: ROOT, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', chunk => { process.stdout.write(chunk); fs.writeSync(logFd, chunk); });
    child.stderr.on('data', chunk => { if (stderr.length < 1024 * 1024) stderr += chunk.toString('utf8').slice(0, 1024 * 1024 - stderr.length); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'RESUME_START_FAILED' })));
    child.once('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  save('resume-exit.json', result);
  ensure(result.code === 0 && result.signal === null, 'RESUME_NOT_COMPLETED');
  const added = fs.readdirSync(ROOT + '/backups').filter(name => !existing.has(name) && /^rootless-resume-[A-Za-z0-9]{6}$/.test(name));
  ensure(added.length === 1, 'RESUME_RESULT_AMBIGUOUS');
  const resumeRecord = ROOT + '/backups/' + added[0];
  directory(resumeRecord, 0, 0o700);
  const value = readJson(resumeRecord + '/result.json');
  ensure(value.stage === 'rootless-initialized-no-images' && value.account === 'cpp-runner' && value.uid === 994 && value.gid === 991 && value.runEnabled === false, 'RESUME_RESULT_UNEXPECTED');
  return resumeRecord;
}

async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  directory(ROOT, 0, 0o755);
  directory(ROOT + '/backups', 0, 0o700);
  directory(ROOT + '/logs', 995, 0o750);
  const logPath = ROOT + '/logs/rootless-delegation-repair-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600);
  log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/rootless-delegation-');
  log('私有操作记录：' + record);
  helpers = await loadHelpers(RESUME, '5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de', 'CPP_ROOTLESS_NODE');
  accountHelpers = await loadHelpers(ACCOUNT_SCRIPT, '78dd26246bff6ad0c011703ce6672e4ec042c271e1260eaf66e7bb8425c48489', 'CPP_ACCOUNT_NODE');
  let before;
  let protectedHashes;
  let originalHashes;
  let resumeRecord;
  const snapshotFiles = [VENDOR, VENDOR_DROPIN, '/usr/lib/systemd/system/user.slice', '/usr/lib/systemd/system/user-.slice.d/10-defaults.conf'];
  const originalFiles = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', LIMITS];
  const unchanged = () => {
    for (const [file, digest] of Object.entries(protectedHashes)) ensure(hash(file) === digest, 'EXISTING_CONFIGURATION_CHANGED');
    accountHelpers.assertNssUnchanged(before.nss);
    ensure(JSON.stringify(pm2Snapshot()) === JSON.stringify(before.pm2), 'PM2_PROCESSES_CHANGED');
    checkSites();
  };
  await repairSequence({
    preflight: async () => {
      step('只读预检：确认 CPU 委派缺失、账号空闲、总限额和现有网站正常');
      directory('/etc/systemd/system', 0, 0o755);
      ensure(!exists(OVERRIDE_DIR), 'DELEGATION_OVERRIDE_ALREADY_EXISTS');
      for (const file of ['/etc/systemd/system/' + MANAGER, '/run/systemd/system/' + MANAGER, '/run/systemd/system/' + MANAGER + '.d']) ensure(!exists(file), 'MANAGER_OVERRIDE_UNEXPECTED');
      directory(INIT_RECORD, 0, 0o700);
      directory(FAILED_RECORD, 0, 0o700);
      ensure(read(FAILED_RECORD + '/phase.txt', true).trim() === '读取已启动的用户管理器和 linger 状态，不再次启动或启用', 'FAILED_PHASE_CHANGED');
      const initial = readJson(INIT_RECORD + '/before.json');
      const created = readJson(INIT_RECORD + '/created-configs.json');
      helpers.checkResumeRecord(initial, created, read(INIT_RECORD + '/phase.txt', true).trim(), ['user-manager.json', 'probe-unit.json', 'podman-probe.json', 'result.json'].filter(name => exists(INIT_RECORD + '/' + name)));
      ensure(['user-manager.json', 'probe-unit.json', 'podman-probe.json', 'result.json'].every(name => !exists(FAILED_RECORD + '/' + name)), 'PODMAN_STAGE_ALREADY_ENTERED');
      const preserved = readJson(FAILED_RECORD + '/preserved-configs.json');
      ensure(JSON.stringify(preserved) === JSON.stringify(created), 'PRESERVED_CONFIG_RECORD_CHANGED');
      originalHashes = Object.fromEntries(originalFiles.map(file => [file, hash(file)]));
      helpers.checkRecordedHashes(initial.hashes, originalHashes);
      accountHelpers.assertNssUnchanged(initial.nss);
      for (const [file, expected] of [[created.storage, created.storageSha256], [created.engine, created.engineSha256]]) {
        const stat = fs.lstatSync(file);
        ensure(stat.uid === 994 && stat.gid === 991 && (stat.mode & 0o777) === 0o600 && hash(file) === expected, 'RUNNER_CONFIGURATION_CHANGED');
      }
      const account = run('getent', ['passwd', 'cpp-runner']).trim().split(':');
      ensure(account.length === 7 && account[0] === 'cpp-runner' && account[2] === '994' && account[3] === '991' && account[5] === HOME_DIR && account[6] === '/sbin/nologin', 'RUNNER_IDENTITY_CHANGED');
      ensure(run('id', ['-Gn', 'cpp-runner']).trim() === 'cpp-runner', 'RUNNER_GROUPS_CHANGED');
      directory(HOME_DIR, 994, 0o700);
      directory(RUNTIME, 994, 0o700);
      ensure(run('getenforce', []).trim() === 'Disabled', 'SELINUX_STATE_CHANGED');
      const user = helpers.queryProperties('loginctl', ['show-user', 'cpp-runner'], ['Linger', 'RuntimePath'], run);
      ensure(user.Linger === 'yes' && user.RuntimePath === RUNTIME && exists(RUNTIME + '/bus'), 'USER_RUNTIME_NOT_READY');
      for (const unit of ['-.slice', 'user.slice']) {
        const value = properties(unit, ['ActiveState', 'DisableControllers', 'NeedDaemonReload']);
        ensure(value.ActiveState === 'active' && value.DisableControllers === '' && value.NeedDaemonReload === 'no', 'ANCESTOR_UNIT_CHANGED');
      }
      const manager = properties(MANAGER, MANAGER_FIELDS);
      checkManager(manager, false);
      const kernel = kernelDelegation();
      checkKernelDelegation(kernel, false);
      const limits = limitSnapshot();
      const activeServices = noWorkload();
      const pm2 = pm2Snapshot();
      checkSites();
      protectedHashes = { ...originalHashes, ...Object.fromEntries([...snapshotFiles, created.storage, created.engine, RESUME, ACCOUNT_SCRIPT].map(file => [file, hash(file)])) };
      before = { manager, kernel, limits, activeServices, pm2, nss: accountHelpers.nssSnapshot(), hashes: protectedHashes };
    },
    backup: async () => {
      save('before.json', before);
      save('planned-change.json', { file: OVERRIDE, beforeExists: false, content: delegateText(), restartOnly: MANAGER, runEnabled: false });
      for (const [index, file] of [...snapshotFiles, LIMITS].entries()) fs.writeFileSync(record + '/unit-' + index + '.before', readBuffer(file), { flag: 'wx', mode: 0o600 });
    },
    install: async () => {
      step('仅新增 user@994.service 的 CPU 委派配置，保留原模板和账号总限额');
      ensure(!exists(OVERRIDE_DIR), 'DELEGATION_OVERRIDE_ALREADY_EXISTS');
      fs.mkdirSync(OVERRIDE_DIR, { mode: 0o755 });
      fs.chmodSync(OVERRIDE_DIR, 0o755);
      fs.writeFileSync(OVERRIDE, delegateText(), { flag: 'wx', mode: 0o644 });
      fs.chmodSync(OVERRIDE, 0o644);
      save('created.json', { file: OVERRIDE, sha256: hash(OVERRIDE) });
    },
    reload: async () => {
      step('加载 systemd 单元配置，不重启其他服务');
      run('/usr/bin/systemctl', ['daemon-reload']);
    },
    checkLoaded: async () => {
      const manager = properties(MANAGER, MANAGER_FIELDS);
      checkManager(manager, true);
      ensure(manager.MainPID === before.manager.MainPID, 'MANAGER_CHANGED_BEFORE_RESTART');
      ensure(read(OVERRIDE) === delegateText(), 'NEW_OVERRIDE_CHANGED');
      limitSnapshot();
      noWorkload();
      unchanged();
      save('loaded.json', manager);
    },
    restart: async () => {
      step('仅重启 cpp-runner 的用户管理器，使 CPU 委派生效；不重启网站或 PM2');
      run('/usr/bin/systemctl', ['restart', '--no-block', MANAGER]);
      const deadline = Date.now() + 45000;
      let ready = false;
      while (Date.now() < deadline) {
        const state = helpers.parseProperties(run('/usr/bin/systemctl', ['show', MANAGER, '--property=ActiveState', '--property=MainPID'], { timeout: 5000 }), ['ActiveState', 'MainPID']);
        if (state.ActiveState === 'failed') break;
        if (state.ActiveState === 'active' && /^[1-9][0-9]*$/.test(state.MainPID) && state.MainPID !== before.manager.MainPID && exists(RUNTIME + '/bus')) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      ensure(ready, 'RUNNER_MANAGER_RESTART_NOT_READY');
    },
    verify: async () => {
      step('核对 CPU、内存和进程数委派、内核总限额，以及两个网站进程未变');
      const manager = properties(MANAGER, MANAGER_FIELDS);
      checkManager(manager, true);
      const kernel = kernelDelegation();
      checkKernelDelegation(kernel, true);
      const limits = limitSnapshot();
      directory(RUNTIME, 994, 0o700);
      const user = helpers.queryProperties('loginctl', ['show-user', 'cpp-runner'], ['Linger', 'RuntimePath'], run);
      ensure(user.Linger === 'yes' && user.RuntimePath === RUNTIME, 'USER_RUNTIME_CHANGED');
      noWorkload();
      unchanged();
      save('repair-result.json', { stage: 'cpu-delegation-repaired', manager, kernel, limits, pm2: before.pm2, runEnabled: false });
      repairVerified = true;
      log('CPU 委派修复核验通过；1 GiB 内存、1 核 CPU、256 个进程/线程、swap 0 总限额保持。');
    },
    resume: async () => { resumeRecord = await resumeChecked(); }
  });
  unchanged();
  checkManager(properties(MANAGER, MANAGER_FIELDS), true);
  limitSnapshot();
  save('result.json', { stage: 'delegation-repaired-and-rootless-initialized', resumeRecord, runEnabled: false, at: new Date().toISOString() });
  log('CPU 委派修复与 rootless Podman 初始化检查完成；未下载镜像、未运行学生代码。');
  log('C++ 编译运行仍关闭；真实容器隔离和编译待后续验证。');
  log('私有记录：' + record + '；日志：' + logPath);
}
if (process.argv[2] === '--repair-rootless-delegation') {
  try { await main(); }
  catch (error) {
    log('本次操作未完成；阶段：' + phase + '；错误码：' + (/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CHECK_FAILED'));
    if (repairVerified) log('CPU 委派已经核验通过，但后续初始化尚未全部完成；不要重复修复。');
    log('保留当前配置和私有记录，不自动删除或再次重启；请发回输出，不要重跑本脚本或旧脚本。');
    if (record) log('私有操作记录：' + record);
    log('本脚本未启用 C++ 编译运行；没有请求重启两个网站。');
    process.exitCode = 1;
  } finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_DELEGATION_NODE
