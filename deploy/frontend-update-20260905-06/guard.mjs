import assert from 'node:assert/strict';
import fs from 'node:fs';

export const VERSION = 'frontend-update-20260905-06';
export const SOURCE_COMMIT = 'b7763ad6e0753b5a442bd6940c8829eeaaebcd56';
export const CURRENT_FRONTEND_FILES = [
  { path: 'index.html', sha256: '600cabe6fa6e76bdc3e869edf23db2355016c3b960d75f1c35d5570e1ef9a3d9', bytes: 730 },
  { path: 'assets/editor-CEb1qCln.js', sha256: 'a4f87f4e7e78487ae7c68129471f58fa0292f73b035260cb75a96e5fb7fe1ebb', bytes: 533408 },
  { path: 'assets/index-BAmvvGix.css', sha256: 'e558e389966b6733cfcc268268790f3c34d3d3901ab4fd8d38aeaa3195970258', bytes: 49548 },
  { path: 'assets/index-VtKVI9ll.js', sha256: '5eee2b93af4d82633c815f53f0ce91e9a89c9b7d199d76519b7a2a45fc7a36fa', bytes: 247045 }
];

export function assertFrontendManifest(manifest) {
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.previousRelease, 'frontend-update-20260905-05');
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
