import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const text = fs.readFileSync(new URL('../deploy/prepare-gcc-base-image-20260831.sh', import.meta.url), 'utf8');
const body = /<<'CPP_GCC_IMAGE_NODE'\n([\s\S]+)\nCPP_GCC_IMAGE_NODE\n$/.exec(text)?.[1];
assert.ok(body);
const { PIN, normalizeImageId, checkHostInfo, checkImage, checkManifest, checkSpace, workerSource } = await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
const evidence = JSON.parse(fs.readFileSync(new URL('../deploy/compiler-image-evidence-20260831.json', import.meta.url), 'utf8'));
const image = () => ({ Id: PIN.configDigest.slice(7), Digest: PIN.digest, RepoDigests: [PIN.reference], Architecture: 'amd64', Os: 'linux', Config: evidence.config.config, RootFS: { Layers: evidence.config.rootfs.diff_ids }, Size: 1500000000 });
const host = images => ({ version: { Version: '5.8.2' }, host: { arch: 'amd64', security: { rootless: true, seccompEnabled: true }, serviceIsRemote: false, cgroupVersion: 'v2', cgroupManager: 'systemd', ociRuntime: { name: 'crun' }, cgroupControllers: ['cpu', 'memory', 'pids'], idMappings: { uidmap: [{ container_id: 0, host_id: 994, size: 1 }, { container_id: 1, host_id: 200000, size: 65536 }], gidmap: [{ container_id: 0, host_id: 991, size: 1 }, { container_id: 1, host_id: 200000, size: 65536 }] } }, store: { graphDriverName: 'overlay', graphRoot: '/var/www/teaching-cpp-runner/.local/share/containers/storage', runRoot: '/run/user/994/containers', configFile: '/var/www/teaching-cpp-runner/.config/containers/storage.conf', imageCopyTmpDir: '/var/www/teaching-cpp-runner/tmp', imageStore: { number: images }, containerStore: { number: 0 } } });

test('固定下载项对应实际取得的官方 amd64 清单和配置，而非移动标签', () => {
  assert.equal(PIN.indexDigest, evidence.indexDigest);
  assert.equal(PIN.digest, evidence.amd64Digest);
  assert.equal(PIN.configDigest, evidence.configDigest);
  assert.equal(PIN.compressedBytes, evidence.compressedLayerBytes);
  assert.ok(evidence.index.manifests.some(row => row.digest === PIN.digest && row.platform?.architecture === 'amd64' && row.platform?.os === 'linux'));
  assert.equal(evidence.manifest.config.digest, PIN.configDigest);
  assert.equal(PIN.reference, 'docker.io/library/gcc@' + PIN.digest);
  checkManifest(evidence.manifest, PIN);
});

test('镜像 ID 可带 sha256 前缀，短 ID 或其他哈希算法不能冒充固定配置摘要', () => {
  assert.equal(normalizeImageId(PIN.configDigest.slice(7)), PIN.configDigest);
  assert.equal(normalizeImageId(PIN.configDigest), PIN.configDigest);
  for (const value of ['', 'abc', 'sha512:' + 'a'.repeat(64), 'sha256:' + 'a'.repeat(63), null]) assert.throws(() => normalizeImageId(value), { code: 'IMAGE_ID_INVALID' });
});

test('同时核对镜像 ID、清单摘要和官方仓库引用，禁止只看版本标签', () => {
  assert.equal(checkImage(image(), PIN).imageId, PIN.configDigest);
  for (const change of [{ Id: 'a'.repeat(64) }, { Digest: 'sha256:' + 'b'.repeat(64) }, { RepoDigests: ['example.com/gcc@' + PIN.digest] }, { RepoDigests: [] }]) assert.throws(() => checkImage({ ...image(), ...change }, PIN), { code: 'IMAGE_DIGEST_MISMATCH' });
});

test('错误平台、版本元数据、层数或异常镜像体积不能记为下载验证成功', () => {
  assert.throws(() => checkImage({ ...image(), Architecture: 'arm64' }, PIN), { code: 'IMAGE_PLATFORM_MISMATCH' });
  assert.throws(() => checkImage({ ...image(), Config: { Env: ['GCC_VERSION=15.3.0'] } }, PIN), { code: 'IMAGE_CONFIG_MISMATCH' });
  assert.throws(() => checkImage({ ...image(), RootFS: { Layers: [] } }, PIN), { code: 'IMAGE_CONFIG_MISMATCH' });
  for (const Size of [0, -1, Infinity, 4 * 1024 ** 3]) assert.throws(() => checkImage({ ...image(), Size }, PIN), { code: 'IMAGE_SIZE_UNEXPECTED' });
});

