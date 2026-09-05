import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const frontendPackage = JSON.parse(fs.readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8'));
const lockBytes = fs.readFileSync(new URL('../package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const packages = {
  '@tigao/organizer-contracts': ['tigao-organizer-contracts-0.1.2.tgz', 'e336838cc38802a3478c12a0a863cb793eb98b45aba3fd6bf2035e337b673006', 'runtime'],
  '@tigao/organizer-core': ['tigao-organizer-core-0.1.2.tgz', 'eae814cdb532ec76988cdfa0d2aa458f8bb5f81f09878303bddd0a20ff9bc341', 'runtime'],
  '@tigao/organizer-react': ['tigao-organizer-react-0.1.2.tgz', '5b15cb7702a2e12f8de85c6227df77ba9e90b31e586364f3a5bf9b7367dedcc3', 'runtime'],
  '@tigao/organizer-contract-tests': ['tigao-organizer-contract-tests-0.1.2.tgz', '160ccfbc74c4d0aa1dca201fa0d1e9ff78685d7a4dc55aa8f987ee2df162fdd0', 'development']
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
