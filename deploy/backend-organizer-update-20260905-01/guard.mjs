import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const VERSION = 'backend-organizer-update-20260905-01';
export const SOURCE_COMMIT = 'b7763ad6e0753b5a442bd6940c8829eeaaebcd56';
export const CURRENT_BACKEND_FILES = [
  { path: 'backend/src/app.mjs', sha256: 'f4bcbfd5dc8f542a6d31aa79df939eb6efd69072119e78cb0171e852c49acdd3', bytes: 5629 },
  { path: 'backend/src/service.mjs', sha256: 'cc7b561eae114f069493905b6a402aed919e7a26df55056a5f60b0e8d7ca59d5', bytes: 22492 }
];

export function assertBackendManifest(manifest) {
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.previousBackendSource, 'predeploy-20260830-02');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ['backend/src/app.mjs', 'backend/src/service.mjs']);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, manifest.files.length);
  for (const file of manifest.files) {
    const current = CURRENT_BACKEND_FILES.find(item => item.path === file.path);
    assert.ok(current);
    assert.equal(file.currentSha256, current.sha256);
    assert.equal(file.currentBytes, current.bytes);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  return manifest;
}

function ordinary(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.nlink === 1, `拒绝替换非普通文件：${file}`);
  return stat;
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeReplacement(target, bytes, stat, durable) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${VERSION}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(descriptor, bytes);
      if (process.platform !== 'win32') fs.fchownSync(descriptor, stat.uid, stat.gid);
      fs.fchmodSync(descriptor, stat.mode & 0o777);
      if (durable) fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    if (durable) syncDirectory(path.dirname(target));
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function installBackendFiles({ root, payloadRoot, backupRoot, manifest, durable = true, onPrepared = () => {} }) {
  const prepared = manifest.files.map(file => {
    const target = path.join(root, ...file.path.split('/'));
    const source = path.join(payloadRoot, ...file.path.split('/'));
    const previous = path.join(backupRoot, 'previous-backend', ...file.path.split('/'));
    const stat = ordinary(target);
    const bytes = fs.readFileSync(source);
    fs.mkdirSync(path.dirname(previous), { recursive: true, mode: 0o700 });
    fs.copyFileSync(target, previous, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(previous, 0o600);
    return { target, previous, stat, bytes };
  });
  onPrepared();
  for (const item of prepared) writeReplacement(item.target, item.bytes, item.stat, durable);
}

export function restoreBackendFiles({ root, backupRoot, manifest, durable = true }) {
  for (const file of manifest.files) {
    const target = path.join(root, ...file.path.split('/'));
    const previous = path.join(backupRoot, 'previous-backend', ...file.path.split('/'));
    const stat = ordinary(target);
    writeReplacement(target, fs.readFileSync(previous), stat, durable);
  }
}
