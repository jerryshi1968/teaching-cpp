# C++ 作品管理共享化前的接口准备

## 文档用途

本文是后续 Codex 会话的实施说明。目标是在 `G:\teaching-cpp` 内完成 C++ 平台专属的接口准备，使未来的通用作品管理组件能够安全接入。

本阶段只修改 `teaching-cpp`。不要修改 `G:\teaching-p5js`，不要创建或实现 `teaching-prj-mgmt`，也不要提前实现完整的共享作品管理界面。

开始修改前必须先阅读仓库中的 `AGENTS.md`，并遵守其中的注释保留和最小修改要求。现有中文、英文、结构化及行尾注释均不得删除、精简或改写。

## 背景与现状

C++ 平台已经具备作品和多层作品组管理：

- `backend/src/app.mjs` 暴露作品、作品组及批量排序接口。
- `backend/src/service.mjs` 中的 `updateProject`、`updateGroup` 可以修改 `parent_id`。
- `backend/src/service.mjs` 中的 `reorder` 可以重排同一目录的全部作品或作品组。
- `backend/src/repository.mjs` 会对 `projects` 和 `project_groups` 自动附加 `project_type = 'cpp'` 条件。
- `frontend/src/App.jsx` 当前通过设置弹窗修改名称和所属作品组，通过单独的排序接口上下移动作品。

当前不足是：修改父作品组和重新编号排序是两种独立能力。未来拖放操作需要在一次请求、一次数据库事务中同时完成“移动父组”和“确定目标位置”，否则可能出现重复 `sort_order`、中间状态或部分成功。

## 本阶段目标

1. 增加 `repositionProject`。
2. 增加 `repositionGroup`。
3. 保证移动父组、清理源目录排序和写入目标目录排序在同一事务中完成。
4. 增加循环、跨类型、跨用户、回滚和并发测试。
5. 定义未来共享 React 组件需要的适配器接口，并实现 C++ 适配器的网络请求部分或可测试骨架。
6. 保持现有 C++ 页面、接口和功能兼容。

## 明确非目标

本阶段不要进行以下工作：

- 不修改 p5.js 项目。
- 不创建 Python 项目或 Python API。
- 不创建 `G:\teaching-prj-mgmt`。
- 不实现卡片式作品管理页、完整面包屑或拖放界面。
- 不安装 `@dnd-kit`、Tailwind 或其他共享 UI 依赖。
- 不共享 p5.js、C++ 或 Python 的作品组数据。
- 不增加由浏览器传入的 `project_type` 参数。
- 不改变 C++ 源码、运行、历史、分发和删除生命周期。
- 不删除现有 `PATCH` 或批量 `reorder` 接口。
- 不进行无关的格式化、重命名或代码清理。
- 不执行生产数据库迁移，不连接或修改生产数据。

## 后端接口契约

### 作品定位接口

新增：

```http
PUT /api/cpp/projects/:id/reposition
Content-Type: application/json

{
  "parentId": 12,
  "beforeId": "另一个作品的 UUID"
}
```

字段约定：

- `parentId` 必须显式提供，可以是正整数或 `null`；`null` 表示根目录。
- `beforeId` 必须显式提供，可以是合法作品 UUID 或 `null`；`null` 表示放到目标目录末尾。
- 非空 `beforeId` 必须属于当前用户、C++ 类型和目标目录，并且不能是被移动作品自身。
- 同目录内移动也使用这个接口。
- 成功返回 HTTP 200，响应至少包含 `repositioned: true`；建议同时返回移动后的项目摘要。

### 作品组定位接口

新增：

```http
PUT /api/cpp/groups/:id/reposition
Content-Type: application/json

{
  "parentId": 12,
  "beforeId": 18
}
```

字段约定：

- `parentId` 必须显式提供，可以是正整数或 `null`。
- `beforeId` 必须显式提供，可以是正整数或 `null`；`null` 表示放到目标目录末尾。
- 非空 `beforeId` 必须属于当前用户、C++ 类型和目标目录，并且不能是被移动作品组自身。
- 不能把作品组移动到自身或任何层级的子作品组中。
- 同目录内移动也使用这个接口。
- 成功返回 HTTP 200，响应至少包含 `repositioned: true`；建议同时返回移动后的作品组摘要。

### 推荐错误码

沿用现有错误体系，并补齐以下语义：

| 场景 | HTTP | 代码 |
| --- | ---: | --- |
| 源作品不存在、非本人或不是 C++ 类型 | 404 | `PROJECT_NOT_FOUND` |
| 源作品组不存在、非本人或不是 C++ 类型 | 404 | `GROUP_NOT_FOUND` |
| 目标父组不存在、跨用户或跨类型 | 400 | `INVALID_GROUP` |
| `beforeId` 不属于目标目录、跨用户、跨类型或指向自身 | 400 | `INVALID_BEFORE` |
| 把组移入自身或后代 | 400 | `GROUP_CYCLE` |
| ID、`parentId` 或 `beforeId` 格式错误 | 400 | 使用现有 `INVALID_ID`，或保持一致的专用错误码 |
| 生产写入未开放 | 503 | `WRITES_DISABLED` |

