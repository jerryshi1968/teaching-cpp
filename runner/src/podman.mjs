import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROFILES, MAX_OUTPUT_BYTES } from '../../shared/contracts.mjs';
import { id, snapshot } from '../../backend/src/validation.mjs';

const LABEL = 'io.teaching-cpp.managed=true';
export const LIMITS = Object.freeze({ compile: { memory: 512 * 1024 ** 2, pids: 64, cpu: 15, wall: 20000 }, run: { memory: 256 * 1024 ** 2, pids: 16, cpu: 3, wall: 5000 } });
export class CleanupUnconfirmed extends Error {}

// 所有参数均通过参数数组传递。学生代码和输入永远不会拼接进宿主机命令或 shell。
export function command(executable, args, { input = '', timeout = 20000, outputLimit = MAX_OUTPUT_BYTES, signal, onLimit } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    const out = [], err = [];
    let bytes = 0, reason = null, settled = false;
    const stop = why => { if (reason) return; reason = why; Promise.resolve(onLimit?.()).catch(() => {}); child.kill('SIGKILL'); };
    const consume = target => chunk => {
      const available = Math.max(0, outputLimit - bytes);
      if (available) target.push(chunk.subarray(0, available));
      bytes += chunk.length;
      if (bytes > outputLimit) stop('output');
    };
    child.stdout.on('data', consume(out)); child.stderr.on('data', consume(err));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const abort = () => stop('cancel');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop('time'), timeout);
    const clear = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { if (!settled) { settled = true; clear(); reject(error); } });
    child.on('close', (code, exitSignal) => {
      if (settled) return; settled = true; clear();
      const output = Buffer.concat(out).toString('utf8'), errors = Buffer.concat(err).toString('utf8');
      if (Buffer.byteLength(output + errors) > outputLimit) reason ||= 'output';
      const stdout = new StringDecoder('utf8').write(Buffer.from(output).subarray(0, outputLimit));
      const stderr = new StringDecoder('utf8').write(Buffer.from(errors).subarray(0, Math.max(0, outputLimit - Buffer.byteLength(stdout))));
      resolve({ code, signal: exitSignal, reason, stdout, stderr });
    });
  });
}

export function containerOptions(config, name, phase, directory) {
  const limits = LIMITS[phase];
  if (!limits || !/^cpp-(?:job|probe)-[a-f0-9-]+-(?:compile|run)$/.test(name)) throw new Error('无效的容器参数');
  const options = [
    '--name', name, '--label', LABEL, '--pull=never', '--network=none', '--http-proxy=false', '--ipc=private', '--pid=private', '--cgroupns=private',
    '--timeout', String(Math.ceil(limits.wall / 1000) + 5), '--health-cmd=none',
    '--userns=keep-id', '--user', `${config.uid}:${config.gid}`, '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--read-only', '--read-only-tmpfs=false', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--memory', String(limits.memory), '--memory-swap', String(limits.memory), '--cpus=1', '--pids-limit', String(limits.pids),
    '--ulimit', `cpu=${limits.cpu}:${limits.cpu + 1}`, '--ulimit', 'fsize=16777216:16777216', '--ulimit', 'nofile=64:64', '--ulimit', 'core=0:0',
    '--log-driver=none', '--no-hosts', '--env=LANG=C.UTF-8', '--env=LC_ALL=C.UTF-8', '--env=HOME=/tmp', '--workdir=/work'
  ];
  if (directory) options.push('--volume', `${directory}:/work:${phase === 'compile' ? 'rw' : 'ro'},nosuid,nodev,Z`);
  return options;
}

export function verifyCgroups(text, phase = 'run') {
  const [memory, pids, cpu, swap] = text.trim().split('\n').map(line => line.trim());
  const expected = LIMITS[phase];
  const [quota, period] = (cpu || '').split(/\s+/).map(Number);
  if (Number(memory) !== expected.memory || Number(pids) !== expected.pids || !(quota > 0 && period > 0 && quota / period <= 1) || swap !== '0') throw new Error('容器资源限制未实际生效，拒绝启动执行服务');
}
export function compilerArguments(job) { return ['/usr/local/bin/g++', ...PROFILES[job.profileId].flags, ...job.build.sources, '-o', '.cpp-program']; }

