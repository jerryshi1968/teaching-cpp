import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.mjs';

const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const ordered = async (repo, kind, userId, parentId) => (await repo.find(kind, { user_id: userId, parent_id: parentId })).sort((a, b) => a.sort_order - b.sort_order);
const assertContinuous = rows => assert.deepEqual(rows.map(row => row.sort_order), rows.map((row, index) => index));
const cppState = async repo => ({
  projects: (await repo.find('projects')).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  groups: (await repo.find('groups')).sort((a, b) => Number(a.id) - Number(b.id))
});

test('作品在同一目录中可以前移、后移并追加到末尾', async t => {
  const { service, repo, student } = await fixture(t);
  const projects = [];
  for (const title of ['A', 'B', 'C', 'D']) projects.push(await service.createProject(student, { name: title }));
  await service.repositionProject(student, projects[3].id, { parentId: null, beforeId: projects[1].id });
  assert.deepEqual((await ordered(repo, 'projects', student.id, null)).map(row => row.id), [projects[0].id, projects[3].id, projects[1].id, projects[2].id]);
  await service.repositionProject(student, projects[0].id, { parentId: null, beforeId: projects[2].id });
  assert.deepEqual((await ordered(repo, 'projects', student.id, null)).map(row => row.id), [projects[3].id, projects[1].id, projects[0].id, projects[2].id]);
  const result = await service.repositionProject(student, projects[1].id, { parentId: null, beforeId: null });
  const rows = await ordered(repo, 'projects', student.id, null);
  assert.equal(result.repositioned, true);
  assert.equal(result.project.id, projects[1].id);
  assert.deepEqual(rows.map(row => row.id), [projects[3].id, projects[0].id, projects[2].id, projects[1].id]);
  assertContinuous(rows);
});

test('作品跨目录移动会同时归一化源目录和目标目录排序', async t => {
  const { service, repo, student } = await fixture(t);
  const target = await service.createGroup(student, { name: 'Target' });
  const root = [];
  const nested = [];
  for (const title of ['Root 1', 'Root 2', 'Root 3']) root.push(await service.createProject(student, { name: title }));
  for (const title of ['Nested 1', 'Nested 2']) nested.push(await service.createProject(student, { name: title, parentId: target.id }));
  await service.repositionProject(student, root[1].id, { parentId: target.id, beforeId: nested[1].id });
  const sourceRows = await ordered(repo, 'projects', student.id, null);
  const targetRows = await ordered(repo, 'projects', student.id, target.id);
  assert.deepEqual(sourceRows.map(row => row.id), [root[0].id, root[2].id]);
  assert.deepEqual(targetRows.map(row => row.id), [nested[0].id, root[1].id, nested[1].id]);
  assertContinuous(sourceRows);
  assertContinuous(targetRows);
});

test('作品组支持同目录和跨目录定位', async t => {
  const { service, repo, student } = await fixture(t);
  const groups = [];
  for (const title of ['A', 'B', 'C']) groups.push(await service.createGroup(student, { name: title }));
  const child = await service.createGroup(student, { name: 'Child', parentId: groups[0].id });
  await service.repositionGroup(student, groups[2].id, { parentId: null, beforeId: groups[0].id });
  assert.deepEqual((await ordered(repo, 'groups', student.id, null)).map(row => row.id), [groups[2].id, groups[0].id, groups[1].id]);
  const result = await service.repositionGroup(student, groups[1].id, { parentId: groups[0].id, beforeId: child.id });
  const roots = await ordered(repo, 'groups', student.id, null);
  const children = await ordered(repo, 'groups', student.id, groups[0].id);
  assert.equal(result.repositioned, true);
  assert.equal(result.group.id, groups[1].id);
  assert.deepEqual(roots.map(row => row.id), [groups[2].id, groups[0].id]);
  assert.deepEqual(children.map(row => row.id), [groups[1].id, child.id]);
  assertContinuous(roots);
  assertContinuous(children);
});

