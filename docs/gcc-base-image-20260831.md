# 第 10 步 F：下载并核验 GCC 基础镜像

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

2026-08-31 最新结果：基础镜像已导入，但后续教学镜像构建在 11:44:49Z 返回 IMAGE_BUILD_FAILED。编译与隔离测试尚未开始，退出前两个网站复核正常。现在只按 [构建失败只读诊断](compiler-build-diagnostic-20260831.md) 提取错误；不要重跑本页的旧步骤。

2026-08-31 最新结果：用户已完成服务器离线导入，11:23:00.164Z 镜像内容核验及两站复核通过。不要重跑本页下载、诊断或导入步骤。下一步只按 [教学镜像与真实容器验证](compiler-containers-20260831.md) 上传新脚本；真实编译和执行服务尚未完成。下方保留此前步骤及当时记录。

2026-08-31 后续安排：Windows 离线下载已成功，本地归档复核通过；现在只按 [服务器离线导入](gcc-offline-import-20260831.md) 上传镜像包和新脚本。本页下方服务器诊断或下载命令保留为此前记录，暂不执行或重跑。服务器实际导入仍待验证。

2026-08-31 最新结果：09:52:35Z 元数据请求因 ETIMEDOUT 中断，未执行 Podman pull。现在只按 [镜像仓库超时诊断](gcc-registry-diagnostic-20260831.md) 执行新诊断脚本；下方下载命令是此前操作记录，暂不重跑。失败前的网站和资源检查通过；失败后的临时任务状态与外网原因待核查。

2026-08-31 用户回报：CPU 委派修复与 rootless Podman 初始化检查于 `09:32:09.206Z` 完成。实际 UID/GID 映射、rootless、systemd、cgroup v2 和 seccomp 支持检查通过；账号总限额保持，两个网站进程与配置前后核验不变。当前镜像 0、容器 0，C++ 写入开启、编译运行关闭。

本步只下载并核验官方 GCC 基础镜像，不构建教学镜像，不运行容器或学生代码，不安装宿主机 GCC，不修改网站或启动执行服务。

## 操作方法

