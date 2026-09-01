import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function acquireInstanceLock(uid) {
  const marker = `${randomUUID()}\n`;
  const child = spawn('/usr/bin/flock', ['--exclusive', '--nonblock', `/run/user/${uid}/teaching-cpp-runner.lock`, '/usr/bin/cat'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  child.stdin.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('执行服务实例锁超时')), 5000);
      let received = '';
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('该 Linux 用户已有执行服务，或实例锁不可用')); });
      child.stdout.on('data', chunk => { received += chunk; if (received === marker) { clearTimeout(timer); resolve(); } });
      child.stdin.write(marker);
    });
  } catch (error) { child.kill(); throw error; }
  let released = false;
  child.on('exit', () => { if (!released) { console.error('执行服务实例锁丢失，立即停止调度'); process.exit(1); } });
  return () => { released = true; child.stdin.end(); };
}
