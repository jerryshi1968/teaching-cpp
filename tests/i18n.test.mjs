import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, getExampleCopy, getOrganizerMessages, getProfileName, getStateLabel, localizeError, localizeServerMessage, normalizeLanguage, readLanguage, translate, writeLanguage } from '../frontend/src/i18n.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'App.jsx'), 'utf8');
const mainSource = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'main.jsx'), 'utf8');
const contextSource = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'i18n', 'LanguageContext.jsx'), 'utf8');
const selectorSource = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'i18n', 'LanguageSelect.jsx'), 'utf8');
const organizerStyles = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'organizer-overrides.css'), 'utf8');

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
}

test('C++ 语言设置使用独立存储项且非法值回退到中文', () => {
  assert.equal(LANGUAGE_STORAGE_KEY, 'cpp:language');
  assert.equal(DEFAULT_LANGUAGE, 'zh');
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('fr'), 'zh');
  const local = storage({ teaching_language: 'en' });
  assert.equal(readLanguage(local), 'zh');
  assert.equal(writeLanguage('en', local), true);
  assert.equal(local.values.get('cpp:language'), 'en');
  assert.equal(local.values.get('teaching_language'), 'en');
});

test('中英文目录、运行状态、编译配置和示例文案完整切换', () => {
  assert.equal(translate('zh', 'studio.mine'), '🎨 我的创意工坊');
  assert.equal(translate('en', 'studio.mine'), '🎨 My Creative Studio');
  assert.equal(translate('en', 'studio.supervising', { name: 'Ada' }), "📂 Reviewing [Ada]'s Projects");
  assert.equal(getOrganizerMessages('zh').moveDown, '向下排序');
  assert.equal(getOrganizerMessages('en').moveDown, 'Move Down');
  assert.equal(getOrganizerMessages('en').dropInside, 'Move into this group');
  assert.equal(getStateLabel('en', 'compile_error'), 'Compile Error');
  assert.equal(getProfileName('en', { id: 'cpp17', name: 'C++17 · 练习环境' }), 'C++17 · Practice Environment');
  const example = { id: 'sum', name: '两数之和', topic: '输入与输出', description: '读取两个整数。', code: 'int main() {}' };
  const english = getExampleCopy('en', example);
  assert.equal(english.name, 'Add Two Numbers');
  assert.equal(english.topic, 'Input and Output');
  assert.equal(english.code, example.code);
  assert.equal(example.name, '两数之和');
});

test('已知错误和运行消息翻译，未知服务内容保持原文', () => {
  assert.equal(localizeError('en', { code: 'VERSION_CONFLICT', message: '中文服务端信息' }), 'The code changed in another page. Your local draft is safe; reload and compare the versions.');
  assert.equal(localizeError('zh', { code: 'VERSION_CONFLICT', message: '中文服务端信息' }), '代码已在其他页面更新。本地草稿已保留，请重新载入后比较');
  assert.equal(localizeError('en', { code: 'FUTURE_ERROR', message: 'future detail' }), 'future detail');
  assert.equal(localizeServerMessage('en', '编译阶段未完成，未执行程序'), 'Compilation did not finish, so the program was not run.');
  assert.equal(localizeServerMessage('en', '程序退出码：7'), 'Program exit code: 7');
  assert.equal(localizeServerMessage('en', '自定义诊断详情'), '自定义诊断详情');
});

test('语言 Context 不重新挂载 App，并同步文档、跨标签页和可访问标签', () => {
  assert.match(mainSource, /<LanguageProvider><LocalizedErrorBoundary><App \/><\/LocalizedErrorBoundary><\/LanguageProvider>/);
  assert.doesNotMatch(mainSource, /<App key=/);
  assert.match(contextSource, /document\.documentElement\.lang = language === 'en' \? 'en' : 'zh-CN'/);
  assert.match(contextSource, /document\.title = translate\(language, 'document\.title'\)/);
  assert.match(contextSource, /event\.key === LANGUAGE_STORAGE_KEY/);
  assert.match(contextSource, /languageRef\.current = language/);
  assert.match(contextSource, /translate\(languageRef\.current, key, params\), \[\]/);
  assert.match(contextSource, /localizeError\(languageRef\.current, error\), \[\]/);
  assert.match(selectorSource, /aria-label=\{t\('language\.label'\)\}/);
  assert.match(appSource, /<LanguageSelect \/>/);
  assert.match(appSource, /configureApiLanguage\(language\)/);
  assert.match(appSource, /messages=\{organizerMessages\}/);
});

test('语言选择器适配登录页、桌面顶栏和窄屏，不覆盖动态内容', () => {
  assert.match(appSource, /className="connection-language"><LanguageSelect \/>/);
  assert.match(appSource, /className="topbar-right"><LanguageSelect \/>/);
  assert.match(appSource, /\{student\.username\}/);
  assert.match(appSource, /\{project\.name\}/);
  assert.match(appSource, /\{item\.message\}<\/button>/);
  assert.match(appSource, /run\[resultTab\]/);
  assert.match(organizerStyles, /\.language-select \{[\s\S]*min-height: 40px;/);
  assert.match(organizerStyles, /@media \(max-width: 640px\)[\s\S]*\.topbar-right \.language-select select \{[\s\S]*font-size: 10px;/);
});
