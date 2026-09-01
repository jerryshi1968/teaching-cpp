import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { activation, enableWrites, ENABLED } from '../deploy/write-enable-20260831-01/guard.mjs';

test('启用写入完整保留原注释、密码、空格、引号及 LF/CRLF', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const quoted of ['disabled', '"disabled"', "'disabled'"]) {
      const source = [
        '# 中文备注 CPP_PRODUCTION_WRITES=disabled，必须原样保留',
        'DB_PASSWORD="a # special $(`value`)"',
        `  CPP_PRODUCTION_WRITES = ${quoted}  # 保留行尾说明`,
        'CPP_RUN_ENABLED="false"',
        'RUNNER_TOKEN=', ''
      ].join(newline);
      const result = enableWrites(Buffer.from(source));
      assert.deepEqual(result, Buffer.from(source.replace(`= ${quoted}`, `= ${quoted.replace('disabled', ENABLED)}`)));
      assert.equal(dotenv.parse(result).DB_PASSWORD, dotenv.parse(source).DB_PASSWORD);
      assert.equal(dotenv.parse(result).CPP_RUN_ENABLED, 'false');
    }
  }
});

test('缺少、重复或旁路声明的开关均拒绝，不猜测采用哪一条配置', () => {
  const cases = [
    'CPP_RUN_ENABLED=false\n',
    'CPP_PRODUCTION_WRITES=disabled\n',
    'CPP_PRODUCTION_WRITES=disabled\nCPP_PRODUCTION_WRITES=disabled\nCPP_RUN_ENABLED=false\n',
    'CPP_PRODUCTION_WRITES=disabled\nexport CPP_PRODUCTION_WRITES=disabled\nCPP_RUN_ENABLED=false\n',
    'CPP_PRODUCTION_WRITES=disabled\nCPP_RUN_ENABLED=true\nCPP_RUN_ENABLED=false\n',
    'CPP_PRODUCTION_WRITES: disabled\nCPP_PRODUCTION_WRITES=disabled\nCPP_RUN_ENABLED=false\n'
  ];
  for (const source of cases) assert.throws(() => enableWrites(Buffer.from(source)), { code: 'ENV_DUPLICATE_OR_MISSING_GATE' });
});

test('运行已启用、已开放写入和不支持的配置格式不被覆盖', () => {
  assert.throws(() => enableWrites(Buffer.from('CPP_PRODUCTION_WRITES=disabled\nCPP_RUN_ENABLED=true')), { code: 'RUN_MUST_REMAIN_DISABLED' });
  assert.throws(() => enableWrites(Buffer.from(`CPP_PRODUCTION_WRITES=${ENABLED}\nCPP_RUN_ENABLED=false`)), { code: 'WRITES_ALREADY_ENABLED_OR_UNEXPECTED' });
  assert.throws(() => enableWrites(Buffer.from('CPP_PRODUCTION_WRITES: disabled\nCPP_RUN_ENABLED=false')), { code: 'ENV_GATE_FORMAT_UNSUPPORTED' });
  assert.throws(() => enableWrites(Buffer.from([0xff, 0xfe])), { code: 'ENV_INVALID_UTF8' });
});

test('export、无结尾换行和 UTF-8 BOM 可保持原样，仅改目标值', () => {
  const source = '\ufeff# 标记\nexport CPP_PRODUCTION_WRITES=disabled # 注释\nexport CPP_RUN_ENABLED=false';
  assert.equal(enableWrites(Buffer.from(source)).toString(), source.replace('=disabled', '=' + ENABLED));
});

const order = ['preflight', 'backup', 'replace', 'restart', 'verify', 'finish'];
for (const failed of order) {
  test(`启用在 ${failed} 失败时停止推进，必要时恢复只读`, async () => {
    const called = [];
    const actions = Object.fromEntries([...order, 'recover'].map(name => [name, async () => {
      called.push(name);
      if (name === failed) throw Object.assign(new Error('injected'), { code: 'INJECTED_FAILURE' });
    }]));
    await assert.rejects(activation(actions), { code: 'INJECTED_FAILURE' });
    const expected = order.slice(0, order.indexOf(failed) + 1);
    if (order.indexOf(failed) >= 2) expected.push('recover');
    assert.deepEqual(called, expected);
  });
}

test('核验和恢复均失败时保留两种错误，不伪报恢复成功', async () => {
  const actions = Object.fromEntries([...order, 'recover'].map(name => [name, async () => {}]));
  actions.verify = async () => { throw Object.assign(new Error(), { code: 'PUBLIC_CHECK_FAILED' }); };
  actions.recover = async () => { throw Object.assign(new Error(), { code: 'RECOVERY_STOP_FAILED' }); };
  await assert.rejects(activation(actions), error => error.code === 'PUBLIC_CHECK_FAILED' && error.recoveryCode === 'RECOVERY_STOP_FAILED');
});

test('材料检查不加载 .env，不操作服务；正式入口拒绝非 Linux 环境', () => {
  const file = path.resolve(import.meta.dirname, '../deploy/write-enable-20260831-01/enable.mjs');
  const result = spawnSync(process.execPath, [file, '--check-only'], { encoding: 'utf8', env: { ...process.env, APP_MODE: 'invalid', NODE_ENV: 'production' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /未读取 \.env/);
  const invalid = spawnSync(process.execPath, [file, '--invalid'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /ARGUMENT_INVALID/);
  if (process.platform !== 'linux') {
    const server = spawnSync(process.execPath, [file, '--enable-writes'], { encoding: 'utf8' });
    assert.equal(server.status, 1);
    assert.match(server.stderr, /ROOT_LINUX_REQUIRED/);
  }
});
