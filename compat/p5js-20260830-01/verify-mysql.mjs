import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';
import { MysqlRepository } from '../../backend/src/repository.mjs';

// 专用测试入口：库名固定，拒绝非空库；不改生产 .env、不建立 HTTP 服务、不执行学生代码。
// 测试结束保留这个测试库供核对；没有自动删库、清库或覆盖已有表的操作。
const TEST_DATABASE = 'teachingcpp20260830test';
const root = import.meta.dirname;
const appRoot = path.resolve(root, '../..');
const migrationHash = 'd4436515e0059ec67212c52ad5a1caefdeec954566ba746c36fe59959c496041';
const hash = value => createHash('sha256').update(value).digest('hex');
const args = process.argv.slice(2);
const baseSql = fs.readFileSync(path.join(root, 'mysql-fixture.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.join(appRoot, 'backend/migrations/001_cpp.sql'), 'utf8');
let stage = '材料校验';
let raw;
let passed = 0;

function inspectMaterials() {
  assert.equal(hash(migrationSql), migrationHash, '迁移文件不属于本次核验版本');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.map(file => file.path).sort(), [
    'models/fileModel.js', 'models/projectGroupModel.js', 'models/projectModel.js'
  ]);
  for (const file of manifest.files) {
    assert.equal(hash(fs.readFileSync(path.join(root, 'reference', file.path))), file.originalSha256);
    assert.equal(hash(fs.readFileSync(path.join(root, 'patched', file.path))), file.patchedSha256);
  }
  for (const sql of [baseSql, migrationSql]) {
    assert.doesNotMatch(sql, /\b(?:teaching_p5js|qbank)\b/i);
    assert.doesNotMatch(sql, /\b(?:DROP\s+DATABASE|CREATE\s+DATABASE|USE\s+|GRANT\s+|REVOKE\s+)/i);
  }
}

function guarded(connection) {
  const checkSql = sql => {
    assert.equal(typeof sql, 'string');
    assert.doesNotMatch(sql, /\b(?:teaching_p5js|qbank)\b/i);
    assert.doesNotMatch(sql, /\b(?:DROP\s+DATABASE|CREATE\s+DATABASE|USE\s+|GRANT\s+|REVOKE\s+)/i);
  };
  return {
    query(sql, params = []) { checkSql(sql); return connection.query({ sql, timeout: 10000 }, params); },
    execute(sql, params = []) { checkSql(sql); return connection.execute({ sql, timeout: 10000 }, params); },
    beginTransaction: () => connection.beginTransaction(),
    commit: () => connection.commit(),
    rollback: () => connection.rollback(),
    release() {}
  };
}

function loadModel(variant, name, db) {
  assert.ok(['reference', 'patched'].includes(variant));
  assert.ok(['projectModel', 'projectGroupModel', 'fileModel'].includes(name));
  const filename = path.join(root, variant, 'models', name + '.js');
  const module = { exports: {} };
  compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module', 'exports'], { filename })(
    id => { assert.equal(id, '../config/db'); return db; }, module, module.exports
  );
  return module.exports;
}

