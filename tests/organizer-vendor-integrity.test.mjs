import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const frontendPackage = JSON.parse(fs.readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8'));
const lockBytes = fs.readFileSync(new URL('../package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const packages = {
  '@tigao/organizer-contracts': ['tigao-organizer-contracts-0.1.3.tgz', '13b47ae7d882f1b4104ca00d6c539c8ebd7414c6538b591bc0aec1c2844c2bac', 'runtime'],
  '@tigao/organizer-core': ['tigao-organizer-core-0.1.3.tgz', '24c73ece1ad429f05afbee7a4e4a9583d51dd0350fb6566babb66f90e7c1ef5b', 'runtime'],
  '@tigao/organizer-react': ['tigao-organizer-react-0.1.3.tgz', 'bf4b69916140be0b1392ae2c1bff6cc132c38e7046947225c7599fd7bc0140f4', 'runtime'],
  '@tigao/organizer-contract-tests': ['tigao-organizer-contract-tests-0.1.3.tgz', 'ea82085f57bf1acfa7f4c94124132fa8fed833042d809a27e1881b8011e43cfd', 'development']
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
