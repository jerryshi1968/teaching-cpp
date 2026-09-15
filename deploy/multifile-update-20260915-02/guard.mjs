import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const VERSION = 'multifile-update-20260915-02';
export const SOURCE_REVISION = '781c4a5ffacbe453bfec282665691def208e7eab';

const applicationPaths = [
  'backend/src/app.mjs',
  'backend/src/migrate.mjs',
  'backend/src/repository.mjs',
  'backend/src/service.mjs',
  'backend/src/source-store.mjs',
  'backend/src/validation.mjs',
  'backend/src/worker.mjs',
  'shared/contracts.mjs',
  'runner/src/app.mjs',
  'runner/src/podman.mjs'
];

export function assertReleaseManifest(manifest) {
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceRevision, SOURCE_REVISION);
  assert.equal(manifest.sourceState, 'working-tree');
  assert.equal(manifest.migration.id, '002_cpp_multifile');
  assert.equal(manifest.migration.path, 'backend/migrations/002_cpp_multifile.sql');
  assert.equal(manifest.migration.previousState, 'absent');
  assert.deepEqual(manifest.applicationFiles.map(file => file.path), applicationPaths);
  assert.equal(new Set(manifest.applicationFiles.map(file => file.path)).size, applicationPaths.length);
  assert.deepEqual(manifest.currentFrontendFiles.map(file => file.path).sort(), [
    'assets/editor-CEb1qCln.js', 'assets/index-CPdgUZBF.css', 'assets/index-CT-zWJjs.js', 'index.html'
  ]);
  assert.deepEqual(manifest.frontendFiles.map(file => file.path).sort(), [
    'assets/editor-CEb1qCln.js', 'assets/index-Cb3y0ve7.js', 'assets/index-DrAvf6w2.css', 'index.html'
  ]);
  for (const file of [...manifest.applicationFiles, manifest.migration, ...manifest.currentFrontendFiles, ...manifest.frontendFiles]) {
    assert.match(file.path, /^[A-Za-z0-9_./-]+$/);
    assert.ok(!path.isAbsolute(file.path) && !file.path.split('/').includes('..'));
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  for (const file of manifest.applicationFiles) {
    assert.match(file.currentSha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.currentBytes) && file.currentBytes > 0);
  }
  return manifest;
}

function ordinary(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, `拒绝替换非普通文件：${file}`);
  return stat;
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeReplacement(target, bytes, stat, durable) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${VERSION}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, 'wx', stat?.mode & 0o777 || 0o644);
  try {
    try {
      fs.writeFileSync(descriptor, bytes);
      if (stat && process.platform !== 'win32') fs.fchownSync(descriptor, stat.uid, stat.gid);
      fs.fchmodSync(descriptor, stat?.mode & 0o777 || 0o644);
      if (durable) fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    if (durable) syncDirectory(path.dirname(target));
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function installApplicationFiles({ root, payloadRoot, backupRoot, manifest, durable = true, onPrepared = () => {} }) {
  const prepared = manifest.applicationFiles.map(file => {
    const target = path.join(root, ...file.path.split('/'));
    const source = path.join(payloadRoot, ...file.path.split('/'));
    const previous = path.join(backupRoot, 'previous-application', ...file.path.split('/'));
    const stat = ordinary(target);
    const bytes = fs.readFileSync(source);
    fs.mkdirSync(path.dirname(previous), { recursive: true, mode: 0o700 });
    fs.copyFileSync(target, previous, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(previous, 0o600);
    return { target, stat, bytes };
  });
  const migrationTarget = path.join(root, ...manifest.migration.path.split('/'));
  assert.equal(fs.existsSync(migrationTarget), false, '新迁移文件已存在');
  const migrationBytes = fs.readFileSync(path.join(payloadRoot, ...manifest.migration.path.split('/')));
  onPrepared();
  for (const item of prepared) writeReplacement(item.target, item.bytes, item.stat, durable);
  writeReplacement(migrationTarget, migrationBytes, null, durable);
}

export function restoreApplicationFiles({ root, backupRoot, manifest, durable = true }) {
  for (const file of manifest.applicationFiles) {
    const target = path.join(root, ...file.path.split('/'));
    const previous = path.join(backupRoot, 'previous-application', ...file.path.split('/'));
    writeReplacement(target, fs.readFileSync(previous), ordinary(target), durable);
  }
  const migrationTarget = path.join(root, ...manifest.migration.path.split('/'));
  if (fs.existsSync(migrationTarget)) {
    ordinary(migrationTarget);
    fs.unlinkSync(migrationTarget);
    if (durable) syncDirectory(path.dirname(migrationTarget));
  }
}

export function activateFrontend({ current, staging, previous }) {
  assert.equal(fs.existsSync(previous), false);
  fs.renameSync(current, previous);
  fs.renameSync(staging, current);
}

export function restoreFrontend({ current, previous, failed }) {
  assert.equal(fs.existsSync(failed), false);
  fs.renameSync(current, failed);
  fs.renameSync(previous, current);
}
