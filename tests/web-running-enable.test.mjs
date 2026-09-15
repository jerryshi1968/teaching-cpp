import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { MysqlRepository } from '../backend/src/repository.mjs';

const script = fs.readFileSync(new URL('../deploy/enable-web-running-20260831.sh', import.meta.url));
const text = script.toString();
const body = /<<'CPP_WEB_RUNNING_NODE'\n([\s\S]+)\nCPP_WEB_RUNNING_NODE\n$/.exec(text)?.[1]; assert.ok(body);
const enable = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const secret = 'X'.repeat(64), parse = dotenv.parse;
const env = (newline = '\n') => ['# 保留原注释', 'NODE_ENV=production', 'APP_MODE=production', 'CPP_PRODUCTION_WRITES=enabled-after-p5js-review', 'export CPP_RUN_ENABLED = "false"  # 开关注释', 'RUNNER_TOKEN=\'\' # 私有值', '# CPP_COMPILER_IMAGE=sha256:<placeholder>', 'DB_PASSWORD="abc # ! $(untouched)"', 'CUSTOM=不要改这个值', ''].join(newline);
function cpp(overrides = {}) {
  return { name: enable.NAME, pm_id: 1, pid: 1234, pm2_env: { pm_cwd: enable.ROOT, pm_exec_path: enable.ROOT + '/backend/src/server.mjs', exec_mode: 'fork_mode', watch: false, uid: 995, gid: 992, NODE_ENV: 'production', APP_MODE: 'production', status: 'online', restart_time: 1, ...overrides } };
}

test('历史启用脚本可解析，其摘要拒绝新版多文件网站代码', () => {
  assert.equal(script[0], 35); assert.equal(text.includes('\r'), false);
  for (const mode of ['candidate', 'enabled', 'restored']) assert.doesNotThrow(() => new vm.Script(enable.probeSource(mode)));
  const replaced = new Set(['backend/src/worker.mjs', 'backend/src/repository.mjs', 'backend/src/service.mjs', 'backend/src/app.mjs', 'backend/src/source-store.mjs']);
  for (const [file, hash] of Object.entries(enable.HASHES)) {
    const actual = createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex');
    if (replaced.has(file)) assert.notEqual(actual, hash, file);
    else assert.equal(actual, hash, file);
  }
});

for (const newline of ['\n', '\r\n']) test('三项配置替换保留其他字节、注释、引号和 ' + JSON.stringify(newline), () => {
  const original = env(newline), result = enable.patchEnvironment(Buffer.from(original), secret, parse).toString();
  const expected = original.replace('"false"', '"true"').replace("RUNNER_TOKEN=''", "RUNNER_TOKEN='" + secret + "'") + 'CPP_COMPILER_IMAGE=' + enable.IMAGE + newline;
  assert.equal(result, expected);
  assert.deepEqual(parse(result), { ...parse(original), RUNNER_TOKEN: secret, CPP_RUN_ENABLED: 'true', CPP_COMPILER_IMAGE: enable.IMAGE });
});

