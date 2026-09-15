# 原 p5.js 平台兼容变更范围与发布记录

本文件记录审查范围及发布进展。用户已于 2026-08-30 北京时间 21:38 回报正式库迁移和三个模型发布成功，p5.js 健康检查通过；原站浏览器回归、登录衔接和同源内容检查尚未全部完成。本地 `G:\teaching-p5js` 仍未改写，今后不能用其中旧模型覆盖服务器的已发布版本。以下准备阶段记录按发生顺序保留，以本段和部署指南的最新状态为准。

2026-08-31 北京时间 09:33，用户回报 C++ 只读网页发布成功，原站 HTTPS 页面和公共接口保持正常，两个后端未重启；浏览器截图确认 C++ 工作台加载并识别既有教师会话。随后用户明确确认原 p5.js 作品保存、预览正常，C++“我的课堂”的班级和学生展示正常。这些手工回归已经通过，不要求重复；仍不等于重新登录、跨班级拒绝、AI 和全部管理流程已验证。原 p5.js 学生作品的同源风险仍需审查，C++ 写入和执行保持关闭。

2026-08-30 部署进展：C++ 生产配置及 dbadmin 只读连接检查已通过，正式数据库尚未迁移。第 6 步 B 已通过：app.js 和 services/exampleService.js 同步后的内容、语法与本机一致；5080 配置正确、健康检查 HTTP 200、PM2 online、重启计数 67。三个核心 model 的线上基线均已对齐，补丁草稿位于 compat/p5js-20260830-01，17 项 SQLite 内存数据检查通过；类别隔离补丁尚未部署。该目录新增专用 MySQL 空库验证材料（MYSQL-VERIFICATION.md），16 组 MySQL 检查尚待服务器执行，HTTP 回归也未完成。该草稿不是可直接上线的部署包。参考清单 deploy/p5js-reference-20260830.sha256 和同步前线上记录 deploy/p5js-server-20260830.sha256 均不含配置值、密码或用户数据。

第 6 步 C 随后已完成：专用测试库 teachingcpp20260830test 为 utf8mb4 / utf8mb4_0900_ai_ci，表数 0；dbadmin 已获所需测试库权限，正式库权限未改变。当前按部署文档第 6 步 D 上传验证包并运行检查，尚无 MySQL 验证结果。验证包中的材料和校验值保持不变，不把建库成功写成迁移或隔离测试通过。

## 保持不变的内容

注册、密码规则、短信验证码、角色、班级码直接入班、公共用户管理、充值、余额、已有 p5.js 作品内容和目录。**不新增教师确认入班的环节。** C++ 首版不接入 AI，因此不修改现有 Token 扣费与流水业务。

## 审查范围与实际修改

路径均相对 `G:\teaching-p5js`。本次实际只发布 projectModel.js、projectGroupModel.js、fileModel.js 三个模型，原注释保持完整；下表其他控制器及路由已经做调用边界审查，不代表它们都需要或已经修改。自动回跳与前端入口为后续衔接事项。

| 文件/区域 | 具体变更 | 主要风险和验证方法 |
| --- | --- | --- |
| `backend/models/projectModel.js` | p5 专属列表、ID 详情、统计、创建、更新、删除、复制、分发、排序均固定 `project_type='p5js'`；创建显式类别 | 用同一用户的 cpp 和 p5 项目交叉请求，cpp 必须 404/拒绝，旧项目行为不变 |
| `backend/models/projectGroupModel.js` | 作品组固定类别；父组、后代、排序参考项须同用户同类别；禁止跨类移动/级联删除 | cpp 项目组不能出现在旧面包屑、计数、递归删除、排序更新中 |
| `backend/models/fileModel.js` 及 `backend/controllers/fileController.js` | 按 fileId 或 projectId 操作之前，都联查项目类别和用户/教师权限 | 猜中 cpp 文件 ID 也不能读、写、重命名、上传、删除；禁止只检查前端文件后缀 |
| `backend/controllers/projectController.js`、`projectGroupController.js` | 复制、分发、批量操作统一调用受类别保护的查询；不得跨平台建立错误父组关系 | 模板仍生成原来的 p5.js 文件，原作品内容不变 |
| `backend/controllers/exampleController.js` | 示例读取和导入目标限定 p5js | 不把 HTML/JS/CSS 导入 cpp 项目，不改变原示例 |
| `backend/controllers/aiController.js` | AI 读写上下文限定 p5js；不能通过旧 AI 接口修改 cpp 代码 | 传入 cpp projectId 拒绝，不扣费；原 p5 AI 流程和计费回归 |
| `backend/controllers/adminController.js`、`frontend/src/pages/Admin.jsx` | 项目管理首版仍默认只处理 p5js；列表、总数、搜索、操作使用同范围 | cpp 项目不能进入旧编辑器；公共用户管理保持共用 |
| `backend/routes/projects.js`、`projectGroups.js`、`files.js`、`examples.js`、`ai.js`、`admin.js` | 审计所有入口确实经过类别检查，不新增通用任意 project_type 参数 | 特别检查按 ID、嵌套及批量接口，不仅验证列表 |
| `frontend/src/pages/Login.jsx` | 加入严格白名单返回地址支持；允许 `/teaching-cpp/` 与现有站内固定入口，拒绝外部 URL、`//host` 等 | 保留原默认 `/dashboard` 导航和注释；绝不把令牌放 URL |
| `frontend/src/pages/Dashboard.jsx`、公共管理入口 | 可增加明确“返回 C++”入口，保持 p5 原默认导航 | 不改变注册/班级业务，学生和教师返回后由 C++ 后端重新验证身份 |

