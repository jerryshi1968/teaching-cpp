import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { compileFunction } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

// 只读加载已核对的原控制器，注入真实补丁模型与 SQLite 虚拟数据。
// 文件、示例服务、班级分发服务、余额和联网调用均设为陷阱；这不是线上 JWT/HTTP 回归。
const appRoot = path.resolve(import.meta.dirname, '..');
const p5Root = process.env.P5JS_REFERENCE_ROOT || 'G:/teaching-p5js/backend';
const availability = { skip: !fs.existsSync(p5Root) && '未提供已核对的原 p5.js 源码目录' };
const baseline = new Map(fs.readFileSync(path.join(appRoot, 'deploy/p5js-reference-20260830.sha256'), 'utf8')
  .trim().split(/\r?\n/).map(line => [line.slice(66), line.slice(0, 64)]));
const cases = [
  ['projectController', 'getProjectById', { id: 'cpp' }, {}, 404],
  ['projectController', 'copyProject', { id: 'cpp' }, {}, 404],
  ['projectController', 'copyProject', {}, { projectId: 'cpp' }, 404],
  ['projectController', 'deleteProject', { id: 'cpp' }, {}, 404],
  ['projectController', 'updateProject', { id: 'cpp' }, { name: 'changed' }, 404],
  ['projectController', 'createProject', {}, { name: 'new', parentId: 21 }, 404],
  ['projectController', 'moveProject', { id: 'p5' }, { parentId: 21 }, 404],
  ['projectController', 'repositionProject', { id: 'p5' }, { beforeId: 'cpp' }, 400],
  ['projectController', 'distributeProjectToClass', { id: 'cpp' }, { classId: 1 }, 404, 'teacher'],
  ['projectGroupController', 'createGroup', {}, { name: 'new', parentId: 21 }, 404],
  ['projectGroupController', 'updateGroup', { id: '21' }, { name: 'new' }, 404],
  ['projectGroupController', 'moveGroup', { id: '11' }, { parentId: 21 }, 404],
  ['projectGroupController', 'deleteGroup', { id: '21' }, {}, 404],
  ['fileController', 'getProjectFiles', { projectId: 'cpp' }, {}, 403],
  ['fileController', 'createEntry', { projectId: 'cpp' }, { name: 'new.js' }, 403],
  ['fileController', 'uploadFile', { projectId: 'cpp' }, { name: 'new.js', data: 'eA==' }, 403],
  ['fileController', 'renameEntry', { id: '2' }, { name: 'new.js' }, 403],
  ['fileController', 'deleteEntry', { id: '2' }, {}, 403],
  ['fileController', 'saveFileContent', { id: '2' }, { content: 'changed' }, 403],
  ['exampleController', 'importExample', { id: 'cpp' }, { exampleId: 'shapes-and-text' }, 404],
  ['aiController', 'generateCodeSuggestion', { projectId: 'cpp' }, { prompt: 'test' }, 403]
];

function fixture(t) {
  const database = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,role TEXT,class_code TEXT);
    CREATE TABLE classes(id INTEGER PRIMARY KEY,class_code TEXT,teacher_user_id INTEGER);
    CREATE TABLE projects(id TEXT PRIMARY KEY,user_id INTEGER,name TEXT,parent_id INTEGER,sort_order INTEGER DEFAULT 0,project_type TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE project_groups(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,parent_id INTEGER,sort_order INTEGER DEFAULT 0,project_type TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE files(id INTEGER PRIMARY KEY,project_id TEXT,name TEXT,path TEXT,updated_at TEXT);
    INSERT INTO users VALUES(1,'alice','student','A');
    INSERT INTO classes VALUES(1,'A',1);
    INSERT INTO projects VALUES('p5',1,'p5',NULL,0,'p5js','2026','2026'),('cpp',1,'cpp',NULL,1,'cpp','2026','2026');
    INSERT INTO project_groups VALUES(11,1,'p5-group',NULL,0,'p5js','2026','2026'),(21,1,'cpp-group',NULL,1,'cpp','2026','2026');
    INSERT INTO files VALUES(1,'p5','sketch.js','./sketch.js','2026'),(2,'cpp','sketch.js','./sketch.js','2026');
  `);
  const connection = {
    query: async (sql, params = []) => {
      const statement = database.prepare(sql.replace(/\s+FOR UPDATE\b/g, ''));
      if (statement.columns().length) return [statement.all(...params), []];
      const result = statement.run(...params);
      return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }, []];
    },
    beginTransaction: async () => database.exec('BEGIN'),
    rollback: async () => database.exec('ROLLBACK'),
    commit: async () => database.exec('COMMIT'),
    release() {}
  };
  const db = { ...connection, getConnection: async () => connection };
  const effects = [];
  const trap = area => new Proxy({}, { get: (_, method) => async () => { effects.push(area + '.' + String(method)); throw new Error('Forbidden side effect'); } });
  function compile(filename, dependencies, verify = false) {
    const source = fs.readFileSync(filename, 'utf8');
    if (verify) {
      const relative = path.relative(p5Root, filename).split(path.sep).join('/');
      assert.equal(crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex'), baseline.get(relative));
    }
    const module = { exports: {} };
    compileFunction(source, ['require', 'module', 'exports', '__dirname', 'process', 'fetch'], { filename })(
      id => { assert.ok(Object.hasOwn(dependencies, id), 'Unexpected dependency: ' + id); return dependencies[id]; },
      module, module.exports, path.dirname(filename), { env: {} },
      async () => { effects.push('fetch'); throw new Error('Network forbidden'); }
    );
    return module.exports;
  }
  const models = {};
  for (const model of ['projectModel', 'projectGroupModel', 'fileModel']) {
    models['../models/' + model] = compile(path.join(appRoot, 'compat/p5js-20260830-01/patched/models', model + '.js'), { '../config/db': db });
  }
  const dependencies = {
    ...models, fs: { promises: trap('filesystem') }, path, crypto,
    '../models/classModel': trap('class-service'), '../models/userModel': trap('balance-or-user-service'),
    '../services/exampleService': trap('example-service')
  };
  const snapshot = () => JSON.stringify(['projects', 'project_groups', 'files'].map(table => database.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()));
  return { effects, snapshot, controller: name => compile(path.join(p5Root, 'controllers', name + '.js'), dependencies, true) };
}

for (const [controller, action, params, body, expected, role = 'student'] of cases) {
  test('旧入口拒绝跨类别且无副作用：' + controller + '.' + action + ' ' + JSON.stringify({ params, body }), availability, async t => {
    const f = fixture(t);
    const before = f.snapshot();
    const result = { status: 200 };
    const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
    const req = { params, body, query: {}, user: { id: 1, username: 'alice', role }, t: key => key };
    const handler = f.controller(controller)[action];
    assert.equal(typeof handler, 'function');
    await handler(req, res, error => { result.status = error.statusCode || 500; });
    assert.equal(result.status, expected);
    assert.deepEqual(f.effects, []);
    assert.equal(f.snapshot(), before);
  });
}

test('旧项目详情正常读取，不因类别限制误拒绝', availability, async t => {
  const f = fixture(t);
  let value;
  await f.controller('projectController').getProjectById(
    { params: { id: 'p5' }, user: { id: 1, role: 'student' } },
    { json(body) { value = body; } }, error => { throw error; }
  );
  assert.deepEqual(value, { id: 'p5', name: 'p5', canEdit: true });
  assert.deepEqual(f.effects, []);
});
