# `teaching-prj-mgmt` 通用作品管理项目创建说明

## 文档用途

本文是新 Codex 项目的完整实施说明。请在一个新的、独立的 Codex 项目中创建通用作品管理代码，目标目录为：

```text
G:\teaching-prj-mgmt
```

该项目以 p5.js 当前作品管理方式作为交互行为参考，以已经完成接口准备的 C++ 平台作为第一个实际接入者，并为未来 Python 教学平台保留相同的接入方式。

新项目必须独立开发和测试。不要读取、导入、链接或修改 `G:\teaching-cpp`、`G:\teaching-p5js` 及未来 Python 项目的源码；本文已经包含本阶段所需的行为和接口信息。

## 项目定位

`teaching-prj-mgmt` 是一个可复用、可版本化的前端组件和领域规则仓库，不是第三个教学网站，也不是统一后端服务。

项目应包含四个职责清晰的工作区包：

```text
organizer-contracts
organizer-core
organizer-react
organizer-contract-tests
```

推荐 npm 包名：

```text
@tigao/organizer-contracts
@tigao/organizer-core
@tigao/organizer-react
@tigao/organizer-contract-tests
```

根项目使用 npm workspaces 管理四个包。初始版本统一为 `0.1.0`。在用户明确决定发布方式前，所有包保持私有，不向公共 npm 注册表发布。

## 强制边界

所有运行时代码必须满足以下要求：

- 不包含 `/api/cpp`、`/api/projects`、`/api/project-groups` 等固定业务地址。
- 不读取或写入 `teaching_token`、Cookie、localStorage 或其他宿主登录状态。
- 不包含、接受或选择 `project_type`。
- 不直接调用 `fetch`；所有数据操作必须通过宿主注入的适配器完成。
- 不决定编辑器路由；打开作品通过适配器的 `openProject` 回调完成。
- 不处理 p5.js 文件、C++ 编译运行或 Python 解释执行。
- 不处理班级和学生选择器；宿主只需传入当前 `ownerId`。
- 不处理作品源码、预览、历史版本、AI、分发和运行结果。
- 不使用跨仓库相对路径、目录联接、符号链接、Git submodule 或 `file:../teaching-*` 依赖。
- 不要求三个教学平台同时升级；公共包必须支持按版本独立接入和回滚。

增加自动化源码边界检查：扫描四个包的运行时源码，如果出现上述固定 API、登录键、`project_type` 或业务仓库绝对路径，应使测试失败。README 中用于解释边界的文字不纳入该扫描。

## 推荐目录结构

可在不改变四个包职责的前提下调整构建工具和少量文件名：

```text
G:\teaching-prj-mgmt
  AGENTS.md
  README.md
  package.json
  package-lock.json
  .gitignore
  packages/
    organizer-contracts/
      package.json
      src/
      test/
    organizer-core/
      package.json
      src/
      test/
    organizer-react/
      package.json
      src/
      test/
    organizer-contract-tests/
      package.json
      src/
      test/
  examples/
    playground/
```

`examples/playground` 是仅供本地开发和视觉验证的假数据页面，不是需要部署的网站。它不得连接任何教学平台或真实账号。

## 包依赖方向

依赖必须保持单向，不得形成循环：

```text
organizer-contracts
        ↑
organizer-core
        ↑
organizer-react

organizer-contract-tests → organizer-contracts + organizer-core
```

具体要求：

- `organizer-contracts` 不依赖 React、DOM、网络库或其他三个包。
- `organizer-core` 只依赖 `organizer-contracts`，不依赖 React、DOM 或浏览器全局对象。
- `organizer-react` 依赖 `organizer-core` 和 `organizer-contracts`。
- `organizer-contract-tests` 提供宿主适配器可复用的测试套件；不得依赖任何真实教学平台。
- React 和 ReactDOM 应作为 `organizer-react` 的 peer dependencies，避免宿主出现两份 React。
- 拖放可以使用 `@dnd-kit/core`、`@dnd-kit/sortable` 和 `@dnd-kit/utilities`，由 `organizer-react` 自己声明依赖。
- 不固定依赖某个版本的 `lucide-react`。图标通过插槽传入，或提供不依赖外部图标库的简单默认呈现。

