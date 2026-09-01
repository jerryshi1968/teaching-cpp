#!/usr/bin/env bash
# 仅排查准备脚本的失败位置；除诊断日志外，不创建或修改账号、目录、配置和服务。
# 不执行原准备脚本，不读取数据库密码、shadow/gshadow 内容或完整 PM2 环境变量。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux || { printf '只能在 Linux 服务器执行。\n' >&2; exit 1; }
test "$(id -u)" -eq 0 || { printf '请使用 root 会话。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --diagnose-runner-account <<'CPP_DIAGNOSTIC_NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = '/var/www/teaching-cpp-backend';
const ACCOUNT = 'cpp-runner';
const HOME_DIR = '/var/www/teaching-cpp-runner';
const EXPECTED = '2ea9c145864c679530b2922ca1cd257375b1268e2f9962a9a41541dd2468eabc';
const cliEnv = { HOME: '/root', USER: 'root', LOGNAME: 'root', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
let logFd;
let logPath;

function out(value) {
  const line = value + '\n';
  process.stdout.write(line);
  if (logFd !== undefined) fs.writeSync(logFd, line);
}
function readSmall(file, max = 262144) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > max) throw Object.assign(new Error(), { code: 'UNSAFE_OR_LARGE_FILE' });
  return fs.readFileSync(file, 'utf8');
}
function section(title, action) {
  out('\n【' + title + '】');
  try { action(); } catch (error) { out('本项未完成，错误码：' + (error.code || 'CHECK_FAILED')); }
}
function command(program, args) {
  try {
    return { status: 0, stdout: execFileSync(program, args, { cwd: ROOT, env: cliEnv, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { status: error.status ?? error.code ?? 'FAILED', stdout: '' };
  }
}
function metadata(file, kind) {
  try {
    const stat = fs.lstatSync(file);
    const type = stat.isSymbolicLink() ? '符号链接' : stat.isDirectory() ? '目录' : stat.isFile() ? '普通文件' : '其他';
    let resolved;
    try { resolved = fs.realpathSync(file); } catch { resolved = '无法解析'; }
    out(JSON.stringify({ path: file, type, uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o7777).toString(8), links: stat.nlink, resolved }));
    if (kind === 'file' && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) out('提示：该路径不满足原脚本 regular() 的条件，会触发 NOT_REGULAR_FILE。');
    if (kind === 'directory' && (!stat.isDirectory() || resolved !== file)) out('提示：该路径不满足原脚本 directory() 的条件，会触发 DIRECTORY_UNEXPECTED。');
  } catch (error) { out(file + '：' + (error.code || 'STAT_FAILED')); }
}

export function summarizeAccount(text) {
  const fields = text.trim().split(':');
  if (fields.length !== 7 || fields[0] !== ACCOUNT || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3])) return { valid: false };
  return { valid: true, account: ACCOUNT, uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5], shell: fields[6] };
}
export function mappingSummary(text) {
  let count = 0;
  let malformed = 0;
  let conflict = 0;
  const known = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const fields = line.split(':');
    if (fields.length !== 3 || !fields[0] || !/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[2])) { malformed++; continue; }
    const start = Number(fields[1]);
    const size = Number(fields[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start <= 0 || size <= 0 || start + size - 1 >= 4294967295) { malformed++; continue; }
    count++;
    if (start <= 265535 && start + size - 1 >= 200000 && fields[0] !== ACCOUNT) conflict++;
    if (['apphttp', ACCOUNT].includes(fields[0])) known.push({ account: fields[0], start, size });
  }
  return { count, malformed, conflictingOtherRanges: conflict, known };
}
export function publicLogLines(text) {
  // 只摘取原脚本的阶段、错误码和结束标记，不显示备份文件内容或子命令原始诊断。
  return text.split('\n').flatMap(line => {
    const failure = /准备未完成；阶段：([^；\n]{1,160})；错误码：([A-Z0-9_]+)/.exec(line);
    if (failure) return ['准备未完成；阶段：' + failure[1] + '；错误码：' + failure[2]];
    const status = /系统命令退出码：(-?\d+|null)/.exec(line);
    if (status) return ['系统命令退出码：' + status[1]];
    if (line.includes('账号准备完成：cpp-runner')) return ['日志记录：账号准备完成'];
    return [];
  }).slice(-12);
}
function newest(dir, pattern, directories) {
  return fs.readdirSync(dir).filter(name => pattern.test(name)).map(name => {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file);
    return { file, stat };
  }).filter(item => !item.stat.isSymbolicLink() && (directories ? item.stat.isDirectory() : item.stat.isFile()))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, 3);
}
function diagnose() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw Object.assign(new Error(), { code: 'LINUX_ROOT_REQUIRED' });
  if (fs.realpathSync(ROOT) !== ROOT) throw Object.assign(new Error(), { code: 'APP_ROOT_UNEXPECTED' });
  try {
    const logs = ROOT + '/logs';
    if (fs.realpathSync(logs) !== logs || !fs.lstatSync(logs).isDirectory()) throw new Error();
    logPath = logs + '/runner-account-diagnostic-' + randomBytes(6).toString('hex') + '.log';
    logFd = fs.openSync(logPath, 'wx', 0o600);
    out('诊断日志：' + logPath);
  } catch { out('无法建立诊断日志；以下只输出到终端，请保留输出。'); }
  out('本脚本不运行准备流程；只检查当前状态并保存诊断日志。');

  section('1. 上传的准备脚本', () => {
    const text = readSmall(ROOT + '/deploy/prepare-runner-account-20260831.sh');
    const digest = createHash('sha256').update(text).digest('hex');
    out(JSON.stringify({ sha256: digest, matchesDeliveredScript: digest === EXPECTED, hasCRLF: text.includes('\r\n'), hasBOM: text.startsWith('\uFEFF') }));
  });
  section('2. 是否已留下执行日志或备份阶段', () => {
    const logs = newest(ROOT + '/logs', /^runner-account-[a-f0-9]{12}\.log$/, false);
    if (!logs.length) out('没有找到准备脚本的操作日志：早期预检失败可能尚未创建日志。');
    for (const entry of logs) {
      out('已有日志：' + entry.file);
      const lines = publicLogLines(readSmall(entry.file));
      if (lines.length) lines.forEach(out); else out('未找到可摘取的错误码或完成标记。');
    }
    const records = newest(ROOT + '/backups', /^runner-account-[A-Za-z0-9]{6}$/, true);
    if (!records.length) out('没有找到账号准备备份目录。');
    for (const entry of records) {
      out('已有备份：' + entry.file);
      for (const name of ['phase.txt', 'identity.json', 'slice-properties.json', 'result.json']) metadata(path.join(entry.file, name));
      try { out('记录的阶段：' + JSON.stringify(readSmall(path.join(entry.file, 'phase.txt'), 2048).trim())); }
      catch (error) { out('阶段记录不可用：' + (error.code || 'READ_FAILED')); }
      // 不打开 passwd/shadow/gshadow 的备份，也不输出 command-error 中的 stderr。
      for (const name of fs.readdirSync(entry.file).filter(name => /^command-error-[a-f0-9]+\.json$/.test(name)).slice(0, 3)) {
        const value = JSON.parse(readSmall(path.join(entry.file, name)));
        out(JSON.stringify({ diagnosticFile: name, command: typeof value.command === 'string' ? path.basename(value.command) : 'unknown', status: typeof value.status === 'number' ? value.status : null, stderrNotDisplayed: true }));
      }
    }
  });
  section('3. 账号、目录与执行开关文件是否存在', () => {
    const account = command('getent', ['passwd', ACCOUNT]);
    out('账号查询：' + (account.status === 0 ? JSON.stringify(summarizeAccount(account.stdout)) : '退出码 ' + account.status + '（2 通常表示不存在）'));
    const group = command('getent', ['group', ACCOUNT]);
    const groupFields = group.stdout.trim().split(':');
    out('同名组查询：' + (group.status === 0 ? JSON.stringify({ name: groupFields[0], gid: groupFields[2] }) : '退出码 ' + group.status));
    for (const file of [HOME_DIR, HOME_DIR + '/runner-data', ROOT + '/.env.runner', '/var/lib/systemd/linger/' + ACCOUNT]) metadata(file);
    const value = account.status === 0 ? summarizeAccount(account.stdout) : null;
    if (value?.valid && value.uid > 0 && value.uid < 65534) metadata('/etc/systemd/system/user-' + value.uid + '.slice.d/90-teaching-cpp-limits.conf');
  });
  section('4. 原预检所涉及的路径类型及权限', () => {
    for (const file of [ROOT, '/var/www', ROOT + '/backups', ROOT + '/logs', '/etc/systemd/system']) metadata(file, 'directory');
    for (const file of ['/usr/bin/newuidmap', '/usr/bin/newgidmap', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', ROOT + '/.env', '/etc/selinux/config', '/etc/nsswitch.conf', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2']) metadata(file, 'file');
    out('以上仅查看文件类型、权限和链接目标，没有显示密码文件或 .env 内容。');
  });
  section('5. 版本、环境及映射条件', () => {
    for (const [program, args] of [['uname', ['-m']], ['getenforce', []], ['stat', ['-fc', '%T', '/sys/fs/cgroup']], ['podman', ['--version']], [ROOT + '/tools/node/bin/node', ['--version']], ['setpriv', ['--version']]]) {
      const value = command(program, args);
      out(path.basename(program) + '：' + JSON.stringify({ status: value.status, value: value.stdout.trim().slice(0, 200) }));
    }
    const help = command('usermod', ['--help']);
    out(JSON.stringify({ usermodHelpStatus: help.status, addSubuids: help.stdout.includes('--add-subuids'), addSubgids: help.stdout.includes('--add-subgids') }));
    const port = command('ss', ['-H', '-lnt', '( sport = :5280 )']);
    out(JSON.stringify({ port5280CheckStatus: port.status, port5280Listening: port.status === 0 ? !!port.stdout.trim() : null }));
    for (const name of ['subuid', 'subgid']) out(name + '：' + JSON.stringify(mappingSummary(readSmall('/etc/' + name))));
    const nssTarget = fs.realpathSync('/etc/nsswitch.conf');
    if (['/etc/nsswitch.conf', '/etc/authselect/nsswitch.conf'].includes(nssTarget)) {
      const lines = readSmall(nssTarget).split('\n').map(line => line.split('#')[0].trim()).filter(line => /^subid\s*:/.test(line));
      out(JSON.stringify({ subidSourceAcceptedByOriginalScript: lines.length === 0 || (lines.length === 1 && /^subid\s*:\s*files\s*$/.test(lines[0])), subidConfigurationCount: lines.length }));
    } else out('nsswitch.conf 指向其他位置，本脚本未读取其内容。');
  });
  section('6. 当前网站状态', () => {
    for (const url of ['https://tigao123.com/api/health', 'https://tigao123.com/api/cpp/config']) {
      const response = command('curl', ['--fail', '--silent', '--show-error', '--http1.1', '--noproxy', '*', '--resolve', 'tigao123.com:443:127.0.0.1', '--connect-timeout', '5', '--max-time', '10', url]);
      if (response.status !== 0) { out(url + '：请求退出码 ' + response.status); continue; }
      const value = JSON.parse(response.stdout);
      out(url.endsWith('/health') ? JSON.stringify({ site: 'p5js', healthy: value.status === 'OK' && value.db_check === 'Database Active' }) : JSON.stringify({ site: 'cpp', production: value.mode === 'production', writesEnabled: value.writesEnabled === true, executionDisabled: value.runEnabled === false }));
    }
  });
  out('\n诊断结束：未执行账号创建、映射修改、配置修改、软件安装、Podman 初始化或服务重启。');
  out('请发回上述输出；不要重跑原准备脚本。' + (logPath ? ' 本次结果已保存：' + logPath : ''));
}
if (process.argv[2] === '--diagnose-runner-account') {
  try { diagnose(); }
  catch (error) { out('诊断未完成，错误码：' + (error.code || 'CHECK_FAILED')); process.exitCode = 1; }
  finally { if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_DIAGNOSTIC_NODE
