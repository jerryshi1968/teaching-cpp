import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileFunction } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

// 用隔离的内存数据验证筛选和修改行为；仅移除 SQLite 不支持的 FOR UPDATE。
// 这不验证 MySQL 方言、行锁、并发或线上路由，不能替代正式数据库集成检查。
const root = path.resolve(import.meta.dirname, '..');
function fixture(t, variant = 'patched', defaultType = 'p5js') {
  assert.ok(['p5js', 'cpp'].includes(defaultType));
  const database = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  t.after(() => database.close());
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT, role TEXT, class_code TEXT);
    CREATE TABLE classes(id INTEGER PRIMARY KEY, class_code TEXT, teacher_user_id INTEGER);
    CREATE TABLE project_groups(
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      parent_id INTEGER REFERENCES project_groups(id) ON DELETE CASCADE, sort_order INTEGER DEFAULT 0,
      project_type TEXT NOT NULL DEFAULT '${defaultType}',
      created_at TEXT DEFAULT '2026-08-30 10:00:00', updated_at TEXT DEFAULT '2026-08-30 10:00:00'
    );
    CREATE TABLE projects(
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      parent_id INTEGER REFERENCES project_groups(id) ON DELETE SET NULL, sort_order INTEGER DEFAULT 0,
      project_type TEXT NOT NULL DEFAULT '${defaultType}',
      created_at TEXT DEFAULT '2026-08-30 10:00:00', updated_at TEXT DEFAULT '2026-08-30 10:00:00'
    );
    CREATE TABLE files(
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT, path TEXT, updated_at TEXT DEFAULT '2026-08-30 10:00:00', UNIQUE(project_id,path)
    );
    INSERT INTO users VALUES (1,'alice','student','A'),(2,'teacher-a','teacher',NULL),
      (3,'bob','student','B'),(4,'teacher-b','teacher',NULL),(5,'admin','admin',NULL);
    INSERT INTO classes VALUES (1,'A',2),(2,'B',4);
    INSERT INTO project_groups(id,user_id,name,parent_id,sort_order,project_type) VALUES
      (11,1,'p-root',NULL,10,'p5js'),(12,1,'p-child',11,20,'p5js'),(13,1,'p-empty',NULL,30,'p5js'),
      (21,1,'cpp-root',NULL,41,'cpp'),(22,1,'cpp-child',21,42,'cpp'),(23,1,'cpp-empty',NULL,43,'cpp'),
      (31,3,'other-p-root',NULL,50,'p5js');
    INSERT INTO projects(id,user_id,name,parent_id,sort_order,project_type) VALUES
      ('p-root',1,'p-root',NULL,10,'p5js'),('p-second',1,'p-second',NULL,20,'p5js'),
      ('p-child',1,'p-child',11,30,'p5js'),('p-grandchild',1,'p-grandchild',12,40,'p5js'),
      ('cpp-root',1,'cpp-root',NULL,51,'cpp'),('cpp-child',1,'cpp-child',21,52,'cpp'),
      ('p-other',3,'p-other',NULL,60,'p5js'),('cpp-other',3,'cpp-other',NULL,61,'cpp'),
      ('p-teacher',2,'p-teacher',NULL,70,'p5js'),('cpp-teacher',2,'cpp-teacher',NULL,71,'cpp');
    INSERT INTO files(id,project_id,name,path) VALUES
      (1,'p-root','index.html','./index.html'),(2,'p-root','folder','./folder'),
      (3,'p-root','a.js','./folder/a.js'),(4,'cpp-root','main.cpp','./main.cpp'),
      (5,'cpp-child','main.cpp','./main.cpp'),(6,'p-other','index.html','./index.html');
  `);
  const query = async (sql, params = []) => {
    const statement = database.prepare(sql.replace(/\s+FOR UPDATE\b/g, ''));
    if (statement.columns().length) return [statement.all(...params).map(row => ({ ...row })), []];
    const result = statement.run(...params);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }, []];
  };
  const connection = {
    query,
    beginTransaction: async () => database.exec('BEGIN'),
    commit: async () => database.exec('COMMIT'),
    rollback: async () => database.exec('ROLLBACK'),
    release() {}
  };
  const pool = { query, getConnection: async () => connection };
  function model(name) {
    const filename = path.join(root, variant, 'models', name + '.js');
    const module = { exports: {} };
    compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module', 'exports'], { filename })(
      id => { assert.equal(id, '../config/db'); return pool; }, module, module.exports
    );
    return module.exports;
  }
  const rows = sql => database.prepare(sql).all().map(row => ({ ...row }));
  const cppSnapshot = () => ({
    projects: rows("SELECT * FROM projects WHERE project_type='cpp' ORDER BY id"),
    groups: rows("SELECT * FROM project_groups WHERE project_type='cpp' ORDER BY id"),
    files: rows("SELECT f.* FROM files f JOIN projects p ON p.id=f.project_id WHERE p.project_type='cpp' ORDER BY f.id")
  });
  return { database, query, connection, rows, cppSnapshot, Project: model('projectModel'), Group: model('projectGroupModel'), File: model('fileModel') };
}
const ids = rows => Array.from(rows, row => row.id).sort();
const student = { id: 1, role: 'student' };
const teacher = { id: 2, role: 'teacher' };

test('原版本确实会混入同一用户的 C++ 项目和文件', async t => {
  const { Project, File } = fixture(t, 'reference');
  assert.ok(ids(await Project.listForUser(1)).includes('cpp-root'));
  assert.equal((await File.findById(4)).project_id, 'cpp-root');
});

test('学生和教师的项目列表只包含允许访问的 p5.js 项目', async t => {
  const { Project } = fixture(t);
  assert.deepEqual(ids(await Project.listForUser(1)), ['p-root', 'p-second']);
  assert.deepEqual(ids(await Project.listForUser(1, 11)), ['p-child']);
  assert.deepEqual(ids(await Project.listForUser(1, 21)), []);
  assert.deepEqual(ids(await Project.listVisibleToUser({ currentUser: teacher, studentId: 1 })), ['p-root', 'p-second']);
  assert.deepEqual(ids(await Project.listVisibleToUser({ currentUser: teacher, studentId: 3 })), []);
  assert.equal(await Project.listVisibleToUser({ currentUser: student, studentId: 3 }), null);
});

test('项目 ID 读取保留所有权及班级限制，并拒绝 C++', async t => {
  const { Project, connection } = fixture(t);
  assert.equal(await Project.findOwnedById('cpp-root', 1), null);
  assert.equal(await Project.findOwnedById('p-root', 3), null);
  assert.equal(await Project.findOwnedByIdWithConnection(connection, 'cpp-root', 1), null);
  assert.equal((await Project.findOwnedByIdWithConnection(connection, 'p-root', 1)).id, 'p-root');
  for (const user of [student, teacher, { id: 1, role: 'teacher' }, { id: 1, role: 'admin' }]) {
    assert.equal(await Project.findAccessibleById('cpp-root', user), null);
    assert.equal(await Project.findAccessibleWithOwnerById('cpp-root', user), null);
  }
  assert.equal((await Project.findAccessibleById('p-root', teacher)).id, 'p-root');
  assert.equal((await Project.findAccessibleWithOwnerById('p-root', teacher)).owner_name, 'alice');
  assert.equal((await Project.findAccessibleById('p-teacher', teacher)).id, 'p-teacher');
  assert.equal(await Project.findAccessibleById('cpp-teacher', teacher), null);
  assert.equal(await Project.findAccessibleById('p-other', teacher), null);
});

test('管理员分页、搜索与计数使用相同的平台范围', async t => {
  const { Project } = fixture(t);
  const all = await Project.listAdminPaginated({ limit: 100, offset: 0 });
  assert.equal(all.length, 6);
  assert.ok(all.every(row => row.id.startsWith('p-')));
  assert.equal(await Project.countAdminProjects(), 6);
  assert.equal((await Project.listAdminPaginated({ limit: 100, offset: 0, authorName: 'alice' })).length, 4);
  assert.equal(await Project.countAdminProjects({ authorName: 'alice' }), 4);
});

test('项目重命名、排序、清理父组和删除不改动 C++ 数据', async t => {
  const f = fixture(t);
  const before = f.cppSnapshot();
  assert.equal(await f.Project.updateName({ projectId: 'cpp-root', userId: 1, name: 'bad' }), 0);
  assert.equal(await f.Project.move({ projectId: 'cpp-root', userId: 1, parentId: 11 }), 0);
  await f.Project.reorder({ userId: 1, orderedIds: ['cpp-root', 'p-second', 'p-root'] });
  assert.equal(await f.Project.clearParentId({ userId: 1, parentId: 21 }), 0);
  assert.equal(await f.Project.deleteById('cpp-root'), 0);
  assert.equal(await f.Project.updateName({ projectId: 'p-root', userId: 1, name: 'renamed' }), 1);
  assert.equal(await f.Project.deleteById('p-root'), 1);
  assert.deepEqual(f.cppSnapshot(), before);
});

test('项目拖动拒绝 C++ 源、目标组、排序参考和其他用户目标', async t => {
  const { Project, cppSnapshot } = fixture(t);
  const before = cppSnapshot();
  for (const [args, status] of [
    [{ projectId: 'cpp-root', userId: 1 }, 'not_found'],
    [{ projectId: 'p-root', userId: 1, parentId: 21 }, 'invalid_parent'],
    [{ projectId: 'p-root', userId: 1, parentId: 31 }, 'invalid_parent'],
    [{ projectId: 'p-root', userId: 1, beforeId: 'cpp-root' }, 'invalid_before']
  ]) assert.equal((await Project.reposition(args)).status, status);
  assert.equal((await Project.reposition({ projectId: 'p-second', userId: 1, parentId: 11, beforeId: 'p-child' })).status, 'updated');
  assert.deepEqual(cppSnapshot(), before);
});

test('新建项目显式写入 p5js，不依赖数据库默认类别', async t => {
  const { Project, File, connection, rows } = fixture(t, 'patched', 'cpp');
  await Project.createWithConnection(connection, { id: 'p-new', userId: 1, name: 'new' });
  await File.createWithConnection(connection, { projectId: 'p-new', name: 'index.html', path: './index.html' });
  assert.equal(rows("SELECT project_type FROM projects WHERE id='p-new'")[0].project_type, 'p5js');
  assert.equal((await File.findByProjectId('p-new')).length, 1);
});

test('作品组列表、面包屑和后代检测不包含 C++', async t => {
  const { Group } = fixture(t);
  assert.deepEqual(ids(await Group.listForUser({ userId: 1 })), [11, 13]);
  assert.deepEqual(ids(await Group.listAllForUser(1)), [11, 12, 13]);
  assert.equal(await Group.findOwnedById({ id: 21, userId: 1 }), null);
  assert.equal(await Group.findOwnedById({ id: 11, userId: 3 }), null);
  assert.deepEqual(ids(await Group.getBreadcrumbs({ userId: 1, groupId: 12 })), [11, 12]);
  assert.deepEqual(ids(await Group.getBreadcrumbs({ userId: 1, groupId: 22 })), []);
  assert.equal(await Group.isDescendantOf({ userId: 1, groupId: 11, possibleDescendantId: 12 }), true);
  assert.equal(await Group.isDescendantOf({ userId: 1, groupId: 21, possibleDescendantId: 22 }), false);
});

test('作品组递归计数只处理所属用户的 p5.js 子树', async t => {
  const { Group } = fixture(t);
  assert.equal(await Group.countProjectsRecursive({ userId: 1, groupId: 11 }), 2);
  assert.equal(await Group.countDescendantGroups({ userId: 1, groupId: 11 }), 1);
  for (const groupId of [21, 31]) {
    assert.equal(await Group.countProjectsRecursive({ userId: 1, groupId }), 0);
    assert.equal(await Group.countDescendantGroups({ userId: 1, groupId }), 0);
  }
});

test('作品组重命名、移动、排序和删除不能修改 C++ 组', async t => {
  const { Group, cppSnapshot } = fixture(t);
  const before = cppSnapshot();
  assert.equal(await Group.updateName({ id: 21, userId: 1, name: 'bad' }), 0);
  assert.equal(await Group.move({ id: 21, userId: 1, parentId: 11 }), 0);
  await Group.reorder({ userId: 1, orderedIds: [21, 23, 13, 11] });
  assert.equal(await Group.deleteEmptyById({ id: 23, userId: 1 }), 0);
  assert.equal(await Group.updateName({ id: 13, userId: 1, name: 'renamed' }), 1);
  assert.equal(await Group.deleteEmptyById({ id: 13, userId: 1 }), 1);
  assert.deepEqual(cppSnapshot(), before);
});

test('作品组拖动限制平台、用户、排序参考及递归循环', async t => {
  const { Group, cppSnapshot } = fixture(t);
  const before = cppSnapshot();
  for (const [args, status] of [
    [{ id: 21, userId: 1 }, 'not_found'],
    [{ id: 11, userId: 1, parentId: 21 }, 'invalid_parent'],
    [{ id: 11, userId: 1, parentId: 31 }, 'invalid_parent'],
    [{ id: 11, userId: 1, beforeId: 21 }, 'invalid_before'],
    [{ id: 11, userId: 1, parentId: 12 }, 'descendant']
  ]) assert.equal((await Group.reposition(args)).status, status);
  assert.equal((await Group.reposition({ id: 13, userId: 1, parentId: 11, beforeId: 12 })).status, 'updated');
  assert.deepEqual(cppSnapshot(), before);
});

test('新建作品组显式写入 p5js', async t => {
  const { Group, rows } = fixture(t, 'patched', 'cpp');
  const id = await Group.create({ userId: 1, name: 'new', parentId: 11 });
  assert.equal(rows('SELECT project_type FROM project_groups WHERE id=' + id)[0].project_type, 'p5js');
});

test('文件列表、路径和 ID 查询不能读取 C++ 文件', async t => {
  const { File } = fixture(t);
  assert.deepEqual(ids(await File.findByProjectId('cpp-root')), []);
  assert.equal(await File.findByProjectAndPath('cpp-root', './main.cpp'), null);
  assert.equal(await File.findById(4), null);
  assert.equal(await File.findOwnedFile(4, 1), null);
  assert.equal(await File.findOwnedFile(1, 3), null);
  assert.equal((await File.findById(1)).project_id, 'p-root');
  assert.equal((await File.findByProjectAndPath('p-root', './index.html')).id, 1);
});

test('两条文件创建入口均拒绝 C++ 或不存在的项目', async t => {
  const { File, connection, cppSnapshot } = fixture(t);
  const before = cppSnapshot();
  for (const projectId of ['cpp-root', 'missing']) {
    const data = { projectId, name: 'bad.js', path: './bad.js' };
    await assert.rejects(File.create(data), error => error.statusCode === 404);
    await assert.rejects(File.createWithConnection(connection, data), error => error.statusCode === 404);
  }
  const created = await File.create({ projectId: 'p-root', name: 'new.js', path: './new.js' });
  assert.ok(created.id > 0);
  assert.equal((await File.findById(created.id)).name, 'new.js');
  assert.deepEqual(cppSnapshot(), before);
});

test('文件更新、触碰时间戳和各删除入口都不能修改 C++ 文件', async t => {
  const { File, connection, cppSnapshot } = fixture(t);
  const before = cppSnapshot();
  assert.equal(await File.updateNameAndPath({ fileId: 4, name: 'bad', path: './bad' }), 0);
  assert.equal(await File.touchUpdatedAt(4), 0);
  assert.equal(await File.updateChildPaths({ projectId: 'cpp-root', oldPrefix: '.', newPrefix: './bad' }), 0);
  assert.equal(await File.deleteByPathPrefix({ projectId: 'cpp-root', pathPrefix: '.' }), 0);
  assert.equal(await File.deleteById(4), 0);
  assert.equal(await File.deleteByProjectIdWithConnection(connection, 'cpp-root'), 0);
  assert.deepEqual(cppSnapshot(), before);
});

test('p5.js 文件更新、目录路径更新和删除保持可用', async t => {
  const { File, connection, cppSnapshot } = fixture(t);
  const before = cppSnapshot();
  assert.equal(await File.updateNameAndPath({ fileId: 2, name: 'renamed', path: './renamed' }), 1);
  assert.equal(await File.updateChildPaths({ projectId: 'p-root', oldPrefix: './folder', newPrefix: './renamed' }), 1);
  assert.equal((await File.findById(3)).path, './renamed/a.js');
  assert.equal(await File.touchUpdatedAt(3), 1);
  assert.equal(await File.deleteByPathPrefix({ projectId: 'p-root', pathPrefix: './renamed' }), 1);
  assert.equal(await File.deleteById(2), 1);
  assert.equal(await File.deleteByProjectIdWithConnection(connection, 'p-root'), 1);
  assert.deepEqual(cppSnapshot(), before);
});

test('类别字段缺失时写操作报错，不能自动退回无类别保护的查询', async t => {
  const { database, Project, rows } = fixture(t);
  const before = rows('SELECT id,name FROM projects ORDER BY id');
  database.exec('ALTER TABLE projects DROP COLUMN project_type');
  await assert.rejects(Project.updateName({ projectId: 'cpp-root', userId: 1, name: 'bad' }));
  assert.deepEqual(rows('SELECT id,name FROM projects ORDER BY id'), before);
});
