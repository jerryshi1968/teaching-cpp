import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { activateFrontend, assertFrontendManifest, assertProductionConfig, assertSourceManifest, CURRENT_FRONTEND_FILES, restoreFrontend, SOURCE_COMMIT, VERSION } from './guard.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const PRODUCTION_ROOT = '/var/www/teaching-cpp-backend';
const FRONT = '/var/www/html/teaching-cpp';
const BACKUPS = PRODUCTION_ROOT + '/backups';
const SSL = '/etc/httpd/conf.d/tigao123-le-ssl.conf';
const HTTP = '/etc/httpd/conf.d/tigao123.conf';
const MAIN_RULES = '/var/www/html/.htaccess';
const OLD_RELEASE = PRODUCTION_ROOT + '/deploy/web-publish-20260831-02';
const OLD_SITE_SHA256 = 'f4e771b36cfdb7320ca9f32a3df74c613c8a58d4069b0a21b868051a6556581c';
const OLD_MANIFEST_SHA256 = '56d878ee70c69bd53ce9dbb14f193a28e3244ff547937c53248e24f00999b942';
const INCLUDE = 'Include "/var/www/teaching-cpp-backend/deploy/web-publish-20260831-02/site.conf"';
const PM2 = '/usr/bin/pm2';
const MATERIAL_FILES = ['README.md', 'frontend-manifest.json', 'guard.mjs', 'package.mjs', 'source-manifest.json', 'update.mjs'];
const cliEnv = { HOME: '/root', PM2_HOME: '/root/.pm2', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };
let stage = '材料检查';
let backup;
let lastRequest;
let interrupted = false;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function progress(message) {
  stage = message;
  console.log(new Date().toISOString() + ' ' + message);
  assert.ok(!interrupted, '操作被中断');
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
  fs.writeFileSync(path.join(backup, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
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

function inspectFile(root, file) {
  const bytes = read(path.join(root, file.path));
  assert.equal(bytes.length, file.bytes, file.path);
  assert.equal(sha256(bytes), file.sha256, file.path);
}

function inspectFrontend(root, files) {
  directory(root);
  directory(path.join(root, 'assets'));
  assert.deepEqual(fs.readdirSync(root).sort(), ['assets', 'index.html']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets')).sort(), files.filter(file => file.path.startsWith('assets/')).map(file => path.basename(file.path)).sort());
  for (const file of files) inspectFile(root, file);
}

export function verifyMaterials() {
  const materialPaths = MATERIAL_FILES.map(name => `deploy/${VERSION}/${name}`);
  verifyChecksums(path.join(import.meta.dirname, 'MATERIALS.sha256'), materialPaths);
  const frontend = assertFrontendManifest(JSON.parse(read(path.join(import.meta.dirname, 'frontend-manifest.json'))));
  const source = assertSourceManifest(JSON.parse(read(path.join(import.meta.dirname, 'source-manifest.json'))));
  const releaseFile = path.join(import.meta.dirname, 'RELEASE-FILES.sha256');
  const packaged = exists(releaseFile);
  const payloadRoot = packaged ? path.join(import.meta.dirname, 'payload') : path.join(PROJECT_ROOT, 'frontend/dist');
  const sourceRoot = packaged ? path.join(import.meta.dirname, 'source') : PROJECT_ROOT;
  inspectFrontend(payloadRoot, frontend.files);
  for (const file of source.files) inspectFile(sourceRoot, file);
  if (packaged) {
    const releasePaths = [
      ...materialPaths,
      `deploy/${VERSION}/MATERIALS.sha256`,
      ...frontend.files.map(file => `deploy/${VERSION}/payload/${file.path}`),
      ...source.files.map(file => `deploy/${VERSION}/source/${file.path}`)
    ];
    verifyChecksums(releaseFile, releasePaths);
    const actual = collectFiles(import.meta.dirname).map(name => `deploy/${VERSION}/${name}`).sort();
    assert.deepEqual(actual, [...releasePaths, `deploy/${VERSION}/RELEASE-FILES.sha256`].sort(), '发布目录含有清单外文件');
  }
  return { frontend, source, packaged };
}

function processes() {
  const all = JSON.parse(run(PM2, ['jlist']));
  assert.deepEqual(all.map(item => item.name).sort(), ['p5js-backend', 'teaching-cpp-backend'], 'PM2 列表与当前两个网站进程不符');
  return all.map(item => {
    assert.equal(item.pm2_env.status, 'online', item.name);
    if (item.name === 'teaching-cpp-backend') {
      assert.equal(Number(item.pm2_env.uid), 995);
      assert.equal(Number(item.pm2_env.gid), 992);
      assert.equal(item.pm2_env.pm_exec_path, PRODUCTION_ROOT + '/backend/src/server.mjs');
    } else assert.equal(item.pm2_env.pm_exec_path, '/var/www/teaching-p5js-backend/app.js');
    return { name: item.name, pid: item.pid, restarts: item.pm2_env.restart_time };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function directCppConfig(processBaseline) {
  const response = await fetch('http://127.0.0.1:5180/api/cpp/config', { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, 'C++ 后端配置接口不可用');
  assertProductionConfig(await response.json());
  assert.deepEqual(processes(), processBaseline, '网站后端进程发生重启或变化');
}

function responseEvidence(resource, response) {
  const type = /^content-type:[ \t]*([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)/im.exec(response.header)?.[1] || null;
  return { path: /^\/[A-Za-z0-9_./-]*$/.test(resource) ? resource : '[omitted]', status: response.status, contentType: type, bytes: response.body.length, sha256: sha256(response.body) };
}

function failureEvidence(error) {
  const locations = [];
  for (const line of String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line))) {
    const location = /[\/\\]((?:update|guard)\.mjs:\d+:\d+)\)?$/.exec(line)?.[1];
    if (location && !locations.includes(location)) locations.push(location);
    if (locations.length >= 4) break;
  }
  return { code: typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'FRONTEND_UPDATE_FAILED', locations };
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

function verifyHttpsFrontend(files) {
  for (const file of files) {
    const response = https('/teaching-cpp/' + file.path);
    assert.equal(response.status, 200, file.path);
    assert.equal(sha256(response.body), file.sha256, file.path);
    const mime = file.path.endsWith('.js') ? /content-type:[ \t]*(application|text)\/javascript/i : file.path.endsWith('.css') ? /content-type:[ \t]*text\/css/i : /content-type:[ \t]*text\/html/i;
    assert.match(response.header, mime, file.path);
    assert.match(response.header, /x-content-type-options:[ \t]*nosniff/i, file.path);
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
  if (expectedIndex) assert.equal(sha256(page.body), expectedIndex, '原 p5.js 首页响应发生变化');
  return sha256(page.body);
}

function mainHealthy(expectedIndex, expectedRules) {
  const page = https('/index.html');
  assert.equal(page.status, 200);
  assert.match(page.header, /content-type:[ \t]*text\/html/i);
  assert.deepEqual(page.body, read('/var/www/html/index.html'));
  if (expectedIndex) assert.equal(sha256(page.body), expectedIndex, '主站首页响应发生变化');
  for (const resource of ['/', '/__cpp_frontend_update_probe']) {
    const response = https(resource);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, page.body);
  }
  if (expectedRules) assert.deepEqual(read(MAIN_RULES), expectedRules, '主站 .htaccess 发生变化');
  return sha256(page.body);
}

function protectedFiles() {
  return new Map([PRODUCTION_ROOT + '/.env', SSL, HTTP, MAIN_RULES, OLD_RELEASE + '/site.conf', OLD_RELEASE + '/frontend-manifest.json'].map(file => [file, sha256(read(file))]));
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
  progress('只读预检：发布材料、当前前端、网站配置和进程');
  requireProductionPlatform();
  assert.equal(PROJECT_ROOT, PRODUCTION_ROOT);
  assert.equal(fs.realpathSync(import.meta.dirname), PRODUCTION_ROOT + '/deploy/' + VERSION);
  assert.equal(materials.packaged, true, '必须从固定发布包运行');
  for (const dir of [PRODUCTION_ROOT, BACKUPS, '/var/www/html', FRONT, import.meta.dirname]) directory(dir);
  assert.equal(fs.statSync(BACKUPS).uid, 0);
  assert.equal(fs.statSync(BACKUPS).mode & 0o777, 0o700);
  assert.equal(fs.statSync(BACKUPS).dev, fs.statSync('/var/www/html').dev, '前端和备份目录不在同一文件系统，不能原子切换');
  assert.equal(exists(BACKUPS + '/' + VERSION + '.lock'), false, '本版本已经开始执行，禁止重跑');
  assert.equal(sha256(read(OLD_RELEASE + '/site.conf')), OLD_SITE_SHA256, '现有 C++ Apache 片段与已发布版本不同');
  assert.equal(sha256(read(OLD_RELEASE + '/frontend-manifest.json')), OLD_MANIFEST_SHA256, '现有前端基线清单不同');
  const sslText = read(SSL).toString('utf8');
  assert.equal(sslText.split(INCLUDE).length - 1, 1, '现有 HTTPS 配置没有唯一引用已发布的 C++ 片段');
  run('httpd', ['-t']);
  const oldManifest = { files: CURRENT_FRONTEND_FILES };
  inspectFrontend(FRONT, oldManifest.files);
  const processBaseline = processes();
  await directCppConfig(processBaseline);
  const protectedState = protectedFiles();
  const mainRules = read(MAIN_RULES);
  const p5Index = p5Healthy();
  const mainIndex = mainHealthy(null, mainRules);
  const publicConfig = https('/api/cpp/config');
  assert.equal(publicConfig.status, 200);
  assertProductionConfig(JSON.parse(publicConfig.body));
  assert.equal(https('/api/cpp/me').status, 401);
  verifyHttpsFrontend(oldManifest.files);
  assert.ok(fs.statfsSync(PRODUCTION_ROOT).bavail * fs.statfsSync(PRODUCTION_ROOT).bsize > 512 * 1024 * 1024, '磁盘余量不足');
  verifyProtected(protectedState);
  assert.deepEqual(processes(), processBaseline);
  return { oldManifest, processBaseline, protectedState, mainRules, p5Index, mainIndex };
}

async function publish(materials) {
  const context = await preflight(materials);
  process.umask(0o077);
  progress('预检通过，建立本版本一次性锁和私有备份目录');
  const lock = BACKUPS + '/' + VERSION + '.lock';
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ version: VERSION, sourceCommit: SOURCE_COMMIT, startedAt: new Date().toISOString() }) + '\n');
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  backup = fs.mkdtempSync(BACKUPS + '/' + VERSION + '-');
  fs.chmodSync(backup, 0o700);
  record('state.json', { stage: 'preflight-complete', version: VERSION, sourceCommit: SOURCE_COMMIT });
  const staging = backup + '/frontend-staging';
  fs.mkdirSync(staging, { mode: 0o755 });
  fs.mkdirSync(staging + '/assets', { mode: 0o755 });
  for (const file of materials.frontend.files) {
    const destination = path.join(staging, file.path);
    fs.copyFileSync(path.join(import.meta.dirname, 'payload', file.path), destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o644);
  }
  inspectFrontend(staging, materials.frontend.files);
  const previous = backup + '/previous-frontend';
  const failed = backup + '/failed-frontend';
  let swapped = false;
  try {
    progress('备份现有静态前端并原子切换到新版本');
    activateFrontend({ current: FRONT, staging, previous });
    swapped = true;
    record('state.json', { stage: 'frontend-swapped', version: VERSION, sourceCommit: SOURCE_COMMIT });
    progress('验证新前端、深路径、C++ API、原 p5.js、主站和进程未变化');
    inspectFrontend(FRONT, materials.frontend.files);
    verifyHttpsFrontend(materials.frontend.files);
    const indexHash = materials.frontend.files.find(file => file.path === 'index.html').sha256;
    const page = https('/teaching-cpp/');
    assert.equal(page.status, 200);
    assert.equal(sha256(page.body), indexHash);
    assert.match(page.header, /content-security-policy:[^\r\n]*frame-ancestors 'none'/i);
    const route = https('/teaching-cpp/__organizer_route_probe');
    assert.equal(route.status, 200);
    assert.equal(sha256(route.body), indexHash);
    assert.equal(https('/teaching-cpp/assets/__missing.js').status, 404);
    assert.ok([403, 404].includes(https('/teaching-cpp/.env').status));
    const publicConfig = https('/api/cpp/config');
    assert.equal(publicConfig.status, 200);
    assertProductionConfig(JSON.parse(publicConfig.body));
    assert.equal(https('/api/cpp/me').status, 401);
    await directCppConfig(context.processBaseline);
    p5Healthy(context.p5Index);
    mainHealthy(context.mainIndex, context.mainRules);
    verifyProtected(context.protectedState);
    assert.deepEqual(processes(), context.processBaseline);
    inspectFrontend(previous, context.oldManifest.files);
    progress('C++ 前端更新完成：共享作品管理已发布，配置、数据库和服务均未修改');
    record('state.json', { stage: 'frontend-updated', version: VERSION, sourceCommit: SOURCE_COMMIT, writesEnabled: true, runEnabled: true, apacheChanged: false, backendRestarted: false, runnerRestarted: false, completedAt: new Date().toISOString() });
    swapped = false;
    console.log('旧前端保存在私有备份目录：' + previous);
    console.log('备份目录：' + backup);
  } catch (error) {
    if (swapped) {
      try {
        restoreFrontend({ current: FRONT, previous, failed });
        swapped = false;
        inspectFrontend(FRONT, context.oldManifest.files);
        verifyHttpsFrontend(context.oldManifest.files);
        await directCppConfig(context.processBaseline);
        p5Healthy(context.p5Index);
        mainHealthy(context.mainIndex, context.mainRules);
        verifyProtected(context.protectedState);
        record('state.json', { stage: 'frontend-restored', version: VERSION, sourceCommit: SOURCE_COMMIT, recoveredAt: new Date().toISOString() });
        error.recovered = true;
      } catch (recoveryError) {
        error.recoveryCode = failureEvidence(recoveryError).code;
      }
    }
    throw error;
  }
}

async function main() {
  process.on('SIGINT', () => { interrupted = true; });
  process.on('SIGTERM', () => { interrupted = true; });
  const args = process.argv.slice(2);
  try {
    const materials = verifyMaterials();
    if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
      console.log('前端更新包材料检查通过；未读取生产配置、未连接服务、未修改文件。');
    } else if (args.length === 1 && args[0] === '--preflight') {
      await preflight(materials);
      console.log('生产前端更新只读预检通过；未建立锁、备份或修改任何文件和服务。');
    } else {
      assert.deepEqual(args, ['--publish']);
      await publish(materials);
    }
  } catch (error) {
    const failure = { stage, ...failureEvidence(error), lastRequest, recovered: error.recovered === true, recoveryCode: error.recoveryCode || null };
    console.error('前端更新未完成；诊断：' + JSON.stringify(failure));
    if (backup) {
      try { record('failure.json', failure); } catch {}
      console.error('备份目录：' + backup);
    }
    if (error.recovered === true) console.error('已恢复更新前的静态前端；不要重跑本版本，请发回完整输出。');
    else if (error.recoveryCode) console.error('无法确认自动恢复完成；不要重跑、删除目录或重启服务，请立即发回完整输出。');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
