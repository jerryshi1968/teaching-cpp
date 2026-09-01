import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function embedded(file, marker) {
  const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const body = new RegExp("<<'" + marker + "'\\n([\\s\\S]+)\\n" + marker + '\\n$').exec(text)?.[1];
  assert.ok(body);
  return import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
}
const { ARCHIVE, DIFF_IDS, checkOldFailure, checkInactiveUnit, checkArchiveStat, checkLoadedImage, loadArguments, workerSource, checkWorkerResult } = await embedded('../deploy/import-gcc-base-image-20260831.sh', 'CPP_GCC_IMPORT_NODE');
const { PIN, checkHostInfo, checkSpace } = await embedded('../deploy/prepare-gcc-base-image-20260831.sh', 'CPP_GCC_IMAGE_NODE');
const evidence = JSON.parse(fs.readFileSync(new URL('../deploy/compiler-image-evidence-20260831.json', import.meta.url), 'utf8'));
const image = () => ({ Id: PIN.configDigest.slice(7), Architecture: 'amd64', Os: 'linux', Config: { Env: ['GCC_VERSION=14.4.0'] }, RootFS: { Layers: [...DIFF_IDS] }, Size: 1600000000 });
const file = '/var/www/teaching-cpp-backend/imports/gcc-base-ABC123/gcc-14.4.0-linux-amd64.oci.tar';
const idle = { pids: [], complete: true };
const fixtureRecord = events => ({ status: 1, signal: null, stdout: events.map(row => JSON.stringify(row)).join('\n') });
const oldEvents = [{ event: 'stage', value: 'rootless-checked' }, { event: 'error', code: 'IMAGE_PREPARATION_FAILED', causeCode: 'ETIMEDOUT' }];

test('导入内容身份与已经取得的官方配置及各层内容摘要一致', () => {
  assert.deepEqual(DIFF_IDS, evidence.config.rootfs.diff_ids);
  assert.equal(PIN.configDigest, evidence.configDigest);
  assert.equal(ARCHIVE.name, 'gcc-14.4.0-linux-amd64.oci.tar');
  assert.equal(ARCHIVE.bytes, 540504576);
  assert.equal(ARCHIVE.sha256, '4190852b88d938f8695a3208bcc76aaed5818b27556727d66541f2d508cac4fc');
});

test('不把原下载成功、进入下载或不完整记录当成已知的元数据失败', () => {
  checkOldFailure(fixtureRecord(oldEvents));
  assert.throws(() => checkOldFailure({ ...fixtureRecord(oldEvents), status: 0 }), { code: 'OLD_WORKER_RECORD_UNEXPECTED' });
  for (const extra of [{ event: 'complete' }, { event: 'progress' }, { event: 'stage', value: 'official-manifest-verified' }]) assert.throws(() => checkOldFailure(fixtureRecord([...oldEvents, extra])), { code: 'OLD_WORKER_STAGE_UNEXPECTED' });
  assert.throws(() => checkOldFailure(fixtureRecord([oldEvents[1]])), { code: 'OLD_WORKER_STAGE_UNEXPECTED' });
});

test('已回收和已停止可以继续，活动进程或未知状态不能继续导入', () => {
  const gone = { LoadState: 'not-found', ActiveState: 'inactive' };
  assert.equal(checkInactiveUnit(1, gone, idle), 'collected');
  assert.equal(checkInactiveUnit(0, { LoadState: 'loaded', ActiveState: 'failed', MainPID: '0', ControlPID: '0' }, idle), 'stopped');
  assert.throws(() => checkInactiveUnit(1, gone, { pids: [345], complete: true }), { code: 'PREVIOUS_TASK_STATE_UNCONFIRMED' });
  assert.throws(() => checkInactiveUnit(1, gone, { pids: [], complete: false }), { code: 'PREVIOUS_TASK_STATE_UNCONFIRMED' });
  assert.throws(() => checkInactiveUnit(null, gone, idle), { code: 'PREVIOUS_TASK_STATE_UNCONFIRMED' });
  assert.throws(() => checkInactiveUnit(1, {}, idle), { code: 'PREVIOUS_TASK_NOT_STOPPED' });
  assert.throws(() => checkInactiveUnit(0, { ...gone, ActiveState: 'deactivating' }, idle), { code: 'PREVIOUS_TASK_NOT_STOPPED' });
});

test('普通账号可改写、链接、大小错误或路径重定向的上传包不能导入', () => {
  const stat = { isFile: () => true, isSymbolicLink: () => false, nlink: 1, uid: 0, gid: 991, size: ARCHIVE.bytes, mode: 0o100440 };
  checkArchiveStat(stat, file, file, ARCHIVE, true);
  checkArchiveStat({ ...stat, gid: 0, mode: 0o100600 }, file, file, ARCHIVE, false);
  for (const change of [{ uid: 994 }, { nlink: 2 }, { mode: 0o100664 }, { size: 100 }, { isSymbolicLink: () => true }]) assert.throws(() => checkArchiveStat({ ...stat, ...change }, file, file, ARCHIVE, true), { code: 'ARCHIVE_FILE_UNEXPECTED' });
  assert.throws(() => checkArchiveStat(stat, '/tmp/other', file, ARCHIVE, true), { code: 'ARCHIVE_FILE_UNEXPECTED' });
  assert.throws(() => checkArchiveStat({ ...stat, gid: 0 }, file, file, ARCHIVE, true), { code: 'STAGED_ARCHIVE_PERMISSIONS' });
  assert.throws(() => checkArchiveStat({ ...stat, mode: 0o100640 }, file, file, ARCHIVE, true), { code: 'STAGED_ARCHIVE_PERMISSIONS' });
});

