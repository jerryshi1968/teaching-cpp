import test from 'node:test';
import assert from 'node:assert/strict';
import { createCppProjectOrganizerAdapter } from '../frontend/src/project-organizer-adapter.mjs';

const workspace = {
  projects: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Project', parent_id: 3, sort_order: 4, updated_at: '2026-01-04T00:00:00.000Z' }],
  groups: [
    { id: 1, name: 'Root', parent_id: null, sort_order: 0, updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, name: 'Middle', parent_id: 1, sort_order: 1, updated_at: '2026-01-02T00:00:00.000Z' },
    { id: 3, name: 'Current', parent_id: 2, sort_order: 2, updated_at: null }
  ],
  owner: { id: 7, username: 'Student' },
  readOnly: true
};

test('适配器规范化 workspace、构建面包屑并为全部作品组复用缓存', async () => {
  const calls = [];
  const adapter = createCppProjectOrganizerAdapter({ request: async (...args) => { calls.push(args); return workspace; }, openProject: () => {} });
  const directory = await adapter.loadDirectory({ ownerId: 7, parentId: 3 });
  assert.deepEqual(calls, [['/workspace?studentId=7']]);
  assert.deepEqual(directory.projects, [{ kind: 'project', id: workspace.projects[0].id, name: 'Project', parentId: 3, sortOrder: 4, updatedAt: '2026-01-04T00:00:00.000Z' }]);
  assert.deepEqual(directory.groups, []);
  assert.deepEqual(directory.breadcrumbs.map(group => group.id), [1, 2, 3]);
  assert.deepEqual(directory.owner, workspace.owner);
  assert.equal(directory.readOnly, true);
  assert.deepEqual((await adapter.loadAllGroups({ ownerId: 7 })).map(group => group.id), [1, 2, 3]);
  assert.equal(calls.length, 1);
});

test('适配器对损坏或循环父链返回可诊断错误且不会无限循环', async () => {
  const missing = createCppProjectOrganizerAdapter({ request: async () => ({ ...workspace, groups: [{ ...workspace.groups[2], parent_id: 99 }] }), openProject: () => {} });
  await assert.rejects(missing.loadDirectory({ ownerId: null, parentId: 3 }), error => error.code === 'INVALID_GROUP_TREE' && /99/.test(error.message));
  const cyclic = createCppProjectOrganizerAdapter({ request: async () => ({ ...workspace, groups: [{ ...workspace.groups[0], parent_id: 2 }, { ...workspace.groups[1], parent_id: 1 }] }), openProject: () => {} });
  await assert.rejects(cyclic.loadDirectory({ ownerId: null, parentId: 1 }), error => error.code === 'INVALID_GROUP_TREE' && /循环/.test(error.message));
});

test('适配器把所有规范方法映射到固定 C++ API 路径和请求体', async () => {
  const calls = [];
  const opened = [];
  const project = { ...workspace.projects[0], parent_id: null };
  const group = workspace.groups[0];
  const request = async (path, options) => {
    calls.push([path, options]);
    if (path === '/projects' || path.includes('/projects/')) return path.endsWith('/reposition') ? { repositioned: true, project } : path === '/projects' || options?.method === 'PATCH' ? project : { deleted: true };
    if (path === '/groups' || path.includes('/groups/')) return path.endsWith('/reposition') ? { repositioned: true, group } : path === '/groups' || options?.method === 'PATCH' ? group : { deleted: true };
    return workspace;
  };
  const adapter = createCppProjectOrganizerAdapter({ request, openProject: id => { opened.push(id); return 'opened'; } });
  assert.equal((await adapter.createProject({ name: 'New', parentId: null, templateId: 'hello' })).kind, 'project');
  assert.equal((await adapter.createGroup({ name: 'Group', parentId: null })).kind, 'group');
  assert.equal((await adapter.renameItem({ kind: 'project', id: project.id, name: 'Renamed' })).kind, 'project');
  assert.equal((await adapter.renameItem({ kind: 'group', id: group.id, name: 'Renamed group' })).kind, 'group');
  assert.deepEqual(await adapter.repositionItem({ kind: 'project', id: project.id, parentId: null, beforeId: null }), { repositioned: true, item: { kind: 'project', id: project.id, name: 'Project', parentId: null, sortOrder: 4, updatedAt: '2026-01-04T00:00:00.000Z' } });
  assert.deepEqual(await adapter.repositionItem({ kind: 'group', id: group.id, parentId: null, beforeId: null }), { repositioned: true, item: { kind: 'group', id: 1, name: 'Root', parentId: null, sortOrder: 0, updatedAt: '2026-01-01T00:00:00.000Z' } });
  assert.deepEqual(await adapter.deleteItem({ kind: 'project', id: project.id }), { deleted: true });
  assert.deepEqual(await adapter.deleteItem({ kind: 'group', id: group.id }), { deleted: true });
  assert.equal(adapter.openProject(project.id), 'opened');
  assert.deepEqual(opened, [project.id]);
  assert.deepEqual(calls, [
    ['/projects', { method: 'POST', body: { name: 'New', parentId: null, exampleId: 'hello' } }],
    ['/groups', { method: 'POST', body: { name: 'Group', parentId: null } }],
    [`/projects/${project.id}`, { method: 'PATCH', body: { name: 'Renamed' } }],
    [`/groups/${group.id}`, { method: 'PATCH', body: { name: 'Renamed group' } }],
    [`/projects/${project.id}/reposition`, { method: 'PUT', body: { parentId: null, beforeId: null } }],
    [`/groups/${group.id}/reposition`, { method: 'PUT', body: { parentId: null, beforeId: null } }],
    [`/projects/${project.id}`, { method: 'DELETE' }],
    [`/groups/${group.id}`, { method: 'DELETE' }]
  ]);
  await assert.rejects(adapter.renameItem({ kind: 'runs', id: 1, name: 'Bad' }), error => error.code === 'INVALID_KIND');
  assert.equal(calls.length, 8);
});

test('适配器原样传播包含 status、code 和 message 的 API 错误', async () => {
  const apiError = Object.assign(new Error('目标位置无效'), { status: 400, code: 'INVALID_BEFORE' });
  const adapter = createCppProjectOrganizerAdapter({ request: async () => { throw apiError; }, openProject: () => {} });
  await assert.rejects(adapter.loadDirectory({ ownerId: null, parentId: null }), error => error === apiError && error.status === 400 && error.code === 'INVALID_BEFORE' && error.message === '目标位置无效');
});

test('适配器忽略把作品组拖回自身的无效嵌套请求', async () => {
  const calls = [];
  const adapter = createCppProjectOrganizerAdapter({ request: async (...args) => { calls.push(args); }, openProject: () => {} });
  assert.deepEqual(await adapter.repositionItem({ kind: 'group', id: 7, parentId: 7, beforeId: null }), { repositioned: false, item: null });
  assert.deepEqual(calls, []);
});

test('适配器在宿主关闭写入时向共享界面公开只读状态', async () => {
  const adapter = createCppProjectOrganizerAdapter({ request: async () => ({ ...workspace, readOnly: false }), openProject: () => {}, writable: false });
  assert.equal((await adapter.loadDirectory()).readOnly, true);
});
