import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const frontendPackage = JSON.parse(fs.readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8'));
const lockBytes = fs.readFileSync(new URL('../package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const packages = {
  '@tigao/organizer-contracts': ['tigao-organizer-contracts-0.1.1.tgz', 'ac679b90be4e1016c2d1c4eb6694765029eef03765d74066b1f9cd276b8bfc6b', 'runtime'],
  '@tigao/organizer-core': ['tigao-organizer-core-0.1.1.tgz', '7952036f6b4098f430517d374d33231680f5c41ad51ce60793f96fb53a43bdf1', 'runtime'],
  '@tigao/organizer-react': ['tigao-organizer-react-0.1.1.tgz', '54bb393f406d8dbb21978e934a6b82ac0a021165470c664a5afd4e1d6536f936', 'runtime'],
  '@tigao/organizer-contract-tests': ['tigao-organizer-contract-tests-0.1.1.tgz', '11e5a2c4fbcab61a0d8d00329ed77bae835669f7b7a2201b010585b907fc2c71', 'development']
};

test('organizer 安装包固定在仓库 vendor 目录并保持发布 SHA256', () => {
  for (const [name, [file, digest]] of Object.entries(packages)) {
    const bytes = fs.readFileSync(new URL(`../frontend/vendor/organizer/${file}`, import.meta.url));
    assert.equal(sha256(bytes), digest, name);
  }
});

test('organizer 运行与测试依赖分区正确且锁文件只引用仓库内相对包', () => {
  for (const [name, [file, , kind]] of Object.entries(packages)) {
    const specifier = `file:vendor/organizer/${file}`;
    if (kind === 'runtime') { assert.equal(frontendPackage.dependencies[name], specifier, name); assert.equal(frontendPackage.devDependencies[name], undefined, name); }
    else { assert.equal(frontendPackage.devDependencies[name], specifier, name); assert.equal(frontendPackage.dependencies[name], undefined, name); }
    assert.equal(lock.packages[`node_modules/${name}`].resolved, `file:frontend/vendor/organizer/${file}`, name);
  }
  const text = lockBytes.toString('utf8');
  assert.doesNotMatch(text, /"resolved": "(?:git\+|https:\/\/github\.com\/[^"\n]*\/releases|https:\/\/api\.github)/i);
  assert.doesNotMatch(text, /file:[A-Za-z]:[\\/]/);
  assert.doesNotMatch(text, /teaching-prj-mgmt/i);
});