## `organizer-contracts`

该包定义稳定的规范数据结构、适配器接口、错误形状和运行时校验。使用纯 ESM 和 JSDoc 类型，不要求业务项目引入 TypeScript 构建链。

### 规范数据结构

以下结构已经与 C++ 第一版适配器一致，不要擅自重命名字段：

```javascript
ProjectSummary = {
  kind: 'project',
  id: string,
  name: string,
  parentId: number | null,
  sortOrder: number,
  updatedAt: string | null
}

GroupSummary = {
  kind: 'group',
  id: number,
  name: string,
  parentId: number | null,
  sortOrder: number,
  updatedAt: string | null
}

DirectoryResult = {
  projects: ProjectSummary[],
  groups: GroupSummary[],
  breadcrumbs: GroupSummary[],
  owner: { id: number, username: string } | null,
  readOnly: boolean
}
```

约束：

- `ProjectSummary.id` 是非空字符串；当前 C++ 使用 UUID，但公共组件不校验具体 UUID 格式。
- `GroupSummary.id` 是正整数。
- `parentId` 只能指向作品组，`null` 表示根目录。
- `sortOrder` 必须是有限、非负整数。
- `updatedAt` 允许为 `null`；公共排序不得依赖它才能正确工作。
- `kind` 必须保留，以避免作品字符串 ID 与作品组数字 ID 混淆。

### 适配器接口

公共组件只依赖下面八个方法：

```javascript
loadDirectory({ ownerId = null, parentId = null })
loadAllGroups({ ownerId = null })
createProject({ name, parentId = null, templateId })
createGroup({ name, parentId = null })
renameItem({ kind, id, name })
repositionItem({ kind, id, parentId, beforeId })
deleteItem({ kind, id })
openProject(id)
```

返回值：

- `loadDirectory` 返回 `DirectoryResult`。
- `loadAllGroups` 返回完整的 `GroupSummary[]`，用于构建移动目标路径。
- `createProject` 返回 `ProjectSummary`。
- `createGroup` 返回 `GroupSummary`。
- `renameItem` 返回对应的规范化项目或作品组。
- `repositionItem` 返回 `{ repositioned: true, item }`。
- `deleteItem` 至少返回 `{ deleted: true }`。
- `openProject` 的返回值由宿主决定，公共组件不得假设其类型。

参数语义：

- `ownerId = null` 表示当前登录用户。
- `templateId` 可省略；不同平台可以将其解释为示例、模板或默认项目。
- `kind` 只能是 `project` 或 `group`。
- `repositionItem` 中的 `parentId` 和 `beforeId` 必须显式存在。
- `parentId = null` 表示移动到根目录。
- `beforeId = null` 表示追加到目标目录末尾。
- 非空 `beforeId` 必须是目标目录内同种类型的兄弟记录。

### 错误契约

适配器可以抛出任何 `Error` 子类，但公共组件至少识别并保留：

```javascript
{
  message: string,
  code?: string,
  status?: number
}
```

组件不能依赖 C++ 专属错误类的 `instanceof`。任何写操作失败时都要恢复本地乐观更新，并把原始错误交给 `onError` 或默认错误呈现。

建议导出运行时断言函数，用于验证：

- 适配器八个方法齐全。
- 目录结果及项目、作品组摘要形状合法。
- 不存在重复的同类 ID。
- 面包屑从根到当前组排列，最后一个组等于当前 `parentId`。

## `organizer-core`

该包只包含不可变、确定性的纯函数。相同输入必须产生相同输出，不读取时间、随机数、DOM、Storage 或网络。

至少提供以下能力，函数名可合理调整，但需要在 README 中逐项映射：

1. 比较和排序规范项目、作品组。
2. 按 `parentId` 列出当前目录。
3. 从完整作品组树构建根到当前组的面包屑。
4. 检测父链缺失、循环和重复 ID，不能无限遍历。
5. 计算某作品组的全部后代。
6. 生成合法移动目标，作品组移动时排除自身及全部后代。
7. 将作品组路径格式化为 `上级 / 子级 / 当前组`。
8. 计算同目录前移、后移及拖动后的 `beforeId`。
9. 对规范化的本地快照应用一次不可变 `reposition`，支持乐观更新。
10. 为作品和作品组生成不会冲突的拖放 ID，并安全解析。

