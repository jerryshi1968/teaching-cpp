#!/usr/bin/env bash
# 仅把已核验的 GCC 离线包导入 cpp-runner 的 rootless 镜像库，不联网下载、不运行容器。
# 保留现有账号限额、网站与配置，不重启用户管理器或网站，不开启编译运行。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --import-gcc-base-image <<'CPP_GCC_IMPORT_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const NODE = ROOT + '/tools/node/bin/node';
const RUNTIME = '/run/user/994';
const SLICE_CGROUP = '/user.slice/user-994.slice';
const MANAGER = 'user@994.service';
const OLD_RECORD = ROOT + '/backups/gcc-base-image-lthZ31';
const REPAIR_RECORD = ROOT + '/backups/rootless-delegation-d6YPe9';
const RESUME_RECORD = ROOT + '/backups/rootless-resume-0gFyZA';
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: RUNTIME, DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + RUNTIME + '/bus', TMPDIR: HOME_DIR + '/tmp' };
export const ARCHIVE = Object.freeze({ name: 'gcc-14.4.0-linux-amd64.oci.tar', bytes: 540504576, sha256: '4190852b88d938f8695a3208bcc76aaed5818b27556727d66541f2d508cac4fc' });
export const DIFF_IDS = Object.freeze([
  'sha256:31631a95db7cd650d1c826f269b9e93b57d9f418128bf7c5499b4403be4d44d0',
  'sha256:7c367ef8c1ea18872336c6bc0672b2ff7fee5dc56c055ce54e62f2ccfde4f847',
  'sha256:144ea2bdbdf828c7c9867865b4eeffc5ec977e8e686cdfd1e240a890e9d4cf8e',
  'sha256:758a60093d45fcab0f50466c34253fcdaea5dbb0bacd6495bda7d4e8d90e61d6',
  'sha256:929ba9db121af4494e9aabd0210a639835c079ec331141d8e82773ccfa867cb2',
  'sha256:f3ce35d2fbd9665661d2bcb9d05f8c2037ffa0d31a09df9750ae4d1fe028abf1',
  'sha256:7f20064d525e026bf708bcf4eec89b287cd0f3a16a033538be6ba8f10a9764f2',
  'sha256:ade0ac3a5978731ef88c336b6c1e2178eacef47a7148ff1702522aba19f1268d'
]);
let helpers, repairHelpers, accountHelpers, imageHelpers;
let record, logFd, phase = '初始检查', workerUnit;
let lockFd;
const LOCK = ROOT + '/backups/gcc-base-import.lock';

