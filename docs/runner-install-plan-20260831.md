# Podman 安装前：预览软件事务

**后续正式安装也已完成。** 下一步使用 [独立执行账号准备脚本](runner-account-20260831.md)，不重跑预览或安装。

**本步预览已完成，不再重复执行下方历史命令。** 用户已回报新增 17 项、升级 2 个 SELinux 策略包、下载约 28MB；无删除或替换项，未列出 Apache、MySQL、Node 或 systemd 的升级。清单后的 Operation aborted / 退出码 1 为拒绝实际事务的预期结果。日志：`/var/www/teaching-cpp-backend/logs/podman-install-plan-78jwV6p1.log`。下一步使用 [正式安装说明](podman-install-20260831.md)，尚未收到实际安装结果。

前一步环境采集已完成，无需重复。用户回报的系统条件可继续准备执行服务，但还不代表容器隔离与限额已实际验证。

## 已确认结果

- `podman`、`crun`、`conmon`、`fuse-overlayfs`、`slirp4netns`、`passt` 均未安装。
- `shadow-utils-4.9-15.el9.x86_64` 已安装，`newuidmap` 与 `newgidmap` 路径均为 `/usr/bin/`；尚未实测用户映射。
- `systemd-252-55.el9_7.8.rocky.0.1.x86_64`，cgroup v2，控制器包含 cpu、memory、pids 等；`user.max_user_namespaces=14483`。
- `cpp-runner` 账号及 `/var/www/teaching-cpp-runner` 目录均不存在；实际 UID/GID 后续创建时核对，不预先猜测。
- `/etc/subuid` 与 `/etc/subgid` 均已有 `apphttp:100000:65536`，即 100000～165535，必须保留。执行用户后续使用另一段不冲突的范围，本轮不改这两个文件。
- `/var/www` 位于 `/dev/vda1` 的本地 ext4 文件系统，40GB 总量、26GB 可用；5280 未监听。
- C++ 编辑保存与 p5.js 原有保存、运行均已由用户确认正常；C++ 执行仍关闭。

## 本轮操作

先预览原生 Podman 及运行组件的软件事务，查看是否存在依赖升级或冲突，不直接安装整个 container-tools 元包。不添加第三方软件源、不升级整机、不关闭 GPG 校验，也不使用 `--allowerasing` 或 `--skip-broken`。本轮只使用已有的 Rocky 标准源 ID；如果这些源在服务器上缺失或被改名，命令会报错，应发回结果，不自动改源。

Rocky 官方仓库包含 Podman；标准仓库 ID 包括 baseos、appstream、extras。Rocky 的 releasever 按主版本跟随仓库更新，因此必须看实际事务清单，不能仅凭系统显示 9.7 就假定所有候选包版本。参考 [Rocky Podman 安装说明](https://docs.rockylinux.org/gemstones/containers/podman/) 与 [Rocky 仓库说明](https://wiki.rockylinux.org/rocky/repo/)。

`--assumeno` 会自动对确认问题回答否，阻止实际软件事务；`--refresh` 会重新核对软件源元数据。关闭弱依赖仅对本次命令生效，必要依赖仍由 DNF 解析。参考 [DNF 命令说明](https://dnf.readthedocs.io/en/stable/command_ref.html) 和 [DNF 弱依赖配置说明](https://dnf.readthedocs.io/en/latest/conf_ref.html#install-weak-deps)。

这不是完全不写磁盘的检查：可能刷新 `/var/cache/dnf` 的软件源索引，写入系统 DNF 日志，并在本项目 logs 中保存本次输出。它不安装、升级或删除软件，不创建用户、不启动容器、不改 `.env`，不重启 Apache、MySQL 或两个网站进程。无需上传新包，直接在 PuTTY 的 root 会话执行：

```bash
(
  set -uo pipefail
  umask 077
  test "$(id -u)" -eq 0 || exit 1
  cd /var/www/teaching-cpp-backend || exit 1
  test "$(pwd -P)" = /var/www/teaching-cpp-backend || exit 1
  command -v dnf tee mktemp >/dev/null || exit 1

  cpp_log=$(mktemp /var/www/teaching-cpp-backend/logs/podman-install-plan-XXXXXXXX.log) || exit 1
  printf '本次仅预览安装清单，不安装软件。\n日志：%s\n' "$cpp_log"

  LC_ALL=C dnf --assumeno --refresh \
    --disablerepo='*' \
    --enablerepo=baseos --enablerepo=appstream --enablerepo=extras \
    --setopt=assumeyes=False \
    --setopt=install_weak_deps=False \
    --setopt=timeout=20 --setopt=retries=2 \
    install podman crun conmon fuse-overlayfs passt 2>&1 | tee "$cpp_log"

  cpp_status=("${PIPESTATUS[@]}")
  if [ "${cpp_status[1]}" -ne 0 ]; then
    printf '日志写入未完成，请保留终端输出。\n' >&2
    exit 1
  fi
  printf '\nDNF 退出码：%s\n完整日志：%s\n' "${cpp_status[0]}" "$cpp_log"
  printf '请发回完整软件清单和末尾信息；不要把 --assumeno 改成 -y。\n'
)
```

先等命令结束，将包列表、Transaction Summary、下载量和最后的信息发回。**只有已经列出完整清单后出现的 `Operation aborted` 才是此预览的正常结束；下载失败、找不到包、依赖冲突等不是安装检查通过。** 不凭 DNF 退出码 1 判断成功，也不要改成 `-y` 继续。

不必再次修改网站配置或重新执行第 9 步。下一轮将根据清单核对所有新增、升级、替换或删除项；若涉及 httpd、MySQL、Node、systemd 或其他已有库的变更，先分析实际影响，不直接照抄安装。容器镜像、独立执行账号、系统服务、资源限制及真实编译检查均在后续安排。

本文已核对命令语法与官方参数说明。本机没有运行 DNF 或连接服务器，尚未取得候选软件版本和实际事务清单，也没有安装任何容器组件。历史源码、模板和发布包未修改。
