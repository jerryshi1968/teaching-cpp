#!/usr/bin/env bash
# 只诊断 cpp-runner 的资源控制器委派；除新建诊断日志外，不修改服务器状态。
# 不执行 Podman、不读取网站密码或完整服务环境、不启动或重启任何服务。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用原来的 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --diagnose-rootless-controllers <<'CPP_CONTROLLERS_NODE'
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = '/var/www/teaching-cpp-backend';
const RUNNER_HOME = '/var/www/teaching-cpp-runner';
const CGROUP_ROOT = '/sys/fs/cgroup';
const SLICE_CGROUP = '/user.slice/user-994.slice';
const MANAGER_CGROUP = SLICE_CGROUP + '/user@994.service';
const UNITS = ['-.slice', 'user.slice', 'user-994.slice', 'user@994.service'];
const CGROUPS = ['/', '/user.slice', SLICE_CGROUP, MANAGER_CGROUP];
const REQUIRED = ['cpu', 'memory', 'pids'];
const FIELDS = ['Id', 'LoadState', 'ActiveState', 'SubState', 'ControlGroup', 'MainPID', 'User', 'Delegate', 'DelegateControllers', 'DisableControllers', 'CPUAccounting', 'MemoryAccounting', 'TasksAccounting', 'CPUQuotaPerSecUSec', 'CPUQuotaPeriodUSec', 'MemoryMax', 'MemorySwapMax', 'TasksMax', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload'];
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SYSTEMD_PAGER: 'cat', SYSTEMD_COLORS: '0' };
let logFd;
let logPath;
let failures = 0;

