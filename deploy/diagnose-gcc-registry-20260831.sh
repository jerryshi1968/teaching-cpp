#!/usr/bin/env bash
# 只诊断上次 GCC 元数据请求失败及临时任务状态；除新建日志外，不修改本机文件或配置。
# 不执行 Podman，不下载镜像层，不停止或重启服务，不读取网站密码或输出匿名令牌。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --diagnose-gcc-registry <<'CPP_REGISTRY_DIAG_NODE'
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { isIP } from 'node:net';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const RECORD = ROOT + '/backups/gcc-base-image-lthZ31';
const NODE = ROOT + '/tools/node/bin/node';
const SCRIPT_HASH = 'fe0332f60b308410b871774f7de67c195cbed53d8ce47f89fb970d833492015b';
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SYSTEMD_PAGER: 'cat', SYSTEMD_COLORS: '0' };
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus', TMPDIR: HOME_DIR + '/tmp', SYSTEMD_PAGER: 'cat', SYSTEMD_COLORS: '0' };
const ENDPOINTS = [
  { name: 'auth', host: 'auth.docker.io', url: 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/gcc:pull' },
  { name: 'registry', host: 'registry-1.docker.io', url: 'https://registry-1.docker.io/v2/' }
];
const UNIT_FIELDS = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlPID', 'Result', 'ExecMainCode', 'ExecMainStatus', 'ControlGroup'];
let logFd;
let logPath;

function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(value) { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : 'UNSPECIFIED'; }
function out(value) {
  const line = (typeof value === 'string' ? value : JSON.stringify(value)) + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function section(title, action) {
  out('\n【' + title + '】');
  try { return action(); } catch (error) { out({ checkFailed: safeCode(error.code) }); return null; }
}
function read(file, privateFile = false) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fs.realpathSync(file) === file && stat.size <= 12 * 1024 * 1024, 'RECORD_FILE_UNEXPECTED');
  if (privateFile) ensure(stat.uid === 0 && (stat.mode & 0o077) === 0, 'PRIVATE_RECORD_REQUIRED');
  return fs.readFileSync(file, 'utf8');
}
function checkDir(file, uid, mode) {
  const stat = fs.lstatSync(file);
  ensure(stat.isDirectory() && fs.realpathSync(file) === file && stat.uid === uid && (stat.mode & 0o777) === mode, 'DIRECTORY_UNEXPECTED');
}
function command(program, args, env = cliEnv) {
  try { return { exit: 0, stdout: execFileSync(program, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (error) { return { exit: Number.isInteger(error.status) ? error.status : null, error: safeCode(error.code), stdout: String(error.stdout || '') }; }
}
function commandAsync(program, args, env, timeout) {
  return new Promise(resolve => execFile(program, args, { cwd: ROOT, env, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 128 * 1024 }, (error, stdout) => resolve({ exit: error ? (Number.isInteger(error.code) ? error.code : null) : 0, error: error ? safeCode(error.code) : undefined, stdout: String(stdout || '') })));
}
function asRunner(program, args) { return ['--reuid', '994', '--regid', '991', '--clear-groups', program, ...args]; }

export function errorSummary(error) {
  // 不输出 message、stack、URL、请求头、响应体或任意 stderr；只保留原生错误码和 IP 地址。
  const rows = [], seen = new Set();
  function walk(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 5 || rows.length >= 24) return;
    seen.add(value);
    const row = { code: safeCode(value.code) };
    if (['Error', 'TypeError', 'AggregateError', 'AbortError', 'TimeoutError'].includes(value.name)) row.name = value.name;
    if (typeof value.address === 'string' && isIP(value.address)) { row.address = value.address; row.family = isIP(value.address); }
    if (value.port === 443) row.port = 443;
    if (['connect', 'getaddrinfo', 'queryA', 'queryAAAA'].includes(value.syscall)) row.syscall = value.syscall;
    rows.push(row);
    walk(value.cause, depth + 1);
    if (Array.isArray(value.errors)) for (const child of value.errors.slice(0, 16)) walk(child, depth + 1);
  }
  walk(error, 0);
  return rows;
}
export function workerSummary(value) {
  ensure(value && typeof value.stdout === 'string' && value.stdout.length <= 10 * 1024 * 1024, 'WORKER_RECORD_FORMAT');
  const events = [];
  let malformed = 0;
  for (const line of value.stdout.split('\n').filter(line => line.trim())) {
    try { const event = JSON.parse(line); if (event && typeof event === 'object') events.push(event); else malformed++; } catch { malformed++; }
  }
  const rootlessChecked = events.some(row => row.event === 'stage' && row.value === 'rootless-checked');
  const manifestVerified = events.some(row => row.event === 'stage' && row.value === 'official-manifest-verified');
  const completed = events.some(row => row.event === 'complete');
  const errors = events.filter(row => row.event === 'error').map(row => ({ code: safeCode(row.code), causeCode: safeCode(row.causeCode) }));
  return { exit: Number.isInteger(value.status) ? value.status : null, signal: /^SIG[A-Z]+$/.test(value.signal || '') ? value.signal : null, rootlessChecked, manifestVerified, completed, malformedLines: malformed, errors, failedBeforePull: malformed === 0 && rootlessChecked && !manifestVerified && !completed && errors.length > 0 && !events.some(row => row.event === 'progress') };
}
export function selectProperties(text, fields) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('=');
    const key = line.slice(0, at);
    if (at < 1 || !fields.includes(key)) continue;
    ensure(!Object.hasOwn(values, key), 'DUPLICATE_PROPERTY');
    const value = line.slice(at + 1);
    ensure(/^[a-zA-Z0-9_./:@ -]{0,300}$/.test(value), 'PROPERTY_FORMAT');
    values[key] = value;
  }
  return values;
}
export function classifyUnit(exit, values, processes) {
  if (processes.pids.length > 0) return 'processes-present';
  if (Number(values.MainPID) > 0 || Number(values.ControlPID) > 0 || ['active', 'activating', 'deactivating', 'reloading'].includes(values.ActiveState)) return 'unit-running';
  if (!processes.complete || ![0, 1].includes(exit)) return 'unknown';
  if (values.LoadState === 'not-found' && values.ActiveState === 'inactive' && (!values.MainPID || values.MainPID === '0') && (!values.ControlPID || values.ControlPID === '0')) return 'unit-collected';
  if (values.LoadState === 'loaded' && ['inactive', 'failed'].includes(values.ActiveState) && values.MainPID === '0' && values.ControlPID === '0') return 'unit-stopped';
  return 'unknown';
}
function processSnapshot(unit) {
  const pids = [];
  let complete = true;
  const names = fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name));
  for (const name of names) {
    try {
      const group = fs.readFileSync('/proc/' + name + '/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
      if (group.startsWith('/user.slice/user-994.slice/user@994.service/') && group.split('/').includes(unit)) pids.push(Number(name));
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) complete = false; }
  }
  return { pids: pids.sort((a, b) => a - b), complete };
}
function unitSnapshot(unit) {
  const result = command('/usr/bin/setpriv', asRunner('/usr/bin/systemctl', ['--user', 'show', ...UNIT_FIELDS.map(key => '--property=' + key), '--', unit]), runnerEnv);
  const values = selectProperties(result.stdout, UNIT_FIELDS);
  const processes = processSnapshot(unit);
  const state = classifyUnit(result.exit, values, processes);
  out({ unit, commandExit: result.exit, values, processes, state });
  return state;
}
export function parseCurl(result, endpoint) {
  const fields = result.stdout.trim().split('|');
  const valid = fields.length === 7 && /^\d{3}$/.test(fields[0]) && (fields[1] === '' || isIP(fields[1])) && /^\d+$/.test(fields[2]) && fields.slice(3).every(value => /^\d+(?:\.\d+)?$/.test(value));
  if (!valid) return { exit: result.exit, error: result.error || 'CURL_OUTPUT_UNEXPECTED' };
  const status = Number(fields[0]);
  const httpsReached = result.exit === 0 && fields[2] === '0' && status >= 100 && status <= 599;
  return { exit: result.exit, http: status, remoteIP: fields[1] || null, tlsVerifyResult: Number(fields[2]), dnsSeconds: Number(fields[3]), connectSeconds: Number(fields[4]), tlsSeconds: Number(fields[5]), totalSeconds: Number(fields[6]), httpsReached, expectedResponse: httpsReached && (endpoint === 'auth' ? status === 200 : [200, 401].includes(status)) };
}