排序规则：

- 作品和作品组属于两个独立排序序列，不能混成一个 `beforeId` 序列。
- 先按 `sortOrder` 升序，再使用稳定输入顺序或稳定 ID 作为平局规则。
- 本地定位完成后，受影响目录的 `sortOrder` 应归一化为从 0 开始的连续整数。
- 所有函数不得原地修改调用方传入的数组或对象。

核心包要覆盖深层树、根目录、空目录、损坏父链、循环、同名组、字符串与数字 ID 混合等边界测试。

## `organizer-react`

该包实现通用的作品管理组件和状态 Hook，不包含任何业务平台代码。

### 建议公开入口

```javascript
ProjectOrganizer
useProjectOrganizer
```

可以按职责拆出内部组件，但不要在第一个版本暴露大量不稳定的公共 API。

### 组件输入

建议至少支持：

```javascript
<ProjectOrganizer
  adapter={adapter}
  ownerId={ownerId}
  currentParentId={currentParentId}
  onCurrentParentIdChange={setCurrentParentId}
  messages={messages}
  icons={icons}
  onError={onError}
  renderProjectExtraActions={renderProjectExtraActions}
/>
```

要求：

- `adapter` 严格遵守 `organizer-contracts`。
- 当前目录采用受控状态；组件不直接保存 localStorage。
- 宿主可以通过 `messages` 提供中文、英文或平台术语，运行时代码不得硬编码“C++”“p5.js”或“Python”。
- 图标和额外操作使用可选插槽，基础功能在不传插槽时仍可使用。
- `readOnly` 以 `loadDirectory` 返回值为准；只读状态隐藏或禁用所有写操作，但允许进入作品组和打开作品。
- 宿主切换 `ownerId` 时应取消或忽略旧请求结果，并回到宿主提供的目录状态。
- 组件卸载后不得继续更新状态。

### p5.js 行为参考

第一个版本应实现以下交互，而不是复制某个业务页面的布局外壳：

- 根目录和完整祖先面包屑均可点击进入。
- 作品组卡片显示在作品卡片之前。
- 点击作品组进入该组；点击作品调用 `adapter.openProject(id)`。
- 在当前目录新建作品组和作品。
- 作品和作品组均支持重命名、移动和删除。
- 作品组和作品各自支持上移、下移，按钮同时作为拖放的无障碍替代操作。
- 同类卡片支持拖放排序。
- 作品可以拖入当前页面中的作品组。
- 作品组可以拖入另一个合法作品组。
- 项目或作品组可以拖到祖先面包屑或根目录。
- 移动弹窗通过 `loadAllGroups` 显示完整路径，并在前端隐藏作品组自身及全部后代。
- 拖放或移动期间禁用重复提交。
- 乐观更新失败时恢复原列表并显示适配器错误。
- 服务端响应成功后使用返回项更新本地状态；无法可靠合并时重新加载当前目录。
- 删除只负责请求确认和显示服务端结果；“只能删除空组”仍由服务端最终判定。

### 本阶段功能边界

共享组件内的新建作品只处理通用名称和可选 `templateId`。复杂的模板选择、复制、课堂分发、搜索、平台顶部导航和教师班级选择留给宿主；通过插槽或后续兼容扩展加入，不应阻塞第一版。

### 样式要求

- 不使用 Tailwind 类名，提供独立 CSS 文件。
- 所有选择器使用统一命名空间，禁止修改 `body`、`button`、`dialog` 等全局元素样式。
- 颜色、圆角、间距、阴影和卡片密度通过 CSS 自定义属性覆盖。
- 默认视觉可以参考 p5.js 的卡片、文件夹和清晰面包屑，但不得包含 p5.js 品牌名称或固定页面背景。
- 支持窄屏、键盘焦点、触摸拖放和 `prefers-reduced-motion`。
- 每个图标按钮都有可理解的 `aria-label` 和 `title`。
- 拖放不是唯一操作路径；上移、下移和移动弹窗必须可用。

### 状态和竞态

