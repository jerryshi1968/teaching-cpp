import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { assertBackendManifest, CURRENT_BACKEND_FILES, installBackendFiles, restoreBackendFiles, SOURCE_COMMIT, VERSION } from './guard.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const PRODUCTION_ROOT = '/var/www/teaching-cpp-backend';
const P5_ROOT = '/var/www/teaching-p5js-backend';
const FRONT = '/var/www/html/teaching-cpp';
const BACKUPS = PRODUCTION_ROOT + '/backups';
const NODE = PRODUCTION_ROOT + '/tools/node/bin/node';
const PM2 = '/usr/bin/pm2';
const CPP_NAME = 'teaching-cpp-backend';
const MATERIAL_FILES = ['README.md', 'backend-manifest.json', 'guard.mjs', 'package.mjs', 'update.mjs'];
const CURRENT_FRONTEND_FILES = [
  { path: 'index.html', sha256: '600cabe6fa6e76bdc3e869edf23db2355016c3b960d75f1c35d5570e1ef9a3d9', bytes: 730 },
  { path: 'assets/editor-CEb1qCln.js', sha256: 'a4f87f4e7e78487ae7c68129471f58fa0292f73b035260cb75a96e5fb7fe1ebb', bytes: 533408 },
  { path: 'assets/index-BAmvvGix.css', sha256: 'e558e389966b6733cfcc268268790f3c34d3d3901ab4fd8d38aeaa3195970258', bytes: 49548 },
  { path: 'assets/index-VtKVI9ll.js', sha256: '5eee2b93af4d82633c815f53f0ce91e9a89c9b7d199d76519b7a2a45fc7a36fa', bytes: 247045 }
];
const cliEnv = { HOME: '/root', PM2_HOME: '/root/.pm2', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };
let stage = '材料检查';
let backup;
let lastRequest;
let interrupted = false;
let replacementStarted = false;
let recovering = false;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function progress(message) {
  stage = message;
  console.log(new Date().toISOString() + ' ' + message);
  assert.ok(recovering || !interrupted, '操作被中断');
}

function run(command, arguments_, timeout = 30000) {
  try { return execFileSync(command, arguments_, { cwd: PRODUCTION_ROOT, env: cliEnv, timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { error.code ||= 'COMMAND_' + path.basename(command).toUpperCase() + '_' + (error.status ?? 'FAILED'); throw error; }
}

function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function read(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1, '拒绝非普通文件或链接文件');
  return fs.readFileSync(file);
}

function directory(dir) {
  const stat = fs.lstatSync(dir);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), '拒绝非目录或目录链接');
  assert.equal(fs.realpathSync(dir), dir, '目录真实路径与预期不符');
}

