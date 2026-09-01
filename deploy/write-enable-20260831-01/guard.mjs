import { createHash } from 'node:crypto';
import dotenv from 'dotenv';

export const ENABLED = 'enabled-after-p5js-review';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function requireThat(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

// 只替换一个开关的值；密码、注释、引号、空格和换行都保持原字节。
export function enableWrites(original) {
  const source = original.toString('utf8');
  requireThat(Buffer.from(source, 'utf8').equals(original), 'ENV_INVALID_UTF8');
  const before = dotenv.parse(original);
  for (const key of ['CPP_PRODUCTION_WRITES', 'CPP_RUN_ENABLED']) {
    const declarations = source.match(new RegExp('^[ \\t]*(?:export[ \\t]+)?' + key + '[ \\t]*(?:=|:[ \\t])', 'gm')) || [];
    requireThat(declarations.length === 1, 'ENV_DUPLICATE_OR_MISSING_GATE');
  }
  requireThat(before.CPP_PRODUCTION_WRITES === 'disabled', 'WRITES_ALREADY_ENABLED_OR_UNEXPECTED');
  requireThat(before.CPP_RUN_ENABLED === 'false', 'RUN_MUST_REMAIN_DISABLED');
  const pattern = /^([ \t]*(?:export[ \t]+)?CPP_PRODUCTION_WRITES[ \t]*=[ \t]*)(disabled|"disabled"|'disabled')([ \t]*(?:#[^\r\n]*)?)(\r?)$/gm;
  let replacements = 0;
  const result = source.replace(pattern, (_, prefix, value, suffix, cr) => {
    replacements++;
    return prefix + value.replace('disabled', ENABLED) + suffix + cr;
  });
  requireThat(replacements === 1, 'ENV_GATE_FORMAT_UNSUPPORTED');
  const next = Buffer.from(result, 'utf8');
  requireThat(JSON.stringify(dotenv.parse(next)) === JSON.stringify({ ...before, CPP_PRODUCTION_WRITES: ENABLED }), 'ENV_OTHER_VALUES_CHANGED');
  return next;
}

// 备份完成前不改变服务。开关替换即使只完成一半，也进入恢复流程。
export async function activation(actions) {
  await actions.preflight();
  await actions.backup();
  try {
    await actions.replace();
    await actions.restart();
    await actions.verify();
    await actions.finish();
  } catch (error) {
    try { await actions.recover(); }
    catch (recoveryError) { error.recoveryCode = recoveryError.code || 'RECOVERY_REQUIRED'; }
    throw error;
  }
}
