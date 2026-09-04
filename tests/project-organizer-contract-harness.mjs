import { createMemoryOrganizerHarness } from '@tigao/organizer-contract-tests';
import { createCppProjectOrganizerAdapter } from '../frontend/src/project-organizer-adapter.mjs';

const toApiItem = item => {
  const { kind, parentId, sortOrder, updatedAt, ...rest } = item;
  return { ...rest, parent_id: parentId, sort_order: sortOrder, updated_at: updatedAt };
};

export function createCppOrganizerContractHarness(seed) {
  const memory = createMemoryOrganizerHarness(seed);
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push([path, options]);
    const url = new URL(path, 'https://cpp.test');
    if (url.pathname === '/workspace') {
      const ownerId = url.searchParams.has('studentId') ? Number(url.searchParams.get('studentId')) : null;
      const directory = await memory.adapter.loadDirectory({ ownerId, parentId: null });
      const state = memory.getState();
      return {
        projects: state.projects.filter(item => item.ownerId === directory.owner.id).map(toApiItem),
        groups: state.groups.filter(item => item.ownerId === directory.owner.id).map(toApiItem),
        owner: directory.owner,
        readOnly: directory.readOnly
      };
    }
    if (url.pathname === '/projects' && options.method === 'POST') return toApiItem(await memory.adapter.createProject({ name: options.body.name, parentId: options.body.parentId, templateId: options.body.exampleId }));
    if (url.pathname === '/groups' && options.method === 'POST') return toApiItem(await memory.adapter.createGroup(options.body));
    const match = /^\/(projects|groups)\/([^/]+)(?:\/(reposition))?$/.exec(url.pathname);
    if (!match) throw Object.assign(new Error(`Unexpected C++ API path: ${path}`), { code: 'UNEXPECTED_PATH' });
    const kind = match[1] === 'projects' ? 'project' : 'group';
    const id = kind === 'project' ? decodeURIComponent(match[2]) : Number(match[2]);
    if (match[3] === 'reposition' && options.method === 'PUT') {
      const result = await memory.adapter.repositionItem({ kind, id, parentId: options.body.parentId, beforeId: options.body.beforeId });
      return { repositioned: result.repositioned, [kind]: toApiItem(result.item) };
    }
    if (options.method === 'PATCH') return toApiItem(await memory.adapter.renameItem({ kind, id, name: options.body.name }));
    if (options.method === 'DELETE') return memory.adapter.deleteItem({ kind, id });
    throw Object.assign(new Error(`Unexpected C++ API operation: ${options.method} ${path}`), { code: 'UNEXPECTED_OPERATION' });
  };
  return {
    adapter: createCppProjectOrganizerAdapter({ request, openProject: id => memory.adapter.openProject(id) }),
    controls: memory.controls,
    getState: memory.getState,
    getOpenedProjects: memory.getOpenedProjects,
    getCalls: () => structuredClone(calls)
  };
}