function record(name, value) {
  fs.writeFileSync(path.join(backup, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

function parseChecksums(file) {
  const lines = read(file).toString('utf8').trim().split(/\r?\n/).filter(Boolean);
  const entries = lines.map(line => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);
    assert.ok(match && !match[2].split('/').includes('..'), '校验清单格式不正确');
    return { sha256: match[1], path: match[2] };
  });
  assert.equal(new Set(entries.map(item => item.path)).size, entries.length, '校验清单路径重复');
  return entries;
}

function verifyChecksums(file, expectedPaths) {
  const entries = parseChecksums(file);
  assert.deepEqual(entries.map(item => item.path).sort(), [...expectedPaths].sort(), '校验清单文件集合不正确');
  for (const item of entries) assert.equal(sha256(read(path.join(PROJECT_ROOT, item.path))), item.sha256, item.path);
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

function inspectBackend(root, files, current = false) {
  for (const file of files) inspectFile(root, file, current ? 'currentSha256' : 'sha256', current ? 'currentBytes' : 'bytes');
}

export function verifyMaterials() {
  const materialPaths = MATERIAL_FILES.map(name => `deploy/${VERSION}/${name}`);
  verifyChecksums(path.join(import.meta.dirname, 'MATERIALS.sha256'), materialPaths);
  const manifest = assertBackendManifest(JSON.parse(read(path.join(import.meta.dirname, 'backend-manifest.json'))));
  const releaseFile = path.join(import.meta.dirname, 'RELEASE-FILES.sha256');
  const packaged = exists(releaseFile);
  const payloadRoot = packaged ? path.join(import.meta.dirname, 'payload') : PROJECT_ROOT;
  inspectBackend(payloadRoot, manifest.files);
  if (packaged) {
    const releasePaths = [
      ...materialPaths,
      `deploy/${VERSION}/MATERIALS.sha256`,
      ...manifest.files.map(file => `deploy/${VERSION}/payload/${file.path}`)
    ];
    verifyChecksums(releaseFile, releasePaths);
    const actual = collectFiles(import.meta.dirname).map(name => `deploy/${VERSION}/${name}`).sort();
    assert.deepEqual(actual, [...releasePaths, `deploy/${VERSION}/RELEASE-FILES.sha256`].sort(), '发布目录含有清单外文件');
  }
  return { manifest, packaged, payloadRoot };
}

function processList() {
  return JSON.parse(run(PM2, ['jlist']));
}

function processState(requireOnline = true) {
  const all = processList();
  assert.deepEqual(all.map(item => item.name).sort(), ['p5js-backend', CPP_NAME], 'PM2 列表与当前两个网站进程不符');
  const cpp = all.find(item => item.name === CPP_NAME);
  const p5 = all.find(item => item.name === 'p5js-backend');
  if (requireOnline) assert.equal(cpp.pm2_env.status, 'online');
  assert.equal(cpp.pm2_env.pm_cwd, PRODUCTION_ROOT);
  assert.equal(cpp.pm2_env.pm_exec_path, PRODUCTION_ROOT + '/backend/src/server.mjs');
  assert.equal(cpp.pm2_env.exec_mode, 'fork_mode');
  assert.equal(cpp.pm2_env.watch, false);
  assert.equal(Number(cpp.pm2_env.uid), 995);
  assert.equal(Number(cpp.pm2_env.gid), 992);
  assert.equal(cpp.pm2_env.NODE_ENV, 'production');
  assert.equal(cpp.pm2_env.APP_MODE, 'production');
  assert.equal(fs.realpathSync(cpp.pm2_env.exec_interpreter), fs.realpathSync(NODE));
  assert.equal(p5.pm2_env.status, 'online');
  assert.equal(p5.pm2_env.pm_cwd, P5_ROOT);
  assert.equal(p5.pm2_env.pm_exec_path, P5_ROOT + '/app.js');
  const summary = item => ({ id: item.pm_id, name: item.name, pid: item.pid, restarts: item.pm2_env.restart_time, status: item.pm2_env.status });
  return { cpp: summary(cpp), p5: summary(p5) };
}

function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  const status = read('/proc/' + pid + '/status').toString('utf8');
  for (const [label, expected] of [['Uid', 995], ['Gid', 992]]) {
    const values = new RegExp('^' + label + ':\\s+([0-9\\t ]+)$', 'm').exec(status)?.[1].trim().split(/\s+/).map(Number);
    assert.ok(values?.length === 4 && values.every(value => value === expected), `C++ 进程 ${label} 不符合预期`);
  }
  assert.equal(fs.realpathSync('/proc/' + pid + '/exe'), fs.realpathSync(NODE));
  const sockets = run('ss', ['-H', '-ltnp', 'sport = :5180']).toString('utf8').trim().split('\n').filter(Boolean);
  assert.equal(sockets.length, 1);
  assert.match(sockets[0], new RegExp(`127\\.0\\.0\\.1:5180.*pid=${pid},`));
}

function responseEvidence(resource, response) {
  const type = /^content-type:[ \t]*([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)/im.exec(response.header)?.[1] || null;
  return { path: resource, status: response.status, contentType: type, bytes: response.body.length, sha256: sha256(response.body) };
}

function https(resource) {
  lastRequest = { path: resource, completed: false };
  console.log('HTTPS 开始检查：' + resource);
  const buffer = run('curl', ['--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', '--include', 'https://tigao123.com' + resource]);
  const split = buffer.indexOf('\r\n\r\n');
  assert.ok(split > 0, '无法识别 HTTPS 响应');
  const header = buffer.subarray(0, split).toString('utf8');
  const status = /^HTTP\/1\.1 (\d{3}) /.exec(header);
  assert.ok(status, 'HTTPS 响应状态行无法识别');
  const response = { status: Number(status[1]), header, body: buffer.subarray(split + 4) };
  lastRequest = { ...responseEvidence(resource, response), completed: true };
  console.log('HTTPS 检查结果：' + JSON.stringify(lastRequest));
  return response;
}

async function localJson(resource, status = 200) {
  const response = await fetch('http://127.0.0.1:5180' + resource, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  assert.equal(response.status, status, resource);
  return response.json();
}

function assertConfig(config) {
  assert.equal(config.mode, 'production');
  assert.equal(config.writesEnabled, true);
  assert.equal(config.runEnabled, true);
}

async function cppHealthy() {
  const health = await localJson('/api/cpp/health');
  assert.equal(health.status, 'ok');
  assert.equal(health.mode, 'production');
  assert.equal(health.executionEnabled, true);
  assertConfig(await localJson('/api/cpp/config'));
  assert.equal((await localJson('/api/cpp/me', 401)).code, 'LOGIN_REQUIRED');
  const publicConfig = https('/api/cpp/config');
  assert.equal(publicConfig.status, 200);
  assertConfig(JSON.parse(publicConfig.body));
  assert.equal(https('/api/cpp/me').status, 401);
}

function frontendHealthy() {
  for (const file of CURRENT_FRONTEND_FILES) {
    inspectFile(FRONT, file);
    const response = https('/teaching-cpp/' + file.path);
    assert.equal(response.status, 200, file.path);
    assert.equal(sha256(response.body), file.sha256, file.path);
  }
}

function p5Healthy(expectedIndex) {
  const health = https('/api/health');
  assert.equal(health.status, 200);
  const body = JSON.parse(health.body);
  assert.equal(body.status, 'OK');
  assert.equal(body.db_check, 'Database Active');
  assert.equal(https('/api/auth/me').status, 401);
  const page = https('/teaching-p5js/index.html');
  assert.equal(page.status, 200);
  const digest = sha256(page.body);
  if (expectedIndex) assert.equal(digest, expectedIndex, '原 p5.js 首页响应发生变化');
  return digest;
}

function mainHealthy(expectedIndex) {
  const page = https('/index.html');
  assert.equal(page.status, 200);
  assert.deepEqual(page.body, read('/var/www/html/index.html'));
  const digest = sha256(page.body);
  if (expectedIndex) assert.equal(digest, expectedIndex, '主站首页响应发生变化');
  return digest;
}

function protectedFiles() {
  const files = [
    PRODUCTION_ROOT + '/.env',
    PRODUCTION_ROOT + '/backend/package.json',
    PRODUCTION_ROOT + '/package-lock.json',
    '/etc/httpd/conf.d/tigao123-le-ssl.conf',
    '/etc/httpd/conf.d/tigao123.conf',
    '/var/www/html/.htaccess',
    '/root/.pm2/dump.pm2'
  ];
  for (const entry of fs.readdirSync(PRODUCTION_ROOT + '/backend/src', { withFileTypes: true })) {
    const file = 'backend/src/' + entry.name;
    if (entry.isFile() && !CURRENT_BACKEND_FILES.some(item => item.path === file)) files.push(PRODUCTION_ROOT + '/' + file);
  }
  for (const file of CURRENT_FRONTEND_FILES) files.push(FRONT + '/' + file.path);
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
  progress('只读预检：后端源码基线、语法、进程、接口及两个网站');
  requireProductionPlatform();
  assert.equal(PROJECT_ROOT, PRODUCTION_ROOT);
  assert.equal(fs.realpathSync(import.meta.dirname), PRODUCTION_ROOT + '/deploy/' + VERSION);
  assert.equal(materials.packaged, true, '必须从固定发布包运行');
  for (const dir of [PRODUCTION_ROOT, BACKUPS, PRODUCTION_ROOT + '/backend/src', FRONT, import.meta.dirname]) directory(dir);
  assert.equal(fs.statSync(BACKUPS).uid, 0);
  assert.equal(fs.statSync(BACKUPS).mode & 0o777, 0o700);
  assert.equal(exists(BACKUPS + '/' + VERSION + '.lock'), false, '本版本已经开始执行，禁止重跑');
  inspectBackend(PRODUCTION_ROOT, materials.manifest.files, true);
  inspectBackend(materials.payloadRoot, materials.manifest.files);
  for (const file of materials.manifest.files) run(NODE, ['--check', path.join(materials.payloadRoot, ...file.path.split('/'))]);
  const processBaseline = processState();
  processIdentity(processBaseline.cpp.pid);
  await cppHealthy();
  const protectedState = protectedFiles();
  frontendHealthy();
  const p5Index = p5Healthy();
  const mainIndex = mainHealthy();
  assert.ok(fs.statfsSync(PRODUCTION_ROOT).bavail * fs.statfsSync(PRODUCTION_ROOT).bsize > 512 * 1024 * 1024, '磁盘余量不足');
  verifyProtected(protectedState);
  assert.deepEqual(processState(), processBaseline);
  return { processBaseline, protectedState, p5Index, mainIndex };
}

async function ready(previous) {
  const deadline = Date.now() + 25000;
  let current;
  while (Date.now() < deadline) {
    assert.ok(!interrupted, '操作被中断');
    try {
      current = processState();
      if (current.cpp.status === 'online' && current.cpp.pid !== previous.cpp.pid && current.cpp.restarts === previous.cpp.restarts + 1) {
        await localJson('/api/cpp/config');
        break;
      }
    } catch { current = null; }
    await delay(500);
  }
  assert.ok(current, 'C++ 后端重启超时');
  await delay(2000);
  const stable = processState();
  assert.deepEqual(stable, current, 'C++ 后端重启后状态不稳定');
  processIdentity(stable.cpp.pid);
  return stable;
}

async function recover(materials, context, failure) {
  try {
    recovering = true;
    progress('恢复处理：还原两个后端源码文件并只重启 C++ 后端');
    restoreBackendFiles({ root: PRODUCTION_ROOT, backupRoot: backup, manifest: materials.manifest });
    inspectBackend(PRODUCTION_ROOT, materials.manifest.files, true);
    const beforeRecovery = processState(false);
    assert.equal(beforeRecovery.cpp.id, context.processBaseline.cpp.id);
    assert.deepEqual(beforeRecovery.p5, context.processBaseline.p5);
    run(PM2, ['restart', String(beforeRecovery.cpp.id)]);
    const deadline = Date.now() + 25000;
    let restored;
    while (Date.now() < deadline) {
      try {
        restored = processState();
        if (restored.cpp.pid !== beforeRecovery.cpp.pid && restored.cpp.restarts === beforeRecovery.cpp.restarts + 1) {
          await cppHealthy();
          break;
        }
      } catch { restored = null; }
      await delay(500);
    }
    assert.ok(restored, '恢复旧后端后重启超时');
    assert.deepEqual(restored.p5, context.processBaseline.p5);
    frontendHealthy();
    p5Healthy(context.p5Index);
    mainHealthy(context.mainIndex);
    verifyProtected(context.protectedState);
    record('recovery.json', { stage: 'backend-restored', restoredAt: new Date().toISOString() });
    failure.recovered = true;
  } catch (recoveryError) {
    failure.recoveryCode = failureEvidence(recoveryError).code;
  }
}

async function publish(materials) {
  const context = await preflight(materials);
  process.umask(0o077);
  progress('预检通过，建立一次性锁和私有备份目录');
  const lock = BACKUPS + '/' + VERSION + '.lock';
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ version: VERSION, sourceCommit: SOURCE_COMMIT, startedAt: new Date().toISOString() }) + '\n');
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  backup = fs.mkdtempSync(BACKUPS + '/' + VERSION + '-');
  fs.chmodSync(backup, 0o700);
  record('before.json', { stage: 'preflight-complete', version: VERSION, sourceCommit: SOURCE_COMMIT, processes: context.processBaseline });
  try {
    progress('备份并原子替换两个 C++ 后端源码文件');
    installBackendFiles({ root: PRODUCTION_ROOT, payloadRoot: materials.payloadRoot, backupRoot: backup, manifest: materials.manifest, onPrepared: () => { replacementStarted = true; } });
    inspectBackend(PRODUCTION_ROOT, materials.manifest.files);
    inspectBackend(path.join(backup, 'previous-backend'), materials.manifest.files.map(file => ({ ...file, sha256: file.currentSha256, bytes: file.currentBytes })));
    record('replaced.json', { stage: 'backend-files-replaced', files: materials.manifest.files.map(file => ({ path: file.path, sha256: file.sha256 })) });
    progress('只重启 teaching-cpp-backend，加载新增排序与跨组移动接口');
    const current = processState();
    assert.deepEqual(current, context.processBaseline, '替换源码前后进程发生意外变化');
    run(PM2, ['restart', String(current.cpp.id)]);
    const restarted = await ready(context.processBaseline);
    progress('验证 C++ API、静态前端、原 p5.js、主站和未涉及文件');
    await cppHealthy();
    assert.deepEqual(restarted.p5, context.processBaseline.p5);
    frontendHealthy();
    p5Healthy(context.p5Index);
    mainHealthy(context.mainIndex);
    verifyProtected(context.protectedState);
    inspectBackend(PRODUCTION_ROOT, materials.manifest.files);
    record('result.json', { stage: 'backend-organizer-api-updated', version: VERSION, sourceCommit: SOURCE_COMMIT, cpp: restarted.cpp, p5Restarted: false, frontendChanged: false, apacheChanged: false, environmentChanged: false, databaseMigrationPerformed: false, completedAt: new Date().toISOString() });
    progress('C++ 后端接口更新完成：未修改数据库结构、配置、前端或 p5.js');
    replacementStarted = false;
    console.log('旧后端源码保存在私有备份目录：' + path.join(backup, 'previous-backend'));
    console.log('备份目录：' + backup);
  } catch (error) {
    if (replacementStarted && backup) await recover(materials, context, error);
    throw error;
  }
}

