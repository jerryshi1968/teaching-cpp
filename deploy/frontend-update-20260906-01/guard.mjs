import assert from 'node:assert/strict';
import fs from 'node:fs';

export const VERSION = 'frontend-update-20260906-01';
export const SOURCE_COMMIT = '9d162431b8307bf4708c9248ecf88ce4584b5ffc';
export const CURRENT_FRONTEND_FILES = [
  { path: 'index.html', sha256: '1186299b3aeb3c82f18ff5003de5cfbe2caab0b0c0f0312d72461aeeeebbcc70', bytes: 730 },
  { path: 'assets/editor-CEb1qCln.js', sha256: 'a4f87f4e7e78487ae7c68129471f58fa0292f73b035260cb75a96e5fb7fe1ebb', bytes: 533408 },
  { path: 'assets/index-C9o3SXm9.css', sha256: 'b7e5337727c2baeb7c1f3e38bbeb6a070bd398a41e8d07fb6daa171724de9839', bytes: 50605 },
  { path: 'assets/index-BwsIe0m0.js', sha256: '91e22a210c3a60f87eb7bbf3a42369ab6206fd60810923655ed490e06f95249c', bytes: 247334 }
];

export function assertFrontendManifest(manifest) {
  assert.equal(manifest.release, VERSION);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.previousRelease, 'frontend-update-20260905-08');
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
    'frontend/vendor/organizer/tigao-organizer-contract-tests-0.1.1.tgz',
    'frontend/vendor/organizer/tigao-organizer-contracts-0.1.1.tgz',
    'frontend/vendor/organizer/tigao-organizer-core-0.1.1.tgz',
    'frontend/vendor/organizer/tigao-organizer-react-0.1.1.tgz',
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
