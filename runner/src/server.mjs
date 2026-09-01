import { runnerConfig } from './config.mjs';
import { CpuMeteredSandbox as PodmanSandbox } from './cpu-budget.mjs';
import { JobManager } from './jobs.mjs';
import { createRunnerApp } from './app.mjs';
import { acquireInstanceLock } from './instance-lock.mjs';

const config = runnerConfig();
const releaseLock = await acquireInstanceLock(config.uid);
const sandbox = new PodmanSandbox(config);
const manager = new JobManager(config, sandbox);
let server;
try {
  console.log('正在验证 rootless Podman 隔离条件与实际资源上限…');
  console.log(await sandbox.preflight());
  await manager.init();
  server = createRunnerApp(manager, config).listen(config.port, config.host, () => console.log(`执行服务仅监听 ${config.host}:${config.port}`));
} catch (error) { releaseLock(); throw error; }
const sweep = setInterval(() => manager.cleanupHistory().catch(error => console.error(error.message)), 60000);
const retry = setInterval(() => manager.retryCleanup().catch(error => console.error(error.message)), 5000);
async function stop() {
  clearInterval(sweep); clearInterval(retry); server.close();
  await manager.stop();
  releaseLock();
  process.exit(manager.current ? 1 : 0);
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
