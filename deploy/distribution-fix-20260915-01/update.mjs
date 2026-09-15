import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = 'distribution-fix-20260915-01';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const PRODUCTION_ROOT = '/var/www/teaching-cpp-backend';
const FRONTEND_ROOT = '/var/www/html/teaching-cpp';
const BACKUPS = PRODUCTION_ROOT + '/backups';
const NODE = PRODUCTION_ROOT + '/tools/node/bin/node';
const PM2 = '/usr/bin/pm2';
const CPP_NAME = 'teaching-cpp-backend';
const RUNNER_UNIT = 'teaching-cpp-runner.service';
const MATERIAL_FILES = ['README.md', 'package.mjs', 'release-manifest.json', 'update.mjs'];
const runnerEnv = { HOME: '/var/www/teaching-cpp-runner', USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus' };
const cliEnv = { HOME: '/root', PM2_HOME: '/root/.pm2', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };
let stage = '材料检查';
let backup;
let replacementStarted = false;
let recovering = false;
let interrupted = false;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function progress(message) {
  stage = message;
  console.log(new Date().toISOString() + ' ' + message);
  assert.ok(recovering || !interrupted, '操作被中断');
}

function run(command, args, timeout = 30000, options = {}) {
  try { return execFileSync(command, args, { cwd: PRODUCTION_ROOT, env: cliEnv, timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }); }
  catch (error) { error.code ||= 'COMMAND_' + path.basename(command).toUpperCase() + '_' + (error.status ?? 'FAILED'); throw error; }
}

function runnerCommand(args, timeout = 30000) {
  return run('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', ...args], timeout, { env: runnerEnv });
}

function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function read(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `拒绝读取非普通文件：${file}`);
  return fs.readFileSync(file);
}

function directory(dir) {
  const stat = fs.lstatSync(dir);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `拒绝非普通目录：${dir}`);
  assert.equal(fs.realpathSync(dir), dir, `目录真实路径与预期不符：${dir}`);
}

function parseChecksums(file) {
  return read(file).toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);
    assert.ok(match && !path.isAbsolute(match[2]) && !match[2].split('/').includes('..'), '校验清单格式不正确');
    return { sha256: match[1], path: match[2] };
  });
}

function verifyChecksums(file, expectedPaths) {
  const entries = parseChecksums(file);
  assert.equal(new Set(entries.map(item => item.path)).size, entries.length, '校验清单路径重复');
  assert.deepEqual(entries.map(item => item.path).sort(), [...expectedPaths].sort(), '校验清单文件集合不正确');
  for (const item of entries) assert.equal(sha256(read(path.join(PROJECT_ROOT, ...item.path.split('/')))), item.sha256, item.path);
}

