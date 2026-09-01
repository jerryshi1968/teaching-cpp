import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// 只在 C++ 项目中生成兼容补丁草稿；绝不写入原 p5.js 项目或连接数据库。
const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = 'G:/teaching-p5js/backend';
const targetRoot = path.join(root, 'compat/p5js-20260830-01');
const originals = {
  'projectModel.js': '7a5488c268596cc42d9b141466ec38efc975a31df8519950472d0ddc0ee514a0',
  'projectGroupModel.js': '821272aa417252d6447cb4db34d0f34b6c6009bdc29e8333458273460f3ac3c5',
  'fileModel.js': '54438a13f6163558eec024e34acb45dd31d4e923be075bef3c6975491e80b729'
};
const digest = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\r\n/g, '\n');

function transformSql(source, transform) {
  return source.replace(/(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*?\1/g, raw => {
    const quote = raw[0];
    const sql = raw.slice(1, -1);
    if (!/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/.test(sql)) return raw;
    if (quote !== '`' && sql.includes('\\')) throw new Error('需要人工处理已有转义的 SQL');
    const changed = transform(sql);
    if (changed === sql) return raw;
    return quote + (quote === "'" ? changed.replace(/'/g, "\\'") : changed) + quote;
  });
}

function projectSql(sql) {
  if (sql.startsWith('INSERT INTO projects ')) {
    return sql.replace('parent_id, sort_order)', 'parent_id, sort_order, project_type)')
      .replace('VALUES (?, ?, ?, ?, ?)', "VALUES (?, ?, ?, ?, ?, 'p5js')");
  }
  if (/\bFROM projects p\b/.test(sql) && /\bWHERE\b/.test(sql)) {
    return sql.replace(/\bWHERE\s+/, "WHERE p.project_type = 'p5js' AND ");
  }
  if (/\b(?:FROM|UPDATE) (?:projects|project_groups)\b/.test(sql) && /\bWHERE\b/.test(sql)) {
    return sql.replace(/\bWHERE\s+/, "WHERE project_type = 'p5js' AND ");
  }
  return sql;
}

function groupSql(sql) {
  if (sql.startsWith('INSERT INTO project_groups ')) {
    return sql.replace('parent_id, sort_order)', 'parent_id, sort_order, project_type)')
      .replace('VALUES (?, ?, ?, ?)', "VALUES (?, ?, ?, ?, 'p5js')");
  }
  return sql
    .replace(/(FROM project_groups\s+WHERE\s+)/g, "$1project_type = 'p5js' AND ")
    .replace(/(UPDATE project_groups SET[\s\S]*?\bWHERE\s+)/g, "$1project_type = 'p5js' AND ")
    .replace(/WHERE pg\.user_id/g, "WHERE pg.project_type = 'p5js' AND pg.user_id")
    .replace(/WHERE p\.user_id/g, "WHERE p.project_type = 'p5js' AND p.user_id");
}

function fileSql(sql) {
  if (sql.startsWith('INSERT INTO files ')) {
    return "INSERT INTO files (project_id, name, path) SELECT ?, ?, ? FROM projects WHERE id = ? AND project_type = 'p5js'";
  }
  if (/\bJOIN projects p\b/.test(sql)) {
    return sql.replace(/\bWHERE\s+/, "WHERE p.project_type = 'p5js' AND ");
  }
  if (/\b(?:FROM|UPDATE) files\b/.test(sql)) {
    return sql.replace(/\bWHERE\s+/, "WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = 'p5js') AND ");
  }
  return sql;
}

if (fs.existsSync(targetRoot)) throw new Error('草稿目录已存在，不覆盖已有内容');
const entries = [];
for (const [name, expectedHash] of Object.entries(originals)) {
  const bytes = fs.readFileSync(path.join(sourceRoot, 'models', name));
  const source = bytes.toString('utf8');
  if (digest(normalized(source)) !== expectedHash) throw new Error('本机基线变化：' + name);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let changed = transformSql(source, name === 'projectModel.js' ? projectSql : name === 'projectGroupModel.js' ? groupSql : fileSql);
  if (name === 'projectModel.js') {
    const oldClause = "const whereClause = keyword ? ' WHERE u.username LIKE ?' : '';";
    if (source.split(oldClause).length !== 3) throw new Error('管理员列表查询数量变化');
    changed = changed.replaceAll(oldClause, "const whereClause = keyword ? \" WHERE p.project_type = 'p5js' AND u.username LIKE ?\" : \" WHERE p.project_type = 'p5js'\";");
  }
  if (name === 'fileModel.js') {
    changed = changed.replaceAll('[projectId, name, path]', '[projectId, name, path, projectId]');
    changed = changed.replace('  await connection.query(', '  const [result] = await connection.query(');
    const anchor = '[projectId, name, path, projectId]' + newline + '  );';
    if (changed.split(anchor).length !== 3) throw new Error('文件创建查询数量变化');
    const guard = [
      '  if (result.affectedRows !== 1) {',
      "    const error = new Error('项目不存在或不属于 p5.js。');",
      '    error.statusCode = 404;',
      '    throw error;',
      '  }'
    ].join(newline);
    changed = changed.replaceAll(anchor, anchor + newline + guard);
  }
  if (source === changed) throw new Error('未生成改动：' + name);
  entries.push({ name, source, changed, originalBytes: bytes, originalSha256: digest(bytes), normalizedOriginalSha256: expectedHash, patchedSha256: digest(changed), normalizedPatchedSha256: digest(normalized(changed)) });
}

for (const folder of ['reference/models', 'patched/models']) fs.mkdirSync(path.join(targetRoot, folder), { recursive: true });
for (const entry of entries) {
  fs.writeFileSync(path.join(targetRoot, 'reference/models', entry.name), entry.originalBytes, { flag: 'wx' });
  fs.writeFileSync(path.join(targetRoot, 'patched/models', entry.name), entry.changed, { flag: 'wx' });
}
fs.writeFileSync(path.join(targetRoot, 'manifest.json'), JSON.stringify({
  status: 'draft-not-for-deployment',
  requiresMigration: '001_cpp',
  pendingServerReview: ['app.js', 'services/exampleService.js'],
  files: entries.map(({ name, originalSha256, normalizedOriginalSha256, patchedSha256, normalizedPatchedSha256 }) => ({ path: 'models/' + name, originalSha256, normalizedOriginalSha256, patchedSha256, normalizedPatchedSha256 }))
}, null, 2) + '\n', { flag: 'wx' });
console.log('已生成三个模型的补丁草稿及原文副本：' + targetRoot);
console.log('没有修改原 p5.js 项目；尚未核对两个线上差异文件，也未执行 MySQL 集成验证。');
