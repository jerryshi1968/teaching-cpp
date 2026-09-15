# Rocky Linux 单服务器部署与验证

> **按你现有服务器部署，请改看 [Apache + PM2 逐步部署指南](deployment-apache-pm2.md)。**
> 已确认原站后端端口为 5080，使用 Apache 和 PM2；C++ 暂定使用 5180/5280，并将应用目录集中在 `/var/www` 下。
> 你已明确选择在当前生产服务器操作。后续按“核对环境 → 备份 → 审查并迁移/兼容 → 部署”的顺序进行，不再将另一套测试环境作为开始部署的前提。正式开放写入前仍须完成旧平台类别隔离。
> 本文件下方保留原通用说明作为背景参考，其中 Nginx、`/opt`、`/var/lib` 和业务后端 systemd 示例**不是此次部署操作步骤**，请不要照抄执行。

本说明是交付材料，所列服务器操作尚未执行。生产迁移、修改原站、安装容器组件及发布前应单独确认。当前已知：2 核、4GB 内存、无 Swap、40GB 系统盘约剩 26GB，Rocky Linux 9.7，运行内核 `5.14.0-503.38.1.el9_5.x86_64`，cgroup v2，SELinux Disabled，原站与 MySQL 同机。

不需要第二台 Linux。测试采用同机独立数据库、独立测试账号、独立存储目录和不对公网开放的端口，不能拿生产数据试迁移或压测。

## 1. 部署分工


| 组件                | 端口/路径                                            | 权限                                         |
| ----------------- | ------------------------------------------------ | ------------------------------------------ |
| 现有 p5.js 和公共身份服务  | 保留现有配置，后端假定本机 5080                               | 原有账号、班级、余额服务                               |
| C++ 业务 API 与构建后前端 | `127.0.0.1:5180`；公网 `/teaching-cpp/`、`/api/cpp/` | 普通系统用户 `cpp-web`、受限 MySQL 账号               |
| C++ 执行服务          | `127.0.0.1:5280`，**不设公网代理**                      | 独立普通用户 `cpp-runner`、rootless Podman，无数据库凭据 |
| C++ 正式源码          | `/var/lib/teaching-cpp/sources`                  | 仅 `cpp-web` 可读写，不做静态目录                     |
| 运行目录和内部结果         | `/home/cpp-runner/runner-data`                   | 仅 `cpp-runner` 可读写，当前任务结束后删除源码和二进制         |


应用代码可以在 `/opt/teaching-cpp`，由管理员拥有、服务用户只读。数据库配置在 `/etc/teaching-cpp/backend.env`，执行服务配置在 `cpp-runner` 自己的 `~/.config/teaching-cpp/runner.env`；两者不能互相可读。不要把后端密钥复制到执行用户家目录、镜像或挂载目录。

前端正式配置固定为 `/teaching-cpp/`。`deploy/nginx-cpp.conf.example` 仅是应合并到现有 HTTPS server 的 location 片段；不可覆盖证书、整个 server、原 `/api/` 或 `/teaching-p5js/`。

## 2. 软件与 rootless 前置条件

通过 Rocky 官方软件源核对并安装 Podman、用户命名空间辅助组件、合适的 OCI runtime、fuse-overlayfs；不要下载并执行不明安装脚本。Node.js 使用维护中的 LTS，至少 22.12。实际包名、当前版本、磁盘占用和可用 Node 路径应安装时核对，本项目不替换原站 Node 环境。

为执行用户分配独立且不与他人重叠的 `/etc/subuid`、`/etc/subgid` 区间，并启用该用户的 systemd user manager / lingering。使用该用户自己的登录会话验证 `podman info`，不能把 `sudo podman` 的 rootful 成功当作 rootless 成功。运行目录须支持执行二进制；如果所在挂载点是 `noexec`，不要关闭全局防护，应另选受控工作目录。

