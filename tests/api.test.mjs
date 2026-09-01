import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createServer } from 'node:http';
import { fixture } from './helpers.mjs';
import { createApp } from '../backend/src/app.mjs';
import { readConfig } from '../backend/src/config.mjs';

test('真实 HTTP 链路保存、类别隔离、非法字段和代码长度限制', async t => {
  const { service, config, repo } = await fixture(t);
  const client = request(createApp(service, config));
  const created = await client.post('/api/cpp/projects').set('X-Demo-User', '2').send({ name: 'HTTP', project_type: 'p5js' }).expect(201);
  assert.equal(created.body.project_type, 'cpp');
  await client.get(`/api/cpp/projects/${created.body.id}`).set('X-Demo-User', '3').expect(404);
  await client.put(`/api/cpp/projects/${created.body.id}/source`).set('X-Demo-User', '2').send({ version: 1, code: 'a'.repeat(128 * 1024 + 1), stdin: '', profileId: 'cpp17' }).expect(413);
  await client.put(`/api/cpp/projects/${created.body.id}/source`).set('X-Demo-User', '2').send({ version: 1, code: 'a', stdin: '', profileId: 'cpp17; ls' }).expect(400);
  await client.get('/api/cpp/projects/../../etc/passwd').expect(404);
  assert.equal((await repo.find('runs')).length, 0);
});

test('非演示环境不接受演示身份；公共身份核验后重新读取数据库权限', async t => {
  const fakeAuth = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 2, role: 'admin' })); });
  await new Promise(resolve => fakeAuth.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fakeAuth.close(resolve)));
  const { service, config } = await fixture(t, { mode: 'test', commonApi: `http://127.0.0.1:${fakeAuth.address().port}/api` });
  const client = request(createApp(service, config));
  await client.get('/api/cpp/me').set('X-Demo-User', '1').expect(401);
  const profile = await client.get('/api/cpp/me').set('Authorization', 'Bearer synthetic-test-session').expect(200);
  assert.equal(profile.body.role, 'student');
  await client.get('/api/cpp/classes').set('Authorization', 'Bearer synthetic-test-session').expect(403);
});

test('演示服务拒绝公网 Host，生产配置不能意外启用演示或远程身份地址', async t => {
  const { service, config } = await fixture(t);
  await request(createApp(service, config)).get('/api/cpp/me').set('Host', 'public.example').expect(403);
  await request(createApp(service, config)).get('/api/cpp/me').set('Host', 'localhost').set('X-Forwarded-For', '198.51.100.2').expect(403);
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /禁止演示/);
  assert.throws(() => readConfig({ APP_MODE: 'test', DB_NAME: 'production' }), /_test/);
  assert.throws(() => readConfig({ COMMON_API_URL: 'https://attacker.example/api' }), /127.0.0.1/);
  assert.throws(() => readConfig({ APP_MODE: 'production' }), /数据库/);
});
