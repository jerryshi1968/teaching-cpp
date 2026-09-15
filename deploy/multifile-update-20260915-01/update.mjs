import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { activateFrontend, assertReleaseManifest, installApplicationFiles, restoreApplicationFiles, restoreFrontend, VERSION } from './guard.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const PRODUCTION_ROOT = '/var/www/teaching-cpp-backend';
const FRONTEND_ROOT = '/var/www/html/teaching-cpp';
const BACKUPS = PRODUCTION_ROOT + '/backups';
const NODE = PRODUCTION_ROOT + '/tools/node/bin/node';
const PM2 = '/usr/bin/pm2';
const CPP_NAME = 'teaching-cpp-backend';
const RUNNER_UNIT = 'teaching-cpp-runner.service';
const MATERIAL_FILES = ['README.md', 'guard.mjs', 'package.mjs', 'release-manifest.json', 'update.mjs'];
const runnerEnv = { HOME: '/var/www/teaching-cpp-runner', USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus' };
const cliEnv = { HOME: '/root', PM2_HOME: '/root/.pm2', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };
let stage = '材料检查';
let backup;
let replacementStarted = false;
let frontendActivated = false;
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

function record(name, value) {
  fs.writeFileSync(path.join(backup, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
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
    if (entry.isSymbolicLink()) throw new Error('发布材料不接受符号链接');
    if (entry.isDirectory()) result.push(...collectFiles(target, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('发布材料包含非普通文件');
  }
  return result;
}

function inspectFile(root, file, digestKey = 'sha256', bytesKey = 'bytes') {
  const bytes = read(path.join(root, ...file.path.split('/')));
  assert.equal(bytes.length, file[bytesKey], file.path);
  assert.equal(sha256(bytes), file[digestKey], file.path);
}

function inspectFiles(root, files, current = false) {
  for (const file of files) inspectFile(root, file, current ? 'currentSha256' : 'sha256', current ? 'currentBytes' : 'bytes');
}

function inspectFrontend(root, files) {
  const expected = files.map(file => file.path).sort();
  assert.deepEqual(collectFiles(root).sort(), expected, '前端文件集合不正确');
  inspectFiles(root, files);
}

export function verifyMaterials() {
  const materialPaths = MATERIAL_FILES.map(name => `deploy/${VERSION}/${name}`);
  verifyChecksums(path.join(import.meta.dirname, 'MATERIALS.sha256'), materialPaths);
  const manifest = assertReleaseManifest(JSON.parse(read(path.join(import.meta.dirname, 'release-manifest.json'))));
  const releaseFile = path.join(import.meta.dirname, 'RELEASE-FILES.sha256');
  const packaged = exists(releaseFile);
  const payloadRoot = packaged ? path.join(import.meta.dirname, 'payload') : PROJECT_ROOT;
  const frontendRoot = packaged ? path.join(payloadRoot, 'frontend') : path.join(PROJECT_ROOT, 'frontend/dist');
  inspectFiles(payloadRoot, [...manifest.applicationFiles, manifest.migration]);
  inspectFrontend(frontendRoot, manifest.frontendFiles);
  if (packaged) {
    const releasePaths = [
      ...materialPaths,
      `deploy/${VERSION}/MATERIALS.sha256`,
      ...manifest.applicationFiles.map(file => `deploy/${VERSION}/payload/${file.path}`),
      `deploy/${VERSION}/payload/${manifest.migration.path}`,
      ...manifest.frontendFiles.map(file => `deploy/${VERSION}/payload/frontend/${file.path}`)
    ];
    verifyChecksums(releaseFile, releasePaths);
    const actual = collectFiles(import.meta.dirname).map(name => `deploy/${VERSION}/${name}`).sort();
    assert.deepEqual(actual, [...releasePaths, `deploy/${VERSION}/RELEASE-FILES.sha256`].sort(), '发布目录含有清单外文件');
  }
  return { manifest, packaged, payloadRoot, frontendRoot };
}

function processState(requireOnline = true) {
  const all = JSON.parse(run(PM2, ['jlist']));
  assert.deepEqual(all.map(item => item.name).sort(), [CPP_NAME, 'p5js-backend'], 'PM2 列表与预期不符');
  const cpp = all.find(item => item.name === CPP_NAME);
  const p5 = all.find(item => item.name === 'p5js-backend');
  if (requireOnline) assert.equal(cpp.pm2_env.status, 'online');
  assert.equal(cpp.pm2_env.pm_cwd, PRODUCTION_ROOT);
  assert.equal(cpp.pm2_env.pm_exec_path, PRODUCTION_ROOT + '/backend/src/server.mjs');
  assert.equal(cpp.pm2_env.exec_mode, 'fork_mode');
  assert.equal(cpp.pm2_env.watch, false);
  assert.equal(Number(cpp.pm2_env.uid), 995);
  assert.equal(Number(cpp.pm2_env.gid), 992);
  assert.equal(p5.pm2_env.status, 'online');
  assert.equal(p5.pm2_env.pm_cwd, '/var/www/teaching-p5js-backend');
  assert.equal(p5.pm2_env.pm_exec_path, '/var/www/teaching-p5js-backend/app.js');
  const summary = item => ({ id: item.pm_id, name: item.name, pid: item.pid, restarts: item.pm2_env.restart_time, status: item.pm2_env.status });
  return { cpp: summary(cpp), p5: summary(p5) };
}

function parseProperties(text) {
  const result = {};
  for (const line of text.trim().split(/\r?\n/).filter(Boolean)) {
    const index = line.indexOf('=');
    assert.ok(index > 0 && !(line.slice(0, index) in result), '执行服务属性格式不正确');
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

function runnerState(requireActive = true) {
  const keys = ['LoadState', 'ActiveState', 'SubState', 'MainPID', 'NRestarts', 'FragmentPath', 'Delegate', 'NoNewPrivileges'];
  const value = parseProperties(runnerCommand(['show', RUNNER_UNIT, ...keys.map(key => '--property=' + key)]).toString('utf8'));
  assert.equal(value.LoadState, 'loaded');
  if (requireActive) { assert.equal(value.ActiveState, 'active'); assert.equal(value.SubState, 'running'); }
  assert.equal(value.FragmentPath, '/var/www/teaching-cpp-runner/.config/systemd/user/' + RUNNER_UNIT);
  assert.equal(value.Delegate, 'yes');
  assert.equal(value.NoNewPrivileges, 'no');
  assert.ok(Number.isSafeInteger(Number(value.MainPID)) && Number(value.MainPID) > 1);
  return { pid: Number(value.MainPID), restarts: Number(value.NRestarts), active: value.ActiveState, sub: value.SubState };
}

async function localJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000), redirect: 'error' });
  assert.equal(response.status, 200, url);
  return response.json();
}

function assertConfig(config) {
  assert.equal(config.mode, 'production');
  assert.equal(config.writesEnabled, true);
  assert.equal(config.runEnabled, true);
}

async function health(config, expectMultifile = false) {
  const website = await localJson('http://127.0.0.1:5180/api/cpp/config');
  assertConfig(website);
  if (expectMultifile) assert.deepEqual({ files: website.limits.files, fileKB: website.limits.fileKB, projectKB: website.limits.projectKB }, { files: 64, fileKB: 128, projectKB: 512 });
  const runner = await localJson('http://127.0.0.1:5280/health', config.runnerToken);
  assert.equal(runner.ready, true);
  assert.equal(runner.busy, false);
  assert.equal(runner.image, config.compilerImage);
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

function protectedState() {
  const files = [
    PRODUCTION_ROOT + '/.env',
    PRODUCTION_ROOT + '/package-lock.json',
    PRODUCTION_ROOT + '/backend/package.json',
    PRODUCTION_ROOT + '/backend/migrations/001_cpp.sql',
    PRODUCTION_ROOT + '/backend/src/auth.mjs',
    PRODUCTION_ROOT + '/backend/src/config.mjs',
    PRODUCTION_ROOT + '/backend/src/demo.mjs',
    PRODUCTION_ROOT + '/backend/src/errors.mjs',
    PRODUCTION_ROOT + '/backend/src/server.mjs',
    PRODUCTION_ROOT + '/runner/Containerfile',
    PRODUCTION_ROOT + '/runner/src/config.mjs',
    PRODUCTION_ROOT + '/runner/src/cpu-budget.mjs',
    PRODUCTION_ROOT + '/runner/src/instance-lock.mjs',
    PRODUCTION_ROOT + '/runner/src/jobs.mjs',
    PRODUCTION_ROOT + '/runner/src/server.mjs',
    '/var/www/teaching-cpp-runner/.config/systemd/user/' + RUNNER_UNIT,
    '/var/www/html/index.html',
    '/var/www/html/teaching-p5js/index.html',
    '/root/.pm2/dump.pm2'
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
  progress('只读预检：基线、服务、健康状态、数据库和空队列');
  requireProductionPlatform();
  assert.equal(PROJECT_ROOT, PRODUCTION_ROOT);
  assert.equal(fs.realpathSync(import.meta.dirname), PRODUCTION_ROOT + '/deploy/' + VERSION);
  assert.equal(materials.packaged, true, '必须从固定发布包运行');
  for (const dir of [PRODUCTION_ROOT, BACKUPS, PRODUCTION_ROOT + '/backend/src', PRODUCTION_ROOT + '/backend/migrations', PRODUCTION_ROOT + '/runner/src', FRONTEND_ROOT, import.meta.dirname]) directory(dir);
  assert.equal(fs.statSync(BACKUPS).uid, 0);
  assert.equal(fs.statSync(BACKUPS).mode & 0o777, 0o700);
  assert.equal(exists(BACKUPS + '/' + VERSION + '.lock'), false, '本版本已经开始执行，禁止重跑');
  inspectFiles(PRODUCTION_ROOT, materials.manifest.applicationFiles, true);
  assert.equal(exists(path.join(PRODUCTION_ROOT, ...materials.manifest.migration.path.split('/'))), false, '新迁移文件基线不是缺失');
  inspectFrontend(FRONTEND_ROOT, materials.manifest.currentFrontendFiles);
  inspectFiles(materials.payloadRoot, [...materials.manifest.applicationFiles, materials.manifest.migration]);
  inspectFrontend(materials.frontendRoot, materials.manifest.frontendFiles);
  for (const file of materials.manifest.applicationFiles.filter(file => file.path.endsWith('.mjs'))) run(NODE, ['--check', path.join(materials.payloadRoot, ...file.path.split('/'))]);
  const processBaseline = processState();
  const runnerBaseline = runnerState();
  assert.equal(processBaseline.cpp.restarts, 45, 'C++ 后端重启计数已变化');
  assert.equal(processBaseline.p5.restarts, 68, 'p5.js 重启计数已变化');
  assert.equal(runnerBaseline.restarts, 0, 'Runner 重启计数已变化');
  const { readConfig } = await import(pathToFileURL(PRODUCTION_ROOT + '/backend/src/config.mjs').href + `?${VERSION}`);
  const config = readConfig();
  assertConfig(config);
  await health(config);
  const database = await databaseState(config);
  assert.deepEqual(database.migrations, [{ id: '001_cpp', state: 'complete', checksum: 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041', completed_statements: 10 }]);
  assert.deepEqual(database.indexes, []);
  assert.equal(database.activeRuns, 0, '运行队列未排空');
  const protectedFiles = protectedState();
  assert.ok(fs.statfsSync(PRODUCTION_ROOT).bavail * fs.statfsSync(PRODUCTION_ROOT).bsize > 512 * 1024 * 1024, '磁盘余量不足');
  verifyProtected(protectedFiles);
  assert.deepEqual(processState(), processBaseline);
  assert.deepEqual(runnerState(), runnerBaseline);
  return { processBaseline, runnerBaseline, protectedFiles, config };
}

async function waitForServices(context) {
  const deadline = Date.now() + 30000;
  let processes;
  let runner;
  while (Date.now() < deadline) {
    assert.ok(!interrupted, '操作被中断');
    try {
      processes = processState();
      runner = runnerState();
      if (processes.cpp.pid !== context.processBaseline.cpp.pid && processes.cpp.restarts === context.processBaseline.cpp.restarts + 1 && runner.pid !== context.runnerBaseline.pid) {
        await health(context.config, true);
        return { processes, runner };
      }
    } catch { processes = null; runner = null; }
    await delay(500);
  }
  throw new Error('C++ 后端或 Runner 重启超时');
}

function prepareFrontend(materials) {
  const staging = path.join(backup, 'frontend-staging');
  fs.mkdirSync(staging, { mode: 0o700 });
  for (const file of materials.manifest.frontendFiles) {
    const source = path.join(materials.frontendRoot, ...file.path.split('/'));
    const target = path.join(staging, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o644);
  }
  fs.chmodSync(staging, 0o755);
  fs.chmodSync(path.join(staging, 'assets'), 0o755);
  inspectFrontend(staging, materials.manifest.frontendFiles);
  return staging;
}

async function verifyPublished(materials, context, serviceState) {
  inspectFiles(PRODUCTION_ROOT, materials.manifest.applicationFiles);
  inspectFile(PRODUCTION_ROOT, materials.manifest.migration);
  inspectFrontend(FRONTEND_ROOT, materials.manifest.frontendFiles);
  verifyProtected(context.protectedFiles);
  assert.deepEqual(serviceState.processes.p5, context.processBaseline.p5);
  assert.equal(serviceState.processes.cpp.restarts, context.processBaseline.cpp.restarts + 1);
  assert.equal(serviceState.runner.restarts, context.runnerBaseline.restarts);
  const database = await databaseState(context.config);
  assert.deepEqual(database.migrations, [
    { id: '001_cpp', state: 'complete', checksum: 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041', completed_statements: 10 },
    { id: '002_cpp_multifile', state: 'complete', checksum: materials.manifest.migration.sha256, completed_statements: 2 }
  ]);
  assert.deepEqual(database.indexes, [
    { tableName: 'cpp_revisions', indexName: 'idx_cpp_revisions_project_time', columnsList: 'project_id,created_at' },
    { tableName: 'cpp_runs', indexName: 'idx_cpp_runs_project_time', columnsList: 'project_id,created_at' }
  ]);
  assert.equal(database.activeRuns, 0);
  await health(context.config, true);
  return database;
}

async function recover(materials, context, failure) {
  recovering = true;
  progress('恢复处理：还原旧应用文件和旧前端');
  try {
    if (frontendActivated) restoreFrontend({ current: FRONTEND_ROOT, previous: path.join(backup, 'previous-frontend'), failed: path.join(backup, 'failed-frontend') });
    restoreApplicationFiles({ root: PRODUCTION_ROOT, backupRoot: backup, manifest: materials.manifest });
    inspectFiles(PRODUCTION_ROOT, materials.manifest.applicationFiles, true);
    inspectFrontend(FRONTEND_ROOT, materials.manifest.currentFrontendFiles);
    runnerCommand(['restart', RUNNER_UNIT]);
    const current = processState(false);
    assert.equal(current.cpp.id, context.processBaseline.cpp.id);
    run(PM2, ['restart', String(current.cpp.id)]);
    const deadline = Date.now() + 30000;
    let restored = false;
    while (Date.now() < deadline) {
      try {
        const processes = processState();
        const runner = runnerState();
        if (processes.cpp.pid !== current.cpp.pid && runner.active === 'active') { await health(context.config); restored = true; break; }
      } catch {}
      await delay(500);
    }
    assert.equal(restored, true, '恢复旧服务后健康检查超时');
    verifyProtected(context.protectedFiles);
    const database = await databaseState(context.config);
    record('recovery.json', { stage: 'old-application-restored', recoveredAt: new Date().toISOString(), database });
    failure.recovered = true;
    failure.databaseReviewRequired = database.migrations.some(item => item.id === '002_cpp_multifile' && item.state !== 'complete');
  } catch (recoveryError) {
    failure.recoveryCode = safeCode(recoveryError.code);
    failure.recovered = false;
    throw recoveryError;
  }
}

async function publish(materials) {
  const context = await preflight(materials);
  progress('建立一次性锁和私有备份');
  const lock = BACKUPS + '/' + VERSION + '.lock';
  fs.writeFileSync(lock, JSON.stringify({ version: VERSION, pid: process.pid, startedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  backup = fs.mkdtempSync(BACKUPS + '/' + VERSION + '-');
  fs.chmodSync(backup, 0o700);
  record('baseline.json', { version: VERSION, processBaseline: context.processBaseline, runnerBaseline: context.runnerBaseline });
  const staging = prepareFrontend(materials);
  try {
    progress('备份并原子替换后端、共享合约和 Runner 文件');
    installApplicationFiles({ root: PRODUCTION_ROOT, payloadRoot: materials.payloadRoot, backupRoot: backup, manifest: materials.manifest, onPrepared: () => { replacementStarted = true; } });
    inspectFiles(PRODUCTION_ROOT, materials.manifest.applicationFiles);
    inspectFile(PRODUCTION_ROOT, materials.manifest.migration);
    progress('应用 002_cpp_multifile 加法迁移');
    const migrationOutput = run(NODE, [PRODUCTION_ROOT + '/backend/src/migrate.mjs', '--apply', '--confirm-db', context.config.db.database, '--backup-confirmed', '--production-reviewed'], 120000).toString('utf8').trim();
    record('migration-output.json', { completedAt: new Date().toISOString(), output: migrationOutput.slice(0, 4096) });
    progress('先重启 Runner，再只重启 C++ 后端');
    runnerCommand(['restart', RUNNER_UNIT]);
    run(PM2, ['restart', String(context.processBaseline.cpp.id)]);
    const services = await waitForServices(context);
    progress('原子切换多文件前端');
    activateFrontend({ current: FRONTEND_ROOT, staging, previous: path.join(backup, 'previous-frontend') });
    frontendActivated = true;
    progress('核验文件、迁移、服务、前端和受保护对象');
    const database = await verifyPublished(materials, context, services);
    record('success.json', { stage: 'multifile-update-complete', completedAt: new Date().toISOString(), services, database });
    console.log('C++ 多文件项目更新完成。');
    console.log('旧文件与操作记录保存在：' + backup);
  } catch (error) {
    const failure = { stage, code: safeCode(error.code), recovered: false, databaseReviewRequired: false };
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
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'MULTIFILE_UPDATE_FAILED';
}

function failureEvidence(error) {
  const locations = String(error.stack || '').split('\n').map(line => /(?:update|guard|migrate)\.mjs:\d+:\d+/.exec(line)?.[0]).filter(Boolean).slice(0, 8);
  return { stage, code: safeCode(error.code), locations, recovered: error.recovered === true, recoveryCode: error.recoveryCode || null, databaseReviewRequired: error.databaseReviewRequired === true };
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { interrupted = true; });

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
  console.error('C++ 多文件更新未完成；诊断：' + JSON.stringify(failureEvidence(error)));
  if (backup) console.error('备份目录：' + backup);
  process.exitCode = 1;
}
