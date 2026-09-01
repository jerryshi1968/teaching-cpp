import { randomUUID } from 'node:crypto';
import { MAX_CODE_BYTES, MAX_INPUT_BYTES, PROFILES } from '../../shared/contracts.mjs';
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
export function snapshot(body) {
  assert(typeof body?.code === 'string' && typeof body?.stdin === 'string', 400, 'INVALID_TEXT', '代码和输入必须是文本');
  assert(Buffer.byteLength(body.code) <= MAX_CODE_BYTES, 413, 'CODE_SIZE', '代码不能超过 128KB');
  assert(Buffer.byteLength(body.stdin) <= MAX_INPUT_BYTES, 413, 'INPUT_SIZE', '输入不能超过 256KB');
  assert(!body.code.includes('\0') && !body.stdin.includes('\0'), 400, 'INVALID_TEXT', '代码和输入不能包含空字符');
  assert(typeof body.profileId === 'string' && Object.hasOwn(PROFILES, body.profileId), 400, 'INVALID_PROFILE', '请选择支持的编译配置');
  return { code: body.code, stdin: body.stdin, profileId: body.profileId };
}
