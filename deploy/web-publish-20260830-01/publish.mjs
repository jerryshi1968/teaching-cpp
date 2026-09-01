import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import { sha256 } from '../production-20260830-01/safety.mjs';
import { insertInclude, INCLUDE } from './patch.mjs';

// 本步骤只发布四个前端文件、插入 Apache 引用并保存现有 PM2 列表，不开放写入或执行。
const ROOT = '/var/www/teaching-cpp-backend';
const FRONT = '/var/www/html/teaching-cpp';
const SSL = '/etc/httpd/conf.d/tigao123-le-ssl.conf';
const HTTP = '/etc/httpd/conf.d/tigao123.conf';
const VERSION = 'web-publish-20260830-01';
const PM2 = '/usr/bin/pm2';
const cliEnv = { HOME: '/root', PM2_HOME: '/root/.pm2', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' };
const args = process.argv.slice(2);
let stage = '材料检查';
let backup;
let original;
let candidate;
let frontPublished = false;
let apacheChanged = false;
let pm2Saved = false;
let processBaseline;
let oldIndex;
let interrupted = false;
let files;
let environmentHash;
process.on('SIGINT', () => { interrupted = true; });
process.on('SIGTERM', () => { interrupted = true; });
function progress(message) {
  stage = message;
  console.log(new Date().toISOString() + ' ' + message);
  assert.ok(!interrupted, '操作被中断');
}
function run(command, arguments_) {
  try { return execFileSync(command, arguments_, { cwd: ROOT, env: cliEnv, timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
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
  assert.ok(fs.lstatSync(dir).isDirectory()); assert.equal(fs.realpathSync(dir), dir);
}
function record(name, value) {
  fs.writeFileSync(path.join(backup, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
function material() {
  const manifest = JSON.parse(read(path.join(import.meta.dirname, 'frontend-manifest.json')));
  assert.equal(manifest.files.length, 4);
  assert.equal(manifest.files.filter(file => file.path === 'index.html').length, 1);
  assert.equal(manifest.files.filter(file => /^assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(file.path)).length, 3);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, 4);
  for (const file of manifest.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  const localRoot = path.resolve(import.meta.dirname, '../..');
  for (const file of manifest.files) assert.equal(sha256(read(path.join(localRoot, 'frontend/dist', file.path))), file.sha256);
  const fragment = read(path.join(import.meta.dirname, 'site.conf')).toString('utf8');
  assert.ok(fragment.includes('http://127.0.0.1:5180/api/cpp/'));
  assert.ok(!fragment.includes('ProxyPass "/api/"'));
  return manifest.files;
}
function processes() {
  const all = JSON.parse(run(PM2, ['jlist']));
  assert.deepEqual(all.map(item => item.name).sort(), ['p5js-backend', 'teaching-cpp-backend'], 'PM2 列表与已核验的两个进程不同');
  const result = all.map(item => {
    assert.equal(item.pm2_env.status, 'online');
    if (item.name === 'teaching-cpp-backend') {
      assert.equal(Number(item.pm2_env.uid), 995); assert.equal(Number(item.pm2_env.gid), 992);
      assert.equal(item.pm2_env.pm_exec_path, ROOT + '/backend/src/server.mjs');
    } else assert.equal(item.pm2_env.pm_exec_path, '/var/www/teaching-p5js-backend/app.js');
    return { name: item.name, pid: item.pid, restarts: item.pm2_env.restart_time };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { all, result };
}
async function backend() {
  const response = await fetch('http://127.0.0.1:5180/api/cpp/config', { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.mode, 'production'); assert.equal(config.writesEnabled, false); assert.equal(config.runEnabled, false);
  assert.equal(sha256(read(ROOT + '/.env')), environmentHash, '.env 在本步骤中发生变化');
  if (processBaseline) assert.deepEqual(processes().result, processBaseline, '现有后端进程发生重启或变化');
}
function https(resource) {
  const buffer = run('curl', ['--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '15', '--include', 'https://tigao123.com' + resource]);
  const split = buffer.indexOf('\r\n\r\n');
  assert.ok(split > 0, '无法识别 HTTPS 响应');
  const header = buffer.subarray(0, split).toString('utf8');
  const status = /^HTTP\/1\.1 (\d{3}) /.exec(header);
  assert.ok(status);
  return { status: Number(status[1]), header, body: buffer.subarray(split + 4) };
}
function p5Healthy() {
  const health = https('/api/health');
  assert.equal(health.status, 200);
  const body = JSON.parse(health.body);
  assert.equal(body.status, 'OK'); assert.equal(body.db_check, 'Database Active');
  assert.equal(https('/api/auth/me').status, 401);
  const page = https('/teaching-p5js/index.html');
  assert.equal(page.status, 200);
  if (oldIndex) assert.equal(sha256(page.body), oldIndex, '原 p5.js 首页响应发生变化');
  return sha256(page.body);
}
function inspectFront(root) {
  directory(root); directory(path.join(root, 'assets'));
  assert.deepEqual(fs.readdirSync(root).sort(), ['assets', 'index.html']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets')).sort(), files.filter(file => file.path.startsWith('assets/')).map(file => path.basename(file.path)).sort());
  for (const file of files) assert.equal(sha256(read(path.join(root, file.path))), file.sha256, '前端文件版本变化');
}
function replaceApache(bytes, expected) {
  assert.deepEqual(read(SSL), expected, 'Apache 配置被其他操作修改，拒绝覆盖');
  const temporary = path.join(path.dirname(SSL), '.tigao123-cpp-' + process.pid + '.tmp');
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  try {
    run('cp', ['--attributes-only', '--preserve=all', '--', SSL, temporary]);
    fs.renameSync(temporary, SSL);
  } finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
function syntax() { run('httpd', ['-t']); }

async function publish() {
  progress('发布前检查：现有服务、正式发布记录、前端和 Apache 配置');
  assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
  process.umask(0o077);
  assert.equal(fs.realpathSync(import.meta.dirname), ROOT + '/deploy/' + VERSION);
  for (const dir of [ROOT, ROOT + '/backups', '/var/www/html', '/etc/httpd/conf.d']) directory(dir);
  assert.equal(fs.statSync(ROOT + '/backups').uid, 0); assert.equal(fs.statSync(ROOT + '/backups').mode & 0o777, 0o700);
  assert.equal(exists(FRONT), false, '前端目标目录已经存在，禁止覆盖');
  for (const manifest of ['backups/useradd-fix-NoMZXnat/DEPLOYMENT-FILES.after.sha256', 'deploy/' + VERSION + '/WEB-FILES.sha256', 'deploy/backend-start-20260830-01/START-FILES.sha256', 'deploy/production-20260830-01/PUBLISH-FILES.sha256']) run('sha256sum', ['--quiet', '-c', manifest]);
  assert.equal(JSON.parse(read(ROOT + '/backups/backend-start-20260830-01-result.json')).stage, 'backend-readonly-online');
  const envFile = read(ROOT + '/.env');
  environmentHash = sha256(envFile);
  const env = dotenv.parse(envFile);
  assert.equal(env.APP_MODE, 'production'); assert.equal(env.CPP_PRODUCTION_WRITES, 'disabled'); assert.equal(env.CPP_RUN_ENABLED, 'false');
  const daemon = Number(read('/root/.pm2/pm2.pid').toString('utf8').trim());
  assert.ok(Number.isSafeInteger(daemon) && daemon > 1); process.kill(daemon, 0);
  processBaseline = processes().result;
  await backend();
  assert.equal(run('systemctl', ['is-active', 'httpd']).toString().trim(), 'active');
  syntax();
  const modules = run('httpd', ['-M']).toString('utf8');
  for (const module of ['proxy_module', 'proxy_http_module', 'ssl_module', 'dir_module', 'headers_module', 'mime_module', 'authz_core_module']) assert.ok(modules.includes(module), 'Apache 缺少所需模块：' + module);
  original = read(SSL);
  const archive = ROOT + '/backups/first-publish-xoptT8/site-files.tar.gz';
  assert.deepEqual(original, run('tar', ['-xOf', archive, 'etc/httpd/conf.d/tigao123-le-ssl.conf']), 'Apache HTTPS 配置与已审查备份不同');
  assert.deepEqual(read(HTTP), run('tar', ['-xOf', archive, 'etc/httpd/conf.d/tigao123.conf']), 'Apache HTTP 配置与已审查备份不同');
  candidate = Buffer.from(insertInclude(original.toString('utf8')));
  oldIndex = p5Healthy();
  assert.ok([403, 404].includes(https('/teaching-cpp/').status), 'C++ 公网入口已存在，不自动替换');
  assert.ok(fs.statfsSync(ROOT).bavail * fs.statfsSync(ROOT).bsize > 1024 * 1024 * 1024);

  backup = fs.mkdtempSync(ROOT + '/backups/web-publish-');
  console.log('本次备份目录：' + backup);
  run('cp', ['--preserve=all', '--', SSL, backup + '/tigao123-le-ssl.conf']);
  run('cp', ['--preserve=all', '--', HTTP, backup + '/tigao123.conf']);
  record('pm2-before.json', processes().all);
  for (const name of ['dump.pm2', 'dump.pm2.bak']) if (exists('/root/.pm2/' + name)) run('cp', ['--preserve=all', '--', '/root/.pm2/' + name, backup + '/' + name]);
  record('state.json', { stage: 'backed-up', writesEnabled: false, runEnabled: false });
  fs.writeFileSync(backup + '/SHA256SUMS', fs.readdirSync(backup).filter(name => name !== 'state.json').sort().map(name => sha256(read(path.join(backup, name))) + '  ' + name + '\n').join(''), { mode: 0o600 });
  execFileSync('sha256sum', ['--quiet', '-c', 'SHA256SUMS'], { cwd: backup, env: cliEnv, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });

  progress('备份后保存两个已验证的 PM2 进程，不重启进程');
  run(PM2, ['save']);
  pm2Saved = true;
  const saved = JSON.parse(read('/root/.pm2/dump.pm2'));
  assert.deepEqual(saved.map(item => item.name).sort(), ['p5js-backend', 'teaching-cpp-backend']);
  const savedCpp = saved.find(item => item.name === 'teaching-cpp-backend');
  assert.equal(Number(savedCpp.uid), 995); assert.equal(fs.realpathSync(savedCpp.exec_interpreter), fs.realpathSync(ROOT + '/tools/node/bin/node'));
  record('pm2-saved.json', saved);
  const units = run('systemctl', ['list-unit-files', '--no-legend', '--no-pager', 'pm2*.service']).toString('utf8');
  fs.writeFileSync(backup + '/pm2-unit-files.txt', units, { mode: 0o600 });
  console.log('PM2 进程列表已保存；未安装或修改 systemd 开机服务。');
  console.log('现有 PM2 开机单元：\n' + (units.trim() || '未发现，需后续配置开机恢复。'));

  progress('准备四个公开前端文件，加入 Apache 独立配置引用');
  const staging = backup + '/frontend-staging';
  fs.mkdirSync(staging, { mode: 0o755 }); fs.chmodSync(staging, 0o755);
  fs.mkdirSync(staging + '/assets', { mode: 0o755 }); fs.chmodSync(staging + '/assets', 0o755);
  for (const file of files) {
    fs.copyFileSync(path.join(ROOT, 'frontend/dist', file.path), path.join(staging, file.path), fs.constants.COPYFILE_EXCL);
    fs.chmodSync(path.join(staging, file.path), 0o644);
  }
  inspectFront(staging);
  assert.equal(exists(FRONT), false);
  fs.renameSync(staging, FRONT); frontPublished = true;
  replaceApache(candidate, original); apacheChanged = true;
  syntax();
  progress('Apache 语法通过，平滑加载配置并验证 HTTPS 路由');
  run('systemctl', ['reload', 'httpd']);
  assert.equal(run('systemctl', ['is-active', 'httpd']).toString().trim(), 'active');
  await delay(500);
  const configResponse = https('/api/cpp/config');
  assert.equal(configResponse.status, 200, 'HTTPS 的 /api/cpp/config 未返回 200');
  const settings = JSON.parse(configResponse.body);
  assert.equal(settings.mode, 'production'); assert.equal(settings.writesEnabled, false); assert.equal(settings.runEnabled, false);
  assert.equal(https('/api/cpp/me').status, 401, 'C++ 未登录接口没有按预期拒绝访问');
  for (const file of files) {
    const response = https('/teaching-cpp/' + file.path);
    assert.equal(response.status, 200, '前端资源未返回 200：' + file.path);
    assert.equal(sha256(response.body), file.sha256, 'HTTPS 返回的前端资源内容不同：' + file.path);
    const mime = file.path.endsWith('.js') ? /content-type:[ \t]*(application|text)\/javascript/i : file.path.endsWith('.css') ? /content-type:[ \t]*text\/css/i : /content-type:[ \t]*text\/html/i;
    assert.match(response.header, mime, '前端资源类型不正确');
    assert.match(response.header, /x-content-type-options:[ \t]*nosniff/i);
  }
  const indexHash = files.find(file => file.path === 'index.html').sha256;
  const page = https('/teaching-cpp/');
  assert.equal(page.status, 200, 'C++ 首页未返回 200'); assert.equal(sha256(page.body), indexHash, 'C++ 首页内容不正确');
  assert.match(page.header, /content-security-policy:[^\r\n]*frame-ancestors 'none'/i);
  const route = https('/teaching-cpp/__route_probe');
  assert.equal(route.status, 200, 'C++ 深路径没有返回前端页面'); assert.equal(sha256(route.body), indexHash);
  assert.equal(https('/teaching-cpp/assets/__missing.js').status, 404, '缺失的脚本没有返回 404');
  assert.ok([403, 404].includes(https('/teaching-cpp/.env').status), '隐藏文件路径没有被拒绝');
  p5Healthy(); await backend(); inspectFront(FRONT);
  assert.deepEqual(read(SSL), candidate);
  assert.deepEqual(read(HTTP), read(backup + '/tigao123.conf'));
  record('state.json', { stage: 'web-published-readonly', pm2Saved, writesEnabled: false, runEnabled: false, pm2: processBaseline, completedAt: new Date().toISOString() });
  progress('C++ 网页接入完成：HTTPS 页面、资源和 API 检查通过；写入关闭，执行关闭');
  apacheChanged = false; frontPublished = false;
  console.log('原 p5.js HTTPS 首页和公共 API 正常，两个后端均未重启。');
  console.log('访问 https://tigao123.com/teaching-cpp/ 完成浏览器登录检查；不要开启写入或运行。');
  console.log('备份目录：' + backup);
  process.stdout.write(run(PM2, ['list']));
}

try {
  files = material();
  if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) console.log('网页发布材料检查通过；未读取 .env、未连接数据库、未修改服务器配置。');
  else {
    assert.deepEqual(args, ['--publish-readonly']);
    await publish();
  }
} catch (error) {
  console.error('网页接入未完成；阶段：' + stage + '；错误码：' + (error.code || 'WEB_PUBLISH_FAILED'));
  if (error instanceof assert.AssertionError && !error.generatedMessage) console.error('检查说明：' + error.message);
  if (backup) record('failure.json', { stage, code: error.code || 'WEB_PUBLISH_FAILED', pm2Saved });
  if (apacheChanged || frontPublished) {
    try {
      if (apacheChanged) { replaceApache(original, candidate); syntax(); run('systemctl', ['reload', 'httpd']); }
      if (frontPublished) { inspectFront(FRONT); fs.renameSync(FRONT, backup + '/withdrawn-frontend'); }
      p5Healthy();
      record('state.json', { stage: 'web-withdrawn', pm2Saved, writesEnabled: false, runEnabled: false });
      console.error('已恢复原 Apache 配置并撤回新前端，原 p5.js HTTPS 检查通过。');
    } catch { console.error('无法确认自动恢复完成，请立即发回日志；不要重跑、删除目录或重启其他服务。'); }
  }
  if (pm2Saved) console.error('已保存的 PM2 列表保留；C++ 后端仍是原有的本机只读进程。');
  if (backup) console.error('备份目录：' + backup);
  process.exitCode = 1;
}