test('不在下载时接受已存在镜像或容器，也不在结束时接受多余镜像', () => {
  checkHostInfo(host(0), 0);
  checkHostInfo(host(1), 1);
  assert.throws(() => checkHostInfo(host(1), 0), { code: 'PODMAN_STORE_UNEXPECTED' });
  assert.throws(() => checkHostInfo(host(2), 1), { code: 'PODMAN_STORE_UNEXPECTED' });
  const withContainer = host(0); withContainer.store.containerStore.number = 1;
  assert.throws(() => checkHostInfo(withContainer, 0), { code: 'PODMAN_STORE_UNEXPECTED' });
});

test('禁止 rootful、远程引擎、缺少 CPU 或移到其他存储路径', () => {
  const rootful = host(0); rootful.host.security.rootless = false;
  assert.throws(() => checkHostInfo(rootful, 0), { code: 'ROOTLESS_ISOLATION_CHANGED' });
  const remote = host(0); remote.host.serviceIsRemote = true;
  assert.throws(() => checkHostInfo(remote, 0), { code: 'ROOTLESS_ISOLATION_CHANGED' });
  const noCpu = host(0); noCpu.host.cgroupControllers = ['memory', 'pids'];
  assert.throws(() => checkHostInfo(noCpu, 0), { code: 'DELEGATED_CONTROLLERS_MISSING' });
  const rootStore = host(0); rootStore.store.graphRoot = '/var/lib/containers/storage';
  assert.throws(() => checkHostInfo(rootStore, 0), { code: 'PODMAN_STORAGE_CHANGED' });
});

test('实际用户映射变动不能靠 rootless 布尔值掩盖', () => {
  const value = host(0); value.host.idMappings.uidmap[1].host_id = 100000;
  assert.throws(() => checkHostInfo(value, 0), { code: 'USER_MAPPING_CHANGED' });
  const wrongGid = host(0); wrongGid.host.idMappings.gidmap[0].host_id = 0;
  assert.throws(() => checkHostInfo(wrongGid, 0), { code: 'USER_MAPPING_CHANGED' });
});

test('仓库清单的配置、层数和精确下载总量均需匹配', () => {
  const changedConfig = structuredClone(evidence.manifest); changedConfig.config.digest = 'sha256:' + 'a'.repeat(64);
  assert.throws(() => checkManifest(changedConfig, PIN), { code: 'REGISTRY_MANIFEST_UNEXPECTED' });
  const short = structuredClone(evidence.manifest); short.layers.pop();
  assert.throws(() => checkManifest(short, PIN), { code: 'REGISTRY_MANIFEST_UNEXPECTED' });
  const changedSize = structuredClone(evidence.manifest); changedSize.layers[0].size++;
  assert.throws(() => checkManifest(changedSize, PIN), { code: 'REGISTRY_LAYER_LIST_UNEXPECTED' });
});

test('下载开始和进行中分别保留磁盘余量，不把未知或负数当成可用空间', () => {
  checkSpace(8 * 1024 ** 3, true);
  checkSpace(4 * 1024 ** 3, false);
  assert.throws(() => checkSpace(8 * 1024 ** 3 - 1, true), { code: 'DISK_HEADROOM_INSUFFICIENT' });
  assert.throws(() => checkSpace(4 * 1024 ** 3 - 1, false), { code: 'DISK_HEADROOM_INSUFFICIENT' });
  for (const value of [NaN, Infinity, -1, undefined]) assert.throws(() => checkSpace(value, false), { code: 'DISK_HEADROOM_INSUFFICIENT' });
});

test('传给用户服务的实际程序可解析，使用固定镜像且限定本次服务名', () => {
  const source = workerSource('cpp-gcc-pull-012345abcdef.service');
  assert.doesNotThrow(() => new vm.Script(source));
  assert.ok(source.includes(PIN.reference));
  for (const unit of ['user@0.service', 'user@994.service', 'cpp-gcc-pull-other.service', null]) assert.throws(() => workerSource(unit), { code: 'WORKER_UNIT_INVALID' });
});