1. 用 WinSCP 将 `G:\teaching-cpp\deploy\prepare-gcc-base-image-20260831.sh` 上传到服务器 `/var/www/teaching-cpp-backend/deploy/`，只上传这个新文件。
2. 在 PuTTY 的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/prepare-gcc-base-image-20260831.sh
```

下载压缩层合计约 **515 MiB**，耗时取决于服务器连接 Docker 官方仓库的速度。保持 PuTTY 连接，脚本在下载期间约每 15 秒报告用时和磁盘余量。结束后发回完整输出。

不需要上传本地元数据文件或自行填写摘要。不要手动重复执行旧准备、初始化或修复脚本。失败后保留输出和缓存，不重复下载、不运行清理命令，也不自行更换镜像源。

## 镜像选择和证据

选择官方 GCC **14.4.0 / Linux amd64**，对应 Debian trixie 基础镜像。官方清单列出了这一版本和架构；官方构建文件安装编译器到 `/usr/local`。[Docker 官方 GCC 清单](https://github.com/docker-library/official-images/blob/master/library/gcc)、[对应 GCC 构建文件](https://github.com/docker-library/gcc/blob/d0fb67beca5c8248b88c7e5271ab34b4fdb279a0/14/Dockerfile)

本机已从 Docker Hub 与官方 Registry 取得公开元数据，并逐字节核验索引、amd64 清单和配置的 SHA256，未下载镜像层。记录在 `G:\teaching-cpp\deploy\compiler-image-evidence-20260831.json`；临时匿名拉取令牌未写入文件或输出。

| 项目 | 固定值 |
| --- | --- |
| 查询版本 | `docker.io/library/gcc:14.4.0` |
| 多架构索引 | `sha256:88134abee5c979390be4fedf9af2635e324004f0f3c1266a8c924c7a08e69500` |
| 实际下载的 amd64 清单 | `sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c` |
| 配置摘要 / 预期基础镜像 ID | `sha256:6b4bd930afb1272016c64651ed6192f519f666edf9255213ad09c5cbdd657723` |
| 压缩层总量 | 540,483,496 字节，共 8 层 |

服务器实际按完整仓库名与 amd64 摘要下载，不跟随移动标签，不使用 `latest`，并明确启用 HTTPS 证书校验。Podman 支持按摘要拉取镜像，拉取后的镜像检查可返回 ID、清单摘要、仓库摘要和平台信息。[Podman pull](https://docs.podman.io/en/v5.8.0/markdown/podman-pull.1.html)、[Podman image inspect](https://docs.podman.io/en/latest/markdown/podman-image-inspect.1.html)

GCC 14.4.0 用作本平台首版教学编译器，继续使用既定 C++14/C++17 编译选项，不宣称与所有 GESP 或 CSP 正式比赛环境一致。本步只核对版本元数据，尚未执行 `g++ --version` 或真实编译。

## 资源和操作范围

- 操作前核对已完成的修复、初始化记录、当前普通用户身份、用户管理器状态、总限额、两个网站和 PM2 状态。
- 下载命令由 `cpp-runner` 的临时用户服务运行，保持原有 1 GiB 内存、1 核 CPU、256 个进程/线程、swap 0 总限额。不会使用 rootful Podman，也不重启用户管理器。
- 下载前要求至少 8 GiB 可用磁盘；下载期间监测余量，低于 4 GiB 即请求停止。拉取命令有 25 分钟时限，临时服务另有 30 分钟总时限；停止只针对本次下载任务，已有镜像缓存保留。
- 镜像放在 `/var/www/teaching-cpp-runner/.local/share/containers/storage`，临时文件使用该账号的 `tmp` 目录。日志和私有记录仍放在 C++ 后端原目录，不新增其他应用目录。
- 先在用户服务中核对 rootless 环境和空镜像库，再通过官方 HTTPS 元数据验证固定清单，之后才下载镜像。完成后校验配置 ID、清单摘要、官方仓库引用、平台、版本元数据及层数，并确认镜像 1、容器 0。
- 下载后重新核对网站配置、账号/映射、NSS、原限额、用户管理器 PID、PM2 PID/重启计数以及两个网站 HTTPS。不会修改 `.env`、Apache、数据库、原系统模板或执行开关。

新日志：`/var/www/teaching-cpp-backend/logs/gcc-base-image-*.log`。新私有记录：`/var/www/teaching-cpp-backend/backups/gcc-base-image-*`。公开终端只显示必要进度和错误码，原始 Podman 输出留在 root 私有记录中，不需要将整个目录发到对话。

成功结果的 `stage` 为 `official-gcc-base-image-ready`。此时下载的是**基础镜像**，还不是最终教学镜像：后续需使用项目现有 Containerfile 准备教学镜像，验证真实容器挂载、隔离、编译和限额，再配置执行服务。不要现在填写 `CPP_COMPILER_IMAGE` 或开启 `CPP_RUN_ENABLED`。

## 已完成步骤的记录

- 修复日志：`logs/rootless-delegation-repair-f939ef15d52a.log`；私有记录：`backups/rootless-delegation-d6YPe9`。
- 初始化日志：`logs/rootless-resume-76f2d4f96ebd.log`；私有记录：`backups/rootless-resume-0gFyZA`。
- 修复已为 `user@994.service` 增加专属 CPU 委派，并限定重启这个用户管理器。本次输出没有展开新的用户管理器 PID，不能继续使用诊断时的旧 PID 3396803 作为当前值。
- `podman info` 和用户命名空间映射已实测；真实容器尚未运行，不能将这一步记为容器隔离或编译验收通过。

## 本地验证

新增 10 项检查通过，覆盖官方元数据与固定摘要的对应关系、错误镜像/平台/版本拒绝、rootful/远程引擎/错误映射与存储路径拒绝、下载前后镜像数量、磁盘余量及实际用户服务程序的语法。完整检查共 199 项，198 项通过、1 项可选 MySQL 跳过。Bash/内嵌 Node 语法和 UTF-8 无 BOM / LF 检查通过。

本机只读取了公开镜像元数据，没有执行 Linux 下载服务或拉取镜像层。服务器随后回报元数据请求超时，当前尚未下载镜像层；详见页首最新结果。

脚本 SHA256：`fe0332f60b308410b871774f7de67c195cbed53d8ce47f89fb970d833492015b`。