当前 C++ 已提供无侵入衔接：打开原登录页的新标签，用户登录后回到 C++，通过同源 `teaching_token`、页面聚焦/存储变更和后端 `/api/auth/me` 完成重新核验。上表的白名单返回功能用于完善方案要求的自动回跳；当前不是已改好的自动跳转。

## 数据库迁移

新增 `projects.project_type` 和 `project_groups.project_type`，非空、默认 `p5js`；原记录按默认值归类。新增联合索引，以及 C++ 专用源码索引、历史版本、运行、分发和队列锁表。共用 `files` 记录 C++ 当前项目完整文件树的元信息，所有读写均通过 `projects.project_type = 'cpp'` 限定；代码正文仍只存放于独立 C++ SourceStore 的不可变项目快照中。

原 p5 项目仍以默认值兼容创建，但**旧查询不会因字段存在而自动隔离**。须先部署已审查的旧平台过滤补丁，随后才能将 C++ 的 `CPP_PRODUCTION_WRITES` 设置为 `enabled-after-p5js-review`。

数据库权限不是按项目类别隔离的；业务账号对共享项目表拥有必要读写权限，类别防线依赖服务端受测逻辑。执行服务不拥有任何数据库权限。

## 同源学生作品风险

两平台采用同域名不同路径，浏览器同源权限并不按路径隔离。只读调查发现原服务使用 `/teaching-p5js/projects` 提供学生作品静态资源；还应检查发布中的预览 iframe 沙箱标志及直接打开作品 URL 的行为。

2026-08-31 进一步只读审查本地原项目：`frontend/src/pages/EditorView.jsx` 使用同域名作品 URL，iframe 同时设置 `allow-scripts allow-same-origin`，“独立大视窗”直接打开该 URL；`frontend/src/services/api.js` 从同源 localStorage 的 `teaching_token` 读取登录令牌。按 [HTML 标准](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)，这个 iframe 组合不能作为同源不可信脚本的隔离边界。它说明风险路径存在，不证明线上没有另外设置保护，也不是已发现账号泄露。用户随后回报一个线上作品样本为 HTTP 200、text/html，未返回 CSP 响应头；该项只读核查已完成，原项目代码未修改。四组本地浏览器比较及后续预览子域名方案见 [作品预览隔离说明](preview-isolation.md)。隔离修正尚未发布。

不能只删 iframe 的 `allow-same-origin` 就宣布修复：直接打开作品仍须保护，而且原编辑器 `handleIframeLoad` 直接访问预览文档，隔离方案须评估其功能影响。作品上的 [CSP sandbox 响应头](https://www.w3.org/TR/CSP3/#directive-sandbox) 与独立作品来源可作为后续方案评估；当前未修改 Apache、预览行为或登录方式。

如果学生上传的脚本能在主站同源环境执行，它可能访问共同登录状态。仅在编辑器 iframe 上加沙箱，不能自动保护直接访问的作品 URL。公开 C++ 执行前应审查并隔离不可信作品内容，例如独立无凭据静态域名配合受限预览。这不是已经修复的事项，不能以 C++ 页面自身的 CSP 代替整站审查。

## 回归验收

使用独立测试库中的两个班级、两个教师、三个学生，给同一学生各建一个 p5 项目和 cpp 项目，以及两类作品组。检查：

1. 各平台列表、统计、面包屑只显示自己的类别。
2. 交叉传入项目/文件/作品组 ID，所有读取和写入均拒绝。
3. 创建、重命名、移动、排序、复制、分发、删除不影响另一类记录或磁盘文件。
4. p5 运行仍打开原 HTML，AI 仍使用原文件协议，扣费次数不变。
5. 学生换班后，原教师立即失去查看权限；新教师可查看。加入班级仍只使用原班级码。
6. 登录返回地址只能是白名单，过期或伪造令牌不能访问 C++ API；余额只有一份。
7. 去掉 C++ 反向代理并停止 C++ 服务后，原平台仍能完整工作。

用户已执行正式发布包：日志位于 `/var/www/teaching-cpp-backend/logs/production-publish-oavQgG6L.log`，维护备份位于 `/var/www/teaching-cpp-backend/backups/first-publish-xoptT8`。原表记录比较通过；真实 MySQL 16 项检查此前在独立虚拟测试库通过。C++ 写入和执行仍关闭，原站完整浏览器回归及上述剩余事项不能视为已经完成。
