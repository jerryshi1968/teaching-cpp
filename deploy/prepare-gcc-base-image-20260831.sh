#!/usr/bin/env bash
# 仅以 cpp-runner 下载固定摘要的官方 GCC 基础镜像；不构建镜像、不运行容器或学生代码。
# 保持已有账号总限额，不修改网站配置，不重启网站或用户管理器，不启用编译运行。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --prepare-gcc-base-image <<'CPP_GCC_IMAGE_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const NODE = ROOT + '/tools/node/bin/node';
const RUNTIME = '/run/user/994';
const MANAGER = 'user@994.service';
const SLICE_CGROUP = '/user.slice/user-994.slice';
const REPAIR_RECORD = ROOT + '/backups/rootless-delegation-d6YPe9';
const RESUME_RECORD = ROOT + '/backups/rootless-resume-0gFyZA';
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: RUNTIME, DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + RUNTIME + '/bus', TMPDIR: HOME_DIR + '/tmp' };
export const PIN = Object.freeze({
  tag: '14.4.0',
  indexDigest: 'sha256:88134abee5c979390be4fedf9af2635e324004f0f3c1266a8c924c7a08e69500',
  digest: 'sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c',
  configDigest: 'sha256:6b4bd930afb1272016c64651ed6192f519f666edf9255213ad09c5cbdd657723',
  reference: 'docker.io/library/gcc@sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c',
  compressedBytes: 540483496,
  layers: 8
});
let record;
let logFd;
let phase = '初始检查';
let workerUnit;
let workerStarted = false;
let helpers;
let repairHelpers;
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
function read(file, privateFile = false) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fs.realpathSync(file) === file && stat.size < 4 * 1024 * 1024, 'FILE_UNEXPECTED');
  if (privateFile) ensure(stat.uid === 0 && (stat.mode & 0o077) === 0, 'PRIVATE_RECORD_REQUIRED');
  return fs.readFileSync(file);
}
function hash(file) { return createHash('sha256').update(read(file)).digest('hex'); }
function readJson(file) { return JSON.parse(read(file, true).toString('utf8')); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(message) { phase = message; log(message); fs.writeFileSync(record + '/phase.txt', message + '\n', { mode: 0o600 }); }
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch (error) {
    // 命令原始错误仅保存在 root 私有记录，不公开任意 stderr 或环境变量。
    if (record) save('command-error-' + randomBytes(4).toString('hex') + '.json', { command, status: error.status, signal: error.signal, stderr: String(error.stderr || '') });
    throw Object.assign(new Error(), { code: 'COMMAND_' + path.basename(command).replace(/[^a-z0-9]/gi, '_').toUpperCase() });
  }
}
async function loadHelpers(file, expected, marker) {
  ensure(hash(file) === expected, 'DELIVERED_SCRIPT_CHANGED');
  const text = read(file).toString('utf8');
  const start = text.indexOf("<<'" + marker + "'\n");
  const end = text.lastIndexOf('\n' + marker + '\n');
  ensure(start >= 0 && end > start && end + marker.length + 2 === text.length, 'EMBEDDED_SCRIPT_FORMAT');
  // 参数与旧脚本入口不同，仅使用纯检查函数，不执行旧准备、修复或初始化流程。
  return import('data:text/javascript;base64,' + Buffer.from(text.slice(start + marker.length + 5, end)).toString('base64'));
}
function properties(unit, fields) { return helpers.parseProperties(run('/usr/bin/systemctl', ['show', ...helpers.propertyOptions(fields), '--', unit]), fields); }
function currentManager() { return properties(MANAGER, ['Id', 'User', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlGroup', 'Delegate', 'DelegateControllers', 'DisableControllers', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload']); }
function limits() {
  const config = properties('user-994.slice', ['LoadState', 'ActiveState', 'MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'DropInPaths', 'ControlGroup']);
  helpers.checkLimits(config, 'active');
  ensure(config.ControlGroup === SLICE_CGROUP, 'SLICE_CHANGED');
  const kernel = Object.fromEntries([['memory', 'memory.max'], ['swap', 'memory.swap.max'], ['cpu', 'cpu.max'], ['pids', 'pids.max']].map(([key, file]) => [key, fs.readFileSync('/sys/fs/cgroup' + SLICE_CGROUP + '/' + file, 'utf8').trim()]));
  helpers.checkCgroupLimits(kernel);
  return { config, kernel };
}
function websites() {
  const get = endpoint => JSON.parse(run('curl', ['--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', 'https://tigao123.com/api/' + endpoint]));
  accountHelpers.checkSiteValues(get('health'), get('cpp/config'));
  log('两个网站 HTTPS 正常；C++ 写入开启、编译运行关闭。');
}
function pm2Snapshot() {
  const daemon = read('/root/.pm2/pm2.pid').toString('utf8').trim();
  ensure(/^[1-9][0-9]*$/.test(daemon) && exists('/proc/' + daemon), 'PM2_DAEMON_NOT_RUNNING');
  const rows = JSON.parse(run('pm2', ['jlist']));
  for (const name of ['p5js-backend', 'teaching-cpp-backend']) ensure(rows.filter(row => row.name === name && row.pm2_env?.status === 'online').length === 1, 'WEBSITE_PM2_NOT_ONLINE');
  return rows.map(row => ({ id: row.pm_id, name: row.name, pid: row.pid, restarts: row.pm2_env?.restart_time, status: row.pm2_env?.status })).sort((a, b) => a.id - b.id);
}
export function normalizeImageId(value) {
  ensure(typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value), 'IMAGE_ID_INVALID');
  return value.startsWith('sha256:') ? value : 'sha256:' + value;
}
export function checkHostInfo(info, images) {
  ensure(info.version?.Version === '5.8.2' && info.host?.arch === 'amd64', 'PODMAN_VERSION_CHANGED');
  ensure(info.host.security?.rootless === true && info.host.security?.seccompEnabled === true && info.host.serviceIsRemote === false && info.host.cgroupVersion === 'v2' && info.host.cgroupManager === 'systemd' && info.host.ociRuntime?.name === 'crun', 'ROOTLESS_ISOLATION_CHANGED');
  ensure(['cpu', 'memory', 'pids'].every(name => info.host.cgroupControllers?.includes(name)), 'DELEGATED_CONTROLLERS_MISSING');
  for (const [key, id] of [['uidmap', 994], ['gidmap', 991]]) {
    const rows = info.host.idMappings?.[key];
    ensure(Array.isArray(rows) && rows.length === 2 && rows[0].container_id === 0 && rows[0].host_id === id && rows[0].size === 1 && rows[1].container_id === 1 && rows[1].host_id === 200000 && rows[1].size === 65536, 'USER_MAPPING_CHANGED');
  }
  ensure(info.store?.graphDriverName === 'overlay' && info.store.graphRoot === '/var/www/teaching-cpp-runner/.local/share/containers/storage' && info.store.runRoot === '/run/user/994/containers' && info.store.configFile === '/var/www/teaching-cpp-runner/.config/containers/storage.conf' && info.store.imageCopyTmpDir === '/var/www/teaching-cpp-runner/tmp', 'PODMAN_STORAGE_CHANGED');
  ensure(info.store.imageStore?.number === images && info.store.containerStore?.number === 0, 'PODMAN_STORE_UNEXPECTED');
}
export function checkImage(value, pin) {
  ensure(normalizeImageId(value.Id) === pin.configDigest && value.Digest === pin.digest && value.RepoDigests?.includes(pin.reference), 'IMAGE_DIGEST_MISMATCH');
  ensure(value.Architecture === 'amd64' && value.Os === 'linux', 'IMAGE_PLATFORM_MISMATCH');
  ensure(value.Config?.Env?.includes('GCC_VERSION=' + pin.tag) && Array.isArray(value.RootFS?.Layers) && value.RootFS.Layers.length === pin.layers, 'IMAGE_CONFIG_MISMATCH');
  ensure(Number.isSafeInteger(value.Size) && value.Size > 0 && value.Size < 4 * 1024 ** 3, 'IMAGE_SIZE_UNEXPECTED');
  return { reference: pin.reference, imageId: normalizeImageId(value.Id), digest: value.Digest, architecture: value.Architecture, os: value.Os, gccVersionFromMetadata: pin.tag, bytes: value.Size };
}
export function checkManifest(value, pin) {
  ensure(value.schemaVersion === 2 && value.config?.digest === pin.configDigest && Array.isArray(value.layers) && value.layers.length === pin.layers, 'REGISTRY_MANIFEST_UNEXPECTED');
  ensure(value.layers.every(layer => /^sha256:[a-f0-9]{64}$/.test(layer.digest) && Number.isSafeInteger(layer.size) && layer.size > 0) && value.layers.reduce((sum, layer) => sum + layer.size, 0) === pin.compressedBytes, 'REGISTRY_LAYER_LIST_UNEXPECTED');
}
export function checkSpace(bytes, starting) {
  ensure(Number.isFinite(bytes) && bytes >= (starting ? 8 : 4) * 1024 ** 3, 'DISK_HEADROOM_INSUFFICIENT');
}

async function imageWorker(unit, pin) {
  const fs = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { execFileSync, spawn } = await import('node:child_process');
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  const home = '/var/www/teaching-cpp-runner';
  const available = () => { const stat = fs.statfsSync(home); return stat.bavail * stat.bsize; };
  const call = args => execFileSync('/usr/bin/podman', ['--remote=false', ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    ensure(process.getuid() === 994 && process.getgid() === 991, 'WORKER_IDENTITY_UNEXPECTED');
    const group = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
    ensure(group.startsWith('/user.slice/user-994.slice/user@994.service/') && group.endsWith('/' + unit) && !group.includes('/../'), 'WORKER_CGROUP_UNEXPECTED');
    ensure(/^NoNewPrivs:\s+0\s*$/m.test(fs.readFileSync('/proc/self/status', 'utf8')), 'MAPPING_HELPERS_BLOCKED');
    const before = JSON.parse(call(['info', '--format=json']));
    checkHostInfo(before, 0);
    checkSpace(available(), true);
    emit({ event: 'stage', value: 'rootless-checked' });

    // 仅请求官方仓库的公开元数据；匿名拉取令牌只留在内存，不打印或保存。
    const auth = await fetch('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/gcc:pull', { signal: AbortSignal.timeout(15000), redirect: 'error' });
    ensure(auth.ok, auth.status === 429 ? 'REGISTRY_RATE_LIMIT' : 'REGISTRY_AUTH_HTTP_' + auth.status);
    const token = (await auth.json()).token;
    ensure(typeof token === 'string' && token.length > 0, 'REGISTRY_TOKEN_MISSING');
    const response = await fetch('https://registry-1.docker.io/v2/library/gcc/manifests/' + pin.digest, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
    ensure(response.ok, response.status === 429 ? 'REGISTRY_RATE_LIMIT' : 'REGISTRY_MANIFEST_HTTP_' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    ensure(bytes.length < 1024 * 1024 && 'sha256:' + createHash('sha256').update(bytes).digest('hex') === pin.digest, 'REGISTRY_DIGEST_MISMATCH');
    const manifest = JSON.parse(bytes);
    checkManifest(manifest, pin);
    emit({ event: 'stage', value: 'official-manifest-verified' });

    const started = Date.now();
    const pulled = await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/podman', ['--remote=false', 'pull', '--tls-verify=true', '--policy=missing', '--platform=linux/amd64', '--retry=1', pin.reference], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', stopped, killTimer;
      child.stdout.on('data', chunk => { if (stdout.length < 1024 * 1024) stdout += chunk.toString('utf8').slice(0, 1024 * 1024 - stdout.length); });
      child.stderr.on('data', chunk => { if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString('utf8').slice(0, 2 * 1024 * 1024 - stderr.length); });
      const stop = code => { if (!stopped) { stopped = code; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 10000); } };
      const timeout = setTimeout(() => stop('IMAGE_PULL_TIMEOUT'), 25 * 60 * 1000);
      const disk = setInterval(() => { try { checkSpace(available(), false); } catch { stop('DISK_HEADROOM_INSUFFICIENT'); } }, 5000);
      const progress = setInterval(() => { try { emit({ event: 'progress', seconds: Math.floor((Date.now() - started) / 1000), freeMiB: Math.floor(available() / 1024 ** 2) }); } catch { stop('DISK_STATUS_UNAVAILABLE'); } }, 15000);
      const clear = () => { clearTimeout(timeout); clearTimeout(killTimer); clearInterval(disk); clearInterval(progress); };
      child.once('error', () => { clear(); reject(Object.assign(new Error(), { code: 'PODMAN_PULL_START_FAILED' })); });
      child.once('close', (status, signal) => { clear(); resolve({ status, signal, stopped, stdout, stderr }); });
    });
    if (pulled.stopped || pulled.status !== 0 || pulled.signal) throw Object.assign(new Error(), { code: pulled.stopped || 'PODMAN_PULL_FAILED', details: pulled });
    checkSpace(available(), false);
    const images = JSON.parse(call(['image', 'inspect', pin.reference]));
    ensure(Array.isArray(images) && images.length === 1, 'IMAGE_INSPECT_UNEXPECTED');
    const summary = checkImage(images[0], pin);
    const after = JSON.parse(call(['info', '--format=json']));
    checkHostInfo(after, 1);
    emit({ event: 'complete', summary, manifest, inspect: images[0], info: after, freeBytes: available(), elapsedSeconds: Math.floor((Date.now() - started) / 1000) });
  } catch (error) {
    emit({ event: 'error', code: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'IMAGE_PREPARATION_FAILED', causeCode: error.cause?.code, details: error.details, stderr: String(error.stderr || '') });
    process.exitCode = 1;
  }
}
export function workerSource(unit) {
  ensure(typeof unit === 'string' && /^cpp-gcc-pull-[a-f0-9]{12}\.service$/.test(unit), 'WORKER_UNIT_INVALID');
  return [ensure, normalizeImageId, checkHostInfo, checkImage, checkManifest, checkSpace].map(fn => fn.toString()).join('\n') + '\n(' + imageWorker.toString() + ')(' + JSON.stringify(unit) + ',' + JSON.stringify(PIN) + ');';
}
async function runWorker() {
  workerUnit = 'cpp-gcc-pull-' + randomBytes(6).toString('hex') + '.service';
  save('worker-unit.json', { unit: workerUnit });
  const source = workerSource(workerUnit);
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + workerUnit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=1800', '--property=TimeoutStopSec=30', '--property=WorkingDirectory=' + HOME_DIR, '/usr/bin/env', '-i', ...Object.entries(runnerEnv).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', source];
  workerStarted = true;
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/setpriv', args, { cwd: ROOT, env: runnerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', pending = '';
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', chunk => {
      const text = decoder.write(chunk);
      if (stdout.length < 8 * 1024 * 1024) stdout += text.slice(0, 8 * 1024 * 1024 - stdout.length);
      pending += text;
      for (;;) {
        const at = pending.indexOf('\n');
        if (at < 0) break;
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try {
          const event = JSON.parse(line);
          if (event.event === 'stage' && event.value === 'rootless-checked') log('下载服务已确认 rootless、资源委派及空镜像库。');
          if (event.event === 'stage' && event.value === 'official-manifest-verified') log('官方仓库连通，固定摘要及清单核验通过，开始下载约 515 MiB。');
          if (event.event === 'progress' && Number.isSafeInteger(event.seconds) && Number.isSafeInteger(event.freeMiB)) log('下载进行中：已用 ' + event.seconds + ' 秒，磁盘可用 ' + event.freeMiB + ' MiB。');
        } catch { /* 任意原始输出仅保存到私有记录，不直接回显。 */ }
      }
      if (pending.length > 8 * 1024 * 1024) pending = '';
    });
    child.stdout.on('end', () => { const tail = decoder.end(); if (stdout.length < 8 * 1024 * 1024) stdout += tail; });
    child.stderr.on('data', chunk => { if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString('utf8').slice(0, 2 * 1024 * 1024 - stderr.length); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'WORKER_START_FAILED' })));
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  save('worker-output.json', result);
  const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const failure = events.find(event => event.event === 'error');
  if (failure) {
    log('下载检查错误码：' + (/^[A-Z0-9_]+$/.test(failure.code || '') ? failure.code : 'IMAGE_PREPARATION_FAILED'));
    if (/^[A-Z0-9_]+$/.test(failure.causeCode || '')) log('网络或系统错误码：' + failure.causeCode);
  }
  ensure(result.status === 0 && !result.signal && !failure, 'IMAGE_WORKER_NOT_COMPLETED');
  workerStarted = false;
  const completed = events.filter(event => event.event === 'complete');
  ensure(completed.length === 1, 'IMAGE_RESULT_MISSING');
  checkImage(completed[0].inspect, PIN);
  checkHostInfo(completed[0].info, 1);
  checkManifest(completed[0].manifest, PIN);
  return completed[0];
}

