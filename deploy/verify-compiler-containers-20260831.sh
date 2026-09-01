#!/usr/bin/env bash
# 只构建和验证教学镜像，保留现有网站、账号限额及关闭的编译运行开关。
# 所有编译与测试均在 cpp-runner 的 rootless 容器中执行，不在宿主机执行生成的程序。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux && test "$(id -u)" -eq 0 || { printf '请在 Linux 服务器原来的 root 会话执行。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --verify-compiler-containers <<'CPP_COMPILER_CHECK_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const ROOT = '/var/www/teaching-cpp-backend';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const NODE = ROOT + '/tools/node/bin/node';
const IMPORT_RECORD = ROOT + '/backups/gcc-base-import-y9tsnD';
const LOCK = ROOT + '/backups/compiler-check.lock';
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus', TMPDIR: HOME_DIR + '/tmp' };
export const SOURCE_HASHES = Object.freeze({
  'runner/Containerfile': '89400093593b873846787d97d59ae01f569a18190145b605d05b46a2dc2d26a8',
  'runner/src/podman.mjs': '30feaf9ff99acab6f4f710e78ab088c63e16990d30ca5e5d1935f14190769427',
  'runner/src/jobs.mjs': 'cb787583090efc18b7c852a58a66be678c3f3fb52d64e65af61b638620118ba2',
  'runner/src/instance-lock.mjs': '37d6370cd985908aa464cfb28b6b4fd817cfe3dfb366153bdbdccc801d739c8b',
  'backend/src/validation.mjs': 'a8a8d159f0cc2391b325324cade3167fe5cfb005c137efe0788b734ac2f48854',
  'backend/src/errors.mjs': 'c80f11fe7142b83fceaca526ed8bb636e1deeb94fc42b298ee111497f9a9c5ca',
  'shared/contracts.mjs': 'eb4c44dc00812dc288a1d9f8d16cb6387c387ddaffa0e13b726f4c0a6704a6ef'
});
const IMAGE_LABEL = 'io.teaching-cpp.compiler-verification';
let record, logFd, lockFd, old, imageHelpers, accountHelpers, repairHelpers, rootlessHelpers;
let phase = '初始检查';
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(code) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(code || '') ? code : 'COMPILER_CHECK_FAILED'; }
function log(message) { const line = new Date().toISOString() + ' ' + message + '\n'; process.stdout.write(line); if (logFd !== undefined) fs.writeSync(logFd, line); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(message) { phase = message; log(message); fs.writeFileSync(record + '/phase.txt', message + '\n', { mode: 0o600 }); }
function exists(file) { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export function checkSource(file, expected) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fs.realpathSync(file) === file && stat.uid === 0 && (stat.mode & 0o022) === 0 && stat.size < 256 * 1024, 'SOURCE_FILE_UNSAFE');
  const bytes = fs.readFileSync(file);
  ensure(createHash('sha256').update(bytes).digest('hex') === expected, 'SOURCE_CHANGED');
  return bytes;
}
export function checkImportRecord(value, pin, archive) {
  ensure(value?.stage === 'official-gcc-base-image-ready' && value.method === 'offline-import' && value.runEnabled === false && value.containers === 0, 'IMPORT_NOT_CONFIRMED');
  ensure(value.image?.imageId === pin.configDigest && value.image.layerContentVerified === true && value.image.sourceManifestDigest === pin.digest && value.archive?.sha256 === archive.sha256 && value.archive.bytes === archive.bytes, 'IMPORT_IDENTITY_MISMATCH');
}
export function checkTeachingImage(value, imageId, pin, diffIds, label) {
  ensure(/^sha256:[a-f0-9]{64}$/.test(imageId) && imageId !== pin.configDigest && 'sha256:' + String(value?.Id || '').replace(/^sha256:/, '') === imageId, 'TEACHING_IMAGE_ID_INVALID');
  const layers = value.RootFS?.Layers;
  ensure(value.Os === 'linux' && value.Architecture === 'amd64' && value.Config?.Env?.includes('GCC_VERSION=' + pin.tag), 'TEACHING_IMAGE_PLATFORM_INVALID');
  ensure(Array.isArray(layers) && layers.length === diffIds.length + 1 && diffIds.every((id, i) => layers[i] === id) && /^sha256:[a-f0-9]{64}$/.test(layers.at(-1)), 'TEACHING_IMAGE_BASE_CHANGED');
  ensure(value.Config?.WorkingDir === '/work' && JSON.stringify(value.Config.Cmd) === JSON.stringify(['/usr/local/bin/g++', '--version']) && value.Config.Labels?.[IMAGE_LABEL] === label, 'TEACHING_IMAGE_CONFIG_INVALID');
  ensure(Number.isSafeInteger(value.Size) && value.Size > 0 && value.Size < 4 * 1024 ** 3, 'TEACHING_IMAGE_SIZE_INVALID');
  return { imageId, baseImageId: pin.configDigest, layers, architecture: value.Architecture, os: value.Os, bytes: value.Size };
}
export function normalizeImageId(value) {
  const id = typeof value === 'string' && /^[a-f0-9]{64}$/.test(value.trim()) ? 'sha256:' + value.trim() : String(value || '').trim();
  ensure(/^sha256:[a-f0-9]{64}$/.test(id), 'BUILT_IMAGE_ID_INVALID');
  return id;
}
export function buildArguments(context, pin, label) {
  ensure(/^\/var\/www\/teaching-cpp-runner\/compiler-check-[a-f0-9]{12}\/build$/.test(context) && /^[a-f0-9]{12}$/.test(label) && /^sha256:[a-f0-9]{64}$/.test(pin.configDigest), 'BUILD_SCOPE_INVALID');
  return ['--remote=false', 'build', '--pull=never', '--network=none', '--http-proxy=false', '--isolation=oci', '--jobs=1', '--layers=false', '--no-cache', '--rm=true', '--force-rm=true', '--format=oci', '--cap-drop=ALL', '--memory=512m', '--memory-swap=512m', '--cpu-period=100000', '--cpu-quota=100000', '--label=' + IMAGE_LABEL + '=' + label, '--iidfile=' + context + '/image.id', '--build-arg=GCC_BASE=' + pin.configDigest.slice(7), '--file=' + context + '/Containerfile', context];
}
export const ISOLATION_PROBE = String.raw`printf 'uid=%s\n' "$(id -u)"
printf 'gid=%s\n' "$(id -g)"
printf 'net=%s\n' "$(readlink /proc/self/ns/net)"
printf 'pid=%s\n' "$(readlink /proc/self/ns/pid)"
printf 'ipc=%s\n' "$(readlink /proc/self/ns/ipc)"
printf 'interfaces=%s\n' "$(ls /sys/class/net | tr '\n' ',')"
awk '/^NoNewPrivs:/ {print "nnp=" $2} /^Seccomp:/ {print "seccomp=" $2} /^CapEff:/ {print "cap=" $2} /^CapBnd:/ {print "bound=" $2}' /proc/self/status
awk '$5=="/" {print "root=" $6} $5=="/work" {print "work=" $6} $5=="/tmp" {print "tmp=" $6}' /proc/self/mountinfo
test ! -e /var/www/teaching-cpp-backend
test ! -e /var/www/teaching-p5js-backend
test ! -e /run/user/994/bus
if printenv DB_PASSWORD >/dev/null; then exit 91; fi
if printenv RUNNER_TOKEN >/dev/null; then exit 92; fi
printf 'files=absent\n'
printf 'ok' > /tmp/write-test
printf 'tmpwrite=ok\n'
`;
export function checkIsolation(text, phase, hostNamespaces) {
  const rows = {};
  for (const line of text.trim().split('\n')) { const at = line.indexOf('='); ensure(at > 0 && !Object.hasOwn(rows, line.slice(0, at)), 'PROBE_FORMAT'); rows[line.slice(0, at)] = line.slice(at + 1); }
  ensure(rows.uid === '994' && rows.gid === '991' && rows.nnp === '1' && rows.seccomp === '2' && /^0+$/.test(rows.cap || '') && /^0+$/.test(rows.bound || ''), 'PROBE_PRIVILEGES_INVALID');
  for (const key of ['net', 'pid', 'ipc']) ensure(new RegExp('^' + key + ':\\[[0-9]+\\]$').test(rows[key] || '') && rows[key] !== hostNamespaces[key], 'PROBE_NAMESPACE_SHARED');
  ensure(rows.interfaces === 'lo,' && rows.files === 'absent' && rows.tmpwrite === 'ok', 'PROBE_HOST_EXPOSURE');
  const has = (name, flag) => (rows[name] || '').split(',').includes(flag);
  ensure(['compile', 'run'].includes(phase) && has('root', 'ro') && has('work', phase === 'compile' ? 'rw' : 'ro') && ['nosuid', 'nodev'].every(flag => has('work', flag)) && ['rw', 'noexec', 'nosuid', 'nodev'].every(flag => has('tmp', flag)), 'PROBE_MOUNT_INVALID');
  return rows;
}
export const CASES = Object.freeze([
  { name: 'C++17 标准输入输出', profileId: 'cpp17', code: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}', stdin: '12 30\n', state: 'completed', output: '42\n' },
  { name: 'C++14 编译配置', profileId: 'cpp14', code: '#include <iostream>\nint main(){std::cout<<__cplusplus<<"\\n";}', state: 'completed', output: '201402\n' },
  { name: '编译错误不执行', code: 'int main(){ invalid syntax }', state: 'compile_error' },
  { name: '非零退出码', code: 'int main(){return 7;}', state: 'runtime_error' },
  { name: '运行目录只读、临时目录禁止执行、无法连接主站', code: '#include <cstdio>\n#include <cerrno>\n#include <unistd.h>\n#include <fcntl.h>\n#include <sys/stat.h>\n#include <sys/socket.h>\n#include <arpa/inet.h>\nint main(){if(getuid()!=994||getgid()!=991||getpid()!=1)return 2;int f=open("/work/main.cpp",O_WRONLY);if(f>=0||errno!=EROFS)return 3;FILE*x=fopen("/tmp/test.sh","w");if(!x)return 4;fputs("#!/bin/sh\\nexit 0\\n",x);fclose(x);if(chmod("/tmp/test.sh",0700)!=0)return 5;execl("/tmp/test.sh","/tmp/test.sh",(char*)0);if(errno!=EACCES)return 6;int s=socket(AF_INET,SOCK_STREAM,0);if(s<0)return 7;sockaddr_in a{};a.sin_family=AF_INET;a.sin_port=htons(5080);inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);if(connect(s,(sockaddr*)&a,sizeof(a))==0)return 8;close(s);puts("isolated");}\n', state: 'completed', output: 'isolated\n' },
  { name: '进程数上限（最多尝试 32 个子进程）', code: '#include <unistd.h>\n#include <sys/wait.h>\n#include <signal.h>\n#include <cerrno>\nint main(){pid_t p[32];int n=0;bool limited=false;for(;n<32;++n){p[n]=fork();if(p[n]==0){for(;;)pause();}if(p[n]<0){limited=errno==EAGAIN;break;}}for(int i=0;i<n;++i)kill(p[i],SIGKILL);for(int i=0;i<n;++i)waitpid(p[i],nullptr,0);return limited?0:9;}', state: 'completed' },
  { name: '墙钟超时', code: '#include <unistd.h>\nint main(){for(;;)pause();}', state: 'time_limit' },
  { name: 'CPU 时间上限', code: 'int main(){for(;;)asm volatile("":::"memory");}', state: 'time_limit' },
  { name: '输出上限', code: '#include <cstdio>\nint main(){for(int i=0;i<40000;++i)puts("012345678901234567890123456789");}', state: 'output_limit' },
  { name: '容器内存上限', code: '#include <cstdlib>\n#include <cstring>\nint main(){for(int i=0;i<32;++i){void*p=malloc(16*1024*1024);if(!p)return 9;memset(p,7,16*1024*1024);asm volatile(""::"r"(p):"memory");}return 8;}', state: 'memory_limit' },
  { name: '主动取消运行', code: '#include <unistd.h>\nint main(){for(;;)pause();}', state: 'cancelled', cancel: true }
]);
export function checkCase(item, result) {
  ensure(result?.state === item.state, 'CASE_RESULT_MISMATCH');
  if (item.output !== undefined) ensure(result.stdout === item.output, 'CASE_OUTPUT_MISMATCH');
  if (item.state === 'compile_error') ensure(result.stdout === '' && /error:/.test(result.compiler_output || ''), 'COMPILE_ERROR_NOT_CONFIRMED');
  if (item.state === 'output_limit') ensure(Buffer.byteLength((result.stdout || '') + (result.stderr || '')) <= 256 * 1024, 'OUTPUT_LIMIT_NOT_ENFORCED');
}

