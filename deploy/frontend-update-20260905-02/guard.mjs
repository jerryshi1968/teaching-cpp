import assert from 'node:assert/strict';
import fs from 'node:fs';

export const VERSION = 'frontend-update-20260905-02';
export const SOURCE_COMMIT = '065eaefe3edf1903891d77580b9def3bafab6453';
export const CURRENT_FRONTEND_FILES = [
  { path: 'index.html', sha256: '018c406fdfc75c686d7d36388680aa41236d8eef0b28dd99f39c7a540947a95d', bytes: 730 },
  { path: 'assets/editor-Do0j6OfF.js', sha256: 'ae12886af868b6baab2b8c468026843e786560500b69e57ff13f3a7613f8990a', bytes: 533408 },
  { path: 'assets/index-BSqUAhxx.js', sha256: 'ca4b840755b0a738534eebdf6cf07cc0a6e092b3635d833f67f8776f3481ebc9', bytes: 177943 },
  { path: 'assets/index-DK110m_B.css', sha256: 'e4dd408c0f4c18b460f2b2eb841315c39cc40880f4f98ebbb87ce520f6cc4cb3', bytes: 21526 }
];

export function assertFrontendManifest(manifest) {
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.previousRelease, 'web-publish-20260831-02');
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
    'frontend/vendor/organizer/tigao-organizer-contract-tests-0.1.0.tgz',
    'frontend/vendor/organizer/tigao-organizer-contracts-0.1.0.tgz',
    'frontend/vendor/organizer/tigao-organizer-core-0.1.0.tgz',
    'frontend/vendor/organizer/tigao-organizer-react-0.1.0.tgz',
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
