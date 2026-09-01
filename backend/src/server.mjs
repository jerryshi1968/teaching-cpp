import path from 'node:path';
import { createPool } from 'mysql2/promise';
import { readConfig, ROOT } from './config.mjs';
import { MemoryRepository, MysqlRepository } from './repository.mjs';
import { SourceStore } from './source-store.mjs';
import { CppService } from './service.mjs';
import { createApp } from './app.mjs';
import { seedDemo } from './demo.mjs';
import { RunWorker } from './worker.mjs';

const config = readConfig();
config.frontendRoot = path.join(ROOT, 'frontend/dist');
const repo = config.mode === 'demo' ? new MemoryRepository() : new MysqlRepository(createPool(config.db));
const sources = new SourceStore(path.join(config.storageRoot, 'sources'), config.minFreeBytes);
await sources.init();
if (repo.checkSchema) await repo.checkSchema();
const service = new CppService(repo, sources, config);
if (config.mode === 'demo') await seedDemo(service);
let worker;
if (config.runEnabled && config.writesEnabled) {
  await repo.acquireWorkerLock();
  worker = new RunWorker(service, config);
  repo.workerConnection.on('error', () => { worker.stop(); console.error('任务调度数据库锁已失效，停止服务'); process.exit(1); });
  worker.start();
}
const app = createApp(service, config);
const server = app.listen(config.port, config.host, () => console.log(`C++ ${config.mode}：http://${config.host}:${config.port}/teaching-cpp/`));
const cleanup = setInterval(() => { if (config.writesEnabled) service.cleanup().catch(error => console.error('缓存清理失败', error.code || error.message)); }, 60000);
cleanup.unref();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  worker?.stop(); clearInterval(cleanup);
  server.close(async () => { await repo.close(); process.exit(0); });
});
