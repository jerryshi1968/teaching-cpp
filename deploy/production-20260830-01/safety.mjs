import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const normalize = text => text.replace(/\r\n/g, '\n');

// 发布只接受已核对的原文；服务器使用 CRLF 时保留其换行，不顺便格式化原文件。
export function renderPatch(original, reference, patched) {
  const text = original.toString('utf8');
  assert.equal(normalize(text), normalize(reference.toString('utf8')), '原模型已变化');
  assert.equal(original.toString('utf8').includes('\uFFFD'), false, '原文件不是完整 UTF-8');
  const crlf = text.includes('\r\n');
  assert.ok(!crlf || !text.replace(/\r\n/g, '').includes('\n'), '拒绝自动处理混合换行');
  const next = normalize(patched.toString('utf8'));
  return Buffer.from(crlf ? next.replace(/\n/g, '\r\n') : next, 'utf8');
}

// 密码仅进入权限 0600 的临时 MySQL 选项文件，不进入命令参数、环境变量或输出。
export function mysqlOption(value) {
  assert.equal(typeof value, 'string');
  assert.doesNotMatch(value, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
}

// 行顺序不作为数据变更；列顺序由迁移前的列清单固定，原始数据不写入进度日志。
export function fingerprint(rows, columns) {
  const encoded = rows.map(row => JSON.stringify(columns.map(column => row[column]))).sort();
  return { count: rows.length, sha256: sha256(JSON.stringify(encoded)) };
}

// 出错后只调用受检查的恢复流程；本流程从不恢复整库或删除新增字段。
export async function publication(actions) {
  await actions.preflight();
  try {
    await actions.stop();
    await actions.backup();
    await actions.migrate();
    await actions.install();
    await actions.verify();
    await actions.resume();
    await actions.finish();
  } catch (error) {
    try { await actions.recover(); }
    catch (recoveryError) { error.recoveryCode = recoveryError.code || 'RECOVERY_REQUIRED'; }
    throw error;
  }
}
