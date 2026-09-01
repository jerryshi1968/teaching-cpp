import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
import { sha256, normalize, renderPatch, mysqlOption, fingerprint, publication } from './safety.mjs';

// 仅用于当前服务器的首次兼容发布；C++ 服务、Apache、前端和执行沙箱不在本脚本范围内。
const CPP = '/var/www/teaching-cpp-backend';
const P5 = '/var/www/teaching-p5js-backend';
const DATABASE = 'teaching_p5js';
const PM2 = '/usr/bin/pm2';
const NODE = '/usr/bin/node';
const VERIFY = path.join(CPP, 'compat/p5js-20260830-01');
const MATERIAL_ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATION_SHA = 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041';
const BASE_TABLES = ['captcha_challenges', 'classes', 'files', 'project_groups', 'projects', 'sms_send_logs', 'token_transactions', 'users'];
const CPP_TABLES = ['cpp_documents', 'cpp_revisions', 'cpp_runs', 'cpp_distributions'];
const commandEnv = { ...process.env };
const args = process.argv.slice(2);
let stage = '发布材料校验';
let connection;
let options;
let backupDir;
let maintenance = false;
let databaseTouched = false;
let baselineData;
let patches = [];
let originalCppEnv;
let originalP5Env;
let initialPm2;
let interrupted = false;
let recoveryActive = false;
let failedStage;