async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  directory(ROOT, 0, 0o755); directory(ROOT + '/backups', 0, 0o700); directory(ROOT + '/logs', 995, 0o750);
  const logPath = ROOT + '/logs/gcc-base-image-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600);
  log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/gcc-base-image-');
  log('私有操作记录：' + record);
  step('只读预检：已完成的 rootless 初始化、资源限额、网站状态与磁盘余量');
  helpers = await loadHelpers(ROOT + '/deploy/resume-rootless-podman-20260831-02.sh', '5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de', 'CPP_ROOTLESS_NODE');
  repairHelpers = await loadHelpers(ROOT + '/deploy/repair-rootless-delegation-20260831.sh', '0556df40491052f82ef2058b7fce6dbb2e41f27acb24da1c1e67b8d726fa1845', 'CPP_DELEGATION_NODE');
  accountHelpers = await loadHelpers(ROOT + '/deploy/prepare-runner-account-20260831-02.sh', '78dd26246bff6ad0c011703ce6672e4ec042c271e1260eaf66e7bb8425c48489', 'CPP_ACCOUNT_NODE');
  directory(REPAIR_RECORD, 0, 0o700); directory(RESUME_RECORD, 0, 0o700);
  const repair = readJson(REPAIR_RECORD + '/result.json');
  ensure(repair.stage === 'delegation-repaired-and-rootless-initialized' && repair.resumeRecord === RESUME_RECORD && repair.runEnabled === false, 'REPAIR_NOT_CONFIRMED');
  const initialized = readJson(RESUME_RECORD + '/result.json');
  ensure(initialized.stage === 'rootless-initialized-no-images' && initialized.uid === 994 && initialized.gid === 991 && initialized.runEnabled === false, 'INITIALIZATION_NOT_CONFIRMED');
  directory(HOME_DIR, 994, 0o700); directory(RUNTIME, 994, 0o700); directory(HOME_DIR + '/tmp', 994, 0o700);
  const account = run('getent', ['passwd', 'cpp-runner']).trim().split(':');
  ensure(account.length === 7 && account[0] === 'cpp-runner' && account[2] === '994' && account[3] === '991' && account[5] === HOME_DIR && account[6] === '/sbin/nologin' && run('id', ['-Gn', 'cpp-runner']).trim() === 'cpp-runner', 'RUNNER_IDENTITY_CHANGED');
  ensure(exists(RUNTIME + '/bus') && exists('/var/lib/systemd/linger/cpp-runner'), 'USER_MANAGER_NOT_READY');
  ensure(!exists(ROOT + '/.env.runner') && run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_UNEXPECTEDLY_STARTED');
  const manager = currentManager(); repairHelpers.checkManager(manager, true);
  const beforeLimits = limits();
  const stat = fs.statfsSync(HOME_DIR); checkSpace(stat.bavail * stat.bsize, true);
  const protectedFiles = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf'];
  const hashes = Object.fromEntries(protectedFiles.map(file => [file, hash(file)]));
  const nss = accountHelpers.nssSnapshot();
  const pm2 = pm2Snapshot(); websites();
  save('before.json', { manager, limits: beforeLimits, hashes, nss, pm2, pin: PIN });
  step('在 cpp-runner 用户服务内下载官方固定版本；保留 1 GiB / 1 核 / 256 任务总限额');
  const completed = await runWorker();
  save('image-verified.json', completed);
  step('核对镜像结果、原配置、总限额、用户管理器和网站进程');
  for (const [file, value] of Object.entries(hashes)) ensure(hash(file) === value, 'EXISTING_CONFIGURATION_CHANGED');
  accountHelpers.assertNssUnchanged(nss);
  const afterManager = currentManager(); repairHelpers.checkManager(afterManager, true);
  ensure(afterManager.MainPID === manager.MainPID, 'USER_MANAGER_RESTARTED');
  limits();
  ensure(JSON.stringify(pm2Snapshot()) === JSON.stringify(pm2), 'PM2_PROCESSES_CHANGED');
  ensure(!exists(ROOT + '/.env.runner') && run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_UNEXPECTEDLY_STARTED');
  websites();
  save('result.json', { stage: 'official-gcc-base-image-ready', pin: PIN, image: completed.summary, runEnabled: false, containers: 0, pm2, at: new Date().toISOString() });
  log('官方 GCC 14.4.0 基础镜像下载及摘要核验完成，镜像 1、容器 0。');
  log('基础镜像 ID：' + completed.summary.imageId);
  log('未构建教学镜像、未运行容器或学生代码；编译运行仍关闭。');
  log('两个网站及用户管理器未重启；下一步准备教学镜像并验证真实容器。');
  log('私有记录：' + record + '；日志：' + logPath);
}
if (process.argv[2] === '--prepare-gcc-base-image') {
  try { await main(); }
  catch (error) {
    log('基础镜像准备未完成；阶段：' + phase + '；错误码：' + (/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CHECK_FAILED'));
    if (workerStarted && workerUnit) {
      // 只请求停止本次下载服务，不停止用户管理器、其他任务或已有网站。
      try { run('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', 'stop', '--no-block', workerUnit], { env: runnerEnv }); log('已请求停止本次下载服务，镜像缓存保留。'); }
      catch { log('下载服务停止请求未确认，服务另有 30 分钟运行上限；请保留现场。'); }
    }
    if (record) log('私有记录：' + record);
    log('不删除镜像缓存、不更换下载源或降低校验；请发回输出，不要重复执行。');
    log('C++ 编译运行未开启；没有请求重启两个网站。');
    process.exitCode = 1;
  } finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_GCC_IMAGE_NODE