- 使用递增请求序号或等价机制忽略过期的 `loadDirectory` 响应。
- 同一项正在写入时禁止再次重命名、移动或删除。
- 切换目录时清理不再适用的拖动和弹窗状态。
- 加载、空目录、错误、只读和保存中状态均应有明确呈现。
- 发生 `INVALID_GROUP_TREE` 等结构错误时停止可能造成进一步损坏的写操作，但仍允许宿主接收错误并决定重试。

## `organizer-contract-tests`

该包提供可由 C++、p5.js 和 Python 适配器重复使用的行为测试套件，不测试具体 URL。

建议导出类似下面的测试注册函数；具体名称可以调整：

```javascript
runProjectOrganizerAdapterContract({
  test,
  assert,
  createHarness
})
```

`createHarness` 应为每个测试创建隔离的假用户、组和作品，并返回适配器及可观察状态。测试套件至少验证：

1. 当前用户和指定 `ownerId` 的目录读取。
2. 根目录、深层目录及面包屑顺序。
3. `loadAllGroups` 返回完整规范树。
4. 创建作品和作品组。
5. 两种类型的重命名。
6. 同目录和跨目录定位，包含 `beforeId = null`。
7. 作品组不能移入自身或后代。
8. 删除项目和空作品组。
9. 只读拥有者拒绝写入。
10. 任意适配器错误的 `message`、`code` 和 `status` 不丢失。
11. 非法 `kind`、重复 ID、损坏父链和循环能够诊断。
12. 操作失败后测试夹具状态不应出现半完成移动。

共享项目自身使用一个完全内存化的参考适配器运行整套契约测试。该适配器只用于测试和 playground，不作为生产后端实现。

宿主仍需保留自己的 URL 映射测试。例如 C++ 已有的路径和请求体测试属于 C++ 仓库，不迁入本项目。

## C++ 第一个接入者的既有契约

C++ 已经完成适配器准备。共享项目必须兼容本文件前述八个方法和规范数据结构。以下信息仅用于确定公共契约，不能写成共享运行时代码中的固定地址：

- C++ 读取接口一次返回该拥有者的全部作品和作品组；其适配器会筛选当前目录并构建面包屑。
- C++ 适配器会缓存最近一次完整读取，供 `loadAllGroups` 复用。
- C++ 适配器将数据库蛇形字段转换成本文的驼峰字段。
- C++ 的 `repositionItem` 成功返回 `{ repositioned: true, item }`。
- C++ 的项目 ID 是字符串，作品组 ID 是数字。
- C++ 适配器原样传播带 `status`、`code` 和 `message` 的错误。

不要在本项目中实现 `CppProjectOrganizerAdapter`，也不要复制 C++ 网络适配代码。它已经并且应继续归属于 C++ 宿主仓库。

## 本地 playground

创建一个最小本地示例，用内存适配器展示和手工验证：

- 根目录、两层以上嵌套组及多个作品。
- 创建、重命名、删除。
- 同目录排序和跨目录移动。
- 面包屑返回上级和根目录。
- 可编辑与只读两种模式切换。
- 可切换的模拟错误，包括移动失败和损坏组树。
- 窄屏布局。

playground 不需要登录、后端、持久化或部署。刷新后重置假数据是预期行为。

## 测试要求

### contracts

- 合法与非法数据结构验证。
- 八个适配器方法完整性。
- 字符串项目 ID 和数字作品组 ID 不混淆。
- 错误对象字段保留。

### core

- 目录筛选、稳定排序和连续排序编号。
- 深层面包屑。
- 缺失父组和循环检测。
- 后代集合及合法移动目标。
- 同目录、跨目录和末尾定位。
- 不可变性：输入对象和数组不得改变。
- 拖放 ID 的生成、解析和非法输入。

### react

- 加载、空目录、错误和只读呈现。
- 点击组、面包屑和项目。
- 新建、重命名、移动和删除调用正确的适配器方法。
- 上移和下移产生正确的 `beforeId`。
- 写入期间禁止重复操作。
- 失败后回滚并调用 `onError`。
- 快速切换目录时忽略过期响应。
- 所有操作按钮具备可访问名称。
- 拖放主要状态转换可由 core 测试覆盖；React 测试至少验证拖放结果会调用一次规范的 `repositionItem`。

