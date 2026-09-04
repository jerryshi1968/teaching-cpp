import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { fixture } from './helpers.mjs';
import { createApp } from '../backend/src/app.mjs';

const asStudent = request => request.set('X-Demo-User', '2');

test('两个 reposition 路由接受显式 null 和合法 ID，并返回可消费摘要', async t => {
  const { service, config, student } = await fixture(t);
  const client = request(createApp(service, config));
  const groupA = await service.createGroup(student, { name: 'A' });
  const groupB = await service.createGroup(student, { name: 'B' });
  const projectA = await service.createProject(student, { name: 'A' });
  const projectB = await service.createProject(student, { name: 'B', parentId: groupA.id });
  const projectResponse = await asStudent(client.put(`/api/cpp/projects/${projectA.id}/reposition`)).send({ parentId: groupA.id, beforeId: projectB.id }).expect(200);
  assert.equal(projectResponse.body.repositioned, true);
  assert.equal(projectResponse.body.project.id, projectA.id);
  assert.equal(projectResponse.body.project.parent_id, groupA.id);
  const groupResponse = await asStudent(client.put(`/api/cpp/groups/${groupB.id}/reposition`)).send({ parentId: groupA.id, beforeId: null }).expect(200);
  assert.equal(groupResponse.body.repositioned, true);
  assert.equal(groupResponse.body.group.id, groupB.id);
  assert.equal(groupResponse.body.group.parent_id, groupA.id);
  await asStudent(client.put(`/api/cpp/projects/${projectA.id}/reposition`)).send({ parentId: null, beforeId: null }).expect(200);
});

test('reposition 路由拒绝缺失字段、非法 ID 和数组请求体', async t => {
  const { service, config, student } = await fixture(t);
  const client = request(createApp(service, config));
  const group = await service.createGroup(student, { name: 'Group' });
  const project = await service.createProject(student, { name: 'Project' });
  for (const body of [{ beforeId: null }, { parentId: null }]) {
    const response = await asStudent(client.put(`/api/cpp/projects/${project.id}/reposition`)).send(body).expect(400);
    assert.equal(response.body.code, 'INVALID_ID');
  }
  await asStudent(client.put(`/api/cpp/groups/${group.id}/reposition`)).send({ parentId: null }).expect(400);
  await asStudent(client.put('/api/cpp/projects/not-a-uuid/reposition')).send({ parentId: null, beforeId: null }).expect(400);
  await asStudent(client.put(`/api/cpp/projects/${project.id}/reposition`)).send({ parentId: 0, beforeId: null }).expect(400);
  await asStudent(client.put(`/api/cpp/projects/${project.id}/reposition`)).send({ parentId: null, beforeId: 'not-a-uuid' }).expect(400);
  await asStudent(client.put('/api/cpp/groups/not-a-number/reposition')).send({ parentId: null, beforeId: null }).expect(400);
  await asStudent(client.put(`/api/cpp/groups/${group.id}/reposition`)).send({ parentId: null, beforeId: 'not-a-number' }).expect(400);
  const arrayResponse = await asStudent(client.put(`/api/cpp/groups/${group.id}/reposition`)).send([]).expect(400);
  assert.equal(arrayResponse.body.code, 'INVALID_BODY');
});

test('HTTP 定位对跨用户、跨类型和非法 beforeId 返回不泄露记录的错误', async t => {
  const { service, config, repo, student, other } = await fixture(t);
  const client = request(createApp(service, config));
  const ownProject = await service.createProject(student, { name: 'Own' });
  const foreignProject = await service.createProject(other, { name: 'Foreign' });
  const foreignGroup = await service.createGroup(other, { name: 'Foreign group' });
  const time = new Date().toISOString();
  const p5ProjectId = randomUUID();
  await repo.insert('projects', { id: p5ProjectId, user_id: student.id, name: 'p5', parent_id: null, sort_order: 0, project_type: 'p5js', created_at: time, updated_at: time });
  const hiddenSource = await asStudent(client.put(`/api/cpp/projects/${foreignProject.id}/reposition`)).send({ parentId: null, beforeId: null }).expect(404);
  const missingSource = await asStudent(client.put(`/api/cpp/projects/${randomUUID()}/reposition`)).send({ parentId: null, beforeId: null }).expect(404);
  assert.equal(hiddenSource.body.code, 'PROJECT_NOT_FOUND');
  assert.equal(missingSource.body.code, hiddenSource.body.code);
  const p5Source = await asStudent(client.put(`/api/cpp/projects/${p5ProjectId}/reposition`)).send({ parentId: null, beforeId: null }).expect(404);
  assert.equal(p5Source.body.code, hiddenSource.body.code);
  const foreignParent = await asStudent(client.put(`/api/cpp/projects/${ownProject.id}/reposition`)).send({ parentId: foreignGroup.id, beforeId: null }).expect(400);
  const missingParent = await asStudent(client.put(`/api/cpp/projects/${ownProject.id}/reposition`)).send({ parentId: 999999, beforeId: null }).expect(400);
  assert.equal(foreignParent.body.code, 'INVALID_GROUP');
  assert.equal(missingParent.body.code, foreignParent.body.code);
  const foreignBefore = await asStudent(client.put(`/api/cpp/projects/${ownProject.id}/reposition`)).send({ parentId: null, beforeId: foreignProject.id }).expect(400);
  const p5Before = await asStudent(client.put(`/api/cpp/projects/${ownProject.id}/reposition`)).send({ parentId: null, beforeId: p5ProjectId }).expect(400);
  assert.equal(foreignBefore.body.code, 'INVALID_BEFORE');
  assert.equal(p5Before.body.code, foreignBefore.body.code);
});
