import fs from 'node:fs/promises';
import { PodmanSandbox, command, LIMITS } from './podman.mjs';

function check(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
const delay = () => new Promise(resolve => setTimeout(resolve, 50));

export function cpuUsage(text) {
  check(typeof text === 'string' && text.length < 16384, 'CPU_STAT_INVALID');
  const rows = text.trim().split('\n').filter(line => /^usage_usec\s/.test(line));
  check(rows.length === 1 && /^usage_usec\s+[0-9]+$/.test(rows[0]), 'CPU_STAT_INVALID');
  const value = Number(rows[0].trim().split(/\s+/)[1]);
  check(Number.isSafeInteger(value) && value >= 0, 'CPU_STAT_INVALID');
  return value;
}

export function containerState(rows, name) {
  check(Array.isArray(rows) && rows.length === 1, 'CPU_CONTAINER_INVALID');
  const value = rows[0], state = value?.State;
  check(value?.Name?.replace(/^\//, '') === name && /^[a-f0-9]{64}$/.test(value.Id || '') && typeof state?.Running === 'boolean', 'CPU_CONTAINER_INVALID');
  if (state.Running) check(Number.isSafeInteger(state.Pid) && state.Pid > 0, 'CPU_PID_INVALID');
  return { id: value.Id, pid: state.Pid, running: state.Running, status: state.Status, oom: state.OOMKilled, exit: state.ExitCode };
}

export function cpuStatPath(text, uid, containerId) {
  check(Number.isSafeInteger(uid) && uid > 0 && /^[a-f0-9]{64}$/.test(containerId), 'CPU_SCOPE_INVALID');
  check(typeof text === 'string' && text.length < 16384, 'CPU_SCOPE_INVALID');
  const rows = text.trim().split('\n').filter(line => line.startsWith('0::'));
  check(rows.length === 1, 'CPU_SCOPE_INVALID');
  const group = rows[0].slice(3), prefix = `/user.slice/user-${uid}.slice/user@${uid}.service/`;
  check(group.startsWith(prefix) && !group.includes('//'), 'CPU_SCOPE_INVALID');
  const parts = group.split('/').slice(1);
  check(parts.every(part => /^[a-zA-Z0-9_.@-]+$/.test(part) && part !== '.' && part !== '..'), 'CPU_SCOPE_INVALID');
  const scope = 'libpod-' + containerId + '.scope', index = parts.indexOf(scope);
  check(index >= 3 && parts.lastIndexOf(scope) === index, 'CPU_SCOPE_INVALID');
  // 读取容器所属 scope 的总 CPU 用时，包含容器子进程；不读取整个账号或其他容器的计数。
  return '/sys/fs/cgroup/' + parts.slice(0, index + 1).join('/') + '/cpu.stat';
}

export async function cpuLimitedCommand(config, executable, args, options, execute = command, { readFile = fs.readFile, pause = delay, onCpuLimit } = {}) {
  if (args[0] !== 'start') return execute(executable, args, options);
  const name = args[3], match = /^cpp-job-[a-f0-9-]{36}-(compile|run)$/.exec(name || '');
  check(executable === config.podman && args.length === 4 && args[1] === '--attach' && args[2] === '--interactive' && match, 'CPU_START_SCOPE_INVALID');
  const phase = match[1], limitUsec = LIMITS[phase].cpu * 1000000;
  let ended = false, exceeded = false, failure, file, identity, usageUsec = 0;
  const inspect = async () => {
    const result = await execute(executable, ['inspect', name], { timeout: 1000, outputLimit: 128 * 1024 });
    check(!result.reason && result.code === 0, 'CPU_INSPECT_FAILED');
    return containerState(JSON.parse(result.stdout), name);
  };
  const kill = async () => {
    const result = await execute(executable, ['kill', '--signal', 'KILL', name], { timeout: 1000, outputLimit: 16384 });
    if (result.reason || result.code !== 0) check(!(await inspect()).running, 'CPU_STOP_UNCONFIRMED');
  };
  // 学生进程仍使用原来的启动参数。监测只读取宿主机内核计数，不依赖程序输出或退出码。
  const attached = Promise.resolve().then(() => execute(executable, args, options)).then(value => { ended = true; return value; }, error => { ended = true; throw error; });
  const watching = (async () => {
    while (!ended && !options?.signal?.aborted) {
      try {
        if (!file) {
          const state = await inspect();
          if (ended || options?.signal?.aborted) return;
          if (!state.running) {
            if (['exited', 'stopped'].includes(state.status)) return;
            check(['created', 'configured', 'initialized'].includes(state.status), 'CPU_START_STATE_INVALID');
            await pause(); continue;
          }
          identity = state.id;
          const group = await readFile('/proc/' + state.pid + '/cgroup', 'utf8');
          if (ended || options?.signal?.aborted) return;
          file = cpuStatPath(group, config.uid, identity);
        }
        const next = cpuUsage(await readFile(file, 'utf8'));
        if (ended || options?.signal?.aborted) return;
        check(next >= usageUsec, 'CPU_COUNTER_REVERSED'); usageUsec = next;
        if (usageUsec >= limitUsec) {
          exceeded = true;
          onCpuLimit?.({ name, phase, usageUsec, limitUsec, containerId: identity });
          await kill(); return;
        }
      } catch (error) {
        if (ended || options?.signal?.aborted) return;
        // 进程退出时 /proc 和 cgroup 可能先消失；只在容器确已停止时接受此竞争。
        if (['ENOENT', 'ESRCH', 'CPU_SCOPE_INVALID', 'CPU_STAT_INVALID'].includes(error.code) && !(await inspect()).running) return;
        throw error;
      }
      await pause();
    }
  })().catch(async error => {
    failure = error;
    if (!ended && !options?.signal?.aborted) { try { await kill(); } catch (stopError) { failure = stopError; } }
  });
  let result;
  try { result = await attached; } finally { ended = true; await watching; }
  // 取消、输出上限和已有墙钟超时优先；监测失败不能冒充 CPU 超时。
  if (result.reason || options?.signal?.aborted) return result;
  if (failure) throw failure;
  if (exceeded) {
    const state = await inspect();
    check(!state.running && state.id === identity && typeof state.oom === 'boolean' && Number.isInteger(state.exit), 'CPU_FINAL_STATE_INVALID');
    if (!state.oom) return { ...result, reason: 'time', code: state.exit, cpuLimit: { usageUsec, limitUsec } };
  }
  return result;
}

export class CpuMeteredSandbox extends PodmanSandbox {
  constructor(config, runCommand = command, monitoring = {}) {
    super(config, (executable, args, options) => cpuLimitedCommand(config, executable, args, options, runCommand, monitoring));
  }
}