错误响应不得泄露其他用户或其他平台记录是否真实存在。

## 事务语义

`repositionProject` 和 `repositionGroup` 必须调用共享的内部定位逻辑，但对外保留两个明确方法；不能让请求方传入任意表名或 `project_type`。

一次定位操作应在同一个 `repo.transaction(...)` 中完成：

1. 验证源记录属于当前用户和 C++ 类型。
2. 读取并保存源 `parent_id`。
3. 验证目标父组属于当前用户和 C++ 类型。
4. 移动作品组时，沿目标父组向上遍历，拒绝自身或后代循环。
5. 按当前显示规则读取并稳定排序源目录和目标目录的同类兄弟记录。
6. 从兄弟列表中移除源记录。
7. 验证非空 `beforeId` 确实是目标目录中的兄弟记录。
8. 在 `beforeId` 前插入；`beforeId = null` 时追加到末尾。
9. 更新源记录的 `parent_id`。
10. 将受影响目录的 `sort_order` 重写为从 0 开始、连续且不重复的整数。
11. 跨目录移动时同时重写源目录和目标目录；同目录移动只重写一次。
12. 任意读取、验证或写入失败时回滚整个操作。

MySQL 实现继续依靠现有事务和 `cpp_queue_guard` 锁；内存仓库继续依靠现有事务串行机制。不要在 Service 外拆成多个事务，也不要由前端连续调用“移动”和“排序”来模拟原子操作。

建议只更新被移动记录的 `updated_at`，不要因为排序归一化而把所有兄弟记录标记成新近修改；若现有语义要求不同，需要在实现说明中明确记录。

## 与现有接口的兼容

必须保留：

- `PATCH /api/cpp/projects/:id`
- `PATCH /api/cpp/groups/:id`
- `PUT /api/cpp/projects/reorder`
- `PUT /api/cpp/groups/reorder`

兼容要求：

- 仅修改名称时，现有 `PATCH` 行为保持不变。
- 现有 C++ 页面提交的 `PATCH` 可能始终包含 `parentId`。当提交的父组与当前父组相同时，不得因为缺少 `beforeId` 而把记录移动到目录末尾。
- 当现有 `PATCH` 确实改变父组时，应复用新的事务内部逻辑并追加到目标目录末尾，避免旧页面绕过排序归一化。
- 批量 `reorder` 继续要求请求完整且只包含当前目录的全部同类兄弟记录；不能放宽现有校验。
- 新共享适配器使用显式 `reposition` 接口，不使用两个请求模拟移动和排序。

## 未来共享组件的适配器接口

本阶段不实现 React 管理组件，但要把组件与 C++ API 的边界定义清楚。建议使用纯 ESM 和 JSDoc 类型，避免为接口准备引入 TypeScript 构建链。

共享组件不应知道 `/api/cpp`、数据库字段、登录 Token、编辑器路由或 `project_type`。C++ 适配器负责把当前 API 转换成下面的规范形式。

### 规范数据结构

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

适配器内部完成 `parent_id -> parentId`、`sort_order -> sortOrder`、`updated_at -> updatedAt` 的转换，不能要求未来共享组件理解蛇形字段。

### 规范方法

```javascript
loadDirectory({ ownerId, parentId })
loadAllGroups({ ownerId })
createProject({ name, parentId, templateId })
createGroup({ name, parentId })
renameItem({ kind, id, name })
repositionItem({ kind, id, parentId, beforeId })
deleteItem({ kind, id })
openProject(id)
```

行为要求：

- `ownerId = null` 表示当前用户；查看学生时由 C++ 适配器转换为现有 `studentId` 查询参数。
- C++ 当前 `/workspace` 一次返回全部作品和作品组，适配器可以在本地生成当前目录内容和面包屑；不要为了接口准备改变现有读取 API。
- `loadAllGroups` 用于移动目标选择，可以与最近一次 `/workspace` 结果共享缓存，但不能返回其他用户或其他类型的数据。
- `kind` 只允许 `project` 或 `group`，并由适配器映射到固定接口；不能拼接未经白名单验证的任意路径。
- `openProject` 是宿主应用回调，不属于网络 API。C++ 将来通过现有 `openProject` 行为打开编辑器。
- 适配器必须把 `ApiError` 原样传播或转换为保留 `status`、`code` 和 `message` 的错误，供共享组件恢复乐观更新。

推荐新增独立的契约/适配器模块和单元测试，不要把这些定义继续塞入已经较大的 `frontend/src/App.jsx`。具体文件名可在遵守现有目录风格的前提下决定，并在交付说明中列出。