export class PodmanSandbox {
  constructor(config, runCommand = command) { this.config = config; this.command = runCommand; }
  imageReference() { if (!/^sha256:[a-f0-9]{64}$/.test(this.config.image || '')) throw new Error('固定镜像 ID 无效'); return this.config.image.slice(7); }
  names(jobId) { id(jobId); return ['compile', 'run'].map(phase => `cpp-job-${jobId}-${phase}`); }
  work(jobId) { return path.join(this.config.dataRoot, 'work', id(jobId)); }
  async control(args) {
    const result = await this.command(this.config.podman, args);
    if (result.reason || result.code !== 0) throw new Error(`Podman ${args[0]} 失败：${result.stderr.slice(0, 400)}`);
    return result.stdout;
  }
  async removeContainer(name) {
    try {
      await this.control(['rm', '--force', '--ignore', name]);
      const check = await this.command(this.config.podman, ['container', 'exists', name]);
      if (check.reason || check.code !== 1) throw new Error('容器仍存在，或无法确认');
    } catch (error) { throw new CleanupUnconfirmed(`无法确认容器已停止：${error.message}`); }
  }
  async cleanup(jobId) { for (const name of this.names(jobId)) await this.removeContainer(name); }
  async removeWork(jobId) {
    const parent = path.resolve(this.config.dataRoot, 'work');
    const target = path.resolve(this.work(jobId));
    if (path.dirname(target) !== parent) throw new Error('拒绝清理工作目录之外的路径');
    await fs.rm(target, { recursive: true, force: true });
  }
  async recoverContainers() {
    const names = (await this.control(['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Names}}'])).trim().split('\n').filter(Boolean);
    for (const name of names) {
      if (!/^cpp-(?:job|probe)-[a-f0-9-]+-(?:compile|run)$/.test(name)) throw new Error('发现不符合命名约定的受管容器，请人工检查');
      await this.removeContainer(name);
    }
  }
  async preflight() {
    const info = JSON.parse(await this.control(['info', '--format=json']));
    if (!info.host?.security?.rootless || info.host?.cgroupVersion !== 'v2' || !info.host?.security?.seccompEnabled || info.host?.cgroupManager !== 'systemd') throw new Error('需要 rootless Podman、cgroup v2、systemd 管理和 seccomp，禁止降低隔离要求');
    await this.control(['image', 'exists', this.imageReference()]);
    await this.recoverContainers();
    for (const phase of ['compile', 'run']) {
      const name = `cpp-probe-${randomUUID()}-${phase}`;
      try {
        const output = await this.control(['run', ...containerOptions(this.config, name, phase), this.imageReference(), '/bin/sh', '-c', 'cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/memory.swap.max']);
        verifyCgroups(output, phase);
      } finally { await this.removeContainer(name); }
    }
    return { rootless: true, cgroup: 'v2', limitsVerified: true, image: this.config.image };
  }
  async stage(job, phase, signal) {
    const name = this.names(job.id)[phase === 'compile' ? 0 : 1];
    const args = phase === 'compile' ? compilerArguments(job) : ['/work/.cpp-program'];
    if (signal.aborted) return { reason: 'cancel', stdout: '', stderr: '', code: null, elapsed: 0 };
    try {
      await this.control(['create', '--interactive', ...containerOptions(this.config, name, phase, this.work(job.id)), this.imageReference(), ...args]);
      if (signal.aborted) return { reason: 'cancel', stdout: '', stderr: '', code: null, elapsed: 0 };
      const start = Date.now();
      const result = await this.command(this.config.podman, ['start', '--attach', '--interactive', name], {
        input: phase === 'run' ? job.stdin : '', timeout: LIMITS[phase].wall, signal,
        onLimit: () => this.removeContainer(name)
      });
      result.elapsed = Date.now() - start;
      if (!result.reason) {
        const inspection = JSON.parse(await this.control(['inspect', name]));
        if (inspection[0]?.State?.Running) throw new Error('容器仍在运行');
        result.oom = inspection[0]?.State?.OOMKilled === true;
        result.code = inspection[0]?.State?.ExitCode ?? result.code;
      }
      return result;
    } finally { await this.removeContainer(name); }
  }
  async execute(job, signal, onPhase) {
    job = { ...job, ...snapshot(job) }; id(job.id);
    if (job.image !== this.config.image) throw new Error('请求镜像与执行服务固定镜像不一致');
    await fs.mkdir(this.work(job.id), { recursive: false, mode: 0o700 });
    const disk = await fs.statfs(this.config.dataRoot);
    if (disk.bavail * disk.bsize < this.config.minFreeBytes) throw new Error('执行磁盘可用空间不足');
    const root = await fs.realpath(this.work(job.id));
    for (const file of job.files) {
      const parts = file.path.split('/');
      let parent = root;
      for (const part of parts.slice(0, -1)) {
        parent = path.join(parent, part);
        await fs.mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const stat = await fs.lstat(parent);
        if (!stat.isDirectory() || stat.isSymbolicLink() || !((await fs.realpath(parent)) + path.sep).startsWith(root + path.sep)) throw new Error('项目目录包含符号链接或越界路径');
      }
      const target = path.join(parent, parts.at(-1));
      await fs.writeFile(target, file.content, { flag: 'wx', mode: 0o600 });
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !((await fs.realpath(target))).startsWith(root + path.sep)) throw new Error('项目文件不是安全的普通文件');
    }
    const compiled = await this.stage(job, 'compile', signal);
    const common = { compiler_output: compiled.stdout + compiled.stderr, stdout: '', stderr: '', memory_bytes: null, elapsed_ms: null };
    const special = result => result.reason === 'cancel' ? 'cancelled' : result.reason === 'output' ? 'output_limit' : result.reason === 'time' || result.code === 152 ? 'time_limit' : result.oom ? 'memory_limit' : null;
    const compileState = special(compiled);
    if (compileState || compiled.code !== 0) return { ...common, state: compileState || (compiled.code === 125 ? 'system_error' : 'compile_error'), message: '编译阶段未完成，未执行程序' };
    const binary = await fs.lstat(path.join(this.work(job.id), '.cpp-program'));
    if (!binary.isFile() || binary.isSymbolicLink() || binary.size > 16 * 1024 ** 2) throw new Error('编译产物无效');
    await onPhase('running');
    const result = await this.stage(job, 'run', signal);
    return { ...common, stdout: result.stdout, stderr: result.stderr, elapsed_ms: result.elapsed, state: special(result) || (result.code === 0 ? 'completed' : result.code === 125 ? 'system_error' : 'runtime_error'), message: result.code && !special(result) ? `程序退出码：${result.code}` : '' };
  }
}
