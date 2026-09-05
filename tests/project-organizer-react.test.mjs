import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCppOrganizerContractHarness } from './project-organizer-contract-harness.mjs';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://cpp.test/teaching-cpp/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); }
  observe(target) { this.targets.add(target); queueMicrotask(() => this.callback([...this.targets].map(item => ({ target: item, contentRect: item.getBoundingClientRect() })))); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
};
dom.window.ResizeObserver = globalThis.ResizeObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
dom.window.HTMLElement.prototype.setPointerCapture = () => {};
dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const card = this.closest?.('.tigao-organizer__card');
  const cards = [...document.querySelectorAll('.tigao-organizer__card')];
  const index = card ? cards.indexOf(card) : 0;
  const top = Math.max(0, index) * 100;
  return { x: 0, y: top, top, left: 0, right: 280, bottom: top + 80, width: 280, height: 80, toJSON() { return this; } };
};

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ProjectOrganizer } = await import('@tigao/organizer-react');

const messages = {
  title: '作品管理', root: '全部练习', groups: '作品组', projects: 'C++ 练习', createGroup: '新建作品组', createProject: '新建练习', groupName: '作品组名称', projectName: '练习名称', open: '打开', rename: '重命名', move: '移动到', delete: '删除', moveUp: '向上排序', moveDown: '向下排序', drag: '拖放排序或移动', dropInside: '拖到这里移入作品组', loading: '正在读取作品…', loadingTargets: '正在读取目标位置…', empty: '这个目录还没有练习。', readOnly: '当前是只读查看，不能修改作品。', saving: '正在保存变更…', retry: '重新读取', cancel: '取消', confirm: '确定', renameTitle: '重命名作品', moveTitle: '移动作品', deleteTitle: '删除作品', deleteQuestion: '确认删除这个作品？', chooseDestination: '选择目标作品组', structureBlocked: '作品组结构异常，已暂停编辑。', noDestinations: '没有可用的目标位置。'
};

const delay = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle() { await act(async () => { await delay(); }); }
async function waitFor(probe, description) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await settle();
    const result = probe();
    if (result) return result;
  }
  assert.fail(`Timed out waiting for ${description}`);
}
const buttonByText = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
const buttonByLabel = label => document.querySelector(`button[aria-label="${label}"]`);
const cardByName = name => [...document.querySelectorAll('.tigao-organizer__card')].find(card => card.querySelector('strong')?.textContent === name);
const itemNames = kind => [...document.querySelectorAll(`.tigao-organizer__card--${kind} strong`)].map(node => node.textContent);
const inputByLabel = text => {
  const label = [...document.querySelectorAll('label')].find(candidate => candidate.textContent.trim() === text);
  return label ? document.getElementById(label.htmlFor) : null;
};
async function click(element) {
  assert.ok(element, 'expected clickable element');
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await delay(); });
}
async function change(input, value) {
  assert.ok(input, 'expected input element');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await delay(); });
}
async function press(target, code, key) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, key })); await delay(); });
}

async function renderOrganizer({ harness = createCppOrganizerContractHarness(), ownerId = 1, initialParentId = null } = {}) {
  const container = document.getElementById('root');
  const root = createRoot(container);
  function Host() {
    const [parentId, setParentId] = React.useState(initialParentId);
    return React.createElement(ProjectOrganizer, { adapter: harness.adapter, ownerId, currentParentId: parentId, onCurrentParentIdChange: setParentId, messages });
  }
  await act(async () => { root.render(React.createElement(Host)); await delay(); });
  await waitFor(() => !document.querySelector('[aria-busy="true"]'), 'initial directory');
  return {
    harness,
    async unmount() { await act(async () => { root.unmount(); await delay(); }); container.replaceChildren(); }
  };
}

test('React 集成覆盖根目录、深层面包屑和刷新后重新读取', async () => {
  const rendered = await renderOrganizer();
  await waitFor(() => cardByName('Lessons') && cardByName('First Project'), 'root projects');
  await click(cardByName('Lessons').querySelector('.tigao-organizer__item-main'));
  await waitFor(() => cardByName('Week One'), 'first nested group');
  await click(cardByName('Week One').querySelector('.tigao-organizer__item-main'));
  await waitFor(() => cardByName('Exercises'), 'second nested group');
  await click(cardByName('Exercises').querySelector('.tigao-organizer__item-main'));
  await waitFor(() => cardByName('Deep Project'), 'deep project');
  assert.deepEqual([...document.querySelectorAll('.tigao-organizer__breadcrumb')].map(node => node.textContent), ['全部练习', 'Lessons', 'Week One', 'Exercises']);
  assert.equal(document.querySelector('.tigao-organizer__breadcrumb[aria-current="page"]').textContent, 'Exercises');
  await rendered.harness.adapter.renameItem({ kind: 'project', id: 'project-deep', name: 'Server Renamed' });
  await rendered.unmount();
  const refreshed = await renderOrganizer({ harness: rendered.harness, initialParentId: 3 });
  await waitFor(() => cardByName('Server Renamed'), 'server state after refresh');
  await refreshed.unmount();
});

