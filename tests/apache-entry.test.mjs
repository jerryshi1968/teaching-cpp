import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUnpublishedResponse } from '../deploy/web-publish-20260831-01/entry.mjs';

const mainPage = Buffer.from('<!doctype html><title>主站</title><div id="root"></div>');
const html = 'HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8';

test('首次发布接受缺失入口，也能识别 HTTP 200 的主站原文回退', () => {
  for (const status of [403, 404]) {
    assert.equal(assertUnpublishedResponse({ status }, mainPage), 'absent');
  }
  assert.equal(assertUnpublishedResponse({ status: 200, header: html, body: Buffer.from(mainPage) }, mainPage), 'main-site-fallback');
});

test('其他页面、非 HTML、重定向和服务器错误不能当成主站回退放行', () => {
  const cases = [
    { status: 200, header: html, body: Buffer.from('<title>已经运行的其他应用</title>') },
    { status: 200, header: html, body: Buffer.concat([mainPage, Buffer.from('changed')]) },
    { status: 200, header: 'Content-Type: application/json', body: mainPage },
    { status: 200, header: 'Content-Type: text/html-unexpected', body: mainPage },
    { status: 200, header: html, body: Buffer.alloc(0) },
    { status: 302, header: html, body: mainPage },
    { status: 500, header: html, body: mainPage }
  ];
  for (const response of cases) assert.throws(() => assertUnpublishedResponse(response, mainPage));
});

test('没有核验过的主站原文时不能继续判断入口', () => {
  const response = { status: 200, header: html, body: mainPage };
  for (const missing of [undefined, '', Buffer.alloc(0)]) {
    assert.throws(() => assertUnpublishedResponse(response, missing));
  }
});