async function nodeNetworkProbe(endpoints) {
  const dns = await import('node:dns/promises');
  const net = await import('node:net');
  const https = await import('node:https');
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  if (process.getuid() !== 994 || process.getgid() !== 991) throw Object.assign(new Error(), { code: 'PROBE_IDENTITY_UNEXPECTED' });
  emit({ kind: 'node-settings', node: process.version, uid: process.getuid(), gid: process.getgid(), autoSelectFamily: net.getDefaultAutoSelectFamily(), attemptTimeoutMs: net.getDefaultAutoSelectFamilyAttemptTimeout(), dnsOrder: dns.getDefaultResultOrder(), context: 'direct-user-process-not-systemd-service' });
  for (const endpoint of endpoints) {
    let timer;
    try {
      const addresses = await Promise.race([dns.lookup(endpoint.host, { all: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'DNS_PROBE_TIMEOUT' })), 8000); })]);
      emit({ kind: 'dns', host: endpoint.host, addresses: addresses.filter(row => net.isIP(row.address)).map(row => ({ address: row.address, family: row.family })) });
    } catch (error) { emit({ kind: 'dns', host: endpoint.host, errors: errorSummary(error) }); } finally { clearTimeout(timer); }
  }
  async function defaultFetch(endpoint) {
    const started = Date.now();
    try {
      const response = await fetch(endpoint.url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
      // 认证响应可能包含匿名令牌：本检查只读状态码并取消响应体，绝不打印或保存。
      await response.body?.cancel();
      emit({ kind: 'node-fetch-default', endpoint: endpoint.name, http: response.status, elapsedMs: Date.now() - started });
    } catch (error) { emit({ kind: 'node-fetch-default', endpoint: endpoint.name, elapsedMs: Date.now() - started, errors: errorSummary(error) }); }
  }
  function ipv4Https(endpoint) {
    return new Promise(resolve => {
      const started = Date.now();
      const request = https.get(endpoint.url, { family: 4, agent: false, signal: AbortSignal.timeout(12000), maxHeaderSize: 16384 }, response => {
        const address = response.socket.remoteAddress;
        emit({ kind: 'node-https-ipv4', endpoint: endpoint.name, http: response.statusCode, remoteIP: net.isIP(address || '') ? address : null, elapsedMs: Date.now() - started });
        response.destroy();
        resolve();
      });
      request.once('error', error => { emit({ kind: 'node-https-ipv4', endpoint: endpoint.name, elapsedMs: Date.now() - started, errors: errorSummary(error) }); resolve(); });
    });
  }
  // 此处的 IPv4 限定只作用于两次诊断请求；不更改 Node 默认值或系统网络设置。
  await Promise.allSettled(endpoints.flatMap(endpoint => [defaultFetch(endpoint), ipv4Https(endpoint)]));
}
export function probeSource() {
  return "import { isIP } from 'node:net';\n" + [safeCode, errorSummary].map(fn => fn.toString()).join('\n') + '\n(' + nodeNetworkProbe.toString() + ')(' + JSON.stringify(ENDPOINTS) + ').catch(error => { process.stdout.write(JSON.stringify({kind:"probe-error",errors:errorSummary(error)}) + "\\n"); process.exitCode=1; });';
}