function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function errorCode(error) { return /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'CHECK_FAILED'; }
function out(value) {
  const line = (typeof value === 'string' ? value : JSON.stringify(value)) + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function capture(action) {
  try { return { ok: true, value: action() }; }
  catch (error) { failures++; return { ok: false, error: errorCode(error) }; }
}
function section(title, action) {
  out('\n【' + title + '】');
  const result = capture(action);
  if (!result.ok) out(result);
}
function readSmall(file, max = 262144) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(file) === file && stat.size <= max, 'UNSAFE_OR_LARGE_FILE');
  const text = fs.readFileSync(file, 'utf8');
  ensure(Buffer.byteLength(text) <= max, 'FILE_OUTPUT_TOO_LARGE');
  return text;
}
function metadata(file) {
  const stat = fs.lstatSync(file);
  return { type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o7777).toString(8) };
}
function presence(file) {
  try { return { exists: true, ...metadata(file) }; }
  catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
}
function command(program, args) {
  try { return execFileSync(program, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) {
    // 公开诊断不回显子命令 stdout/stderr，避免意外带出环境或其他私有内容。
    throw Object.assign(new Error(), { code: typeof error.status === 'number' ? 'COMMAND_EXIT_' + error.status : 'COMMAND_FAILED' });
  }
}
export function selectProperties(text, fields) {
  const values = {};
  const duplicate = new Set();
  let malformedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const at = line.indexOf('=');
    if (at <= 0) { malformedLines++; continue; }
    const key = line.slice(0, at);
    if (!fields.includes(key)) continue;
    if (Object.hasOwn(values, key) || duplicate.has(key)) { delete values[key]; duplicate.add(key); continue; }
    values[key] = line.slice(at + 1);
  }
  return { values, missing: fields.filter(key => !Object.hasOwn(values, key) && !duplicate.has(key)), duplicate: [...duplicate], malformedLines };
}
export function resourceConfigLines(text) {
  // 仅保留资源配置行及来源路径；不显示 Environment、ExecStart、凭据配置或其他注释。
  const keys = new Set(['Delegate', 'DisableControllers', 'CPUAccounting', 'CPUQuota', 'CPUQuotaPeriodSec', 'MemoryAccounting', 'MemoryMax', 'MemorySwapMax', 'TasksAccounting', 'TasksMax', 'Slice']);
  const lines = [];
  let section = '';
  let continuation = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^# \/(?:usr\/lib|usr\/local\/lib|etc|run)\/systemd\/system\/[A-Za-z0-9@_.\/:\-]+$/.test(line)) { lines.push(line); section = ''; continuation = false; continue; }
    if (!line.trim() || /^\s*[#;]/.test(line)) continue;
    const continued = line.endsWith('\\');
    // 续行可能属于 Environment 或 ExecStart，不能把其中形似资源设置的内容当成独立指令。
    if (continuation) { continuation = continued; continue; }
    continuation = continued;
    const heading = /^\s*\[([A-Za-z]+)\]\s*$/.exec(line);
    if (heading) { section = heading[1]; continue; }
    if (!['Service', 'Slice'].includes(section)) continue;
    const entry = /^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (entry && keys.has(entry[1])) lines.push('[' + section + '] ' + entry[1] + '=' + (continued ? '<continued; see effective properties>' : entry[2]));
  }
  return lines;
}
export function parseControllers(text) {
  ensure(typeof text === 'string', 'CONTROLLER_FORMAT');
  const values = text.trim() ? text.trim().split(/\s+/) : [];
  ensure(values.every(value => /^[a-z][a-z0-9_]*$/.test(value)) && new Set(values).size === values.length, 'CONTROLLER_FORMAT');
  return values;
}
export function controllerSummary(rows) {
  ensure(Array.isArray(rows) && rows.length === CGROUPS.length && rows.every((row, index) => row.path === CGROUPS[index]), 'CGROUP_CHAIN_UNEXPECTED');
  return REQUIRED.map(controller => {
    const unknown = [];
    const notAvailableAt = [];
    const notEnabledForChildrenAt = [];
    for (const row of rows) {
      if (!Array.isArray(row.available)) unknown.push(row.path + ':cgroup.controllers');
      else if (!row.available.includes(controller)) notAvailableAt.push(row.path);
      if (!Array.isArray(row.enabled)) unknown.push(row.path + ':cgroup.subtree_control');
      else if (!row.enabled.includes(controller)) notEnabledForChildrenAt.push(row.path);
    }
    const last = rows.at(-1);
    return { controller, availableToManager: Array.isArray(last.available) ? last.available.includes(controller) : null, notAvailableAt, notEnabledForChildrenAt, unknown };
  });
}
function diagnose() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  ensure(fs.realpathSync(ROOT) === ROOT && fs.lstatSync(ROOT).isDirectory(), 'APP_ROOT_UNEXPECTED');
  ensure(fs.realpathSync(ROOT + '/logs') === ROOT + '/logs' && fs.lstatSync(ROOT + '/logs').isDirectory(), 'LOG_DIRECTORY_UNEXPECTED');
  logPath = ROOT + '/logs/rootless-controllers-diagnostic-' + randomBytes(6).toString('hex') + '.log';
  logFd = fs.openSync(logPath, 'wx', 0o600);
  out('诊断日志：' + logPath);
  out('仅采集资源委派和当前网站状态；不会继续初始化、修改配置或重启服务。');

  section('1. 接续脚本与中断记录', () => {
    const file = ROOT + '/deploy/resume-rootless-podman-20260831-02.sh';
    out(capture(() => {
      const text = readSmall(file);
      const sha256 = createHash('sha256').update(text).digest('hex');
      return { script: file, sha256, matchesDeliveredScript: sha256 === '5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de', hasCRLF: text.includes('\r\n'), hasBOM: text.startsWith('\uFEFF') };
    }));
    const record = ROOT + '/backups/rootless-resume-hrUKkg';
    out({ record, phase: capture(() => readSmall(record + '/phase.txt', 2048).trim()) });
    for (const name of ['preserved-configs.json', 'user-manager.json', 'probe-unit.json', 'podman-probe.json', 'result.json']) out({ recordFile: name, ...capture(() => presence(record + '/' + name)) });
  });
  const units = new Map();
  section('2. systemd 当前生效属性', () => {
    for (const unit of UNITS) {
      // 每个属性独立传参；根 slice 名以连字符开头，放在 -- 之后。
      const result = capture(() => selectProperties(command('/usr/bin/systemctl', ['show', '--no-pager', ...FIELDS.map(field => '--property=' + field), '--', unit]), FIELDS));
      units.set(unit, result);
      out({ unit, ...result });
    }
    out({ user: 'cpp-runner', ...capture(() => selectProperties(command('/usr/bin/loginctl', ['show-user', 'cpp-runner', '--property=Linger', '--property=RuntimePath', '--property=State']), ['Linger', 'RuntimePath', 'State'])) });
    out('missing 表示该属性未返回，不等于 false；Delegate=yes 本身不能证明 CPU、内存和进程数三项均已委派。');
  });
  section('3. 单元文件中的资源设置及来源', () => {
    for (const unit of UNITS) out({ unit, ...capture(() => resourceConfigLines(command('/usr/bin/systemctl', ['cat', '--no-pager', '--', unit]))) });
    out('这里只摘取资源设置行；第 2 项是当前加载值，两者用于检查是否有未加载的配置。');
  });
  const rows = [];
  section('4. 内核资源控制器逐层状态与账号总限额', () => {
    for (const group of CGROUPS) {
      const base = CGROUP_ROOT + (group === '/' ? '' : group);
      const available = capture(() => parseControllers(readSmall(base + '/cgroup.controllers', 4096)));
      const enabled = capture(() => parseControllers(readSmall(base + '/cgroup.subtree_control', 4096)));
      rows.push({ path: group, available: available.ok ? available.value : null, enabled: enabled.ok ? enabled.value : null });
      out({ cgroup: group, directory: capture(() => metadata(base)), available, enabledForChildren: enabled, type: capture(() => readSmall(base + '/cgroup.type', 4096).trim()) });
      if ([SLICE_CGROUP, MANAGER_CGROUP].includes(group)) {
        const values = {};
        for (const name of ['cpu.max', 'memory.max', 'memory.swap.max', 'pids.max', 'cgroup.events']) values[name] = capture(() => readSmall(base + '/' + name, 4096).trim());
        out({ cgroup: group, limits: values, subtreeFile: capture(() => metadata(base + '/cgroup.subtree_control')) });
      }
    }
    for (const row of controllerSummary(rows)) out(row);
    out('availableToManager 对应本次失败的检查；notEnabledForChildrenAt 只报告逐层现状，不能单独认定为配置错误。');
  });
  section('5. 用户管理器进程及尚未初始化的目录', () => {
    const result = units.get('user@994.service');
    const pid = result?.ok ? result.value.values.MainPID : null;
    if (/^[1-9][0-9]{0,9}$/.test(pid || '')) out({ userManagerPid: Number(pid), cgroup: capture(() => readSmall('/proc/' + pid + '/cgroup', 4096).trim()) });
    else out('用户管理器 PID 未取得，不猜测进程号。');
    for (const file of ['/run/user/994', '/run/user/994/bus', '/var/lib/systemd/linger/cpp-runner', RUNNER_HOME + '/.local/share/containers', '/run/user/994/containers', '/run/user/994/libpod', ROOT + '/.env.runner']) out({ path: file, ...capture(() => presence(file)) });
    out({ port5280Listening: capture(() => command('/usr/bin/ss', ['-H', '-lnt', '( sport = :5280 )']).trim().length > 0) });
  });
  section('6. 当前网站 HTTPS 状态', () => {
    for (const endpoint of ['health', 'cpp/config']) {
      out({ site: endpoint === 'health' ? 'p5js' : 'cpp', ...capture(() => {
        const text = command('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '10', 'https://tigao123.com/api/' + endpoint]);
        const value = JSON.parse(text);
        return endpoint === 'health' ? { healthy: value.status === 'OK' && value.db_check === 'Database Active' } : { production: value.mode === 'production', writesEnabled: value.writesEnabled === true, executionDisabled: value.runEnabled === false };
      }) });
    }
  });
  out('\n诊断采集结束，未取得的读取项数：' + failures + '（例如不存在的内核属性）；不表示初始化或隔离验收通过。');
  out('未修改配置、账号、映射或限额；未运行 Podman、创建容器、安装软件、重启服务或启用 C++ 编译运行。');
  out('请发回完整终端输出；不要重跑账号准备、初始化或 02 接续脚本。日志：' + logPath);
}
if (process.argv[2] === '--diagnose-rootless-controllers') {
  try { diagnose(); }
  catch (error) { out('诊断未完成，错误码：' + errorCode(error)); process.exitCode = 1; }
  finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_CONTROLLERS_NODE