function collectFiles(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('不接受符号链接');
    if (entry.isDirectory()) result.push(...collectFiles(target, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('包含非普通文件');
  }
  return result;
}

function inspectFile(root, file, current = false) {
  const bytes = read(path.join(root, ...file.path.split('/')));
  assert.equal(bytes.length, current ? file.currentBytes : file.bytes, file.path);
  assert.equal(sha256(bytes), current ? file.currentSha256 : file.sha256, file.path);
}

function manifest() {
  const value = JSON.parse(read(path.join(import.meta.dirname, 'release-manifest.json')));
  assert.equal(value.release, VERSION);
  assert.equal(value.sourceRevision, '781c4a5ffacbe453bfec282665691def208e7eab');
  assert.equal(value.sourceState, 'working-tree');
  assert.equal(value.applicationFile.path, 'backend/src/service.mjs');
  assert.equal(value.migration.id, '002_cpp_multifile');
  assert.deepEqual(value.expectedRestarts, { cpp: 46, p5js: 68, runner: 0 });
  for (const file of [value.applicationFile, ...value.frontendFiles]) {
    assert.match(file.path, /^[A-Za-z0-9_./-]+$/);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  assert.match(value.applicationFile.currentSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(value.applicationFile.currentBytes) && value.applicationFile.currentBytes > 0);
  return value;
}

export function verifyMaterials() {
  const materialPaths = MATERIAL_FILES.map(name => `deploy/${VERSION}/${name}`);
  verifyChecksums(path.join(import.meta.dirname, 'MATERIALS.sha256'), materialPaths);
  const value = manifest();
  const releaseFile = path.join(import.meta.dirname, 'RELEASE-FILES.sha256');
  const packaged = exists(releaseFile);
  const payloadRoot = packaged ? path.join(import.meta.dirname, 'payload') : PROJECT_ROOT;
  inspectFile(payloadRoot, value.applicationFile);
  if (packaged) {
    const payloadPath = `deploy/${VERSION}/payload/${value.applicationFile.path}`;
    const releasePaths = [...materialPaths, `deploy/${VERSION}/MATERIALS.sha256`, payloadPath];
    verifyChecksums(releaseFile, releasePaths);
    const actual = collectFiles(import.meta.dirname).map(name => `deploy/${VERSION}/${name}`).sort();
    assert.deepEqual(actual, [...releasePaths, `deploy/${VERSION}/RELEASE-FILES.sha256`].sort(), '发布目录含有清单外文件');
  }
  return { manifest: value, packaged, payloadRoot };
}

function processState(requireCppOnline = true) {
  const all = JSON.parse(run(PM2, ['jlist']));
  assert.deepEqual(all.map(item => item.name).sort(), [CPP_NAME, 'p5js-backend'].sort(), 'PM2 列表与预期不符');
  const summary = item => ({ id: item.pm_id, name: item.name, pid: item.pid, restarts: item.pm2_env.restart_time, status: item.pm2_env.status, cwd: item.pm2_env.pm_cwd, entry: item.pm2_env.pm_exec_path });
  const cpp = summary(all.find(item => item.name === CPP_NAME));
  const p5 = summary(all.find(item => item.name === 'p5js-backend'));
  assert.deepEqual({ cwd: cpp.cwd, entry: cpp.entry }, { cwd: PRODUCTION_ROOT, entry: PRODUCTION_ROOT + '/backend/src/server.mjs' });
  if (requireCppOnline) assert.equal(cpp.status, 'online');
  assert.deepEqual({ status: p5.status, cwd: p5.cwd, entry: p5.entry }, { status: 'online', cwd: '/var/www/teaching-p5js-backend', entry: '/var/www/teaching-p5js-backend/app.js' });
  return { cpp, p5 };
}

function runnerState() {
  const text = runnerCommand(['show', RUNNER_UNIT, '--property=LoadState', '--property=ActiveState', '--property=SubState', '--property=MainPID', '--property=NRestarts']).toString('utf8');
  const value = Object.fromEntries(text.trim().split(/\r?\n/).filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.deepEqual({ load: value.LoadState, active: value.ActiveState, sub: value.SubState }, { load: 'loaded', active: 'active', sub: 'running' });
  assert.ok(Number(value.MainPID) > 1);
  return { pid: Number(value.MainPID), restarts: Number(value.NRestarts), active: value.ActiveState, sub: value.SubState };
}

async function localJson(url, token) {
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(5000), redirect: 'error' });
  assert.equal(response.status, 200, url);
  return response.json();
}

async function health(config) {
  const website = await localJson('http://127.0.0.1:5180/api/cpp/config');
  assert.deepEqual({ mode: website.mode, writes: website.writesEnabled, run: website.runEnabled, files: website.limits.files, fileKB: website.limits.fileKB, projectKB: website.limits.projectKB }, { mode: 'production', writes: true, run: true, files: 64, fileKB: 128, projectKB: 512 });
  const runner = await localJson('http://127.0.0.1:5280/health', config.runnerToken);
  assert.deepEqual({ ready: runner.ready, busy: runner.busy, image: runner.image }, { ready: true, busy: false, image: config.compilerImage });
}

async function databaseState(config) {
  const { createConnection } = await import('mysql2/promise');
  const { connectionLimit, ...options } = config.db;
  const connection = await createConnection(options);
  try {
    await connection.query('START TRANSACTION READ ONLY');
    const [migrations] = await connection.query("SELECT id,state,checksum,completed_statements FROM cpp_schema_migrations WHERE id IN ('001_cpp','002_cpp_multifile') ORDER BY id");
    const [indexes] = await connection.query("SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN ('idx_cpp_revisions_project_time','idx_cpp_runs_project_time') GROUP BY TABLE_NAME,INDEX_NAME ORDER BY TABLE_NAME,INDEX_NAME");
    const [active] = await connection.query("SELECT COUNT(*) AS count FROM cpp_runs WHERE state IN ('queued','compiling','running','stopping')");
    await connection.query('ROLLBACK');
    return { migrations, indexes, activeRuns: Number(active[0].count) };
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch {}
    throw error;
  } finally { await connection.end(); }
}

function inspectFrontend(files) {
  assert.deepEqual(collectFiles(FRONTEND_ROOT).sort(), files.map(file => file.path).sort());
  for (const file of files) inspectFile(FRONTEND_ROOT, file);
}

function protectedState(manifestValue) {
  const files = [
    PRODUCTION_ROOT + '/.env',
    PRODUCTION_ROOT + '/backend/src/app.mjs',
    PRODUCTION_ROOT + '/backend/src/migrate.mjs',
    PRODUCTION_ROOT + '/backend/src/repository.mjs',
    PRODUCTION_ROOT + '/backend/src/source-store.mjs',
    PRODUCTION_ROOT + '/backend/src/validation.mjs',
    PRODUCTION_ROOT + '/backend/src/worker.mjs',
    PRODUCTION_ROOT + '/backend/src/server.mjs',
    PRODUCTION_ROOT + '/backend/migrations/002_cpp_multifile.sql',
    PRODUCTION_ROOT + '/runner/src/app.mjs',
    PRODUCTION_ROOT + '/runner/src/podman.mjs',
    '/var/www/teaching-p5js-backend/app.js',
    '/var/www/html/index.html',
    '/var/www/html/teaching-p5js/index.html',
    '/root/.pm2/dump.pm2',
    ...manifestValue.frontendFiles.map(file => path.join(FRONTEND_ROOT, ...file.path.split('/')))
  ];
  return new Map(files.map(file => [file, sha256(read(file))]));
}

function verifyProtected(expected) {
  for (const [file, digest] of expected) assert.equal(sha256(read(file)), digest, `${file} 发生变化`);
}

function requireProductionPlatform() {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || process.getuid() !== 0) {
    const error = new Error('正式更新只能由 Linux root 执行');
    error.code = 'PRODUCTION_PLATFORM_REQUIRED';
    throw error;
  }
}

