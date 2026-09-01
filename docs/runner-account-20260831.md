# 第 10 步 D：准备独立执行账号

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

前一步已完成：用户回报 Podman 5.8.2 及依赖安装成功，只升级了两个 SELinux 策略包；两个网站 HTTPS 检查通过，p5.js / C++ 重启计数仍为 67 / 1，`.env`、SELinux 配置及两份用户映射文件校验通过。无需重跑 `install-podman-20260831.sh`。

## 本步做什么

上传一个脚本即可，仍在现有服务器上操作：

- 创建 `cpp-runner` 系统账号及同名组，密码锁定、交互登录关闭；实际 UID/GID 由系统分配，脚本读取并记录，不预先假定编号。
- 创建 `/var/www/teaching-cpp-runner` 及 `runner-data`、`.config`、`.local` 等子目录，权限均为 700，仅此账号可用。
- 拟为新账号添加 `200000～265535` 的用户及组映射。先检查与所有现有映射及真实 UID/GID 均不冲突；如有冲突则停止，不抢占。现有 `apphttp:100000:65536` 等行须逐字保留。
- 验证新账号不能读取 C++ 网站 `.env`、进入网站 storage/backups 或修改网站根目录/Node；网站账号不能进入执行目录。检查执行代码及现有运行依赖可以读取，但不启动执行代码。
- 新增 `/etc/systemd/system/user-<实际UID>.slice.d/90-teaching-cpp-limits.conf`，只为该账号的后续用户服务准备内存上限 **1 GiB**、CPU **1 核额度**、进程和线程合计 **256**、swap 上限 **0**。不修改全局 `user.slice` 或旧模板。
- 重新加载 systemd 单元定义，再检查读取到的配置值。**此 slice 保持 inactive，不启动用户管理器、不开启 linger，不初始化 Podman、不拉取镜像、不启动执行服务。** 这一步不会调用 `systemctl start/restart/enable` 或 `pm2 restart/save`。
- 检查原有账号记录、网站配置、网站 HTTPS，以及所有现有 PM2 进程的 PID、状态和重启计数没有变化。C++ 保持可编辑、不可编译运行。

这个限额不是预留或立即占用 1 GiB 内存，也不是把账号固定到某个物理 CPU。实际执行服务须在后续放入这个用户 slice，并用真实容器核验限制，不能把本步读取配置通过当成完整隔离测试通过。依据为 [systemd 252 资源控制说明](https://github.com/systemd/systemd/blob/v252/man/systemd.resource-control.xml)。

账号、映射及系统服务定义必须使用 `/etc` 的标准位置；应用家目录、运行目录和私有备份仍集中在 `/var/www`。脚本仅使用系统现有工具和 C++ 专用 Node，不再安装软件。独立账号及 subordinate ID 是 rootless Podman 的准备条件；映射实际可用性仍待验证。[Podman 官方 rootless 说明](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)

## 上传和执行

1. 用 WinSCP 上传本机 `G:\teaching-cpp\deploy\prepare-runner-account-20260831.sh`，服务器目标目录为 `/var/www/teaching-cpp-backend/deploy/`。
2. 在 PuTTY 原来的 root 会话执行下面一条命令；无需设置执行权限，不需要复制脚本内容。

```bash
bash /var/www/teaching-cpp-backend/deploy/prepare-runner-account-20260831.sh
```

脚本没有额外的确认问题。它只用于首次准备：发现已有同名账号、组、家目录、执行配置、对应资源单元或冲突范围时会停止，不覆盖、不删除、不自行接管。运行期间不要另开窗口重复执行，也不要同时增删其他系统账号。

请把输出从开始检查到结束的内容发回。成功时会显示实际 UID/GID、目录、配置值、网站检查和私有备份位置；结束语会明确说明执行服务未启动。如果中途停止或网络断开，不重复运行，先发回已得到的输出。部分新账号、映射或目录可能已经创建，应按实际阶段核查，不自动清理。

## 备份与验证边界

私有备份位于 `/var/www/teaching-cpp-backend/backups/runner-account-*`，操作日志位于同项目的 `logs/runner-account-*.log`。备份包含原账号文件（包括密码哈希文件）、映射、文件摘要以及不含完整环境变量的 PM2 进程摘要。目录为 root 私有，**不要公开分享备份内容**；排查先只发送终端输出即可。失败的系统命令诊断也只写入私有备份。

这些备份不用于自动整体覆盖 `/etc/passwd` 或 `/etc/shadow`：那样可能覆盖其他正常账号变更。脚本发生错误后只停止并记录阶段，不会自动删除用户或回滚整份账号文件。

本地新增 18 项检查，覆盖映射冲突、真实 ID 占用、边界值、旧记录及注释保留、错误新行、资源单元 UID 和网站开关状态；这些是纯逻辑测试，不是 Linux 账号创建、systemd 或 rootless 容器实测。脚本为 UTF-8 无 BOM、LF 换行。服务器实际结果仍待本次执行回报，应用源码和已发布脚本/压缩包未修改。

本地最终检查：共 128 项测试，127 项通过、1 项可选 MySQL 跳过；Bash 和内嵌 Node 语法、UTF-8 无 BOM / LF 检查通过。46 个旧材料清单项及此前交付的 install-podman-20260831.sh 哈希保持不变。没有执行 Linux 账号创建、systemd 命令或连接服务器。
脚本 SHA256：`2ea9c145864c679530b2922ca1cd257375b1268e2f9962a9a41541dd2468eabc`。
