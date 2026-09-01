# C++ API 与数据约定

业务前缀 `/api/cpp`。除 `/config`、`/health` 外都需 `Authorization: Bearer <公共登录令牌>`。演示模式仅本机允许 `X-Demo-User: 1/2/3`；test/production 不接受演示头。

后端把令牌交给现有 `/api/auth/me` 验证，再从共享库读取当前角色与班级。请求不信任浏览器传来的 userId、role 或 project_type。API 不接受网站 cookie 身份，不开放跨域 CORS，不提供任意文件/命令执行入口。

| 请求 | 用途 |
| --- | --- |
| `GET /config`、`GET /health` | 功能开关、编译配置、服务是否存活（不是完整编译健康验收） |
| `GET /me` | 当前身份与余额；不返回密码/手机等无关字段 |
| `GET /workspace?studentId=…` | 自己的项目与组；教师可查本班学生 |
| `GET /examples` | 首版固定练习模板元信息 |
| `POST /projects` | `{name,parentId?,exampleId?}` 创建 |
| `GET /projects/:id` | 当前代码、输入、配置、版本、只读权限 |
| `PUT /projects/:id/source` | `{code,stdin,profileId,version}` 保存 |
| `PATCH /projects/:id` | `{name?,parentId?}` 重命名/移动 |
| `DELETE /projects/:id` | 删除自己的项目；有未完成任务时拒绝 |
| `POST /projects/:id/copy` | 创建自己的独立副本 |
| `PUT /projects/reorder` | `{parentId,ids}` 必须含当前组全部同类项目且不重复 |
| `POST /groups`、`PATCH /groups/:id`、`DELETE /groups/:id` | 作品组管理；只允许删除空组 |
| `PUT /groups/reorder` | 同类作品组排序接口 |
| `GET /classes`、`GET /classes/:id/students` | 读取自己负责的班级和学生；不改变入班逻辑 |
| `POST /projects/:id/distribute` | `{classId,requestId}` 给本班学生分发独立副本 |
| `POST /projects/:id/run` | `{code,stdin,profileId,version,requestId}` 保存并提交 |
| `GET /projects/:id/runs` | 最近最多 50 条历史摘要；不批量传输全部输出 |
| `GET /runs/:id` | 单次输出、诊断、状态、版本及队列位置 |
| `GET /runs/:id/source` | 当次不可变源码和输入快照 |
| `POST /runs/:id/stop` | 只允许任务所有者停止；请求体 `{}` |

`requestId` 是浏览器生成 UUID。运行同一请求编号和相同源码/输入重复提交会返回同一任务，改变内容则拒绝。分发同一请求编号只创建一次；不同编号表示主动新分发。

版本从 1 递增。源码、stdin、profileId 均未变时保存不增加版本；输入改变也会形成新版本。版本冲突返回 409 / `VERSION_CONFLICT`，前端保留草稿、暂停自动保存，不自动覆盖。

保存和运行快照登记在同一短数据库事务内完成；磁盘源码以 UUID 不可变文件先写入并同步，再提交元数据。队列满或未启用执行时仍提交保存，返回 `saved:true`、版本与明确错误。存储失败或版本冲突会回滚，不插入任务。失败事务留下的无引用临时源码，按孤立文件保留期清理。

主要错误：401 未登录/身份过期；404 不存在或无权访问；409 版本冲突、已有任务、非空组、请求编号冲突；413 大小超限；429 排队满/操作频繁；503 写入关闭、身份/执行服务不可用；507 磁盘空间不足。错误文本不回传数据库详情或内部凭据。

## 内部执行协议

仅本机 `127.0.0.1:5200`，每个请求都需要独立 `RUNNER_TOKEN`。业务浏览器不持有此令牌。

- `POST /jobs`：固定任务 ID、源码、stdin、profileId、镜像 ID；执行服务只有一个槽位。
- `GET /jobs/:id`：查询同一任务，不触发二次执行。
- `POST /jobs/:id/cancel`：若取消先于提交到达，持久化取消标记，阻止迟到提交启动。
- `GET /health`：经内部令牌认证的运行服务状态。

任务状态：queued → compiling → running → completed，或 compile_error/runtime_error/time_limit/memory_limit/output_limit/system_error。排队可直接取消；已派发任务先进入 stopping，容器清理确认后才 cancelled。短暂断网不被当作“已停止”，也不释放队列槽位。

任务和结果记录持久化，服务重启先清理自己标签和命名规则下的旧容器，再把未结束记录标为执行异常；从不自动重跑已登记任务。C++ 代码在容器中编译和运行，编译与运行使用不同容器，第二个容器对任务目录只有读取权限。

所有 `stdout`、`stderr`、源码和诊断按纯文本显示，不作为 HTML 渲染。内存上限与内存峰值是不同概念；首版不返回虚构的峰值。
