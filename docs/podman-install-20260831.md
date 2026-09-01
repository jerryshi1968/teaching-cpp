# 第 10 步 C：正式安装 Podman 组件

**本步已完成，不再运行下方安装命令。** 2026-08-31 用户已回报正式安装成功：新增 17 包，两个 SELinux 策略包从 38.1.65-1.el9_7.1 升至 38.1.75-2.el9_8，Podman 为 5.8.2。DNF 事务检查、事务测试和最终安装均通过，.env、/etc/selinux/config、/etc/subuid、/etc/subgid 校验通过，SELinux 仍 Disabled。两个网站 HTTPS 检查通过，PM2 中 p5js-backend / teaching-cpp-backend 均 online，前后重启计数为 67 / 1；本次列表未提供 PID，不能据此补记 PID 实测。安装记录：/var/www/teaching-cpp-backend/backups/podman-install-fkY7Dz5i；日志：/var/www/teaching-cpp-backend/logs/podman-install-tsbrcupt.log。执行服务仍未启动。 下一步见 [独立执行账号准备](runner-account-20260831.md)。以下说明保留为安装时记录。

2026-08-31 已收到完整预览结果：新增 17 个软件包，升级 2 个 SELinux 策略包，下载约 28MB；没有删除或替换项，没有 Apache、MySQL、Node 或 systemd 的升级。预览日志为 `/var/www/teaching-cpp-backend/logs/podman-install-plan-78jwV6p1.log`。清单后的 `Operation aborted` 和退出码 1 来自 `--assumeno`，表示没有安装软件，不是依赖解析失败。

现在可以安装这批组件。安装脚本直接使用系统 DNF，无需上传新压缩包，也没有安装自定义软件管理程序。它指定此次清单中全部 19 个包的版本，并保留 DNF 原生确认提示；不会自动接受清单。这里只使用已有的 Rocky 标准软件源，保持软件包签名检查，不执行全系统升级。

## 先看清本步范围

- 新增 Podman 及其依赖；已有软件只允许升级 `selinux-policy`、`selinux-policy-targeted` 至 `38.1.75-2.el9_8`。这两项是实际的系统软件更新，不能称为“完全不改系统”。
- 不手动启用 SELinux，不修改其启动配置，不重启服务器。安装前要求当前状态仍为 `Disabled`，安装后再检查状态和配置文件哈希。
- 不创建 `cpp-runner`，不分配用户映射、不拉取镜像、不启动容器；不运行 `podman info` 或容器探针。本步成功也不代表 rootless 容器隔离已验证。
- 不更改网站源码、Apache 配置、数据库、PM2 设置或 `.env`，不执行网站重启命令。C++ 写入保持启用，编译执行保持关闭。
- 安装记录放在项目 `backups` 和 `logs` 下。DNF/RPM 自身的软件、缓存、数据库和日志仍使用系统目录，不能全部挪到项目目录。
- 保存 SELinux 启动配置、安装前 RPM 清单和关键文件哈希，便于排查；这些记录不是整机快照，不能保证自动回滚 RPM 事务。若失败，不直接卸载、反向执行 DNF 历史或恢复旧数据库。

## 在 PuTTY 中操作

本步已做成独立脚本，**无需复制长命令，也无需上传压缩包**。

1. 在 WinSCP 左侧选择本机 `G:\teaching-cpp\deploy\install-podman-20260831.sh`，右侧打开服务器 `/var/www/teaching-cpp-backend/deploy/`，上传这一个文件。不要覆盖其他文件或整个目录。
2. 在 PuTTY 原来的 root 会话输入下方一条启动命令即可。通过 bash 启动，无需另行 chmod。文件已保存为 UTF-8 无 BOM、Linux LF 换行。
3. 出现 `Is this ok [y/N]:` 后，检查仍然是 **Install 17 Packages / Upgrade 2 Packages**，升级项仅为 `selinux-policy`、`selinux-policy-targeted`，没有 `Removing`、`Downgrading` 或 `Replacing`。符合时输入 **y** 并回车，不必再向本对话申请确认。

若清单不同，输入 **n** 并发回新清单；如果提示导入未知签名密钥，也输入 **n**，不要关闭签名校验。不要在命令中加入 `-y`。安装开始后保持窗口打开，不按 Ctrl+C，不同时运行其他安装命令；若连接意外断开，重新连接后先发回日志，不重复执行安装。

```bash
bash /var/www/teaching-cpp-backend/deploy/install-podman-20260831.sh
```

安装前或安装后的检查若中途停止，把停止位置及错误发回；不要因为已经出现 `Complete!` 就认定全部检查通过。`pm2 list` 用于人工比较状态及重启计数，脚本不自动断言 PID/重启计数没有变化。HTTPS 检查不等于所有网站业务回归，更不能证明软件包脚本完全没有副作用。

请回传 DNF 最终安装结果、安装后检查与 PM2 表格。本步暂不执行 `podman info`、`podman run`、`pm2 restart`、`systemctl enable --now podman.socket`、`setenforce` 或 `reboot`。后续再创建独立执行用户、安排其目录及资源限制，最后实测编译运行。

## 依据与验证边界

- [DNF install / install-nevra](https://dnf.readthedocs.io/en/stable/command_ref.html#install-command)：精确指定包版本和架构；依赖仍由 DNF 解析，因此必须核对最终事务，而不能只看指定的包名。
- [DNF 配置参考](https://dnf.readthedocs.io/en/latest/conf_ref.html)：关闭自动确认和弱依赖，显式启用所用仓库的软件包签名检查；这些命令行设置不写入全局配置。
- [Rocky 的 Podman 说明](https://docs.rockylinux.org/gemstones/containers/podman/)：使用发行版包管理工具安装 Podman。

本机核对了脚本与原命令块逐字一致（仅增加文件头说明），并检查版本清单和 Bash/Node 语法，没有在 Windows 上执行 DNF，没有连接服务器或安装软件。正式安装成功、实际 RPM 变化及运行隔离情况，仍需分别以服务器回报为准。本次新增独立安装脚本并补充上传说明，应用代码和已交付发布包保持不变。
