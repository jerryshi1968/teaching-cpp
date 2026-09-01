import { AppError } from './errors.mjs';

export function authentication(service, config) {
  return async (req, res, next) => {
    try {
      if (config.mode === 'demo') {
        const userId = Number(req.get('X-Demo-User') || 1);
        if (![1, 2, 3].includes(userId)) throw new AppError(401, 'SESSION_INVALID', '演示账号不存在');
        req.user = await service.user(userId);
        return next();
      }
      const header = req.get('Authorization') || '';
      if (!/^Bearer [A-Za-z0-9_.~-]{16,4096}$/.test(header)) throw new AppError(401, 'LOGIN_REQUIRED', '请先通过公共账号页面登录');
      let response;
      try {
        response = await fetch(`${config.commonApi.replace(/\/$/, '')}/auth/me`, {
          headers: { Authorization: header, 'Accept-Language': 'zh' }, signal: AbortSignal.timeout(5000), redirect: 'error'
        });
      } catch { throw new AppError(503, 'AUTH_UNAVAILABLE', '公共身份服务暂时无法连接，请稍后重试'); }
      if ([401, 403, 404].includes(response.status)) throw new AppError(401, 'SESSION_INVALID', '登录已失效，请重新登录');
      if (!response.ok) throw new AppError(503, 'AUTH_UNAVAILABLE', '公共身份服务暂时不可用');
      const profile = await response.json();
      // 只把公共服务验证过的 ID 当作身份，角色与班级始终从共享数据库重新读取。
      req.user = await service.user(profile.id);
      next();
    } catch (error) { next(error); }
  };
}

export function rateLimit({ limit = 90, interval = 60000, key = req => String(req.user.id) } = {}) {
  const entries = new Map();
  return (req, res, next) => {
    const time = Date.now();
    for (const [id, value] of entries) if (value.until <= time) entries.delete(id);
    const id = key(req);
    const current = entries.get(id) || { count: 0, until: time + interval };
    current.count++;
    if (!entries.has(id) && entries.size >= 10000) return next(new AppError(429, 'BUSY', '当前请求较多，请稍后重试'));
    entries.set(id, current);
    if (current.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((current.until - time) / 1000))));
      return next(new AppError(429, 'RATE_LIMIT', '操作过于频繁，请稍后重试'));
    }
    next();
  };
}