async function run(options) {
  const { applyMigration } = await import('../../backend/src/migrate.mjs');
  stage = '连接指定测试库';
  raw = await createConnection(options);
  const connection = guarded(raw);
  const rows = async (sql, params = []) => (await connection.query(sql, params))[0];
  const info = (await rows('SELECT DATABASE() AS db,VERSION() AS version,@@sql_mode AS sql_mode'))[0];
  assert.equal(info.db, TEST_DATABASE);
  assert.match(info.version, /^8\.4\./);
  console.log('目标测试库：' + info.db + '；MySQL：' + info.version);
  console.log('sql_mode：' + info.sql_mode);
  await connection.query('SET SESSION innodb_lock_wait_timeout=3');
  await connection.query('SET SESSION lock_wait_timeout=5');
  await connection.query('SET SESSION max_execution_time=5000');
  stage = '测试库空库及并发检查';
  assert.equal(Number((await rows('SELECT GET_LOCK(?,0) AS acquired', [TEST_DATABASE + ':verify']))[0].acquired), 1);
  for (const catalog of ['TABLES', 'ROUTINES', 'EVENTS', 'TRIGGERS']) {
    const column = catalog === 'ROUTINES' ? 'ROUTINE_SCHEMA' : catalog === 'EVENTS' ? 'EVENT_SCHEMA' : catalog === 'TRIGGERS' ? 'TRIGGER_SCHEMA' : 'TABLE_SCHEMA';
    const count = (await rows(`SELECT COUNT(*) AS total FROM information_schema.${catalog} WHERE ${column}=?`, [TEST_DATABASE]))[0].total;
    assert.equal(Number(count), 0, '指定测试库不是空库');
  }
  const db = { ...connection, getConnection: async () => connection };
  const Project = loadModel('patched', 'projectModel', db);
  const Group = loadModel('patched', 'projectGroupModel', db);
  const File = loadModel('patched', 'fileModel', db);
  const ids = values => Array.from(values, item => item.id).sort();
  const student = { id: 1, role: 'student' };
  const teacher = { id: 2, role: 'teacher' };
  const snapshot = async type => ({
    projects: await rows('SELECT * FROM projects WHERE project_type=? ORDER BY id', [type]),
    groups: await rows('SELECT * FROM project_groups WHERE project_type=? ORDER BY id', [type]),
    files: await rows('SELECT f.* FROM files f JOIN projects p ON p.id=f.project_id WHERE p.project_type=? ORDER BY f.id', [type])
  });
  let originalCpp;
  async function check(name, action) {
    stage = name;
    await action();
    if (originalCpp) assert.deepEqual(await snapshot('cpp'), originalCpp, 'C++ 虚拟记录被意外修改');
    console.log('通过 ' + (++passed) + '：' + name);
  }

  await check('创建独立虚拟数据，并验证原 p5.js 模型在迁移前可用', async () => {
    for (const sql of baseSql.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
      await connection.query(sql);
    }
    const Original = loadModel('reference', 'projectModel', db);
    assert.deepEqual(ids(await Original.listForUser(1)), ['p-root', 'p-second']);
  });
  await check('实际执行迁移，原有字段和值不变，原项目默认归为 p5js', async () => {
    const before = {};
    for (const table of ['users', 'classes', 'projects', 'project_groups', 'files']) before[table] = await rows(`SELECT * FROM ${table} ORDER BY id`);
    const result = await applyMigration(connection, migrationSql);
    assert.equal(result.applied, true);
    for (const table of Object.keys(before)) {
      const after = await rows(`SELECT * FROM ${table} ORDER BY id`);
      if (['projects', 'project_groups'].includes(table)) {
        for (const row of after) { assert.equal(row.project_type, 'p5js'); delete row.project_type; }
      }
      assert.deepEqual(after, before[table]);
    }
    assert.equal((await applyMigration(connection, migrationSql)).applied, false);
    await assert.rejects(applyMigration(connection, migrationSql + '\n'));
    assert.equal((await rows("SELECT state FROM cpp_schema_migrations WHERE id='001_cpp'"))[0].state, 'complete');
  });
  await check('建立混合平台虚拟数据，确认原模型确实会混入 C++', async () => {
    await connection.query("INSERT INTO project_groups(id,user_id,name,parent_id,sort_order,project_type) VALUES (21,1,'cpp-root',NULL,41,'cpp'),(22,1,'cpp-child',21,42,'cpp'),(23,1,'cpp-empty',NULL,43,'cpp')");
    await connection.query("INSERT INTO projects(id,user_id,name,parent_id,sort_order,project_type) VALUES ('cpp-root',1,'cpp-root',NULL,51,'cpp'),('cpp-child',1,'cpp-child',21,52,'cpp'),('cpp-other',3,'cpp-other',NULL,61,'cpp'),('cpp-teacher',2,'cpp-teacher',NULL,71,'cpp')");
    await connection.query("INSERT INTO files(id,project_id,name,path) VALUES (4,'cpp-root','main.cpp','./main.cpp'),(5,'cpp-child','main.cpp','./main.cpp')");
    assert.ok(ids(await loadModel('reference', 'projectModel', db).listForUser(1)).includes('cpp-root'));
    assert.equal((await loadModel('reference', 'fileModel', db).findById(4)).project_id, 'cpp-root');
    originalCpp = await snapshot('cpp');
  });
  await check('学生、教师、管理员列表和搜索按平台及班级筛选', async () => {
    assert.deepEqual(ids(await Project.listForUser(1)), ['p-root', 'p-second']);
    assert.deepEqual(ids(await Project.listForUser(1, 11)), ['p-child']);
    assert.deepEqual(await Project.listForUser(1, 21), []);
    assert.deepEqual(ids(await Project.listVisibleToUser({ currentUser: teacher, studentId: 1 })), ['p-root', 'p-second']);
    assert.deepEqual(await Project.listVisibleToUser({ currentUser: teacher, studentId: 3 }), []);
    assert.equal(await Project.listVisibleToUser({ currentUser: student, studentId: 3 }), null);
    assert.equal((await Project.listAdminPaginated({ limit: 100, offset: 0 })).length, 6);
    assert.equal(await Project.countAdminProjects(), 6);
    assert.equal((await Project.listAdminPaginated({ limit: 100, offset: 0, authorName: 'fixture-alice' })).length, 4);
    assert.equal(await Project.countAdminProjects({ authorName: 'fixture-alice' }), 4);
  });
  await check('项目按 ID 查询、所有权及教师范围校验', async () => {
    assert.equal(await Project.findOwnedById('cpp-root', 1), null);
    assert.equal(await Project.findOwnedById('p-root', 3), null);
    assert.equal(await Project.findOwnedByIdWithConnection(connection, 'cpp-root', 1), null);
    assert.equal((await Project.findOwnedByIdWithConnection(connection, 'p-root', 1)).id, 'p-root');
    for (const user of [student, teacher, { id: 5, role: 'admin' }]) {
      assert.equal(await Project.findAccessibleById('cpp-root', user), null);
      assert.equal(await Project.findAccessibleWithOwnerById('cpp-root', user), null);
    }
    assert.equal((await Project.findAccessibleWithOwnerById('p-root', teacher)).owner_name, 'fixture-alice');
    assert.equal((await Project.findAccessibleById('p-teacher', teacher)).id, 'p-teacher');
    assert.equal(await Project.findAccessibleById('p-other', teacher), null);
  });
  await check('作品组递归查询、面包屑、计数与权限校验', async () => {
    assert.deepEqual(ids(await Group.listForUser({ userId: 1 })), [11, 13]);
    assert.deepEqual(ids(await Group.listAllForUser(1)), [11, 12, 13]);
    assert.equal(await Group.findOwnedById({ id: 21, userId: 1 }), null);
    assert.equal(await Group.findOwnedById({ id: 11, userId: 3 }), null);
    assert.deepEqual(ids(await Group.getBreadcrumbs({ userId: 1, groupId: 12 })), [11, 12]);
    assert.deepEqual(await Group.getBreadcrumbs({ userId: 1, groupId: 22 }), []);
    assert.equal(await Group.isDescendantOf({ userId: 1, groupId: 11, possibleDescendantId: 12 }), true);
    assert.equal(await Group.isDescendantOf({ userId: 1, groupId: 21, possibleDescendantId: 22 }), false);
    assert.equal(await Group.countProjectsRecursive({ userId: 1, groupId: 11 }), 2);
    assert.equal(await Group.countDescendantGroups({ userId: 1, groupId: 11 }), 1);
    for (const groupId of [21, 31]) {
      assert.equal(await Group.countProjectsRecursive({ userId: 1, groupId }), 0);
      assert.equal(await Group.countDescendantGroups({ userId: 1, groupId }), 0);
    }
  });
  await check('文件读取、路径查询和所有权校验', async () => {
    assert.deepEqual(await File.findByProjectId('cpp-root'), []);
    assert.equal(await File.findByProjectAndPath('cpp-root', './main.cpp'), null);
    assert.equal(await File.findById(4), null);
    assert.equal(await File.findOwnedFile(4, 1), null);
    assert.equal(await File.findOwnedFile(1, 3), null);
    assert.equal((await File.findByProjectAndPath('p-root', './index.html')).id, 1);
    assert.equal((await File.findOwnedFile(1, 1)).project_id, 'p-root');
  });
  await check('C++ 仓储查询和修改反向隔离 p5.js', async () => {
    const before = await snapshot('p5js');
    const repo = new MysqlRepository(db);
    await repo.checkSchema();
    assert.deepEqual(ids(await repo.find('projects', { user_id: 1 })), ['cpp-child', 'cpp-root']);
    assert.equal(await repo.one('projects', { id: 'p-root' }), null);
    assert.equal(await repo.one('groups', { id: 11 }), null);
    assert.equal(await repo.update('projects', { id: 'p-root' }, { name: 'bad' }), 0);
    assert.equal(await repo.remove('projects', { id: 'p-root' }), 0);
    assert.equal(await repo.update('groups', { id: 11 }, { name: 'bad' }), 0);
    assert.equal(await repo.remove('groups', { id: 11 }), 0);
    await repo.transaction(async tx => assert.equal(await tx.one('projects', { id: 'p-root' }), null));
    assert.deepEqual(await snapshot('p5js'), before);
  });
  await check('项目、作品组、文件修改均不能碰到 C++ 虚拟记录', async () => {
    assert.equal(await Project.updateName({ projectId: 'cpp-root', userId: 1, name: 'bad' }), 0);
    assert.equal(await Project.move({ projectId: 'cpp-root', userId: 1, parentId: 11 }), 0);
    await Project.reorder({ userId: 1, orderedIds: ['cpp-root', 'p-root', 'p-second'] });
    assert.equal(await Project.clearParentId({ userId: 1, parentId: 21 }), 0);
    assert.equal(await Project.deleteById('cpp-root'), 0);
    assert.equal(await Group.updateName({ id: 21, userId: 1, name: 'bad' }), 0);
    assert.equal(await Group.move({ id: 21, userId: 1, parentId: 11 }), 0);
    await Group.reorder({ userId: 1, orderedIds: [21, 23, 13, 11] });
    assert.equal(await Group.deleteEmptyById({ id: 23, userId: 1 }), 0);
    assert.equal(await File.updateNameAndPath({ fileId: 4, name: 'bad', path: './bad' }), 0);
    assert.equal(await File.touchUpdatedAt(4), 0);
    assert.equal(await File.updateChildPaths({ projectId: 'cpp-root', oldPrefix: '.', newPrefix: './bad' }), 0);
    assert.equal(await File.deleteByPathPrefix({ projectId: 'cpp-root', pathPrefix: '.' }), 0);
    assert.equal(await File.deleteById(4), 0);
    assert.equal(await File.deleteByProjectIdWithConnection(connection, 'cpp-root'), 0);
  });
  await check('项目拖动事务限制类别、目标、参考项及用户', async () => {
    for (const [input, expected] of [
      [{ projectId: 'cpp-root', userId: 1 }, 'not_found'],
      [{ projectId: 'p-root', userId: 1, parentId: 21 }, 'invalid_parent'],
      [{ projectId: 'p-root', userId: 1, parentId: 31 }, 'invalid_parent'],
      [{ projectId: 'p-root', userId: 1, beforeId: 'cpp-root' }, 'invalid_before']
    ]) assert.equal((await Project.reposition(input)).status, expected);
    assert.equal((await Project.reposition({ projectId: 'p-second', userId: 1, parentId: 11, beforeId: 'p-child' })).status, 'updated');
    assert.equal((await Project.findOwnedById('p-second', 1)).parent_id, 11);
  });
  await check('作品组拖动事务拒绝跨类、跨用户及递归循环', async () => {
    for (const [input, expected] of [
      [{ id: 21, userId: 1 }, 'not_found'],
      [{ id: 11, userId: 1, parentId: 21 }, 'invalid_parent'],
      [{ id: 11, userId: 1, parentId: 31 }, 'invalid_parent'],
      [{ id: 11, userId: 1, beforeId: 21 }, 'invalid_before'],
      [{ id: 11, userId: 1, parentId: 12 }, 'descendant']
    ]) assert.equal((await Group.reposition(input)).status, expected);
    assert.equal((await Group.reposition({ id: 13, userId: 1, parentId: 11, beforeId: 12 })).status, 'updated');
    assert.equal((await Group.findOwnedById({ id: 13, userId: 1 })).parent_id, 11);
  });
  await check('新增项目与作品组显式写入 p5js，两条文件创建入口拒绝跨类', async () => {
    await connection.query("ALTER TABLE projects ALTER COLUMN project_type SET DEFAULT 'cpp'");
    await connection.query("ALTER TABLE project_groups ALTER COLUMN project_type SET DEFAULT 'cpp'");
    await Project.createWithConnection(connection, { id: 'p-new', userId: 1, name: 'new' });
    const groupId = await Group.create({ userId: 1, name: 'new', parentId: 11 });
    assert.equal((await rows("SELECT project_type FROM projects WHERE id='p-new'"))[0].project_type, 'p5js');
    assert.equal((await rows('SELECT project_type FROM project_groups WHERE id=?', [groupId]))[0].project_type, 'p5js');
    await connection.query("ALTER TABLE projects ALTER COLUMN project_type SET DEFAULT 'p5js'");
    await connection.query("ALTER TABLE project_groups ALTER COLUMN project_type SET DEFAULT 'p5js'");
    for (const projectId of ['cpp-root', 'missing']) {
      const values = { projectId, name: 'bad.js', path: './bad.js' };
      await assert.rejects(File.create(values), error => error.statusCode === 404);
      await assert.rejects(File.createWithConnection(connection, values), error => error.statusCode === 404);
    }
    await File.createWithConnection(connection, { projectId: 'p-new', name: 'index.html', path: './index.html' });
    const created = await File.create({ projectId: 'p-root', name: 'new.js', path: './new.js' });
    assert.equal((await File.findById(created.id)).name, 'new.js');
  });
  await check('p5.js 文件更新、路径替换、删除和项目级联保持可用', async () => {
    assert.equal(await File.updateNameAndPath({ fileId: 2, name: 'renamed', path: './renamed' }), 1);
    assert.equal(await File.updateChildPaths({ projectId: 'p-root', oldPrefix: './folder', newPrefix: './renamed' }), 1);
    assert.equal((await File.findById(3)).path, './renamed/a.js');
    await connection.query("UPDATE files SET updated_at='2020-01-01 00:00:00' WHERE id=3");
    assert.equal(await File.touchUpdatedAt(3), 1);
    assert.equal(await File.deleteByPathPrefix({ projectId: 'p-root', pathPrefix: './renamed' }), 1);
    assert.equal(await File.deleteById(2), 1);
    assert.equal(await File.deleteByProjectIdWithConnection(connection, 'p-new'), 1);
    await File.createWithConnection(connection, { projectId: 'p-new', name: 'index.html', path: './index.html' });
    assert.equal(await Project.deleteById('p-new'), 1);
    assert.deepEqual(await rows("SELECT id FROM files WHERE project_id='p-new'"), []);
  });
  await check('示例导入所用的清空再创建事务能整体回滚', async () => {
    const before = await rows("SELECT * FROM files WHERE project_id='p-root' ORDER BY id");
    await connection.beginTransaction();
    try {
      assert.ok(await Project.findOwnedByIdWithConnection(connection, 'p-root', 1));
      await File.deleteByProjectIdWithConnection(connection, 'p-root');
      await File.createWithConnection(connection, { projectId: 'p-root', name: 'temporary.html', path: './temporary.html' });
    } finally { await connection.rollback(); }
    assert.deepEqual(await rows("SELECT * FROM files WHERE project_id='p-root' ORDER BY id"), before);
  });
  await check('两个连接验证 FOR UPDATE 行锁和回滚释放', async () => {
    const secondRaw = await createConnection(options);
    const second = guarded(secondRaw);
    try {
      assert.equal((await second.query('SELECT DATABASE() AS db'))[0][0].db, TEST_DATABASE);
      await second.query('SET SESSION innodb_lock_wait_timeout=1');
      await connection.beginTransaction();
      try {
        assert.ok(await Project.findOwnedByIdWithConnection(connection, 'p-root', 1));
        await assert.rejects(second.query("UPDATE projects SET name='lock-test' WHERE id='p-root'"), error => error.code === 'ER_LOCK_WAIT_TIMEOUT');
      } finally { await connection.rollback(); }
      await second.beginTransaction();
      try {
        assert.equal((await second.query("UPDATE projects SET name='lock-released' WHERE id='p-root'"))[0].affectedRows, 1);
      } finally { await second.rollback(); }
      assert.equal((await rows("SELECT name FROM projects WHERE id='p-root'"))[0].name, 'p-root');
    } finally { await secondRaw.end(); }
  });
  await check('正常项目与作品组改名、移动、清理和删除仍可用', async () => {
    assert.equal(await Project.updateName({ projectId: 'p-root', userId: 1, name: 'renamed-p5' }), 1);
    assert.equal(await Project.move({ projectId: 'p-root', userId: 1, parentId: 13 }), 1);
    assert.equal(await Project.clearParentId({ userId: 1, parentId: 13 }), 1);
    assert.equal(await Group.updateName({ id: 13, userId: 1, name: 'renamed-group' }), 1);
    assert.equal(await Group.move({ id: 13, userId: 1, parentId: null }), 1);
    assert.equal(await Group.deleteEmptyById({ id: 13, userId: 1 }), 1);
  });
  console.log('MySQL 验证完成：' + passed + ' 项通过；虚拟 C++ 记录未被旧平台模型改动。');
  console.log('测试库已保留供核查，不能直接重复运行。未连接正式库、未部署补丁、未启动服务。');
}

