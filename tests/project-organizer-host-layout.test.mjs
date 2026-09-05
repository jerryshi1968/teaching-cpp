import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'App.jsx'), 'utf8');
const organizerStyles = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'organizer-overrides.css'), 'utf8');

test('C++ 宿主默认展示全宽作品工坊，并在作品与编辑器之间切换', () => {
  assert.match(appSource, /useState\('organizer'\)/);
  assert.match(appSource, /workspaceView === 'organizer' \? <main className="organizer-page">/);
  assert.match(appSource, /setWorkspaceView\('editor'\)/);
  assert.match(appSource, /返回作品工坊/);
  assert.match(appSource, /onCurrentParentIdChange=\{setFolderId\}/);
  assert.match(appSource, /renderProjectExtraActions=\{\(\) => <span className="organizer-language-badge">C\+\+ 创作<\/span>\}/);
  assert.doesNotMatch(appSource, /<aside className=\{\x60sidebar/);
});

test('作品工坊保持桌面三列、平板两列和窄屏单列布局', () => {
  assert.match(organizerStyles, /\.organizer-page \{[\s\S]*linear-gradient\(180deg, #e8f5ff 0%, #f1f1ff 52%, #fff0f7 100%\)/);
  assert.match(organizerStyles, /\.organizer-showcase \.tigao-organizer__grid \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(organizerStyles, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(organizerStyles, /@media \(max-width: 640px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(organizerStyles, /nth-child\(5n \+ 5\)/);
});
