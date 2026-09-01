import path from 'node:path';
import dotenv from 'dotenv';
const root = path.resolve(import.meta.dirname, '../..');
dotenv.config({ path: path.join(root, '.env.runner'), quiet: true });
export function runnerConfig(env = process.env) {
  if (process.platform !== 'linux' || process.getuid?.() === 0) throw new Error('执行服务必须以独立普通用户在 Linux 上运行，禁止 root 或 Windows 直接执行');
  if (!/^sha256:[a-f0-9]{64}$/.test(env.CPP_COMPILER_IMAGE || '')) throw new Error('请固定已安装的编译器镜像 sha256 ID');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.RUNNER_TOKEN || '')) throw new Error('RUNNER_TOKEN 需为 32–256 位随机字母、数字、下划线或连字符');
  if (env.CONTAINER_HOST || env.CONTAINER_CONNECTION) throw new Error('执行服务不允许使用远程容器引擎');
  const port = Number(env.RUNNER_PORT || 5200);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RUNNER_PORT 无效');
  const dataRoot = path.resolve(env.RUNNER_DATA_ROOT || path.join(root, 'runner-data'));
  if (dataRoot === '/' || /[:,\n\r]/.test(dataRoot)) throw new Error('RUNNER_DATA_ROOT 不是有效的独立目录');
  return { port, host: '127.0.0.1', token: env.RUNNER_TOKEN, image: env.CPP_COMPILER_IMAGE, dataRoot, podman: '/usr/bin/podman', uid: process.getuid(), gid: process.getgid(), minFreeBytes: 1024 ** 3 };
}
