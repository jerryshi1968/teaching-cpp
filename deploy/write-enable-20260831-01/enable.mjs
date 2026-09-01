import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import { activation, enableWrites, requireThat, sha256 } from './guard.mjs';

// 本步骤仅更改 C++ 的写入开关并重启这一项 PM2 进程，不改 Apache、原站或数据库结构。
const ROOT = '/var/www/teaching-cpp-backend';
const P5 = '/var/www/teaching-p5js-backend';
const FRONT = '/var/www/html/teaching-cpp';
const VERSION = 'write-enable-20260831-01';
const NAME = 'teaching-cpp-backend';
const NODE = ROOT + '/tools/node/bin/node';
const PM2 = '/usr/bin/pm2';
const UID = 995, GID = 992;
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };
let stage = '材料检查', failureStage, interrupted = false, recovering = false;
let original, candidate, backupDir, oldCpp, otherProcesses, appEnv;
const untouched = new Map();
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });
const check = (condition, code) => requireThat(condition, code);
function progress(message) {
  stage = message;
  console.log(new Date().toISOString() + ' ' + message);
  check(recovering || !interrupted, 'OPERATION_INTERRUPTED');
}
function read(file) {
  const stat = fs.lstatSync(file);
  check(stat.isFile() && stat.nlink === 1, 'UNSAFE_FILE_TYPE');
  return fs.readFileSync(file);
}
function directory(file) {
  check(fs.lstatSync(file).isDirectory() && fs.realpathSync(file) === file, 'UNSAFE_DIRECTORY');
}
function run(binary, args) {
  return execFileSync(binary, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function material() {
  const base = path.resolve(import.meta.dirname, '../..');
  const expected = ['README.md', 'check-db.mjs', 'enable.mjs', 'guard.mjs'].map(name => `deploy/${VERSION}/${name}`).sort();
  const lines = read(path.join(import.meta.dirname, 'WRITE-FILES.sha256')).toString('utf8').trim().split(/\r?\n/);
  const found = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (deploy\/write-enable-20260831-01\/[A-Za-z0-9.-]+)$/.exec(line);
    check(match && expected.includes(match[2]), 'MATERIAL_MANIFEST_INVALID');
    check(sha256(read(path.join(base, match[2]))) === match[1], 'MATERIAL_HASH_MISMATCH');
    found.push(match[2]);
  }
  check(JSON.stringify(found.sort()) === JSON.stringify(expected), 'MATERIAL_FILES_MISSING');
}
function list() { return JSON.parse(run(PM2, ['jlist'])); }
function cpp(items = list()) {
  const matches = items.filter(item => item.name === NAME || item.pm2_env.pm_exec_path === ROOT + '/backend/src/server.mjs');
  check(matches.length === 1, 'CPP_PROCESS_COUNT');
  const info = matches[0], env = info.pm2_env;
  check(info.name === NAME && env.pm_cwd === ROOT && env.pm_exec_path === ROOT + '/backend/src/server.mjs', 'CPP_PROCESS_PATH');
  check(env.exec_mode === 'fork_mode' && env.watch === false && Number(env.uid) === UID && Number(env.gid) === GID, 'CPP_PROCESS_SETTINGS');
  check(fs.realpathSync(env.exec_interpreter) === fs.realpathSync(NODE), 'CPP_PROCESS_NODE');
  check(env.NODE_ENV === 'production' && env.APP_MODE === 'production', 'CPP_PROCESS_MODE');
  for (const key of Object.keys(dotenv.parse(original))) {
    if (key !== 'NODE_ENV' && key !== 'APP_MODE') {
      check(env[key] === undefined && env.env?.[key] === undefined, 'PM2_OVERRIDES_ENV_FILE');
    }
  }
  return info;
}
function identity(info) {
  check(Number.isSafeInteger(info.pid) && info.pid > 1 && info.pm2_env.status === 'online', 'CPP_NOT_ONLINE');
  const status = fs.readFileSync('/proc/' + info.pid + '/status', 'utf8');
  for (const [label, expected] of [['Uid', UID], ['Gid', GID]]) {
    const match = new RegExp('^' + label + ':\\s+([0-9\\t ]+)$', 'm').exec(status);
    const values = match?.[1].trim().split(/\s+/).map(Number);
    check(values?.length === 4 && values.every(value => value === expected), 'CPP_ACTUAL_IDENTITY');
  }
  const groups = /^Groups:[ \t]*([^\n]*)$/m.exec(status);
  check(groups && groups[1].trim().split(/\s+/).filter(Boolean).every(value => Number(value) === GID), 'CPP_EXTRA_GROUP');
  check(fs.realpathSync('/proc/' + info.pid + '/exe') === fs.realpathSync(NODE), 'CPP_ACTUAL_NODE');
}
function others(items) {
  return items.filter(item => item.name !== NAME).map(item => ({ id: item.pm_id, name: item.name, pid: item.pid, restarts: item.pm2_env.restart_time, status: item.pm2_env.status })).sort((a, b) => a.id - b.id);
}
function unchanged() {
  check(JSON.stringify(others(list())) === JSON.stringify(otherProcesses), 'OTHER_PROCESS_CHANGED');
  for (const [file, digest] of untouched) check(sha256(read(file)) === digest, 'UNRELATED_FILE_CHANGED');
}
async function json(url, status = 200, headers = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error', headers });
  check(response.status === status, 'LOCAL_HTTP_STATUS');
  return response.json();
}
function https(urlPath) {
  const output = execFileSync('curl', ['--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', '--include', 'https://tigao123.com' + urlPath], { cwd: ROOT, env: cliEnv, timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const boundary = output.indexOf('\r\n\r\n');
  const header = output.subarray(0, boundary).toString('latin1');
  const match = /^HTTP\/1\.1 (\d{3})\b/.exec(header);
  check(boundary > 0 && match, 'HTTPS_RESPONSE_INVALID');
  return { status: Number(match[1]), body: output.subarray(boundary + 4) };
}
function gates(value, enabled) {
  check(value.mode === 'production' && value.writesEnabled === enabled && value.runEnabled === false, 'API_GATES_UNEXPECTED');
}
async function p5Health() {
  const value = await json('http://127.0.0.1:5080/api/health');
  check(value.status === 'OK' && value.db_check === 'Database Active', 'P5_HEALTH_FAILED');
  const response = https('/api/health');
  check(response.status === 200, 'P5_HTTPS_STATUS');
  const publicValue = JSON.parse(response.body);
  check(publicValue.status === 'OK' && publicValue.db_check === 'Database Active', 'P5_HTTPS_HEALTH');
}
function dbCheck(enabled) {
  let output;
  try {
    output = execFileSync(NODE, [ROOT + '/deploy/' + VERSION + '/check-db.mjs', enabled ? 'enabled' : 'disabled'], { cwd: ROOT, uid: UID, gid: GID, env: appEnv, encoding: 'utf8', timeout: 35000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    let detail;
    try { detail = JSON.parse(String(error.stdout || '')); } catch {}
    check(false, /^[A-Z][A-Z0-9_]{0,80}$/.test(detail?.code || '') ? detail.code : 'DB_CHECK_FAILED');
  }
  check(JSON.parse(output).ok === true, 'DB_CHECK_FAILED');
}
function sockets(pid) {
  const lines = run('ss', ['-H', '-ltnp', 'sport = :5180']).trim().split('\n');
  check(lines.length === 1 && lines[0].trim().split(/\s+/)[3] === '127.0.0.1:5180' && lines[0].includes('pid=' + pid + ','), 'CPP_LISTENER_UNEXPECTED');
  check(run('ss', ['-H', '-ltn', 'sport = :5280']).trim() === '', 'RUNNER_UNEXPECTED');
}
async function endpoints(enabled) {
  gates(await json('http://127.0.0.1:5180/api/cpp/config'), enabled);
  const health = await json('http://127.0.0.1:5180/api/cpp/health');
  check(health.status === 'ok' && health.mode === 'production' && health.executionEnabled === false, 'CPP_HEALTH_FAILED');
  const denied = await json('http://127.0.0.1:5180/api/cpp/me', 401, { 'X-Demo-User': '1' });
  check(denied.code === 'LOGIN_REQUIRED', 'DEMO_IDENTITY_ACCEPTED');
  const settings = https('/api/cpp/config');
  check(settings.status === 200, 'CPP_HTTPS_CONFIG_STATUS');
  gates(JSON.parse(settings.body), enabled);
  check(https('/api/cpp/me').status === 401, 'CPP_HTTPS_AUTH');
  const page = https('/teaching-cpp/');
  check(page.status === 200 && sha256(page.body) === sha256(read(FRONT + '/index.html')), 'CPP_HTTPS_FRONTEND');
}
async function ready(enabled) {
  let info;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    check(recovering || !interrupted, 'OPERATION_INTERRUPTED');
    info = cpp();
    if (info.pm2_env.status === 'online' && info.pid > 1) {
      try {
        gates(await json('http://127.0.0.1:5180/api/cpp/config'), enabled);
        identity(info);
        break;
      } catch { info = null; }
    } else info = null;
    await delay(500);
  }
  check(info, 'CPP_RESTART_TIMEOUT');
  await delay(2000);
  const stable = cpp(); identity(stable);
  check(stable.pid === info.pid && stable.pm2_env.restart_time === info.pm2_env.restart_time, 'CPP_RESTART_UNSTABLE');
  sockets(stable.pid);
  await endpoints(enabled);
  return stable;
}
function privateFile(name, data) {
  fs.writeFileSync(backupDir + '/' + name, data, { flag: 'wx', mode: 0o600 });
}
function replaceEnv(expected, replacement) {
  const target = ROOT + '/.env';
  check(read(target).equals(expected), 'ENV_CHANGED_DURING_STEP');
  const stat = fs.lstatSync(target);
  check(stat.uid === 0 && stat.gid === GID && (stat.mode & 0o777) === 0o640, 'ENV_PERMISSIONS_CHANGED');
  const temporary = ROOT + '/.env.write-enable-' + randomUUID() + '.tmp';
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(descriptor, replacement);
      fs.fchownSync(descriptor, 0, GID); fs.fchmodSync(descriptor, 0o640); fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    check(read(target).equals(expected), 'ENV_CHANGED_DURING_STEP');
    fs.renameSync(temporary, target);
    const parent = fs.openSync(ROOT, 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
async function preflight() {
  progress('启用前检查：现有只读服务、类别隔离补丁、数据库结构与配置');
  check(process.platform === 'linux' && process.getuid() === 0, 'ROOT_LINUX_REQUIRED');
  check(fs.realpathSync(import.meta.dirname) === ROOT + '/deploy/' + VERSION, 'INSTALL_PATH_UNEXPECTED');
  process.umask(0o077);
  for (const dir of [ROOT, ROOT + '/backups', ROOT + '/storage', ROOT + '/storage/sources', ROOT + '/logs', ROOT + '/runtime', FRONT]) directory(dir);
  check((fs.statSync(ROOT + '/backups').mode & 0o777) === 0o700 && fs.statSync(ROOT + '/backups').uid === 0, 'BACKUP_PERMISSIONS');
  for (const manifest of ['backups/useradd-fix-NoMZXnat/DEPLOYMENT-FILES.after.sha256', 'deploy/production-20260830-01/PUBLISH-FILES.sha256', 'compat/p5js-20260830-01/VERIFICATION-FILES.sha256', 'deploy/backend-start-20260830-01/START-FILES.sha256', 'deploy/web-publish-20260831-02/WEB-FILES.sha256']) run('sha256sum', ['--quiet', '-c', manifest]);
  check(run(NODE, ['--version']).trim() === 'v24.20.0', 'NODE_VERSION_UNEXPECTED');
  const publication = JSON.parse(read(ROOT + '/backups/first-publish-xoptT8/state.json'));
  check(publication.stage === 'complete', 'MIGRATION_PUBLICATION_INCOMPLETE');
  const web = JSON.parse(read(ROOT + '/backups/web-publish-G8lHpu/state.json'));
  check(web.stage === 'web-published-readonly', 'WEB_PUBLICATION_INCOMPLETE');
  const compatibility = JSON.parse(read(ROOT + '/compat/p5js-20260830-01/manifest.json'));
  for (const file of compatibility.files) {
    check(sha256(read(P5 + '/' + file.path).toString('utf8').replace(/\r\n/g, '\n')) === file.normalizedPatchedSha256, 'P5_CATEGORY_MODEL_CHANGED');
    untouched.set(P5 + '/' + file.path, sha256(read(P5 + '/' + file.path)));
  }
  for (const file of [P5 + '/.env', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/var/www/html/.htaccess', ROOT + '/deploy/web-publish-20260831-02/site.conf', '/root/.pm2/dump.pm2']) untouched.set(file, sha256(read(file)));
  const manifest = JSON.parse(read(ROOT + '/deploy/web-publish-20260831-02/frontend-manifest.json'));
  for (const file of manifest.files) {
    check(sha256(read(FRONT + '/' + file.path)) === file.sha256, 'FRONTEND_HASH_MISMATCH');
    untouched.set(FRONT + '/' + file.path, file.sha256);
  }
  original = read(ROOT + '/.env'); candidate = enableWrites(original);
  const stat = fs.lstatSync(ROOT + '/.env');
  check(stat.uid === 0 && stat.gid === GID && (stat.mode & 0o777) === 0o640, 'ENV_PERMISSIONS');
  const env = dotenv.parse(original);
  const expected = { NODE_ENV: 'production', APP_MODE: 'production', PORT: '5180', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'teaching_p5js', DB_USER: 'dbadmin', COMMON_API_URL: 'http://127.0.0.1:5080/api', RUNNER_URL: 'http://127.0.0.1:5280', CPP_STORAGE_ROOT: ROOT + '/storage' };
  for (const [key, value] of Object.entries(expected)) check(env[key] === value, 'ENV_EXPECTED_' + key);
  check(env.DB_PASSWORD && env.DB_PASSWORD !== 'REPLACE_ON_SERVER', 'DB_PASSWORD_MISSING');
  const daemon = Number(read('/root/.pm2/pm2.pid').toString('utf8').trim());
  check(Number.isSafeInteger(daemon) && daemon > 1, 'PM2_DAEMON_MISSING'); process.kill(daemon, 0);
  const items = list(); oldCpp = cpp(items); identity(oldCpp);
  otherProcesses = others(items);
  const p5 = items.filter(item => item.name === 'p5js-backend');
  check(p5.length === 1 && p5[0].pm2_env.status === 'online' && p5[0].pm2_env.pm_cwd === P5 && p5[0].pm2_env.pm_exec_path === P5 + '/app.js', 'P5_PROCESS_UNEXPECTED');
  appEnv = JSON.parse(read(ROOT + '/deploy/backend-start-20260830-01/ecosystem.json')).apps[0].env;
  sockets(oldCpp.pid); await endpoints(false); await p5Health();
  check(fs.readdirSync(ROOT + '/storage/sources').length === 0, 'CPP_SOURCE_ALREADY_EXISTS');
  dbCheck(false);
  execFileSync(NODE, ['--input-type=module', '-e', 'import fs from "node:fs"; for (const dir of ["storage", "storage/sources"]) fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);'], { cwd: ROOT, uid: UID, gid: GID, env: appEnv, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  const disk = fs.statfsSync(ROOT + '/storage');
  const minimumMB = Number(env.CPP_MIN_FREE_MB || 1024);
  check(Number.isSafeInteger(minimumMB) && minimumMB > 0 && disk.bavail * disk.bsize >= minimumMB * 1024 * 1024, 'STORAGE_FREE_SPACE');
  unchanged();
}
async function recover() {
  failureStage = stage;
  recovering = true;
  progress('恢复处理：停止 C++ 写入进程，恢复原开关并尝试只读启动');
  const current = cpp();
  check(current.pm_id === oldCpp.pm_id, 'RECOVERY_PROCESS_CHANGED');
  run(PM2, ['stop', String(current.pm_id)]);
  check(cpp().pm2_env.status === 'stopped' && run('ss', ['-H', '-ltn', 'sport = :5180']).trim() === '', 'RECOVERY_STOP_FAILED');
  const now = read(ROOT + '/.env');
  if (now.equals(candidate)) replaceEnv(candidate, original);
  else check(now.equals(original), 'RECOVERY_ENV_CHANGED_EXTERNALLY');
  try {
    run(PM2, ['restart', String(oldCpp.pm_id)]);
    await ready(false);
  } catch (error) {
    try { run(PM2, ['stop', String(oldCpp.pm_id)]); } catch {}
    throw error;
  }
  privateFile('recovery.json', JSON.stringify({ stage: 'restored-readonly', writesEnabled: false, runEnabled: false, at: new Date().toISOString() }, null, 2) + '\n');
  console.error('C++ 已恢复只读；未回滚数据库，不删除此期间可能保存的作品。');
}

try {
  material();
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
    console.log('写入启用材料检查通过；未读取 .env、未连接数据库、未操作服务器。');
  } else {
    check(args.length === 1 && args[0] === '--enable-writes', 'ARGUMENT_INVALID');
    await activation({
      preflight,
      backup: async () => {
        progress('保存 C++ 原配置和 PM2 记录；不导出或修改业务数据');
        backupDir = fs.mkdtempSync(ROOT + '/backups/write-enable-'); fs.chmodSync(backupDir, 0o700);
        console.log('本次私有备份目录：' + backupDir);
        privateFile('env.before', original);
        privateFile('pm2-before.json', run(PM2, ['jlist']));
        privateFile('pm2-saved-before.json', read('/root/.pm2/dump.pm2'));
        const names = ['env.before', 'pm2-before.json', 'pm2-saved-before.json'];
        privateFile('SHA256SUMS', names.map(name => sha256(read(backupDir + '/' + name)) + '  ' + name + '\n').join(''));
        check(read(backupDir + '/env.before').equals(original), 'BACKUP_VERIFY_FAILED');
        privateFile('before.json', JSON.stringify({ stage: 'before-enable', writesEnabled: false, runEnabled: false, cpp: { id: oldCpp.pm_id, pid: oldCpp.pid, restarts: oldCpp.pm2_env.restart_time }, otherProcesses, at: new Date().toISOString() }, null, 2) + '\n');
      },
      replace: async () => {
        progress('仅修改 CPP_PRODUCTION_WRITES，执行开关保持 false');
        unchanged(); replaceEnv(original, candidate);
      },
      restart: async () => {
        progress('只重启 teaching-cpp-backend，使新配置生效');
        const current = cpp();
        check(current.pm_id === oldCpp.pm_id && current.pid === oldCpp.pid, 'CPP_CHANGED_BEFORE_RESTART');
        run(PM2, ['restart', String(current.pm_id)]);
      },
      verify: async () => {
        progress('检查写入开关、HTTPS、普通用户身份、执行关闭及原站状态');
        const current = await ready(true);
        check(current.pid !== oldCpp.pid && current.pm2_env.restart_time === oldCpp.pm2_env.restart_time + 1, 'CPP_RESTART_COUNT');
        check(read(ROOT + '/.env').equals(candidate), 'ENV_CHANGED_AFTER_RESTART');
        dbCheck(true); unchanged(); await p5Health();
      },
      finish: async () => {
        check(!interrupted, 'OPERATION_INTERRUPTED');
        privateFile('result.json', JSON.stringify({ stage: 'writes-enabled-execution-disabled', writesEnabled: true, runEnabled: false, cppPid: cpp().pid, apacheChanged: false, p5Restarted: false, pm2SavePerformed: false, databaseMigrationPerformed: false, at: new Date().toISOString() }, null, 2) + '\n');
      },
      recover
    });
    console.log('C++ 写入已启用：可以新建、保存和分发模板；编译运行仍关闭。');
    console.log('原 p5.js 进程未重启，Apache、前端、PM2 保存记录及数据库结构未修改。');
    console.log('请刷新网页，用自己的账号新建练习、保存并重新打开；暂不要给全班分发。');
    console.log('备份目录：' + backupDir);
  }
} catch (error) {
  const safeCode = value => /^[A-Z][A-Z0-9_]{0,80}$/.test(value || '') ? value : 'ENABLE_FAILED';
  const location = String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line)).map(line => /[\/\\]((?:enable|guard|check-db)\.mjs:\d+:\d+)\)?$/.exec(line)?.[1]).find(Boolean);
  console.error('写入启用未完成；阶段：' + (failureStage || stage) + '；错误码：' + safeCode(error.code));
  if (location) console.error('检查位置：' + location);
  if (error.recoveryCode) console.error('自动恢复未能确认；错误码：' + safeCode(error.recoveryCode) + '。请发回日志和 pm2 list，不要重复执行或还原数据库。');
  if (backupDir) console.error('保留私有备份和日志：' + backupDir);
  process.exitCode = 1;
}
