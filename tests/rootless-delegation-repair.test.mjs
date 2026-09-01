import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../deploy/repair-rootless-delegation-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_DELEGATION_NODE'\n([\s\S]+)\nCPP_DELEGATION_NODE\n$/.exec(source)?.[1];
assert.ok(body);
const { delegateText, checkManager, checkKernelDelegation, checkRestartScope, repairSequence } = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const override = '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf';
const manager = () => ({ Id: 'user@994.service', User: '994', LoadState: 'loaded', ActiveState: 'active', SubState: 'running', MainPID: '3396803', ControlGroup: '/user.slice/user-994.slice/user@994.service', Delegate: 'yes', DelegateControllers: 'memory pids', DisableControllers: '', FragmentPath: '/usr/lib/systemd/system/user@.service', DropInPaths: '/usr/lib/systemd/system/user@.service.d/10-login-barrier.conf', NeedDaemonReload: 'no' });
const kernel = () => ({ rootAvailable: 'cpuset cpu io memory hugetlb pids rdma misc', rootEnabled: 'cpu memory pids', userAvailable: 'cpu memory pids', userEnabled: 'cpu memory pids', sliceAvailable: 'cpu memory pids', sliceEnabled: 'memory pids', managerAvailable: 'memory pids' });

test('接受服务器已确认的仅缺 CPU 状态；不能把它当成修复通过', () => {
  checkManager(manager(), false);
  checkKernelDelegation(kernel(), false);
  assert.throws(() => checkManager(manager(), true), { code: 'DELEGATION_STATE_UNEXPECTED' });
  assert.throws(() => checkKernelDelegation(kernel(), true), { code: 'KERNEL_DELEGATION_UNEXPECTED' });
});

test('修复后要求具体 CPU 委派、指定新增配置以及内核真实向下开启', () => {
  const value = manager();
  value.DelegateControllers = 'pids cpu memory';
  value.DropInPaths += ' ' + override;
  checkManager(value, true);
  const actual = kernel();
  actual.sliceEnabled = 'memory cpu pids';
  actual.managerAvailable = 'cpu pids memory';
  checkKernelDelegation(actual, true);
  assert.throws(() => checkManager(value, false), { code: 'DELEGATION_STATE_UNEXPECTED' });
  actual.managerAvailable = 'memory pids';
  assert.throws(() => checkKernelDelegation(actual, true), { code: 'KERNEL_DELEGATION_UNEXPECTED' });
});

test('其他 UID、错误 cgroup、停止中管理器不能进入重启流程', () => {
  for (const change of [{ Id: 'user@0.service' }, { User: '0' }, { ControlGroup: '/user.slice/user-0.slice/user@0.service' }, { ActiveState: 'deactivating' }, { SubState: 'stop-sigterm' }, { MainPID: '0' }]) assert.throws(() => checkManager({ ...manager(), ...change }, false), { code: 'MANAGER_IDENTITY_OR_STATE_CHANGED' });
});

test('不覆盖额外委派策略、禁用策略、未加载配置或其他管理员 drop-in', () => {
  for (const change of [{ DelegateControllers: 'cpu memory pids io' }, { DelegateControllers: '' }, { DisableControllers: 'cpu' }, { NeedDaemonReload: 'yes' }]) assert.throws(() => checkManager({ ...manager(), ...change }, false), { code: 'DELEGATION_STATE_UNEXPECTED' });
  for (const change of [{ FragmentPath: '/etc/systemd/system/user@.service' }, { DropInPaths: manager().DropInPaths + ' /etc/systemd/system/user@.service.d/custom.conf' }]) assert.throws(() => checkManager({ ...manager(), ...change }, false), { code: 'MANAGER_SOURCE_CHANGED' });
});

test('上级缺少任一必要控制器就停止，cpuset 不能替代 cpu', () => {
  for (const key of ['rootAvailable', 'rootEnabled', 'userAvailable', 'userEnabled', 'sliceAvailable']) {
    assert.throws(() => checkKernelDelegation({ ...kernel(), [key]: 'cpuset memory pids' }, false), { code: 'ANCESTOR_CONTROLLERS_CHANGED' });
    assert.throws(() => checkKernelDelegation({ ...kernel(), [key]: null }, false), { code: 'ANCESTOR_CONTROLLERS_CHANGED' });
  }
});

test('存在容器、执行服务或未知用户服务时禁止重启用户管理器', () => {
  checkRestartScope([]);
  checkRestartScope(['dbus-broker.service', 'systemd-tmpfiles-setup.service']);
  for (const units of [['podman.service'], ['teaching-cpp-runner.service'], ['cpp-podman-init-abc.service'], ['custom.service'], [null], null]) assert.throws(() => checkRestartScope(units), { code: 'RUNNER_HAS_UNEXPECTED_SERVICE' });
});

test('新增配置仅设置指定控制器，不解除账号上层限额或增加其他服务操作', () => {
  const entries = delegateText().split('\n').filter(line => line && !line.startsWith('#'));
  assert.deepEqual(entries, ['[Service]', 'Delegate=cpu memory pids']);
});

const phases = ['preflight', 'backup', 'install', 'reload', 'checkLoaded', 'restart', 'verify', 'resume'];
test('前置检查或备份失败时不能写配置；加载检查失败时不能重启', async () => {
  for (const failing of ['preflight', 'backup', 'install', 'reload', 'checkLoaded']) {
    const seen = [];
    const actions = Object.fromEntries(phases.map(name => [name, async () => { seen.push(name); if (name === failing) throw new Error(failing); }]));
    await assert.rejects(repairSequence(actions), { message: failing });
    assert.deepEqual(seen, phases.slice(0, phases.indexOf(failing) + 1));
    assert.ok(!seen.includes('restart'));
  }
});

test('重启或内核核验失败时绝不开始 Podman 初始化', async () => {
  for (const failing of ['restart', 'verify']) {
    const seen = [];
    const actions = Object.fromEntries(phases.map(name => [name, async () => { seen.push(name); if (name === failing) throw new Error(failing); }]));
    await assert.rejects(repairSequence(actions), { message: failing });
    assert.deepEqual(seen, phases.slice(0, phases.indexOf(failing) + 1));
    assert.ok(!seen.includes('resume'));
  }
});

test('后续初始化失败不自动重复修复和重启；全部通过时只接续一次', async () => {
  for (const fail of [false, true]) {
    const seen = [];
    const actions = Object.fromEntries(phases.map(name => [name, async () => { seen.push(name); if (name === 'resume' && fail) throw new Error('partial podman store'); }]));
    if (fail) await assert.rejects(repairSequence(actions), { message: 'partial podman store' });
    else await repairSequence(actions);
    assert.deepEqual(seen, phases);
  }
});
