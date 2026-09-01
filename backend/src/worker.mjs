import { PROFILES, TERMINAL_STATES } from '../../shared/contracts.mjs';

export class RunWorker {
  constructor(service, config) { this.service = service; this.config = config; this.busy = false; this.stopped = false; }
  async request(path, method = 'GET', body) {
    const response = await fetch(`${this.config.runnerUrl}${path}`, {
      method, headers: { Authorization: `Bearer ${this.config.runnerToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000), redirect: 'error'
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`执行服务 HTTP ${response.status}`);
    return response.json();
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let run;
    try {
      run = await this.service.nextRun();
      if (!run) return;
      let result;
      if (run.state === 'stopping') {
        result = await this.request(`/jobs/${run.id}/cancel`, 'POST', {});
      } else {
        result = await this.request(`/jobs/${run.id}`);
        if (!result) {
          const source = await this.service.sources.read(run.revision_id);
          if (JSON.stringify(run.profile_json.flags) !== JSON.stringify(PROFILES[source.profileId]?.flags)) {
            await this.service.updateRun(run.id, { state: 'system_error', message: '该任务的编译配置已更换，请重新提交；旧任务未启动' });
            return;
          }
          result = await this.request('/jobs', 'POST', { id: run.id, code: source.code, stdin: source.stdin, profileId: source.profileId, image: run.profile_json.image });
        }
      }
      if (!result) throw new Error('执行服务未确认任务状态');
      await this.service.updateRun(run.id, result);
      if (TERMINAL_STATES.includes(result.state)) await this.service.cleanup();
    } catch (error) {
      // 网络失败不能伪装成任务停止；保留任务编号，恢复连接后向同一执行任务重新查询。
      if (run) await this.service.repo.transaction(tx => tx.update('runs', { id: run.id }, { message: '执行服务连接暂时中断，正在重新确认任务状态', updated_at: new Date().toISOString() })).catch(() => {});
      this.lastError = error.message;
    } finally { this.busy = false; }
  }
  start() { this.timer = setInterval(() => this.tick(), 1000); this.timer.unref(); this.tick(); }
  stop() { this.stopped = true; clearInterval(this.timer); }
}
