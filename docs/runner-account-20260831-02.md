# 第 10 步 D：执行账号准备修正版

2026-08-31 服务器账号准备已完成：07:56:24Z～07:56:25Z 执行 02 版成功。cpp-runner UID=994、GID=991，家目录 /var/www/teaching-cpp-runner，subuid/subgid 新增 200000:65536，原行保留；文件权限分离与 NSS 链接/内容核验通过。user-994.slice 限额配置已加载但当时 inactive；内存 1 GiB、CPU 1 核额度、TasksMax=256、swap 0。原 p5.js PID=3341075/重启67，C++ PID=3375614/重启1，前后未变，两个网站 HTTPS 通过。未启用 linger、未初始化 Podman、未下载镜像、未启动执行服务。私有备份：/var/www/teaching-cpp-backend/backups/runner-account-RQI6nx；日志：/var/www/teaching-cpp-backend/logs/runner-account-d3b0c3650990.log。不要重跑账号准备。 下一步使用 [rootless 初始化脚本](rootless-initialization-20260831.md)。以下修正说明与操作命令保留为历史记录。

2026-08-31，用户回报诊断日志 `/var/www/teaching-cpp-backend/logs/runner-account-diagnostic-034235dd0ec9.log`。服务器上的原准备脚本与交付版 SHA256 一致；没有账号准备操作日志或备份，`cpp-runner` 账号、同名组、独立目录、执行配置和 linger 均不存在。两份映射仍各只有 `apphttp:100000:65536`，5280 无监听，两个网站健康检查通过，C++ 写入开启、执行关闭。

## 原因与修正范围

诊断确认 `/etc/nsswitch.conf` 是 root 所有的符号链接，指向 `/etc/authselect/nsswitch.conf`。旧脚本用只接受普通文件的通用摘要函数检查它，因此会在备份和账号创建之前触发 `NOT_REGULAR_FILE`。本地使用此次诊断对应的链接类型已复现该拒绝；原终端错误未保留，不把本地复现记录冒充原服务器日志。

authselect 会管理这类链接，不应为通过安装脚本而将它替换成普通文件或改动系统认证配置。[authselect 源码中的链接定义](https://github.com/authselect/authselect/blob/master/src/lib/paths.h)、[Red Hat 对 authselect 链接的说明](https://access.redhat.com/solutions/7110527)

02 版只调整以下检查与日志行为：

- 为 NSS 配置单独检查普通文件或指向 `/etc/authselect/nsswitch.conf` 的链接，不放宽其他文件的通用限制。
- 核对 root 所有者、父目录及目标权限、单一链接、最终解析路径和用户映射来源；不接受任意链接目标，也不修改链接或目标文件。
- 在创建账号前与流程结束时再次核对链接文字、目标、归属、权限和文件内容摘要，并把摘要保存在私有备份的 `nss-before.json` 中。
- 核对应用目录和私有备份目录后立即创建操作日志，后面的版本、账号和 NSS 预检若失败，也会留下错误码。

账号、目录、映射及资源配置的准备流程与原版相同。旧脚本、已发布材料和应用代码保持不变。此前诊断已确认没有部分创建的内容，本次无需删除或回滚。

## 本次操作

1. 用 WinSCP 上传 `G:\teaching-cpp\deploy\prepare-runner-account-20260831-02.sh` 到服务器 `/var/www/teaching-cpp-backend/deploy/`。这是新文件，不覆盖旧版。
2. 在 PuTTY 的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/prepare-runner-account-20260831-02.sh
```

不要执行不带 `-02` 的旧准备脚本，也不需要重新安装 Podman。新版仍会重新检查账号、目录和映射现状，发现冲突就停止，不接管已有内容。

本步会创建独立账号及家目录、添加无冲突的 UID/GID 映射、写入该账号的 systemd 资源配置并重新加载单元定义；原有账号和 apphttp 映射须保持不变。限额仍为内存 1 GiB、CPU 1 核额度、进程/线程合计 256、swap 0。**不会重启两个网站，不启用 linger，不初始化 Podman、不下载镜像、不启动执行服务，C++ 编译运行仍关闭。**

请发回完整输出。若报错，不重复运行，也不自行删除账号或目录；操作日志位置在开头显示。成功时显示实际 UID/GID、私有备份位置及两个网站检查结果。备份包含账号密码哈希等敏感系统记录，只保存在私有位置，不公开发送备份内容。

## 验证边界

本地新增 12 项检查，覆盖旧故障复现、已确认链接与普通文件、未知目标拒绝、所有者和权限、重复链接、NSS 来源限制，以及前后链接和内容变化。完整检查共 145 项，144 项通过、1 项可选 MySQL 跳过；Bash 和内嵌 Node 语法、UTF-8 无 BOM / LF、原注释保留均通过。原安装、账号准备及诊断脚本未变。

没有在本机执行 Linux 账号创建、systemd 或真实容器，也没有连接服务器。02 版实际执行结果仍待用户回报；读取资源配置不等于真实容器限额已经验证。

02 版脚本 SHA256：`78dd26246bff6ad0c011703ce6672e4ec042c271e1260eaf66e7bb8425c48489`。
