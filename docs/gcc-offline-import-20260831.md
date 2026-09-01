# 将已下载的 GCC 镜像离线导入服务器

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

2026-08-31 最新结果：基础镜像已导入，但后续教学镜像构建在 11:44:49Z 返回 IMAGE_BUILD_FAILED。编译与隔离测试尚未开始，退出前两个网站复核正常。现在只按 [构建失败只读诊断](compiler-build-diagnostic-20260831.md) 提取错误；不要重跑本页的旧步骤。

2026-08-31 最新结果：用户已完成服务器离线导入，11:23:00.164Z 镜像内容核验及两站复核通过。不要重跑本页下载、诊断或导入步骤。下一步只按 [教学镜像与真实容器验证](compiler-containers-20260831.md) 上传新脚本；真实编译和执行服务尚未完成。下方保留此前步骤及当时记录。

2026-08-31，用户已在 Windows 成功下载官方 GCC 14.4.0 / Linux amd64 镜像。下载器核验了清单、配置和全部 8 个压缩层；随后再次读取本地归档，独立核对文件大小、SHA256、归档目录及清单/配置原始字节。当前只准备服务器离线导入，尚未执行服务器导入或容器编译。

## 上传两个文件

用 WinSCP 的 root 连接上传以下文件。镜像包使用二进制传输；脚本保留原有 LF 换行。不要解压镜像，也不要覆盖其他部署文件。

| 本地文件 | 服务器完整路径 |
| --- | --- |
| `G:\teaching-cpp\downloads\gcc-offline-20260831\gcc-14.4.0-linux-amd64.oci.tar` | `/var/www/teaching-cpp-backend/gcc-14.4.0-linux-amd64.oci.tar` |
| `G:\teaching-cpp\deploy\import-gcc-base-image-20260831.sh` | `/var/www/teaching-cpp-backend/deploy/import-gcc-base-image-20260831.sh` |

本地 `.tar.sha256`、`.tar.json` 留存即可，不必上传。文件大小和校验值已经固定在导入脚本中，不依赖服务器上可被一起改动的校验文件。不要上传便携工具、缓存或 `attempt-*` 目录。

确认 WinSCP 的两个传输均完成后，在 PuTTY 的 root 会话执行一次：

```bash
bash /var/www/teaching-cpp-backend/deploy/import-gcc-base-image-20260831.sh
```

保持 PuTTY 连接，等待最终结果。解压镜像层需要时间，脚本会输出进度；导入子进程上限 15 分钟，临时用户服务总上限 20 分钟。请发回完整终端输出。发生错误时，不要重跑、删除锁文件、清理镜像或改用 root 的 Podman。

## 本步骤会做什么

1. 核验已经完成的账号、委派和 rootless 初始化记录，读取上次失败下载任务的确切单元状态与所属进程，确认已结束。若状态不能确认，先停止本次导入，不强行停止或重启服务。
2. 核验上传文件的实际 SHA256、大小、所有权及路径；检查原网站、执行关闭状态、端口和磁盘余量。保留账号总限额：内存 1 GiB、CPU 1 核额度、进程/线程合计 256、swap 0。
3. 在应用后端的 `imports/gcc-base-随机名/` 中建立一份只读副本，归 root 所有，仅允许 `cpp-runner` 所属组读取。原上传文件保留，副本额外占用约 515 MiB。不会把镜像内容解压到网站公开目录。
4. 在 `cpp-runner` 的用户服务内从本地文件加载镜像，使用现有独立镜像库和临时目录。不会请求 Docker 镜像仓库，也不会运行容器。Podman 支持从本地 OCI 归档加载镜像；本脚本明确拒绝 URL 输入。[Podman load 官方说明](https://docs.podman.io/en/v5.8.0/markdown/podman-load.1.html)
5. 核对完整镜像 ID、Linux/amd64、配置中的 GCC 14.4.0，以及全部 8 个解压层摘要及顺序；确认镜像数为 1、容器数为 0。随后复核网站、配置、资源限额、用户管理器与 PM2 进程未变。

导入后的存储清单摘要及仓库名称可能与在线拉取时的展示不同。脚本不伪造 `RepoDigests`，也不依靠标签名称判定身份：来源由固定归档校验值和原始清单摘要证明，实际导入内容由完整配置 ID 与全部层摘要核对。[Podman 镜像检查字段](https://docs.podman.io/en/latest/markdown/podman-image-inspect.1.html)

本步骤不创建 `.env.runner`，不启用 5280，不修改 Apache、数据库或 C++ 运行开关，不重启两个网站。它会启动一次用于导入镜像的临时用户服务，镜像加载本身仍会使用 CPU、内存和磁盘；账号限额保持，但不承诺完全没有磁盘 I/O 影响。

## 记录与保留文件

- 操作日志：`/var/www/teaching-cpp-backend/logs/gcc-base-import-随机名.log`。
- 私有操作记录：`/var/www/teaching-cpp-backend/backups/gcc-base-import-随机名/`。
- 只读副本：`/var/www/teaching-cpp-backend/imports/gcc-base-随机名/gcc-14.4.0-linux-amd64.oci.tar`。
- 防重复标记：`/var/www/teaching-cpp-backend/backups/gcc-base-import.lock`。通过预检、进入导入准备后才创建；成功或失败后都保留。不要自行删除后重跑。

记录包括旧任务状态、导入任务状态、校验结果和前后检查。导入失败时保留已有镜像层、归档和记录，不自动清理。先根据输出决定如何接续。

## 已核验的文件

离线归档由用户于 `2026-08-31T10:46:33.370Z` 生成：

```text
文件：gcc-14.4.0-linux-amd64.oci.tar
大小：540504576 字节
SHA256：4190852b88d938f8695a3208bcc76aaed5818b27556727d66541f2d508cac4fc
原始镜像清单：sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c
镜像配置 ID：sha256:6b4bd930afb1272016c64651ed6192f519f666edf9255213ad09c5cbdd657723

脚本：import-gcc-base-image-20260831.sh
SHA256：e60a156fcfee77ee2c9ab26cbe5c43099d25b0e2eccdd7552daba5df387e8fd6
```

本地新增 10 项检查通过，覆盖旧任务状态、归档权限与内容身份、层顺序、平台版本、仅允许本地文件输入和失败结果拒绝。完整检查 222 项：221 项通过、1 项可选 MySQL 跳过。Bash/内嵌 Node 语法、UTF-8 无 BOM/LF 通过；原先 10 个服务器脚本及 46 个发布材料清单项保持不变。本机没有执行 Linux 导入，服务器实际结果仍待回报。

成功导入仅表示官方基础镜像已准备好。之后还要构建教学镜像、验证真实容器的权限隔离和资源限额，并实测编译及输入输出；这些通过后才安排启动执行服务和开放“运行”。
