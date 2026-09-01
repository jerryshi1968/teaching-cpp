import { requireThat } from './guard.mjs';

// 本文件只由发布脚本以 cpp-web 身份启动；只读事务不创建验收作品或改变任何记录。
let pool;
try {
  requireThat(process.platform === 'linux' && process.getuid() === 995 && process.getgid() === 992, 'DB_CHECK_IDENTITY');
  requireThat(process.argv.length === 3 && ['disabled', 'enabled'].includes(process.argv[2]), 'DB_CHECK_ARGUMENT');
  const enabled = process.argv[2] === 'enabled';
  const { readConfig } = await import('../../backend/src/config.mjs');
  const { MysqlRepository } = await import('../../backend/src/repository.mjs');
  const { createPool } = await import('mysql2/promise');
  const config = readConfig();
  requireThat(config.mode === 'production' && config.writesEnabled === enabled && config.runEnabled === false, 'DB_CHECK_GATES');
  requireThat(config.db.host === '127.0.0.1' && config.db.port === 3306 && config.db.database === 'teaching_p5js' && config.db.user === 'dbadmin', 'DB_CHECK_TARGET');
  pool = createPool({ ...config.db, connectionLimit: 1, connectTimeout: 10000 });
  const connection = await pool.getConnection();
  try {
    const query = async (sql, parameters = []) => connection.execute({ sql, timeout: 10000 }, parameters);
    await query('START TRANSACTION READ ONLY');
    await new MysqlRepository({ execute: query }).checkSchema();
    const [[migration]] = await query("SELECT state, checksum FROM cpp_schema_migrations WHERE id = '001_cpp'");
    requireThat(migration?.state === 'complete' && migration.checksum === 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041', 'DB_MIGRATION_MISMATCH');
    if (!enabled) {
      for (const table of ['cpp_documents', 'cpp_revisions', 'cpp_runs', 'cpp_distributions']) {
        const [rows] = await query(`SELECT 1 FROM ${table} LIMIT 1`);
        requireThat(rows.length === 0, 'CPP_DATA_ALREADY_EXISTS');
      }
      for (const table of ['projects', 'project_groups']) {
        const [rows] = await query(`SELECT 1 FROM ${table} WHERE project_type = 'cpp' LIMIT 1`);
        requireThat(rows.length === 0, 'CPP_DATA_ALREADY_EXISTS');
      }
    }
    const [[runs]] = await query('SELECT COUNT(*) AS count FROM cpp_runs');
    requireThat(Number(runs.count) === 0, 'RUN_RECORD_UNEXPECTED');
    await query('ROLLBACK');
  } finally { connection.release(); }
  console.log(JSON.stringify({ ok: true }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: /^[A-Z][A-Z0-9_]{0,80}$/.test(error.code || '') ? error.code : 'DB_CHECK_FAILED' }));
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
