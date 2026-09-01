import { AppError } from './errors.mjs';

const TABLES = {
  users: ['users', 'id'], classes: ['classes', 'id'], projects: ['projects', 'id'],
  groups: ['project_groups', 'id'], files: ['files', 'id'],
  documents: ['cpp_documents', 'project_id'], revisions: ['cpp_revisions', 'id'],
  runs: ['cpp_runs', 'id'], distributions: ['cpp_distributions', 'id']
};
const JSON_COLUMNS = new Set(['profile_json', 'recipients_json']);
const DATE_COLUMNS = new Set(['created_at', 'updated_at', 'finished_at']);
const RUN_SUMMARY_COLUMNS = 'id,queue_order,user_id,project_id,revision_id,version,request_id,state,profile_json,message,elapsed_ms,memory_bytes,result_bytes,created_at,updated_at,finished_at';
const IDENTIFIER = /^[a-z_]+$/;

function scoped(table, where = {}) {
  if (!TABLES[table]) throw new Error('Unknown table');
  return ['projects', 'groups'].includes(table) ? { ...where, project_type: 'cpp' } : where;
}
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('$in' in value) return value.$in.some(item => String(item) === String(row[key]));
      if ('$lt' in value) return row[key] < value.$lt;
      if ('$ne' in value) return row[key] !== value.$ne;
      throw new Error('Unknown comparison');
    }
    return value === null ? row[key] == null : String(row[key]) === String(value);
  });
}

// 本地演示和自动化测试共用业务逻辑；此适配器不连接生产数据库。
export class MemoryRepository {
  constructor(seed = {}) {
    this.tables = Object.fromEntries(Object.keys(TABLES).map(key => [key, structuredClone(seed[key] || [])]));
    this.tail = Promise.resolve();
  }
  async find(table, where = {}, options = {}) {
    let rows = this.tables[table].filter(row => matches(row, scoped(table, where)));
    if (options.recent) rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || Number(b.queue_order) - Number(a.queue_order));
    if (options.limit) rows = rows.slice(0, options.limit);
    return structuredClone(rows.map(row => table === 'runs' && !options.full ? Object.fromEntries(RUN_SUMMARY_COLUMNS.split(',').map(key => [key, row[key]])) : row));
  }
  async one(table, where) { return (await this.find(table, where, { full: true, limit: 1 }))[0] || null; }
  async insert(table, values) {
    const key = TABLES[table][1];
    const row = structuredClone(values);
    if (table === 'runs' && row.queue_order == null) row.queue_order = Math.max(0, ...this.tables.runs.map(item => Number(item.queue_order) || 0)) + 1;
    if (row[key] == null) row[key] = Math.max(0, ...this.tables[table].map(item => Number(item[key]) || 0)) + 1;
    if (this.tables[table].some(item => String(item[key]) === String(row[key]))) throw new Error('Duplicate primary key');
    this.tables[table].push(row);
    return row[key];
  }
  async update(table, where, values) {
    let changed = 0;
    for (const row of this.tables[table]) if (matches(row, scoped(table, where))) { Object.assign(row, structuredClone(values)); changed++; }
    return changed;
  }
  async remove(table, where) {
    const rows = this.tables[table];
    this.tables[table] = rows.filter(row => !matches(row, scoped(table, where)));
    return rows.length - this.tables[table].length;
  }
  async transaction(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    const backup = structuredClone(this.tables);
    try { return await fn(this); }
    catch (error) { this.tables = backup; throw error; }
    finally { release(); }
  }
  async close() {}
}

function field(key) {
  if (!IDENTIFIER.test(key)) throw new Error('Invalid database column');
  return `\`${key}\``;
}
function encode(key, value) {
  if (value === undefined) throw new Error(`Undefined database value: ${key}`);
  if (JSON_COLUMNS.has(key) && value !== null) return JSON.stringify(value);
  if (DATE_COLUMNS.has(key) && value !== null) return new Date(value);
  return value;
}
function decode(row) {
  for (const key of Object.keys(row)) {
    if (JSON_COLUMNS.has(key) && typeof row[key] === 'string') row[key] = JSON.parse(row[key]);
    if (DATE_COLUMNS.has(key) && row[key] instanceof Date) row[key] = row[key].toISOString();
  }
  return row;
}
function predicate(table, where) {
  const params = [];
  const clauses = Object.entries(scoped(table, where)).map(([key, value]) => {
    if (value === null) return `${field(key)} IS NULL`;
    if (value && typeof value === 'object') {
      if ('$in' in value) {
        if (!value.$in.length) return '1 = 0';
        params.push(...value.$in);
        return `${field(key)} IN (${value.$in.map(() => '?').join(',')})`;
      }
      if ('$lt' in value) { params.push(encode(key, value.$lt)); return `${field(key)} < ?`; }
      if ('$ne' in value) { params.push(encode(key, value.$ne)); return `${field(key)} <> ?`; }
      throw new Error('Unknown comparison');
    }
    params.push(encode(key, value));
    return `${field(key)} = ?`;
  });
  return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
}

