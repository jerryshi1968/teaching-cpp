import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApacheState, waitUntilApacheReady } from '../deploy/web-publish-20260831-02/lifecycle.mjs';
import { responseEvidence, failureEvidence } from '../deploy/web-publish-20260831-02/diagnostics.mjs';

const ready = { load: 'loaded', active: 'active', sub: 'running' };
const reloading = { load: 'loaded', active: 'reloading', sub: 'reload' };
function fixture(states, overrides = {}) {
  let elapsed = 0;
  let reads = 0;
  const events = [];
  return {
    options: {
      timeoutMs: 60, pollMs: 10, settleMs: 20,
      now: () => elapsed,
      sleep: async ms => { elapsed += ms; },
      readState: async remaining => { assert.ok(remaining > 0); return states[Math.min(reads++, states.length - 1)]; },
      onState: state => events.push(state),
      ...overrides
    },
    events,
    elapsed: () => elapsed,
    reads: () => reads
  };
}

test('解析 systemd 实际字段顺序与 CRLF，缺少或异常字段拒绝', () => {
  assert.deepEqual(parseApacheState('SubState=reload\r\nLoadState=loaded\r\nActiveState=reloading\r\n'), reloading);
  for (const text of ['ActiveState=active', 'LoadState=loaded\nActiveState=active\nSubState=', 'LoadState=loaded\nActiveState=active\nSubState=bad value']) {
    assert.throws(() => parseApacheState(text), { code: 'APACHE_STATE_INVALID' });
  }
});

test('reloading 不误报故障，连续稳定就绪后才允许发起后续请求', async () => {
  const context = fixture([reloading, reloading, ready, ready, ready]);
  assert.deepEqual(await waitUntilApacheReady(context.options), ready);
  assert.equal(context.elapsed(), 40);
  assert.deepEqual(context.events, [reloading, ready]);
});

test('短暂 active 随后进入 reloading 不能被当成加载完成', async () => {
  const context = fixture([ready, reloading, ready, ready, ready]);
  await waitUntilApacheReady(context.options);
  assert.equal(context.elapsed(), 40);
  assert.equal(context.reads(), 5);
});

test('服务失败或停止时立即拒绝，不继续等待或放行', async () => {
  for (const active of ['failed', 'inactive', 'deactivating']) {
    const context = fixture([{ load: 'loaded', active, sub: 'dead' }]);
    await assert.rejects(waitUntilApacheReady(context.options), { code: 'APACHE_NOT_READY' });
    assert.equal(context.elapsed(), 0);
    assert.equal(context.reads(), 1);
  }
});

test('重载一直不结束或 active 未稳定时均按时超时', async () => {
  for (const states of [[reloading], [reloading, reloading, ready]]) {
    const context = fixture(states, { timeoutMs: 30 });
    await assert.rejects(waitUntilApacheReady(context.options), { code: 'APACHE_RELOAD_TIMEOUT' });
    assert.equal(context.elapsed(), 30);
  }
});

test('取消或读取状态失败均不能继续发布', async () => {
  const cancelled = fixture([ready], { isCancelled: () => true });
  await assert.rejects(waitUntilApacheReady(cancelled.options), { code: 'OPERATION_CANCELLED' });
  assert.equal(cancelled.reads(), 0);
  const expected = Object.assign(new Error('read failed'), { code: 'ETIMEDOUT' });
  const failed = fixture([ready], { readState: async () => { throw expected; } });
  await assert.rejects(waitUntilApacheReady(failed.options), error => error === expected);
});

test('HTTP 诊断保留状态与内容摘要，不泄露正文、Cookie、认证信息和查询参数', () => {
  const secret = 'DO_NOT_LOG_PRIVATE_VALUE';
  const evidence = responseEvidence('/api/cpp/config', {
    status: 200, body: Buffer.from(secret),
    header: 'Content-Type: application/json\r\nSet-Cookie: token=' + secret + '\r\nAuthorization: Bearer ' + secret + '\r\nX-Content-Type-Options: nosniff\r\n'
  });
  assert.equal(evidence.status, 200);
  assert.equal(evidence.contentType, 'application/json');
  assert.equal(evidence.nosniff, true);
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(evidence).includes(secret));
  assert.equal(responseEvidence('/?token=' + secret, { status: 200, header: '', body: Buffer.alloc(0) }).path, '[omitted]');
});

test('自动生成的断言可定位源码行，但异常原值和消息不进入诊断', () => {
  const secret = 'DO_NOT_LOG_ASSERTION_VALUE';
  const error = {
    code: 'ERR_ASSERTION', actual: secret, expected: secret, message: secret,
    stack: 'AssertionError: ' + secret + '\n    at publish (file:///var/www/teaching-cpp-backend/deploy/web-publish-20260831-02/publish.mjs:250:9)\n    at async file:///var/www/teaching-cpp-backend/deploy/web-publish-20260831-02/publish.mjs:290:5'
  };
  const evidence = failureEvidence(error);
  assert.equal(evidence.code, 'ERR_ASSERTION');
  assert.deepEqual(evidence.locations, ['publish.mjs:250:9', 'publish.mjs:290:5']);
  assert.ok(!JSON.stringify(evidence).includes(secret));
});
