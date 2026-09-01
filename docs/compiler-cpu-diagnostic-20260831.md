# CPU 超时退出判定：诊断步骤

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

2026-08-31，用户回报 02 接续脚本于 `12:13:16Z`～`12:13:48Z` 执行：教学镜像成功构建，前 12 项验证通过。在 CPU 时间上限用例中，预期 `time_limit`，实际 `runtime_error`，消息为“程序退出码：137”。随后原配置、用户管理器、账号总限额和两个网站复核通过；写入开启，网页编译运行关闭。

本次服务器记录：

- 日志：`/var/www/teaching-cpp-backend/logs/compiler-check-02-75d4c542de48.log`
- 私有记录：`/var/www/teaching-cpp-backend/backups/compiler-check-02-PRb5s6`

此前创建 `/work` 的问题已解决，不再重新构建镜像。已通过的项目包括镜像身份、实际 cgroup 限额、编译/运行容器隔离、GCC 版本、C++17 输入输出、C++14、编译错误处理、非零退出码、只读/禁执行/禁网、进程数和墙钟超时。CPU 时间上限未通过，后续输出上限、内存上限、取消测试未执行。

## 为什么先补充证据

当前执行器识别主动取消、输出上限、墙钟超时及退出码 152，并读取容器的内存终止标记。137 没有被直接归为超时。不能为了通过测试把全部 137 改成超时，因为它也可能来自其他强制终止或程序主动返回。

Linux 的 CPU 软上限会产生 SIGXCPU，达到硬上限会产生 SIGKILL；PID 命名空间中 PID 1 的信号处理还有特殊规则。这是本次退出的可能解释，尚不能仅凭终端日志确认。[CPU 限额说明](https://www.man7.org/linux/man-pages/man2/getrlimit.2.html)、[PID 命名空间说明](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html)

新诊断在不修改执行器的前提下，复用已构建镜像，顺序编译和运行三个固定程序：

1. 默认信号行为的忙循环，报告自身 CPU 用时和实际软/硬上限。
2. 相同忙循环，增加 SIGXCPU 处理函数，记录是否实际收到该信号。
3. 很快主动返回 137 的对照程序，用来区分退出码与原因。

同时截取原执行器已经进行的容器检查结果，包括实际退出码、`OOMKilled`、开始/结束时间，以及执行器是否触发墙钟超时。只输出这些必要字段，不输出容器环境或命令中的秘密。CPU 样本来自此次固定诊断程序自身的 `getrusage`，不会作为信任任意学生程序输出的设计。[CPU 用时接口说明](https://www.man7.org/linux/man-pages/man2/getrusage.2.html)

## 上传一个文件并执行

用 WinSCP 上传：

| 本地文件 | 服务器完整路径 |
| --- | --- |
| `G:\teaching-cpp\deploy\diagnose-compiler-cpu-20260831.sh` | `/var/www/teaching-cpp-backend/deploy/diagnose-compiler-cpu-20260831.sh` |

保持 LF 换行，不用重新上传镜像或覆盖原脚本。在 PuTTY 的 root 会话执行一次：

```bash
bash /var/www/teaching-cpp-backend/deploy/diagnose-compiler-cpu-20260831.sh
```

保持连接，结束后发回完整输出。不要重跑 02 接续脚本，也不要删除镜像、目录或锁文件。

## 操作范围

这不是纯只读脚本：它会创建诊断记录、临时工作目录，并在 cpp-runner 的 rootless 容器内编译和运行上述三个程序。它不会重新构建或拉取镜像，不安装软件，不修改应用代码、数据库、Apache、账号、资源限额或网页开关。

执行前核对旧的 12 项通过记录、CPU 失败位置、旧任务结束状态、镜像身份和当前空容器列表。所有执行使用原 `PodmanSandbox`、原编译参数和原隔离参数；无特权、禁网及账号 1 GiB / 1 核 / 256 任务 / swap 0 总限额保持。每个程序仍受原编译/运行限制，整个临时诊断服务另有 300 秒上限。

只清理本次创建的容器和程序工作目录。旧构建目录、镜像、私有记录及 `compiler-check-02.lock` 保留。本次另建 `compiler-cpu-diagnostic.lock` 防止重复操作。

- 新日志：`/var/www/teaching-cpp-backend/logs/compiler-cpu-diagnostic-随机名.log`
- 新私有记录：`/var/www/teaching-cpp-backend/backups/compiler-cpu-diagnostic-随机名`
- 新工作目录：`/var/www/teaching-cpp-runner/cpu-diagnostic-随机名`

诊断结束会复核原文件摘要、网站进程、用户管理器和资源限额。只有三个样本记录完整、容器清理确认和网站复核通过，才记录诊断采集完成；这不等于剩余四项验收通过，也不启用网页运行。

## 本地检查与限制

新增 9 项测试通过，覆盖旧失败记录范围、容器退出字段、CPU 样本处理、未知情况拒绝、固定诊断代码、采集完整性和用户服务程序序列化。完整 260 项测试中 259 项通过、1 项可选 MySQL 跳过。Bash/内嵌 Node 语法、UTF-8 无 BOM/LF 通过；已交付脚本和原执行器保持不变。

```text
diagnose-compiler-cpu-20260831.sh
SHA256: fed51c00301e31a395cdff2cc559371022399c13b9b4c30488b9dcb3361a6b1f
```

本机没有 Linux/Podman 编译执行环境，三个 C++ 诊断程序尚未实际编译运行。实际 CPU 用时、信号和退出信息需要本次服务器回报，不能提前记为已确认的退出原因。
