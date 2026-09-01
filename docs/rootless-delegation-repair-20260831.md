# 修复 cpp-runner 的 CPU 委派并接续初始化

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

本页修复及自动接续已成功完成，以下原操作步骤保留作记录，不再执行。修复日志 rootless-delegation-repair-f939ef15d52a.log / 记录 rootless-delegation-d6YPe9；初始化日志 rootless-resume-76f2d4f96ebd.log / 记录 rootless-resume-0gFyZA。

2026-08-31 用户回报的只读诊断已明确原因：`user@994.service` 生效值为 `DelegateControllers=memory pids`，用户管理器实际只有内存和进程数控制器，没有 CPU。原始模板对应 `Delegate=pids memory`；上级没有禁用控制器。

诊断日志：`/var/www/teaching-cpp-backend/logs/rootless-controllers-diagnostic-c586b81a10fa.log`。

## 本次怎么操作

1. 用 WinSCP 上传本地 `G:\teaching-cpp\deploy\repair-rootless-delegation-20260831.sh` 到服务器 `/var/www/teaching-cpp-backend/deploy/`。只上传这个新文件，旧脚本和记录保留。
2. 在 PuTTY 的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/repair-rootless-delegation-20260831.sh
```

请发回完整输出。它会先检查和备份，再修复、核验，之后自动调用已校验的原接续脚本。**不用另外执行旧脚本，也不要在报错后重跑。**

## 已确认的服务器状态

| 检查项 | 本次服务器诊断结果 |
| --- | --- |
| cpp-runner 用户管理器 | active/running，UID 994，PID 3396803 |
| linger | yes |
| user-994.slice 总限额 | CPU `100000 100000`、内存 `1073741824`、swap `0`、进程/线程 `256` |
| 向用户管理器传递的控制器 | memory、pids；缺 cpu |
| Podman 存储和运行目录 | 尚不存在，未进入原探针阶段 |
| 网站状态 | p5.js 健康，C++ 写入开启、编译运行关闭 |

这些是本次诊断时的值。修复前会重新读取，不把旧 PID 或旧状态当成当前值。诊断未读取 PM2 列表，不能用它证明 PM2 PID/重启计数未变；新脚本会在操作前后核验。

诊断的四个未读取项不等于四个独立故障：根 slice 没有普通单元文件可供 `cat`，根 cgroup 没有 `cgroup.type`，用户管理器缺少 CPU 控制器所以没有对应 `cpu.max`，另有 5280 检查命令未成功。最后一项不能记为端口空闲；新脚本使用此前成功的 PATH 方式查找 `ss`，必须真实检查端口未监听才能继续。

## 修改范围

只新增 `/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf`，内容为：

```ini
# 仅为 cpp-runner（UID 994）补充 CPU 委派，账号总限额仍由 user-994.slice 控制。
[Service]
Delegate=cpu memory pids
```

这是 UID 994 的专属配置，不修改 `/usr/lib/systemd/system/user@.service`，也不向所有用户统一开放控制器。systemd 支持按控制器列表委派，并通过单元附加配置调整指定实例。[systemd 252 资源控制说明](https://github.com/systemd/systemd/blob/v252/man/systemd.resource-control.xml)、[systemd 252 单元配置说明](https://github.com/systemd/systemd/blob/v252/man/systemd.unit.xml)

为加载新配置，脚本会执行 systemd 配置重读，再**只重启 cpp-runner 的 user@994.service**。其前提是 Podman 存储尚未初始化、5280 空闲，且账号下只有允许的系统基础用户服务；出现容器、执行服务或未知服务就停止。配置重读会重新加载 systemd 的单元定义；它与重启网站服务不同。[systemctl 252 说明](https://github.com/systemd/systemd/blob/v252/man/systemctl.xml)

原 `user-994.slice` 的 1 GiB 内存、1 核 CPU、256 个进程/线程、swap 0 总限额不变。脚本不直接写 cgroup 内核文件，不修改账号、映射、NSS、网站 `.env`、Apache 或数据库，不更新软件，不重启网站和 PM2。systemd 专属配置需要放在系统识别的位置；其余日志和私有操作记录仍集中保存在 C++ 后端目录。

## 检查、接续与失败处理

- 只接受这次已确认的 CPU 缺失状态、原模板和已知附加配置。若有人已修复、增加其他策略、修改网站配置或已有同名目标目录，停止而不覆盖。
- 校验旧脚本摘要和两个中断阶段，确认没有进入后续 Podman 阶段；核对现有容器配置的内容摘要和权限。
- 保存原单元文件及限额文件副本、配置摘要、用户服务状态和不含环境变量的 PM2 状态。原始命令错误只放在 root 私有记录。
- 写入后先核对 systemd 已加载正确配置，再限定重启该用户管理器；随后核对真实内核控制器与总限额，以及网站配置、网站状态、PM2 PID/重启计数均保持。
- 修复通过才自动运行原 `resume-rootless-podman-20260831-02.sh`。原脚本文件、注释、探针和隔离要求没有改动；再次检查原有条件后才执行 Podman 信息和实际 UID/GID 映射检查。
- 原接续脚本可能发现新的 Podman 或用户映射问题。即使 CPU 修复通过，也不能将后续失败记为初始化完成；保留配置和日志，不重复修复、不自动删除存储、不扩大重启范围。

新日志：`/var/www/teaching-cpp-backend/logs/rootless-delegation-repair-*.log`；新私有记录：`/var/www/teaching-cpp-backend/backups/rootless-delegation-*`。自动接续另有原格式的 `rootless-resume-*` 日志和记录，其公开输出也会收入新日志。

`repair-result.json` 仅表示 CPU 委派修复通过；最终 `result.json` 才表示此次修复与原 Podman 初始化检查都已完成。即使全部成功，也不下载镜像、不运行学生代码、不启动 C++ 执行服务，网站编译运行仍关闭。真实容器隔离、编译和容器内限额留待后续验证。

## 本地验证

新增 10 项检查通过，覆盖服务器已确认状态、错误身份和额外配置拒绝、总限额层与用户管理器层的区分、未知用户服务拒绝，以及各阶段失败时停止推进。完整 189 项中 188 项通过、1 项可选 MySQL 跳过。Bash/内嵌 Node 语法、原助手函数提取、UTF-8 无 BOM / LF 检查通过。没有在本机执行 Linux 服务或 Podman；本次修复的服务器结果仍待回报。

脚本 SHA256：`0556df40491052f82ef2058b7fce6dbb2e41f27acb24da1c1e67b8d726fa1845`。
