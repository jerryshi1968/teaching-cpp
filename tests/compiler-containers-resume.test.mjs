import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function embedded(file, marker = 'CPP_COMPILER_CHECK_NODE') {
  const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const body = new RegExp("<<'" + marker + "'\\n([\\s\\S]+)\\n" + marker + '\\n$').exec(text)?.[1];
  assert.ok(body); return { text, module: await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64')) };
}
const original = await embedded('../deploy/verify-compiler-containers-20260831.sh');
const resumed = await embedded('../deploy/resume-compiler-containers-20260831-02.sh');
const { buildContainerfile, checkPreviousFailure, workerSource } = resumed.module;
const { PIN, checkHostInfo, checkSpace } = (await embedded('../deploy/prepare-gcc-base-image-20260831.sh', 'CPP_GCC_IMAGE_NODE')).module;
const { DIFF_IDS, checkLoadedImage } = (await embedded('../deploy/import-gcc-base-image-20260831.sh', 'CPP_GCC_IMPORT_NODE')).module;
const containerfile = fs.readFileSync(new URL('../runner/Containerfile', import.meta.url));
const failure = () => [
  { event: 'stage', name: '离线构建教学镜像（不拉取镜像、不联网安装软件）' },
  { event: 'build-result', result: { code: 1, stdout: 'STEP 1/6: FROM fixed\nSTEP 2/6: RUN test', stderr: "mkdir: cannot create directory '/work': Permission denied\n", signal: null, reason: null } },
  { event: 'error', code: 'IMAGE_BUILD_FAILED' },
  { event: 'remaining-containers', value: [] }
];
const record = rows => ({ status: 1, signal: null, stdout: rows.map(row => JSON.stringify(row)).join('\n') });

test('02 只提前 WORKDIR 并将 RUN 改为检查，不再要求受限 RUN 创建目录', () => {
  const patched = buildContainerfile(containerfile).toString('utf8');
  assert.ok(patched.indexOf('WORKDIR /work') < patched.indexOf('RUN test -x'));
  assert.ok(!patched.includes('mkdir -p /work'));
  assert.ok(!patched.includes('chmod 755 /work'));
  assert.ok(patched.includes('test "$(stat -c %a /work)" = 755'));
  assert.equal(patched.split('WORKDIR /work').length, 2);
  assert.equal(patched.slice(patched.indexOf('ENV LANG=')), containerfile.toString().slice(containerfile.toString().indexOf('ENV LANG=')));
});
test('原构建文件、原脚本及已有注释逐字保留', () => {
  const digest = value => createHash('sha256').update(value).digest('hex');
  assert.equal(digest(containerfile), '89400093593b873846787d97d59ae01f569a18190145b605d05b46a2dc2d26a8');
  assert.equal(digest(original.text), '7619e68b594636617cee2f21a6623ff736ea9ecdf033abc55eba70690621ca1d');
  const patched = buildContainerfile(containerfile).toString();
  for (const comment of containerfile.toString().split('\n').filter(line => /^\s*#/.test(line))) assert.ok(patched.includes(comment));
  for (const line of original.text.split('\n').filter(line => /^\s*(?:#|\/\/)/.test(line) || line.includes('/*'))) assert.ok(resumed.text.includes(line), line);
});
test('构建上下文有任意未核验改动时，不自动改写', () => {
  assert.throws(() => buildContainerfile(containerfile.toString().replace('mkdir -p', 'mkdir -m 777 -p')), { code: 'ORIGINAL_CONTAINERFILE_CHANGED' });
  assert.throws(() => buildContainerfile(containerfile.toString() + '\n'), { code: 'ORIGINAL_CONTAINERFILE_CHANGED' });
});
test('接续不改变构建参数、运行器检查或测试案例', () => {
  for (const name of ['buildArguments', 'checkTeachingImage', 'checkIsolation', 'checkCase', 'checkCompletion']) assert.equal(resumed.module[name].toString(), original.module[name].toString(), name);
  assert.deepEqual(resumed.module.SOURCE_HASHES, original.module.SOURCE_HASHES);
  assert.deepEqual(resumed.module.CASES, original.module.CASES);
  assert.equal(resumed.module.ISOLATION_PROBE, original.module.ISOLATION_PROBE);
});
test('只接受已确认的 /work 创建权限失败记录', () => {
  checkPreviousFailure(record(failure()));
  const rows = failure(); rows[1].result.stderr = 'network timeout';
  assert.throws(() => checkPreviousFailure(record(rows)), { code: 'PREVIOUS_BUILD_REASON_CHANGED' });
  assert.throws(() => checkPreviousFailure({ ...record(failure()), status: 0 }), { code: 'PREVIOUS_RESULT_INVALID' });
});
test('超时、未知容器状态、已进入测试或尚有容器时拒绝接续', () => {
  const timeout = failure(); timeout[1].result.reason = 'time';
  assert.throws(() => checkPreviousFailure(record(timeout)), { code: 'PREVIOUS_BUILD_NOT_EXPECTED' });
  for (const event of ['pass', 'case-result', 'complete', 'container-state-unconfirmed']) assert.throws(() => checkPreviousFailure(record([...failure(), { event }])), { code: 'PREVIOUS_STAGE_CHANGED' });
  const remaining = failure(); remaining.at(-1).value.push({ Id: 'some-container' });
  assert.throws(() => checkPreviousFailure(record(remaining)), { code: 'PREVIOUS_CONTAINER_CLEANUP_UNCONFIRMED' });
});
test('重复或不完整的失败记录拒绝接续', () => {
  const rows = failure();
  assert.throws(() => checkPreviousFailure(record([...rows, rows[1]])), { code: 'PREVIOUS_BUILD_NOT_EXPECTED' });
  assert.throws(() => checkPreviousFailure(record(rows.slice(0, -1))), { code: 'PREVIOUS_CONTAINER_CLEANUP_UNCONFIRMED' });
});
test('接续后完整工作程序可解析，在 Windows 上不执行 Linux 操作', { skip: process.platform !== 'win32' }, () => {
  const label = '0123456789ab';
  const source = workerSource('cpp-compiler-check-' + label + '.service', label, PIN, DIFF_IDS, checkHostInfo, checkSpace, checkLoadedImage);
  assert.doesNotThrow(() => new vm.Script(source));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).code, 'WORKER_USER_INVALID');
  const runInstruction = buildContainerfile(containerfile).toString().split('\n').find(line => line.startsWith('RUN ')).slice(4);
  const bash = spawnSync('C:/Users/jerryshi68/scoop/apps/git/current/bin/bash.exe', ['-n'], { input: runInstruction, encoding: 'utf8' });
  assert.equal(bash.status, 0, bash.stderr);
});
