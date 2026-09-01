import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
export function readConfig(env = process.env) {
  const mode = env.APP_MODE || 'demo';
  if (!['demo', 'test', 'production'].includes(mode)) throw new Error('APP_MODE 必须为 demo、test 或 production');
  if (env.NODE_ENV === 'production' && mode !== 'production') throw new Error('生产环境禁止演示身份');
  if (mode !== 'production' && env.HOST && env.HOST !== '127.0.0.1') throw new Error('演示和测试服务仅允许监听 127.0.0.1');
  const runEnabled = mode !== 'demo' && env.CPP_RUN_ENABLED === 'true';
  if (runEnabled && !/^sha256:[a-f0-9]{64}$/.test(env.CPP_COMPILER_IMAGE || '')) throw new Error('启用执行前必须固定 CPP_COMPILER_IMAGE 的 sha256 镜像 ID');
  if (runEnabled && (env.RUNNER_TOKEN || '').length < 32) throw new Error('执行服务令牌至少需要 32 个字符');
  if (mode === 'test' && !/_test$/.test(env.DB_NAME || '')) throw new Error('测试模式仅允许连接以 _test 结尾的数据库');
  if (mode === 'production' && (!env.DB_NAME || !env.DB_USER)) throw new Error('生产模式必须显式配置数据库名和专用账号');
  for (const endpoint of [env.COMMON_API_URL || 'http://127.0.0.1:5000/api', env.RUNNER_URL || 'http://127.0.0.1:5200']) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('本版本公共身份和执行服务只允许使用本机 127.0.0.1 HTTP 地址');
  }
  const positive = (key, fallback) => {
    const value = Number(env[key] || fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} 必须是正整数`);
    return value;
  };
  return {
    mode, host: '127.0.0.1', port: positive('PORT', 5100),
    writesEnabled: mode === 'demo' || (mode === 'test' && /_test$/.test(env.DB_NAME || '')) || (mode === 'production' && env.CPP_PRODUCTION_WRITES === 'enabled-after-p5js-review'),
    commonApi: env.COMMON_API_URL || 'http://127.0.0.1:5000/api',
    storageRoot: path.resolve(env.CPP_STORAGE_ROOT || path.join(ROOT, 'storage', mode)),
    runnerUrl: env.RUNNER_URL || 'http://127.0.0.1:5200', runnerToken: env.RUNNER_TOKEN || '',
    runEnabled, compilerImage: env.CPP_COMPILER_IMAGE || null,
    retentionMs: 24 * 60 * 60 * 1000, userCacheBytes: 100 * 1024 * 1024,
    globalCacheBytes: positive('CPP_CACHE_TOTAL_MB', 2048) * 1024 * 1024,
    minFreeBytes: positive('CPP_MIN_FREE_MB', 1024) * 1024 * 1024,
    maxPending: 20, maxPerUser: 1,
    db: { host: env.DB_HOST || '127.0.0.1', port: positive('DB_PORT', 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 4, timezone: 'Z', charset: 'utf8mb4' }
  };
}
