import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { PIN, TOOL, checkMetadata, verifyLayout, safeToolError } from '../deploy/download-gcc-offline-20260831.mjs';

const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value));
function fixture() {
  const config = bytes({ os: 'linux', architecture: 'amd64', config: { Env: ['GCC_VERSION=14.4.0'] } });
  const layer = Buffer.from('fixture layer bytes');
  const manifest = bytes({ schemaVersion: 2, config: { digest: hash(config), size: config.length }, layers: [{ digest: hash(layer), size: layer.length }] });
  const pin = { ...PIN, manifest: hash(manifest), config: hash(config), compressedBytes: layer.length, layers: 1 };
  const index = { schemaVersion: 2, manifests: [{ digest: pin.manifest, size: manifest.length }] };
  return { config, layer, manifest, pin, index };
}

test('离线下载继续使用之前核验的同一个 GCC 官方清单和配置', () => {
  const evidence = JSON.parse(fs.readFileSync(new URL('../deploy/compiler-image-evidence-20260831.json', import.meta.url), 'utf8'));
  assert.equal(PIN.manifest, evidence.amd64Digest);
  assert.equal(PIN.config, evidence.configDigest);
  assert.equal(PIN.compressedBytes, evidence.compressedLayerBytes);
  assert.equal(PIN.reference, 'docker.io/library/gcc@' + PIN.manifest);
  assert.equal(TOOL.sha256.length, 64);
  assert.ok(TOOL.url.startsWith('https://github.com/google/go-containerregistry/releases/download/v0.22.0/'));
});

test('错误索引、被修改的清单或配置不能生成已验证离线包', () => {
  const value = fixture();
  assert.equal(checkMetadata(value.index, value.manifest, value.config, value.pin).layers.length, 1);
  assert.throws(() => checkMetadata({ ...value.index, manifests: [] }, value.manifest, value.config, value.pin), { code: 'INDEX_MISMATCH' });
  assert.throws(() => checkMetadata(value.index, Buffer.concat([value.manifest, Buffer.from(' ')]), value.config, value.pin), { code: 'MANIFEST_HASH_MISMATCH' });
  assert.throws(() => checkMetadata(value.index, value.manifest, Buffer.concat([value.config, Buffer.from(' ')]), value.pin), { code: 'CONFIG_HASH_MISMATCH' });
  assert.throws(() => checkMetadata(value.index, value.manifest, value.config, { ...value.pin, version: '15' }), { code: 'PLATFORM_OR_VERSION_MISMATCH' });
});

test('检查实际层文件内容，不能只核对文件名和大小', async () => {
  const value = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-offline-test-'));
  const blobs = path.join(root, 'blobs'), shaDir = path.join(blobs, 'sha256');
  const written = [];
  function write(relative, content) { const file = path.join(root, relative); fs.writeFileSync(file, content, { flag: 'wx' }); written.push(file); }
  try {
    fs.mkdirSync(blobs); fs.mkdirSync(shaDir);
    write('oci-layout', bytes({ imageLayoutVersion: '1.0.0' }));
    write('index.json', bytes(value.index));
    for (const content of [value.manifest, value.config, value.layer]) write('blobs/sha256/' + hash(content).slice(7), content);
    await verifyLayout(root, value.pin);
    const layerFile = path.join(shaDir, hash(value.layer).slice(7));
    fs.writeFileSync(layerFile, Buffer.alloc(value.layer.length, 0));
    await assert.rejects(() => verifyLayout(root, value.pin), { code: 'LAYER_HASH_MISMATCH' });
    fs.writeFileSync(layerFile, value.layer);
    write('blobs/sha256/' + 'e'.repeat(64), 'unexpected');
    await assert.rejects(() => verifyLayout(root, value.pin), { code: 'UNEXPECTED_BLOB_FILES' });
  } finally {
    for (const file of written) fs.unlinkSync(file);
    fs.rmdirSync(shaDir); fs.rmdirSync(blobs); fs.rmdirSync(root);
  }
});

test('网络和认证错误只输出类别，不传播临时签名 URL 或认证信息', () => {
  assert.equal(safeToolError('Get https://example.org/?signature=secret: i/o timeout'), 'NETWORK_TIMEOUT');
  assert.equal(safeToolError('x509: certificate signed by unknown authority'), 'TLS_CONNECTION_ERROR');
  assert.equal(safeToolError('429 Too Many Requests'), 'REGISTRY_RATE_LIMIT');
  assert.equal(safeToolError('401 Unauthorized; Bearer secret'), 'REGISTRY_AUTH_REJECTED');
  assert.equal(safeToolError('secret-response-body'), 'DOWNLOAD_TOOL_FAILED');
});