async function preflight(materials) {
  progress('只读预检：多文件版本、服务、数据库与分发修正基线');
  requireProductionPlatform();
  assert.equal(PROJECT_ROOT, PRODUCTION_ROOT);
  assert.equal(fs.realpathSync(import.meta.dirname), PRODUCTION_ROOT + '/deploy/' + VERSION);
  assert.equal(materials.packaged, true, '必须从固定发布包运行');
  for (const dir of [PRODUCTION_ROOT, BACKUPS, PRODUCTION_ROOT + '/backend/src', FRONTEND_ROOT, import.meta.dirname]) directory(dir);
  assert.equal(fs.statSync(BACKUPS).uid, 0);
  assert.equal(fs.statSync(BACKUPS).mode & 0o777, 0o700);
  assert.equal(exists(BACKUPS + '/' + VERSION + '.lock'), false, '本版本已经开始执行，禁止重跑');
  inspectFile(PRODUCTION_ROOT, materials.manifest.applicationFile, true);
  inspectFile(materials.payloadRoot, materials.manifest.applicationFile);
  run(NODE, ['--check', path.join(materials.payloadRoot, ...materials.manifest.applicationFile.path.split('/'))]);
  inspectFrontend(materials.manifest.frontendFiles);
  const processes = processState();
  const runner = runnerState();
  assert.equal(processes.cpp.restarts, materials.manifest.expectedRestarts.cpp);
  assert.equal(processes.p5.restarts, materials.manifest.expectedRestarts.p5js);
  assert.equal(runner.restarts, materials.manifest.expectedRestarts.runner);
  const { readConfig } = await import(pathToFileURL(PRODUCTION_ROOT + '/backend/src/config.mjs').href + `?${VERSION}`);
  const config = readConfig();
  assert.deepEqual({ mode: config.mode, writes: config.writesEnabled, run: config.runEnabled }, { mode: 'production', writes: true, run: true });
  await health(config);
  const database = await databaseState(config);
  assert.deepEqual(database.migrations, [
    { id: '001_cpp', state: 'complete', checksum: 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041', completed_statements: 10 },
    { id: '002_cpp_multifile', state: 'complete', checksum: materials.manifest.migration.checksum, completed_statements: materials.manifest.migration.completedStatements }
  ]);
  assert.deepEqual(database.indexes, [
    { tableName: 'cpp_revisions', indexName: 'idx_cpp_revisions_project_time', columnsList: 'project_id,created_at' },
    { tableName: 'cpp_runs', indexName: 'idx_cpp_runs_project_time', columnsList: 'project_id,created_at' }
  ]);
  assert.equal(database.activeRuns, 0);
  const protectedFiles = protectedState(materials.manifest);
  assert.ok(fs.statfsSync(PRODUCTION_ROOT).bavail * fs.statfsSync(PRODUCTION_ROOT).bsize > 256 * 1024 * 1024);
  verifyProtected(protectedFiles);
  assert.deepEqual(processState(), processes);
  assert.deepEqual(runnerState(), runner);
  return { processes, runner, config, database, protectedFiles };
}

function syncDirectory(directoryPath) {
  const descriptor = fs.openSync(directoryPath, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function replace(target, bytes, stat) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${VERSION}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', stat.mode & 0o777);
  try {
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fchownSync(descriptor, stat.uid, stat.gid);
      fs.fchmodSync(descriptor, stat.mode & 0o777);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    syncDirectory(path.dirname(target));
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function record(name, value) {
  fs.writeFileSync(path.join(backup, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function waitForBackend(context) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    assert.ok(!interrupted, '操作被中断');
    try {
      const processes = processState();
      const runner = runnerState();
      if (processes.cpp.pid !== context.processes.cpp.pid && processes.cpp.restarts === context.processes.cpp.restarts + 1) {
        assert.deepEqual(processes.p5, context.processes.p5);
        assert.deepEqual(runner, context.runner);
        await health(context.config);
        return { processes, runner };
      }
    } catch {}
    await delay(500);
  }
  throw new Error('C++ 后端重启超时');
}

async function recover(materials, context, failure) {
  recovering = true;
  progress('恢复处理：还原旧 service.mjs');
  try {
    const target = path.join(PRODUCTION_ROOT, ...materials.manifest.applicationFile.path.split('/'));
    const stat = fs.lstatSync(target);
    replace(target, read(path.join(backup, 'previous-service.mjs')), stat);
    inspectFile(PRODUCTION_ROOT, materials.manifest.applicationFile, true);
    const current = processState(false);
    run(PM2, ['restart', String(current.cpp.id)]);
    const deadline = Date.now() + 30000;
    let restored = false;
    while (Date.now() < deadline) {
      try { await health(context.config); restored = true; break; } catch {}
      await delay(500);
    }
    assert.equal(restored, true);
    verifyProtected(context.protectedFiles);
    assert.deepEqual((await databaseState(context.config)), context.database);
    record('recovery.json', { recoveredAt: new Date().toISOString(), state: 'old-service-restored' });
    failure.recovered = true;
  } catch (error) {
    failure.recoveryCode = safeCode(error.code);
    throw error;
  }
}

async function publish(materials) {
  const context = await preflight(materials);
  progress('建立一次性锁和私有备份');
  fs.writeFileSync(BACKUPS + '/' + VERSION + '.lock', JSON.stringify({ version: VERSION, pid: process.pid, startedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  backup = fs.mkdtempSync(BACKUPS + '/' + VERSION + '-');
  fs.chmodSync(backup, 0o700);
  record('baseline.json', { version: VERSION, processes: context.processes, runner: context.runner, database: context.database });
  try {
    progress('备份并原子替换 service.mjs');
    const target = path.join(PRODUCTION_ROOT, ...materials.manifest.applicationFile.path.split('/'));
    fs.copyFileSync(target, path.join(backup, 'previous-service.mjs'), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(backup, 'previous-service.mjs'), 0o600);
    replacementStarted = true;
    replace(target, read(path.join(materials.payloadRoot, ...materials.manifest.applicationFile.path.split('/'))), fs.lstatSync(target));
    inspectFile(PRODUCTION_ROOT, materials.manifest.applicationFile);
    progress('只重启 C++ 后端');
    run(PM2, ['restart', String(context.processes.cpp.id)]);
    const services = await waitForBackend(context);
    progress('核验分发修正及未触碰对象');
    inspectFile(PRODUCTION_ROOT, materials.manifest.applicationFile);
    inspectFrontend(materials.manifest.frontendFiles);
    verifyProtected(context.protectedFiles);
    assert.deepEqual(services.processes.p5, context.processes.p5);
    assert.deepEqual(services.runner, context.runner);
    assert.deepEqual((await databaseState(context.config)), context.database);
    record('success.json', { stage: 'distribution-fix-complete', completedAt: new Date().toISOString(), services });
    console.log('C++ 班级分发名称修正完成。');
    console.log('旧文件与操作记录保存在：' + backup);
  } catch (error) {
    const failure = { stage, code: safeCode(error.code), recovered: false };
    if (replacementStarted) {
      try { await recover(materials, context, failure); }
      catch (recoveryError) { failure.recoveryCode = safeCode(recoveryError.code); }
    }
    try { record('failure.json', failure); } catch {}
    Object.assign(error, failure);
    throw error;
  }
}

function safeCode(code) {
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'DISTRIBUTION_FIX_FAILED';
}

function evidence(error) {
  const locations = String(error.stack || '').split('\n').map(line => /update\.mjs:\d+:\d+/.exec(line)?.[0]).filter(Boolean).slice(0, 8);
  return { stage, code: safeCode(error.code), locations, recovered: error.recovered === true, recoveryCode: error.recoveryCode || null };
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { interrupted = true; });

async function main() {
  try {
    const materials = verifyMaterials();
    const args = process.argv.slice(2);
    if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
      console.log(`发布材料检查通过：${VERSION}；未读取生产配置、未连接数据库或服务、未修改文件。`);
    } else if (args.length === 1 && args[0] === '--preflight') {
      await preflight(materials);
      console.log('生产只读预检通过；未建立锁、未创建备份、未修改数据库、文件或服务。');
    } else {
      assert.deepEqual(args.sort(), ['--backup-confirmed', '--production-reviewed', '--publish'].sort());
      await publish(materials);
    }
  } catch (error) {
    console.error('C++ 班级分发名称修正未完成；诊断：' + JSON.stringify(evidence(error)));
    if (backup) console.error('备份目录：' + backup);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