process.on('SIGTERM', () => { interrupted = true; });
process.on('SIGINT', () => { interrupted = true; });
function progress(text) {
  stage = text;
  console.log(new Date().toISOString() + ' ' + text);
  if (interrupted && !recoveryActive) throw Object.assign(new Error(), { code: 'INTERRUPTED' });
}
function command(binary, arguments_, timeout = 30000) {
  return execFileSync(binary, arguments_, {
    cwd: CPP, env: commandEnv, encoding: 'utf8', timeout,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
  });
}
function readFile(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1, '拒绝符号链接或硬链接文件');
  return fs.readFileSync(file);
}
function directory(dir) {
  assert.equal(fs.realpathSync(dir), dir, '目录不能指向其他位置');
  assert.ok(fs.lstatSync(dir).isDirectory());
}
function readBaseline() {
  const text = fs.readFileSync(path.join(import.meta.dirname, 'p5js-baseline.sha256'), 'utf8').trim();
  const result = new Map();
  for (const line of text.split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/.exec(line);
    assert.ok(match && !match[2].split('/').includes('..'));
    result.set(match[2], match[1]);
  }
  assert.equal(result.size, 31);
  return result;
}
function inspectMaterials() {
  const base = readBaseline();
  assert.equal(sha256(fs.readFileSync(path.join(MATERIAL_ROOT, 'backend/migrations/001_cpp.sql'))), MIGRATION_SHA);
  const manifest = JSON.parse(fs.readFileSync(path.join(MATERIAL_ROOT, 'compat/p5js-20260830-01/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ['models/fileModel.js', 'models/projectGroupModel.js', 'models/projectModel.js']);
  for (const file of manifest.files) {
    assert.equal(file.normalizedOriginalSha256, base.get(file.path));
    assert.equal(sha256(fs.readFileSync(path.join(MATERIAL_ROOT, 'compat/p5js-20260830-01/reference', file.path))), file.originalSha256);
    assert.equal(sha256(fs.readFileSync(path.join(MATERIAL_ROOT, 'compat/p5js-20260830-01/patched', file.path))), file.patchedSha256);
  }
  return manifest;
}
async function query(sql, params = []) {
  return connection.query({ sql, timeout: 30000 }, params);
}
async function connect() {
  connection = await createConnection(options);
  const [[identity]] = await query('SELECT CURRENT_USER() AS account,DATABASE() AS db,VERSION() AS version');
  assert.equal(identity.db, DATABASE);
  assert.equal(identity.account, 'dbadmin@%');
  assert.equal(identity.version, '8.4.9');
  await query('SET SESSION lock_wait_timeout=10');
  await query('SET SESSION innodb_lock_wait_timeout=10');
}
function processInfo() {
  const processes = JSON.parse(command(PM2, ['jlist']));
  const entries = processes.filter(item => item.name === 'p5js-backend');
  assert.equal(entries.length, 1);
  const info = entries[0];
  assert.equal(info.pm2_env.pm_cwd, P5);
  assert.equal(info.pm2_env.pm_exec_path, path.join(P5, 'app.js'));
  assert.equal(info.pm2_env.exec_mode, 'fork_mode');
  assert.ok(!info.pm2_env.watch || (Array.isArray(info.pm2_env.watch) && info.pm2_env.watch.length === 0));
  return { info, processes };
}
function noCppListener() {
  const ss = ['/usr/sbin/ss', '/usr/bin/ss'].find(file => fs.existsSync(file));
  assert.ok(ss);
  assert.equal(command(ss, ['-H', '-ltn', '( sport = :5180 or sport = :5280 )']).trim(), '');
}
function assertConfigs() {
  assert.equal(sha256(readFile(path.join(CPP, '.env'))), originalCppEnv);
  assert.equal(sha256(readFile(path.join(P5, '.env'))), originalP5Env);
  noCppListener();
}
function inspectP5(after = false) {
  const base = readBaseline();
  if (after) for (const patch of patches) base.set(patch.relative, sha256(normalize(patch.next.toString('utf8'))));
  for (const [relative, expected] of base) {
    assert.equal(sha256(normalize(readFile(path.join(P5, relative)).toString('utf8'))), expected, 'p5.js 源文件版本不一致：' + relative);
  }
}
function record(name, value) {
  if (!backupDir) return;
  fs.writeFileSync(path.join(backupDir, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function snapshot(existing = null) {
  const data = {};
  for (const table of BASE_TABLES) {
    const columns = existing?.[table].columns || (await query('SHOW COLUMNS FROM `' + table + '`'))[0].map(row => row.Field);
    for (const column of columns) assert.match(column, /^[a-zA-Z0-9_]+$/);
    const [rows] = await query('SELECT ' + columns.map(column => '`' + column + '`').join(',') + ' FROM `' + table + '` LIMIT 100001');
    assert.ok(rows.length <= 100000, '数据规模超出本次小站发布限制');
    data[table] = { columns, ...fingerprint(rows, columns) };
  }
  return data;
}
async function noCppData() {
  for (const table of ['projects', 'project_groups']) {
    const [columns] = await query('SHOW COLUMNS FROM `' + table + '`');
    if (columns.some(column => column.Field === 'project_type')) {
      const [[count]] = await query("SELECT COUNT(*) AS total FROM `" + table + "` WHERE project_type IS NULL OR project_type <> 'p5js'");
      assert.equal(Number(count.total), 0, '发现非 p5js 记录，禁止恢复无类别限制的旧模型');
    }
  }
  const [tables] = await query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  for (const table of CPP_TABLES) if (tables.some(row => row.name === table)) {
    assert.equal(Number((await query('SELECT COUNT(*) AS total FROM `' + table + '`'))[0][0].total), 0);
  }
}
async function health() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5080/api/health', { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) {
        const body = await response.json();
        if (body.status === 'OK' && body.db_check === 'Database Active') return;
      } else { await response.body?.cancel(); }
    } catch {}
    await delay(500);
  }
  throw Object.assign(new Error(), { code: 'P5_HEALTH_FAILED' });
}

async function preflight() {
  progress('正式发布前检查：只读核对代码、配置、服务和数据库');
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 0);
  process.umask(0o077);
  assert.equal(fs.realpathSync(import.meta.dirname), path.join(CPP, 'deploy/production-20260830-01'));
  for (const dir of [CPP, P5, path.join(P5, 'models'), path.join(P5, 'storage/projects'), path.join(CPP, 'backups')]) directory(dir);
  const backups = fs.statSync(path.join(CPP, 'backups'));
  assert.equal(backups.uid, 0); assert.equal(backups.mode & 0o777, 0o700);
  const space = fs.statfsSync(CPP);
  assert.ok(space.bavail * space.bsize >= 1024 * 1024 * 1024, '剩余空间不足 1 GiB');
  command('sha256sum', ['--quiet', '-c', 'backups/useradd-fix-NoMZXnat/DEPLOYMENT-FILES.after.sha256']);
  command('sha256sum', ['--quiet', '-c', 'compat/p5js-20260830-01/VERIFICATION-FILES.sha256']);
  inspectP5();
  const manifest = inspectMaterials();
  patches = manifest.files.map(file => {
    const target = path.join(P5, file.path);
    const original = readFile(target);
    const next = renderPatch(original, readFile(path.join(VERIFY, 'reference', file.path)), readFile(path.join(VERIFY, 'patched', file.path)));
    return { relative: file.path, target, original, next, stat: fs.statSync(target) };
  });
  for (const patch of patches) command(NODE, ['--check', path.join(VERIFY, 'patched', patch.relative)]);
  const cppEnv = readFile(path.join(CPP, '.env'));
  const envStat = fs.statSync(path.join(CPP, '.env'));
  assert.equal(envStat.uid, 0); assert.equal(envStat.mode & 0o777, 0o640);
  const env = dotenv.parse(cppEnv);
  const expected = { NODE_ENV: 'production', APP_MODE: 'production', PORT: '5180', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'dbadmin', DB_NAME: DATABASE, CPP_PRODUCTION_WRITES: 'disabled', CPP_RUN_ENABLED: 'false' };
  for (const [key, value] of Object.entries(expected)) assert.equal(env[key], value, key + ' 配置不同');
  assert.ok(env.DB_PASSWORD && env.DB_PASSWORD !== 'REPLACE_ON_SERVER');
  originalCppEnv = sha256(cppEnv);
  const p5Env = readFile(path.join(P5, '.env'));
  originalP5Env = sha256(p5Env);
  const pm2Home = commandEnv.PM2_HOME || path.join(commandEnv.HOME || '/root', '.pm2');
  const daemonPid = Number(readFile(path.join(pm2Home, 'pm2.pid')).toString('utf8').trim());
  assert.ok(Number.isSafeInteger(daemonPid) && daemonPid > 1);
  process.kill(daemonPid, 0);
  initialPm2 = processInfo();
  assert.equal(initialPm2.info.pm2_env.status, 'online');
  const pm = initialPm2.info.pm2_env;
  const p5FileEnv = dotenv.parse(p5Env);
  const effectiveP5 = key => pm[key] ?? pm.env?.[key] ?? p5FileEnv[key];
  assert.equal(String(effectiveP5('PORT')), '5080');
  assert.equal(effectiveP5('DB_HOST') || '127.0.0.1', '127.0.0.1', '原站数据库主机不同');
  assert.equal(parseInt(effectiveP5('DB_PORT'), 10) || 3306, 3306, '原站数据库端口不同');
  assert.equal(effectiveP5('DB_NAME'), DATABASE, '原站数据库名称不同');
  assert.equal(effectiveP5('DB_USER'), 'dbadmin', '原站数据库账号不同');
  noCppListener();
  await health();
  const mysqlLog = readFile(path.join(CPP, 'logs/mysql-verification-E5B5he9F.log')).toString('utf8');
  assert.ok(mysqlLog.includes('目标测试库：teachingcpp20260830test；MySQL：8.4.9'));
  assert.ok(mysqlLog.includes('MySQL 验证完成：16 项通过；'));
  assert.ok(!mysqlLog.includes('验证未完成'));
  options = { host: '127.0.0.1', port: 3306, user: 'dbadmin', password: env.DB_PASSWORD, database: DATABASE, connectTimeout: 10000, multipleStatements: false, dateStrings: true, timezone: 'Z', charset: 'utf8mb4' };
  await connect();
  assert.equal(Number((await query("SELECT GET_LOCK('teaching-p5js:cpp-first-publish',0) AS acquired"))[0][0].acquired), 1);
  const [tables] = await query('SELECT TABLE_NAME AS name,ENGINE AS engine,TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  assert.deepEqual(tables.map(table => table.name).sort(), BASE_TABLES);
  assert.ok(tables.every(table => table.engine === 'InnoDB' && table.type === 'BASE TABLE'));
  for (const [table, schema] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA']]) {
    const [[count]] = await query('SELECT COUNT(*) AS total FROM information_schema.' + table + ' WHERE ' + schema + '=DATABASE()');
    assert.equal(Number(count.total), 0, '发现额外数据库对象，需先审查备份与维护方案：' + table);
  }
  const [[columns]] = await query("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('projects','project_groups') AND COLUMN_NAME='project_type'");
  assert.equal(Number(columns.total), 0, '正式库已存在类别字段，拒绝重复首次发布');
  progress('发布前检查通过；即将进入短维护窗口');
}

async function stop() {
  progress('暂停 p5js-backend，其他服务保持不变');
  maintenance = true;
  command(PM2, ['stop', 'p5js-backend']);
  assert.equal(processInfo().info.pm2_env.status, 'stopped');
  const ss = ['/usr/sbin/ss', '/usr/bin/ss'].find(file => fs.existsSync(file));
  assert.equal(command(ss, ['-H', '-ltn', 'sport = :5080']).trim(), '');
  assertConfigs(); inspectP5();
}

async function backup() {
  progress('建立维护窗口内的数据库、原站文件和 PM2 备份');
  backupDir = fs.mkdtempSync(path.join(CPP, 'backups/first-publish-'));
  fs.chmodSync(backupDir, 0o700);
  console.log('本次备份目录：' + backupDir);
  record('pm2-before.json', initialPm2.processes);
  record('state.json', { stage: 'backing-up', productionWrites: false });
  for (const patch of patches) {
    const destination = path.join(backupDir, 'original', patch.relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, patch.original, { flag: 'wx', mode: 0o600 });
  }
  record('models.json', patches.map(patch => ({ path: patch.relative, before: sha256(patch.original), after: sha256(patch.next), mode: patch.stat.mode & 0o777, uid: patch.stat.uid, gid: patch.stat.gid })));
  baselineData = await snapshot();
  record('data-before.json', baselineData);
  const optionFile = path.join(backupDir, 'dump-client.cnf');
  fs.writeFileSync(optionFile, '[client]\nhost=127.0.0.1\nport=3306\nprotocol=tcp\nuser=dbadmin\npassword=' + mysqlOption(options.password) + '\n', { mode: 0o600, flag: 'wx' });
  const sqlPartial = path.join(backupDir, 'teaching_p5js.sql.partial');
  try {
    command('mysqldump', [
      '--defaults-file=' + optionFile, '--no-login-paths', '--single-transaction', '--quick', '--no-tablespaces',
      '--set-gtid-purged=OFF', '--default-character-set=utf8mb4', '--skip-routines', '--events', '--triggers',
      '--hex-blob', '--comments', '--dump-date', '--result-file=' + sqlPartial, DATABASE
    ], 120000);
  } finally { fs.unlinkSync(optionFile); }
  const sqlBytes = readFile(sqlPartial);
  assert.ok(sqlBytes.length > 0 && /-- Dump completed on [^\n]+\s*$/.test(sqlBytes.toString('utf8')));
  fs.renameSync(sqlPartial, path.join(backupDir, 'teaching_p5js.sql'));
  const archivePartial = path.join(backupDir, 'site-files.tar.gz.partial');
  command('tar', ['--acls', '--xattrs', '--selinux', '-czf', archivePartial, '-C', '/',
    'var/www/teaching-p5js-backend', 'var/www/html/teaching-p5js', 'etc/httpd/conf', 'etc/httpd/conf.d',
    'etc/httpd/conf.modules.d', 'etc/letsencrypt/options-ssl-apache.conf'
  ], 120000);
  const listing = command('tar', ['-tzf', archivePartial]);
  assert.ok(listing.includes('var/www/teaching-p5js-backend/storage/projects/'));
  assert.ok(listing.split('\n').includes('var/www/html/teaching-p5js/index.html'));
  fs.writeFileSync(path.join(backupDir, 'ARCHIVE-FILES.txt'), listing, { flag: 'wx', mode: 0o600 });
  fs.renameSync(archivePartial, path.join(backupDir, 'site-files.tar.gz'));
  assert.deepEqual(await snapshot(baselineData), baselineData, '备份期间出现数据变更');
  for (const filename of ['teaching_p5js.sql', 'site-files.tar.gz', 'ARCHIVE-FILES.txt', 'pm2-before.json', 'models.json', 'data-before.json']) {
    fs.appendFileSync(path.join(backupDir, 'SHA256SUMS'), sha256(readFile(path.join(backupDir, filename))) + '  ' + filename + '\n', { mode: 0o600 });
  }
  execFileSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: backupDir, env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  record('state.json', { stage: 'backed-up', productionWrites: false });
  progress('维护备份校验通过，原表记录在备份期间保持不变');
}

async function migrate() {
  progress('执行已在 MySQL 8.4.9 验证的正式库新增迁移');
  assertConfigs(); inspectP5();
  assert.equal(processInfo().info.pm2_env.status, 'stopped');
  databaseTouched = true;
  record('state.json', { stage: 'migrating', productionWrites: false });
  const { applyMigration } = await import('../../backend/src/migrate.mjs');
  const sql = readFile(path.join(CPP, 'backend/migrations/001_cpp.sql')).toString('utf8');
  assert.equal(sha256(sql), MIGRATION_SHA);
  const adapter = { query, execute: (sql, params = []) => connection.execute({ sql, timeout: 30000 }, params) };
  const result = await applyMigration(adapter, sql);
  assert.equal(result.applied, true);
  assert.deepEqual(await snapshot(baselineData), baselineData, '迁移后原表数据校验不一致');
  await noCppData();
  record('migration-result.json', result);
  record('state.json', { stage: 'migrated', productionWrites: false });
}

function replaceModel(patch, bytes) {
  directory(path.dirname(patch.target));
  const current = readFile(patch.target);
  assert.ok([sha256(patch.original), sha256(patch.next)].includes(sha256(current)), '目标模型被其他操作修改');
  const temporary = path.join(path.dirname(patch.target), '.' + path.basename(patch.target) + '.cpp-' + process.pid + '.tmp');
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fchownSync(fd, patch.stat.uid, patch.stat.gid);
      fs.fchmodSync(fd, patch.stat.mode & 0o777);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    execFileSync(NODE, ['--check', '--input-type=commonjs'], {
      cwd: P5, env: commandEnv, input: bytes, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000
    });
    command('cp', ['--attributes-only', '--preserve=all', '--', patch.target, temporary]);
    fs.renameSync(temporary, patch.target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
async function install() {
  progress('只替换三个 p5.js 模型，保留原权限、注释和换行');
  assert.equal(processInfo().info.pm2_env.status, 'stopped');
  record('state.json', { stage: 'installing-models', productionWrites: false });
  for (const patch of patches) replaceModel(patch, patch.next);
  inspectP5(true);
}
async function verify() {
  progress('恢复服务前核验迁移状态、原记录和三个模型');
  assertConfigs(); inspectP5(true);
  assert.deepEqual(await snapshot(baselineData), baselineData);
  const [[migration]] = await query("SELECT state,checksum FROM cpp_schema_migrations WHERE id='001_cpp'");
  assert.equal(migration.state, 'complete'); assert.equal(migration.checksum, MIGRATION_SHA);
  await noCppData();
  const { MysqlRepository } = await import('../../backend/src/repository.mjs');
  await new MysqlRepository({ execute: (sql, params = []) => connection.execute({ sql, timeout: 10000 }, params) }).checkSchema();
  record('data-after.json', await snapshot(baselineData));
}
async function resume() {
  progress('恢复原 p5js-backend，并检查 5080 与公共认证入口');
  command(PM2, ['restart', 'p5js-backend']);
  await health();
  assert.equal(processInfo().info.pm2_env.status, 'online');
  const response = await fetch('http://127.0.0.1:5080/api/auth/me', { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 401); await response.body?.cancel();
}
async function finish() {
  assertConfigs(); inspectP5(true);
  if (interrupted) throw Object.assign(new Error(), { code: 'INTERRUPTED' });
  record('state.json', { stage: 'complete', productionWrites: false, runEnabled: false });
  maintenance = false;
  console.log(new Date().toISOString() + ' 正式兼容发布完成：数据库已迁移，三个模型已发布，p5.js 健康检查通过');
  console.log('C++ 写入与执行仍关闭；Apache、前端和 C++ 服务均未启用。');
  console.log('请下载私有备份目录，并在浏览器检查原站登录、作品列表、保存及预览。');
  console.log('备份目录：' + backupDir);
}
async function recover() {
  if (!maintenance) return;
  failedStage = stage;
  recoveryActive = true;
  progress('发布未完成，进入受检查的原站恢复流程');
  command(PM2, ['stop', 'p5js-backend']);
  assert.equal(processInfo().info.pm2_env.status, 'stopped');
  assertConfigs();
  if (databaseTouched) {
    if (connection) await connection.end().catch(() => {});
    await connect();
    await noCppData();
    assert.deepEqual(await snapshot(baselineData), baselineData, '原数据有变化，需人工核查');
  }
  for (const patch of patches) {
    if (!readFile(patch.target).equals(patch.original)) replaceModel(patch, patch.original);
  }
  inspectP5();
  command(PM2, ['restart', 'p5js-backend']);
  await health();
  assert.equal(processInfo().info.pm2_env.status, 'online');
  record('state.json', { stage: 'old-models-restored', productionWrites: false, databaseMayHaveAdditions: databaseTouched });
  maintenance = false;
  console.log('原模型和 p5.js 服务已恢复；新增数据库结构保留，未恢复整库、未删除任何业务数据。');
}

try {
  inspectMaterials();
  if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
    console.log('发布材料检查通过；未读取 .env、未连接数据库、未执行服务器操作。');
  } else {
    assert.deepEqual(args, ['--apply', '--confirm-db', DATABASE, '--accept-short-p5js-outage']);
    await publication({ preflight, stop, backup, migrate, install, verify, resume, finish, recover });
  }
} catch (error) {
  const code = error.code || 'PUBLISH_FAILED';
  console.error('发布未完成；阶段：' + (failedStage || stage) + '；错误码：' + code);
  if (error instanceof assert.AssertionError && !error.generatedMessage) console.error('检查说明：' + error.message);
  if (error.recoveryCode || maintenance) console.error('需要人工处理，原站可能仍暂停。不要重跑、清库或恢复整库；请发回本日志。');
  if (backupDir) { console.error('备份目录：' + backupDir); record('failure.json', { stage: failedStage || stage, code, recoveryCode: error.recoveryCode || null }); }
  process.exitCode = 1;
} finally {
  if (connection) await connection.end().catch(() => { process.exitCode = 1; });
}
