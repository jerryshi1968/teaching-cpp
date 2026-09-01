# 第 10 步 E：初始化独立账号的 Podman

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

以下原交付步骤保留为历史记录，本页旧命令不再执行。

2026-08-31 08:14:10Z，用户回报原初始化在用户管理阶段返回 PROPERTY_FORMAT。已写入专用容器配置、建立临时目录，并执行 linger/用户管理器启动命令；尚未进入 Podman 检查。日志 /var/www/teaching-cpp-backend/logs/rootless-init-9e358aabc659.log，私有记录 /var/www/teaching-cpp-backend/backups/rootless-init-X25XA6。源码确认 loginctl 252 不拆分 --property 的逗号参数，本地已复现空输出。 本页原命令不再执行，使用 [02 接续脚本](rootless-resume-20260831-02.md)。下面保留原交付说明。

前一步已完成：用户回报 `prepare-runner-account-20260831-02.sh` 于 2026-08-31T07:56:25Z 成功结束。账号为 `cpp-runner`，UID **994**、GID **991**，家目录 `/var/www/teaching-cpp-runner`，两份映射新增 `200000～265535`，原有行保持不变。网站和执行目录之间的权限检查通过；NSS 链接、配置及原账号记录核验通过。资源配置已加载，账号 slice 当时仍未启动。

原 p5.js 进程 PID **3341075**、重启计数 **67**，C++ 网站进程 PID **3375614**、重启计数 **1**，前后状态均未变。两个网站健康检查通过，C++ 写入开启、编译运行关闭。账号准备备份为 `/var/www/teaching-cpp-backend/backups/runner-account-RQI6nx`，日志为 `/var/www/teaching-cpp-backend/logs/runner-account-d3b0c3650990.log`。不要重跑账号准备或 Podman 安装脚本。

## 本步会做什么

只初始化这个账号的容器环境，不下载编译镜像，不启动 C++ 执行服务：

1. 核对上述成功记录、账号、映射、目录、未启用的执行开关以及两个网站；如果发现已经初始化或目录里已有内容就停止，不覆盖。
2. 在执行账号自己的 `.config/containers/` 中创建 `containers.conf` 和 `storage.conf`，指定 systemd、crun、overlay 和已安装的 fuse-overlayfs；系统 `/etc/containers` 保持不变。
3. 为 **cpp-runner 单独**启用 linger，并启动 `user@994.service` 用户管理器。以后即使退出 PuTTY，这个账号仍可管理后台服务；用户管理器会随系统启动。这不等于已经安装或启用了 C++ 执行服务，也不是已验证重启恢复。[systemd linger 说明](https://github.com/systemd/systemd/blob/v252/man/loginctl.xml)
4. 在该用户的临时 systemd 服务中执行 Podman 初始化信息检查，以及只读的 namespace 映射检查。进程先核对自身 UID/GID 和 cgroup 位置，随后明确使用本地 rootless 引擎，不能转为 rootful 或远程引擎。
5. 检查 rootless、cgroup v2、systemd、seccomp、crun、实际 UID/GID 映射和空存储；从内核读取账号的总内存、CPU、进程和 swap 限额。最后再次检查两个网站、PM2 进程和原配置。

本步可能留下 Podman 初始化使用的辅助进程，以及用户管理器的默认用户服务。它不是纯只读采集；但不会调用镜像下载、构建或容器运行命令，不修改网站 `.env`、Apache、数据库或原账号映射，不重启 PM2 进程，也不启用 Podman API socket。

## 新文件放在哪里

| 用途 | 位置 |
| --- | --- |
| 账号自己的 Podman 配置 | `/var/www/teaching-cpp-runner/.config/containers/` |
| Podman 镜像与存储 | `/var/www/teaching-cpp-runner/.local/share/containers/storage/` |
| 镜像下载等临时文件 | `/var/www/teaching-cpp-runner/tmp/` |
| 日志与私有操作记录 | `/var/www/teaching-cpp-backend/logs/` 和 `backups/` |
| 系统管理的运行时目录 | `/run/user/994/` |
| 系统管理的 linger 标记 | `/var/lib/systemd/linger/cpp-runner` |

`/run/user/994` 和 linger 标记属于系统标准位置，其余新增应用文件集中在两个 C++ 目录中。存储与临时路径会通过实际 Podman 输出核对。[Podman rootless 路径与环境变量](https://docs.podman.io/en/v5.8.0/markdown/podman.1.html)、[存储配置说明](https://github.com/containers/storage/blob/main/docs/containers-storage.conf.5.md)

## 上传和执行

1. 用 WinSCP 将本机 `G:\teaching-cpp\deploy\initialize-rootless-podman-20260831.sh` 上传到 `/var/www/teaching-cpp-backend/deploy/`。只上传这个新文件；先前已上传的 `prepare-runner-account-20260831-02.sh` 保留原样，新脚本会验证其摘要并复用纯检查函数，不执行旧流程。
2. 在 PuTTY 原来的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/initialize-rootless-podman-20260831.sh
```

请发回完整输出。开头会显示 `/var/www/teaching-cpp-backend/logs/rootless-init-*.log` 的具体路径；进入初始化后另存私有记录 `backups/rootless-init-*`。成功时会说明 rootless 初始化完成、镜像和容器数量均为 0、网站进程未变。

如果报错或断线，不要重跑，不要清理存储或删除账号。脚本保留已经创建的配置和用户管理器状态供排查；若临时检查服务未正常退出，只请求停止本次命名的服务，另设运行时限，不停止其他服务。用户管理器启动等待约 20 秒，Podman 子命令各限 12 秒，临时服务运行上限 45 秒。日志不会直接显示原始子命令 stderr；详细诊断只留在私有记录中。

## 这一步通过代表什么

通过后可确认 Podman 能以指定账号初始化，实际 namespace 映射正确，账号总限额已写入内核。它仍不能证明真实镜像挂载、网络隔离、容器内资源限制、编译、停止任务或课堂负载正常。下一步再准备固定编译镜像并运行受控检查；性能测试仍放在后面。[Podman info 输出说明](https://docs.podman.io/en/v5.8.0/markdown/podman-info.1.html)、[systemd 临时服务说明](https://github.com/systemd/systemd/blob/v252/man/systemd-run.xml)

本地验证：新增 15 项纯逻辑检查通过，覆盖映射错误、rootful/远程引擎、缺少隔离或控制器、错误存储、非空初始化及检查进程位置。完整检查共 160 项，159 项通过、1 项可选 MySQL 跳过；Bash、内嵌 Node、生成的用户服务检查代码语法及 UTF-8 无 BOM / LF 均通过。此前交付的安装、账号准备和诊断脚本保持不变。没有在 Windows 上执行 Linux 用户服务或 Podman，服务器实际结果待回报。

初始化脚本 SHA256：`718d5f2be70b8257bcb521c4d41046a3a6930d624537f9f5eed92986143e9c7a`。
