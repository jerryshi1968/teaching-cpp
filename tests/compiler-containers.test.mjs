import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function embedded(file, marker) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const body = new RegExp("<<'" + marker + "'\\n([\\s\\S]+)\\n" + marker + '\\n$').exec(source)?.[1];
  assert.ok(body);
  return import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
}
const material = await embedded('../deploy/verify-compiler-containers-20260831.sh', 'CPP_COMPILER_CHECK_NODE');
const { PIN, checkHostInfo, checkSpace } = await embedded('../deploy/prepare-gcc-base-image-20260831.sh', 'CPP_GCC_IMAGE_NODE');
const { ARCHIVE, DIFF_IDS, checkLoadedImage } = await embedded('../deploy/import-gcc-base-image-20260831.sh', 'CPP_GCC_IMPORT_NODE');
const { SOURCE_HASHES, checkImportRecord, checkTeachingImage, normalizeImageId, buildArguments, ISOLATION_PROBE, checkIsolation, CASES, checkCase, workerSource, checkCompletion } = material;
const label = '0123456789ab', imageId = 'sha256:' + 'a'.repeat(64);
const image = () => ({ Id: imageId.slice(7), Os: 'linux', Architecture: 'amd64', Size: 1800000000, RootFS: { Layers: [...DIFF_IDS, 'sha256:' + 'b'.repeat(64)] }, Config: { Env: ['GCC_VERSION=14.4.0'], Cmd: ['/usr/local/bin/g++', '--version'], WorkingDir: '/work', Labels: { 'io.teaching-cpp.compiler-verification': label } } });
const imported = () => ({ stage: 'official-gcc-base-image-ready', method: 'offline-import', runEnabled: false, containers: 0, archive: ARCHIVE, image: { imageId: PIN.configDigest, sourceManifestDigest: PIN.digest, layerContentVerified: true } });
const host = { net: 'net:[111]', pid: 'pid:[222]', ipc: 'ipc:[333]' };
const isolation = (phase = 'run') => ({ uid: '994', gid: '991', nnp: '1', seccomp: '2', cap: '0000000000000000', bound: '0000000000000000', net: 'net:[444]', pid: 'pid:[555]', ipc: 'ipc:[666]', interfaces: 'lo,', files: 'absent', tmpwrite: 'ok', root: 'ro,relatime', work: `${phase === 'run' ? 'ro' : 'rw'},nosuid,nodev,relatime`, tmp: 'rw,nosuid,nodev,noexec,relatime' });
const lines = value => Object.entries(value).map(([key, value]) => key + '=' + value).join('\n');
const caseResult = item => ({ state: item.state, stdout: item.output || '', stderr: '', compiler_output: item.state === 'compile_error' ? '/work/main.cpp:1:1: error: invalid syntax' : '' });
const events = () => [
  ...Array.from({ length: CASES.length + 5 }, (_, i) => ({ event: 'pass', number: i + 1, name: 'check' })),
  ...CASES.map(item => ({ event: 'case-result', name: item.name, result: caseResult(item) })),
  { event: 'complete', image: { imageId }, inspect: image(), checks: CASES.length + 5, containers: 0, runEnabled: false }
];
const result = rows => ({ status: 0, signal: null, stdout: rows.map(row => JSON.stringify(row)).join('\n') });

