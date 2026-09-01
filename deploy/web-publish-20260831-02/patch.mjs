import assert from 'node:assert/strict';

export const INCLUDE = '/var/www/teaching-cpp-backend/deploy/web-publish-20260831-02/site.conf';

// 只插入新引用，不替换原配置、注释或空白；拒绝无法唯一识别的配置结构。
export function insertInclude(original) {
  assert.equal(typeof original, 'string');
  assert.ok(!original.includes('\uFFFD'), '配置不是完整 UTF-8');
  assert.ok(!original.includes('teaching-cpp') && !original.includes('/api/cpp'), '配置已经包含 C++ 入口');
  const crlf = original.includes('\r\n');
  assert.ok(!crlf || !original.replace(/\r\n/g, '').includes('\n'), '配置存在混合换行');
  const newline = crlf ? '\r\n' : '\n';
  const blocks = [...original.matchAll(/^[ \t]*<VirtualHost[ \t]+([^>\r\n]+)>[^]*?^[ \t]*<\/VirtualHost>[ \t]*(?=\r?$)/gm)];
  const matches = blocks.filter(block => /^[ \t]*ServerName[ \t]+tigao123\.com[ \t]*\r?$/m.test(block[0]));
  assert.equal(matches.length, 1, '不能唯一识别主站 HTTPS VirtualHost');
  const block = matches[0];
  assert.equal(block[1].trim(), '*:443', '主站不是预期的 443 配置');
  assert.equal([...block[0].matchAll(/^[ \t]*ServerName[ \t]+/gm)].length, 1);
  assert.equal([...block[0].matchAll(/^[ \t]*DocumentRoot[ \t]+(?:"\/var\/www\/html"|\/var\/www\/html)[ \t]*\r?$/gm)].length, 1, '主站 DocumentRoot 不同');
  const proxies = [...block[0].matchAll(/^([ \t]*)ProxyPass[ \t]+(?:"\/api"|\/api)[ \t]+(?:"http:\/\/127\.0\.0\.1:5080\/api"|http:\/\/127\.0\.0\.1:5080\/api)(?=[ \t\r\n]|$)[^\r\n]*/gm)];
  assert.equal(proxies.length, 1, '不能唯一识别原站 5080 代理');
  const proxy = proxies[0];
  let depth = 0;
  for (const tag of block[0].slice(0, proxy.index).matchAll(/^[ \t]*<(\/?)[A-Za-z][^>]*>[ \t]*\r?$/gm)) depth += tag[1] ? -1 : 1;
  assert.equal(depth, 1, '原代理位于额外的嵌套配置中');
  const insertion = proxy[1] + '# --- C++ 教学平台入口 ---' + newline + proxy[1] + 'Include "' + INCLUDE + '"' + newline + newline;
  const position = block.index + proxy.index;
  const result = original.slice(0, position) + insertion + original.slice(position);
  assert.equal(result.slice(0, position) + result.slice(position + insertion.length), original);
  return result;
}
