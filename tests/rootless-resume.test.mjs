import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function loadScript(name) {
  const text = fs.readFileSync(new URL('../deploy/' + name, import.meta.url), 'utf8');
  const body = /<<'CPP_ROOTLESS_NODE'\n([\s\S]+)\nCPP_ROOTLESS_NODE\n$/.exec(text)?.[1];
  assert.ok(body);
  return import('data:text/javascript;base64,' + Buffer.from(body).toString('base64'));
}
const old = await loadScript('initialize-rootless-podman-20260831.sh');
const { parseProperties, propertyOptions, queryProperties, checkResumeRecord, checkRecordedHashes } = await loadScript('resume-rootless-podman-20260831-02.sh');
const home = '/var/www/teaching-cpp-runner';
const phase = '只为 cpp-runner 启用后台用户管理，保持现有 slice 限额';
const before = () => ({ uid: 994, gid: 991, lingering: false, manager: { ActiveState: 'inactive', Delegate: 'yes' }, slice: { LoadState: 'loaded', ActiveState: 'inactive', MemoryMax: '1073741824', MemorySwapMax: '0', CPUQuotaPerSecUSec: '1s', TasksMax: '256', DropInPaths: '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf' } });
const created = () => ({ storage: home + '/.config/containers/storage.conf', engine: home + '/.config/containers/containers.conf', storageSha256: 'a'.repeat(64), engineSha256: 'b'.repeat(64) });

// 按 systemd 252 loginctl.c 的属性列表语义模拟：每个 -p 参数整体加入列表，不拆分逗号。
function loginctl252(command, args) {
  assert.equal(command, 'loginctl');
  assert.deepEqual(args.slice(0, 2), ['show-user', 'cpp-runner']);
  const filters = args.filter(value => value.startsWith('--property=')).map(value => value.slice('--property='.length));
  return [['Linger', 'yes'], ['RuntimePath', '/run/user/994']].filter(([key]) => filters.includes(key)).map(([key, value]) => key + '=' + value + '\n').join('');
}

test('复现旧版逗号筛选得到空输出并触发 PROPERTY_FORMAT，接续版正确读取两个字段', () => {
  const output = loginctl252('loginctl', ['show-user', 'cpp-runner', '--property=Linger,RuntimePath']);
  assert.equal(output, '');
  assert.throws(() => old.parseProperties(output), { code: 'PROPERTY_FORMAT' });
  const values = queryProperties('loginctl', ['show-user', 'cpp-runner'], ['Linger', 'RuntimePath'], loginctl252);
  assert.deepEqual(values, { Linger: 'yes', RuntimePath: '/run/user/994' });
});

test('属性参数逐个生成，拒绝空列表、重复、逗号及参数注入', () => {
  assert.deepEqual(propertyOptions(['ActiveState', 'ControlGroup']), ['--property=ActiveState', '--property=ControlGroup']);
  for (const values of [[], ['Linger', 'Linger'], ['Linger,RuntimePath'], ['--value'], ['A\nB'], [null]]) assert.throws(() => propertyOptions(values), { code: 'PROPERTY_NAMES_INVALID' });
});

test('不能以忽略空输出的方式放行，仍区分空结果、缺字段及重复字段', () => {
  for (const output of ['', '\n', ' \r\n ']) assert.throws(() => parseProperties(output, ['Linger']), { code: 'PROPERTY_OUTPUT_EMPTY' });
  assert.throws(() => parseProperties('Linger=yes\n', ['Linger', 'RuntimePath']), { code: 'PROPERTY_MISSING' });
  assert.throws(() => parseProperties('Linger=yes\nLinger=no\n', ['Linger']), { code: 'PROPERTY_FORMAT' });
  assert.throws(() => parseProperties('warning: not a property\nLinger=yes\n', ['Linger']), { code: 'PROPERTY_FORMAT' });
});

test('支持 CRLF 和空属性值，保留值中的等号', () => {
  assert.deepEqual(parseProperties('ControlGroup=\r\nExample=a=b\r\n', ['ControlGroup', 'Example']), { ControlGroup: '', Example: 'a=b' });
});

test('解析失败记录读取位置，不把原输出或秘密片段拼进公开错误', () => {
  assert.throws(() => queryProperties('loginctl', ['show-user', 'cpp-runner'], ['Linger', 'RuntimePath'], () => 'SECRET_MUST_NOT_APPEAR'), error => {
    assert.equal(error.code, 'PROPERTY_FORMAT');
    assert.equal(error.propertySource, 'loginctl:Linger,RuntimePath');
    assert.equal(error.message.includes('SECRET_MUST_NOT_APPEAR'), false);
    return true;
  });
});

test('系统命令失败保持失败，不转换为空属性或正常结果', () => {
  const failure = Object.assign(new Error('private diagnostic'), { code: 'COMMAND_LOGINCTL' });
  assert.throws(() => queryProperties('loginctl', ['show-user', 'cpp-runner'], ['Linger'], () => { throw failure; }), error => error === failure);
});

test('仅接受本次尚未运行 Podman 的中断记录', () => {
  assert.doesNotThrow(() => checkResumeRecord(before(), created(), phase, []));
  assert.throws(() => checkResumeRecord(before(), created(), '另一个阶段', []), { code: 'RESUME_STAGE_UNEXPECTED' });
  for (const file of ['user-manager.json', 'probe-unit.json', 'podman-probe.json', 'result.json']) assert.throws(() => checkResumeRecord(before(), created(), phase, [file]), { code: 'RESUME_STAGE_UNEXPECTED' });
});

test('不接管不同账号、已初始化环境或来源不符的旧记录', () => {
  for (const change of [{ uid: 0 }, { uid: 995 }, { gid: 992 }, { lingering: true }, { manager: { ActiveState: 'active', Delegate: 'yes' } }, { manager: { ActiveState: 'inactive', Delegate: 'no' } }]) assert.throws(() => checkResumeRecord({ ...before(), ...change }, created(), phase, []), { code: 'RESUME_RECORD_UNEXPECTED' });
  const invalid = before();
  invalid.slice.MemoryMax = 'infinity';
  assert.throws(() => checkResumeRecord(invalid, created(), phase, []), { code: 'SLICE_LIMITS_UNEXPECTED' });
});

test('已创建配置记录必须属于独立账号目录并有完整摘要', () => {
  for (const change of [{ storage: '/etc/containers/storage.conf' }, { engine: '/root/.config/containers/containers.conf' }, { storageSha256: 'short' }, { engineSha256: '' }]) assert.throws(() => checkResumeRecord(before(), { ...created(), ...change }, phase, []), { code: 'RESUME_CONFIG_RECORD_UNEXPECTED' });
});

test('接续前必须检查完整的原配置集合与摘要，不能少查或静默接受变化', () => {
  const hashes = { '/etc/subuid': 'a'.repeat(64), '/app/.env': 'b'.repeat(64) };
  assert.doesNotThrow(() => checkRecordedHashes(hashes, { '/app/.env': 'b'.repeat(64), '/etc/subuid': 'a'.repeat(64) }));
  assert.throws(() => checkRecordedHashes(hashes, { '/etc/subuid': 'a'.repeat(64) }), { code: 'RESUME_CONFIG_SET_CHANGED' });
  assert.throws(() => checkRecordedHashes(hashes, { ...hashes, '/extra': 'c'.repeat(64) }), { code: 'RESUME_CONFIG_SET_CHANGED' });
  assert.throws(() => checkRecordedHashes(hashes, { ...hashes, '/app/.env': 'c'.repeat(64) }), { code: 'RESUME_EXISTING_CONFIGURATION_CHANGED' });
});
