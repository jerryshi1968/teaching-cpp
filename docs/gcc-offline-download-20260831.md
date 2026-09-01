# 在 Windows 下载 GCC 镜像，再上传服务器

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

2026-08-31 最新结果：基础镜像已导入，但后续教学镜像构建在 11:44:49Z 返回 IMAGE_BUILD_FAILED。编译与隔离测试尚未开始，退出前两个网站复核正常。现在只按 [构建失败只读诊断](compiler-build-diagnostic-20260831.md) 提取错误；不要重跑本页的旧步骤。

2026-08-31 最新结果：用户已完成服务器离线导入，11:23:00.164Z 镜像内容核验及两站复核通过。不要重跑本页下载、诊断或导入步骤。下一步只按 [教学镜像与真实容器验证](compiler-containers-20260831.md) 上传新脚本；真实编译和执行服务尚未完成。下方保留此前步骤及当时记录。

2026-08-31 最新结果：用户已成功运行本页下载入口，官方镜像各层校验通过；生成的约 515 MiB 离线归档再次经本地独立复核通过。下载已完成，不要重跑或重新下载。下一步只按 [服务器离线导入](gcc-offline-import-20260831.md) 上传镜像包和新脚本。本页下方保留原下载操作及当时验证记录，服务器实际导入仍待回报。

用户希望自行下载，以避开服务器反复超时。本步改用 Windows 本地网络，不需要安装 Docker、Podman、WSL 或申请管理员权限。服务器上的网络诊断可以暂缓；不会继续原服务器下载任务。

## 官方地址

需要的是 Docker 官方 GCC **14.4.0 / Linux amd64 容器镜像**，不是 Windows 的 GCC 安装程序，也不是 GNU GCC 源代码压缩包。官方镜像页面：[Docker Hub GCC](https://hub.docker.com/_/gcc)。该页面给出镜像拉取方式，没有找到可供浏览器直接下载的完整离线 `.tar` 包。

本地下载入口使用 `google/go-containerregistry` 项目的便携 `crane` 工具。该工具直接读取镜像仓库，无需本机 Docker 引擎；OCI 格式输出为目录，再由 Windows 自带的 tar 打包。[官方项目说明](https://github.com/google/go-containerregistry)、[固定版本 pull 实现](https://github.com/google/go-containerregistry/blob/v0.22.0/cmd/crane/cmd/pull.go)

## 只需两步

1. 用浏览器下载 [Windows x64 官方工具压缩包](https://github.com/google/go-containerregistry/releases/download/v0.22.0/go-containerregistry_Windows_x86_64.tar.gz)，约 16 MB。**这是下载工具，不是 GCC 镜像本体。** 将原压缩包保存到 `G:\teaching-cpp\downloads\gcc-offline-20260831\`，保留文件名 `go-containerregistry_Windows_x86_64.tar.gz`，不需要解压。
2. 双击 `G:\teaching-cpp\deploy\download-gcc-offline-20260831.cmd`。不要使用管理员身份，也不要同时打开多个下载窗口。它会调用旁边的 `.mjs` 文件，先核对工具摘要，再下载约 515 MiB 的镜像层，逐个核对摘要并打包。

入口使用电脑现有 Node，优先 `D:\Program Files\nodejs\node.exe`，不安装或升级 Node。G 盘要求至少 4 GiB 空闲空间，用于下载缓存、OCI 文件和最终归档。

完成后，这个目录中会新增：

```text
G:\teaching-cpp\downloads\gcc-offline-20260831\
  gcc-14.4.0-linux-amd64.oci.tar
  gcc-14.4.0-linux-amd64.oci.tar.sha256
  gcc-14.4.0-linux-amd64.oci.tar.json
```

将成功输出末尾发回对话。下一步再准备上传目录与服务器导入脚本；不要把它当普通文件包解压到网站目录，也不要现在用 root 执行 `podman load`。Podman 支持 OCI 归档，但仍需用 `cpp-runner` 的资源环境导入并核验。[Podman load](https://docs.podman.io/en/v5.8.0/markdown/podman-load.1.html)

## 校验和影响范围

- 固定镜像引用：`docker.io/library/gcc@sha256:6cc8e40ae136aea7c6b064124d2c09417e4649aacf22e6785ea03bd37185064c`。
- 固定配置摘要：`sha256:6b4bd930afb1272016c64651ed6192f519f666edf9255213ad09c5cbdd657723`。这与前面服务器下载步骤的目标一致，没有更换镜像。
- 工具固定版本 0.22.0，压缩包 16,537,478 字节，SHA256 为 `2d4ce27bde9bd3b511bd7c0b5a4c9654dbadf43ee1da9eac083e6f1511282b32`，已通过官方 GitHub 发布 API 只读核实。[固定发布记录](https://github.com/google/go-containerregistry/releases/tag/v0.22.0)
- 先核验工具包再提取其中的 `crane.exe`，仅写入本项目下载目录，不增加系统 PATH、不安装服务。
- 使用独立空凭据目录拉取公开镜像，不读取本机 Docker 登录信息。保留用户已有网络代理环境但不打印其值；不会配置或自动发现浏览器代理。
- 全程保持 HTTPS 校验，不启用不安全连接。下载完成后独立核对官方清单、配置、架构、版本和全部 8 个镜像层的原始字节 SHA256；添加 OCI 导入名称不会改动镜像清单和镜像层。
- 下载任务有 30 分钟上限，每 15 秒提示状态；已完成的层可由工具缓存复用，不承诺未完成层的字节级断点续传。异常中止后不要删除目录，把错误码发回即可。
- 不访问 Linux 服务器，不重启网站，不启用 C++ 运行。服务器旧下载临时任务的最终状态仍待核查，可以在后续离线导入预检中处理。

本地网络与服务器网络不同，因此可能解决服务器超时，但不能保证电脑一定能访问 Docker 官方仓库。浏览器能访问 GitHub，不代表下载工具一定能访问镜像仓库；如果只有浏览器配置代理，下载工具不一定使用同一条网络线路。

## 本地验证记录

Node 语法检查通过，Windows 启动入口的缺少工具提示及退出码已实际验证，没有执行镜像下载。新增 4 项检查通过，覆盖固定摘要一致性、清单/配置篡改拒绝、实际层内容校验与错误信息脱敏。实际工具拉取和服务器 OCI 导入尚未执行，不能记录为已成功。

本轮完整检查 212 项，211 项通过、1 项可选 MySQL 跳过；原服务器下载和诊断脚本摘要保持不变。
