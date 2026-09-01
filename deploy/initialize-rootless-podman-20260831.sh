#!/usr/bin/env bash
# 仅初始化 cpp-runner 的 rootless Podman；不下载镜像、不运行学生代码、不启用网站执行开关。
# 此脚本只用于首次初始化；保留已有账号、映射、网站配置和已完成的账号准备记录。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --initialize-rootless-podman <<'CPP_ROOTLESS_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = '/var/www/teaching-cpp-backend';
const RUNNER_HOME = '/var/www/teaching-cpp-runner';
const ACCOUNT = 'cpp-runner';
const UID = 994;
const GID = 991;
const NODE = ROOT + '/tools/node/bin/node';
const RUNTIME = '/run/user/994';
const ACCOUNT_BACKUP = ROOT + '/backups/runner-account-RQI6nx';
const SLICE = 'user-994.slice';
const MANAGER = 'user@994.service';
const SLICE_CGROUP = '/user.slice/user-994.slice';
const MANAGER_CGROUP = SLICE_CGROUP + '/user@994.service';
const STORAGE = RUNNER_HOME + '/.local/share/containers/storage';
const STORAGE_CONF = RUNNER_HOME + '/.config/containers/storage.conf';
const ENGINE_CONF = RUNNER_HOME + '/.config/containers/containers.conf';
const LIMITS = '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf';
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const runnerEnv = { HOME: RUNNER_HOME, USER: ACCOUNT, LOGNAME: ACCOUNT, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: RUNNER_HOME + '/.config', XDG_DATA_HOME: RUNNER_HOME + '/.local/share', XDG_RUNTIME_DIR: RUNTIME, DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + RUNTIME + '/bus', TMPDIR: RUNNER_HOME + '/tmp' };
let phase = '初始目录检查';
let record;
let logFd;
let probeUnit;
let probeStarted = false;