try {
  inspectMaterials();
  if (args.length === 0 || (args.length === 1 && args[0] === '--check-only')) {
    console.log('材料校验通过；未读取数据库密码、未连接数据库。');
    console.log('仅在专用空测试库建好后使用 --run --confirm-empty-test-db ' + TEST_DATABASE);
  } else {
    stage = '启动参数及服务器配置';
    assert.deepEqual(args, ['--run', '--confirm-empty-test-db', TEST_DATABASE]);
    const env = dotenv.parse(fs.readFileSync(path.join(appRoot, '.env')));
    assert.equal(env.DB_HOST, '127.0.0.1');
    assert.equal(env.DB_PORT, '3306');
    assert.equal(env.DB_USER, 'dbadmin');
    assert.equal(env.DB_NAME, 'teaching_p5js');
    assert.equal(env.APP_MODE, 'production');
    assert.equal(env.CPP_PRODUCTION_WRITES, 'disabled');
    assert.equal(env.CPP_RUN_ENABLED, 'false');
    assert.ok(env.DB_PASSWORD && env.DB_PASSWORD !== 'REPLACE_ON_SERVER');
    await run({
      host: '127.0.0.1', port: 3306, user: env.DB_USER, password: env.DB_PASSWORD,
      database: TEST_DATABASE, charset: 'utf8mb4', timezone: 'Z', dateStrings: true,
      connectTimeout: 10000, multipleStatements: false, enableKeepAlive: true
    });
  }
} catch (error) {
  console.error('验证未完成；阶段：' + stage + '；错误码：' + (error.code || 'VERIFY_FAILED'));
  console.error('请保留现场，不要覆盖表、清库或重跑；不要发送密码或 .env。');
  process.exitCode = 1;
} finally {
  if (raw) await raw.end().catch(() => { process.exitCode = 1; });
}
