# 下一步：独立编译执行服务的环境准备

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

**最新进度：Podman 正式安装已成功，两个网站正常。** 下一步见 [独立执行账号准备](runner-account-20260831.md)，当前编译运行仍关闭。

**最新进度：环境采集及安装预览均已完成。** 下一步见 [第 10 步 C：正式安装 Podman](podman-install-20260831.md)；不需要重跑本文的采集命令，也没有开启编译运行。

当前第 9 步已完成。用户已确认 C++ 新建、保存、刷新后重新打开正常，并澄清 p5.js 保存和运行也没有问题。服务器 C++ 写入已启用、执行仍关闭；两个 PM2 进程 online，p5.js 重启计数 67、C++ 重启计数 1。

下一步仍在现有服务器上部署独立执行用户和 rootless Podman。网站后端保留 PM2；执行服务后续使用其专用用户的 systemd 用户服务管理，避免让学生程序接触网站账号、数据库配置和文件。所有可控制的新增目录仍集中在 `/var/www/teaching-cpp-backend` 和 `/var/www/teaching-cpp-runner`；系统需要的账号映射、服务单元与 `/run/user/<UID>` 等保留系统路径。

先检查安装前提，不直接运行通用部署示例。当前 `deploy/teaching-cpp-runner.service` 中仍为 `/opt/teaching-cpp` 和系统 Node 示例路径，后续须准备适配本机目录及专用 Node 的新单元，不能照抄启动。这个检查也不会运行 `runner/src/podman.mjs` 中会清理容器和启动探针的 `preflight()`。

2026-08-31 用户已回报采集结果：六项容器组件均未安装；shadow-utils 4.9-15.el9、systemd 252-55.el9_7.8.rocky.0.1 已安装，newuidmap/newgidmap 均存在。cpp-runner 账号与目录尚无；subuid/subgid 均仅见 apphttp:100000:65536，此范围保留。cgroup v2 控制器包含 cpu、memory、pids，user.max_user_namespaces=14483；/var/www 为 ext4、剩余 26GB、5280 无监听。基础条件支持继续准备，但尚未实测 rootless 容器、seccomp 或资源限制。下一步见 [Podman 安装清单预览](runner-install-plan-20260831.md)。

## 已完成的只读命令（以下保留历史，无需重复）

在 PuTTY 的 root 会话整段执行，将输出发回。出现“未安装”、账号或目录不存在，是安装前采集结果，不需要自行处理。`5280` 没有输出表示当前未监听。空的 `/etc/subuid` 或 `/etc/subgid` 也如实保留。

```bash
(
  set -u
  test "$(id -u)" -eq 0 || exit 1

  printf '\n【1. 已安装的容器相关组件】\n'
  rpm -q podman crun conmon shadow-utils fuse-overlayfs slirp4netns passt systemd

  printf '\n【2. 身份映射工具】\n'
  for cpp_tool in newuidmap newgidmap; do
    command -v "$cpp_tool" || printf '%s：尚未安装\n' "$cpp_tool"
  done

  printf '\n【3. 执行账号及目录】\n'
  getent passwd cpp-runner || printf 'cpp-runner 账号尚不存在\n'
  if [ -e /var/www/teaching-cpp-runner ] || [ -L /var/www/teaching-cpp-runner ]; then
    ls -ld /var/www/teaching-cpp-runner
  else
    printf '执行目录尚不存在\n'
  fi

  printf '\n【4. 已分配的用户映射范围】\n'
  for cpp_file in /etc/subuid /etc/subgid; do
    printf '%s\n' "$cpp_file"
    if [ -r "$cpp_file" ]; then
      cat "$cpp_file"
    else
      printf '文件不存在或不可读取\n'
    fi
  done

  printf '\n【5. 系统隔离条件】\n'
  stat -fc %T /sys/fs/cgroup
  cat /sys/fs/cgroup/cgroup.controllers
  for cpp_file in /proc/sys/user/max_user_namespaces /proc/sys/kernel/unprivileged_userns_clone; do
    if [ -r "$cpp_file" ]; then
      printf '%s：' "$cpp_file"
      cat "$cpp_file"
    fi
  done

  printf '\n【6. 运行目录所在磁盘及 5280 端口】\n'
  findmnt -no SOURCE,FSTYPE,OPTIONS -T /var/www
  df -h /var/www
  ss -H -ltnp 'sport = :5280'

  printf '\n采集结束：未安装软件、未改配置、未启动容器或重启服务。\n'
)
```

命令只查询 RPM 安装信息、专用账号、映射表、内核参数、文件系统和监听端口，不读取 `.env`、学生代码或登录信息。不运行 `dnf`、`podman info`、`podman run`、用户创建或任何启停命令，避免把环境采集变成容器初始化或软件安装。账户映射表只包含用户名及数字范围，不包含密码。

Rootless Podman 需要核对执行用户的 UID/GID 映射与本地存储，不能盲目复制一个可能已占用的范围；具体依据见 [Podman 官方 rootless 说明](https://docs.podman.io/en/latest/markdown/podman.1.html#rootless-mode)。程序本身还要求 systemd、cgroup v2 和 seccomp，后续会验证容器内限制实际生效，不能只凭包已安装就启用运行。

## 后续顺序

1. 根据本轮结果准备软件安装事务和独立账号、目录、映射范围；不升级或重启原站。
2. 准备固定的编译器镜像、内部令牌、执行用户的总资源限制及新服务单元。令牌仅在服务器生成并写入受限配置，不上传聊天。
3. 网站运行仍关闭时，验证单个固定程序的编译、标准输入、编译错误、文件隔离、终止及资源限制，再启动内部 `127.0.0.1:5280` 服务。
4. 内部检查通过后，再开启网站的运行功能并做浏览器验收；课堂负载与性能压测后续安排。

第一轮只读采集已完成，下一步仅预览安装事务。仍未安装 Podman、创建执行账号、下载镜像或启动执行服务。已发布的旧包、运行程序和配置模板未修改。
