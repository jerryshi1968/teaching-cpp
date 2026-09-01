# 启动内部 C++ 执行服务

2026-08-31 最新结果：本步骤已在服务器成功完成，记录 runner-service-start-zMMEp9，日志 runner-service-start-bb4ac3f67cec.log。内部认证、实际编译、CPU/137 对照及服务重启后记录恢复均通过，已保存该用户服务的开机设置；两站和用户管理器未重启，网页运行仍关闭。网页运行随后也已启用且首次网页运行通过；现在转到 [课堂功能检查](classroom-acceptance-20260831.md)，下方交付说明作为历史保留，不重跑本脚本。

2026-08-31，用户回报 CPU 计量修正及全部 18 项服务器验证通过，包括编译、隔离、CPU/墙钟时间、内存、输出上限、取消，以及两个 137 误判对照。私有记录为 `/var/www/teaching-cpp-backend/backups/compiler-check-03-1PGlAA`，日志为 `compiler-check-03-51f8fd4fe0a7.log`。执行入口已切换到新计量模块，两站及用户管理器未重启，网页运行仍关闭。

本步骤将执行器安装为 `cpp-runner` 的长期用户服务，只在 `127.0.0.1:5280` 接收带内部密钥的请求。先验证服务，再进行网站接入；本步骤不修改网站 `.env`，不开放网页“运行”。

## 上传与执行

用 WinSCP 只上传下面一个文件，保留 LF 换行。不需要上传整个项目，也不需要手工填写密钥或配置服务。

| 本地文件 | 服务器完整路径 |
| --- | --- |
| `G:\teaching-cpp\deploy\start-runner-service-20260831.sh` | `/var/www/teaching-cpp-backend/deploy/start-runner-service-20260831.sh` |

在 PuTTY 原来的 root 会话执行一次：

```bash
bash /var/www/teaching-cpp-backend/deploy/start-runner-service-20260831.sh
```

保持连接，等脚本结束后发回完整输出。不要同时运行旧脚本，不重复执行，不删除锁文件。脚本每 15 秒报告进度。

## 脚本会做什么

1. 核对 18 项完整记录、CPU 模块及执行入口摘要、旧测试任务已结束、5280 空闲、生产执行数据目录为空，以及原网站和账号总限额。
2. 在 cpp-runner 的用户服务内检查运行依赖、现有固定镜像及零容器状态。不下载、不重新构建镜像。
3. 自动生成 48 字节随机通信密钥，保存为 64 字符文本；新增 `.env.runner`，权限为 `root:cpp-runner 0640`。该文件没有数据库密码和网站 JWT 密钥。密钥不写入终端、服务命令行或 systemd 的 Environment 配置，网站账号此时不能读取。
4. 新增 `teaching-cpp-runner.service` 用户单元，用项目专用 Node 启动现有执行入口。启动自检仍验证 rootless Podman 及真实容器限额，失败时不会提供执行接口。
5. 检查服务真实 UID/GID、进程所在的 cgroup 和监听地址。无密钥、错误密钥必须返回 401；使用正确密钥，通过真实内部 HTTP 接口运行三个固定样本：两数之和、CPU 忙循环、主动返回 137。重复提交同一完成任务必须返回原结果。
6. **只重启本次新增的执行服务一次**，检查健康状态及三个任务记录恢复，确认没有残留容器。不会重启 p5.js、C++ 网站后端或 cpp-runner 用户管理器。
7. 全部通过后，为新执行服务保存开机启动设置。原先已经开启的 linger 保持不变，不修改 PM2 或其开机服务；本次不重启服务器，不能据此声称机器重启后的恢复已实测。

服务使用 `Restart=on-failure`，两次自动重启之间间隔 10 秒，5 分钟内最多启动 3 次；仍会另外检查应用健康状态，不能仅凭 systemd 启动命令成功认定可用。[systemd 252 服务说明](https://github.com/systemd/systemd/blob/v252/man/systemd.service.xml)

本步骤启动的是本项目限制了功能并要求密钥的执行接口，不启用 `podman.socket` 或 Podman 的远程管理 API。后者能操作整个容器引擎，本部署不需要开放。[Podman 管理接口说明](https://docs.podman.io/en/v5.8.0/markdown/podman-system-service.1.html)

## 文件和记录位置

| 用途 | 位置 |
| --- | --- |
| 新增执行服务私有配置 | `/var/www/teaching-cpp-backend/.env.runner` |
| 新增用户服务单元 | `/var/www/teaching-cpp-runner/.config/systemd/user/teaching-cpp-runner.service` |
| 服务任务记录与临时编译目录 | `/var/www/teaching-cpp-runner/runner-data`，沿用已有目录 |
| 服务运行日志 | 系统已有的 journal；失败时脚本自动摘取脱敏摘要 |
| 安装操作日志 | `/var/www/teaching-cpp-backend/logs/runner-service-start-随机名.log` |
| 私有检查记录 | `/var/www/teaching-cpp-backend/backups/runner-service-start-随机名` |
| 防重复锁 | `/var/www/teaching-cpp-backend/backups/runner-service-start.lock` |

三个固定测试任务不进入业务数据库，不属于任何学生或教师作品。其小型结果记录保存在执行目录，按现有一天保留策略清理；编译临时目录和容器应在任务结束后清理。

账号合计资源上限保持为 1 GiB 内存、1 核 CPU、256 个进程/线程、swap 0。本步骤不是课堂并发或负载验收。

## 如果失败

脚本会保留配置、任务与日志。若已经请求启动本次新增服务，会尝试停止这一服务；若已经尝试设置开机启动，会同时尝试撤回该设置。停止失败会明确报告，不宣称已经停止。不会重启网站、删除未知容器、修改镜像、移除旧记录或自动再试。

发回完整终端输出即可，不要上传 `.env`、`.env.runner` 或通信密钥。后续会根据私有记录安排接续，不要求重跑本脚本。

## 验证范围

本地新增检查覆盖配置保密、错误的服务状态/监听地址、实际 HTTP 认证、任务去重和记录恢复、错误结果拒绝、Windows 上拒绝 Linux 入口以及文件摘要。HTTP 与恢复检查在本地使用模拟执行器，不把这些检查当成 Linux 容器验收。

交付时，真正的长期 systemd 用户服务、5280 接口、三个容器样本及服务重启尚待服务器验证。用户随后于 13:16:52Z～13:17:05Z 回报全部通过；网页编译运行尚未开放，真实机器重启恢复也未验证。

本地最终检查：新增 12 项通过；完整 291 项中 290 项通过、1 项可选 MySQL 跳过。Bash/Node、序列化检查程序、UTF-8 无 BOM/LF、16 个既有脚本摘要和 46 个原清单项检查通过。

```text
start-runner-service-20260831.sh
SHA256: cf186cef1cf732a7134b83b9fe081ace3859a6b8809125409500cf76f12d09be
```
