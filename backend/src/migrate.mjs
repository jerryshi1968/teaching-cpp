import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { readConfig } from './config.mjs';

export async function migrationPlan() { return fs.readFile(new URL('../migrations/001_cpp.sql', import.meta.url), 'utf8'); }
export async function migrationPlans() { return Promise.all(['001_cpp', '002_cpp_multifile'].map(async id => ({ id, sql: await fs.readFile(new URL(`../migrations/${id}.sql`, import.meta.url), 'utf8') }))); }
export async function applyMigration(connection, sql, migrationId = '001_cpp') {
  const checksum = createHash('sha256').update(sql).digest('hex');
  const [version] = await connection.query('SELECT VERSION() AS version, DATABASE() AS db');
  if (!/^8\./.test(version[0].version)) throw new Error('此迁移以 MySQL 8.x 为目标；其他数据库版本须先审查 SQL');
  const [tables] = await connection.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  const names = new Set(tables.map(row => row.name));
  if (names.has('cpp_schema_migrations')) {
    const [rows] = await connection.execute('SELECT * FROM cpp_schema_migrations WHERE id=?', [migrationId]);
    if (rows[0]?.state === 'complete' && rows[0]?.checksum === checksum) return { applied: false, message: '迁移已完成，未重复执行' };
    if (rows[0]) throw new Error('发现未完成或内容不一致的迁移记录。MySQL DDL 不能整体回滚，请先人工核对或恢复测试库，不自动重试');
  }
  if (migrationId !== '001_cpp') {
    for (const required of ['projects', 'files', 'cpp_documents', 'cpp_revisions', 'cpp_runs', 'cpp_schema_migrations']) if (!names.has(required)) throw new Error(`缺少前置数据表 ${required}`);
    const [previous] = await connection.query("SELECT state FROM cpp_schema_migrations WHERE id='001_cpp'");
    if (previous[0]?.state !== 'complete') throw new Error('必须先完成 001_cpp 迁移');
  }
  if (migrationId === '001_cpp') {
  for (const required of ['users', 'classes', 'projects', 'project_groups', 'files']) if (!names.has(required)) throw new Error(`缺少原有基础表 ${required}`);
  if ([...names].some(name => name.startsWith('cpp_'))) throw new Error('发现未登记的 cpp_ 表，请先核对；不会覆盖既有结构');
  const [columns] = await connection.query("SELECT TABLE_NAME AS table_name,COLUMN_NAME AS name,COLUMN_TYPE AS type,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('projects','project_groups','users')");
  if (columns.some(column => column.name === 'project_type')) throw new Error('类别字段已经存在但迁移未登记，请人工核对后再迁移');
  const projectKey = columns.find(column => column.table_name === 'projects' && column.name === 'id');
  const userKey = columns.find(column => column.table_name === 'users' && column.name === 'id');
  if (projectKey?.type !== 'varchar(36)' || projectKey.collation !== 'utf8mb4_0900_ai_ci' || !/^int(?:\(11\))?$/.test(userKey?.type || '')) throw new Error('项目主键或用户主键与参考结构不同，请先审查类型、符号及字符排序规则');
  await connection.query("CREATE TABLE cpp_schema_migrations (id VARCHAR(64) PRIMARY KEY, checksum CHAR(64) NOT NULL, state VARCHAR(16) NOT NULL, completed_statements INT NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB");
  }
  await connection.execute("INSERT INTO cpp_schema_migrations(id,checksum,state) VALUES (?,?, 'applying')", [migrationId, checksum]);
  const statements = sql.replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  for (let index = 0; index < statements.length; index++) {
    await connection.query(statements[index]);
    await connection.execute('UPDATE cpp_schema_migrations SET completed_statements=? WHERE id=?', [index + 1, migrationId]);
  }
  await connection.execute("UPDATE cpp_schema_migrations SET state='complete' WHERE id=?", [migrationId]);
  return { applied: true, statements: statements.length };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const plans = await migrationPlans();
  if (!process.argv.includes('--apply')) {
    console.log('仅展示迁移计划；未连接或修改数据库。执行方法见 docs/deployment.md。\n'); for (const plan of plans) console.log(`-- ${plan.id}\n${plan.sql}`);
  } else {
    const config = readConfig();
    const confirmation = process.argv[process.argv.indexOf('--confirm-db') + 1];
    if (!process.argv.includes('--confirm-db') || confirmation !== config.db.database || config.mode === 'demo') throw new Error('必须指定 APP_MODE=test/production，并用 --confirm-db 完整确认目标数据库名');
    if (config.mode === 'production' && (!process.argv.includes('--backup-confirmed') || !process.argv.includes('--production-reviewed'))) throw new Error('生产迁移必须先审查变更、完成备份，再显式传入两个确认标志');
    const { connectionLimit, ...options } = config.db;
    const connection = await createConnection(options);
    try { for (const plan of plans) console.log(await applyMigration(connection, plan.sql, plan.id)); } finally { await connection.end(); }
  }
}