### contract-tests

- 使用内存适配器运行完整公共契约。
- 确认测试夹具之间互不污染。
- 确认宿主可以注入 Node 内置测试或项目选定的测试注册函数，不强绑某个业务仓库。

## 构建与打包

要求：

- 发布产物为 ESM，浏览器运行时代码不依赖 Node 内置模块。
- React 包不内联第二份 React。
- CSS 作为明确的导出文件提供。
- `package.json` 的 `exports`、`files` 和类型/JSDoc入口准确。
- 源码映射可用于本地调试，但不得包含业务仓库源码。
- 根目录提供统一的 `test`、`check`、`build` 和打包检查命令。
- 对每个准备发布的包执行 `npm pack --dry-run` 或等价检查，确认测试夹具、playground 和临时文件不会进入运行时包。
- 不执行 `npm publish`，除非用户之后明确授权。

README 至少说明：

- 四个包的职责和依赖关系。
- 完整适配器接口。
- `ProjectOrganizer` 最小使用示例，使用假的 URL 无关适配器。
- CSS 引入和主题变量。
- 宿主如何保存当前目录状态。
- 宿主如何增加额外项目操作。
- 版本兼容和未来接入 C++、p5.js、Python 的顺序。
- 本项目不提供鉴权、后端和跨平台共享作品组。

## 建议实施顺序

1. 初始化独立 Git 仓库和 npm workspace；如果目录已存在，先确认其中没有用户文件，禁止覆盖未知内容。
2. 创建根 `AGENTS.md`，记录本文件中的跨仓库隔离、API 无关、最小公共 API 和验证要求。
3. 实现并测试 `organizer-contracts`。
4. 实现并测试 `organizer-core`。
5. 创建内存参考适配器和 `organizer-contract-tests`。
6. 实现 `useProjectOrganizer`，先完成数据加载、目录导航和写操作状态。
7. 实现 `ProjectOrganizer`、独立 CSS 和无障碍按钮。
8. 接入拖放及其上移、下移、移动弹窗替代路径。
9. 创建本地 playground，完成桌面和窄屏视觉检查。
10. 完善 README、exports 和打包配置。
11. 运行完整验证和源码边界扫描。

## 验证命令

根项目至少提供并成功运行：

```powershell
npm test
npm run check
npm run build
npm run pack:check
git diff --check
git status --short
```

如果 UI 测试、浏览器测试或打包工具使用不同命令，应将其包含在上述根脚本中。不得连接真实教学平台、生产 API 或生产数据库来完成验证。

## 验收条件

只有同时满足以下条件才算完成第 2 步：

- 四个工作区包均已创建，职责与依赖方向清晰。
- 公共契约与 C++ 已实现的八方法适配器兼容。
- core 完全独立于 React、DOM、Storage 和网络。
- React 组件只通过适配器读写数据。
- 已实现 p5.js 风格的目录、面包屑、卡片、排序和移动交互。
- 拖放、按钮和移动弹窗三种路径使用同一个 `repositionItem` 语义。
- 只读、加载、空目录、错误、保存中及失败回滚状态完整。
- 没有固定业务 API、登录状态、`project_type` 或业务仓库依赖。
- 共享契约测试能由未来三个宿主重复使用。
- 内存适配器和 playground 可以独立演示主要行为。
- 所有测试、检查、构建和打包检查通过。
- 未修改任何业务仓库，未发布到公共注册表，也未部署网站。

## 新会话交付说明要求

完成后，新会话应报告：

1. 最终目录结构及每个包的职责。
2. 实际导出的公共 API。
3. 适配器接口是否与本文完全一致；若有偏差，说明原因和迁移影响。
4. core 的树、排序、移动及错误检测规则。
5. React 组件支持的交互、插槽、主题和无障碍方式。
6. contract-tests 的宿主接入方法。
7. playground 的启动方式和已完成的视觉检查。
8. 每条验证命令的真实结果。
9. 打包产物的名称、版本和内容检查结果。
10. 仍未验证或留待 C++ 接入阶段完成的事项。