async function compilerWorker(unit, label, pin, diffIds, hashes) {
  const fs = await import('node:fs');
  const { createHash, randomUUID } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const root = '/var/www/teaching-cpp-backend', home = '/var/www/teaching-cpp-runner';
  const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
  const call = args => execFileSync('/usr/bin/podman', ['--remote=false', ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] });
  const area = home + '/compiler-check-' + label;
  const started = Date.now();
  let release, timer, lastStage = '用户环境检查', manager, checkCount = 0, environmentConfirmed = false;
  const mark = name => { lastStage = name; emit({ event: 'stage', name }); };
  const passed = (name, details) => { checkCount++; emit({ event: 'pass', number: checkCount, name, details }); };
  const assertEmpty = () => ensure(JSON.parse(call(['ps', '--all', '--external', '--format=json'])).length === 0, 'CONTAINERS_REMAIN');
  try {
    ensure(process.platform === 'linux' && process.getuid() === 994 && process.getgid() === 991, 'WORKER_USER_INVALID');
    const group = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').find(line => line.startsWith('0::'))?.slice(3) || '';
    ensure(group.startsWith('/user.slice/user-994.slice/user@994.service/') && group.endsWith('/' + unit), 'WORKER_CGROUP_INVALID');
    ensure(/^NoNewPrivs:\s+0\s*$/m.test(fs.readFileSync('/proc/self/status', 'utf8')), 'MAPPING_HELPERS_BLOCKED');
    environmentConfirmed = true;
    for (const [file, digest] of Object.entries(hashes)) checkSource(root + '/' + file, digest);
    const { acquireInstanceLock } = await import('file://' + root + '/runner/src/instance-lock.mjs');
    release = await acquireInstanceLock(994);
    checkHostInfo(JSON.parse(call(['info', '--format=json'])), 1); assertEmpty();
    checkLoadedImage(JSON.parse(call(['image', 'inspect', pin.configDigest.slice(7)]))[0], pin, diffIds);
    const disk = () => { const stat = fs.statfsSync(home); const bytes = stat.bavail * stat.bsize; checkSpace(bytes, false); return Math.floor(bytes / 1024 ** 2); };
    checkSpace(fs.statfsSync(home).bavail * fs.statfsSync(home).bsize, true);
    timer = setInterval(() => { try { emit({ event: 'progress', seconds: Math.floor((Date.now() - started) / 1000), freeMiB: disk() }); } catch { emit({ event: 'error', code: 'DISK_HEADROOM_INSUFFICIENT', phase: lastStage }); process.exit(1); } }, 15000);
    fs.mkdirSync(area, { mode: 0o700 }); fs.mkdirSync(area + '/build', { mode: 0o700 });
    fs.writeFileSync(area + '/build/Containerfile', checkSource(root + '/runner/Containerfile', hashes['runner/Containerfile']), { flag: 'wx', mode: 0o600 });
    mark('离线构建教学镜像（不拉取镜像、不联网安装软件）');
    const { command, PodmanSandbox, containerOptions } = await import('file://' + root + '/runner/src/podman.mjs');
    const { JobManager } = await import('file://' + root + '/runner/src/jobs.mjs');
    const build = await command('/usr/bin/podman', buildArguments(area + '/build', pin, label), { timeout: 180000, outputLimit: 2 * 1024 ** 2 });
    emit({ event: 'build-result', result: build });
    ensure(build.code === 0 && !build.reason && !build.signal, 'IMAGE_BUILD_FAILED');
    const imageId = normalizeImageId(fs.readFileSync(area + '/build/image.id', 'utf8'));
    const inspect = JSON.parse(call(['image', 'inspect', imageId]))[0];
    const image = checkTeachingImage(inspect, imageId, pin, diffIds, label);
    checkHostInfo(JSON.parse(call(['info', '--format=json'])), 2); assertEmpty();
    passed('教学镜像内容、来源及离线构建', { image, inspect });
    const config = { image: imageId, uid: 994, gid: 991, podman: '/usr/bin/podman', dataRoot: area + '/jobs-data', minFreeBytes: 4 * 1024 ** 3 };
    const sandbox = new PodmanSandbox(config);
    mark('核验编译和运行容器中的实际资源限额');
    passed('编译/运行 cgroup 限额', await sandbox.preflight());
    const hostNamespaces = Object.fromEntries(['net', 'pid', 'ipc'].map(key => [key, fs.readlinkSync('/proc/self/ns/' + key)]));
    fs.mkdirSync(area + '/probe', { mode: 0o700 });
    for (const kind of ['compile', 'run']) {
      mark(kind === 'compile' ? '检查编译容器隔离' : '检查运行容器隔离');
      const name = 'cpp-probe-' + randomUUID() + '-' + kind;
      try {
        const output = await sandbox.control(['run', ...containerOptions(config, name, kind, area + '/probe'), imageId.slice(7), '/bin/sh', '-eu', '-c', ISOLATION_PROBE]);
        passed(kind + ' 权限、网络/PID/IPC 隔离与挂载', checkIsolation(output, kind, hostNamespaces));
      } finally { await sandbox.removeContainer(name); }
    }
    const versionName = 'cpp-probe-' + randomUUID() + '-run';
    try {
      const version = (await sandbox.control(['run', ...containerOptions(config, versionName, 'run'), imageId.slice(7), '/usr/local/bin/g++', '-dumpfullversion'])).trim();
      ensure(version === pin.tag, 'GCC_EXECUTABLE_VERSION_MISMATCH'); passed('实际 GCC 可执行文件版本', { version });
    } finally { await sandbox.removeContainer(versionName); }
    manager = new JobManager(config, sandbox); await manager.init();
    for (const item of CASES) {
      disk(); mark(item.name);
      const id = randomUUID();
      await manager.submit({ id, code: item.code, stdin: item.stdin || '', profileId: item.profileId || 'cpp17', image: imageId });
      const promise = manager.current?.promise;
      if (item.cancel) {
        const deadline = Date.now() + 30000;
        while ((await manager.get(id)).state === 'compiling' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        ensure((await manager.get(id)).state === 'running', 'CANCEL_TEST_NOT_RUNNING');
        let running = false;
        const runDeadline = Date.now() + 5000;
        while (!running && Date.now() < runDeadline) {
          try { running = JSON.parse(call(['inspect', sandbox.names(id)[1]]))[0]?.State?.Running === true; } catch { /* 创建完成前尚不能 inspect；仅短暂等待本测试容器。 */ }
          if (!running) await new Promise(resolve => setTimeout(resolve, 50));
        }
        ensure(running, 'CANCEL_CONTAINER_NOT_RUNNING');
        await manager.cancel(id);
      }
      await promise;
      const result = await manager.get(id); emit({ event: 'case-result', name: item.name, result });
      checkCase(item, result); ensure(manager.current === null, 'JOB_CLEANUP_UNCONFIRMED'); assertEmpty();
      passed(item.name, { state: result.state, elapsedMs: result.elapsed_ms, outputBytes: Buffer.byteLength(result.stdout || '') });
    }
    await manager.stop(); assertEmpty();
    ensure(fs.readdirSync(config.dataRoot + '/work').length === 0, 'WORK_DIRECTORIES_REMAIN');
    const info = JSON.parse(call(['info', '--format=json'])); checkHostInfo(info, 2);
    emit({ event: 'complete', image, inspect, info, checks: checkCount, area, runEnabled: false, containers: 0 });
  } catch (error) {
    // 原始工具输出和测试结果由 root 父进程保存，不回显环境变量或网站配置。
    emit({ event: 'error', code: safeCode(error.code), phase: lastStage, detail: String(error.message || '').slice(0, 1200) });
    if (manager) { try { await manager.stop(); } catch { emit({ event: 'cleanup-unconfirmed' }); } }
    if (environmentConfirmed) { try { emit({ event: 'remaining-containers', value: JSON.parse(call(['ps', '--all', '--external', '--format=json'])) }); } catch { emit({ event: 'container-state-unconfirmed' }); } }
    process.exitCode = 1;
  } finally { clearInterval(timer); if (release) release(); }
}
export function workerSource(unit, label, pin, diffIds, hostChecker, spaceChecker, loadedChecker) {
  ensure(/^[a-f0-9]{12}$/.test(label) && unit === 'cpp-compiler-check-' + label + '.service', 'WORKER_SCOPE_INVALID');
  return '(async()=>{const fs=await import("node:fs");const {createHash}=await import("node:crypto");const IMAGE_LABEL=' + JSON.stringify(IMAGE_LABEL) + ';const CASES=' + JSON.stringify(CASES) + ';const ISOLATION_PROBE=' + JSON.stringify(ISOLATION_PROBE) + ';\n' +
    [ensure, safeCode, checkSource, checkTeachingImage, normalizeImageId, buildArguments, checkIsolation, checkCase, hostChecker, spaceChecker, loadedChecker].map(fn => fn.toString()).join('\n') + '\nawait (' + compilerWorker.toString() + ')(' + [unit, label, pin, diffIds, SOURCE_HASHES].map(value => JSON.stringify(value)).join(',') + ');})().catch(()=>{process.stderr.write("WORKER_BOOTSTRAP_FAILED\\n");process.exitCode=1;});';
}
export function checkCompletion(result, pin, diffIds, label) {
  ensure(typeof result?.stdout === 'string', 'WORKER_OUTPUT_INVALID');
  const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const failure = events.find(row => row.event === 'error');
  if (failure) throw Object.assign(new Error(), { code: safeCode(failure.code) });
  ensure(result.status === 0 && !result.signal, 'WORKER_NOT_COMPLETED');
  const done = events.filter(row => row.event === 'complete');
  ensure(done.length === 1 && done[0].checks === CASES.length + 5 && done[0].runEnabled === false && done[0].containers === 0, 'VERIFICATION_INCOMPLETE');
  const passes = events.filter(row => row.event === 'pass');
  ensure(passes.length === done[0].checks && passes.every((row, i) => row.number === i + 1), 'PASS_RECORD_INCOMPLETE');
  const cases = events.filter(row => row.event === 'case-result');
  ensure(cases.length === CASES.length && cases.every((row, i) => row.name === CASES[i].name), 'CASE_RECORD_INCOMPLETE');
  for (let i = 0; i < CASES.length; i++) checkCase(CASES[i], cases[i].result);
  checkTeachingImage(done[0].inspect, done[0].image?.imageId, pin, diffIds, label);
  return done[0];
}

