import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MAX_FILE_BYTES, MAX_INPUT_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, PROFILES } from '../../shared/contracts.mjs';
import { assert } from './errors.mjs';
export const uuid = () => randomUUID();
export function id(value) {
  assert(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 400, 'INVALID_ID', '项目或任务编号不正确');
  return value.toLowerCase();
}
export function numberId(value, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  assert(/^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)), 400, 'INVALID_ID', '编号必须为正整数');
  return Number(value);
}
export function name(value) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100, 400, 'INVALID_NAME', '名称需要为 1–100 个字符');
  return value.trim();
}
export function filePath(value) {
  assert(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 240, 400, 'INVALID_FILE_PATH', '文件路径不能为空且不能超过 240 字节');
  assert(!value.includes('\0') && !value.includes('\\') && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), 400, 'INVALID_FILE_PATH', '文件路径必须是项目内的相对路径');
  const parts = value.split('/');
  assert(parts.every(part => part && part !== '.' && part !== '..' && Buffer.byteLength(part) <= 100) && path.posix.normalize(value) === value, 400, 'INVALID_FILE_PATH', '文件路径不能包含空目录、. 或 ..');
  return value;
}
export function snapshot(body) {
  assert(body && typeof body.stdin === 'string', 400, 'INVALID_TEXT', '代码和输入必须是文本');
  const legacy = typeof body.code === 'string' && body.files === undefined;
  assert(legacy || body.schemaVersion === 2, 400, 'INVALID_SCHEMA_VERSION', '项目快照版本不受支持');
  const inputFiles = legacy ? [{ path: 'main.cpp', content: body.code }] : body.files;
  assert(Array.isArray(inputFiles) && inputFiles.length > 0 && inputFiles.length <= MAX_PROJECT_FILES, 400, 'FILE_COUNT', `项目必须包含 1–${MAX_PROJECT_FILES} 个文件`);
  const seen = new Set();
  let totalBytes = 0;
  const files = inputFiles.map(file => {
    assert(file && typeof file === 'object' && !Array.isArray(file) && typeof file.content === 'string', 400, 'INVALID_TEXT', '每个文件都必须包含文本内容');
    const fileName = filePath(file.path);
    const key = fileName.toLocaleLowerCase('en-US');
    assert(!seen.has(key), 400, 'DUPLICATE_FILE_PATH', '项目中不能包含重复文件路径');
    seen.add(key);
    const bytes = Buffer.byteLength(file.content);
    assert(bytes <= MAX_FILE_BYTES, 413, 'FILE_SIZE', '单个文件不能超过 128KB');
    assert(!file.content.includes('\0'), 400, 'INVALID_TEXT', '代码和输入不能包含空字符');
    totalBytes += bytes;
    return { path: fileName, content: file.content };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assert(!seen.has('.cpp-program') && files.every((file, index) => files.every((other, otherIndex) => index === otherIndex || !other.path.toLocaleLowerCase('en-US').startsWith(`${file.path.toLocaleLowerCase('en-US')}/`))), 400, 'FILE_PATH_CONFLICT', '文件路径不能与目录冲突或使用保留名称');
  assert(totalBytes <= MAX_PROJECT_BYTES, 413, 'PROJECT_SIZE', '项目源码总计不能超过 512KB');
  const fileNames = new Set(files.map(file => file.path));
  const entrypoint = filePath(legacy ? 'main.cpp' : body.entrypoint);
  assert(fileNames.has(entrypoint), 400, 'ENTRYPOINT_MISSING', '入口文件必须存在于项目文件中');
  const inputSources = legacy ? ['main.cpp'] : body.build?.sources;
  assert(Array.isArray(inputSources) && inputSources.length > 0 && inputSources.length <= files.length, 400, 'INVALID_BUILD_SOURCES', '编译源文件列表不能为空且不能超过项目文件数');
  const sourceSeen = new Set();
  const sources = inputSources.map(value => {
    const source = filePath(value);
    const key = source.toLocaleLowerCase('en-US');
    assert(fileNames.has(source), 400, 'BUILD_SOURCE_MISSING', `编译源文件不存在：${source}`);
    assert(!sourceSeen.has(key), 400, 'DUPLICATE_BUILD_SOURCE', '编译源文件列表不能重复');
    assert(/\.(?:c|cc|cpp|cxx)$/i.test(source), 400, 'INVALID_BUILD_SOURCE', `不支持的编译源文件类型：${source}`);
    sourceSeen.add(key);
    return source;
  });
  assert(sources.includes(entrypoint), 400, 'ENTRYPOINT_NOT_COMPILED', '入口文件必须包含在编译源文件列表中');
  assert(Buffer.byteLength(body.stdin) <= MAX_INPUT_BYTES, 413, 'INPUT_SIZE', '输入不能超过 256KB');
  assert(!body.stdin.includes('\0'), 400, 'INVALID_TEXT', '代码和输入不能包含空字符');
  assert(typeof body.profileId === 'string' && Object.hasOwn(PROFILES, body.profileId), 400, 'INVALID_PROFILE', '请选择支持的编译配置');
  return { schemaVersion: 2, entrypoint, files, stdin: body.stdin, profileId: body.profileId, build: { sources } };
}
