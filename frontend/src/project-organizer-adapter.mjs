import { api } from './api.mjs';

/**
 * @typedef {Object} ProjectSummary
 * @property {'project'} kind
 * @property {string} id
 * @property {string} name
 * @property {number|null} parentId
 * @property {number} sortOrder
 * @property {string|null} updatedAt
 */

/**
 * @typedef {Object} GroupSummary
 * @property {'group'} kind
 * @property {number} id
 * @property {string} name
 * @property {number|null} parentId
 * @property {number} sortOrder
 * @property {string|null} updatedAt
 */

/**
 * @typedef {Object} DirectoryResult
 * @property {ProjectSummary[]} projects
 * @property {GroupSummary[]} groups
 * @property {GroupSummary[]} breadcrumbs
 * @property {{id: number, username: string}|null} owner
 * @property {boolean} readOnly
 */

export class ProjectOrganizerAdapterError extends Error {
  constructor(code, message) { super(message); this.name = 'ProjectOrganizerAdapterError'; this.code = code; }
}

const same = (a, b) => a === null || b === null ? a === b : String(a) === String(b);

/** @returns {ProjectSummary} */
export function normalizeProjectSummary(project) {
  return { kind: 'project', id: project.id, name: project.name, parentId: project.parent_id ?? null, sortOrder: Number(project.sort_order), updatedAt: project.updated_at ?? null };
}

/** @returns {GroupSummary} */
export function normalizeGroupSummary(group) {
  return { kind: 'group', id: Number(group.id), name: group.name, parentId: group.parent_id ?? null, sortOrder: Number(group.sort_order), updatedAt: group.updated_at ?? null };
}

function breadcrumbsFor(groups, parentId) {
  const byId = new Map(groups.map(group => [String(group.id), group]));
  const breadcrumbs = [];
  const visited = new Set();
  let cursor = parentId;
  while (cursor !== null) {
    const key = String(cursor);
    if (visited.has(key)) throw new ProjectOrganizerAdapterError('INVALID_GROUP_TREE', `作品组父链存在循环：${key}`);
    visited.add(key);
    const group = byId.get(key);
    if (!group) throw new ProjectOrganizerAdapterError('INVALID_GROUP_TREE', `作品组父链缺少编号 ${key}`);
    breadcrumbs.unshift(group);
    cursor = group.parentId;
  }
  return breadcrumbs;
}

/** @returns {DirectoryResult} */
export function buildDirectoryResult(workspace, parentId = null) {
  const projects = workspace.projects.map(normalizeProjectSummary);
  const groups = workspace.groups.map(normalizeGroupSummary);
  return {
    projects: projects.filter(project => same(project.parentId, parentId)),
    groups: groups.filter(group => same(group.parentId, parentId)),
    breadcrumbs: breadcrumbsFor(groups, parentId),
    owner: workspace.owner ? { id: Number(workspace.owner.id), username: workspace.owner.username } : null,
    readOnly: Boolean(workspace.readOnly)
  };
}

function resource(kind) {
  if (kind === 'project') return { path: 'projects', normalize: normalizeProjectSummary, response: 'project' };
  if (kind === 'group') return { path: 'groups', normalize: normalizeGroupSummary, response: 'group' };
  throw new ProjectOrganizerAdapterError('INVALID_KIND', '作品类型必须是 project 或 group');
}

export function createCppProjectOrganizerAdapter({ request = api, openProject, writable = true } = {}) {
  let workspaceCache = null;
  const ownerKey = ownerId => ownerId == null ? null : String(ownerId);
  const loadWorkspace = async ownerId => {
    const key = ownerKey(ownerId);
    const data = await request(key === null ? '/workspace' : `/workspace?studentId=${encodeURIComponent(key)}`);
    workspaceCache = { key, data };
    return data;
  };
  const invalidate = () => { workspaceCache = null; };
  return {
    async loadDirectory({ ownerId = null, parentId = null } = {}) {
      const directory = buildDirectoryResult(await loadWorkspace(ownerId), parentId);
      return writable ? directory : { ...directory, readOnly: true };
    },
    async loadAllGroups({ ownerId = null } = {}) {
      const key = ownerKey(ownerId);
      const data = workspaceCache?.key === key ? workspaceCache.data : await loadWorkspace(ownerId);
      return data.groups.map(normalizeGroupSummary);
    },
    async createProject({ name, parentId = null, templateId } = {}) {
      const result = await request('/projects', { method: 'POST', body: { name, parentId, exampleId: templateId } });
      invalidate();
      return normalizeProjectSummary(result);
    },
    async createGroup({ name, parentId = null } = {}) {
      const result = await request('/groups', { method: 'POST', body: { name, parentId } });
      invalidate();
      return normalizeGroupSummary(result);
    },
    async renameItem({ kind, id, name } = {}) {
      const item = resource(kind);
      const result = await request(`/${item.path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } });
      invalidate();
      return item.normalize(result);
    },
    async repositionItem({ kind, id, parentId, beforeId } = {}) {
      const item = resource(kind);
      if (kind === 'group' && same(id, parentId)) return { repositioned: false, item: null };
      const result = await request(`/${item.path}/${encodeURIComponent(id)}/reposition`, { method: 'PUT', body: { parentId, beforeId } });
      invalidate();
      return { repositioned: result.repositioned === true, item: item.normalize(result[item.response]) };
    },
    async deleteItem({ kind, id } = {}) {
      const item = resource(kind);
      const result = await request(`/${item.path}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      invalidate();
      return result;
    },
    openProject(id) {
      if (typeof openProject !== 'function') throw new ProjectOrganizerAdapterError('OPEN_PROJECT_UNAVAILABLE', '宿主应用没有提供打开作品的方法');
      return openProject(id);
    }
  };
}
