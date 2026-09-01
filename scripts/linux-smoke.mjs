import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runnerConfig } from '../runner/src/config.mjs';
import { CpuMeteredSandbox as PodmanSandbox } from '../runner/src/cpu-budget.mjs';
import { acquireInstanceLock } from '../runner/src/instance-lock.mjs';
import { JobManager } from '../runner/src/jobs.mjs';

if (!process.argv.includes('--confirm-isolated-test')) throw new Error('仅在独立测试执行用户下使用，并传入 --confirm-isolated-test；不能与该用户的执行服务同时运行');
const config = runnerConfig();
const release = await acquireInstanceLock(config.uid);
const sandbox = new PodmanSandbox(config);
try {
  console.log(await sandbox.preflight());
  const manager = new JobManager(config, sandbox);
  await manager.init();
  const cases = [
    { name: '标准输入输出', code: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}', stdin: '12 30', state: 'completed', output: '42\n' },
    { name: '编译失败', code: 'int main(){ invalid syntax }', state: 'compile_error' },
    { name: '运行目录只读、看不到主站密钥', code: '#include <cstdio>\nint main(){FILE*a=fopen("/work/main.cpp","w");FILE*b=fopen("/etc/teaching-cpp/backend.env","r");return a||b?7:0;}', state: 'completed' }
  ];
  if (process.argv.includes('--include-limits')) cases.push(
    { name: '墙钟超时', code: '#include <unistd.h>\nint main(){for(;;)pause();}', state: 'time_limit' },
    { name: 'CPU 时间上限', code: 'int main(){for(;;)asm volatile("":::"memory");}', state: 'time_limit' },
    { name: '主动返回 137 不误报超时', code: 'int main(){return 137;}', state: 'runtime_error' },
    { name: '输出上限', code: '#include <cstdio>\nint main(){for(;;)puts("012345678901234567890123456789");}', state: 'output_limit' },
    { name: '容器内存上限', code: '#include <cstdlib>\n#include <cstring>\nint main(){for(;;){void*p=malloc(16*1024*1024);if(!p)return 9;memset(p,7,16*1024*1024);asm volatile(""::"r"(p):"memory");}}', state: 'memory_limit' }
  );
  for (const item of cases) {
    const id = randomUUID();
    await manager.submit({ id, code: item.code, stdin: item.stdin || '', profileId: 'cpp17', image: config.image });
    if (manager.current) await manager.current.promise;
    const result = await manager.get(id);
    assert.equal(result.state, item.state, `${item.name}：${result.message}; ${result.compiler_output}; ${result.stderr}`);
    if (item.output !== undefined) assert.equal(result.stdout, item.output);
    console.log(`通过：${item.name}`);
  }
  console.log('这些是单任务验证，不是课堂并发性能验收。');
} finally { release(); }
