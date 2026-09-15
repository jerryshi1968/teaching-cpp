import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { API_BASE, EXAMPLES, PROFILES } from '../../shared/contracts.mjs';
import { authentication, rateLimit } from './auth.mjs';
import { AppError } from './errors.mjs';

export function createApp(service, config) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet({ contentSecurityPolicy: {
    directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.mode === 'production' ? [] : null }
  } }));
  if (config.mode === 'demo') app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip)) return res.status(403).json({ message: '演示模式仅供本机访问，不能公开部署' });
    next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.use(API_BASE, (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && (!req.body || Array.isArray(req.body))) return next(new AppError(400, 'INVALID_BODY', '请求需要 JSON 对象'));
    next();
  });
  app.get(`${API_BASE}/health`, (req, res) => res.json({ status: 'ok', mode: config.mode, executionEnabled: config.runEnabled }));
  app.get(`${API_BASE}/config`, (req, res) => res.json({ mode: config.mode, writesEnabled: config.writesEnabled, runEnabled: config.runEnabled, profiles: Object.values(PROFILES).map(({ id, name }) => ({ id, name })), limits: { pending: 20, perUser: 1, concurrency: 1, retentionHours: 24, userCacheMB: 100, files: 64, fileKB: 128, projectKB: 512 }, commonLogin: '/teaching-p5js/login', commonDashboard: '/teaching-p5js/dashboard', commonAdmin: '/teaching-p5js/admin' }));
  app.use(API_BASE, rateLimit({ limit: 4000, key: req => req.ip }), authentication(service, config));
  const changes = rateLimit();
  app.use(API_BASE, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return changes(req, res, next);
    next();
  });
  const route = (method, url, handler, status = 200) => app[method](`${API_BASE}${url}`, async (req, res) => res.status(status).json(await handler(req)));
  route('get', '/me', req => ({ id: req.user.id, username: req.user.username, role: req.user.role, classCode: req.user.class_code || '', tokens: Number(req.user.tokens || 0) }));
  route('get', '/workspace', req => service.workspace(req.user, req.query.studentId));
  route('get', '/examples', () => EXAMPLES.map(({ id, name, topic, description }) => ({ id, name, topic, description })));
  route('post', '/projects', req => service.createProject(req.user, req.body), 201);
  route('put', '/projects/reorder', req => service.reorder(req.user, 'projects', req.body));
  route('put', '/projects/:id/reposition', req => service.repositionProject(req.user, req.params.id, req.body));
  route('get', '/projects/:id', req => service.getProject(req.user, req.params.id));
  route('put', '/projects/:id/source', req => service.saveProject(req.user, req.params.id, req.body));
  route('post', '/projects/:id/run', req => service.saveAndRun(req.user, req.params.id, req.body), 202);
  route('get', '/projects/:id/runs', req => service.runs(req.user, req.params.id));
  route('patch', '/projects/:id', req => service.updateProject(req.user, req.params.id, req.body));
  route('post', '/projects/:id/copy', req => service.copyProject(req.user, req.params.id, req.body), 201);
  route('post', '/projects/:id/distribute', req => service.distribute(req.user, req.params.id, req.body), 201);
  route('delete', '/projects/:id', req => service.deleteProject(req.user, req.params.id));
  route('post', '/groups', req => service.createGroup(req.user, req.body), 201);
  route('put', '/groups/reorder', req => service.reorder(req.user, 'groups', req.body));
  route('put', '/groups/:id/reposition', req => service.repositionGroup(req.user, req.params.id, req.body));
  route('patch', '/groups/:id', req => service.updateGroup(req.user, req.params.id, req.body));
  route('delete', '/groups/:id', req => service.deleteGroup(req.user, req.params.id));
  route('get', '/classes', req => service.classes(req.user));
  route('get', '/classes/:id/students', req => service.students(req.user, req.params.id));
  route('get', '/runs/:id', req => service.getRun(req.user, req.params.id));
  route('get', '/runs/:id/source', req => service.getRunSource(req.user, req.params.id));
  route('post', '/runs/:id/stop', req => service.stopRun(req.user, req.params.id));
  app.use(API_BASE, (req, res) => res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' }));
  if (config.frontendRoot) {
    app.use('/teaching-cpp', express.static(config.frontendRoot, { index: false, maxAge: '1h' }));
    app.get(/^\/teaching-cpp(?:\/.*)?$/, (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(config.frontendRoot, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof AppError;
    const status = known ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    if (!known && status === 500) console.error('[cpp-api]', error.code || error.name, error.message);
    res.status(status).json({ code: known ? error.code : status === 413 ? 'BODY_TOO_LARGE' : 'SERVER_ERROR', message: known ? error.message : status === 413 ? '提交内容超过大小限制' : status === 400 ? '请求格式不正确' : '服务暂时无法完成请求，请重试；未确认保存前请保留本地代码', ...(known ? error.details : {}) });
  });
  return app;
}
