// Windows 离线下载入口：使用官方便携工具获取固定镜像，不安装 Docker 或运行容器。
// 下载内容只写入本项目 downloads，原有服务器脚本和配置保持不变。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOADS = path.join(ROOT, 'downloads', 'gcc-offline-20260831');
export const PIN = Object.freeze({
  reference: 'docker.io/library/gcc@sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c',
  manifest: 'sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c',
  config: 'sha256:6b4bd930afb1272016c64651ed6192f519f666edf9255213ad09c5cbdd657723',
  version: '14.4.0', compressedBytes: 540483496, layers: 8
});
export const TOOL = Object.freeze({
  version: '0.22.0', name: 'go-containerregistry_Windows_x86_64.tar.gz', size: 16537478,
  sha256: '2d4ce27bde9bd3b511bd7c0b5a4c9654dbadf43ee1da9eac083e6f1511282b32',
  url: 'https://github.com/google/go-containerregistry/releases/download/v0.22.0/go-containerregistry_Windows_x86_64.tar.gz'
});
const ARCHIVE_NAME = 'gcc-14.4.0-linux-amd64.oci.tar';
let lockFd;
let lockFile;
const log = text => process.stdout.write(text + '\n');
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function digest(bytes) { return 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }
function inside(file) {
  const relative = path.relative(ROOT, path.resolve(file));
  ensure(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'PATH_OUTSIDE_PROJECT');
  return path.resolve(file);
}
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function directory(file) {
  inside(file);
  ensure(samePath(fs.realpathSync(path.dirname(file)), path.dirname(file)), 'PARENT_LINK_NOT_ALLOWED');
  if (!fs.existsSync(file)) fs.mkdirSync(file);
  ensure(fs.lstatSync(file).isDirectory() && samePath(fs.realpathSync(file), file), 'DIRECTORY_LINK_NOT_ALLOWED');
}
function regular(file, maxBytes = Number.MAX_SAFE_INTEGER) {
  const stat = fs.lstatSync(file);
  ensure(stat.isFile() && stat.nlink === 1 && samePath(fs.realpathSync(file), file) && stat.size <= maxBytes, 'FILE_UNEXPECTED');
  return stat;
}
async function fileDigest(file) {
  regular(file);
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return 'sha256:' + hash.digest('hex');
}
function readJson(file) { regular(file, 1024 * 1024); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function blobPath(layout, value) {
  ensure(/^sha256:[a-f0-9]{64}$/.test(value), 'BLOB_DIGEST_INVALID');
  return path.join(layout, 'blobs', 'sha256', value.slice(7));
}
export function checkMetadata(index, manifestBytes, configBytes, pin = PIN) {
  ensure(index.schemaVersion === 2 && index.manifests?.length === 1 && index.manifests[0].digest === pin.manifest, 'INDEX_MISMATCH');
  ensure(digest(manifestBytes) === pin.manifest && index.manifests[0].size === manifestBytes.length, 'MANIFEST_HASH_MISMATCH');
  const manifest = JSON.parse(manifestBytes);
  ensure(manifest.schemaVersion === 2 && manifest.config?.digest === pin.config && manifest.config.size === configBytes.length && digest(configBytes) === pin.config, 'CONFIG_HASH_MISMATCH');
  const config = JSON.parse(configBytes);
  ensure(config.os === 'linux' && config.architecture === 'amd64' && config.config?.Env?.includes('GCC_VERSION=' + pin.version), 'PLATFORM_OR_VERSION_MISMATCH');
  ensure(Array.isArray(manifest.layers) && manifest.layers.length === pin.layers && manifest.layers.every(layer => /^sha256:[a-f0-9]{64}$/.test(layer.digest) && Number.isSafeInteger(layer.size) && layer.size > 0) && manifest.layers.reduce((sum, layer) => sum + layer.size, 0) === pin.compressedBytes, 'LAYERS_MISMATCH');
  return manifest;
}
export async function verifyLayout(layout, pin = PIN) {
  ensure(readJson(path.join(layout, 'oci-layout')).imageLayoutVersion === '1.0.0', 'OCI_FORMAT_MISMATCH');
  const index = readJson(path.join(layout, 'index.json'));
  const manifestFile = blobPath(layout, pin.manifest), configFile = blobPath(layout, pin.config);
  regular(manifestFile, 1024 * 1024); regular(configFile, 1024 * 1024);
  const manifest = checkMetadata(index, fs.readFileSync(manifestFile), fs.readFileSync(configFile), pin);
  const expected = [pin.manifest, pin.config, ...manifest.layers.map(layer => layer.digest)].map(value => value.slice(7)).sort();
  ensure(JSON.stringify(fs.readdirSync(path.join(layout, 'blobs')).sort()) === JSON.stringify(['sha256']) && JSON.stringify(fs.readdirSync(path.join(layout, 'blobs', 'sha256')).sort()) === JSON.stringify(expected), 'UNEXPECTED_BLOB_FILES');
  for (const layer of manifest.layers) {
    const file = blobPath(layout, layer.digest);
    ensure(regular(file, layer.size).size === layer.size && await fileDigest(file) === layer.digest, 'LAYER_HASH_MISMATCH');
  }
  return index;
}
export function safeToolError(text) {
  // 工具错误可能带临时签名 URL；只显示错误类型，完整输出不保存到日志。
  if (/429|too many requests|toomanyrequests/i.test(text)) return 'REGISTRY_RATE_LIMIT';
  if (/certificate|x509|tls handshake/i.test(text)) return 'TLS_CONNECTION_ERROR';
  if (/timeout|timed out|deadline exceeded/i.test(text)) return 'NETWORK_TIMEOUT';
  if (/no such host|name resolution|lookup .*no such/i.test(text)) return 'DNS_LOOKUP_FAILED';
  if (/401|unauthorized|denied/i.test(text)) return 'REGISTRY_AUTH_REJECTED';
  if (/connection|connectex|unreachable|reset by peer/i.test(text)) return 'NETWORK_CONNECTION_FAILED';
  return 'DOWNLOAD_TOOL_FAILED';
}
async function pull(exe, layout, cache, env) {
  const args = ['pull', '--platform=linux/amd64', '--format=oci', '--cache_path=' + cache, PIN.reference, layout];
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: DOWNLOADS, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', timedOut = false;
    child.stdout.resume();
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-32768); });
    const progress = setInterval(() => log('仍在下载，已用 ' + Math.floor((Date.now() - started) / 1000) + ' 秒。已完成的层会保留在本项目缓存中。'), 15000);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30 * 60 * 1000);
    child.once('error', () => { clearInterval(progress); clearTimeout(timer); reject(Object.assign(new Error(), { code: 'TOOL_START_FAILED' })); });
    child.once('close', code => {
      clearInterval(progress); clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else reject(Object.assign(new Error(), { code: timedOut ? 'DOWNLOAD_TIME_LIMIT' : safeToolError(stderr) }));
    });
  });
}
async function main() {
  ensure(process.platform === 'win32' && process.arch === 'x64', 'WINDOWS_X64_REQUIRED');
  ensure(process.argv.length === 2, 'NO_ARGUMENTS_EXPECTED');
  directory(path.join(ROOT, 'downloads')); directory(DOWNLOADS);
  const toolArchive = path.join(DOWNLOADS, TOOL.name);
  if (!fs.existsSync(toolArchive)) {
    log('先用浏览器下载官方便携工具（约 16 MB，不需要安装）：\n' + TOOL.url);
    log('把原压缩包保存到：\n' + toolArchive + '\n不需要解压。保存后再次双击本下载入口。');
    process.exitCode = 2; return;
  }
  ensure(regular(toolArchive, TOOL.size).size === TOOL.size && await fileDigest(toolArchive) === 'sha256:' + TOOL.sha256, 'TOOL_ARCHIVE_HASH_MISMATCH');
  const final = path.join(DOWNLOADS, ARCHIVE_NAME);
  ensure(!fs.existsSync(final) && !fs.existsSync(final + '.sha256'), 'FINAL_ARCHIVE_ALREADY_EXISTS');
  const disk = fs.statfsSync(DOWNLOADS);
  ensure(disk.bavail * disk.bsize >= 4 * 1024 ** 3, 'NEED_4_GIB_FREE');
  lockFile = path.join(DOWNLOADS, '.download.lock');
  try { lockFd = fs.openSync(lockFile, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error(), { code: 'DOWNLOAD_ALREADY_RUNNING_OR_LOCK_REMAINS' });
    throw error;
  }
  fs.writeSync(lockFd, String(process.pid) + '\n');
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  ensure(fs.statSync(tar).isFile(), 'WINDOWS_TAR_NOT_FOUND');
  const options = { cwd: DOWNLOADS, windowsHide: true, timeout: 30000, maxBuffer: 80 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
  const toolDir = path.join(DOWNLOADS, 'tool'); directory(toolDir);
  // 只提取已核验官方压缩包中的 crane.exe 字节，不让归档文件路径决定落盘位置。
  const executableBytes = execFileSync(tar, ['-xOf', toolArchive, 'crane.exe'], options);
  ensure(executableBytes.subarray(0, 2).toString() === 'MZ', 'TOOL_EXECUTABLE_FORMAT');
  const exe = path.join(toolDir, 'crane.exe');
  if (!fs.existsSync(exe)) fs.writeFileSync(exe, executableBytes, { flag: 'wx' });
  ensure(await fileDigest(exe) === digest(executableBytes), 'TOOL_EXECUTABLE_CHANGED');
  const cache = path.join(DOWNLOADS, 'cache'); directory(cache);
  const attempt = fs.mkdtempSync(path.join(DOWNLOADS, 'attempt-'));
  const home = path.join(attempt, 'client-home'); directory(home);
  const dockerConfig = path.join(home, 'docker-config'); directory(dockerConfig);
  fs.writeFileSync(path.join(dockerConfig, 'config.json'), '{"auths":{}}\n', { flag: 'wx' });
  // 使用独立空凭据目录；保留用户已有网络代理环境，但不打印代理地址或凭据。
  const env = { ...process.env, HOME: home, USERPROFILE: home, DOCKER_CONFIG: dockerConfig, XDG_CONFIG_HOME: home, XDG_RUNTIME_DIR: home, REGISTRY_AUTH_FILE: path.join(dockerConfig, 'config.json') };
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  const version = execFileSync(exe, ['version'], { ...options, env, encoding: 'utf8' }).trim();
  ensure(version.replace(/^v/, '') === TOOL.version, 'TOOL_VERSION_MISMATCH');
  log('工具校验通过。开始在本电脑下载官方 GCC 14.4.0 / Linux amd64，压缩层约 515 MiB。');
  log('不需要管理员权限，不安装 Docker，不连接或改动服务器。请勿同时打开多个下载窗口。');
  log('本次目录：' + attempt);
  const layout = path.join(attempt, 'oci');
  await pull(exe, layout, cache, env);
  log('下载完成，正在逐个核验镜像清单、配置和全部镜像层的 SHA256。');
  const index = await verifyLayout(layout);
  // 此处只为 OCI 归档增加导入名称，不改变官方清单、配置或镜像层的任何字节。
  index.manifests[0].annotations = { ...index.manifests[0].annotations, 'org.opencontainers.image.ref.name': 'gcc-base-14.4.0-amd64' };
  fs.writeFileSync(path.join(layout, 'index.json'), JSON.stringify(index) + '\n');
  const partial = path.join(attempt, ARCHIVE_NAME + '.partial');
  log('摘要全部通过，正在生成可上传的离线镜像包。');
  execFileSync(tar, ['-cf', partial, '-C', layout, 'oci-layout', 'index.json', 'blobs'], { ...options, timeout: 300000 });
  const archiveHash = (await fileDigest(partial)).slice(7);
  inside(partial); inside(final);
  ensure(!fs.existsSync(final), 'FINAL_ARCHIVE_ALREADY_EXISTS');
  fs.renameSync(partial, final);
  fs.writeFileSync(final + '.sha256', archiveHash + '  ' + ARCHIVE_NAME + '\n', { flag: 'wx' });
  fs.writeFileSync(final + '.json', JSON.stringify({ at: new Date().toISOString(), source: PIN, tool: TOOL, archive: ARCHIVE_NAME, bytes: fs.statSync(final).size, sha256: archiveHash }, null, 2) + '\n', { flag: 'wx' });
  log('离线包已准备好：\n' + final + '\n' + final + '.sha256\n' + final + '.json');
  log('请把最后这几行发回对话。下一步再安排上传、普通账号导入和服务器核验；现在不要解压镜像或以 root 导入。');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'OFFLINE_PREPARATION_FAILED';
    log('尚未生成可用离线包，错误码：' + code + '\n缓存与已下载内容保留，没有操作服务器。请发回此提示。');
    process.exitCode = 1;
  }).finally(() => {
    if (lockFd !== undefined) { fs.closeSync(lockFd); inside(lockFile); fs.unlinkSync(lockFile); }
  });
}