function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(value) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'CHECK_FAILED'; }
function log(message) {
  const line = new Date().toISOString() + ' ' + message + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function directory(file, uid, mode, gid) {
  const stat = fs.lstatSync(file);
  ensure(stat.isDirectory() && fs.realpathSync(file) === file && stat.uid === uid && (stat.mode & 0o777) === mode && (gid === undefined || stat.gid === gid), 'DIRECTORY_UNEXPECTED');
}
function read(file, privateFile = false) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fs.realpathSync(file) === file && stat.size < 12 * 1024 * 1024, 'FILE_UNEXPECTED');
  if (privateFile) ensure(stat.uid === 0 && (stat.mode & 0o077) === 0, 'PRIVATE_RECORD_REQUIRED');
  return fs.readFileSync(file);
}
function hash(file) { return createHash('sha256').update(read(file)).digest('hex'); }
function readJson(file) { return JSON.parse(read(file, true)); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(message) { phase = message; log(message); fs.writeFileSync(record + '/phase.txt', message + '\n', { mode: 0o600 }); }
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch (error) {
    // 命令原始错误只留在 root 私有记录，不公开环境变量或任意 stderr。
    if (record) save('command-error-' + randomBytes(4).toString('hex') + '.json', { command, status: error.status, signal: error.signal, code: error.code, stderr: String(error.stderr || '') });
    throw Object.assign(new Error(), { code: 'COMMAND_' + path.basename(command).replace(/[^a-z0-9]/gi, '_').toUpperCase() });
  }
}
async function loadHelpers(file, expected, marker) {
  ensure(hash(file) === expected, 'DELIVERED_SCRIPT_CHANGED');
  const text = read(file).toString('utf8');
  const start = text.indexOf("<<'" + marker + "'\n"), end = text.lastIndexOf('\n' + marker + '\n');
  ensure(start >= 0 && end > start && end + marker.length + 2 === text.length, 'EMBEDDED_SCRIPT_FORMAT');
  // 当前入口参数不同，仅加载已经交付的纯检查函数，不执行旧准备或下载流程。
  return import('data:text/javascript;base64,' + Buffer.from(text.slice(start + marker.length + 5, end)).toString('base64'));
}
function properties(unit, fields) { return helpers.parseProperties(run('/usr/bin/systemctl', ['show', ...helpers.propertyOptions(fields), '--', unit]), fields); }
function manager() { return properties(MANAGER, ['Id', 'User', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlGroup', 'Delegate', 'DelegateControllers', 'DisableControllers', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload']); }
function limits() {
  const config = properties('user-994.slice', ['LoadState', 'ActiveState', 'MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'DropInPaths', 'ControlGroup']);
  helpers.checkLimits(config, 'active'); ensure(config.ControlGroup === SLICE_CGROUP, 'SLICE_CHANGED');
  const kernel = Object.fromEntries([['memory', 'memory.max'], ['swap', 'memory.swap.max'], ['cpu', 'cpu.max'], ['pids', 'pids.max']].map(([key, file]) => [key, fs.readFileSync('/sys/fs/cgroup' + SLICE_CGROUP + '/' + file, 'utf8').trim()]));
  helpers.checkCgroupLimits(kernel);
  return { config, kernel };
}
function websites() {
  const get = endpoint => JSON.parse(run('curl', ['-q', '--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', 'https://tigao123.com/api/' + endpoint]));
  accountHelpers.checkSiteValues(get('health'), get('cpp/config'));
  log('两个网站 HTTPS 正常；C++ 写入开启、编译运行关闭。');
}
function pm2Snapshot() {
  const pid = read('/root/.pm2/pm2.pid').toString('utf8').trim();
  ensure(/^[1-9][0-9]*$/.test(pid) && exists('/proc/' + pid), 'PM2_DAEMON_NOT_RUNNING');
  const rows = JSON.parse(run('pm2', ['jlist']));
  for (const name of ['p5js-backend', 'teaching-cpp-backend']) ensure(rows.filter(row => row.name === name && row.pm2_env?.status === 'online').length === 1, 'WEBSITE_PM2_NOT_ONLINE');
  return rows.map(row => ({ id: row.pm_id, name: row.name, pid: row.pid, restarts: row.pm2_env?.restart_time, status: row.pm2_env?.status })).sort((a, b) => a.id - b.id);
}
export function checkOldFailure(value) {
  ensure(value && typeof value.stdout === 'string' && Number.isInteger(value.status) && value.status !== 0, 'OLD_WORKER_RECORD_UNEXPECTED');
  const events = value.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  ensure(events.some(row => row.event === 'stage' && row.value === 'rootless-checked') && events.some(row => row.event === 'error') && !events.some(row => row.event === 'complete' || row.event === 'progress' || (row.event === 'stage' && row.value === 'official-manifest-verified')), 'OLD_WORKER_STAGE_UNEXPECTED');
}
export function checkInactiveUnit(exit, values, processes) {
  ensure([0, 1].includes(exit) && processes.complete === true && processes.pids.length === 0, 'PREVIOUS_TASK_STATE_UNCONFIRMED');
  const gone = values.LoadState === 'not-found' && values.ActiveState === 'inactive' && (!values.MainPID || values.MainPID === '0') && (!values.ControlPID || values.ControlPID === '0');
  const stopped = values.LoadState === 'loaded' && ['inactive', 'failed'].includes(values.ActiveState) && values.MainPID === '0' && values.ControlPID === '0';
  ensure(gone || stopped, 'PREVIOUS_TASK_NOT_STOPPED');
  return gone ? 'collected' : 'stopped';
}
function observeUnit(unit) {
  ensure(/^cpp-gcc-(?:pull|load)-[a-f0-9]{12}\.service$/.test(unit), 'WORKER_UNIT_INVALID');
  const fields = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID'];
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', 'show', ...fields.map(key => '--property=' + key), '--', unit];
  let exit = 0, output;
  try { output = execFileSync('/usr/bin/setpriv', args, { cwd: ROOT, env: runnerEnv, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { exit = error.status; output = String(error.stdout || ''); }
  const values = output.trim() ? helpers.parseProperties(output) : {};
  const processes = { pids: [], complete: true };
  for (const pid of fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name))) {
    try {
      const group = fs.readFileSync('/proc/' + pid + '/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
      if (group.startsWith(SLICE_CGROUP + '/user@994.service/') && group.split('/').includes(unit)) processes.pids.push(Number(pid));
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) processes.complete = false; }
  }
  return { unit, exit, values, processes };
}
function checkPreviousWorker() {
  directory(OLD_RECORD, 0, 0o700);
  checkOldFailure(readJson(OLD_RECORD + '/worker-output.json'));
  const oldUnit = readJson(OLD_RECORD + '/worker-unit.json').unit;
  ensure(/^cpp-gcc-pull-[a-f0-9]{12}\.service$/.test(oldUnit || ''), 'OLD_WORKER_UNIT_INVALID');
  const result = observeUnit(oldUnit);
  save('previous-worker.json', result);
  const status = checkInactiveUnit(result.exit, result.values, result.processes);
  log(status === 'collected' ? '原下载临时任务已回收，未发现属于它的进程；不再发送停止请求。' : '原下载临时任务已停止，未发现属于它的进程；不再发送停止请求。');
}
async function finishedWorkerState(unit) {
  const deadline = Date.now() + 5000;
  const observations = [];
  for (;;) {
    const value = observeUnit(unit); observations.push(value);
    try {
      checkInactiveUnit(value.exit, value.values, value.processes);
      return { ...value, observations };
    } catch (error) {
      if (Date.now() >= deadline) { save('worker-state-not-confirmed.json', { observations }); throw error; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
export function checkArchiveStat(stat, resolved, file, archive, staged) {
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && resolved === file && stat.uid === 0 && stat.size === archive.bytes && (stat.mode & 0o022) === 0, 'ARCHIVE_FILE_UNEXPECTED');
  if (staged) ensure(stat.gid === 991 && (stat.mode & 0o777) === 0o440, 'STAGED_ARCHIVE_PERMISSIONS');
}
async function archiveHash(file, archive, staged) {
  const stat = fs.lstatSync(file);
  checkArchiveStat(stat, fs.realpathSync(file), file, archive, staged);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  ensure(hash.digest('hex') === archive.sha256, 'ARCHIVE_SHA256_MISMATCH');
}
export function checkLoadedImage(value, pin, diffIds) {
  const id = typeof value.Id === 'string' && /^[a-f0-9]{64}$/.test(value.Id) ? 'sha256:' + value.Id : value.Id;
  ensure(id === pin.configDigest, 'LOADED_CONFIG_ID_MISMATCH');
  ensure(value.Architecture === 'amd64' && value.Os === 'linux' && value.Config?.Env?.includes('GCC_VERSION=' + pin.tag), 'LOADED_PLATFORM_OR_VERSION_MISMATCH');
  ensure(JSON.stringify(value.RootFS?.Layers) === JSON.stringify(diffIds), 'LOADED_LAYER_CONTENT_MISMATCH');
  ensure(Number.isSafeInteger(value.Size) && value.Size > 0 && value.Size < 4 * 1024 ** 3, 'LOADED_SIZE_UNEXPECTED');
  // 离线导入名称不等于远程仓库引用；完整配置 ID 与各层 DiffID 核对内容身份，不依赖标签或 RepoDigests。
  const storedManifestDigest = /^sha256:[a-f0-9]{64}$/.test(value.Digest || '') ? value.Digest : null;
  return { sourceReference: pin.reference, sourceManifestDigest: pin.digest, imageId: id, storedManifestDigest, layerContentVerified: true, architecture: 'amd64', os: 'linux', gccVersionFromMetadata: pin.tag, bytes: value.Size };
}
export function loadArguments(file) {
  ensure(/^\/var\/www\/teaching-cpp-backend\/imports\/gcc-base-[A-Za-z0-9]{6}\/gcc-14\.4\.0-linux-amd64\.oci\.tar$/.test(file), 'IMPORT_PATH_INVALID');
  return ['--remote=false', 'load', '--quiet', '--input', file];
}

async function importWorker(unit, file, archive, pin, diffIds) {
  const fs = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { execFileSync, spawn } = await import('node:child_process');
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  const available = () => { const stat = fs.statfsSync('/var/www/teaching-cpp-runner'); return stat.bavail * stat.bsize; };
  const call = args => execFileSync('/usr/bin/podman', ['--remote=false', ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    ensure(process.getuid() === 994 && process.getgid() === 991, 'WORKER_IDENTITY_UNEXPECTED');
    const group = fs.readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
    ensure(group.startsWith('/user.slice/user-994.slice/user@994.service/') && group.endsWith('/' + unit) && !group.includes('/../'), 'WORKER_CGROUP_UNEXPECTED');
    ensure(/^NoNewPrivs:\s+0\s*$/m.test(fs.readFileSync('/proc/self/status', 'utf8')), 'MAPPING_HELPERS_BLOCKED');
    const before = JSON.parse(call(['info', '--format=json']));
    checkHostInfo(before, 0); checkSpace(available(), true);
    emit({ event: 'stage', value: 'rootless-checked' });
    const stat = fs.lstatSync(file); checkArchiveStat(stat, fs.realpathSync(file), file, archive, true);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    ensure(hash.digest('hex') === archive.sha256, 'WORKER_ARCHIVE_SHA256_MISMATCH');
    emit({ event: 'stage', value: 'archive-checked' });
    const started = Date.now();
    const loaded = await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/podman', loadArguments(file), { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', reason = null, killTimer;
      const stop = code => { if (reason) return; reason = code; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 10000); };
      child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString('utf8')).slice(-2 * 1024 * 1024); });
      child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-2 * 1024 * 1024); });
      const timer = setTimeout(() => stop('LOAD_TIME_LIMIT'), 15 * 60 * 1000);
      const diskTimer = setInterval(() => { try { checkSpace(available(), false); } catch { stop('DISK_HEADROOM_INSUFFICIENT'); } }, 5000);
      const progress = setInterval(() => emit({ event: 'progress', seconds: Math.floor((Date.now() - started) / 1000), freeMiB: Math.floor(available() / 1024 ** 2) }), 15000);
      const clear = () => { clearTimeout(timer); clearInterval(diskTimer); clearInterval(progress); clearTimeout(killTimer); };
      child.once('error', () => { clear(); reject(Object.assign(new Error(), { code: 'LOAD_START_FAILED' })); });
      child.once('close', (status, signal) => { clear(); resolve({ status, signal, reason, stdout, stderr }); });
    });
    if (loaded.status !== 0 || loaded.signal || loaded.reason) throw Object.assign(new Error(), { code: loaded.reason || 'PODMAN_LOAD_FAILED', details: loaded });
    emit({ event: 'stage', value: 'image-loaded' });
    const rows = JSON.parse(call(['image', 'inspect', pin.configDigest]));
    ensure(Array.isArray(rows) && rows.length === 1, 'LOADED_IMAGE_INSPECT_UNEXPECTED');
    const summary = checkLoadedImage(rows[0], pin, diffIds);
    const after = JSON.parse(call(['info', '--format=json']));
    checkHostInfo(after, 1); checkSpace(available(), false);
    emit({ event: 'complete', summary, inspect: rows[0], info: after, loadOutput: loaded, elapsedSeconds: Math.floor((Date.now() - started) / 1000) });
  } catch (error) {
    emit({ event: 'error', code: /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'IMPORT_WORKER_FAILED', details: error.details, commandStatus: error.status, stderr: String(error.stderr || '') });
    process.exitCode = 1;
  }
}
export function workerSource(unit, file, pin, hostChecker, spaceChecker) {
  ensure(/^cpp-gcc-load-[a-f0-9]{12}\.service$/.test(unit), 'WORKER_UNIT_INVALID');
  loadArguments(file);
  ensure(hostChecker?.name === 'checkHostInfo' && spaceChecker?.name === 'checkSpace', 'WORKER_HELPERS_INVALID');
  return [ensure, hostChecker, spaceChecker, checkArchiveStat, checkLoadedImage, loadArguments].map(fn => fn.toString()).join('\n') + '\n(' + importWorker.toString() + ')(' + [unit, file, ARCHIVE, pin, DIFF_IDS].map(value => JSON.stringify(value)).join(',') + ');';
}
export function checkWorkerResult(result, pin, diffIds) {
  ensure(result && typeof result.stdout === 'string', 'WORKER_RESULT_FORMAT');
  const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const failure = events.find(event => event.event === 'error');
  if (failure) throw Object.assign(new Error(), { code: safeCode(failure.code) });
  ensure(result.status === 0 && !result.signal, 'IMPORT_WORKER_NOT_COMPLETED');
  const completed = events.filter(event => event.event === 'complete');
  ensure(completed.length === 1, 'IMPORT_RESULT_MISSING');
  checkLoadedImage(completed[0].inspect, pin, diffIds);
  return completed[0];
}
async function runWorker(file) {
  workerUnit = 'cpp-gcc-load-' + randomBytes(6).toString('hex') + '.service';
  save('worker-unit.json', { unit: workerUnit, archive: file });
  const source = workerSource(workerUnit, file, imageHelpers.PIN, imageHelpers.checkHostInfo, imageHelpers.checkSpace);
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + workerUnit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=1200', '--property=TimeoutStopSec=30', '--property=WorkingDirectory=' + HOME_DIR, '/usr/bin/env', '-i', ...Object.entries(runnerEnv).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', source];
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/setpriv', args, { cwd: ROOT, env: runnerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8');
    let stdout = '', stderr = '', pending = '';
    child.stdout.on('data', bytes => {
      const text = decoder.write(bytes); stdout = (stdout + text).slice(-8 * 1024 * 1024); pending += text;
      for (;;) {
        const at = pending.indexOf('\n'); if (at < 0) break;
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try {
          const event = JSON.parse(line);
          const stages = { 'rootless-checked': '用户服务的 rootless、UID/GID 映射和空镜像库检查通过。', 'archive-checked': 'cpp-runner 再次核验离线包通过，开始本地导入；不访问镜像仓库。', 'image-loaded': 'Podman 导入命令已完成，正在核对镜像内容身份与镜像库。' };
          if (event.event === 'stage' && Object.hasOwn(stages, event.value)) log(stages[event.value]);
          if (event.event === 'progress' && Number.isSafeInteger(event.seconds) && Number.isSafeInteger(event.freeMiB)) log('导入进行中：已用 ' + event.seconds + ' 秒，磁盘可用 ' + event.freeMiB + ' MiB。');
        } catch { /* 完整工作进程输出只保存于 root 私有记录，不直接回显。 */ }
      }
      if (pending.length > 8 * 1024 * 1024) pending = '';
    });
    child.stdout.on('end', () => { stdout += decoder.end(); });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-2 * 1024 * 1024); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'WORKER_START_FAILED' })));
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  save('worker-output.json', result);
  // --wait 已经返回；先记录真实状态，不因失败退出就对可能已经回收的单元重复发送 stop。
  const stopped = await finishedWorkerState(workerUnit); save('worker-final-state.json', stopped);
  const completed = checkWorkerResult(result, imageHelpers.PIN, DIFF_IDS);
  imageHelpers.checkHostInfo(completed.info, 1);
  return completed;
}

