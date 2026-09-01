import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';

// 本步骤只新增 C++ 后端进程；不修改原站、数据库、Apache、.env 或 PM2 开机保存记录。
const ROOT = '/var/www/teaching-cpp-backend';
const P5 = '/var/www/teaching-p5js-backend';
const NAME = 'teaching-cpp-backend';
const PM2 = '/usr/bin/pm2';
const NODE = ROOT + '/tools/node/bin/node';
const UID = 995;
const GID = 992;
const VERSION = 'backend-start-20260830-01';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = text => text.replace(/\r\n/g, '\n');
const args = process.argv.slice(2);
let stage = '材料检查';
let starting = false;
let oldP5;
let envHashes;
let interrupted = false;
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PM2_HOME: '/root/.pm2', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };

process.on('SIGINT', () => { interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });
function progress(message) {
  stage = message;
  console.log(new Date().toISOString() + ' ' + message);
  assert.ok(!interrupted, '操作被中断');
}
function run(binary, parameters) {
  return execFileSync(binary, parameters, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function bytes(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1, '文件类型不符合要求');
  return fs.readFileSync(file);
}
function realDirectory(file) {
  assert.equal(fs.realpathSync(file), file, '目录不能指向其他位置');
  assert.ok(fs.lstatSync(file).isDirectory());
}
function material() {
  const app = JSON.parse(bytes(path.join(import.meta.dirname, 'ecosystem.json'))).apps;
  assert.equal(app.length, 1);
  const config = app[0];
  assert.equal(config.name, NAME);
  assert.equal(config.cwd, ROOT);
  assert.equal(config.script, 'backend/src/server.mjs');
  assert.equal(config.interpreter, NODE);
  assert.equal(config.uid, UID); assert.equal(config.gid, GID);
  assert.equal(config.instances, 1); assert.equal(config.exec_mode, 'fork'); assert.equal(config.watch, false);
  assert.deepEqual(Object.keys(config.env).sort(), ['APP_MODE', 'HOME', 'LOGNAME', 'NODE_ENV', 'PATH', 'USER']);
  assert.equal(config.env.APP_MODE, 'production'); assert.equal(config.env.NODE_ENV, 'production');
  assert.equal(config.env.HOME, ROOT + '/runtime');
  assert.equal(config.env.USER, 'cpp-web'); assert.equal(config.env.LOGNAME, 'cpp-web');
  assert.equal(config.out_file, ROOT + '/logs/backend-out.log');
  assert.equal(config.error_file, ROOT + '/logs/backend-error.log');
  return config;
}
function list() { return JSON.parse(run(PM2, ['jlist'])); }
function p5State(items) {
  const matches = items.filter(item => item.name === 'p5js-backend');
  assert.equal(matches.length, 1);
  const p5 = matches[0];
  assert.equal(p5.pm2_env.pm_cwd, P5); assert.equal(p5.pm2_env.pm_exec_path, P5 + '/app.js');
  assert.equal(p5.pm2_env.status, 'online');
  return { pid: p5.pid, restarts: p5.pm2_env.restart_time, id: p5.pm_id };
}
function unchanged() {
  assert.deepEqual(p5State(list()), oldP5, '原 p5.js 进程状态发生变化');
  for (const [file, sha] of envHashes) assert.equal(hash(bytes(file)), sha, '.env 在本步骤期间发生变化');
}
function inspectModels() {
  const baseline = bytes(ROOT + '/deploy/production-20260830-01/p5js-baseline.sha256').toString('utf8').trim().split(/\r?\n/);
  const expected = new Map(baseline.map(line => [line.slice(66), line.slice(0, 64)]));
  const manifest = JSON.parse(bytes(ROOT + '/compat/p5js-20260830-01/manifest.json'));
  for (const file of manifest.files) expected.set(file.path, file.normalizedPatchedSha256);
  assert.equal(expected.size, 31);
  for (const [file, sha] of expected) assert.equal(hash(normalize(bytes(path.join(P5, file)).toString('utf8'))), sha, '原站代码与正式发布版本不一致：' + file);
}
async function json(url, expectedStatus = 200, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(3000), redirect: 'error' });
  assert.equal(response.status, expectedStatus, '接口状态不符合预期');
  return response.json();
}
async function p5Health() {
  const value = await json('http://127.0.0.1:5080/api/health');
  assert.equal(value.status, 'OK'); assert.equal(value.db_check, 'Database Active');
}
function processIdentity(info) {
  assert.ok(Number.isSafeInteger(info.pid) && info.pid > 1);
  assert.equal(info.pm2_env.pm_cwd, ROOT);
  assert.equal(info.pm2_env.pm_exec_path, ROOT + '/backend/src/server.mjs');
  assert.equal(info.pm2_env.exec_mode, 'fork_mode'); assert.equal(info.pm2_env.watch, false);
  assert.equal(Number(info.pm2_env.uid), UID); assert.equal(Number(info.pm2_env.gid), GID);
  const status = fs.readFileSync('/proc/' + info.pid + '/status', 'utf8');
  for (const [label, expected] of [['Uid', UID], ['Gid', GID]]) {
    const match = new RegExp('^' + label + ':\\s+([0-9\\t ]+)$', 'm').exec(status);
    assert.ok(match, '无法核验进程身份');
    const ids = match[1].trim().split(/\s+/).map(Number);
    assert.equal(ids.length, 4); assert.ok(ids.every(id => id === expected), 'C++ 后端实际进程身份不正确');
  }
  const groups = /^Groups:[ \t]*([^\n]*)$/m.exec(status);
  assert.ok(groups); assert.ok(groups[1].trim().split(/\s+/).filter(Boolean).every(id => Number(id) === GID), '进程继承了额外用户组');
  assert.equal(fs.realpathSync('/proc/' + info.pid + '/exe'), fs.realpathSync(NODE), '实际 Node 与独立安装版本不同');
  return info.pid;
}

