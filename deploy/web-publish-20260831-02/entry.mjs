import assert from 'node:assert/strict';

// 主站可把不存在的子路径返回为首页；只允许与已核验主站文件逐字一致的这种响应。
export function assertUnpublishedResponse(response, mainPage) {
  assert.ok(Buffer.isBuffer(mainPage) && mainPage.length > 0, '缺少已核验的主站首页');
  if ([403, 404].includes(response.status)) return 'absent';
  assert.equal(response.status, 200, 'C++ 入口返回非预期状态，停止发布');
  assert.match(response.header, /content-type:[ \t]*text\/html(?:[;\s]|$)/i, 'C++ 入口不是主站 HTML 回退');
  assert.ok(Buffer.isBuffer(response.body) && response.body.equals(mainPage), 'C++ 入口返回了其他内容，不能自动替换');
  return 'main-site-fallback';
}
