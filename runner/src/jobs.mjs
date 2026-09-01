import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { id, snapshot } from '../../backend/src/validation.mjs';
import { assert } from '../../backend/src/errors.mjs';
import { TERMINAL_STATES } from '../../shared/contracts.mjs';

const terminal = record => TERMINAL_STATES.includes(record.state);
const finished = () => new Date().toISOString();
export class JobManager {
  constructor(config, sandbox) { this.config = config; this.sandbox = sandbox; this.records = new Map(); this.current = null; this.tail = Promise.resolve(); this.accepting = true; }
  async lock(fn) {
    const previous = this.tail; let release;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
  file(jobId) { return path.join(this.config.dataRoot, 'jobs', `${id(jobId)}.json`); }
  async persist(record) {
    const target = this.file(record.id), temp = `${target}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, target);
    if (process.platform === 'linux') {
      const directory = await fs.open(path.dirname(target), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    this.records.set(record.id, record);
    return this.present(record);
  }
  present(record) { const { hash, ...visible } = record; return structuredClone(visible); }
  async init() {
    await fs.mkdir(path.join(this.config.dataRoot, 'jobs'), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.config.dataRoot, 'work'), { recursive: true, mode: 0o700 });
    // preflight 已清理本服务容器；必须确认清理成功后才能调用 init 并接收新任务。
    for (const name of await fs.readdir(path.join(this.config.dataRoot, 'jobs'))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const jobId = id(name.slice(0, -5));
      const stat = await fs.lstat(this.file(jobId));
      if (!stat.isFile() || stat.size > 4 * 1024 ** 2) throw new Error('执行记录文件异常，请人工检查');
      const record = JSON.parse(await fs.readFile(this.file(jobId), 'utf8'));
      assert(record.id === jobId, 500, 'CORRUPT_JOB', '执行记录编号不匹配');
      if (!terminal(record)) { await this.sandbox.cleanup(jobId); await this.sandbox.removeWork(jobId); await this.persist({ ...record, state: 'system_error', message: '执行服务重启，旧任务已停止，请重新运行', finished_at: finished() }); }
      else this.records.set(jobId, record);
    }
    for (const name of await fs.readdir(path.join(this.config.dataRoot, 'work'))) { id(name); await this.sandbox.cleanup(name); await this.sandbox.removeWork(name); }
    await this.cleanupHistory();
    this.initialized = true;
  }
  async get(jobId) { const record = this.records.get(id(jobId)); assert(record, 404, 'NOT_FOUND', '任务不存在'); return this.present(record); }
  async submit(body) {
    const job = { id: id(body.id), ...snapshot(body), image: body.image };
    assert(job.image === this.config.image, 400, 'IMAGE_MISMATCH', '编译镜像不匹配');
    const hash = createHash('sha256').update(JSON.stringify(job)).digest('hex');
    return this.lock(async () => {
      const existing = this.records.get(job.id);
      if (existing) { assert(!existing.hash || existing.hash === hash, 409, 'REQUEST_CONFLICT', '同一任务编号不能用于其他代码'); return this.present(existing); }
      assert(this.accepting, 503, 'SHUTTING_DOWN', '执行服务正在停止');
      assert(!this.current, 409, 'BUSY', '执行服务已有未结束任务');
      const record = { id: job.id, hash, state: 'compiling', compiler_output: '', stdout: '', stderr: '', elapsed_ms: null, memory_bytes: null, message: '', created_at: finished(), finished_at: null };
      await this.persist(record);
      const controller = new AbortController();
      this.current = { id: job.id, controller, cleanupPending: false };
      this.current.promise = Promise.resolve().then(() => this.execute(job, controller)).catch(error => { console.error('[runner]', error.message); this.accepting = false; });
      return this.present(record);
    });
  }
  async cancel(jobId) {
    jobId = id(jobId);
    return this.lock(async () => {
      const existing = this.records.get(jobId);
      if (!existing) return this.persist({ id: jobId, hash: null, state: 'cancelled', compiler_output: '', stdout: '', stderr: '', message: '提交前已取消', created_at: finished(), finished_at: finished() });
      if (terminal(existing)) return this.present(existing);
      this.current?.controller.abort();
      return this.persist({ ...existing, state: 'stopping', message: '正在确认容器停止' });
    });
  }
  async execute(job, controller) {
    let result;
    try {
      result = await this.sandbox.execute(job, controller.signal, phase => this.lock(async () => {
        const record = this.records.get(job.id);
        if (record.state !== 'stopping') await this.persist({ ...record, state: phase });
      }));
    } catch (error) { result = { state: 'system_error', message: '执行环境异常，程序未确认完成' }; console.error('[sandbox]', error.message); }
    try { await this.sandbox.cleanup(job.id); await this.sandbox.removeWork(job.id); }
    catch (error) {
      await this.lock(async () => {
        this.current.cleanupPending = true;
        this.current.result = result;
        await this.persist({ ...this.records.get(job.id), state: 'stopping', message: '尚未确认环境清理完成，暂停接收新任务' });
      });
      console.error('[cleanup]', error.message); return;
    }
    await this.finish(job.id, result, controller.signal.aborted);
  }
  async finish(jobId, result, cancelled) {
    await this.lock(async () => {
      assert(terminal(result), 500, 'INVALID_RESULT', '执行结果状态异常');
      await this.persist({ ...this.records.get(jobId), ...result, state: cancelled ? 'cancelled' : result.state, finished_at: finished() });
      this.current = null;
    });
  }
  async retryCleanup() {
    const current = this.current;
    if (!current?.cleanupPending || current.retrying) return;
    current.retrying = true;
    try { await this.sandbox.cleanup(current.id); await this.sandbox.removeWork(current.id); await this.finish(current.id, current.result, current.controller.signal.aborted); }
    catch (error) { console.error('[cleanup retry]', error.message); }
    finally { current.retrying = false; }
  }
  async cleanupHistory() {
    await this.lock(async () => {
      let size = [...this.records.values()].reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0);
      for (const record of [...this.records.values()].filter(terminal).sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at))) {
        if (Date.now() - Date.parse(record.finished_at) < 86400000 && size <= 100 * 1024 ** 2) continue;
        await fs.unlink(this.file(record.id)); size -= Buffer.byteLength(JSON.stringify(record)); this.records.delete(record.id);
      }
    });
  }
  async stop() { this.accepting = false; if (this.current) { await this.cancel(this.current.id); await this.current?.promise; await this.retryCleanup(); } }
}