export class MysqlRepository {
  constructor(pool, connection = null) { this.pool = pool; this.connection = connection; }
  get db() { return this.connection || this.pool; }
  async find(table, where = {}, options = {}) {
    const condition = predicate(table, where);
    const columns = table === 'users' ? 'id, username, role, class_code, tokens' : table === 'runs' && !options.full ? RUN_SUMMARY_COLUMNS : '*';
    const order = options.recent && table === 'runs' ? ' ORDER BY created_at DESC, queue_order DESC' : '';
    const limit = Number.isSafeInteger(options.limit) && options.limit > 0 ? ` LIMIT ${Math.min(options.limit, 1000)}` : '';
    const [rows] = await this.db.execute(`SELECT ${columns} FROM ${field(TABLES[table][0])} WHERE ${condition.sql}${order}${limit}`, condition.params);
    return rows.map(decode);
  }
  async one(table, where) { return (await this.find(table, where, { full: true, limit: 1 }))[0] || null; }
  async insert(table, values) {
    const keys = Object.keys(values);
    const [result] = await this.db.execute(`INSERT INTO ${field(TABLES[table][0])} (${keys.map(field).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(key => encode(key, values[key])));
    return values[TABLES[table][1]] ?? result.insertId;
  }
  async update(table, where, values) {
    const keys = Object.keys(values);
    const condition = predicate(table, where);
    const [result] = await this.db.execute(`UPDATE ${field(TABLES[table][0])} SET ${keys.map(key => `${field(key)} = ?`).join(',')} WHERE ${condition.sql}`, [...keys.map(key => encode(key, values[key])), ...condition.params]);
    return result.affectedRows;
  }
  async remove(table, where) {
    const condition = predicate(table, where);
    const [result] = await this.db.execute(`DELETE FROM ${field(TABLES[table][0])} WHERE ${condition.sql}`, condition.params);
    return result.affectedRows;
  }
  async transaction(fn) {
    if (this.connection) return fn(this);
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // 单行数据库锁统一保护队列容量、版本更新、移动和分发；不在锁中等待执行服务。
      await connection.execute('SELECT id FROM cpp_queue_guard WHERE id = 1 FOR UPDATE');
      const result = await fn(new MysqlRepository(this.pool, connection));
      await connection.commit();
      return result;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async checkSchema() {
    try {
      await this.pool.execute('SELECT project_type FROM projects LIMIT 0');
      await this.pool.execute('SELECT project_type FROM project_groups LIMIT 0');
      for (const table of ['cpp_documents', 'cpp_revisions', 'cpp_runs', 'cpp_distributions']) await this.pool.execute(`SELECT 1 FROM ${table} LIMIT 0`);
      const [rows] = await this.pool.execute('SELECT id FROM cpp_queue_guard WHERE id = 1');
      if (rows.length !== 1) throw new Error('Missing queue guard');
    } catch { throw new AppError(503, 'SCHEMA_REQUIRED', '数据库尚未完成兼容迁移；服务不会自动修改共享表'); }
  }
  async acquireWorkerLock() {
    this.workerConnection = await this.pool.getConnection();
    const [rows] = await this.workerConnection.execute("SELECT GET_LOCK(CONCAT(DATABASE(), ':cpp-worker'), 0) AS acquired");
    if (Number(rows[0].acquired) !== 1) { this.workerConnection.release(); this.workerConnection = null; throw new Error('已有 C++ 任务调度进程，禁止重复启动'); }
  }
  async close() { if (this.workerConnection) await this.workerConnection.end(); await this.pool.end(); }
}
