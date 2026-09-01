import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../deploy/diagnose-rootless-controllers-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_CONTROLLERS_NODE'\n([\s\S]+)\nCPP_CONTROLLERS_NODE\n$/.exec(source)?.[1];
assert.ok(body);
const { selectProperties, resourceConfigLines, parseControllers, controllerSummary } = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const manager = '/user.slice/user-994.slice/user@994.service';
const chain = () => ['/', '/user.slice', '/user.slice/user-994.slice', manager].map(path => ({ path, available: ['cpu', 'memory', 'pids'], enabled: ['cpu', 'memory', 'pids'] }));

test('属性输出仅选择必要字段；缺失与空值分开记录，不带出其他属性', () => {
  const result = selectProperties('Delegate=yes\r\nDisableControllers=\r\nEnvironment=DB_PASSWORD=PRIVATE\r\nprivate warning\r\n', ['Delegate', 'DelegateControllers', 'DisableControllers']);
  assert.deepEqual(result, { values: { Delegate: 'yes', DisableControllers: '' }, missing: ['DelegateControllers'], duplicate: [], malformedLines: 1 });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.ok(!JSON.stringify(result).includes('private warning'));
});

test('重复属性不选择任意一个值；空响应仍列出缺少的属性', () => {
  assert.deepEqual(selectProperties('Delegate=yes\nDelegate=no\nDelegate=yes\n', ['Delegate']), { values: {}, missing: [], duplicate: ['Delegate'], malformedLines: 0 });
  assert.deepEqual(selectProperties('', ['Delegate']), { values: {}, missing: ['Delegate'], duplicate: [], malformedLines: 0 });
});

test('资源摘录保留来源和重置语句，排除命令、环境、凭据和不相关节', () => {
  const lines = resourceConfigLines('# /usr/lib/systemd/system/user@.service\n[Unit]\nDescription=PRIVATE\nDelegate=ignored\n[Service]\nEnvironment=DB_PASSWORD=PRIVATE\nExecStart=/bin/sh -c PRIVATE\nLoadCredential=PRIVATE\n# PRIVATE COMMENT\nDelegate=pids memory\n# /etc/systemd/system/user@994.service.d/90-local.conf\n[Service]\nDelegate=\nDelegate=cpu memory pids\n');
  assert.deepEqual(lines, ['# /usr/lib/systemd/system/user@.service', '[Service] Delegate=pids memory', '# /etc/systemd/system/user@994.service.d/90-local.conf', '[Service] Delegate=', '[Service] Delegate=cpu memory pids']);
});

test('环境和命令的续行即使形似资源设置也不回显', () => {
  const lines = resourceConfigLines('[Service]\nEnvironment=EXAMPLE=\\\n# comment in continuation\n  Delegate=PRIVATE_SECRET\nExecStart=/bin/echo \\\n  TasksMax=PRIVATE_COMMAND\nDelegate=cpu \\\n  memory pids\nTasksMax=256\n');
  assert.deepEqual(lines, ['[Service] Delegate=<continued; see effective properties>', '[Service] TasksMax=256']);
  assert.ok(!JSON.stringify(lines).includes('PRIVATE'));
});

test('空控制器列表是已读取的空值；cpuset 不冒充 cpu', () => {
  assert.deepEqual(parseControllers(' \r\n'), []);
  assert.deepEqual(parseControllers('cpuset\tcpu memory pids\n'), ['cpuset', 'cpu', 'memory', 'pids']);
  for (const input of ['+cpu', 'cpu,cpu', 'cpu cpu', null]) assert.throws(() => parseControllers(input), { code: 'CONTROLLER_FORMAT' });
});

test('总限额所在层有 cpu，仍能识别它没有传给用户管理器', () => {
  const rows = chain();
  rows[2].enabled = ['memory', 'pids'];
  rows[3].available = ['cpuset', 'memory', 'pids'];
  rows[3].enabled = ['memory', 'pids'];
  const cpu = controllerSummary(rows).find(row => row.controller === 'cpu');
  assert.equal(cpu.availableToManager, false);
  assert.deepEqual(cpu.notAvailableAt, [manager]);
  assert.deepEqual(cpu.notEnabledForChildrenAt, [rows[2].path, manager]);
  assert.deepEqual(cpu.unknown, []);
});

test('控制器已可用但暂未向子组开启，不误报本次缺失条件', () => {
  const rows = chain();
  rows[3].enabled = [];
  for (const item of controllerSummary(rows)) {
    assert.equal(item.availableToManager, true);
    assert.deepEqual(item.notAvailableAt, []);
    assert.deepEqual(item.notEnabledForChildrenAt, [manager]);
  }
});

test('读取失败显示未知而非通过或缺失；保留其他层的证据', () => {
  const rows = chain();
  rows[1].available = null;
  rows[3].available = null;
  rows[3].enabled = null;
  const item = controllerSummary(rows)[0];
  assert.equal(item.availableToManager, null);
  assert.deepEqual(item.unknown, ['/user.slice:cgroup.controllers', manager + ':cgroup.controllers', manager + ':cgroup.subtree_control']);
  assert.deepEqual(item.notAvailableAt, []);
});

test('不能把不完整、错序或其他账号的资源路径当成已知继承链', () => {
  assert.throws(() => controllerSummary(chain().slice(1)), { code: 'CGROUP_CHAIN_UNEXPECTED' });
  assert.throws(() => controllerSummary(chain().reverse()), { code: 'CGROUP_CHAIN_UNEXPECTED' });
  const rows = chain();
  rows[3].path = '/user.slice/user-0.slice/user@0.service';
  assert.throws(() => controllerSummary(rows), { code: 'CGROUP_CHAIN_UNEXPECTED' });
});
