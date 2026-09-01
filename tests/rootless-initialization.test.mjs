import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../deploy/initialize-rootless-podman-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_ROOTLESS_NODE'\n([\s\S]+)\nCPP_ROOTLESS_NODE\n$/.exec(script)?.[1];
assert.ok(body);
const { parseProperties, checkLimits, checkCgroupLimits, checkMap, parseMap, checkPodman, checkProbeLocation } = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const home = '/var/www/teaching-cpp-runner';
const limits = { LoadState: 'loaded', ActiveState: 'active', MemoryMax: '1073741824', MemorySwapMax: '0', CPUQuotaPerSecUSec: '1s', TasksMax: '256', DropInPaths: '/usr/lib/systemd/system/user-.slice.d/10-defaults.conf /etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf' };
const maps = id => [{ container_id: 0, host_id: id, size: 1 }, { container_id: 1, host_id: 200000, size: 65536 }];
const info = () => ({
  version: { Version: '5.8.2' },
  host: { arch: 'amd64', security: { rootless: true, seccompEnabled: true }, serviceIsRemote: false, cgroupVersion: 'v2', cgroupManager: 'systemd', cgroupControllers: ['cpu', 'memory', 'pids'], ociRuntime: { name: 'crun' }, idMappings: { uidmap: maps(994), gidmap: maps(991) } },
  store: { graphDriverName: 'overlay', graphRoot: home + '/.local/share/containers/storage', runRoot: '/run/user/994/containers', configFile: home + '/.config/containers/storage.conf', imageCopyTmpDir: home + '/tmp', containerStore: { number: 0 }, imageStore: { number: 0 } }
});

test('systemd 字段按键解析，拒绝损坏或重复项', () => {
  assert.deepEqual(parseProperties('ActiveState=active\nSubState=running\n'), { ActiveState: 'active', SubState: 'running' });
  for (const value of ['bad\n', 'ActiveState=active\nActiveState=inactive\n']) assert.throws(() => parseProperties(value), { code: 'PROPERTY_FORMAT' });
});

test('用户 slice 既检查限额，也区分初始化前后活动状态', () => {
  assert.doesNotThrow(() => checkLimits(limits, 'active'));
  assert.doesNotThrow(() => checkLimits({ ...limits, ActiveState: 'inactive' }, 'inactive'));
  for (const changed of [{ ActiveState: 'inactive' }, { MemoryMax: 'infinity' }, { MemorySwapMax: 'infinity' }, { TasksMax: 'infinity' }, { CPUQuotaPerSecUSec: '2s' }, { LoadState: 'not-found' }]) assert.throws(() => checkLimits({ ...limits, ...changed }, 'active'), { code: 'SLICE_LIMITS_UNEXPECTED' });
  assert.throws(() => checkLimits({ ...limits, DropInPaths: '' }, 'active'), { code: 'SLICE_DROPIN_MISSING' });
});

test('内核限额拒绝无限内存、交换或进程，CPU 可用不同周期表达一个核的额度', () => {
  const kernel = { memory: '1073741824', swap: '0', pids: '256', cpu: '100000 100000' };
  assert.doesNotThrow(() => checkCgroupLimits(kernel));
  assert.doesNotThrow(() => checkCgroupLimits({ ...kernel, cpu: '10000 10000' }));
  for (const key of ['memory', 'swap', 'pids']) assert.throws(() => checkCgroupLimits({ ...kernel, [key]: 'max' }), { code: 'CGROUP_LIMITS_UNEXPECTED' });
  for (const value of ['max 100000', '200000 100000', '0 0', 'bad']) assert.throws(() => checkCgroupLimits({ ...kernel, cpu: value }), { code: 'CGROUP_CPU_UNEXPECTED' });
});

test('从真实 unshare 文本解析并验证 UID/GID 两段映射', () => {
  assert.doesNotThrow(() => checkMap(parseMap('         0        994          1\n         1     200000      65536\n'), 994));
  assert.doesNotThrow(() => checkMap(parseMap('0 991 1\n1 200000 65536\n'), 991));
  assert.throws(() => parseMap('0 x 1\n'), { code: 'NAMESPACE_MAPPING_FORMAT' });
  assert.throws(() => parseMap('0 999999999999999999 1\n'), { code: 'NAMESPACE_MAPPING_FORMAT' });
});

