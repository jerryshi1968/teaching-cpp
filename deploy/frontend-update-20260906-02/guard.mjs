import assert from 'node:assert/strict';
import fs from 'node:fs';

export const VERSION = 'frontend-update-20260906-02';
export const SOURCE_COMMIT = '85143273cb613900112164885f27040e3f2913e9';
export const CURRENT_FRONTEND_FILES = [
  { path: 'index.html', sha256: 'bb4e171acdc9335bce83e93ed31d9ca5fe6cb55ef8983241915367dacb9c1eff', bytes: 730 },
  { path: 'assets/editor-CEb1qCln.js', sha256: 'a4f87f4e7e78487ae7c68129471f58fa0292f73b035260cb75a96e5fb7fe1ebb', bytes: 533408 },
  { path: 'assets/index-smUevea3.css', sha256: '72079e9a955e81b735f370c73a93fdde33feddad736947090f4e61a6b320ec54', bytes: 51863 },
  { path: 'assets/index-DfFosam-.js', sha256: '37c52dbad7c8bf390819524509e1cb72d848b6c91a3440f95421c5df717eafc9', bytes: 252608 }
];

export function assertFrontendManifest(manifest) {
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.previousRelease, 'frontend-update-20260906-01');
  assert.equal(manifest.files.length, 4);
  assert.equal(manifest.files.filter(file => file.path === 'index.html').length, 1);
  assert.equal(manifest.files.filter(file => /^assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(file.path)).length, 3);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, manifest.files.length);
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  return manifest;
}

export function assertSourceManifest(manifest) {
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.files.length, 6);
  assert.equal(new Set(manifest.files.map(file => file.path)).size, manifest.files.length);
  assert.deepEqual(manifest.files.map(file => file.path).sort(), [
    'frontend/package.json',
    'frontend/vendor/organizer/tigao-organizer-contract-tests-0.1.2.tgz',
    'frontend/vendor/organizer/tigao-organizer-contracts-0.1.2.tgz',
    'frontend/vendor/organizer/tigao-organizer-core-0.1.2.tgz',
    'frontend/vendor/organizer/tigao-organizer-react-0.1.2.tgz',
    'package-lock.json'
  ]);
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
  return manifest;
}

export function assertProductionConfig(config) {
  assert.equal(config.mode, 'production');
  assert.equal(config.writesEnabled, true);
  assert.equal(config.runEnabled, true);
  return config;
}

export function activateFrontend({ current, staging, previous }) {
  fs.renameSync(current, previous);
  try { fs.renameSync(staging, current); }
  catch (error) {
    fs.renameSync(previous, current);
    throw error;
  }
}

export function restoreFrontend({ current, previous, failed }) {
  fs.renameSync(current, failed);
  try { fs.renameSync(previous, current); }
  catch (error) {
    fs.renameSync(failed, current);
    throw error;
  }
}
