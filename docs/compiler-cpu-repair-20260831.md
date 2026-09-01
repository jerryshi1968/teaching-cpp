# CPU 计量修正与接续验证

2026-08-31 最新结果：本步骤已在服务器执行成功，全部 18 项通过。记录为 compiler-check-03-1PGlAA，日志为 compiler-check-03-51f8fd4fe0a7.log；执行入口已切换，两站和总限额保持，网页运行关闭。内部执行服务和首次真实网页运行随后也已验证通过，现在转到 [课堂功能检查](classroom-acceptance-20260831.md)，不重跑本页旧脚本。

2026-08-31，用户完成 CPU 退出诊断。默认忙循环为容器 PID 1，CPU 软/硬上限为 3/4 秒；最后记录 CPU 用时 3,763,405 微秒，运行约 4.15 秒后返回 137，`OOMKilled=false`。捕获 SIGXCPU 的对照程序记录了该信号，约 3.14 秒后返回 152；主动返回 137 的短程序约 0.14 秒结束。两个网站、原配置、用户管理器和总限额复核正常，网页运行仍关闭。

本次记录：`/var/www/teaching-cpp-backend/backups/compiler-cpu-diagnostic-NwAqHX`。日志：`/var/www/teaching-cpp-backend/logs/compiler-cpu-diagnostic-cfb9840cc6a2.log`。

已构建的教学镜像为 `sha256:c8579da6d7ec08b0ca85310d947bcea10450288b6b1f96167029fa42e22556fe`。不再下载或构建镜像。

## 修正内容

新增 `runner/src/cpu-budget.mjs`，在原执行器外增加 CPU 用时监测。它从 Podman 取得对应容器的宿主 PID，再读取该进程的 cgroup 路径，确认属于 cpp-runner 和该容器完整 ID 后，读取内核 `cpu.stat` 的 `usage_usec`。这些计数包含该容器的子进程，不采用学生程序自己输出的数字，也不以运行了多少墙钟时间代替 CPU 用时。[Linux 5.14 cgroup 文档](https://www.kernel.org/doc/html/v5.14/admin-guide/cgroup-v2.html)

达到编译 15 秒、运行 3 秒的 CPU 预算时，只向对应容器发送停止信号，并记录超时依据。按约 50 毫秒间隔采样，因此停止会有采样和命令执行延迟。原有的每进程 CPU 软/硬上限、墙钟超时、内存/进程限制、无特权、禁网和只读挂载全部保留。此次增加的是容器内进程合计 CPU 用时控制。[Podman kill 说明](https://docs.podman.io/en/v5.8.0/markdown/podman-kill.1.html)

主动返回 137 的短程序仍为运行错误。取消、输出上限和已有墙钟超时保持原处理；CPU 停止与容器 OOM 同时发生时，保留原内存超限判定。监测无法确认时停止对应任务并报告环境错误，不伪报 CPU 超时或继续无限运行。

原 `runner/src/podman.mjs`、容器参数、程序编译命令和 `JobManager` 不修改。执行服务入口只替换一条导入语句，其他字节和注释保留。本地通用 Linux 验证入口也已同步使用新模块；本次服务器操作不要求上传或运行该通用脚本。

## 上传与执行

只用 WinSCP 上传这个新脚本，保留 LF 换行：

| 本地文件 | 服务器完整路径 |
| --- | --- |
| `G:\teaching-cpp\deploy\repair-compiler-cpu-20260831.sh` | `/var/www/teaching-cpp-backend/deploy/repair-compiler-cpu-20260831.sh` |

脚本已经内置需要新增的模块，不要另外上传整个项目或 `runner/src` 目录。在 PuTTY 原 root 会话执行一次：

```bash
bash /var/www/teaching-cpp-backend/deploy/repair-compiler-cpu-20260831.sh
```

保持连接，等待结束并发回完整输出。不重跑旧诊断、构建或接续脚本，不删除镜像、旧目录或锁文件。

## 脚本执行顺序

1. 核对已完成的 CPU 诊断、前 12 项通过记录、固定镜像身份、旧任务结束状态、文件摘要、网站及限额。
2. 保存执行服务原入口及状态记录，只新增 root 所有、服务用户只读的 `runner/src/cpu-budget.mjs`。执行服务入口暂不改。
3. 复用现有镜像，使用新模块重验原 16 项，再验证“主动返回 137”和“伪造 CPU 输出”两个误判对照，共 18 项。CPU 用例不仅要返回 `time_limit`，还必须记录绑定该任务的内核 CPU 预算事件。
4. 确认容器清理、原文件、网站进程、用户管理器及限额保持。任何一项失败都停止，不切换执行服务入口。
5. 全部通过后，仅将尚未启动的 `runner/src/server.mjs` 入口切换到新模块，保持文件权限。若入口发布后的记录步骤失败，会尝试恢复原入口；未知修改不覆盖。

本步骤不启动执行服务、不创建 `.env.runner`，不开放网页编译运行，不修改 Apache、MySQL、PM2 或网站配置，不重启网站和用户管理器。1 GiB 内存、1 核 CPU、256 个任务、swap 0 的账号总限额保持。不是课堂并发性能验收。

## 记录与失败处理

- 新日志：`/var/www/teaching-cpp-backend/logs/compiler-check-03-随机名.log`
- 新私有记录：`/var/www/teaching-cpp-backend/backups/compiler-check-03-随机名`
- 新验证目录：`/var/www/teaching-cpp-runner/compiler-check-随机名`
- 防重复锁：`/var/www/teaching-cpp-backend/backups/compiler-check-03.lock`

旧镜像、构建目录、诊断结果和锁文件全部保留。如果验证失败，新模块和诊断现场也保留，不自动重试；发回完整输出后再处理。本次成功记录会保存新模块与入口摘要；旧预部署归档及其清单保持历史原样，不能再把新入口与旧清单相比较而视为意外改动。

## 本地验证与尚待验证的部分

新增 19 项测试通过：13 项 CPU 计量与停止行为测试、6 项交付与接续验证测试。完整 279 项测试中 278 项通过、1 项可选 MySQL 跳过。Bash/Node、完整序列化用户服务程序、辅助函数加载、UTF-8 无 BOM/LF、内置模块摘要和入口仅改一行的检查通过。

```text
repair-compiler-cpu-20260831.sh
SHA256: 509d7577a875252578bf1a5d2b2c18763e42fb5c12959ade013e35ac715f5b43

runner/src/cpu-budget.mjs
SHA256: 2b4d6da57db00d3ff5707ec6bfe338ea70058741ef5a4620a571dd1e2b6b3c4b

runner/src/server.mjs（切换后）
SHA256: 8c5e49771a2dc667fe65f24f14b455968f9db261d3f487d33c5ed2dd4430eda2
```

交付时本机没有 Linux/Podman 环境，未提前宣称服务器验证通过。用户随后于 12:52:31Z～12:53:14Z 执行成功：全部 18 项通过，CPU 用例记录了 3033666 微秒的容器累计用时，按 3000000 微秒预算停止；相关路径、读取权限和终止行为已在本次服务器验证中实际使用。该次容器验证结束时，长期执行服务和网页运行尚未启用；用户随后已回报内部执行服务启动成功，网页运行仍待下一步开放。