function failureEvidence(error) {
  const locations = [];
  for (const line of String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line))) {
    const location = /[\/\\]((?:update|guard)\.mjs:\d+:\d+)\)?$/.exec(line)?.[1];
    if (location && !locations.includes(location)) locations.push(location);
    if (locations.length >= 4) break;
  }
  return { code: typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'BACKEND_UPDATE_FAILED', locations };
}

async function main() {
  process.on('SIGINT', () => { interrupted = true; });
  process.on('SIGTERM', () => { interrupted = true; });
  const args = process.argv.slice(2);
  try {
    const materials = verifyMaterials();
    if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
      console.log('后端接口更新包材料检查通过；未读取生产配置、未连接服务、未修改文件。');
    } else if (args.length === 1 && args[0] === '--preflight') {
      await preflight(materials);
      console.log('生产后端接口更新只读预检通过；未建立锁、备份或修改任何文件和服务。');
    } else {
      assert.deepEqual(args, ['--publish']);
      await publish(materials);
    }
  } catch (error) {
    const failure = { stage, ...failureEvidence(error), lastRequest, recovered: error.recovered === true, recoveryCode: error.recoveryCode || null };
    console.error('后端接口更新未完成；诊断：' + JSON.stringify(failure));
    if (backup) {
      try { fs.writeFileSync(path.join(backup, 'failure.json'), JSON.stringify(failure, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); } catch {}
      console.error('备份目录：' + backup);
    }
    if (error.recovered === true) console.error('已恢复更新前的后端源码并重启 C++ 后端；不要重跑本版本，请发回完整输出。');
    else if (error.recoveryCode) console.error('无法确认自动恢复完成；不要重跑、删除目录或重启服务，请立即发回完整输出。');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