test('React 集成覆盖新建、重命名和删除', async () => {
  const rendered = await renderOrganizer();
  await change(inputByLabel('练习名称'), '新练习');
  await click(buttonByText('新建练习'));
  await waitFor(() => cardByName('新练习'), 'created project');
  await click(buttonByLabel('重命名: 新练习'));
  await waitFor(() => inputByLabel('重命名'), 'rename dialog');
  await change(inputByLabel('重命名'), '重命名后的练习');
  await click(buttonByText('确定'));
  await waitFor(() => cardByName('重命名后的练习'), 'renamed project');
  await click(buttonByLabel('删除: 重命名后的练习'));
  await waitFor(() => document.querySelector('.tigao-organizer__dialog'), 'delete dialog');
  await click(document.querySelector('.tigao-organizer__dialog .tigao-organizer__danger'));
  await waitFor(() => !cardByName('重命名后的练习'), 'deleted project');
  await change(inputByLabel('作品组名称'), '新作品组');
  await click(buttonByText('新建作品组'));
  await waitFor(() => cardByName('新作品组'), 'created group');
  await rendered.unmount();
});

test('React 集成覆盖上下排序、跨组移动和失败回滚', async () => {
  const rendered = await renderOrganizer();
  await waitFor(() => itemNames('project').length === 2, 'ordered root projects');
  assert.deepEqual(itemNames('project'), ['First Project', 'Second Project']);
  await click(buttonByLabel('向下排序: First Project'));
  await waitFor(() => itemNames('project')[0] === 'Second Project', 'move down');
  rendered.harness.controls.failNext('repositionItem', Object.assign(new Error('排序失败'), { code: 'SIMULATED_FAILURE', status: 503 }));
  await click(buttonByLabel('向上排序: First Project'));
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('排序失败'), 'failure alert');
  assert.deepEqual(itemNames('project'), ['Second Project', 'First Project']);
  await click(buttonByLabel('移动到: First Project'));
  const destination = await waitFor(() => [...document.querySelectorAll('.tigao-organizer__destination-list button')].find(button => button.textContent.includes('Lessons')), 'move destination');
  await click(destination);
  await waitFor(() => !cardByName('First Project'), 'cross-group removal');
  await click(cardByName('Lessons').querySelector('.tigao-organizer__item-main'));
  await waitFor(() => cardByName('First Project'), 'cross-group destination');
  await rendered.unmount();
});

test('React 集成覆盖键盘拖放和只读状态', async () => {
  const rendered = await renderOrganizer();
  await waitFor(() => itemNames('project').length === 2, 'draggable projects');
  const handle = buttonByLabel('拖放排序或移动: Second Project');
  handle.focus();
  await press(handle, 'Space', ' ');
  await waitFor(() => handle.closest('.tigao-organizer__card').classList.contains('tigao-organizer__card--dragging'), 'keyboard drag activation');
  await press(document, 'ArrowUp', 'ArrowUp');
  await press(document, 'Space', ' ');
  await waitFor(() => itemNames('project')[0] === 'Second Project', 'keyboard drag reorder');
  await rendered.unmount();
  const readOnly = await renderOrganizer({ harness: createCppOrganizerContractHarness(), ownerId: 2, initialParentId: 20 });
  await waitFor(() => cardByName('Read-only Project'), 'read-only project');
  assert.match(document.querySelector('.tigao-organizer__readonly').textContent, /只读/);
  assert.equal(document.querySelector('.tigao-organizer__create-panel'), null);
  assert.equal(document.querySelector('.tigao-organizer__card-actions'), null);
  await click(cardByName('Read-only Project').querySelector('.tigao-organizer__item-main'));
  assert.deepEqual(readOnly.harness.getOpenedProjects(), ['project-read-only']);
  await readOnly.unmount();
});

test('React 集成覆盖向下拖放到中间和末尾', async () => {
  const seed = {
    owners: [{ id: 1, username: 'current-user', readOnly: false }],
    groups: [],
    projects: [
      { kind: 'project', id: 'project-root-a', name: 'First Project', parentId: null, sortOrder: 0, updatedAt: null, ownerId: 1 },
      { kind: 'project', id: 'project-root-b', name: 'Second Project', parentId: null, sortOrder: 1, updatedAt: null, ownerId: 1 },
      { kind: 'project', id: 'project-root-c', name: 'Third Project', parentId: null, sortOrder: 2, updatedAt: null, ownerId: 1 }
    ]
  };
  const rendered = await renderOrganizer({ harness: createCppOrganizerContractHarness(seed) });
  await waitFor(() => itemNames('project').length === 3, 'three draggable projects');

  let handle = buttonByLabel('拖放排序或移动: First Project');
  handle.focus();
  await press(handle, 'Space', ' ');
  await press(document, 'ArrowDown', 'ArrowDown');
  await press(document, 'Space', ' ');
  await waitFor(() => itemNames('project').join(',') === 'Second Project,First Project,Third Project', 'drag to middle');
  const middleCalls = rendered.harness.getCalls().filter(([path]) => path.endsWith('/reposition'));
  assert.deepEqual(middleCalls.map(([, options]) => options.body), [
    { parentId: null, beforeId: 'project-root-c' }
  ]);
  await rendered.unmount();

  const appended = await renderOrganizer({ harness: createCppOrganizerContractHarness(seed) });
  handle = buttonByLabel('拖放排序或移动: First Project');
  handle.focus();
  await press(handle, 'Space', ' ');
  await press(document, 'ArrowDown', 'ArrowDown');
  await press(document, 'ArrowDown', 'ArrowDown');
  await press(document, 'Space', ' ');
  await waitFor(() => itemNames('project').join(',') === 'Second Project,Third Project,First Project', 'drag to last');

  const appendCalls = appended.harness.getCalls().filter(([path]) => path.endsWith('/reposition'));
  assert.deepEqual(appendCalls.map(([, options]) => options.body), [
    { parentId: null, beforeId: null }
  ]);
  await appended.unmount();
});
