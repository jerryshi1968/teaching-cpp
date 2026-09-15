import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../../backend/src/errors.mjs';
export function createRunnerApp(manager, config) {
  const app = express();
  app.disable('x-powered-by');
  const expected = Buffer.from(`Bearer ${config.token}`);
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const received = Buffer.from(req.get('authorization') || '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(401).json({ message: '执行服务认证失败' });
    next();
  });
  app.use(express.json({ limit: '2mb', strict: true }));
  app.use((req, res, next) => {
    if (req.method === 'POST' && (!req.body || Array.isArray(req.body))) return res.status(400).json({ message: '请求需要 JSON 对象' });
    next();
  });
  app.use((req, res, next) => { if (!manager.initialized) return res.status(503).json({ message: '正在检查执行环境' }); next(); });
  app.get('/health', (req, res) => res.json({ ready: manager.accepting, busy: !!manager.current, image: config.image }));
  app.post('/jobs', async (req, res) => res.status(202).json(await manager.submit(req.body)));
  app.get('/jobs/:id', async (req, res) => res.json(await manager.get(req.params.id)));
  app.post('/jobs/:id/cancel', async (req, res) => res.json(await manager.cancel(req.params.id)));
  app.use((req, res) => res.status(404).json({ message: '接口不存在' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof AppError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ code: error instanceof AppError ? error.code : 'RUNNER_ERROR', message: status < 500 ? error.message : '执行服务异常' });
  });
  return app;
}