test('作品组不能移入自身、直接子组或更深层后代', async t => {
  const { service, repo, student } = await fixture(t);
  const parent = await service.createGroup(student, { name: 'Parent' });
  const child = await service.createGroup(student, { name: 'Child', parentId: parent.id });
  const grandchild = await service.createGroup(student, { name: 'Grandchild', parentId: child.id });
  const before = await cppState(repo);
  await rejects(service.repositionGroup(student, parent.id, { parentId: parent.id, beforeId: null }), 'GROUP_CYCLE');
  await rejects(service.repositionGroup(student, parent.id, { parentId: child.id, beforeId: null }), 'GROUP_CYCLE');
  await rejects(service.repositionGroup(student, parent.id, { parentId: grandchild.id, beforeId: null }), 'GROUP_CYCLE');
  assert.deepEqual(await cppState(repo), before);
});

test('定位拒绝跨用户、跨类型以及不属于目标目录的记录', async t => {
  const { service, repo, student, other } = await fixture(t);
  const ownGroup = await service.createGroup(student, { name: 'Own' });
  const secondOwnGroup = await service.createGroup(student, { name: 'Second own' });
  const nestedGroup = await service.createGroup(student, { name: 'Nested group', parentId: ownGroup.id });
  const ownProject = await service.createProject(student, { name: 'Own project' });
  const nestedProject = await service.createProject(student, { name: 'Nested', parentId: ownGroup.id });
  const foreignGroup = await service.createGroup(other, { name: 'Foreign' });
  const foreignProject = await service.createProject(other, { name: 'Foreign project' });
  const time = new Date().toISOString();
  const p5ProjectId = randomUUID();
  await repo.insert('projects', { id: p5ProjectId, user_id: student.id, name: 'p5 project', parent_id: null, sort_order: 0, project_type: 'p5js', created_at: time, updated_at: time });
  const p5GroupId = await repo.insert('groups', { user_id: student.id, name: 'p5 group', parent_id: null, sort_order: 0, project_type: 'p5js', created_at: time, updated_at: time });
  await rejects(service.repositionProject(student, foreignProject.id, { parentId: null, beforeId: null }), 'PROJECT_NOT_FOUND');
  await rejects(service.repositionGroup(student, foreignGroup.id, { parentId: null, beforeId: null }), 'GROUP_NOT_FOUND');
  await rejects(service.repositionProject(student, ownProject.id, { parentId: foreignGroup.id, beforeId: null }), 'INVALID_GROUP');
  await rejects(service.repositionGroup(student, ownGroup.id, { parentId: foreignGroup.id, beforeId: null }), 'INVALID_GROUP');
  await rejects(service.repositionProject(student, ownProject.id, { parentId: null, beforeId: foreignProject.id }), 'INVALID_BEFORE');
  await rejects(service.repositionProject(student, ownProject.id, { parentId: null, beforeId: nestedProject.id }), 'INVALID_BEFORE');
  await rejects(service.repositionGroup(student, secondOwnGroup.id, { parentId: null, beforeId: foreignGroup.id }), 'INVALID_BEFORE');
  await rejects(service.repositionGroup(student, secondOwnGroup.id, { parentId: null, beforeId: nestedGroup.id }), 'INVALID_BEFORE');
  await rejects(service.repositionProject(student, ownProject.id, { parentId: null, beforeId: p5ProjectId }), 'INVALID_BEFORE');
  await rejects(service.repositionGroup(student, secondOwnGroup.id, { parentId: null, beforeId: p5GroupId }), 'INVALID_BEFORE');
  await rejects(service.repositionProject(student, p5ProjectId, { parentId: null, beforeId: null }), 'PROJECT_NOT_FOUND');
  await rejects(service.repositionGroup(student, p5GroupId, { parentId: null, beforeId: null }), 'GROUP_NOT_FOUND');
  await rejects(service.repositionProject(student, ownProject.id, { parentId: p5GroupId, beforeId: null }), 'INVALID_GROUP');
});

