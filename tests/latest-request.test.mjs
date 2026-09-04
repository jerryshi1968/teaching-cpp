import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRequestCommitter } from '../frontend/src/latest-request.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('工作区并发读取只提交最后发起的响应', async () => {
  const commitLatest = createLatestRequestCommitter();
  const older = deferred();
  const newer = deferred();
  const committed = [];
  const olderResult = commitLatest(() => older.promise, value => committed.push(value));
  const newerResult = commitLatest(() => newer.promise, value => committed.push(value));
  newer.resolve('newer');
  assert.equal(await newerResult, 'newer');
  older.resolve('older');
  assert.equal(await olderResult, null);
  assert.deepEqual(committed, ['newer']);
});
