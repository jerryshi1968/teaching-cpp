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
  assert.match(appSource, /renderProjectExtraActions=\{item => <>/);
  assert.match(appSource, /organizer-language-badge">C\+\+ 魔法箱<\/span>/);
  assert.doesNotMatch(appSource, /<aside className=\{\x60sidebar/);
});

test('作品页沿用 p5.js 的教师看板、标题与创建入口', () => {
  assert.doesNotMatch(appSource, /<nav aria-label="主导航">/);
  assert.doesNotMatch(appSource, /page === 'classroom'/);
  assert.match(appSource, /班级学生作品督导看板/);
  assert.match(appSource, /当前班级：/);
  assert.match(appSource, /我（我的项目）/);
  assert.match(appSource, /🎨 我的创意工坊/);
  assert.match(appSource, /新建作品组/);
  assert.match(appSource, /动手做个新作品/);
  assert.match(appSource, /organizerAdapter\.createGroup/);
  assert.match(appSource, /organizerAdapter\.createProject/);
  assert.match(appSource, /organizer-distribute-button/);
});

test('作品工坊保持 p5.js 的混合卡片网格和桌面、平板、窄屏布局', () => {
  assert.match(organizerStyles, /\.organizer-page \{[\s\S]*linear-gradient\(180deg, #e0f2fe 0%, #eef2ff 52%, #fce7f3 100%\)/);
  assert.match(organizerStyles, /\.organizer-showcase \.tigao-organizer__content \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(organizerStyles, /\.organizer-showcase \.tigao-organizer__section,\s*\.organizer-showcase \.tigao-organizer__grid \{\s*display: contents/);
  assert.match(organizerStyles, /\.organizer-showcase \.tigao-organizer__create-panel \{\s*display: none/);
  assert.match(organizerStyles, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(organizerStyles, /@media \(max-width: 640px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(organizerStyles, /nth-child\(5n \+ 5\)/);
});

test('作品与作品组卡片按钮沿用 p5.js 的图标、顺序和状态并适当放大', () => {
  assert.match(appSource, /drag: props => <GripVertical size=\{20\}/);
  assert.match(appSource, /up: props => <ArrowUp size=\{20\}/);
  assert.match(appSource, /down: props => <ArrowDown size=\{20\}/);
  assert.match(appSource, /rename: props => <Pencil size=\{20\}/);
  assert.match(appSource, /move: props => <MoveRight size=\{20\}/);
  assert.match(appSource, /delete: props => <Trash2 size=\{20\}/);
  assert.match(appSource, /organizer-distribute-button[\s\S]*<Send size=\{20\}/);
  assert.match(organizerStyles, /\.organizer-showcase \.tigao-organizer__card-actions \{[^}]*gap: 4px;/);
  assert.match(organizerStyles, /\.organizer-showcase \.tigao-organizer__icon-button \{[^}]*width: 34px;[^}]*height: 34px;[^}]*min-height: 34px;[^}]*padding: 7px;/);
  assert.match(organizerStyles, /\.tigao-organizer__icon-button:disabled \{\s*opacity: 0\.3;/);
  assert.match(organizerStyles, /\.tigao-organizer__drag-handle \{\s*touch-action: none;/);
  assert.match(organizerStyles, /:nth-child\(5\):hover:not\(:disabled\) \{\s*background: #ecfdf5;\s*color: #10b981;/);
  assert.match(organizerStyles, /:nth-child\(6\):hover:not\(:disabled\) \{\s*background: #fff1f2;\s*color: #f43f5e;/);
  assert.match(organizerStyles, /@media \(max-width: 390px\)[\s\S]*\.tigao-organizer__icon-button \{\s*width: 34px;/);
});

test('拖放时卡片主体负责排序，独立下部区域负责移入作品组', () => {
  assert.match(organizerStyles, /\.tigao-organizer__nest-target \{[^}]*right: 26px;[^}]*bottom: 18px;[^}]*left: 26px;[^}]*height: 48px;/);
  assert.match(organizerStyles, /:has\(\.tigao-organizer__card--dragging\)[^\{]*\.tigao-organizer__card--group:not\(\.tigao-organizer__card--dragging\)[^\{]*\.tigao-organizer__nest-target \{\s*opacity: 0\.8;/);
  assert.match(organizerStyles, /\.tigao-organizer__card--dragging \.tigao-organizer__nest-target \{\s*display: none;/);
});
