import { createHash } from 'node:crypto';

// 仅记录公开路径、状态和摘要；不输出响应正文、Cookie、认证头或原始异常内容。
export function responseEvidence(resource, response) {
  const type = /^content-type:[ \t]*([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)/im.exec(response.header)?.[1] || null;
  return {
    path: /^\/[A-Za-z0-9_./-]*$/.test(resource) ? resource : '[omitted]',
    status: response.status,
    contentType: type,
    bytes: response.body.length,
    sha256: createHash('sha256').update(response.body).digest('hex'),
    nosniff: /^x-content-type-options:[ \t]*nosniff[ \t]*\r?$/im.test(response.header),
    frameAncestorsNone: /^content-security-policy:[^\r\n]*frame-ancestors 'none'/im.test(response.header)
  };
}

export function failureEvidence(error) {
  const locations = [];
  for (const line of String(error.stack || '').split('\n').filter(line => /^\s+at /.test(line))) {
    const location = /[\/\\]((?:publish|lifecycle|diagnostics|patch|entry)\.mjs:\d+:\d+)\)?$/.exec(line)?.[1];
    if (location && !locations.includes(location)) locations.push(location);
    if (locations.length >= 4) break;
  }
  return {
    code: typeof error.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'WEB_PUBLISH_FAILED',
    locations
  };
}