async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  directory(ROOT, 0, 0o755); directory(ROOT + '/backups', 0, 0o700); directory(ROOT + '/logs', 995, 0o750);
  const logPath = ROOT + '/logs/gcc-base-import-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600); log('操作日志：' + logPath);
  ensure(!exists(LOCK), 'IMPORT_LOCK_PRESENT_DO_NOT_REPEAT');
  record = fs.mkdtempSync(ROOT + '/backups/gcc-base-import-');
  log('私有操作记录：' + record);
  step('只读预检：离线包、旧任务状态、已完成的初始化、资源限额和两个网站');
  helpers = await loadHelpers(ROOT + '/deploy/resume-rootless-podman-20260831-02.sh', '5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de', 'CPP_ROOTLESS_NODE');
  repairHelpers = await loadHelpers(ROOT + '/deploy/repair-rootless-delegation-20260831.sh', '0556df40491052f82ef2058b7fce6dbb2e41f27acb24da1c1e67b8d726fa1845', 'CPP_DELEGATION_NODE');
  accountHelpers = await loadHelpers(ROOT + '/deploy/prepare-runner-account-20260831-02.sh', '78dd26246bff6ad0c011703ce6672e4ec042c271e1260eaf66e7bb8425c48489', 'CPP_ACCOUNT_NODE');
  imageHelpers = await loadHelpers(ROOT + '/deploy/prepare-gcc-base-image-20260831.sh', 'fe0332f60b308410b871774f7de67c195cbed53d8ce47f89fb970d833492015b', 'CPP_GCC_IMAGE_NODE');
  directory(REPAIR_RECORD, 0, 0o700); directory(RESUME_RECORD, 0, 0o700);
  const repair = readJson(REPAIR_RECORD + '/result.json'), initialized = readJson(RESUME_RECORD + '/result.json');
  ensure(repair.stage === 'delegation-repaired-and-rootless-initialized' && repair.resumeRecord === RESUME_RECORD && repair.runEnabled === false, 'REPAIR_NOT_CONFIRMED');
  ensure(initialized.stage === 'rootless-initialized-no-images' && initialized.uid === 994 && initialized.gid === 991 && initialized.runEnabled === false, 'INITIALIZATION_NOT_CONFIRMED');
  directory(HOME_DIR, 994, 0o700); directory(RUNTIME, 994, 0o700); directory(HOME_DIR + '/tmp', 994, 0o700);
  const account = run('getent', ['passwd', 'cpp-runner']).trim().split(':');
  ensure(account.length === 7 && account[0] === 'cpp-runner' && account[2] === '994' && account[3] === '991' && account[5] === HOME_DIR && account[6] === '/sbin/nologin' && run('id', ['-Gn', 'cpp-runner']).trim() === 'cpp-runner', 'RUNNER_IDENTITY_CHANGED');
  ensure(exists(RUNTIME + '/bus') && exists('/var/lib/systemd/linger/cpp-runner'), 'USER_MANAGER_NOT_READY');
  ensure(!exists(ROOT + '/.env.runner') && run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_UNEXPECTEDLY_STARTED');
  checkPreviousWorker();
  const beforeManager = manager(); repairHelpers.checkManager(beforeManager, true);
  const beforeLimits = limits();
  const disk = fs.statfsSync(HOME_DIR); imageHelpers.checkSpace(disk.bavail * disk.bsize - ARCHIVE.bytes, true);
  const upload = ROOT + '/' + ARCHIVE.name;
  await archiveHash(upload, ARCHIVE, false);
  log('上传包大小和内置 SHA256 核验通过，与 Windows 已完成的离线包一致。');
  const protectedFiles = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf'];
  const hashes = Object.fromEntries(protectedFiles.map(file => [file, hash(file)]));
  const nss = accountHelpers.nssSnapshot(), pm2 = pm2Snapshot(); websites();
  save('before.json', { manager: beforeManager, limits: beforeLimits, hashes, nss, pm2, archive: ARCHIVE, pin: imageHelpers.PIN, diffIds: DIFF_IDS });
  lockFd = fs.openSync(LOCK, 'wx', 0o600);
  fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, record }) + '\n');
  step('准备 root 所有、cpp-runner 只读的导入副本，保留上传原件');
  const imports = ROOT + '/imports';
  if (!exists(imports)) { fs.mkdirSync(imports, { mode: 0o750 }); fs.chownSync(imports, 0, 991); fs.chmodSync(imports, 0o750); }
  directory(imports, 0, 0o750, 991);
  const staging = fs.mkdtempSync(imports + '/gcc-base-'); fs.chownSync(staging, 0, 991); fs.chmodSync(staging, 0o750);
  const file = staging + '/' + ARCHIVE.name;
  fs.copyFileSync(upload, file, fs.constants.COPYFILE_EXCL); fs.chownSync(file, 0, 991); fs.chmodSync(file, 0o440);
  await archiveHash(file, ARCHIVE, true);
  save('staged-archive.json', { file, archive: ARCHIVE });
  step('仅在 cpp-runner 的限额内导入离线基础镜像，不下载、不构建或运行容器');
  const completed = await runWorker(file);
  save('image-verified.json', completed);
  step('导入后核对原配置、账号限额、用户管理器、网站与 PM2 进程');
  for (const [file, value] of Object.entries(hashes)) ensure(hash(file) === value, 'EXISTING_CONFIGURATION_CHANGED');
  accountHelpers.assertNssUnchanged(nss);
  const afterManager = manager(); repairHelpers.checkManager(afterManager, true);
  ensure(afterManager.MainPID === beforeManager.MainPID, 'USER_MANAGER_RESTARTED'); limits();
  ensure(JSON.stringify(pm2Snapshot()) === JSON.stringify(pm2), 'PM2_PROCESSES_CHANGED');
  ensure(!exists(ROOT + '/.env.runner') && run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_UNEXPECTEDLY_STARTED'); websites();
  const summary = checkLoadedImage(completed.inspect, imageHelpers.PIN, DIFF_IDS);
  save('result.json', { stage: 'official-gcc-base-image-ready', method: 'offline-import', at: new Date().toISOString(), archive: ARCHIVE, stagedArchive: file, image: summary, pin: imageHelpers.PIN, containers: 0, runEnabled: false, pm2 });
  log('官方 GCC 14.4.0 基础镜像离线导入及内容核验完成：镜像 1、容器 0。');
  log('基础镜像 ID：' + summary.imageId);
  log('两个网站及用户管理器未重启；1 GiB / 1 核 / 256 任务 / swap 0 总限额保持。');
  log('未构建教学镜像、未运行容器或学生代码、未启动执行服务；编译运行仍关闭。');
  log('请发回输出，下一步再验证真实容器和编译。私有记录：' + record + '；日志：' + logPath);
}
if (process.argv[2] === '--import-gcc-base-image') {
  try { await main(); }
  catch (error) {
    log('离线导入未完成；阶段：' + phase + '；错误码：' + safeCode(error.code));
    if (record) log('私有操作记录：' + record);
    log('保留上传文件、导入副本和已有镜像，不自动删除或重试；请发回输出，不要重跑。');
    log('本脚本没有请求重启网站或用户管理器，也没有开启 C++ 编译运行。');
    process.exitCode = 1;
  } finally {
    // 保留锁记录以阻止重复导入；若上次终端意外关闭，后续先核查记录而不盲目重启任务。
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (logFd !== undefined) fs.closeSync(logFd);
  }
}
CPP_GCC_IMPORT_NODE
