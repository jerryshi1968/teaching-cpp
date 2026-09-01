import { setTimeout as delay } from 'node:timers/promises';

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

// 只读取服务状态字段；不依赖 is-active 对 reloading 也返回成功的退出码语义。
export function parseApacheState(text) {
  const values = new Map(text.trim().split(/\r?\n/).map(line => line.split('=')));
  const state = { load: values.get('LoadState'), active: values.get('ActiveState'), sub: values.get('SubState') };
  if (!Object.values(state).every(value => typeof value === 'string' && /^[a-z-]{1,40}$/.test(value))) {
    throw failure('APACHE_STATE_INVALID', 'Apache 状态字段缺失或格式不正确');
  }
  return state;
}

// 平滑加载期间允许暂态；连续稳定就绪后才继续，失败、停止、取消和超时均不能放行。
export async function waitUntilApacheReady({ readState, onState = () => {}, isCancelled = () => false,
  timeoutMs = 15000, pollMs = 300, settleMs = 600, now = () => performance.now(), sleep = delay }) {
  const deadline = now() + timeoutMs;
  let stableSince = null;
  let previous;
  while (now() < deadline) {
    if (isCancelled()) throw failure('OPERATION_CANCELLED', '操作被中断');
    const state = await readState(Math.max(1, Math.ceil(deadline - now())));
    if (isCancelled()) throw failure('OPERATION_CANCELLED', '操作被中断');
    const current = JSON.stringify(state);
    if (current !== previous) { onState(state); previous = current; }
    if (state.load !== 'loaded' || !['active', 'reloading'].includes(state.active)) {
      throw failure('APACHE_NOT_READY', 'Apache 服务未加载、已停止或处于失败状态');
    }
    if (now() >= deadline) break;
    if (state.active === 'active' && state.sub === 'running') {
      stableSince ??= now();
      if (now() - stableSince >= settleMs) return state;
    } else {
      stableSince = null;
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
  throw failure('APACHE_RELOAD_TIMEOUT', 'Apache 未在限定时间内稳定就绪');
}
