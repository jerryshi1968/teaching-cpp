import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { fixture } from './helpers.mjs';
const codeBody = project => ({ schemaVersion: 2, entrypoint: project.entrypoint, files: project.files, stdin: project.stdin, profileId: project.profileId, build: project.build, version: project.version, requestId: randomUUID() });
const withMain = (body, content) => ({ ...body, files: body.files.map(file => file.path === 'main.cpp' ? { ...file, content } : file) });
const mainCode = project => project.files.find(file => file.path === 'main.cpp').content;
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('用户、教师班级、管理员和 p5js 类别均不能越权访问或修改', async t => {
  const { service, repo, student, teacher, other, admin } = await fixture(t);
  const project = await service.createProject(student, { name: 'own' });
  assert.equal((await service.getProject(teacher, project.id)).readOnly, true);
  await rejects(service.getProject(other, project.id), 'PROJECT_NOT_FOUND');
  await rejects(service.getProject(admin, project.id), 'PROJECT_NOT_FOUND');
  await rejects(service.saveProject(teacher, project.id, codeBody(project)), 'PROJECT_NOT_FOUND');
  await rejects(service.deleteProject(teacher, project.id), 'PROJECT_NOT_FOUND');
  const legacy = { ...project, id: randomUUID(), project_type: 'p5js' };
  await repo.insert('projects', legacy);
  await rejects(service.getProject(student, legacy.id), 'PROJECT_NOT_FOUND');
  await rejects(service.deleteProject(student, legacy.id), 'PROJECT_NOT_FOUND');
  assert.equal((await service.workspace(student)).projects.length, 1);
  await repo.update('users', { id: student.id }, { class_code: 'CLASS2' });
  await rejects(service.getProject(teacher, project.id), 'PROJECT_NOT_FOUND');
  assert.equal((await service.getProject(admin, project.id)).readOnly, true);
});

test('保存失败不创建运行任务，不覆盖已保存版本', async t => {
  const { service, repo, sources, student } = await fixture(t);
  const project = await service.createProject(student, { name: 'disk failure' });
  sources.write = async () => { throw new Error('simulated disk full'); };
  await assert.rejects(service.saveAndRun(student, project.id, withMain(codeBody(project), 'changed')), /disk full/);
  assert.equal((await repo.find('runs')).length, 0);
  assert.equal(mainCode(await service.getProject(student, project.id)), mainCode(project));
});

test('同版本并发保存只接受一份；提交绑定不可变代码和输入', async t => {
  const { service, student } = await fixture(t);
  const project = await service.createProject(student, { name: 'versions' });
  const results = await Promise.allSettled(['first', 'second'].map(code => service.saveProject(student, project.id, withMain(codeBody(project), code))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  const latest = await service.getProject(student, project.id);
  const body = { ...codeBody(latest), stdin: '10 20' };
  const run = await service.saveAndRun(student, project.id, body);
  await service.saveProject(student, project.id, { ...withMain(body, 'edited later'), version: run.version, stdin: '30 40' });
  const snapshot = await service.getRunSource(student, run.id);
  assert.equal(mainCode(snapshot), mainCode(latest)); assert.equal(snapshot.stdin, '10 20');
  assert.equal((await service.saveAndRun(student, project.id, body)).id, run.id);
  await rejects(service.saveAndRun(student, project.id, withMain(body, 'different')), 'REQUEST_CONFLICT');
});

test('拒绝重复运行，每人一个；完成前停止不会释放执行槽', async t => {
  const { service, student } = await fixture(t);
  const project = await service.createProject(student, { name: 'deduplicate' });
  const settled = await Promise.allSettled([1, 2, 3].map(() => service.saveAndRun(student, project.id, codeBody(project))));
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
  const run = settled.find(item => item.status === 'fulfilled').value;
  assert.equal((await service.nextRun()).id, run.id);
  assert.equal((await service.stopRun(student, run.id)).state, 'stopping');
  assert.equal((await service.nextRun()).id, run.id);
  await rejects(service.saveAndRun(student, project.id, codeBody(project)), 'RUN_ACTIVE');
  await service.updateRun(run.id, { state: 'cancelled' });
  assert.equal(await service.nextRun(), null);
});

test('并发 21 人只接受 20 个未完成任务，按入队顺序单任务调度', async t => {
  const { service, repo } = await fixture(t);
  const entries = [];
  for (let i = 10; i < 31; i++) {
    const user = { id: i, username: `s${i}`, role: 'student', class_code: null };
    await repo.insert('users', user);
    entries.push([user, await service.createProject(user, { name: 'queue' })]);
  }
  const results = await Promise.allSettled(entries.map(([user, project]) => service.saveAndRun(user, project.id, codeBody(project))));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 20);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'QUEUE_FULL');
  const queue = (await repo.find('runs')).sort((a, b) => a.queue_order - b.queue_order);
  assert.equal((await service.nextRun()).id, queue[0].id);
  assert.equal((await service.nextRun()).id, queue[0].id);
  await service.updateRun(queue[0].id, { state: 'completed', stdout: 'done' });
  assert.equal((await service.nextRun()).id, queue[1].id);
});