async function loadChecks() {
  const file = ROOT + '/deploy/import-gcc-base-image-20260831.sh';
  const text = checkSource(file, 'e60a156fcfee77ee2c9ab26cbe5c43099d25b0e2eccdd7552daba5df387e8fd6').toString('utf8');
  const body = /<<'CPP_GCC_IMPORT_NODE'\n([\s\S]+)\nCPP_GCC_IMPORT_NODE\n$/.exec(text)?.[1];
  ensure(body, 'IMPORT_SCRIPT_FORMAT');
  // 复用已在服务器通过的只读检查函数；入口参数不同，不执行旧导入流程，不改动原脚本。
  const extra = '\nexport { directory, readJson, hash, read, run, manager, limits, pm2Snapshot, websites, observeUnit, loadHelpers };\nexport function bindChecks(r,a,p,folder,fd){helpers=r;accountHelpers=a;repairHelpers=p;record=folder;logFd=fd;}';
  old = await import('data:text/javascript;base64,' + Buffer.from(body + extra).toString('base64'));
  rootlessHelpers = await old.loadHelpers(ROOT + '/deploy/resume-rootless-podman-20260831-02.sh', '5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de', 'CPP_ROOTLESS_NODE');
  accountHelpers = await old.loadHelpers(ROOT + '/deploy/prepare-runner-account-20260831-02.sh', '78dd26246bff6ad0c011703ce6672e4ec042c271e1260eaf66e7bb8425c48489', 'CPP_ACCOUNT_NODE');
  repairHelpers = await old.loadHelpers(ROOT + '/deploy/repair-rootless-delegation-20260831.sh', '0556df40491052f82ef2058b7fce6dbb2e41f27acb24da1c1e67b8d726fa1845', 'CPP_DELEGATION_NODE');
  imageHelpers = await old.loadHelpers(ROOT + '/deploy/prepare-gcc-base-image-20260831.sh', 'fe0332f60b308410b871774f7de67c195cbed53d8ce47f89fb970d833492015b', 'CPP_GCC_IMAGE_NODE');
  old.bindChecks(rootlessHelpers, accountHelpers, repairHelpers, record, logFd);
}
function observeWorker(unit) {
  ensure(/^cpp-compiler-check-[a-f0-9]{12}\.service$/.test(unit), 'WORKER_SCOPE_INVALID');
  let exit = 0, output;
  try { output = execFileSync('/usr/bin/setpriv', ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemctl', '--user', 'show', ...['LoadState', 'ActiveState', 'MainPID', 'ControlPID'].map(key => '--property=' + key), '--', unit], { env: runnerEnv, encoding: 'utf8', timeout: 10000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { exit = error.status; output = String(error.stdout || ''); }
  const processes = { complete: true, pids: [] };
  for (const pid of fs.readdirSync('/proc').filter(name => /^[1-9][0-9]*$/.test(name))) {
    try { const group = fs.readFileSync('/proc/' + pid + '/cgroup', 'utf8'); if (group.includes('/user.slice/user-994.slice/user@994.service/') && group.split(/[\n/]/).includes(unit)) processes.pids.push(Number(pid)); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) processes.complete = false; }
  }
  return { unit, exit, values: output.trim() ? rootlessHelpers.parseProperties(output) : {}, processes };
}
async function runWorker(label) {
  const unit = 'cpp-compiler-check-' + label + '.service'; save('worker-unit.json', { unit, label });
  const source = workerSource(unit, label, imageHelpers.PIN, old.DIFF_IDS, imageHelpers.checkHostInfo, imageHelpers.checkSpace, old.checkLoadedImage);
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + unit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=900', '--property=TimeoutStopSec=30', '--property=WorkingDirectory=' + HOME_DIR, '/usr/bin/env', '-i', ...Object.entries(runnerEnv).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', source];
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/setpriv', args, { env: runnerEnv, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8'); let stdout = '', stderr = '', pending = '';
    child.stdout.on('data', bytes => {
      const text = decoder.write(bytes); stdout = (stdout + text).slice(-12 * 1024 ** 2); pending += text;
      for (;;) {
        const at = pending.indexOf('\n'); if (at < 0) break;
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try {
          const row = JSON.parse(line);
          if (row.event === 'stage' && typeof row.name === 'string' && row.name.length < 100) log('验证阶段：' + row.name);
          if (row.event === 'pass' && Number.isInteger(row.number)) log('通过 ' + row.number + '：' + String(row.name).slice(0, 100));
          if (row.event === 'progress' && Number.isInteger(row.seconds) && Number.isInteger(row.freeMiB)) log('验证进行中：已用 ' + row.seconds + ' 秒，磁盘可用 ' + row.freeMiB + ' MiB。');
          if (row.event === 'error') log('用户服务检查失败：' + safeCode(row.code) + '；阶段：' + String(row.phase || '').slice(0, 100));
          if (row.event === 'case-result') {
            const expected = CASES.find(item => item.name === row.name);
            if (expected && row.result?.state !== expected.state) log('测试状态不符：预期 ' + expected.state + '，实际 ' + String(row.result?.state).slice(0, 40));
          }
        } catch { /* 完整构建输出与测试结果仅保存在 root 私有记录。 */ }
      }
    });
    child.stdout.on('end', () => { stdout += decoder.end(); }); child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-2 * 1024 ** 2); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'WORKER_START_FAILED' })));
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  save('worker-output.json', result);
  const deadline = Date.now() + 5000;
  for (;;) {
    const state = observeWorker(unit);
    try { old.checkInactiveUnit(state.exit, state.values, state.processes); save('worker-final-state.json', state); break; }
    catch (error) { if (Date.now() >= deadline) { save('worker-state-unconfirmed.json', state); throw error; } await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const completed = checkCompletion(result, imageHelpers.PIN, old.DIFF_IDS, label);
  imageHelpers.checkHostInfo(completed.info, 2); return completed;
}
async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  for (const [file, uid, mode] of [[ROOT, 0, 0o755], [ROOT + '/logs', 995, 0o750]]) { const stat = fs.lstatSync(file); ensure(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === mode && fs.realpathSync(file) === file, 'APPLICATION_DIRECTORY_INVALID'); }
  const backupStat = fs.lstatSync(ROOT + '/backups'); ensure(backupStat.isDirectory() && backupStat.uid === 0 && (backupStat.mode & 0o777) === 0o700 && fs.realpathSync(ROOT + '/backups') === ROOT + '/backups', 'BACKUP_DIRECTORY_INVALID');
  ensure(!exists(LOCK), 'CHECK_ALREADY_STARTED_DO_NOT_REPEAT');
  const logPath = ROOT + '/logs/compiler-check-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600); log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/compiler-check-'); log('私有操作记录：' + record);
  step('只读预检：成功导入记录、现有执行代码、网站与资源限额'); await loadChecks();
  old.directory(ROOT, 0, 0o755); old.directory(HOME_DIR, 994, 0o700); old.directory('/run/user/994', 994, 0o700); old.directory(IMPORT_RECORD, 0, 0o700);
  checkImportRecord(old.readJson(IMPORT_RECORD + '/result.json'), imageHelpers.PIN, old.ARCHIVE);
  const previous = old.observeUnit(old.readJson(IMPORT_RECORD + '/worker-unit.json').unit); old.checkInactiveUnit(previous.exit, previous.values, previous.processes); save('previous-worker.json', previous);
  ensure(!exists(ROOT + '/.env.runner') && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_ALREADY_STARTED');
  for (const [file, digest] of Object.entries(SOURCE_HASHES)) checkSource(ROOT + '/' + file, digest);
  const beforeManager = old.manager(); repairHelpers.checkManager(beforeManager, true); const beforeLimits = old.limits();
  const protectedFiles = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf', ...Object.keys(SOURCE_HASHES).map(file => ROOT + '/' + file)];
  const hashes = Object.fromEntries(protectedFiles.map(file => [file, old.hash(file)])); const nss = accountHelpers.nssSnapshot(); const pm2 = old.pm2Snapshot(); old.websites();
  save('before.json', { manager: beforeManager, limits: beforeLimits, hashes, nss, pm2 });
  lockFd = fs.openSync(LOCK, 'wx', 0o600); fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, record }) + '\n');
  const label = randomBytes(6).toString('hex');
  step('在 cpp-runner 用户服务内构建并逐项测试，网页运行开关保持关闭');
  let completed, failure;
  try { completed = await runWorker(label); } catch (error) { failure = error; }
  step('复核原配置、用户管理器、总限额和两个网站');
  for (const [file, digest] of Object.entries(hashes)) ensure(old.hash(file) === digest, 'EXISTING_FILE_CHANGED');
  accountHelpers.assertNssUnchanged(nss); const afterManager = old.manager(); repairHelpers.checkManager(afterManager, true); old.limits();
  ensure(afterManager.MainPID === beforeManager.MainPID && JSON.stringify(old.pm2Snapshot()) === JSON.stringify(pm2), 'EXISTING_PROCESS_CHANGED');
  ensure(!exists(ROOT + '/.env.runner') && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_ALREADY_STARTED'); old.websites();
  save('website-postcheck.json', { unchanged: true, runEnabled: false, pm2, manager: afterManager });
  if (failure) throw failure;
  save('result.json', { stage: 'teaching-image-and-containers-verified', at: new Date().toISOString(), importRecord: IMPORT_RECORD, ...completed, sourceHashes: SOURCE_HASHES, pm2 });
  log('教学镜像与真实容器验证完成：' + completed.checks + ' 项通过，容器已清理。');
  log('教学镜像 ID：' + completed.image.imageId);
  log('两个网站及用户管理器未重启；1 GiB / 1 核 / 256 任务 / swap 0 总限额保持。');
  log('未启动执行服务、未开放网页编译运行；这不是课堂并发性能验收。');
  log('请发回完整输出；私有记录：' + record);
}
if (process.argv[2] === '--verify-compiler-containers') {
  try { await main(); }
  catch (error) { log('容器验证未完成；阶段：' + phase + '；错误码：' + safeCode(error.code)); if (record) log('私有操作记录：' + record); log('保留镜像、测试目录和锁记录，不自动重试或清理未知容器；请发回输出，不要重跑。'); log('本脚本没有开启网页运行开关，也没有请求重启网站或用户管理器。'); process.exitCode = 1; }
  finally { if (lockFd !== undefined) fs.closeSync(lockFd); if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_COMPILER_CHECK_NODE