test('定位中途写入失败会完整回滚父组和全部排序', async t => {
  const { service, repo, student } = await fixture(t);
  const target = await service.createGroup(student, { name: 'Target' });
  const sourceProjects = [];
  const targetProjects = [];
  for (const title of ['Source 1', 'Source 2', 'Source 3']) sourceProjects.push(await service.createProject(student, { name: title }));
  for (const title of ['Target 1', 'Target 2']) targetProjects.push(await service.createProject(student, { name: title, parentId: target.id }));
  const before = await cppState(repo);
  const update = repo.update.bind(repo);
  let writes = 0;
  repo.update = async (...args) => {
    writes++;
    if (writes === 3) throw new Error('simulated reposition failure');
    return update(...args);
  };
  try {
    await assert.rejects(service.repositionProject(student, sourceProjects[1].id, { parentId: target.id, beforeId: targetProjects[1].id }), /simulated reposition failure/);
  } finally {
    repo.update = update;
  }
  assert.deepEqual(await cppState(repo), before);
});

test('同目录并发定位串行完成且不丢失、不重复、不破坏连续排序', async t => {
  const { service, repo, student } = await fixture(t);
  const projects = [];
  for (const title of ['A', 'B', 'C', 'D']) projects.push(await service.createProject(student, { name: title }));
  await Promise.all([
    service.repositionProject(student, projects[1].id, { parentId: null, beforeId: projects[3].id }),
    service.repositionProject(student, projects[1].id, { parentId: null, beforeId: null })
  ]);
  const rows = await ordered(repo, 'projects', student.id, null);
  assert.equal(rows.length, projects.length);
  assert.equal(new Set(rows.map(row => row.id)).size, projects.length);
  assert.deepEqual(new Set(rows.map(row => row.id)), new Set(projects.map(project => project.id)));
  assertContinuous(rows);
  assert.ok([
    [projects[0].id, projects[2].id, projects[1].id, projects[3].id],
    [projects[0].id, projects[2].id, projects[3].id, projects[1].id]
  ].some(order => order.every((id, index) => rows[index].id === id)));
});

test('旧 PATCH 同父组不改变排序，跨父组移动会追加并归一化', async t => {
  const { service, repo, student } = await fixture(t);
  const target = await service.createGroup(student, { name: 'Target' });
  const projects = [];
  for (const title of ['A', 'B', 'C']) projects.push(await service.createProject(student, { name: title }));
  const nested = await service.createProject(student, { name: 'Nested', parentId: target.id });
  await service.updateProject(student, projects[1].id, { name: 'Renamed', parentId: null });
  assert.deepEqual((await ordered(repo, 'projects', student.id, null)).map(row => row.id), projects.map(project => project.id));
  await service.updateProject(student, projects[1].id, { parentId: target.id });
  assert.deepEqual((await ordered(repo, 'projects', student.id, target.id)).map(row => row.id), [nested.id, projects[1].id]);
  assertContinuous(await ordered(repo, 'projects', student.id, null));
  assertContinuous(await ordered(repo, 'projects', student.id, target.id));

  const rootGroup = await service.createGroup(student, { name: 'Root group' });
  const siblingGroup = await service.createGroup(student, { name: 'Sibling group' });
  const childGroup = await service.createGroup(student, { name: 'Existing child', parentId: target.id });
  await service.updateGroup(student, siblingGroup.id, { name: 'Same parent', parentId: null });
  assert.deepEqual((await ordered(repo, 'groups', student.id, null)).map(row => row.id), [target.id, rootGroup.id, siblingGroup.id]);
  await service.updateGroup(student, siblingGroup.id, { parentId: target.id });
  assert.deepEqual((await ordered(repo, 'groups', student.id, target.id)).map(row => row.id), [childGroup.id, siblingGroup.id]);
  assertContinuous(await ordered(repo, 'groups', student.id, null));
  assertContinuous(await ordered(repo, 'groups', student.id, target.id));
});

test('生产写入关闭时两个定位操作都被拒绝且数据不变', async t => {
  const { service, repo, student } = await fixture(t);
  const project = await service.createProject(student, { name: 'Project' });
  const group = await service.createGroup(student, { name: 'Group' });
  const before = await cppState(repo);
  service.config.writesEnabled = false;
  await rejects(service.repositionProject(student, project.id, { parentId: null, beforeId: null }), 'WRITES_DISABLED');
  await rejects(service.repositionGroup(student, group.id, { parentId: null, beforeId: null }), 'WRITES_DISABLED');
  assert.deepEqual(await cppState(repo), before);
});
