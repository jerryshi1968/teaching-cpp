import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import dotenv from 'dotenv';
import { readConfig } from '../../backend/src/config.mjs';
import { MysqlRepository } from '../../backend/src/repository.mjs';

// 在隔离子进程中模拟 Linux 及数据库接口，不读取服务器文件或发起网络连接。
const [mode, scenario = 'normal'] = process.argv.slice(2);
if (!['candidate', 'enabled', 'restored'].includes(mode)) throw new Error('Unexpected mode');
const text = fs.readFileSync(new URL('../../deploy/enable-web-running-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_WEB_RUNNING_NODE'\n([\s\S]+)\nCPP_WEB_RUNNING_NODE\n$/.exec(text)[1];
const enable = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const secret = 'Z'.repeat(64), events = [], output = [];
const settings = { NODE_ENV: 'production', APP_MODE: 'production', PORT: '5180', CPP_PRODUCTION_WRITES: 'enabled-after-p5js-review', CPP_RUN_ENABLED: mode === 'restored' ? 'false' : 'true', DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_NAME: 'teaching_p5js', DB_USER: 'dbadmin', DB_PASSWORD: 'synthetic-password-never-print', COMMON_API_URL: 'http://127.0.0.1:5080/api', RUNNER_URL: 'http://127.0.0.1:5280', CPP_STORAGE_ROOT: enable.ROOT + '/storage', RUNNER_TOKEN: mode === 'restored' ? '' : secret, CPP_COMPILER_IMAGE: mode === 'restored' ? '' : enable.IMAGE };
const connection = {
  async query({ sql }) { events.push(sql); if (!['START TRANSACTION READ ONLY', 'ROLLBACK'].includes(sql)) throw new Error('Unexpected query'); return [[]]; },
  async execute({ sql }) {
    events.push(sql); if (!sql.startsWith('SELECT ')) throw Object.assign(new Error(), { code: 'ER_UNSUPPORTED_PS' });
    if (sql.includes('FROM cpp_queue_guard')) return [[{ id: 1 }]];
    if (sql.includes('FROM cpp_schema_migrations')) return [[{ state: 'complete', checksum: 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041' }]];
    if (sql.includes('COUNT(*)')) return [[{ count: 0 }]];
    if (sql.includes('IS_USED_LOCK')) return [[{ owner: mode === 'enabled' ? 1234 : null }]];
    return [[]];
  },
  release() { events.push('connection-release'); }
};
const pool = { async getConnection() { events.push('connect'); if (scenario === 'db-error') throw Object.assign(new Error(settings.DB_PASSWORD), { code: 'ER_ACCESS_DENIED_ERROR' }); return connection; }, async end() { events.push('pool-end'); } };
class Worker {
  constructor(service, config) { if (service !== null) throw new Error('Probe must not start scheduler'); this.config = config; }
  async request(path) {
    events.push('runner-health');
    if (path !== '/health' || this.config.runnerToken !== secret || this.config.runnerUrl !== 'http://127.0.0.1:5280') throw new Error('Wrong runner parameters');
    return { ready: scenario !== 'runner-error', busy: false, image: enable.IMAGE };
  }
}
const fakeProcess = { platform: 'linux', getuid: () => 995, getgid: () => 992, getgroups: () => scenario === 'extra-group' ? [0, 992] : [992], env: settings, exitCode: 0, stdout: { write: value => output.push(JSON.parse(value)) } };
const context = vm.createContext({ process: fakeProcess, console });
const dependencies = new Map([
  ['node:fs', { constants: fs.constants, readFileSync: (fd, encoding) => { if (fd !== 0 || encoding !== 'utf8') throw new Error('Unexpected file read'); return JSON.stringify({ envText: Object.entries(settings).map(([key, value]) => key + '=' + value).join('\n') }); }, accessSync: file => { events.push('access:' + file); }, statfsSync: () => ({ bavail: 8 * 1024 ** 3, bsize: 1 }) }],
  ['node:module', { createRequire: file => { if (file !== enable.ROOT + '/package.json') throw new Error('Unexpected package'); return name => { if (name === 'dotenv') return dotenv; if (name === 'mysql2/promise') return { createPool: config => { if (config.user !== 'dbadmin' || config.database !== 'teaching_p5js') throw new Error('Wrong database'); return pool; } }; throw new Error('Unexpected dependency'); }; } }],
  // 配置仍使用真实解析逻辑；路径按被模拟的 Linux 平台解析，避免 Windows 盘符影响检查。
  ['file://' + enable.ROOT + '/backend/src/config.mjs', { readConfig: env => ({ ...readConfig(env), storageRoot: path.posix.resolve(env.CPP_STORAGE_ROOT) }) }],
  ['file://' + enable.ROOT + '/backend/src/worker.mjs', { RunWorker: Worker }],
  ['file://' + enable.ROOT + '/backend/src/repository.mjs', { MysqlRepository }]
]);
async function dependency(name) {
  const values = dependencies.get(name); if (!values) throw new Error('Unexpected dynamic module');
  const module = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  await module.link(() => { throw new Error('Unexpected nested module'); }); await module.evaluate(); return module;
}
const module = new vm.SourceTextModule(enable.probeSource(mode), { context, importModuleDynamically: dependency });
await module.link(dependency); await module.evaluate();
for (let i = 0; i < 100 && !output.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
await new Promise(resolve => setTimeout(resolve, 10));
console.log(JSON.stringify({ exitCode: fakeProcess.exitCode, output, events }));