function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function log(message) {
  const line = new Date().toISOString() + ' ' + message + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function regular(file) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'NOT_REGULAR_FILE');
  return stat;
}
function directory(file, uid, mode) {
  const stat = fs.lstatSync(file);
  ensure(stat.isDirectory() && fs.realpathSync(file) === file && stat.uid === uid && (stat.mode & 0o777) === mode, 'DIRECTORY_UNEXPECTED');
}
function hash(file) { regular(file); return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function readJson(file) {
  const stat = regular(file);
  ensure(stat.uid === 0 && (stat.mode & 0o077) === 0 && stat.size < 1024 * 1024, 'PRIVATE_RECORD_REQUIRED');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(name, value) { fs.writeFileSync(path.join(record, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(message) {
  phase = message;
  log(message);
  if (record) fs.writeFileSync(path.join(record, 'phase.txt'), message + '\n', { mode: 0o600 });
}
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch (error) {
    // 完整子命令错误仅保存在私有记录，不向终端输出环境变量或任意 stderr 内容。
    if (record) save('command-error-' + randomBytes(4).toString('hex') + '.json', { command, status: error.status, signal: error.signal, stderr: String(error.stderr || '') });
    throw Object.assign(new Error(), { code: 'COMMAND_' + path.basename(command).replace(/[^a-z0-9]/gi, '_').toUpperCase(), commandStatus: error.status });
  }
}
function asRunner(command, args, options = {}) {
  // 不使用 rootful Podman，也不通过 PAM 建立临时登录；真正的初始化命令由用户管理器启动。
  return run('/usr/bin/setpriv', ['--reuid', String(UID), '--regid', String(GID), '--clear-groups', command, ...args], { ...options, env: runnerEnv });
}
export function parseProperties(text) {
  const result = {};
  for (const line of text.trim().split('\n')) {
    const at = line.indexOf('=');
    ensure(at > 0 && !Object.hasOwn(result, line.slice(0, at)), 'PROPERTY_FORMAT');
    result[line.slice(0, at)] = line.slice(at + 1);
  }
  return result;
}
function properties(unit, fields) { return parseProperties(run('systemctl', ['show', unit, '--property=' + fields.join(',')])); }
export function checkLimits(values, state) {
  ensure(values.LoadState === 'loaded' && values.ActiveState === state && values.MemoryMax === '1073741824' && values.MemorySwapMax === '0' && values.CPUQuotaPerSecUSec === '1s' && values.TasksMax === '256', 'SLICE_LIMITS_UNEXPECTED');
  ensure(values.DropInPaths?.split(/\s+/).includes(LIMITS), 'SLICE_DROPIN_MISSING');
}
export function checkCgroupLimits(values) {
  ensure(values.memory === '1073741824' && values.swap === '0' && values.pids === '256', 'CGROUP_LIMITS_UNEXPECTED');
  const cpu = values.cpu.split(/\s+/);
  ensure(cpu.length === 2 && cpu.every(value => /^\d+$/.test(value)) && Number(cpu[0]) > 0 && Number(cpu[0]) === Number(cpu[1]), 'CGROUP_CPU_UNEXPECTED');
}
export function checkMap(rows, hostId) {
  ensure(Array.isArray(rows) && rows.length === 2, 'NAMESPACE_MAPPING_UNEXPECTED');
  const expected = [{ container_id: 0, host_id: hostId, size: 1 }, { container_id: 1, host_id: 200000, size: 65536 }];
  for (let i = 0; i < 2; i++) for (const key of ['container_id', 'host_id', 'size']) ensure(rows[i][key] === expected[i][key], 'NAMESPACE_MAPPING_UNEXPECTED');
}
export function parseMap(text) {
  return text.trim().split('\n').map(line => {
    const values = line.trim().split(/\s+/);
    ensure(values.length === 3 && values.every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))), 'NAMESPACE_MAPPING_FORMAT');
    return { container_id: Number(values[0]), host_id: Number(values[1]), size: Number(values[2]) };
  });
}
export function checkPodman(info) {
  ensure(info.version?.Version === '5.8.2' && info.host?.arch === 'amd64', 'PODMAN_VERSION_UNEXPECTED');
  ensure(info.host.security?.rootless === true && info.host.security?.seccompEnabled === true && info.host.serviceIsRemote === false && info.host.cgroupVersion === 'v2' && info.host.cgroupManager === 'systemd', 'ROOTLESS_ISOLATION_UNAVAILABLE');
  ensure(['cpu', 'memory', 'pids'].every(value => info.host.cgroupControllers?.includes(value)), 'DELEGATED_CONTROLLERS_MISSING');
  ensure(info.host.ociRuntime?.name === 'crun', 'OCI_RUNTIME_UNEXPECTED');
  checkMap(info.host.idMappings?.uidmap, UID);
  checkMap(info.host.idMappings?.gidmap, GID);
  ensure(info.store?.graphDriverName === 'overlay' && info.store.graphRoot === STORAGE && info.store.runRoot === RUNTIME + '/containers' && info.store.configFile === STORAGE_CONF && info.store.imageCopyTmpDir === RUNNER_HOME + '/tmp', 'PODMAN_STORAGE_UNEXPECTED');
  ensure(info.store.containerStore?.number === 0 && info.store.imageStore?.number === 0, 'PODMAN_STORE_NOT_EMPTY');
  return { rootless: true, cgroupVersion: 'v2', cgroupManager: 'systemd', seccompEnabled: true, runtime: 'crun', graphRoot: STORAGE, runRoot: info.store.runRoot, images: 0, containers: 0 };
}
export function checkProbeLocation(value, unit) {
  ensure(value.uid === UID && value.gid === GID, 'PROBE_IDENTITY_UNEXPECTED');
  ensure(typeof unit === 'string' && /^cpp-podman-init-[a-f0-9]{12}\.service$/.test(unit), 'PROBE_UNIT_UNEXPECTED');
  ensure(value.cgroup.startsWith(MANAGER_CGROUP + '/') && value.cgroup.endsWith('/' + unit) && !value.cgroup.includes('/../'), 'PROBE_CGROUP_UNEXPECTED');
}
function pm2Snapshot() {
  const daemon = fs.readFileSync('/root/.pm2/pm2.pid', 'utf8').trim();
  ensure(/^\d+$/.test(daemon) && exists('/proc/' + daemon), 'PM2_DAEMON_NOT_RUNNING');
  const rows = JSON.parse(run('pm2', ['jlist']));
  for (const name of ['p5js-backend', 'teaching-cpp-backend']) ensure(rows.filter(row => row.name === name && row.pm2_env?.status === 'online').length === 1, 'WEBSITE_PM2_NOT_ONLINE');
  return rows.map(row => ({ id: row.pm_id, name: row.name, pid: row.pid, restarts: row.pm2_env.restart_time, status: row.pm2_env.status })).sort((a, b) => a.id - b.id);
}
function checkSites(checkSiteValues) {
  const request = url => JSON.parse(run('curl', ['--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', url]));
  checkSiteValues(request('https://tigao123.com/api/health'), request('https://tigao123.com/api/cpp/config'));
  log('两个网站 HTTPS 检查通过；C++ 写入开启、执行关闭。');
}

async function probe(expectedUnit) {
  const fs = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const fail = code => { throw Object.assign(new Error(), { code }); };
  try {
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
    if (process.getuid() !== 994 || process.getgid() !== 991 || !cgroup.startsWith('/user.slice/user-994.slice/user@994.service/') || !cgroup.endsWith('/' + expectedUnit)) fail('PROBE_CONTEXT_UNEXPECTED');
    if (!/^NoNewPrivs:\s+0\s*$/m.test(fs.readFileSync('/proc/self/status', 'utf8'))) fail('PROBE_MAPPING_HELPERS_BLOCKED');
    const call = args => execFileSync('/usr/bin/podman', ['--remote=false', ...args], { encoding: 'utf8', timeout: 12000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const info = JSON.parse(call(['info', '--format', 'json']));
    const uidMap = call(['unshare', '/usr/bin/cat', '/proc/self/uid_map']);
    const gidMap = call(['unshare', '/usr/bin/cat', '/proc/self/gid_map']);
    process.stdout.write(JSON.stringify({ uid: process.getuid(), gid: process.getgid(), cgroup, info, uidMap, gidMap }) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ code: error.code || 'PODMAN_PROBE_FAILED', status: error.status, stderr: String(error.stderr || '') }) + '\n');
    process.exitCode = 1;
  }
}

async function initialize() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  directory(ROOT, 0, 0o755);
  directory(ROOT + '/backups', 0, 0o700);
  directory(ROOT + '/logs', 995, 0o750);
  const logPath = ROOT + '/logs/rootless-init-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600);
  log('操作日志：' + logPath);
  step('只读预检：已完成的账号准备、原网站和未初始化的目录');
  const previous = ROOT + '/deploy/prepare-runner-account-20260831-02.sh';
  ensure(hash(previous) === '78dd26246bff6ad0c011703ce6672e4ec042c271e1260eaf66e7bb8425c48489', 'ACCOUNT_SCRIPT_CHANGED');
  const embedded = /<<'CPP_ACCOUNT_NODE'\n([\s\S]+)\nCPP_ACCOUNT_NODE\n$/.exec(fs.readFileSync(previous, 'utf8'));
  ensure(embedded, 'ACCOUNT_SCRIPT_FORMAT');
  // 只加载已校验旧脚本的纯检查函数；当前入口参数不同，不执行旧准备流程。
  const { sliceText, nssSnapshot, assertNssUnchanged, checkSiteValues } = await import('data:text/javascript;base64,' + Buffer.from(embedded[1]).toString('base64'));
  directory(ACCOUNT_BACKUP, 0, 0o700);
  const previousResult = readJson(ACCOUNT_BACKUP + '/result.json');
  ensure(previousResult.stage === 'account-prepared-services-not-started' && previousResult.account === ACCOUNT && previousResult.uid === UID && previousResult.gid === GID && previousResult.home === RUNNER_HOME && previousResult.unit === LIMITS, 'ACCOUNT_PREPARATION_NOT_CONFIRMED');
  const account = run('getent', ['passwd', ACCOUNT]).trim().split(':');
  ensure(account.length === 7 && account[0] === ACCOUNT && account[2] === String(UID) && account[3] === String(GID) && account[5] === RUNNER_HOME && account[6] === '/sbin/nologin', 'RUNNER_IDENTITY_CHANGED');
  ensure(run('id', ['-Gn', ACCOUNT]).trim() === ACCOUNT, 'RUNNER_GROUPS_CHANGED');
  for (const name of ['subuid', 'subgid']) {
    const text = fs.readFileSync('/etc/' + name, 'utf8');
    const before = fs.readFileSync(ACCOUNT_BACKUP + '/' + name + '.before', 'utf8');
    ensure(text === before + ACCOUNT + ':200000:65536\n', 'RUNNER_MAPPING_CHANGED');
  }
  for (const suffix of ['', '/runner-data', '/.config', '/.config/containers', '/.config/systemd', '/.config/systemd/user', '/.local', '/.local/share']) directory(RUNNER_HOME + suffix, UID, 0o700);
  for (const suffix of ['/runner-data', '/.config/containers', '/.config/systemd/user', '/.local/share']) ensure(fs.readdirSync(RUNNER_HOME + suffix).length === 0, 'RUNNER_DIRECTORY_NOT_EMPTY');
  for (const file of [RUNNER_HOME + '/tmp', RUNNER_HOME + '/.config/containers.conf', RUNNER_HOME + '/.config/environment.d', RUNNER_HOME + '/.config/containers/systemd', ROOT + '/.env.runner', RUNTIME, '/var/lib/systemd/linger/' + ACCOUNT]) ensure(!exists(file), 'RUNNER_ALREADY_INITIALIZED');
  ensure(run('ps', ['-eo', 'uid=']).trim().split(/\s+/).every(value => Number(value) !== UID), 'RUNNER_HAS_PROCESSES');
  ensure(run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_PORT_IN_USE');
  ensure(run('getenforce', []).trim() === 'Disabled', 'SELINUX_STATE_CHANGED');
  ensure(run('podman', ['--version']).trim() === 'podman version 5.8.2' && run(NODE, ['--version']).trim() === 'v24.20.0', 'TOOL_VERSION_CHANGED');
  run('/usr/bin/test', ['-x', '/usr/bin/fuse-overlayfs']);
  run('/usr/bin/test', ['-x', '/usr/bin/crun']);
  ensure(fs.readFileSync(LIMITS, 'utf8') === sliceText(UID), 'SLICE_CONFIG_CHANGED');
  const limitFields = ['LoadState', 'ActiveState', 'MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'DropInPaths', 'ControlGroup'];
  const beforeLimits = properties(SLICE, limitFields);
  checkLimits(beforeLimits, 'inactive');
  const beforeManager = properties(MANAGER, ['ActiveState', 'Delegate']);
  ensure(beforeManager.ActiveState === 'inactive' && beforeManager.Delegate === 'yes', 'USER_MANAGER_UNEXPECTED');
  const beforeNss = nssSnapshot();
  const unchangedFiles = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', LIMITS];
  const unchanged = Object.fromEntries(unchangedFiles.map(file => [file, hash(file)]));
  const beforePm2 = pm2Snapshot();
  checkSites(checkSiteValues);
  record = fs.mkdtempSync(ROOT + '/backups/rootless-init-');
  log('私有操作记录：' + record);
  save('before.json', { uid: UID, gid: GID, nss: beforeNss, hashes: unchanged, pm2: beforePm2, slice: beforeLimits, manager: beforeManager, lingering: false });

  step('仅为 cpp-runner 写入容器配置和临时目录，不修改系统容器配置');
  const storageText = '# cpp-runner 独立存储，不与 root 或网站账号共享。\n[storage]\ndriver = "overlay"\nrunroot = "' + RUNTIME + '/containers"\ngraphroot = "' + STORAGE + '"\n\n[storage.options.overlay]\nmount_program = "/usr/bin/fuse-overlayfs"\n';
  const engineText = '# cpp-runner 使用用户 systemd 管理；镜像临时文件保持在独立家目录中。\n[engine]\ncgroup_manager = "systemd"\nruntime = "crun"\nimage_copy_tmp_dir = "' + RUNNER_HOME + '/tmp"\n';
  for (const [file, content] of [[STORAGE_CONF, storageText], [ENGINE_CONF, engineText]]) {
    fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
    fs.chownSync(file, UID, GID);
  }
  fs.mkdirSync(RUNNER_HOME + '/tmp', { mode: 0o700 });
  fs.chownSync(RUNNER_HOME + '/tmp', UID, GID);
  save('created-configs.json', { storage: STORAGE_CONF, storageSha256: hash(STORAGE_CONF), engine: ENGINE_CONF, engineSha256: hash(ENGINE_CONF) });

  step('只为 cpp-runner 启用后台用户管理，保持现有 slice 限额');
  run('loginctl', ['enable-linger', ACCOUNT]);
  run('systemctl', ['start', '--no-block', MANAGER]);
  let manager;
  for (let attempt = 0; attempt < 40; attempt++) {
    manager = properties(MANAGER, ['ActiveState', 'SubState', 'Delegate', 'MainPID', 'ControlGroup']);
    if (manager.ActiveState === 'active' && exists(RUNTIME + '/bus')) break;
    ensure(manager.ActiveState !== 'failed', 'USER_MANAGER_FAILED');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  ensure(manager.ActiveState === 'active' && manager.Delegate === 'yes' && manager.ControlGroup === MANAGER_CGROUP && exists(RUNTIME + '/bus'), 'USER_MANAGER_NOT_READY');
  directory(RUNTIME, UID, 0o700);
  const userStatus = parseProperties(run('loginctl', ['show-user', ACCOUNT, '--property=Linger,RuntimePath']));
  ensure(userStatus.Linger === 'yes' && userStatus.RuntimePath === RUNTIME, 'LINGER_NOT_READY');
  const limits = properties(SLICE, limitFields);
  checkLimits(limits, 'active');
  ensure(limits.ControlGroup === SLICE_CGROUP, 'SLICE_CGROUP_UNEXPECTED');
  const values = Object.fromEntries([['memory', 'memory.max'], ['swap', 'memory.swap.max'], ['cpu', 'cpu.max'], ['pids', 'pids.max']].map(([name, file]) => [name, fs.readFileSync('/sys/fs/cgroup' + SLICE_CGROUP + '/' + file, 'utf8').trim()]));
  checkCgroupLimits(values);
  const controllers = fs.readFileSync('/sys/fs/cgroup' + MANAGER_CGROUP + '/cgroup.controllers', 'utf8').trim().split(/\s+/);
  ensure(['cpu', 'memory', 'pids'].every(value => controllers.includes(value)), 'USER_MANAGER_CONTROLLERS_MISSING');
  save('user-manager.json', { manager, userStatus, limits, values, controllers });
  log('用户管理器已启动；内核中的账号总限额已核对。');

  step('在用户服务内初始化 Podman 并核验实际用户映射；不拉取镜像');
  probeUnit = 'cpp-podman-init-' + randomBytes(6).toString('hex') + '.service';
  save('probe-unit.json', { unit: probeUnit });
  const source = '(' + probe.toString() + ')(' + JSON.stringify(probeUnit) + ');';
  probeStarted = true;
  const output = asRunner('/usr/bin/systemd-run', ['--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + probeUnit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=45', '--property=TimeoutStopSec=10', '--property=WorkingDirectory=' + RUNNER_HOME, '/usr/bin/env', '-i', ...Object.entries(runnerEnv).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', source], { timeout: 60000 });
  probeStarted = false;
  const result = JSON.parse(output);
  save('podman-probe.json', result);
  checkProbeLocation(result, probeUnit);
  const summary = checkPodman(result.info);
  checkMap(parseMap(result.uidMap), UID);
  checkMap(parseMap(result.gidMap), GID);
  log('rootless、systemd、cgroup v2、seccomp 和实际 UID/GID 映射检查通过。');
  log('存储位置：' + STORAGE + '；当前镜像 0、容器 0。');

  step('检查原配置、原账号、两个网站和 PM2 进程保持不变');
  for (const [file, digest] of Object.entries(unchanged)) ensure(hash(file) === digest, 'EXISTING_CONFIGURATION_CHANGED');
  assertNssUnchanged(beforeNss);
  ensure(fs.readFileSync(STORAGE_CONF, 'utf8') === storageText && fs.readFileSync(ENGINE_CONF, 'utf8') === engineText, 'RUNNER_CONFIG_CHANGED');
  ensure(!exists(ROOT + '/.env.runner') && run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_UNEXPECTEDLY_STARTED');
  checkSites(checkSiteValues);
  const afterPm2 = pm2Snapshot();
  ensure(JSON.stringify(afterPm2) === JSON.stringify(beforePm2), 'PM2_PROCESSES_CHANGED');
  checkLimits(properties(SLICE, limitFields), 'active');
  save('result.json', { stage: 'rootless-initialized-no-images', at: new Date().toISOString(), account: ACCOUNT, uid: UID, gid: GID, summary, values, pm2: afterPm2, lingering: true, runEnabled: false });
  log('rootless Podman 初始化完成；只启动了 cpp-runner 的用户管理器及初始化所需辅助进程。');
  log('未下载镜像、未运行学生代码、未启动 C++ 执行服务；两个网站进程未重启。');
  log('真实容器挂载、隔离、编译及容器内限额仍待下一步验证。');
  log('私有操作记录：' + record + '；日志：' + logPath);
}

if (process.argv[2] === '--initialize-rootless-podman') {
  try { await initialize(); }
  catch (error) {
    log('初始化未完成；阶段：' + phase + '；错误码：' + (/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CHECK_FAILED'));
    if (error.commandStatus !== undefined) log('系统命令退出码：' + error.commandStatus);
    if (probeStarted && probeUnit) {
      // 只停止本次命名的临时检查服务，不停止用户管理器、其他任务或已有网站。
      try { asRunner('/usr/bin/systemctl', ['--user', 'stop', '--no-block', probeUnit]); log('已请求停止本次临时检查服务。'); }
      catch { log('临时检查服务停止请求未确认，另有服务运行时限；请保留现场排查。'); }
    }
    log('不自动删除配置、存储或关闭用户管理器。请发回输出，不要重跑初始化或账号准备脚本。');
    if (record) log('私有操作记录：' + record);
    log('本脚本没有启用 C++ 编译运行开关。');
    process.exitCode = 1;
  } finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_ROOTLESS_NODE
