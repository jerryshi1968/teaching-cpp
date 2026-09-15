import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { diagnostics, MAX_FILE_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES } from '../shared/contracts.mjs';
import { snapshot } from '../backend/src/validation.mjs';
import { MysqlRepository } from '../backend/src/repository.mjs';
import { fixture, image } from './helpers.mjs';
import { PodmanSandbox, compilerArguments } from '../runner/src/podman.mjs';
import { createFile, deleteFile, renameFile, updateFile } from '../frontend/src/project-source.mjs';

const source = (files, sources = files.filter(file => /\.cpp$/.test(file.path)).map(file => file.path)) => ({ schemaVersion: 2, entrypoint: 'main.cpp', files, stdin: '', profileId: 'cpp17', build: { sources } });
const main = content => ({ path: 'main.cpp', content });

test('旧快照读取时规范化为 main.cpp，新写入只产生 v2 完整快照', async t => {
  const { sources } = await fixture(t);
  const oldId = randomUUID();
  await fs.writeFile(sources.file(oldId), JSON.stringify({ code: 'int main(){}', stdin: '1\n', profileId: 'cpp17' }));
  const normalized = await sources.read(oldId);
  assert.deepEqual(normalized, { ...source([main('int main(){}')], ['main.cpp']), stdin: '1\n' });
  const newId = randomUUID();
  await sources.write(newId, normalized);
  const raw = JSON.parse(await fs.readFile(sources.file(newId), 'utf8'));
  assert.equal(raw.schemaVersion, 2); assert.equal(raw.code, undefined); assert.equal(raw.files[0].path, 'main.cpp');
});

test('快照拒绝危险、重复和冲突路径，并执行文件数量与大小限制', () => {
  const valid = source([main('int main(){}')]);
  for (const bad of ['', '../x.cpp', 'a/../x.cpp', '/x.cpp', 'C:\\x.cpp', 'a\\x.cpp']) assert.throws(() => snapshot({ ...valid, files: [main(''), { path: bad, content: '' }], build: { sources: ['main.cpp'] } }), error => error.code === 'INVALID_FILE_PATH');
  assert.throws(() => snapshot({ ...valid, files: [main(''), { path: 'MAIN.cpp', content: '' }] }), error => error.code === 'DUPLICATE_FILE_PATH');
  assert.throws(() => snapshot({ ...valid, files: [main(''), { path: 'lib', content: '' }, { path: 'lib/a.h', content: '' }] }), error => error.code === 'FILE_PATH_CONFLICT');
  assert.throws(() => snapshot({ ...valid, files: Array.from({ length: MAX_PROJECT_FILES + 1 }, (_, index) => ({ path: index ? `f${index}.h` : 'main.cpp', content: '' })) }), error => error.code === 'FILE_COUNT');
  assert.throws(() => snapshot(source([main('x'.repeat(MAX_FILE_BYTES + 1))])), error => error.code === 'FILE_SIZE');
  assert.throws(() => snapshot(source([main(''), ...Array.from({ length: 5 }, (_, index) => ({ path: `f${index}.h`, content: 'x'.repeat(Math.floor(MAX_PROJECT_BYTES / 5) + 1) }))])), error => error.code === 'PROJECT_SIZE');
  assert.throws(() => snapshot({ ...valid, build: { sources: ['missing.cpp'] } }), error => error.code === 'BUILD_SOURCE_MISSING');
});

test('保存、历史运行、复制和教师分发均保留完整文件集合与文件索引', async t => {
  const { service, repo, teacher, student } = await fixture(t);
  const project = await service.createProject(teacher, { name: 'multi' });
  const content = source([
    main('#include "lib/utils.h"\nint main(){return answer();}'),
    { path: 'lib/utils.cpp', content: '#include "utils.h"\nint answer(){return 42;}' },
    { path: 'lib/utils.h', content: 'int answer();\n' }
  ], ['main.cpp', 'lib/utils.cpp']);
  const saved = await service.saveProject(teacher, project.id, { ...content, version: project.version });
  assert.deepEqual((await repo.find('files', { project_id: project.id })).map(file => file.path).sort(), ['lib/utils.cpp', 'lib/utils.h', 'main.cpp']);
  const run = await service.saveAndRun(teacher, project.id, { ...content, version: saved.version, requestId: randomUUID() });
  const renamed = { ...content, files: content.files.map(file => file.path === 'lib/utils.h' ? { ...file, path: 'include/utils.h' } : file), version: run.version };
  await service.saveProject(teacher, project.id, renamed);
  assert.deepEqual((await repo.find('files', { project_id: project.id })).map(file => file.path).sort(), ['include/utils.h', 'lib/utils.cpp', 'main.cpp']);
  assert.deepEqual((await service.getRunSource(teacher, run.id)).files, snapshot(content).files);
  const copy = await service.copyProject(teacher, project.id, {});
  assert.deepEqual(copy.files, renamed.files.sort((a, b) => a.path.localeCompare(b.path, 'en')));
  const delivery = await service.distribute(teacher, project.id, { classId: 1, requestId: randomUUID() });
  assert.deepEqual((await service.getProject(student, delivery.recipients_json[0].projectId)).files, copy.files);
});

