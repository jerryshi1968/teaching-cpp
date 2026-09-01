import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { fixture } from './helpers.mjs';
const codeBody = project => ({ code: project.code, stdin: project.stdin, profileId: project.profileId, version: project.version, requestId: randomUUID() });
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
  await assert.rejects(service.saveAndRun(student, project.id, { ...codeBody(project), code: 'changed' }), /disk full/);
  assert.equal((await repo.find('runs')).length, 0);
  assert.equal((await service.getProject(student, project.id)).code, project.code);
});

test('同版本并发保存只接受一份；提交绑定不可变代码和输入', async t => {
  const { service, student } = await fixture(t);
  const project = await service.createProject(student, { name: 'versions' });
  const results = await Promise.allSettled(['first', 'second'].map(code => service.saveProject(student, project.id, { ...codeBody(project), code })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  const latest = await service.getProject(student, project.id);
  const body = { ...codeBody(latest), stdin: '10 20' };
  const run = await service.saveAndRun(student, project.id, body);
  await service.saveProject(student, project.id, { ...body, version: run.version, code: 'edited later', stdin: '30 40' });
  const snapshot = await service.getRunSource(student, run.id);
  assert.equal(snapshot.code, latest.code); assert.equal(snapshot.stdin, '10 20');
  assert.equal((await service.saveAndRun(student, project.id, body)).id, run.id);
  await rejects(service.saveAndRun(student, project.id, { ...body, code: 'different' }), 'REQUEST_CONFLICT');
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
  await assert.rejects(service.saveAndRun(student, project.id, { ...codeBody(project), code: 'saved first' }), error => error.code === 'RUNNER_DISABLED' && error.details.saved === true);
  assert.equal((await service.getProject(student, project.id)).code, 'saved first');
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
  await service.saveProject(student, copy.id, { ...codeBody(copy), code: 'own edit' });
  assert.equal((await service.getProject(teacher, source.id)).code, source.code);
  await rejects(service.distribute(teacher, source.id, { ...body, classId: 2 }), 'CLASS_NOT_FOUND');
  assert.equal((await repo.one('users', { id: student.id })).tokens, 100);
});

test('一天及容量清理只清历史，保护当前正式源码和未完成任务', async t => {
  const { service, repo, sources, student } = await fixture(t, { userCacheBytes: 1, globalCacheBytes: 1 });
  const project = await service.createProject(student, { name: 'cleanup' });
  const run = await service.saveAndRun(student, project.id, codeBody(project));
  const saved = await service.saveProject(student, project.id, { ...codeBody(project), code: 'current' });
  await repo.update('revisions', {}, { created_at: '2000-01-01T00:00:00.000Z' });
  await service.cleanup();
  assert.equal((await sources.read(run.revision_id)).code, project.code);
  assert.equal((await sources.read(saved.revisionId)).code, 'current');
  await service.updateRun(run.id, { state: 'completed', stdout: 'large' });
  await service.cleanup();
  assert.equal((await repo.find('runs')).length, 0);
  await assert.rejects(fs.stat(sources.file(run.revision_id)), { code: 'ENOENT' });
  assert.equal((await service.getProject(student, project.id)).code, 'current');
});

test('生产写入开关关闭时所有写入被拒绝', async t => {
  const { service, student } = await fixture(t, { writesEnabled: false });
  await rejects(service.createProject(student, { name: 'blocked' }), 'WRITES_DISABLED');
  await rejects(service.createGroup(student, { name: 'blocked' }), 'WRITES_DISABLED');
});
