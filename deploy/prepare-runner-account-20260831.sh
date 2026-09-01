#!/usr/bin/env bash
# 仅准备独立执行账号、目录、用户映射和资源配置；不启动执行服务或容器。
# 此脚本用于首次准备，遇到已有账号或目录会停止，不接管或删除已有内容。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '此脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --prepare-runner-account <<'CPP_ACCOUNT_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const ACCOUNT = 'cpp-runner';
const NODE = ROOT + '/tools/node/bin/node';
const RANGE_START = 200000;
const RANGE_SIZE = 65536;
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
let phase = '只读预检';
let record;
let logFd;

function ensure(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function log(message) {
  const line = new Date().toISOString() + ' ' + message + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (error) {
    if (options.absentStatus !== undefined && error.status === options.absentStatus) return null;
    // 不把可能包含环境变量或密码片段的子进程输出写到公开日志。
    if (record) save('command-error-' + randomBytes(4).toString('hex') + '.json', { command, status: error.status, signal: error.signal, stderr: String(error.stderr || '') });
    throw Object.assign(new Error(), { code: 'COMMAND_' + path.basename(command).replace(/[^a-z0-9]/gi, '_').toUpperCase(), commandStatus: error.status });
  }
}
function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function regular(file) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'NOT_REGULAR_FILE');
  return stat;
}
function directory(dir) {
  ensure(fs.lstatSync(dir).isDirectory() && fs.realpathSync(dir) === dir, 'DIRECTORY_UNEXPECTED');
}
function hash(file) {
  regular(file);
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function save(name, value) {
  fs.writeFileSync(path.join(record, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
function step(message) {
  phase = message;
  log(message);
  if (record) fs.writeFileSync(path.join(record, 'phase.txt'), message + '\n', { mode: 0o600 });
}

// 用户映射范围先与全部已有映射及真实 UID/GID 核对，不覆盖 apphttp 等既有范围。
export function inspectMap(text, identities) {
  const last = RANGE_START + RANGE_SIZE - 1;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const fields = line.split(':');
    ensure(fields.length === 3 && fields[0] && /^\d+$/.test(fields[1]) && /^\d+$/.test(fields[2]), 'MAPPING_FORMAT');
    const start = Number(fields[1]);
    const size = Number(fields[2]);
    ensure(Number.isSafeInteger(start) && Number.isSafeInteger(size) && start > 0 && size > 0 && start + size - 1 < 4294967295, 'MAPPING_RANGE_INVALID');
    ensure(fields[0] !== ACCOUNT, 'RUNNER_MAPPING_EXISTS');
    ensure(start > last || start + size - 1 < RANGE_START, 'MAPPING_RANGE_CONFLICT');
  }
  for (const line of identities.trim().split('\n')) {
    const fields = line.split(':');
    ensure(fields.length >= 4 && /^\d+$/.test(fields[2]), 'IDENTITY_FORMAT');
    const id = Number(fields[2]);
    ensure(Number.isSafeInteger(id) && id >= 0 && id < 4294967295, 'IDENTITY_ID_INVALID');
    ensure(id < RANGE_START || id > last, 'MAPPING_REAL_ID_CONFLICT');
  }
}

// 系统账号工具允许追加新行，但原有行及其顺序、空格、注释、换行必须保留。
export function assertOnlyNewRow(before, after, expectedRow) {
  const pattern = new RegExp('^' + ACCOUNT + ':[^\\n]*(?:\\n|$)', 'gm');
  const added = after.match(pattern) || [];
  ensure(added.length === 1, 'ACCOUNT_ROW_COUNT');
  if (expectedRow !== undefined) ensure(added[0] === expectedRow, 'ACCOUNT_ROW_UNEXPECTED');
  ensure(after.replace(pattern, '') === before, 'EXISTING_ACCOUNT_ROWS_CHANGED');
}

export function sliceText(uid) {
  ensure(Number.isInteger(uid) && uid > 0 && uid < 65534, 'RUNNER_UID_INVALID');
  return '# 仅限制 cpp-runner 的用户服务，不修改全局 user.slice。\n' +
    '[Unit]\nDescription=C++ runner resource limits for UID ' + uid + '\n\n' +
    '[Slice]\nMemoryAccounting=yes\nCPUAccounting=yes\nTasksAccounting=yes\nMemoryMax=1G\nMemorySwapMax=0\nCPUQuota=100%\nTasksMax=256\n';
}

export function checkSiteValues(p5, cpp) {
  ensure(p5.status === 'OK' && p5.db_check === 'Database Active', 'P5_HEALTH_FAILED');
  ensure(cpp.mode === 'production' && cpp.writesEnabled === true && cpp.runEnabled === false, 'CPP_GATES_CHANGED');
}
function checkSites() {
  const request = url => JSON.parse(run('curl', ['--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', url]));
  checkSiteValues(request('https://tigao123.com/api/health'), request('https://tigao123.com/api/cpp/config'));
  log('两个网站 HTTPS 检查通过；C++ 写入开启、执行关闭。');
}
function pm2Snapshot() {
  const daemon = fs.readFileSync('/root/.pm2/pm2.pid', 'utf8').trim();
  ensure(/^\d+$/.test(daemon) && exists('/proc/' + daemon), 'PM2_DAEMON_NOT_RUNNING');
  const rows = JSON.parse(run('pm2', ['jlist']));
  for (const name of ['p5js-backend', 'teaching-cpp-backend']) ensure(rows.filter(row => row.name === name && row.pm2_env?.status === 'online').length === 1, 'WEBSITE_PM2_NOT_ONLINE');
  return rows.map(row => ({ id: row.pm_id, name: row.name, pid: row.pid, restarts: row.pm2_env.restart_time, status: row.pm2_env.status })).sort((a, b) => a.id - b.id);
}
function testAs(user, flag, file, expected) {
  // 仅做权限检查，不经过 PAM 建立登录会话；不把此参数用于后续 rootless 执行服务。
  const result = run('setpriv', ['--reuid', user, '--regid', user, '--clear-groups', '--no-new-privs', '/usr/bin/test', flag, file], { absentStatus: 1 });
  ensure((result !== null) === expected, 'PERMISSION_CHECK_FAILED');
}

async function prepare() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  directory(ROOT);
  directory('/var/www');
  directory(ROOT + '/backups');
  directory(ROOT + '/logs');
  directory('/etc/systemd/system');
  const backupStat = fs.statSync(ROOT + '/backups');
  ensure(backupStat.uid === 0 && (backupStat.mode & 0o777) === 0o700, 'PRIVATE_BACKUP_REQUIRED');
  ensure(run('uname', ['-m']).trim() === 'x86_64', 'ARCH_UNEXPECTED');
  ensure(run('getenforce', []).trim() === 'Disabled', 'SELINUX_STATE_CHANGED');
  ensure(run('stat', ['-fc', '%T', '/sys/fs/cgroup']).trim() === 'cgroup2fs', 'CGROUP_V2_REQUIRED');
  ensure(run('podman', ['--version']).trim() === 'podman version 5.8.2', 'PODMAN_VERSION_UNEXPECTED');
  ensure(run(NODE, ['--version']).trim() === 'v24.20.0', 'NODE_VERSION_UNEXPECTED');
  run('setpriv', ['--version']);
  ensure(run('usermod', ['--help']).includes('--add-subuids') && run('usermod', ['--help']).includes('--add-subgids'), 'SUBID_USERMOD_UNAVAILABLE');
  ensure(run('getent', ['passwd', ACCOUNT], { absentStatus: 2 }) === null, 'RUNNER_ACCOUNT_ALREADY_EXISTS');
  ensure(run('getent', ['group', ACCOUNT], { absentStatus: 2 }) === null, 'RUNNER_GROUP_ALREADY_EXISTS');
  ensure(!exists(HOME_DIR) && !exists(ROOT + '/.env.runner'), 'RUNNER_PATH_ALREADY_EXISTS');
  ensure(!exists('/var/lib/systemd/linger/' + ACCOUNT), 'RUNNER_LINGER_ALREADY_EXISTS');
  ensure(run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_PORT_IN_USE');
  const nss = fs.readFileSync('/etc/nsswitch.conf', 'utf8').split('\n').map(line => line.split('#')[0].trim()).filter(line => /^subid\s*:/.test(line));
  ensure(nss.length === 0 || (nss.length === 1 && /^subid\s*:\s*files\s*$/.test(nss[0])), 'SUBID_SOURCE_NOT_FILES');
  for (const helper of ['/usr/bin/newuidmap', '/usr/bin/newgidmap']) {
    const stat = regular(helper);
    ensure(stat.uid === 0 && (stat.mode & 0o022) === 0 && (stat.mode & 0o005) === 0o005, 'MAPPING_HELPER_PERMISSION');
  }
  run('/usr/bin/test', ['-x', '/sbin/nologin']);
  const identityFiles = ['passwd', 'group', 'shadow', 'gshadow', 'subuid', 'subgid'];
  const beforeIdentity = Object.fromEntries(identityFiles.map(name => { regular('/etc/' + name); return [name, fs.readFileSync('/etc/' + name, 'utf8')]; }));
  inspectMap(beforeIdentity.subuid, run('getent', ['passwd']));
  inspectMap(beforeIdentity.subgid, run('getent', ['group']));
  const unchangedPaths = [ROOT + '/.env', '/etc/selinux/config', '/etc/nsswitch.conf', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf'];
  if (exists('/root/.pm2/dump.pm2')) unchangedPaths.push('/root/.pm2/dump.pm2');
  const unchanged = Object.fromEntries(unchangedPaths.map(file => [file, hash(file)]));
  const beforePm2 = pm2Snapshot();
  checkSites();

  record = fs.mkdtempSync(ROOT + '/backups/runner-account-');
  const logPath = ROOT + '/logs/runner-account-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600);
  log('私有备份：' + record);
  log('操作日志：' + logPath);
  for (const [name, content] of Object.entries(beforeIdentity)) save(name + '.before', content);
  save('unchanged.json', unchanged);
  save('pm2-before.json', beforePm2);
  save('before-checksums.sha256', identityFiles.map(name => hash(record + '/' + name + '.before') + '  ' + name + '.before').join('\n') + '\n');

  step('创建无登录权限的独立账号；不使用此前不兼容的 CREATE_MAIL_SPOOL 参数');
  for (const [name, content] of Object.entries(beforeIdentity)) ensure(fs.readFileSync('/etc/' + name, 'utf8') === content, 'ACCOUNT_STATE_CHANGED_DURING_PREFLIGHT');
  run('useradd', ['--system', '--user-group', '--no-create-home', '--home-dir', HOME_DIR, '--shell', '/sbin/nologin', '--comment', 'C++ sandbox runner', ACCOUNT], { timeout: 0 });
  const entry = run('getent', ['passwd', ACCOUNT]).trim().split(':');
  const uid = Number(entry[2]);
  const gid = Number(entry[3]);
  ensure(entry.length === 7 && entry[0] === ACCOUNT && Number.isInteger(uid) && uid > 0 && uid < 65534 && Number.isInteger(gid) && gid > 0 && gid < 65534 && entry[5] === HOME_DIR && entry[6] === '/sbin/nologin', 'RUNNER_IDENTITY_UNEXPECTED');
  ensure(run('id', ['-Gn', ACCOUNT]).trim() === ACCOUNT, 'RUNNER_GROUPS_UNEXPECTED');
  const shadow = fs.readFileSync('/etc/shadow', 'utf8').split('\n').find(line => line.startsWith(ACCOUNT + ':'))?.split(':');
  ensure(shadow && /^[!*]/.test(shadow[1]), 'RUNNER_PASSWORD_NOT_LOCKED');
  for (const name of ['passwd', 'group', 'shadow', 'gshadow']) assertOnlyNewRow(beforeIdentity[name], fs.readFileSync('/etc/' + name, 'utf8'));
  ensure(fs.readFileSync('/etc/subuid', 'utf8') === beforeIdentity.subuid && fs.readFileSync('/etc/subgid', 'utf8') === beforeIdentity.subgid, 'UNEXPECTED_AUTOMATIC_MAPPING');
  save('identity.json', { account: ACCOUNT, uid, gid, home: HOME_DIR });

  step('追加 200000～265535 的独立映射，并逐字核对原有行');
  inspectMap(fs.readFileSync('/etc/subuid', 'utf8'), run('getent', ['passwd']));
  inspectMap(fs.readFileSync('/etc/subgid', 'utf8'), run('getent', ['group']));
  run('usermod', ['--add-subuids', '200000-265535', '--add-subgids', '200000-265535', ACCOUNT], { timeout: 0 });
  for (const name of ['subuid', 'subgid']) assertOnlyNewRow(beforeIdentity[name], fs.readFileSync('/etc/' + name, 'utf8'), ACCOUNT + ':' + RANGE_START + ':' + RANGE_SIZE + '\n');
  for (const name of ['passwd', 'group', 'shadow', 'gshadow']) assertOnlyNewRow(beforeIdentity[name], fs.readFileSync('/etc/' + name, 'utf8'));

  step('建立独立家目录和工作目录，检查与网站账号的文件权限分离');
  const directories = ['', '/runner-data', '/.config', '/.config/containers', '/.config/systemd', '/.config/systemd/user', '/.local', '/.local/share'];
  for (const suffix of directories) {
    const dir = HOME_DIR + suffix;
    ensure(!exists(dir), 'DIRECTORY_ALREADY_EXISTS');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.chownSync(dir, uid, gid);
  }
  for (const suffix of directories) {
    const stat = fs.lstatSync(HOME_DIR + suffix);
    ensure(stat.isDirectory() && stat.uid === uid && stat.gid === gid && (stat.mode & 0o777) === 0o700, 'RUNNER_DIRECTORY_PERMISSION');
  }
  testAs(ACCOUNT, '-r', ROOT + '/.env', false);
  testAs(ACCOUNT, '-x', ROOT + '/storage', false);
  testAs(ACCOUNT, '-x', ROOT + '/backups', false);
  testAs(ACCOUNT, '-w', ROOT, false);
  testAs(ACCOUNT, '-w', NODE, false);
  testAs(ACCOUNT, '-r', ROOT + '/runner/src/server.mjs', true);
  testAs(ACCOUNT, '-w', HOME_DIR + '/runner-data', true);
  testAs('cpp-web', '-x', HOME_DIR, false);
  run('setpriv', ['--reuid', ACCOUNT, '--regid', ACCOUNT, '--clear-groups', '--no-new-privs', 'env', '-i', 'HOME=' + HOME_DIR, 'USER=' + ACCOUNT, 'LOGNAME=' + ACCOUNT, 'PATH=/usr/bin:/bin', NODE, '--input-type=module', '-e', 'await import("express"); await import("dotenv");'], { timeout: 20000 });

  step('只为新账号写入 systemd slice 配置，不启动用户服务');
  const unit = 'user-' + uid + '.slice';
  for (const base of ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system']) {
    ensure(!exists(base + '/' + unit) && !exists(base + '/' + unit + '.d'), 'RUNNER_SLICE_ALREADY_CONFIGURED');
  }
  ensure(run('ps', ['-eo', 'uid=']).trim().split(/\s+/).every(value => Number(value) !== uid), 'RUNNER_UID_HAS_PROCESSES');
  const text = sliceText(uid);
  save(unit, text);
  run('systemd-analyze', ['verify', record + '/' + unit]);
  // 使用具体 UID 的 drop-in，避免发行版通用 user-.slice.d 默认值覆盖本账号的限额。
  const unitDirectory = '/etc/systemd/system/' + unit + '.d';
  fs.mkdirSync(unitDirectory, { mode: 0o755 });
  fs.chmodSync(unitDirectory, 0o755);
  const unitPath = unitDirectory + '/90-teaching-cpp-limits.conf';
  fs.writeFileSync(unitPath, text, { flag: 'wx', mode: 0o644 });
  fs.chmodSync(unitPath, 0o644);
  run('systemctl', ['daemon-reload']);
  const properties = Object.fromEntries(run('systemctl', ['show', unit, '--property=LoadState,ActiveState,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,DropInPaths']).trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
  ensure(properties.LoadState === 'loaded' && properties.ActiveState === 'inactive' && properties.MemoryMax === '1073741824' && properties.MemorySwapMax === '0' && properties.CPUQuotaPerSecUSec === '1s' && properties.TasksMax === '256', 'SLICE_CONFIG_UNEXPECTED');
  ensure(properties.DropInPaths?.split(/\s+/).includes(unitPath), 'SLICE_DROPIN_NOT_LOADED');
  save('slice-properties.json', properties);

  step('核对原配置、原账号记录、两个网站及 PM2 进程');
  for (const [file, digest] of Object.entries(unchanged)) ensure(hash(file) === digest, 'EXISTING_CONFIGURATION_CHANGED');
  for (const name of ['passwd', 'group', 'shadow', 'gshadow']) assertOnlyNewRow(beforeIdentity[name], fs.readFileSync('/etc/' + name, 'utf8'));
  for (const name of ['subuid', 'subgid']) assertOnlyNewRow(beforeIdentity[name], fs.readFileSync('/etc/' + name, 'utf8'), ACCOUNT + ':' + RANGE_START + ':' + RANGE_SIZE + '\n');
  checkSites();
  const afterPm2 = pm2Snapshot();
  ensure(JSON.stringify(afterPm2) === JSON.stringify(beforePm2), 'PM2_PROCESSES_CHANGED');
  ensure(run('getenforce', []).trim() === 'Disabled', 'SELINUX_STATE_CHANGED');
  ensure(run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_PORT_IN_USE');
  ensure(!exists('/var/lib/systemd/linger/' + ACCOUNT) && !exists(ROOT + '/.env.runner'), 'RUNNER_UNEXPECTEDLY_ACTIVATED');
  save('result.json', { stage: 'account-prepared-services-not-started', at: new Date().toISOString(), account: ACCOUNT, uid, gid, home: HOME_DIR, mapping: { start: RANGE_START, count: RANGE_SIZE }, unit: unitPath, properties, pm2: afterPm2, writesEnabled: true, runEnabled: false });
  phase = '完成';
  log('账号准备完成：' + ACCOUNT + '，UID=' + uid + '，GID=' + gid + '；密码锁定，交互登录关闭。');
  log('独立目录：' + HOME_DIR + '；网站配置不可读，网站账号不能进入执行目录。');
  log('资源配置已加载且 slice 未启动：内存上限 1 GiB，CPU 额度 1 核，进程/线程合计上限 256，swap 上限 0。');
  log('原 p5.js 和 C++ 进程 PID、重启计数及状态未变：' + JSON.stringify(afterPm2));
  log('未启用 linger、未初始化 Podman、未下载镜像、未启动执行服务；容器隔离和限额实际执行仍待验证。');
  log('私有备份：' + record + '；日志：' + logPath);
}

if (process.argv[2] === '--prepare-runner-account') {
  try { await prepare(); }
  catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CHECK_FAILED';
    log('准备未完成；阶段：' + phase + '；错误码：' + code);
    if (error.commandStatus !== undefined) log('系统命令退出码：' + error.commandStatus);
    if (record) log('已完成的账号或目录可能保留，请勿重复执行或自动删除。私有备份：' + record);
    log('C++ 运行开关未由本脚本开启。请发回此输出继续排查。');
    process.exitCode = 1;
  } finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_ACCOUNT_NODE