test('删除项目清空全部 C++ 数据，快照删除失败由后续垃圾回收重试', async t => {
  const { service, repo, sources, student } = await fixture(t);
  const project = await service.createProject(student, { name: 'delete-all' });
  const run = await service.saveAndRun(student, project.id, { ...project, requestId: randomUUID() });
  await service.updateRun(run.id, { state: 'completed', stdout: 'done' });
  const saved = await service.saveProject(student, project.id, { ...source([main('int main(){return 1;}')]), version: project.version });
  const revisionIds = (await repo.find('revisions', { project_id: project.id })).map(item => item.id);
  const original = sources.removeEventually.bind(sources);
  sources.removeEventually = async revision => { await fs.writeFile(sources.marker(revision), ''); return false; };
  const result = await service.deleteProject(student, project.id);
  assert.equal(result.snapshotCleanupPending, true);
  assert.equal((await repo.find('projects', { id: project.id })).length, 0);
  for (const table of ['files', 'documents', 'revisions', 'runs']) assert.equal((await repo.find(table, { project_id: project.id })).length, 0);
  assert.ok(await fs.stat(sources.file(saved.revisionId)));
  sources.removeEventually = original;
  await service.cleanup();
  for (const revisionId of revisionIds) await assert.rejects(fs.stat(sources.file(revisionId)), { code: 'ENOENT' });
});

test('Runner 安全生成嵌套文件树并按显式顺序编译多个单元', async t => {
  const { root } = await fixture(t);
  await fs.mkdir(path.join(root, 'work'));
  const config = { dataRoot: root, image, uid: 1001, gid: 1001, podman: '/usr/bin/podman', minFreeBytes: 0 };
  const job = { id: randomUUID(), image, ...source([main('int main(){}'), { path: 'src/z.cpp', content: '' }, { path: 'src/a.cpp', content: '' }], ['main.cpp', 'src/z.cpp', 'src/a.cpp']) };
  assert.deepEqual(compilerArguments(job).slice(-5), ['main.cpp', 'src/z.cpp', 'src/a.cpp', '-o', '.cpp-program']);
  const sandbox = new PodmanSandbox(config);
  sandbox.stage = async (received, phase) => { assert.equal(phase, 'compile'); assert.deepEqual(received.build.sources, job.build.sources); return { code: 1, stdout: '', stderr: 'src/a.cpp:3:2: error: bad' }; };
  const result = await sandbox.execute(job, new AbortController().signal, async () => {});
  assert.equal(result.state, 'compile_error');
  assert.equal(await fs.readFile(path.join(root, 'work', job.id, 'src', 'z.cpp'), 'utf8'), '');
  assert.deepEqual(diagnostics(result.compiler_output), [{ file: 'src/a.cpp', line: 3, column: 2, severity: 'error', message: 'bad' }]);
});

test('前端文件操作同步内容、入口点和确定的编译源列表', () => {
  let project = source([main('old')]);
  project = createFile(project, 'utils.cpp');
  project = updateFile(project, 'utils.cpp', 'int answer(){return 42;}');
  project = renameFile(project, 'utils.cpp', 'src/utils.cpp');
  assert.equal(project.files.find(file => file.path === 'src/utils.cpp').content, 'int answer(){return 42;}');
  assert.deepEqual(project.build.sources, ['main.cpp', 'src/utils.cpp']);
  project = deleteFile(project, 'src/utils.cpp');
  assert.deepEqual(project.build.sources, ['main.cpp']); assert.equal(project.files.length, 1);
  project = renameFile(project, 'main.cpp', 'app.cpp');
  assert.equal(project.entrypoint, 'app.cpp'); assert.deepEqual(project.build.sources, ['app.cpp']);
});

test('共享 files 表的每次 MySQL 读写都显式限定 C++ 项目类别', async () => {
  const statements = [];
  const db = { execute: async (sql, params) => { statements.push({ sql, params }); return sql.startsWith('SELECT') ? [[], []] : [{ affectedRows: 1, insertId: 7 }, []]; } };
  const repo = new MysqlRepository(db);
  await repo.find('files', { project_id: randomUUID() });
  await repo.insert('files', { project_id: randomUUID(), name: 'main.cpp', path: 'main.cpp' });
  await repo.update('files', { project_id: randomUUID(), path: 'main.cpp' }, { name: 'app.cpp' });
  await repo.remove('files', { project_id: randomUUID(), path: 'main.cpp' });
  assert.equal(statements.length, 4);
  for (const { sql } of statements) assert.match(sql, /project_type` = 'cpp'/);
});
