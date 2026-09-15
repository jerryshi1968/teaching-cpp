export const APP_BASE = '/teaching-cpp/';
export const API_BASE = '/api/cpp';
export const MAX_CODE_BYTES = 128 * 1024;
export const MAX_FILE_BYTES = MAX_CODE_BYTES;
export const MAX_PROJECT_BYTES = 512 * 1024;
export const MAX_PROJECT_FILES = 64;
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_INPUT_BYTES = 256 * 1024;
export const MAX_OUTPUT_BYTES = 256 * 1024;
export const ACTIVE_STATES = ['queued', 'compiling', 'running', 'stopping'];
export const TERMINAL_STATES = ['completed', 'compile_error', 'runtime_error', 'time_limit', 'memory_limit', 'output_limit', 'cancelled', 'system_error'];
export const STATE_LABELS = {
  queued: '排队中', compiling: '编译中', running: '运行中', stopping: '正在停止',
  completed: '运行完成', compile_error: '编译错误', runtime_error: '运行错误',
  time_limit: '超时', memory_limit: '超出内存限制', output_limit: '输出超限',
  cancelled: '已停止', system_error: '执行服务异常'
};
// 编译配置是服务端白名单；本配置用于练习，不宣称与任何赛事评测环境完全一致。
export const PROFILES = {
  cpp17: { id: 'cpp17', name: 'C++17 · 练习环境', standard: 'c++17', flags: ['-std=c++17', '-O2', '-Wall', '-Wextra', '-fdiagnostics-color=never'] },
  cpp14: { id: 'cpp14', name: 'C++14 · 练习环境', standard: 'c++14', flags: ['-std=c++14', '-O2', '-Wall', '-Wextra', '-fdiagnostics-color=never'] }
};
export const DEFAULT_CODE = '#include <iostream>\nusing namespace std;\n\nint main() {\n    // 从这里开始你的程序\n    cout << "Hello, C++!" << endl;\n    return 0;\n}\n';
export const EXAMPLES = [
  { id: 'hello', name: '你好，C++', topic: '初识程序', description: '让程序输出第一句问候。', code: DEFAULT_CODE, stdin: '' },
  { id: 'sum', name: '两数之和', topic: '输入与输出', description: '读取两个整数，输出它们的和。', code: '#include <iostream>\nusing namespace std;\n\nint main() {\n    long long a, b;\n    cin >> a >> b;\n    // 尝试输入不同的整数，观察结果\n    cout << a + b << endl;\n    return 0;\n}\n', stdin: '12 30\n' },
  { id: 'loop', name: '累加小练习', topic: '循环结构', description: '读取 n，计算 1 到 n 的和。', code: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    long long sum = 0;\n    // 在这里编写循环\n\n    cout << sum << endl;\n    return 0;\n}\n', stdin: '10\n' }
];
export function diagnostics(text) {
  return String(text || '').split('\n').flatMap(line => {
    const match = line.match(/^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)/);
    if (!match) return [];
    const file = match[1].replace(/^\/work\//, '').replace(/\\/g, '/');
    return [{ file, line: Number(match[2]), column: Number(match[3]), severity: match[4], message: match[5] }];
  });
}