test('离线包不要求伪造远程仓库引用，按完整配置 ID 和层内容验证', () => {
  const value = image();
  const result = checkLoadedImage(value, PIN, DIFF_IDS);
  assert.equal(result.imageId, PIN.configDigest);
  assert.equal(result.sourceManifestDigest, PIN.digest);
  assert.equal(result.storedManifestDigest, null);
  assert.equal(result.layerContentVerified, true);
  assert.equal(checkLoadedImage({ ...value, Id: PIN.configDigest, RepoTags: ['localhost/gcc-base-14.4.0-amd64:latest'], RepoDigests: [], Digest: 'sha256:' + 'a'.repeat(64) }, PIN, DIFF_IDS).storedManifestDigest, 'sha256:' + 'a'.repeat(64));
});

test('正确版本标签不能掩盖错误镜像 ID、篡改层或顺序变化', () => {
  assert.throws(() => checkLoadedImage({ ...image(), Id: 'b'.repeat(64) }, PIN, DIFF_IDS), { code: 'LOADED_CONFIG_ID_MISMATCH' });
  assert.throws(() => checkLoadedImage({ ...image(), RootFS: { Layers: [...DIFF_IDS].reverse() } }, PIN, DIFF_IDS), { code: 'LOADED_LAYER_CONTENT_MISMATCH' });
  assert.throws(() => checkLoadedImage({ ...image(), RootFS: { Layers: [...DIFF_IDS.slice(0, -1), 'sha256:' + 'c'.repeat(64)] } }, PIN, DIFF_IDS), { code: 'LOADED_LAYER_CONTENT_MISMATCH' });
});

test('错误平台、版本元数据和不合理大小不能通过导入后验证', () => {
  for (const change of [{ Architecture: 'arm64' }, { Os: 'windows' }, { Config: { Env: ['GCC_VERSION=13.4.0'] } }]) assert.throws(() => checkLoadedImage({ ...image(), ...change }, PIN, DIFF_IDS), { code: 'LOADED_PLATFORM_OR_VERSION_MISMATCH' });
  for (const Size of [0, -1, Infinity, 4 * 1024 ** 3]) assert.throws(() => checkLoadedImage({ ...image(), Size }, PIN, DIFF_IDS), { code: 'LOADED_SIZE_UNEXPECTED' });
});

test('load 只能接收指定只读副本路径，不能变成 URL 下载或 rootful 命令', () => {
  assert.deepEqual(loadArguments(file), ['--remote=false', 'load', '--quiet', '--input', file]);
  for (const bad of ['https://example.org/image.tar', '/tmp/image.tar', file.replace('/gcc-base-ABC123/', '/gcc-base-ABC123/../'), file + ';rm -rf /', file.replace('gcc-14.4.0', 'gcc-latest')]) assert.throws(() => loadArguments(bad), { code: 'IMPORT_PATH_INVALID' });
});

test('工具退出异常或缺少完整核验结果时，不能记录导入成功', () => {
  const complete = { event: 'complete', inspect: image(), info: {} };
  const good = { ...fixtureRecord([complete]), status: 0 };
  assert.equal(checkWorkerResult(good, PIN, DIFF_IDS).inspect.Id, PIN.configDigest.slice(7));
  assert.throws(() => checkWorkerResult({ ...good, status: 1 }, PIN, DIFF_IDS), { code: 'IMPORT_WORKER_NOT_COMPLETED' });
  assert.throws(() => checkWorkerResult({ ...good, signal: 'SIGKILL' }, PIN, DIFF_IDS), { code: 'IMPORT_WORKER_NOT_COMPLETED' });
  assert.throws(() => checkWorkerResult({ ...fixtureRecord([complete, { event: 'error', code: 'PODMAN_LOAD_FAILED' }]), status: 0 }, PIN, DIFF_IDS), { code: 'PODMAN_LOAD_FAILED' });
  assert.throws(() => checkWorkerResult({ ...fixtureRecord([]), status: 0 }, PIN, DIFF_IDS), { code: 'IMPORT_RESULT_MISSING' });
  assert.throws(() => checkWorkerResult({ ...fixtureRecord([complete, complete]), status: 0 }, PIN, DIFF_IDS), { code: 'IMPORT_RESULT_MISSING' });
});

test('传给用户管理器的完整工作程序语法正确，拒绝不同任务名和来源', () => {
  const unit = 'cpp-gcc-load-0123456789ab.service';
  const source = workerSource(unit, file, PIN, checkHostInfo, checkSpace);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.throws(() => workerSource('p5js-backend.service', file, PIN, checkHostInfo, checkSpace), { code: 'WORKER_UNIT_INVALID' });
  assert.throws(() => workerSource(unit, '/tmp/archive.tar', PIN, checkHostInfo, checkSpace), { code: 'IMPORT_PATH_INVALID' });
});