官方文档说明 rootless 的资源限制受 cgroup 与权限配置影响，因此服务启动时会实际读出容器内 `memory.max`、`pids.max`、`cpu.max`、`memory.swap.max`。值不符合预期即拒绝启动，禁止改成无限制运行。参见 [Podman run 参数](https://docs.podman.io/en/stable/markdown/podman-run.1.html) 与 [Podman info](https://docs.podman.io/en/stable/markdown/podman-info.1.html)。

不要为此切换到 cgroup v1，不要默认关闭防火墙或增加 `--privileged`，也不要挂载容器引擎 socket。当前 SELinux 已关闭，不代表 rootless 容器能消除内核漏洞风险。需安排系统内核和容器组件安全维护；不要在此步骤擅自重启正在上课的服务器。

## 3. 编译器镜像

由执行用户事先拉取、审查并固定官方 GCC 基础镜像的 RepoDigest，再用 `runner/Containerfile` 构建。首版可选择满足课堂教学需要的 GCC 版本，记录 `g++ --version`，不要宣称与正式比赛环境一致。官方镜像入口：[GCC Docker Official Image](https://hub.docker.com/_/gcc)。

示意命令（在独立执行用户会话中，替换已核验的摘要）：

```bash
cd /opt/teaching-cpp
podman build --build-arg GCC_BASE=docker.io/library/gcc@sha256:REPLACE_WITH_VERIFIED_DIGEST -f runner/Containerfile -t localhost/teaching-cpp-gcc:reviewed .
podman image inspect localhost/teaching-cpp-gcc:reviewed --format '{{.Id}}'
```

将最后的完整镜像 ID 规范成 `sha256:` 加 64 位十六进制，填入业务配置和执行配置的 `CPP_COMPILER_IMAGE`，两边相同。应用只使用已经安装的固定镜像 ID，任务中不会联网拉镜像。镜像不能包含密码、私人代码、业务配置或额外挂载。

Containerfile 使用官方镜像的 `/usr/local/bin/g++`，首版命令固定 `-std=c++17` 或 `-std=c++14`、`-O2 -Wall -Wextra -fdiagnostics-color=never`。不接受用户输入编译参数、文件路径、shell 命令或任意镜像。

## 4. 固定初始限制


| 项目                 | 初始值                                     |
| ------------------ | --------------------------------------- |
| 业务全局未完成任务（含执行中）    | 20                                      |
| 每用户未完成任务           | 1                                       |
| 编译与运行合计并发          | 1                                       |
| 编译容器内存 / 进程数       | 512MiB / 64                             |
| 运行容器内存 / 进程数       | 256MiB / 16                             |
| 容器 CPU 配额          | 最多 1 核                                  |
| 编译 / 运行墙钟时间        | 20 秒 / 5 秒                              |
| 编译 / 运行单进程 CPU 软上限 | 15 秒 / 3 秒，硬上限再加 1 秒                    |
| 编译信息上限             | stdout + stderr 合计 256KiB               |
| 程序输出上限             | stdout + stderr 合计 256KiB               |
| 项目源码 / stdin      | 最多 64 个文件；单文件 128KiB、源码总计 512KiB / stdin 256KiB；序列化快照上限 1MiB |
| 编译产物文件上限           | 16MiB；运行时工作目录只读                         |
| 容器临时目录             | 64MiB，noexec/nosuid/nodev               |
| 历史源码及结果缓存          | 24 小时，每用户 100MiB，全局默认 2GiB              |
| 磁盘余量保护             | 默认至少保留 1GiB 可用空间                        |


时间和资源默认值是可验证的保守初值，不是这台服务器的性能承诺。运行内存峰值尚未采集，界面明确显示 `—`。需要更大内存的竞赛题应先评估，再调整受控配置和验证，不能让学生自己提交资源参数。

除业务侧墙钟定时器外，还设置容器监控进程的独立超时（编译 25 秒、运行 10 秒），用于执行服务异常退出时的兜底；禁止继承宿主机代理环境变量。真实验证时也要检查异常退出后的容器能否被终止。

缓存清理在保存、运行提交/结束和定时维护时触发，剔除最旧历史；当前正式源码和未完成任务快照受到保护。每个用户最多 1000 个正式项目、200 个作品组。正式源码不属于一天缓存，可能持续增加，需配合磁盘监控、账号管理和备份。运行服务的内部结果另有全局 100MiB 短缓存，用于断线重连；工作目录不保留历史二进制。

## 5. 同机独立数据库测试

先由数据库管理员建立全新的空库，例如 `teaching_cpp_test`，MySQL 8.x、utf8mb4/utf8mb4_0900_ai_ci。不要从线上拷贝真实账号、密码或作品。配置 `APP_MODE=test`、`DB_NAME=teaching_cpp_test`、独立数据库账号和独立 `CPP_STORAGE_ROOT`。

创建仅含虚拟账号、没有密码的参考结构，再执行兼容迁移：

```text
npm run db:fixture -- --confirm-empty-test-db
npm run db:migrate
npm run db:migrate -- --apply --confirm-db teaching_cpp_test
```

迁移入口按顺序登记 `001_cpp` 与 `002_cpp_multifile`；后者只为 C++ revisions/runs 增加按项目清理索引，不修改共享 `files` 表结构，也不把源码正文写入数据库。

`db:fixture` 拒绝非空库、非 `_test` 库和生产模式。它用于数据库合同测试，不是新建另一套注册登录系统。`db:migrate` 无 `--apply` 时只输出 SQL；显式应用时核对目标库、基础表、主键类型和字符排序规则。

MySQL DDL 通常会隐式提交，**本迁移不是可整体自动回滚的事务**。脚本登记校验和与完成语句数；中途失败后拒绝盲目重试，需要先审查实际结构或恢复这个独立测试库。完成后重复执行相同迁移会直接报告已完成，不重复 ALTER。

可选真实数据库测试：

```bash
CPP_MYSQL_TEST=1 node --test tests/mysql.test.mjs
```

这个测试仍强制 `APP_MODE=test` 和 `_test` 后缀，使用虚拟用户 2，删除的仅是本次创建的测试项目。生产运行账号不应有结构修改权限；授权范围见 `deploy/mysql-grants.sql.example`。

完整公共身份联调需使用连接同一测试库的公共身份服务实例及测试账号，不能用生产登录 ID 冒充测试身份。单纯体验界面可用默认 demo；它不连接任何身份服务。

## 6. 验证真实编译服务

在独立测试执行用户下配置 `.env.runner` 或同名环境变量；不要与该用户的正式 runner 同时运行。以下命令会获取独占实例锁、预检 rootless 限制、编译几个固定测试程序，不连接 MySQL：

```text
npm run test:linux -- --confirm-isolated-test
```

基础检查包含标准输入输出、编译失败、工作目录只读、看不到网站配置。稍后安排资源检查时才加 `--include-limits`，它会在有上限的容器中验证超时、输出上限和内存上限。这不是课堂压力测试。当前开发电脑没有 Linux Podman，本次没有执行这些命令。

验证单任务后，再测试浏览器运行、排队取消、运行中停止、执行服务重启、暂时断连。停止必须直到容器已删除并核对不存在才确认；无法核对时保持“正在停止”，不接下一项。

## 7. systemd 与服务配置

上传源文件、锁文件和已构建前端；不上传 Windows `node_modules`、`.npm-cache`、演示 storage、任何真实 `.env` 或旧项目文件。在 Linux 新目录执行 `npm ci --omit=dev`；如在服务器构建，需要先完整安装依赖并 `npm run build`。低配置服务器建议本机构建前端、Linux 只安装运行依赖。

`deploy/teaching-cpp.service` 是系统服务示例；`deploy/teaching-cpp-runner.service` 是 **cpp-runner 用户的 user 服务**。核对实际 Node 路径，创建目录并设置仅相应用户可写，配置文件权限 600，源码目录只读。业务与执行令牌使用本机生成的高强度随机值，至少 32 个字符；不要放入命令 URL、聊天消息或 Git。

runner 使用 systemd user / cgroup v2 委派。容器可能在独立 scope 中，因此仅限制 Node runner 服务的 MemoryMax 不一定覆盖容器。应把 `deploy/runner-user-slice.conf.example` 放入 **该执行用户 UID 对应**的 slice drop-in，限制整个执行用户合计内存 1GiB、CPU 1 核、进程 256，并核对实际生效范围。不要套到整个 `user.slice`。

业务后端初值 MemoryMax=384MiB。原站和 MySQL 的占用保持观察，不在此自动修改 MySQL 配置、Swap 或原站服务。原站空闲并不能替代实际安全与负载测试。

生产配置需要：`APP_MODE=production`、数据库名和专用账号、原身份服务本机地址、独立源码根目录、同一固定镜像 ID 和内部令牌。先保持 `CPP_RUN_ENABLED=false`、`CPP_PRODUCTION_WRITES=disabled`，验证只读启动。正式写入开关只能在下一节审查通过后设置。

## 8. 发布和回退顺序

1. 备份原站代码、原源码目录、共享数据库，并确认可恢复。开始记录迁移与发布版本。
2. 独立测试库验证迁移和 `docs/p5js-compatibility.md` 中的交叉类别测试。先审查原站最小补丁，保留其全部注释。
3. 在生产维护窗口应用兼容新增迁移，使用与运行账号分离的临时迁移权限。生产脚本额外要求 `--backup-confirmed --production-reviewed`；这些标志只是操作者确认，不会自动创建备份。
4. 部署原 p5.js 的已审查类别过滤补丁，完成原有功能回归。没有此步骤，不开放 cpp 写入。
5. 部署 C++，固定镜像、预检容器、核对用户 slice。合并 Nginx 片段，经 `nginx -t` 验证后平滑加载，保留全部原站位置和证书配置。
6. 确认统一身份、权限、同源作品内容安全和后端限制，设置 `CPP_PRODUCTION_WRITES=enabled-after-p5js-review`，随后按验证结果启用 `CPP_RUN_ENABLED=true`。先内部小班使用，后开放公众。
7. 后续升级编译配置或镜像前先关闭新提交、排空/停止已有队列；保留旧镜像到任务确认结束。不能把排队中的旧快照改用新编译配置。

需要回退时先关闭 C++公网入口和新提交，停止/确认容器任务，再停止 C++ 服务。保留共享表新增字段、cpp 数据与源码，原平台继续按类别过滤。**不要直接 DROP 新表、删除类别字段或回退成会读取所有类别的旧代码**，否则可能丢失新作品或误操作。涉及数据库还原时要考虑维护窗口之后的真实新数据，另行确定恢复方案。

运维关注：业务 5xx/保存失败、RUN_ACTIVE/QUEUE_FULL、任务长时间停止中、磁盘余量、执行用户 slice 内存、OOM 记录、数据库连接和备份。日志不要记录令牌、完整学生代码或测试输入。服务只允许一份任务调度器；数据库命名锁与执行用户实例锁用于阻止重复启动。