test('不能把 root、网站账号、apphttp 区间或缩小后的映射当成独立执行账号', () => {
  for (const rows of [maps(0), maps(995), [{ container_id: 0, host_id: 994, size: 1 }], [...maps(994), { container_id: 65537, host_id: 300000, size: 65536 }], [maps(994)[0], { container_id: 1, host_id: 100000, size: 65536 }], [maps(994)[0], { container_id: 1, host_id: 200000, size: 1 }]]) assert.throws(() => checkMap(rows, 994), { code: 'NAMESPACE_MAPPING_UNEXPECTED' });
});

test('完整 rootless 信息可用，但公开摘要不携带任意主机字段', () => {
  const input = info();
  input.host.hostname = 'private-hostname';
  input.registries = { private: 'do-not-display' };
  const summary = checkPodman(input);
  assert.equal(summary.rootless, true);
  assert.equal(summary.containers, 0);
  assert.equal(JSON.stringify(summary).includes('private'), false);
});

for (const [name, change] of [
  ['rootful', value => { value.host.security.rootless = false; }],
  ['缺少 seccomp', value => { value.host.security.seccompEnabled = false; }],
  ['远程引擎', value => { value.host.serviceIsRemote = true; }],
  ['cgroup v1', value => { value.host.cgroupVersion = 'v1'; }],
  ['cgroupfs 管理器', value => { value.host.cgroupManager = 'cgroupfs'; }]
]) test('拒绝不足的隔离环境：' + name, () => {
  const value = info(); change(value);
  assert.throws(() => checkPodman(value), { code: 'ROOTLESS_ISOLATION_UNAVAILABLE' });
});

test('缺少委派控制器时停止，不退回无资源控制运行', () => {
  for (const missing of ['cpu', 'memory', 'pids']) {
    const value = info(); value.host.cgroupControllers = value.host.cgroupControllers.filter(item => item !== missing);
    assert.throws(() => checkPodman(value), { code: 'DELEGATED_CONTROLLERS_MISSING' });
  }
});

test('拒绝 root 存储、其他用户运行目录、错误驱动和散落的临时目录', () => {
  for (const changed of [{ graphRoot: '/var/lib/containers/storage' }, { runRoot: '/run/user/995/containers' }, { configFile: '/etc/containers/storage.conf' }, { imageCopyTmpDir: '/var/tmp' }, { graphDriverName: 'vfs' }]) {
    const value = info(); Object.assign(value.store, changed);
    assert.throws(() => checkPodman(value), { code: 'PODMAN_STORAGE_UNEXPECTED' });
  }
});

test('已有镜像或容器不能被声称为首次空初始化', () => {
  for (const field of ['imageStore', 'containerStore']) {
    const value = info(); value.store[field].number = 1;
    assert.throws(() => checkPodman(value), { code: 'PODMAN_STORE_NOT_EMPTY' });
  }
});

test('检查进程必须属于本次用户服务，不能沿用 root 或其他用户的 cgroup', () => {
  const unit = 'cpp-podman-init-123456abcdef.service';
  const value = { uid: 994, gid: 991, cgroup: '/user.slice/user-994.slice/user@994.service/app.slice/' + unit };
  assert.doesNotThrow(() => checkProbeLocation(value, unit));
  for (const changed of [{ uid: 0 }, { gid: 0 }]) assert.throws(() => checkProbeLocation({ ...value, ...changed }, unit), { code: 'PROBE_IDENTITY_UNEXPECTED' });
  for (const cgroup of ['/system.slice/' + unit, value.cgroup.replace('user-994', 'user-995'), value.cgroup + '/child', value.cgroup.replace('app.slice', '../app.slice')]) assert.throws(() => checkProbeLocation({ ...value, cgroup }, unit), { code: 'PROBE_CGROUP_UNEXPECTED' });
  assert.throws(() => checkProbeLocation(value, '../other.service'), { code: 'PROBE_UNIT_UNEXPECTED' });
});