async function start(config) {
  progress('启动前检查：正式发布结果、普通用户权限和关闭的写入/运行开关');
  assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
  process.umask(0o077);
  assert.equal(fs.realpathSync(import.meta.dirname), ROOT + '/deploy/' + VERSION);
  for (const dir of [ROOT, ROOT + '/runtime', ROOT + '/storage', ROOT + '/logs', ROOT + '/backups']) realDirectory(dir);
  run('sha256sum', ['--quiet', '-c', 'deploy/' + VERSION + '/START-FILES.sha256']);
  run('sha256sum', ['--quiet', '-c', 'backups/useradd-fix-NoMZXnat/DEPLOYMENT-FILES.after.sha256']);
  run('sha256sum', ['--quiet', '-c', 'deploy/production-20260830-01/PUBLISH-FILES.sha256']);
  run('sha256sum', ['--quiet', '-c', 'compat/p5js-20260830-01/VERIFICATION-FILES.sha256']);
  const publication = JSON.parse(bytes(ROOT + '/backups/first-publish-xoptT8/state.json'));
  assert.equal(publication.stage, 'complete'); assert.equal(publication.productionWrites, false); assert.equal(publication.runEnabled, false);
  inspectModels();
  assert.equal(run(NODE, ['--version']).trim(), 'v24.20.0');
  assert.equal(run('id', ['-u', 'cpp-web']).trim(), String(UID)); assert.equal(run('id', ['-g', 'cpp-web']).trim(), String(GID));
  for (const [dir, mode] of [['runtime', 0o700], ['storage', 0o700], ['logs', 0o750]]) {
    const stat = fs.statSync(ROOT + '/' + dir);
    assert.equal(stat.uid, UID); assert.equal(stat.gid, GID); assert.equal(stat.mode & 0o777, mode);
  }
  if (fs.existsSync(ROOT + '/storage/sources')) {
    realDirectory(ROOT + '/storage/sources');
    const source = fs.statSync(ROOT + '/storage/sources');
    assert.equal(source.uid, UID); assert.equal(source.mode & 0o777, 0o700);
  }
  const envFile = bytes(ROOT + '/.env');
  const stat = fs.statSync(ROOT + '/.env');
  assert.equal(stat.uid, 0); assert.equal(stat.gid, GID); assert.equal(stat.mode & 0o777, 0o640);
  envHashes = [[ROOT + '/.env', hash(envFile)], [P5 + '/.env', hash(bytes(P5 + '/.env'))]];
  const env = dotenv.parse(envFile);
  const expected = { NODE_ENV: 'production', APP_MODE: 'production', PORT: '5180', CPP_PRODUCTION_WRITES: 'disabled', CPP_RUN_ENABLED: 'false', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'teaching_p5js', DB_USER: 'dbadmin', COMMON_API_URL: 'http://127.0.0.1:5080/api', RUNNER_URL: 'http://127.0.0.1:5280', CPP_STORAGE_ROOT: ROOT + '/storage' };
  for (const [key, value] of Object.entries(expected)) assert.equal(env[key], value, key + ' 配置不符合当前阶段');
  assert.ok(env.DB_PASSWORD && env.DB_PASSWORD !== 'REPLACE_ON_SERVER', '数据库密码未填写');
  const daemon = Number(bytes('/root/.pm2/pm2.pid').toString('utf8').trim());
  assert.ok(Number.isSafeInteger(daemon) && daemon > 1); process.kill(daemon, 0);
  const processes = list(); oldP5 = p5State(processes);
  assert.equal(processes.filter(item => item.name === NAME || item.pm2_env.pm_exec_path === ROOT + '/backend/src/server.mjs').length, 0, 'C++ 进程已经登记，禁止重复首次启动');
  assert.equal(run('ss', ['-H', '-ltn', '( sport = :5180 or sport = :5280 )']).trim(), '', '5180 或 5280 已占用');
  await p5Health();

  // 独立子进程使用与 PM2 相同的普通用户，仅读取配置和迁移后的表结构，不带入 root 会话环境。
  const pm2Container = path.resolve(path.dirname(fs.realpathSync(PM2)), '../lib/ProcessContainerFork.js');
  const check = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { createPool } from 'mysql2/promise';
    import { readConfig } from './backend/src/config.mjs';
    import { MysqlRepository } from './backend/src/repository.mjs';
    assert.equal(process.getuid(), 995); assert.equal(process.getgid(), 992);
    fs.accessSync(${JSON.stringify(pm2Container)}, fs.constants.R_OK);
    const config = readConfig();
    assert.equal(config.mode, 'production'); assert.equal(config.writesEnabled, false); assert.equal(config.runEnabled, false);
    const pool = createPool({ ...config.db, connectionLimit: 1, connectTimeout: 10000 });
    try {
      const limited = { execute: (sql, params = []) => pool.execute({ sql, timeout: 10000 }, params) };
      await new MysqlRepository(limited).checkSchema();
      const [[migration]] = await limited.execute("SELECT state,checksum FROM cpp_schema_migrations WHERE id='001_cpp'");
      assert.equal(migration.state, 'complete');
      assert.equal(migration.checksum, 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041');
      console.log('cpp-web 数据库结构读取检查通过；没有修改数据库。');
    } finally { await pool.end(); }
  `;
  process.stdout.write(execFileSync(NODE, ['--input-type=module', '-e', check], { cwd: ROOT, uid: UID, gid: GID, env: config.env, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
  for (const file of [config.out_file, config.error_file]) {
    assert.equal(fs.existsSync(file), false, '首次启动日志文件已存在，保留现场并停止');
    const descriptor = fs.openSync(file, 'wx', 0o640);
    try { fs.fchownSync(descriptor, UID, GID); fs.fchmodSync(descriptor, 0o640); }
    finally { fs.closeSync(descriptor); }
  }
  progress('在现有 root PM2 中新增单个 cpp-web 后端进程，不重启原站');
  starting = true;
  run(PM2, ['start', ROOT + '/deploy/' + VERSION + '/ecosystem.json', '--only', NAME]);
  let pid;
  for (let attempt = 0; attempt < 25; attempt++) {
    const matches = list().filter(item => item.name === NAME);
    assert.equal(matches.length, 1, 'C++ 进程登记数量不正确');
    if (matches[0].pid > 1) {
      pid = processIdentity(matches[0]);
      try {
        const health = await json('http://127.0.0.1:5180/api/cpp/health');
        if (health.status === 'ok' && health.mode === 'production' && health.executionEnabled === false) break;
      } catch {}
    }
    pid = null;
    await delay(500);
  }
  assert.ok(pid, 'C++ 后端没有通过启动健康检查');
  const settings = await json('http://127.0.0.1:5180/api/cpp/config');
  assert.equal(settings.mode, 'production'); assert.equal(settings.writesEnabled, false); assert.equal(settings.runEnabled, false);
  const denied = await json('http://127.0.0.1:5180/api/cpp/me', 401, { 'X-Demo-User': '1' });
  assert.equal(denied.code, 'LOGIN_REQUIRED', '正式服务不应接受演示身份');
  const sockets = run('ss', ['-H', '-ltnp', 'sport = :5180']).trim().split('\n');
  assert.equal(sockets.length, 1); assert.equal(sockets[0].trim().split(/\s+/)[3], '127.0.0.1:5180');
  assert.ok(sockets[0].includes('pid=' + pid + ','), '5180 的监听者不是新后端');
  assert.equal(run('ss', ['-H', '-ltn', 'sport = :5280']).trim(), '');
  progress('检查接口、监听地址和原站状态');
  await delay(2000);
  const info = list().find(item => item.name === NAME);
  assert.ok(info); assert.equal(processIdentity(info), pid); assert.equal(info.pm2_env.status, 'online');
  assert.equal(info.pm2_env.restart_time, 0, '新后端发生异常重启');
  unchanged(); inspectModels(); await p5Health();
  const sourceStat = fs.lstatSync(ROOT + '/storage/sources');
  assert.ok(sourceStat.isDirectory() && !sourceStat.isSymbolicLink()); assert.equal(sourceStat.uid, UID);
  assert.equal(sourceStat.mode & 0o777, 0o700);
  const evidence = { stage: 'backend-readonly-online', pid, uid: UID, gid: GID, host: '127.0.0.1', port: 5180, writesEnabled: false, runEnabled: false, p5: oldP5, apacheChanged: false, pm2Saved: false, completedAt: new Date().toISOString() };
  fs.writeFileSync(ROOT + '/backups/backend-start-20260830-01-result.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  progress('C++ 后端只读启动完成：cpp-web，127.0.0.1:5180，写入关闭，执行关闭');
  starting = false;
  console.log('原 p5.js 进程未重启，5080 健康检查通过；Apache 和前端未改动。');
  console.log('当前尚未执行 pm2 save；核验成功后再安排开机恢复保存。');
  process.stdout.write(run(PM2, ['list']));
}

try {
  const config = material();
  if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
    console.log('启动材料检查通过；未读取 .env、未连接数据库、未启动服务。');
  } else {
    assert.deepEqual(args, ['--start-readonly']);
    await start(config);
  }
} catch (error) {
  console.error('启动未完成；阶段：' + stage + '；错误码：' + (error.code || 'START_FAILED'));
  if (error instanceof assert.AssertionError && !error.generatedMessage) console.error('检查说明：' + error.message);
  if (starting) {
    try {
      const matches = list().filter(item => item.name === NAME);
      if (matches.length === 1 && matches[0].pm2_env.pm_cwd === ROOT && matches[0].pm2_env.pm_exec_path === ROOT + '/backend/src/server.mjs') {
        run(PM2, ['stop', NAME]);
        assert.equal(list().find(item => item.name === NAME)?.pm2_env.status, 'stopped');
        console.error('仅停止本次新增的 C++ 后端；原 p5.js 未执行停止或重启。');
      }
    } catch { console.error('无法确认新后端已停止，请发回日志和 pm2 list；不要修改原站进程。'); }
  }
  console.error('保留日志和配置，不要重复首次启动或重跑数据库迁移。');
  process.exitCode = 1;
}