test('队列满和执行未启用仍保存内容，但不伪造运行结果', async t => {
  const { service, student, repo } = await fixture(t, { runEnabled: false });
  const project = await service.createProject(student, { name: 'disabled' });
  await assert.rejects(service.saveAndRun(student, project.id, withMain(codeBody(project), 'saved first')), error => error.code === 'RUNNER_DISABLED' && error.details.saved === true);
  assert.equal(mainCode(await service.getProject(student, project.id)), 'saved first');
  assert.equal((await repo.find('runs')).length, 0);
});

test('作品组拒绝循环、跨用户和跨类别移动，非空组不能删除', async t => {
  const { service, repo, student, other } = await fixture(t);
  const parent = await service.createGroup(student, { name: 'parent' });
  const child = await service.createGroup(student, { name: 'child', parentId: parent.id });
  await rejects(service.updateGroup(student, parent.id, { parentId: child.id }), 'GROUP_CYCLE');
  const foreign = await service.createGroup(other, { name: 'foreign' });
  await rejects(service.createProject(student, { name: 'bad', parentId: foreign.id }), 'INVALID_GROUP');
  const legacy = await repo.insert('groups', { name: 'legacy', user_id: student.id, project_type: 'p5js', parent_id: null });
  await rejects(service.createProject(student, { name: 'bad', parentId: legacy }), 'INVALID_GROUP');
  await rejects(service.deleteGroup(student, parent.id), 'GROUP_NOT_EMPTY');
  await rejects(service.reorder(student, 'groups', { parentId: null, ids: [parent.id, legacy] }), 'INVALID_ORDER');
});

test('模板分发仅本班，重试不重复，副本独立且不扣余额', async t => {
  const { service, repo, teacher, student, other } = await fixture(t);
  const source = await service.createProject(teacher, { name: 'template', exampleId: 'sum' });
  const body = { classId: 1, requestId: randomUUID() };
  const [a, b] = await Promise.all([service.distribute(teacher, source.id, body), service.distribute(teacher, source.id, body)]);
  assert.equal(a.id, b.id); assert.equal(a.recipients_json.length, 1);
  assert.equal((await service.workspace(other)).projects.length, 0);
  const copy = await service.getProject(student, a.recipients_json[0].projectId);
  await service.saveProject(student, copy.id, withMain(codeBody(copy), 'own edit'));
  assert.equal(mainCode(await service.getProject(teacher, source.id)), mainCode(source));
  await rejects(service.distribute(teacher, source.id, { ...body, classId: 2 }), 'CLASS_NOT_FOUND');
  assert.equal((await repo.one('users', { id: student.id })).tokens, 100);
});

test('教师分发覆盖班级第一位学生并使用 p5.js 来源前缀', async t => {
  const { service, repo, teacher, student } = await fixture(t);
  const second = { id: 5, username: 'Second', role: 'student', class_code: 'CLASS1', tokens: 100 };
  const third = { id: 6, username: 'Third', role: 'student', class_code: 'CLASS1', tokens: 100 };
  await repo.insert('users', second); await repo.insert('users', third);
  const source = await service.createProject(teacher, { name: 'lesson' });
  const delivery = await service.distribute(teacher, source.id, { classId: 1, requestId: randomUUID() });
  assert.deepEqual(delivery.recipients_json.map(item => item.userId).sort((a, b) => a - b), [student.id, second.id, third.id]);
  assert.equal(delivery.recipients_json[0].userId, student.id);
  for (const recipient of [student, second, third]) {
    const item = delivery.recipients_json.find(copy => copy.userId === recipient.id);
    const copy = await service.getProject(recipient, item.projectId);
    assert.equal(copy.name, '来自Teacher - lesson'); assert.equal(copy.parent_id, null);
  }
});

test('一天及容量清理只清历史，保护当前正式源码和未完成任务', async t => {
  const { service, repo, sources, student } = await fixture(t, { userCacheBytes: 1, globalCacheBytes: 1 });
  const project = await service.createProject(student, { name: 'cleanup' });
  const run = await service.saveAndRun(student, project.id, codeBody(project));
  const saved = await service.saveProject(student, project.id, withMain(codeBody(project), 'current'));
  await repo.update('revisions', {}, { created_at: '2000-01-01T00:00:00.000Z' });
  await service.cleanup();
  assert.equal(mainCode(await sources.read(run.revision_id)), mainCode(project));
  assert.equal(mainCode(await sources.read(saved.revisionId)), 'current');
  await service.updateRun(run.id, { state: 'completed', stdout: 'large' });
  await service.cleanup();
  assert.equal((await repo.find('runs')).length, 0);
  await assert.rejects(fs.stat(sources.file(run.revision_id)), { code: 'ENOENT' });
  assert.equal(mainCode(await service.getProject(student, project.id)), 'current');
});

test('生产写入开关关闭时所有写入被拒绝', async t => {
  const { service, student } = await fixture(t, { writesEnabled: false });
  await rejects(service.createProject(student, { name: 'blocked' }), 'WRITES_DISABLED');
  await rejects(service.createGroup(student, { name: 'blocked' }), 'WRITES_DISABLED');
});