test('已有相同镜像和密钥时仅改开关，镜像空值可填写，缺少末尾换行可追加', () => {
  const original = env().replace("RUNNER_TOKEN=''", "RUNNER_TOKEN='" + secret + "'") + "CPP_COMPILER_IMAGE='" + enable.IMAGE + "' # 保留镜像注释\n";
  assert.equal(enable.patchEnvironment(Buffer.from(original), secret, parse).toString(), original.replace('"false"', '"true"'));
  const blank = env() + 'CPP_COMPILER_IMAGE=  # 空值\n';
  assert.match(enable.patchEnvironment(Buffer.from(blank), secret, parse).toString(), /CPP_COMPILER_IMAGE=  sha256:[a-f0-9]{64}# 空值/);
  assert.equal(parse(enable.patchEnvironment(Buffer.from(env().trimEnd()), secret, parse)).CPP_COMPILER_IMAGE, enable.IMAGE);
});

test('拒绝重复项、意外旧密钥/镜像、已开启运行、缺失令牌和无效编码', () => {
  for (const original of [env() + 'CPP_RUN_ENABLED=false\n', env() + 'export RUNNER_TOKEN=\n', env() + 'CPP_COMPILER_IMAGE=wrong\n', env().replace("RUNNER_TOKEN=''", 'RUNNER_TOKEN=unknown'), env().replace('"false"', '"true"'), env().replace('enabled-after-p5js-review', 'disabled'), env().replace("RUNNER_TOKEN='' # 私有值\n", ''), env().replace('CPP_RUN_ENABLED = "false"', 'CPP_RUN_ENABLED: false')]) assert.throws(() => enable.patchEnvironment(Buffer.from(original), secret, parse));
  assert.throws(() => enable.patchEnvironment(Buffer.from([0xff, 0xfe]), secret, parse), { code: 'ENV_INVALID_UTF8' });
  assert.throws(() => enable.patchEnvironment(Buffer.from(env()), secret + '\n', parse), { code: 'RUNNER_TOKEN_INVALID' });
});

test('拒绝PM2中残留运行配置，包括仅在候选配置新增的镜像字段', () => {
  enable.checkCpp([cpp()], ['NODE_ENV', 'APP_MODE', 'CPP_RUN_ENABLED']);
  for (const value of [cpp({ CPP_COMPILER_IMAGE: 'bad' }), cpp({ env: { RUNNER_TOKEN: secret } }), cpp({ CPP_RUN_ENABLED: 'false' }), cpp({ watch: true }), cpp({ uid: 0 }), cpp({ exec_mode: 'cluster_mode' })]) assert.throws(() => enable.checkCpp([value], []));
  assert.throws(() => enable.checkCpp([cpp(), cpp()], []));
});

function connection({ active = 0, owner = null, migration = 'complete', rollbackFails = false } = {}) {
  const events = [];
  return { events,
    async query({ sql }) { events.push({ method: 'query', sql }); assert.ok(['START TRANSACTION READ ONLY', 'ROLLBACK'].includes(sql)); if (rollbackFails && sql === 'ROLLBACK') throw Object.assign(new Error(), { code: 'ROLLBACK_FAILED' }); return [[]]; },
    async execute({ sql }, values) {
      events.push({ method: 'execute', sql, values }); assert.ok(sql.startsWith('SELECT '), '不允许写入或预处理事务控制');
      if (sql.includes('FROM cpp_queue_guard')) return [[{ id: 1 }]];
      if (sql.includes('FROM cpp_schema_migrations')) return [[{ state: migration, checksum: 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041' }]];
      if (sql.includes('COUNT(*)')) return [[{ count: active }]];
      if (sql.includes('IS_USED_LOCK')) return [[{ owner }]];
      return [[]];
    }
  };
}
test('数据库检查仅查询：启用前空队列无锁，启用后锁已持有；事务走文本协议', async () => {
  for (const [mode, owner, active] of [['candidate', null, 0], ['enabled', 12345, 1], ['restored', null, 1]]) {
    const db = connection({ owner, active });
    assert.deepEqual(await enable.queryReadiness(db, MysqlRepository, mode), { activeRuns: active, workerLockHeld: owner !== null });
    assert.deepEqual(db.events.filter(row => row.method === 'query').map(row => row.sql), ['START TRANSACTION READ ONLY', 'ROLLBACK']);
    assert.equal(db.events.some(row => /SELECT GET_LOCK/.test(row.sql)), false);
  }
});

test('旧队列、意外调度锁、迁移不完整或回滚失败都不能报告检查成功', async () => {
  for (const [mode, scenario] of [['candidate', { active: 1 }], ['candidate', { owner: 12 }], ['enabled', { owner: null }], ['restored', { owner: 12 }], ['candidate', { migration: 'started' }], ['candidate', { rollbackFails: true }]]) {
    const db = connection(scenario); await assert.rejects(enable.queryReadiness(db, MysqlRepository, mode));
    assert.equal(db.events.at(-1).sql, 'ROLLBACK');
  }
});

test('备份之前不改变状态，修改到完成任一步失败都进入恢复', async () => {
  const order = ['preflight', 'backup', 'replace', 'restart', 'verify', 'finish'];
  for (const failed of [null, ...order]) {
    const calls = [], actions = Object.fromEntries([...order, 'recover'].map(name => [name, async () => { calls.push(name); if (name === failed) throw Object.assign(new Error(), { code: 'TEST_' + name.toUpperCase() }); }]));
    if (failed) await assert.rejects(enable.activation(actions), { code: 'TEST_' + failed.toUpperCase() }); else await enable.activation(actions);
    const at = order.indexOf(failed), expected = failed ? [...order.slice(0, at + 1), ...(at >= 2 ? ['recover'] : [])] : order;
    assert.deepEqual(calls, expected);
  }
});

test('恢复失败保留原错误和恢复错误，不伪报已经恢复', async () => {
  const error = code => Object.assign(new Error(), { code });
  await assert.rejects(enable.activation({ preflight: async () => {}, backup: async () => {}, replace: async () => { throw error('HALF_REPLACED'); }, recover: async () => { throw error('RECOVERY_FAILED'); } }), { code: 'HALF_REPLACED', recoveryCode: 'RECOVERY_FAILED' });
});

test('网站配置验证要求固定容量；执行器忙于合法任务不视作连接失败', () => {
  const config = { mode: 'production', writesEnabled: true, runEnabled: true, limits: { pending: 20, perUser: 1, concurrency: 1, retentionHours: 24, userCacheMB: 100 } };
  enable.checkGates(config, true); enable.checkRunnerHealth({ ready: true, busy: true, image: enable.IMAGE });
  assert.throws(() => enable.checkGates({ ...config, writesEnabled: false }, true));
  assert.throws(() => enable.checkGates({ ...config, limits: { ...config.limits, concurrency: 20 } }, true));
  assert.throws(() => enable.checkRunnerHealth({ ready: true, busy: false, image: 'wrong' }));
});

test('完整网站检查程序在Windows先拒绝，不连接数据库和执行服务', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', enable.probeSource('candidate')], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stdout), { ok: false, code: 'PROBE_IDENTITY_INVALID' });
});

test('完整启用脚本在Windows先拒绝，不读取服务器配置', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-', '--enable-web-running'], { input: body, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 1); assert.match(result.stdout, /LINUX_ROOT_REQUIRED/); assert.doesNotMatch(result.stdout, /私有备份与操作记录：/);
});

function inspectProbe(mode, scenario = 'normal') {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', new URL('./fixtures/web-running-probe.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), mode, scenario], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes('synthetic-password-never-print')); assert.ok(!result.stdout.includes('Z'.repeat(64)));
  return JSON.parse(result.stdout);
}
for (const mode of ['candidate', 'enabled', 'restored']) test('完整网站账号检查的模拟Linux分支：' + mode, () => {
  const result = inspectProbe(mode);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.output, [{ ok: true, mode, activeRuns: 0, workerLockHeld: mode === 'enabled' }]);
  assert.equal(result.events.includes('runner-health'), mode !== 'restored');
  assert.deepEqual(result.events.slice(-3), ['ROLLBACK', 'connection-release', 'pool-end']);
});

test('完整网站账号检查在执行器、数据库或身份异常时退出，且不泄露凭据', () => {
  const runner = inspectProbe('candidate', 'runner-error'); assert.equal(runner.exitCode, 1); assert.equal(runner.output[0].code, 'PROBE_RUNNER_UNREACHABLE'); assert.ok(!runner.events.includes('connect'));
  const database = inspectProbe('candidate', 'db-error'); assert.equal(database.exitCode, 1); assert.equal(database.output[0].code, 'ER_ACCESS_DENIED_ERROR'); assert.equal(database.events.at(-1), 'pool-end');
  const groups = inspectProbe('candidate', 'extra-group'); assert.equal(groups.exitCode, 1); assert.equal(groups.output[0].code, 'PROBE_IDENTITY_INVALID'); assert.deepEqual(groups.events, []);
});
