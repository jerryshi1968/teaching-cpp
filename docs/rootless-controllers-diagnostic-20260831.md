# Podman 初始化中断：资源控制器只读诊断

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

本页诊断及后续修复均已完成，以下交付步骤保留作记录；当前下载基础镜像。

2026-08-31，02 接续脚本于 `08:24:08.801Z` 返回 `USER_MANAGER_CONTROLLERS_MISSING`。下一步先采集实际资源委派情况，**不要重跑账号准备、原初始化或 02 接续脚本，也不要删除已写入的配置。**

## 已确认与尚未确认的状态

用户回报的日志：`/var/www/teaching-cpp-backend/logs/rootless-resume-d4c3df4223bf.log`。本次私有记录：`/var/www/teaching-cpp-backend/backups/rootless-resume-hrUKkg`。

依据已交付脚本的执行顺序，这次已通过已有配置核验、用户管理器 active 状态、linger、运行目录及账号总限额检查；随后在用户管理器的 `cgroup.controllers` 中检查 `cpu`、`memory`、`pids` 是否齐全时中断。总限额检查要求内存 1 GiB、swap 0、CPU 额度 1 核、进程/线程合计 256。这里是依据错误位置判断前序检查通过，并非已取得各内核文件的原始输出。

本次预检中两个网站 HTTPS 正常，C++ 写入开启、执行关闭。失败后的最终网站和 PM2 复核尚未执行，不能把预检结果记为失败后的实测。脚本还没有进入 Podman 信息和用户映射探针，没有下载镜像、创建工作负载容器或开放编译运行。

目前不能确定缺少哪一种控制器，以及是配置的委派范围、上级未启用还是其他原因。`Delegate=yes` 只说明委派已启用，仍需看具体控制器范围。systemd 允许通过 `Delegate=` 选择控制器；内核逐层通过 `cgroup.controllers` 和 `cgroup.subtree_control` 表示可用及向下开启的控制器。[systemd 252 资源控制说明](https://github.com/systemd/systemd/blob/v252/man/systemd.resource-control.xml)、[Linux cgroup v2 控制器说明](https://docs.kernel.org/admin-guide/cgroup-v2.html#controlling-controllers)

## 本次操作

1. 用 WinSCP 将本地 `G:\teaching-cpp\deploy\diagnose-rootless-controllers-20260831.sh` 上传到服务器 `/var/www/teaching-cpp-backend/deploy/`，只需要这一个新文件。
2. 在 PuTTY 的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/diagnose-rootless-controllers-20260831.sh
```

发回完整终端输出即可。新日志保存在 `/var/www/teaching-cpp-backend/logs/rootless-controllers-diagnostic-*.log`，权限为 root 0600，不覆盖旧日志。不需要上传 `.env` 或私有备份目录。

## 诊断范围

- 核对 02 接续脚本摘要，只读取此次中断的阶段文字和后续记录是否存在，不打开网站配置、密码文件或备份中的完整环境。
- 查询根 slice、user.slice、user-994.slice、user@994.service 的必要生效属性，包括具体委派范围、禁用列表和资源限额；再摘取这些单元配置中的资源设置和来源路径。
- 逐层读取内核控制器列表、向下开启列表，以及账号和用户管理器的限额；展示具体缺失位置和未知项。不会写入 cgroup 文件。
- 查看用户管理器的进程归属、已知目录/文件是否存在、5280 是否监听，并检查两个网站的公开 HTTPS 状态接口。
- 除保存本次诊断日志外，不修改配置、账号、映射或限额；不调用 Podman，不执行 systemd-run，不启用 linger，不重启服务，不操作 PM2，不开启 C++ 编译运行。HTTP 请求可能正常增加网站访问日志。

`missing` 表示属性未返回，空数组表示读取到了空列表，两者分开处理。`availableToManager` 对应本次失败的必要条件；`notEnabledForChildrenAt` 只是现状，例如用户管理器尚未按需启用子组控制器，不能单独认定为错误。读取失败保留错误码并继续其他项目，不将未知状态视为通过。

## 本地验证及边界

9 项针对性检查通过，覆盖资源继承链分析、空值/缺失/重复属性区分、配置和环境续行的输出过滤。Bash 和内嵌 Node 语法、UTF-8 无 BOM / LF 检查通过。仅完成本地检查，没有连接服务器或在 Windows 上执行 Linux 资源控制；根因和修复范围仍需此次服务器诊断确认。

脚本 SHA256：`e9435dbb50a79c63e7194ab7106143a26576c002ae966d61275c638ab2a11e4a`。
