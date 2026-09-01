#!/usr/bin/env bash
# 接入已验证的内部执行服务，只更新 C++ 网站运行配置并重启该网站后端。
# 不改 Apache、数据库结构或旧平台代码；失败时保留保存功能并尝试恢复运行关闭。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux && test "$(id -u)" -eq 0 || { printf '请在 Linux 服务器原来的 root 会话执行。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --enable-web-running <<'CPP_WEB_RUNNING_NODE'
import fs from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

export const ROOT = '/var/www/teaching-cpp-backend', HOME_DIR = '/var/www/teaching-cpp-runner';
export const IMAGE = 'sha256:c8579da6d7ec08b0ca85310d947bcea10450288b6b1f96167029fa42e22556fe';
export const NAME = 'teaching-cpp-backend';
const NODE = ROOT + '/tools/node/bin/node', FRONT = '/var/www/html/teaching-cpp', P5 = '/var/www/teaching-p5js-backend';
const PREVIOUS = ROOT + '/backups/runner-service-start-zMMEp9', LOCK = ROOT + '/backups/web-running-enable.lock';
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
export const HASHES = Object.freeze({
  'backend/src/server.mjs': '68ae68777173e746564b37d951ddd63f9f300fedc467cefbf2947a69298c4e18',
  'backend/src/config.mjs': 'a185ec926eb7e064fc451ac6f3a280cfcadbe4fe8737d5810b0e740f62745f1a',
  'backend/src/worker.mjs': '54bfff6bfcb69049c6ee826334106eecb79dd28bbfe6515935c849c73ce31d67',
  'backend/src/repository.mjs': '74e28252e29d5a9df4b300d30f110e383af6e44873014aa7ee16b4ea031a670a',
  'backend/src/service.mjs': 'cc7b561eae114f069493905b6a402aed919e7a26df55056a5f60b0e8d7ca59d5',
  'backend/src/app.mjs': 'f4bcbfd5dc8f542a6d31aa79df939eb6efd69072119e78cb0171e852c49acdd3',
  'backend/src/auth.mjs': '450d92ac9a7be5d332bf1d3e07f0239dbb61f620bc9056d61158535392a6885a',
  'backend/src/source-store.mjs': '57771cc5df1566b106201c3e3c03156599f6e426e077a0b6608b69e3c54485af',
  'compat/p5js-20260830-01/manifest.json': '288e29bf5357012c509cf261755a7d9b989a15089575f4a3e14c636af6acc8b1',
  'deploy/backend-start-20260830-01/ecosystem.json': '2791463f8e71d515551c9ed67bf91edf097a5b23d8b4b9dcd53f169eb55a8223'
});
let start, checks, parseEnv, original, candidate, token, before, oldCpp, webEnv, record, logFd, lockFd;
let phase = '初始检查', interrupted = false, recovering = false;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = () => new Promise(resolve => setTimeout(resolve, 500));
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(value) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'WEB_RUNNING_ENABLE_FAILED'; }
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function log(value) { const line = new Date().toISOString() + ' ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n'; process.stdout.write(line); if (logFd !== undefined) fs.writeSync(logFd, line); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function checkpoint() { ensure(recovering || !interrupted, 'OPERATION_INTERRUPTED'); }
function step(value) { phase = value; log(value); checkpoint(); }
function redact(value) { let text = String(value || ''); for (const secret of [token, original && parseEnv?.(original).DB_PASSWORD].filter(Boolean)) text = text.split(secret).join('[密钥已隐藏]'); return checks?.diagnosticHelpers.redact(text, 6000) || text.slice(0, 6000); }

export function patchEnvironment(bytes, secret, parse) {
  let source = bytes.toString('utf8'); ensure(Buffer.from(source).equals(bytes), 'ENV_INVALID_UTF8');
  ensure(/^[A-Za-z0-9_-]{64}$/.test(secret || ''), 'RUNNER_TOKEN_INVALID');
  const before = parse(bytes); ensure(before.CPP_PRODUCTION_WRITES === 'enabled-after-p5js-review' && before.CPP_RUN_ENABLED === 'false', 'ENV_GATES_UNEXPECTED');
  const changes = { RUNNER_TOKEN: secret, CPP_COMPILER_IMAGE: IMAGE, CPP_RUN_ENABLED: 'true' };
  for (const [key, value] of Object.entries(changes)) {
    const declarations = source.match(new RegExp('^[ \\t]*(?:export[ \\t]+)?' + key + '[ \\t]*(?:=|:[ \\t])', 'gm')) || [];
    if (declarations.length === 0 && key === 'CPP_COMPILER_IMAGE') {
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      source += (source.endsWith('\n') ? '' : newline) + key + '=' + value + newline; continue;
    }
    ensure(declarations.length === 1, 'ENV_SETTING_DUPLICATE_OR_MISSING');
    const previous = before[key];
    ensure(key === 'CPP_RUN_ENABLED' ? previous === 'false' : previous === '' || previous === value, 'ENV_RUNNER_VALUE_UNEXPECTED');
    const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^([ \\t]*(?:export[ \\t]+)?' + key + '[ \\t]*=[ \\t]*)("' + escaped + '"|\'' + escaped + '\'|' + escaped + ')([ \\t]*(?:#[^\\r\\n]*)?)(\\r?)$', 'gm');
    let count = 0;
    source = source.replace(pattern, (_, prefix, raw, suffix, cr) => { count++; const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : ''; return prefix + quote + value + quote + suffix + cr; });
    ensure(count === 1, 'ENV_SETTING_FORMAT_UNSUPPORTED');
  }
  const sorted = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  ensure(sorted(parse(source)) === sorted({ ...before, ...changes }), 'ENV_UNRELATED_VALUES_CHANGED');
  return Buffer.from(source);
}
export function checkPrevious(value) {
  ensure(value?.stage === 'internal-runner-service-ready' && value.unit === 'teaching-cpp-runner.service' && value.image === IMAGE && value.uid === 994 && value.port === 5280 && value.bind === '127.0.0.1' && value.enabled === true && value.runEnabled === false && value.containers === 0 && value.websitesUnchanged === true, 'RUNNER_START_RECORD_INVALID');
  ensure(value.testJobIds?.length === 3 && new Set(value.testJobIds).size === 3, 'RUNNER_HTTP_VERIFICATION_MISSING');
}
export function checkCpp(items, envKeys) {
  const rows = items.filter(row => row.name === NAME || row.pm2_env?.pm_exec_path === ROOT + '/backend/src/server.mjs');
  ensure(rows.length === 1, 'CPP_PROCESS_COUNT');
  const value = rows[0], env = value.pm2_env;
  ensure(value.name === NAME && Number.isSafeInteger(value.pm_id) && value.pm_id >= 0 && env.pm_cwd === ROOT && env.pm_exec_path === ROOT + '/backend/src/server.mjs', 'CPP_PROCESS_PATH');
  ensure(env.exec_mode === 'fork_mode' && env.watch === false && Number(env.uid) === 995 && Number(env.gid) === 992 && env.NODE_ENV === 'production' && env.APP_MODE === 'production', 'CPP_PROCESS_SETTINGS');
  for (const key of new Set([...envKeys, 'CPP_RUN_ENABLED', 'CPP_COMPILER_IMAGE', 'RUNNER_TOKEN', 'RUNNER_URL'])) {
    if (!['NODE_ENV', 'APP_MODE'].includes(key)) ensure(env[key] === undefined && env.env?.[key] === undefined, 'PM2_OVERRIDES_ENV_FILE');
  }
  return value;
}
export const processSummary = value => ({ id: value.pm_id, name: value.name, pid: value.pid, restarts: value.pm2_env.restart_time, status: value.pm2_env.status });
export const otherProcesses = items => items.filter(value => value.name !== NAME).map(processSummary).sort((a, b) => a.id - b.id);
export function checkGates(value, enabled) {
  ensure(value?.mode === 'production' && value.writesEnabled === true && value.runEnabled === enabled, 'WEB_GATES_UNEXPECTED');
  ensure(value.limits?.pending === 20 && value.limits.perUser === 1 && value.limits.concurrency === 1 && value.limits.retentionHours === 24 && value.limits.userCacheMB === 100, 'WEB_LIMITS_UNEXPECTED');
}
export function checkRunnerHealth(value) { ensure(value?.ready === true && typeof value.busy === 'boolean' && value.image === IMAGE, 'RUNNER_HEALTH_INVALID'); }
export async function activation(actions) {
  await actions.preflight(); await actions.backup();
  try { await actions.replace(); await actions.restart(); await actions.verify(); await actions.finish(); }
  catch (error) { try { await actions.recover(); } catch (recovery) { error.recoveryCode = recovery.code || 'RECOVERY_REQUIRED'; } throw error; }
}
export async function queryReadiness(connection, Repository, mode) {
  const query = (sql, values = []) => connection.execute({ sql, timeout: 10000 }, values);
  await connection.query({ sql: 'START TRANSACTION READ ONLY', timeout: 10000 });
  try {
    await new Repository({ execute: query }).checkSchema();
    const [[migration]] = await query("SELECT state, checksum FROM cpp_schema_migrations WHERE id = '001_cpp'");
    ensure(migration?.state === 'complete' && migration.checksum === 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041', 'DB_MIGRATION_MISMATCH');
    const [[pending]] = await query("SELECT COUNT(*) AS count FROM cpp_runs WHERE state IN ('queued','compiling','running','stopping')");
    const [[lock]] = await query("SELECT IS_USED_LOCK(CONCAT(DATABASE(), ':cpp-worker')) AS owner");
    const activeRuns = Number(pending.count), owner = lock.owner === null ? null : Number(lock.owner);
    ensure(Number.isSafeInteger(activeRuns) && activeRuns >= 0, 'DB_QUEUE_RESULT_INVALID');
    if (mode === 'candidate') ensure(activeRuns === 0 && owner === null, 'DB_QUEUE_OR_WORKER_ALREADY_ACTIVE');
    else if (mode === 'enabled') ensure(Number.isSafeInteger(owner) && owner > 0, 'DB_WORKER_LOCK_NOT_HELD');
    else ensure(mode === 'restored' && owner === null, 'DB_WORKER_LOCK_NOT_RELEASED');
    return { activeRuns, workerLockHeld: owner !== null };
  } finally { await connection.query({ sql: 'ROLLBACK', timeout: 10000 }); }
}
async function webProbe(root, image, mode) {
  let pool;
  try {
    ensure(process.platform === 'linux' && process.getuid() === 995 && process.getgid() === 992 && process.getgroups().every(value => value === 992), 'PROBE_IDENTITY_INVALID');
    ensure(['candidate', 'enabled', 'restored'].includes(mode), 'PROBE_MODE_INVALID');
    const fs = await import('node:fs'), { createRequire } = await import('node:module'), require = createRequire(root + '/package.json');
    const { readConfig } = await import('file://' + root + '/backend/src/config.mjs');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const config = readConfig(mode === 'candidate' ? require('dotenv').parse(input.envText) : process.env);
    ensure(config.mode === 'production' && config.writesEnabled && config.runEnabled === (mode !== 'restored') && config.port === 5180 && config.host === '127.0.0.1', 'PROBE_CONFIG_INVALID');
    ensure(config.db.host === '127.0.0.1' && config.db.port === 3306 && config.db.database === 'teaching_p5js' && config.db.user === 'dbadmin' && config.commonApi === 'http://127.0.0.1:5080/api' && config.runnerUrl === 'http://127.0.0.1:5280' && config.storageRoot === root + '/storage', 'PROBE_ENDPOINT_INVALID');
    for (const file of [config.storageRoot, config.storageRoot + '/sources']) fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    const disk = fs.statfsSync(config.storageRoot); ensure(disk.bavail * disk.bsize >= config.minFreeBytes, 'STORAGE_FREE_SPACE_LOW');
    if (mode !== 'restored') {
      ensure(config.compilerImage === image && /^[A-Za-z0-9_-]{64}$/.test(config.runnerToken), 'PROBE_RUNNER_CONFIG_INVALID');
      const { RunWorker } = await import('file://' + root + '/backend/src/worker.mjs');
      const health = await new RunWorker(null, config).request('/health');
      ensure(health?.ready === true && typeof health.busy === 'boolean' && health.image === image && (mode !== 'candidate' || health.busy === false), 'PROBE_RUNNER_UNREACHABLE');
    }
    const { MysqlRepository } = await import('file://' + root + '/backend/src/repository.mjs');
    pool = require('mysql2/promise').createPool({ ...config.db, connectionLimit: 1, connectTimeout: 10000 });
    const connection = await pool.getConnection(); let result;
    try { result = await queryReadiness(connection, MysqlRepository, mode); } finally { connection.release(); }
    process.stdout.write(JSON.stringify({ ok: true, mode, ...result }) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'WEB_PROBE_FAILED' }) + '\n'); process.exitCode = 1; }
  finally { if (pool) await pool.end(); }
}
export const probeSource = mode => [ensure.toString(), queryReadiness.toString(), '(' + webProbe.toString() + ')(' + [ROOT, IMAGE, mode].map(value => JSON.stringify(value)).join(',') + ');'].join('\n');
async function loadChecks() {
  const file = ROOT + '/deploy/start-runner-service-20260831.sh';
  const stat = fs.lstatSync(file); ensure(stat.isFile() && stat.uid === 0 && stat.nlink === 1 && !(stat.mode & 0o022) && fs.realpathSync(file) === file, 'HELPER_UNSAFE');
  const bytes = fs.readFileSync(file); ensure(sha(bytes) === 'cf186cef1cf732a7134b83b9fe081ace3859a6b8809125409500cf76f12d09be', 'HELPER_CHANGED');
  const body = /<<'CPP_RUNNER_SERVICE_NODE'\n([\s\S]+)\nCPP_RUNNER_SERVICE_NODE\n$/.exec(bytes.toString())?.[1]; ensure(body, 'HELPER_FORMAT');
  const extra = '\nexport { loadChecks, checks, serviceState, processIdentity, inspectStore };\nexport function bindWeb(folder,fd,secret){record=folder;logFd=fd;token=secret;}';
  start = await import('data:text/javascript;base64,' + Buffer.from(body + extra).toString('base64'));
  start.bindWeb(record, logFd, undefined); await start.loadChecks(); checks = start.checks;
  parseEnv = createRequire(ROOT + '/package.json')('dotenv').parse;
}
function run(binary, args) {
  try { return execFileSync(binary, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { save('command-error-' + randomBytes(4).toString('hex') + '.json', { binary, status: error.status, signal: error.signal, code: error.code, stderr: redact(error.stderr) }); log('命令失败：' + binary + '；' + redact(error.stderr)); throw Object.assign(new Error(), { code: 'COMMAND_FAILED' }); }
}
const list = () => JSON.parse(run('/usr/bin/pm2', ['jlist']));
const cpp = items => checkCpp(items || list(), Object.keys(parseEnv(candidate || original)));
function identity(value) {
  const env = value.pm2_env;
  ensure(value.pid > 1 && Number.isSafeInteger(value.pid) && env.status === 'online', 'CPP_NOT_ONLINE');
  ensure(fs.realpathSync(env.exec_interpreter) === fs.realpathSync(NODE) && fs.realpathSync('/proc/' + value.pid + '/exe') === fs.realpathSync(NODE), 'CPP_NODE_CHANGED');
  const status = fs.readFileSync('/proc/' + value.pid + '/status', 'utf8');
  for (const [label, expected] of [['Uid', 995], ['Gid', 992]]) { const row = new RegExp('^' + label + ':\\s+([0-9\\t ]+)$', 'm').exec(status); ensure(row && row[1].trim().split(/\s+/).length === 4 && row[1].trim().split(/\s+/).every(value => Number(value) === expected), 'CPP_IDENTITY_CHANGED'); }
  ensure(/^Groups:[ \t]*([^\n]*)$/m.exec(status)?.[1].trim().split(/\s+/).filter(Boolean).every(value => Number(value) === 992), 'CPP_GROUPS_CHANGED');
  const rows = run('ss', ['-H', '-lntp', '( sport = :5180 )']).trim().split('\n');
  ensure(rows.length === 1 && rows[0].trim().split(/\s+/)[3] === '127.0.0.1:5180' && rows[0].includes('pid=' + value.pid + ','), 'CPP_LISTENER_CHANGED');
}
function https(path) {
  const bytes = run('curl', ['-q', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', '--include', 'https://tigao123.com' + path]);
  const at = bytes.indexOf('\r\n\r\n'), match = /^HTTP\/1\.1 ([0-9]{3})\b/.exec(bytes);
  ensure(at > 0 && match, 'HTTPS_RESPONSE_INVALID'); return { status: Number(match[1]), text: bytes.slice(at + 4) };
}
async function endpoints(enabled) {
  const local = await start.request('/api/cpp/config', undefined, 'GET', undefined, 5180);
  ensure(local.status === 200, 'CPP_CONFIG_HTTP_FAILED'); checkGates(local.body, enabled);
  const health = await start.request('/api/cpp/health', undefined, 'GET', undefined, 5180);
  ensure(health.status === 200 && health.body.status === 'ok' && health.body.mode === 'production' && health.body.executionEnabled === enabled, 'CPP_HEALTH_FAILED');
  const publicConfig = https('/api/cpp/config'); ensure(publicConfig.status === 200, 'CPP_PUBLIC_CONFIG_FAILED'); checkGates(JSON.parse(publicConfig.text), enabled);
  ensure(https('/api/cpp/me').status === 401, 'CPP_PUBLIC_AUTH_INVALID');
  const denied = await start.request('/api/cpp/me', undefined, 'GET', undefined, 5180); ensure(denied.status === 401 && denied.body.code === 'LOGIN_REQUIRED', 'CPP_AUTH_INVALID');
  const page = https('/teaching-cpp/'); ensure(page.status === 200 && sha(page.text) === checks.old.hash(FRONT + '/index.html'), 'CPP_FRONTEND_INVALID');
  for (const text of [JSON.stringify(local.body), JSON.stringify(health.body), publicConfig.text]) ensure(!text.includes(token), 'PUBLIC_CONFIG_SECRET_EXPOSED');
}
async function runnerState() {
  const value = start.serviceState(); start.checkService(value, true); start.processIdentity(value);
  const health = await start.request('/health', token); ensure(health.status === 200 && health.cache === 'no-store', 'RUNNER_HTTP_INVALID'); checkRunnerHealth(health.body);
  return value;
}
function p5Health() {
  const response = https('/api/health'); ensure(response.status === 200, 'P5_HTTPS_FAILED'); const value = JSON.parse(response.text); ensure(value.status === 'OK' && value.db_check === 'Database Active', 'P5_HEALTH_FAILED');
}
async function unchanged() {
  for (const [file, digest] of Object.entries(before.hashes)) ensure(checks.old.hash(file) === digest, 'UNRELATED_FILE_CHANGED');
  checks.accountHelpers.assertNssUnchanged(before.nss);
  const manager = checks.old.manager(); checks.repairHelpers.checkManager(manager, true); checks.old.limits();
  const runner = await runnerState(); ensure(runner.MainPID === before.runner.MainPID && manager.MainPID === before.manager.MainPID && JSON.stringify(otherProcesses(list())) === JSON.stringify(before.otherProcesses), 'OTHER_PROCESS_CHANGED');
  p5Health();
}
function probe(mode) {
  let result;
  try { result = { status: 0, stdout: execFileSync('/usr/bin/setpriv', ['--reuid', '995', '--regid', '992', '--clear-groups', NODE, '--input-type=module', '-e', probeSource(mode)], { cwd: ROOT, env: webEnv, input: JSON.stringify(mode === 'candidate' ? { envText: candidate.toString() } : {}), encoding: 'utf8', timeout: 55000, maxBuffer: 128 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }) }; }
  catch (error) { result = { status: error.status, signal: error.signal, code: error.code, stdout: String(error.stdout || ''), stderr: redact(error.stderr) }; }
  let value; try { value = JSON.parse(result.stdout); } catch { value = { ok: false, code: 'WEB_PROBE_OUTPUT_INVALID' }; }
  save('website-account-probe-' + mode + '-' + randomBytes(4).toString('hex') + '.json', { ...result, stdout: redact(result.stdout) });
  if (!value.ok) throw Object.assign(new Error(), { code: safeCode(value.code) });
  ensure(result.status === 0 && !result.code && !result.signal && value.mode === mode, 'WEB_PROBE_FAILED'); return value;
}
async function ready(enabled) {
  const deadline = Date.now() + 30000; let first;
  while (Date.now() < deadline) {
    checkpoint(); const current = cpp();
    if (current.pm2_env.status === 'online' && current.pid > 1) {
      try { const response = await start.request('/api/cpp/config', undefined, 'GET', undefined, 5180); ensure(response.status === 200, 'CPP_NOT_READY'); checkGates(response.body, enabled); identity(current); first = current; break; } catch {}
    }
    await delay();
  }
  ensure(first, 'CPP_RESTART_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 2000));
  const stable = cpp(); identity(stable); ensure(stable.pid === first.pid && stable.pm2_env.restart_time === first.pm2_env.restart_time, 'CPP_RESTART_UNSTABLE');
  await endpoints(enabled); return stable;
}
function replaceEnvironment(expected, replacement) {
  const target = ROOT + '/.env'; ensure(checks.old.read(target).equals(expected), 'ENV_CHANGED_DURING_STEP');
  const stat = fs.lstatSync(target); ensure(stat.uid === 0 && stat.gid === 992 && (stat.mode & 0o777) === 0o640, 'ENV_PERMISSIONS_CHANGED');
  const temporary = ROOT + '/.env.run-enable-' + randomUUID() + '.tmp', fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, replacement); fs.fchownSync(fd, 0, 992); fs.fchmodSync(fd, 0o640); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  ensure(checks.old.read(target).equals(expected), 'ENV_CHANGED_DURING_STEP'); fs.renameSync(temporary, target);
  const parent = fs.openSync(ROOT, 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
async function preflight() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  for (const [file, uid, mode] of [[ROOT, 0, 0o755], [ROOT + '/logs', 995, 0o750], [ROOT + '/backups', 0, 0o700]]) { const stat = fs.lstatSync(file); ensure(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === mode && fs.realpathSync(file) === file, 'DIRECTORY_UNEXPECTED'); }
  ensure(!exists(LOCK), 'WEB_RUNNING_ALREADY_STARTED_DO_NOT_REPEAT');
  const logPath = ROOT + '/logs/web-running-enable-' + randomBytes(6).toString('hex') + '.log'; logFd = fs.openSync(logPath, 'wx', 0o600); log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/web-running-enable-'); log('私有备份与操作记录：' + record);
  step('只读预检：内部服务成功记录、原配置、网站进程和执行账号限额'); await loadChecks();
  const { old } = checks;
  old.directory(PREVIOUS, 0, 0o700); const previous = old.readJson(PREVIOUS + '/result.json'); checkPrevious(previous);
  const history = old.readJson(PREVIOUS + '/http-verification.json'); ensure(history.authenticated === true && history.unauthenticatedRejected === true && history.results?.length === 3, 'RUNNER_HISTORY_INVALID');
  history.results.forEach((row, i) => start.checkJob(start.CASES[i], row, previous.testJobIds[i]));
  const previousLock = old.readJson(ROOT + '/backups/runner-service-start.lock'); ensure(previousLock.record === PREVIOUS && Number.isSafeInteger(previousLock.pid) && previousLock.pid > 1 && !exists('/proc/' + previousLock.pid), 'PREVIOUS_OPERATION_NOT_STOPPED');
  for (const [file, digest] of Object.entries({ ...checks.SOURCE_HASHES, ...start.SOURCE_HASHES, ...HASHES })) checks.checkSource(ROOT + '/' + file, digest);
  original = old.read(ROOT + '/.env'); const configStat = fs.lstatSync(ROOT + '/.env'); ensure(configStat.uid === 0 && configStat.gid === 992 && (configStat.mode & 0o777) === 0o640, 'ENV_PERMISSIONS_INVALID');
  const runnerBytes = old.read(start.ENV_FILE), runnerStat = fs.lstatSync(start.ENV_FILE); ensure(runnerStat.uid === 0 && runnerStat.gid === 991 && (runnerStat.mode & 0o777) === 0o640, 'RUNNER_ENV_PERMISSIONS_INVALID');
  token = parseEnv(runnerBytes).RUNNER_TOKEN; ensure(runnerBytes.equals(Buffer.from(start.envText(token))) && old.hash(start.UNIT_FILE) === sha(start.unitText()) && previous.unitSha256 === sha(start.unitText()), 'RUNNER_CONFIG_CHANGED');
  start.bindWeb(record, logFd, token); candidate = patchEnvironment(original, token, parseEnv);
  const env = parseEnv(original); ensure(env.NODE_ENV === 'production' && env.APP_MODE === 'production' && env.DB_PASSWORD && env.DB_PASSWORD !== 'REPLACE_ON_SERVER', 'WEBSITE_ENV_INVALID');
  const daemon = Number(old.read('/root/.pm2/pm2.pid').toString().trim()); ensure(Number.isSafeInteger(daemon) && daemon > 1, 'PM2_DAEMON_INVALID'); process.kill(daemon, 0);
  const items = list(); oldCpp = cpp(items); identity(oldCpp);
  const p5 = items.filter(row => row.name === 'p5js-backend'); ensure(p5.length === 1 && p5[0].pm2_env.status === 'online' && p5[0].pm2_env.pm_cwd === P5 && p5[0].pm2_env.pm_exec_path === P5 + '/app.js', 'P5_PROCESS_UNEXPECTED');
  webEnv = JSON.parse(old.read(ROOT + '/deploy/backend-start-20260830-01/ecosystem.json')).apps[0].env;
  const runner = await runnerState(), manager = old.manager(); checks.repairHelpers.checkManager(manager, true); old.limits();
  const files = [P5 + '/.env', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/var/www/html/.htaccess', ROOT + '/deploy/web-publish-20260831-02/site.conf', '/root/.pm2/dump.pm2', start.ENV_FILE, start.UNIT_FILE, '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf', PREVIOUS + '/result.json', ...Object.keys({ ...checks.SOURCE_HASHES, ...start.SOURCE_HASHES, ...HASHES }).map(file => ROOT + '/' + file)];
  const compatibility = JSON.parse(old.read(ROOT + '/compat/p5js-20260830-01/manifest.json'));
  for (const file of compatibility.files) { ensure(sha(old.read(P5 + '/' + file.path).toString().replace(/\r\n/g, '\n')) === file.normalizedPatchedSha256, 'P5_CATEGORY_MODEL_CHANGED'); files.push(P5 + '/' + file.path); }
  for (const name of ['index.html', 'assets/editor-Do0j6OfF.js', 'assets/index-CFO81r6M.js', 'assets/index-DK110m_B.css']) files.push(FRONT + '/' + name);
  before = { hashes: Object.fromEntries(files.map(file => [file, old.hash(file)])), otherProcesses: otherProcesses(items), cpp: processSummary(oldCpp), runner, manager, nss: checks.accountHelpers.nssSnapshot() }; save('before.json', before);
  await endpoints(false); await unchanged();
  const imageLabel = old.readJson(ROOT + '/backups/compiler-check-02-PRb5s6/worker-unit.json').label; await start.inspectStore('web-enable-before', imageLabel);
  step('以 cpp-web 账号验证候选配置、执行器认证连接及数据库只读查询；尚未修改网站');
  const checked = probe('candidate'); ensure(checked.activeRuns === 0 && checked.workerLockHeld === false, 'PRE_ENABLE_QUEUE_NOT_EMPTY');
  await unchanged(); log('候选配置和网站账号到执行服务的连接通过；当前没有待运行任务或其他调度进程。');
}
async function backup() {
  step('备份 C++ 网站原配置；密钥和数据库密码不显示，不导出或修改业务数据');
  fs.writeFileSync(record + '/env.before', original, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(record + '/pm2-saved.before', checks.old.read('/root/.pm2/dump.pm2'), { flag: 'wx', mode: 0o600 });
  ensure(checks.old.read(record + '/env.before').equals(original), 'ENV_BACKUP_MISMATCH');
  save('backup-checksums.json', { originalEnvSha256: sha(original), candidateEnvSha256: sha(candidate), pm2SavedSha256: checks.old.hash(record + '/pm2-saved.before') });
  lockFd = fs.openSync(LOCK, 'wx', 0o600); fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, record }) + '\n');
}
function tailLogs() {
  try { const file = ROOT + '/logs/backend-error.log', fd = fs.openSync(file, 'r'); let text; try { const size = fs.fstatSync(fd).size, bytes = Buffer.alloc(Math.min(size, 8192)); fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length)); text = redact(bytes.toString()); } finally { fs.closeSync(fd); } save('backend-error-summary-' + randomBytes(4).toString('hex') + '.json', { text }); if (text.trim()) log('C++ 后端日志摘要：\n' + text); } catch { log('C++ 后端错误日志暂未取得，其他记录保留。'); }
}
async function recover() {
  recovering = true; log('启用检查未完成，尝试恢复“可保存、运行关闭”；不回滚数据库或作品。'); tailLogs();
  const current = cpp(); ensure(current.pm_id === oldCpp.pm_id, 'RECOVERY_PROCESS_CHANGED');
  run('/usr/bin/pm2', ['stop', String(current.pm_id)]);
  ensure(cpp().pm2_env.status === 'stopped' && run('ss', ['-H', '-lnt', '( sport = :5180 )']).trim() === '', 'RECOVERY_STOP_FAILED');
  const now = checks.old.read(ROOT + '/.env');
  if (now.equals(candidate)) replaceEnvironment(candidate, original); else ensure(now.equals(original), 'RECOVERY_ENV_CHANGED_EXTERNALLY');
  try { run('/usr/bin/pm2', ['restart', String(current.pm_id)]); await ready(false); }
  catch (error) { try { run('/usr/bin/pm2', ['stop', String(current.pm_id)]); } catch {} throw error; }
  const db = probe('restored'); await unchanged(); save('recovery.json', { stage: 'writes-enabled-running-disabled', ...db, runnerKeptRunning: true });
  log('C++ 网站已恢复：保存开启、运行关闭。内部执行服务及原 p5.js 未重启。');
  if (db.activeRuns) log('有 ' + db.activeRuns + ' 条未结束任务记录，已保留，待接续处理；不自动删除或伪报停止。');
}
async function main() {
  await activation({ preflight, backup,
    replace: async () => { step('只更新 RUNNER_TOKEN、CPP_COMPILER_IMAGE 和 CPP_RUN_ENABLED；其余配置及注释保留'); await unchanged(); ensure(cpp().pid === oldCpp.pid, 'CPP_CHANGED_BEFORE_ENABLE'); replaceEnvironment(original, candidate); },
    restart: async () => { step('只重启 teaching-cpp-backend，使网页运行配置生效'); const current = cpp(); ensure(current.pm_id === oldCpp.pm_id && current.pid === oldCpp.pid, 'CPP_CHANGED_BEFORE_RESTART'); run('/usr/bin/pm2', ['restart', String(current.pm_id)]); },
    verify: async () => { step('核对网页开关、网站账号连接、数据库调度锁、两个监听地址及原站状态'); const current = await ready(true); ensure(current.pid !== oldCpp.pid && current.pm2_env.restart_time === oldCpp.pm2_env.restart_time + 1, 'CPP_RESTART_COUNT_UNEXPECTED'); ensure(checks.old.read(ROOT + '/.env').equals(candidate), 'ENV_CHANGED_AFTER_ENABLE'); const db = probe('enabled'); save('enabled-database-state.json', db); await unchanged(); },
    finish: async () => { checkpoint(); const current = cpp(); identity(current); save('result.json', { stage: 'web-running-enabled', writesEnabled: true, runEnabled: true, image: IMAGE, runnerUrl: 'http://127.0.0.1:5280', cpp: processSummary(current), runner: before.runner, previous: PREVIOUS, apacheChanged: false, p5Restarted: false, runnerRestarted: false, pm2SavePerformed: false, databaseMigrationPerformed: false, browserRunVerified: false }); },
    recover
  });
  log('网页 C++ 运行已启用：保存后排队，由 cpp-runner 的受限容器执行。');
  log('网站账号到执行服务的认证连接通过，数据库调度锁已持有；单任务执行、最多20个待处理、每人1个未结束任务。');
  log('只重启了 C++ 网站后端；p5.js、Apache、执行服务、用户管理器及 PM2 保存记录保持。');
  log('本脚本没有创建测试账号或业务作品；浏览器端首次保存、运行和结果回显仍需你验证。');
  log('请刷新网页，新建“两数之和”，点击“保存并运行”，测试输入 12 30，预期输出 42；暂不要给全班分发或压测。');
  log('请发回完整输出和网页运行结果，不要重跑。私有备份：' + record);
}
if (process.argv[2] === '--enable-web-running') {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { interrupted = true; });
  const heartbeat = setInterval(() => { if (logFd !== undefined) log('操作仍在进行；阶段：' + phase); }, 15000);
  try { await main(); }
  catch (error) { log('网页运行启用未完成；阶段：' + phase + '；错误码：' + safeCode(error.code)); if (error.recoveryCode) log('自动恢复未确认：' + safeCode(error.recoveryCode) + '；请保留现场。'); if (before) { try { await unchanged(); log('原 p5.js、执行服务、Apache 配置与总限额复核保持。'); } catch (postError) { log('原环境复核未确认：' + safeCode(postError.code)); } } if (record) log('私有备份与操作记录：' + record); log('请发回完整输出，不要重跑或还原数据库，不要发送任何密钥。'); process.exitCode = 1; }
  finally { clearInterval(heartbeat); if (lockFd !== undefined) fs.closeSync(lockFd); if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_WEB_RUNNING_NODE
