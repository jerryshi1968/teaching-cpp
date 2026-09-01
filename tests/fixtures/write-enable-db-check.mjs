import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { MysqlRepository } from '../../backend/src/repository.mjs';
import { requireThat } from '../../deploy/write-enable-20260831-02/guard.mjs';

// 在独立测试子进程中执行原检查文件；模拟 MySQL 的协议限制，不连接任何数据库。
const [version, mode, scenario = 'normal'] = process.argv.slice(2);
if (!['01', '02'].includes(version) || !['disabled', 'enabled'].includes(mode)) throw new Error('Invalid fixture arguments');
const events = [], output = [];
const error = code => Object.assign(new Error(code), { code });
const connection = {
  async query({ sql, timeout }) {
    events.push({ method: 'query', sql, timeout });
    if (!['START TRANSACTION READ ONLY', 'ROLLBACK'].includes(sql)) throw error('UNEXPECTED_TEXT_QUERY');
    if (scenario === 'start-error' && sql.startsWith('START')) throw error('SIMULATED_START_ERROR');
    if (scenario === 'rollback-error' && sql === 'ROLLBACK') throw error('SIMULATED_ROLLBACK_ERROR');
    return [[], []];
  },
  async execute({ sql, timeout }, parameters) {
    events.push({ method: 'execute', sql, timeout, parameters });
    if (/^(START TRANSACTION|ROLLBACK)/.test(sql)) throw error('ER_UNSUPPORTED_PS');
    if (!sql.startsWith('SELECT ')) throw error('NON_SELECT_PREPARED_STATEMENT');
    if (sql.includes('FROM cpp_queue_guard')) return [[{ id: 1 }], []];
    if (sql.includes('FROM cpp_schema_migrations')) return [[{ state: scenario === 'migration-incomplete' ? 'started' : 'complete', checksum: 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041' }], []];
    if (sql === 'SELECT COUNT(*) AS count FROM cpp_runs') return [[{ count: scenario === 'existing-run' ? 1 : 0 }], []];
    if (sql === 'SELECT 1 FROM cpp_documents LIMIT 1' && scenario === 'existing-document') return [[{ 1: 1 }], []];
    return [[], []];
  },
  release() { events.push({ method: 'release' }); }
};
const pool = {
  async getConnection() { events.push({ method: 'getConnection' }); return connection; },
  async end() { events.push({ method: 'end' }); }
};
const fakeProcess = { platform: 'linux', getuid: () => 995, getgid: () => 992, argv: ['node', 'check-db.mjs', mode], exitCode: 0 };
const context = vm.createContext({ process: fakeProcess, console: { log: text => output.push(JSON.parse(text)) } });
const definitions = new Map([
  ['./guard.mjs', { requireThat }],
  ['../../backend/src/config.mjs', { readConfig: () => ({ mode: 'production', writesEnabled: mode === 'enabled', runEnabled: false, db: { host: '127.0.0.1', port: 3306, database: 'teaching_p5js', user: 'dbadmin' } }) }],
  ['../../backend/src/repository.mjs', { MysqlRepository }],
  ['mysql2/promise', { createPool: () => pool }]
]);
const modules = new Map();
async function dependency(specifier) {
  if (modules.has(specifier)) return modules.get(specifier);
  const exports = definitions.get(specifier);
  if (!exports) throw new Error('Unexpected fixture import');
  const module = new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
  modules.set(specifier, module);
  await module.link(() => { throw new Error('Unexpected nested fixture import'); });
  await module.evaluate();
  return module;
}
const file = path.resolve(import.meta.dirname, '../../deploy/write-enable-20260831-' + version + '/check-db.mjs');
const module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, importModuleDynamically: dependency });
await module.link(dependency);
await module.evaluate();
console.log(JSON.stringify({ exitCode: fakeProcess.exitCode, output, events }));