async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  checkDir(ROOT, 0, 0o755); checkDir(ROOT + '/logs', 995, 0o750);
  logPath = ROOT + '/logs/gcc-registry-diagnostic-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600);
  out('诊断日志：' + logPath);
  out('只生成本日志；不执行 Podman、不下载镜像层、不读 .env、不停止或重启服务。网络检查预计 1～2 分钟。');
  let unit;
  section('1. 上次失败阶段和停止请求', () => {
    checkDir(RECORD, 0, 0o700);
    const source = read(ROOT + '/deploy/prepare-gcc-base-image-20260831.sh');
    const matchesDeliveredScript = createHash('sha256').update(source).digest('hex') === SCRIPT_HASH;
    const summary = workerSummary(JSON.parse(read(RECORD + '/worker-output.json', true)));
    out({ matchesDeliveredScript, ...summary });
    if (matchesDeliveredScript && summary.failedBeforePull) out('已确认：上次失败在元数据请求阶段，尚未调用 Podman pull。不能据此确定认证域名或仓库域名中的哪一个超时。');
    const saved = JSON.parse(read(RECORD + '/worker-unit.json', true));
    ensure(/^cpp-gcc-pull-[a-f0-9]{12}\.service$/.test(saved.unit || ''), 'WORKER_UNIT_INVALID');
    unit = saved.unit;
    const names = fs.readdirSync(RECORD).filter(name => /^command-error-[a-f0-9]{8}\.json$/.test(name));
    ensure(names.length <= 32, 'TOO_MANY_COMMAND_RECORDS');
    for (const name of names) {
      const value = JSON.parse(read(RECORD + '/' + name, true));
      if (value.command === '/usr/bin/setpriv') out({ savedCommandExit: Number.isInteger(value.status) ? value.status : null, stderrNamesThisUnit: String(value.stderr || '').includes(unit), saysUnitNotLoadedOrFound: String(value.stderr || '').includes(unit) && /(?:not loaded|not found|does not exist)/i.test(String(value.stderr || '')) });
    }
  });
  const account = command('id', ['-u', 'cpp-runner']);
  const group = command('id', ['-g', 'cpp-runner']);
  ensure(account.exit === 0 && account.stdout.trim() === '994' && group.exit === 0 && group.stdout.trim() === '991', 'RUNNER_IDENTITY_CHANGED');
  section('2. 临时任务当前状态', () => {
    ensure(unit, 'WORKER_UNIT_UNKNOWN');
    const state = unitSnapshot(unit);
    if (state === 'unit-collected') out('当前未加载该临时单元，也未找到属于它的进程；与任务结束后被自动回收的情况一致。');
    else if (state === 'unit-stopped') out('该临时单元已经停止，当前未找到属于它的进程。');
    else if (state === 'unknown') out('当前证据不足以确认临时任务状态；本脚本不会尝试停止它。');
    else out('仍发现该临时任务的活动迹象；本脚本只记录，不重复下载或停止任务。');
  });
  section('3. 用户管理器、总限额和代理变量是否存在', () => {
    const fields = ['LoadState', 'ActiveState', 'MainPID', 'DelegateControllers'];
    const manager = command('/usr/bin/systemctl', ['show', ...fields.map(key => '--property=' + key), 'user@994.service']);
    out({ managerCommandExit: manager.exit, manager: selectProperties(manager.stdout, fields) });
    const values = {};
    for (const file of ['cpu.max', 'memory.max', 'memory.swap.max', 'pids.max']) {
      const value = fs.readFileSync('/sys/fs/cgroup/user.slice/user-994.slice/' + file, 'utf8').trim();
      ensure(/^(?:[0-9]+|max)(?: [0-9]+)?$/.test(value), 'LIMIT_FORMAT'); values[file] = value;
    }
    out({ kernelLimits: values });
    out({ shellProxyVariableNames: ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'].filter(name => Boolean(process.env[name])), diagnosticUsesProxy: false, previousWorkerUsedProxy: false });
  });
  out('\n【4. Node 的域名解析和 HTTPS 对照】');
  out('以下用 cpp-runner 身份直接发出小型请求，不启动用户服务；比较默认 fetch 和仅本次请求使用 IPv4 的 HTTPS。');
  const probe = await commandAsync('/usr/bin/setpriv', asRunner(NODE, ['--input-type=module', '-e', probeSource()]), runnerEnv, 45000);
  for (const line of probe.stdout.split('\n').filter(line => line.trim())) {
    try { const value = JSON.parse(line); if (['node-settings', 'dns', 'node-fetch-default', 'node-https-ipv4', 'probe-error'].includes(value.kind)) out(value); } catch { out({ probeOutput: 'NON_JSON_OMITTED' }); }
  }
  out({ nodeProbeExit: probe.exit, nodeProbeError: probe.error });
  out('\n【5. curl 的独立对照】');
  out('每项最多 8 秒；响应体全部丢弃，不输出令牌或响应头。registry 的 HTTP 401 是未登录访问仓库时的正常响应。');
  const rows = [
    ...ENDPOINTS.flatMap(endpoint => ['default', 'ipv4', 'ipv6'].map(family => ({ endpoint, family, identity: 'cpp-runner' }))),
    ...ENDPOINTS.map(endpoint => ({ endpoint, family: 'ipv4', identity: 'root' }))
  ];
  for (let start = 0; start < rows.length; start += 4) {
    const results = await Promise.allSettled(rows.slice(start, start + 4).map(async row => {
      // -q 必须放在第一项，禁止加载用户 .curlrc；保留 HTTPS 证书校验，不跟随重定向。
      const args = ['-q', '--silent', '--show-error', '--noproxy', '*', '--proto', '=https', '--connect-timeout', '5', '--max-time', '8', '--max-filesize', '65536', '--output', '/dev/null', '--write-out', '%{http_code}|%{remote_ip}|%{ssl_verify_result}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_total}', ...(row.family === 'ipv4' ? ['--ipv4'] : row.family === 'ipv6' ? ['--ipv6'] : []), row.endpoint.url];
      const result = row.identity === 'cpp-runner' ? await commandAsync('/usr/bin/setpriv', asRunner('/usr/bin/curl', args), runnerEnv, 10000) : await commandAsync('/usr/bin/curl', args, cliEnv, 10000);
      return { identity: row.identity, endpoint: row.endpoint.name, family: row.family, ...parseCurl(result, row.endpoint.name) };
    }));
    for (const result of results) out(result.status === 'fulfilled' ? result.value : { curlCheckFailed: safeCode(result.reason?.code) });
  }
  section('6. 结束时的任务和网站状态', () => { if (unit) unitSnapshot(unit); });
  for (const site of [{ name: 'p5js', endpoint: 'health' }, { name: 'cpp', endpoint: 'cpp/config' }]) section(site.name + ' HTTPS', () => {
    const result = command('/usr/bin/curl', ['-q', '--fail', '--silent', '--show-error', '--noproxy', '*', '--proto', '=https', '--http1.1', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '3', '--max-time', '6', '--max-filesize', '65536', 'https://tigao123.com/api/' + site.endpoint]);
    ensure(result.exit === 0, 'SITE_REQUEST_FAILED');
    const value = JSON.parse(result.stdout);
    out(site.name === 'p5js' ? { site: site.name, healthy: value.status === 'OK' && value.db_check === 'Database Active' } : { site: site.name, production: value.mode === 'production', writesEnabled: value.writesEnabled === true, executionDisabled: value.runEnabled === false });
  });
  out('\n诊断结束；未运行或清理容器，未更换镜像源，未修改 DNS、IPv6、证书、网站配置、数据库或服务状态。');
  out('请发回本次输出；先不要重跑原镜像准备脚本。日志：' + logPath);
}
if (process.argv[2] === '--diagnose-gcc-registry') {
  try { await main(); } catch (error) { out({ diagnosticStopped: safeCode(error.code) }); process.exitCode = 1; }
  finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_REGISTRY_DIAG_NODE
