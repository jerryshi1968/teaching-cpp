import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const frontendPackage = JSON.parse(fs.readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8'));
const lockBytes = fs.readFileSync(new URL('../package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const packages = {
  '@tigao/organizer-contracts': ['tigao-organizer-contracts-0.1.0.tgz', '12fe52ed826cef07c49bba57d7a496db16605a4ee6b667d331f11788c4fcb3e3', 'runtime'],
  '@tigao/organizer-core': ['tigao-organizer-core-0.1.0.tgz', 'ec1735f27f792ed989c433a34cbe4f3fb0cab909494b3a9474575c5cebd045ca', 'runtime'],
  '@tigao/organizer-react': ['tigao-organizer-react-0.1.0.tgz', 'f105d43f02937228a94b018b37c997039eab6fefe37dbabc5f744482bc6b7e65', 'runtime'],
  '@tigao/organizer-contract-tests': ['tigao-organizer-contract-tests-0.1.0.tgz', '327a1cc924dbb58e9e635bc23eb38d8d43292d30809936b500889fdd078b68bd', 'development']
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