test('验证使用既有执行器，源文件哈希与当前交付文件逐字一致', () => {
  for (const [file, digest] of Object.entries(SOURCE_HASHES)) {
    const actual = createHash('sha256').update(fs.readFileSync(new URL('../' + file, import.meta.url))).digest('hex');
    assert.equal(actual, digest, file);
  }
});
test('只有完整成功的离线导入记录可进入容器验证', () => {
  checkImportRecord(imported(), PIN, ARCHIVE);
  for (const change of [{ stage: 'importing' }, { containers: 1 }, { runEnabled: true }, { method: 'download' }]) assert.throws(() => checkImportRecord({ ...imported(), ...change }, PIN, ARCHIVE), { code: 'IMPORT_NOT_CONFIRMED' });
  assert.throws(() => checkImportRecord({ ...imported(), image: { ...imported().image, layerContentVerified: false } }, PIN, ARCHIVE), { code: 'IMPORT_IDENTITY_MISMATCH' });
});
test('构建仅使用完整本地基础镜像 ID 和独立上下文，禁止在线拉取', () => {
  const args = buildArguments('/var/www/teaching-cpp-runner/compiler-check-' + label + '/build', PIN, label);
  assert.ok(args.includes('--pull=never')); assert.ok(args.includes('--network=none')); assert.ok(args.includes('--isolation=oci'));
  assert.ok(args.includes('--build-arg=GCC_BASE=' + PIN.configDigest.slice(7)));
  assert.equal(args.at(-1), '/var/www/teaching-cpp-runner/compiler-check-' + label + '/build');
  for (const context of ['https://example.com/build', '/var/www/teaching-cpp-backend', '/tmp/build', '/var/www/teaching-cpp-runner/compiler-check-' + label + '/../build']) assert.throws(() => buildArguments(context, PIN, label), { code: 'BUILD_SCOPE_INVALID' });
});
test('新教学镜像必须继承全部基础层并具有预期工作目录、命令与本次标记', () => {
  assert.equal(checkTeachingImage(image(), imageId, PIN, DIFF_IDS, label).baseImageId, PIN.configDigest);
  assert.throws(() => checkTeachingImage(image(), PIN.configDigest, PIN, DIFF_IDS, label), { code: 'TEACHING_IMAGE_ID_INVALID' });
  assert.throws(() => checkTeachingImage({ ...image(), RootFS: { Layers: [...DIFF_IDS].reverse() } }, imageId, PIN, DIFF_IDS, label), { code: 'TEACHING_IMAGE_BASE_CHANGED' });
  const wrong = image(); wrong.Config.WorkingDir = '/';
  assert.throws(() => checkTeachingImage(wrong, imageId, PIN, DIFF_IDS, label), { code: 'TEACHING_IMAGE_CONFIG_INVALID' });
  assert.throws(() => checkTeachingImage(image(), imageId, PIN, DIFF_IDS, 'f'.repeat(12)), { code: 'TEACHING_IMAGE_CONFIG_INVALID' });
});
test('构建输出接受两种完整 ID 写法，拒绝短 ID、标签和命令参数', () => {
  assert.equal(normalizeImageId(imageId + '\n'), imageId);
  assert.equal(normalizeImageId(imageId.slice(7)), imageId);
  for (const bad of ['gcc:latest', '--all', '123456789abc', 'sha256:wrong', imageId + '\nother']) assert.throws(() => normalizeImageId(bad), { code: 'BUILT_IMAGE_ID_INVALID' });
});
test('容器内实际身份、seccomp、禁止提权和能力集必须全部符合', () => {
  checkIsolation(lines(isolation()), 'run', host);
  checkIsolation(lines(isolation('compile')), 'compile', host);
  for (const change of [{ uid: '0' }, { gid: '0' }, { nnp: '0' }, { seccomp: '0' }, { cap: '0000000000000001' }, { bound: '0000000000000001' }]) assert.throws(() => checkIsolation(lines({ ...isolation(), ...change }), 'run', host), { code: 'PROBE_PRIVILEGES_INVALID' });
});
test('共享网络/PID/IPC 或出现外网网卡均拒绝通过', () => {
  for (const key of ['net', 'pid', 'ipc']) assert.throws(() => checkIsolation(lines({ ...isolation(), [key]: host[key] }), 'run', host), { code: 'PROBE_NAMESPACE_SHARED' });
  assert.throws(() => checkIsolation(lines({ ...isolation(), interfaces: 'eth0,lo,' }), 'run', host), { code: 'PROBE_HOST_EXPOSURE' });
});
test('只读运行目录、临时目录不可执行及挂载安全选项不能缺失', () => {
  for (const change of [{ root: 'rw' }, { work: 'rw,nosuid,nodev' }, { work: 'ro,nodev' }, { tmp: 'rw,nosuid,nodev' }]) assert.throws(() => checkIsolation(lines({ ...isolation(), ...change }), 'run', host), { code: 'PROBE_MOUNT_INVALID' });
  assert.throws(() => checkIsolation(lines(isolation()) + '\nuid=994', 'run', host), { code: 'PROBE_FORMAT' });
});
test('编译错误、输出截断和预期状态均由真实结果判断', () => {
  for (const item of CASES) checkCase(item, caseResult(item));
  assert.throws(() => checkCase(CASES[0], { state: 'completed', stdout: '41\n' }), { code: 'CASE_OUTPUT_MISMATCH' });
  assert.throws(() => checkCase(CASES[2], { state: 'compile_error', stdout: '', compiler_output: 'engine failure' }), { code: 'COMPILE_ERROR_NOT_CONFIRMED' });
  const output = CASES.find(item => item.state === 'output_limit');
  assert.throws(() => checkCase(output, { state: 'output_limit', stdout: 'x'.repeat(256 * 1024 + 1) }), { code: 'OUTPUT_LIMIT_NOT_ENFORCED' });
});
test('工作进程非零退出、错误事件和未完成的检查不会记录成功', () => {
  checkCompletion(result(events()), PIN, DIFF_IDS, label);
  assert.throws(() => checkCompletion({ ...result(events()), status: 1 }, PIN, DIFF_IDS, label), { code: 'WORKER_NOT_COMPLETED' });
  assert.throws(() => checkCompletion(result([...events(), { event: 'error', code: 'IMAGE_BUILD_FAILED' }]), PIN, DIFF_IDS, label), { code: 'IMAGE_BUILD_FAILED' });
  assert.throws(() => checkCompletion(result(events().filter(row => row.event !== 'complete')), PIN, DIFF_IDS, label), { code: 'VERIFICATION_INCOMPLETE' });
});
test('缺失或篡改任一程序测试结果，不能仅凭通过计数完成验收', () => {
  assert.throws(() => checkCompletion(result(events().filter(row => row.name !== CASES[0].name)), PIN, DIFF_IDS, label), { code: 'CASE_RECORD_INCOMPLETE' });
  const rows = events(); rows.find(row => row.event === 'case-result').result.state = 'system_error';
  assert.throws(() => checkCompletion(result(rows), PIN, DIFF_IDS, label), { code: 'CASE_RESULT_MISMATCH' });
});
test('完整用户服务程序可解析，Windows 上拒绝执行 Linux 操作', { skip: process.platform !== 'win32' }, () => {
  const source = workerSource('cpp-compiler-check-' + label + '.service', label, PIN, DIFF_IDS, checkHostInfo, checkSpace, checkLoadedImage);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.throws(() => workerSource('p5js-backend.service', label, PIN, DIFF_IDS, checkHostInfo, checkSpace, checkLoadedImage), { code: 'WORKER_SCOPE_INVALID' });
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).code, 'WORKER_USER_INVALID');
});
test('固定隔离探针可由 bash 解析，不依赖宿主机秘密内容', { skip: process.platform !== 'win32' }, () => {
  const syntax = spawnSync('C:/Users/jerryshi68/scoop/apps/git/current/bin/bash.exe', ['-n'], { input: ISOLATION_PROBE, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.ok(ISOLATION_PROBE.includes('test ! -e /var/www/teaching-cpp-backend'));
});