## 必须增加的测试

### Service 测试

在 `tests/service.test.mjs` 或独立测试文件中覆盖：

1. 作品在同一目录中前移、后移和追加到末尾。
2. 作品跨目录移动后，源目录和目标目录的 `sort_order` 都从 0 连续排列。
3. 作品组在同一目录和跨目录定位。
4. 作品组不能移入自身。
5. 作品组不能移入直接子组或更深层后代。
6. 当前用户不能移动其他用户的作品或作品组。
7. 当前用户不能把作品或作品组移入其他用户的组。
8. p5.js 类型记录不能作为 C++ 源记录、父组或 `beforeId`。
9. 非空 `beforeId` 必须处于目标目录中。
10. 操作中途抛错后，`parent_id` 和所有 `sort_order` 完整回滚。
11. 两个定位请求并发作用于同一目录后，记录不丢失、不重复，排序仍为连续整数；允许最终顺序对应任一合法串行执行结果。
12. 生产写入关闭时定位操作被拒绝且数据不变。

### HTTP 测试

在 `tests/api.test.mjs` 或独立测试文件中覆盖：

- 两个新路由存在并返回预期状态。
- 缺失 `parentId` 或 `beforeId` 时拒绝请求。
- `null` 与合法 ID 的解析正确。
- 非法 UUID、非法数字 ID 和数组形式 body 被拒绝。
- 跨用户、跨类型和非法 `beforeId` 不通过 HTTP 泄露记录。
- 响应格式能被 C++ 适配器消费。

### 适配器测试

使用假的 `request`/`api` 函数测试，不依赖浏览器或真实后端：

- URL、HTTP 方法和请求体映射正确。
- 作品与作品组走各自固定路径。
- 蛇形字段被规范化成驼峰字段。
- 能从完整 workspace 构建当前目录和从根到当前组的面包屑。
- 循环或损坏的父链不会导致无限循环，应返回可诊断错误。
- `ApiError` 的 `status`、`code` 和 `message` 不丢失。

## 建议修改范围

预计主要涉及：

- `backend/src/app.mjs`
- `backend/src/service.mjs`
- `backend/src/validation.mjs`，仅在确实需要公共的可空 ID 校验时修改
- `frontend/src/api.mjs`，仅在适配器需要复用公开请求函数时修改
- 新增一个独立的共享契约或 C++ 适配器模块
- `tests/service.test.mjs` 或新的定位测试文件
- `tests/api.test.mjs` 或新的 HTTP 定位测试文件
- 新增适配器单元测试
- `docs/api.md`，记录新增接口

除非现有设计无法满足要求，否则不要修改数据库迁移、Repository 表映射、运行器和部署脚本。

## 推荐实施顺序

1. 阅读 `backend/src/service.mjs`、`backend/src/repository.mjs`、`backend/src/app.mjs`、`frontend/src/App.jsx` 和现有测试。
2. 先写定位操作的 Service 测试，包括回滚和并发不变量。
3. 实现事务内部的通用定位逻辑以及两个明确 Service 方法。
4. 接入两个新 HTTP 路由并补 HTTP 测试。
5. 让旧 `PATCH` 的父组变更复用同一事务语义，同时保持同父组更新不改变排序。
6. 定义并测试 C++ 共享组件适配器接口。
7. 更新 `docs/api.md`。
8. 运行完整验证并检查没有意外修改。

## 验证命令

至少运行：

```powershell
npm test
npm run check
npm run build
git diff --check
git status --short
```

如某些检查依赖 Linux、MySQL、Podman 或生产凭据而无法在当前环境执行，必须明确说明哪些已经运行、哪些未运行以及原因；不能把未执行项目写成通过。

## 验收条件

只有同时满足以下条件才算完成本阶段：

- 两个显式 `reposition` 接口可用。
- 移动父组和重排在一个事务内完成。
- 源目录与目标目录排序均连续、无重复。
- 循环、跨用户、跨类型和非法排序参考均被服务端拒绝。
- 并发定位不会丢失记录或留下损坏排序。
- 中途失败能够完整回滚。
- 现有设置弹窗移动不会绕过新事务语义。
- 现有重命名、批量排序、保存、运行、教师只读和类别隔离测试继续通过。
- 已形成可由未来 `teaching-prj-mgmt` 使用的稳定适配器契约。
- 没有实现共享 UI，没有修改 p5.js，也没有扩大 `project_type` 的信任边界。

## 新会话交付说明要求

完成后，新会话应报告：

1. 修改了哪些文件。
2. 两个定位接口的最终请求与响应格式。
3. 事务、循环检测和并发处理的实现方式。
4. 旧接口如何保持兼容。
5. 适配器接口的实际文件位置和导出内容。
6. 新增了哪些测试场景。
7. 每条验证命令的真实结果。
8. 仍未验证的环境或生产事项。
