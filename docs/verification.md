# 本次实现的验证记录

2026-08-31 最新结果：用户于 13:46:03Z～13:46:09Z 完成网页运行启用，网站账号连接、数据库调度锁、HTTP/HTTPS 开关及原站状态核验通过。只重启 C++ 网站后端；p5.js、Apache、执行服务、用户管理器及 PM2 保存记录保持。私有备份 web-running-enable-hTFDVJ，日志 web-running-enable-bcf281dccc38.log。随后截图显示“两数之和”输入 `17 30`、输出 `a + b = 47`，状态“运行完成”，首次真实网页运行通过。现在转到 [课堂功能检查](classroom-acceptance-20260831.md)，下方启用步骤保留作历史记录，不重跑脚本。

本轮仅更新本地部署状态并新增课堂检查说明，没有修改应用代码、部署脚本、服务器配置或业务数据，也没有重新运行测试或压测。已阅读现有分发及教师查看逻辑：分发面向整个所选班级，后续只用测试账号班级；教师查看学生作品为只读。浏览器运行后的历史恢复、当前 p5.js 浏览器回归、模板分发/学生运行/教师只读与副本独立仍待用户回报。

2026-08-31 13:16:52Z～13:17:05Z，用户回报内部执行服务启动及全部接口检查成功。普通账号 cpp-runner、127.0.0.1:5280、密钥认证、真实 C++17 输入输出、CPU 超时、主动返回 137 不误判和服务重启后记录恢复通过，无残留容器；仅为新增用户服务设置开机启动，没有重启机器。私有记录 runner-service-start-zMMEp9，日志 runner-service-start-bb4ac3f67cec.log。两站、用户管理器、PM2 保存记录和资源总限额保持，网站运行当时仍关闭。

新增 enable-web-running-20260831.sh 及 [网页运行接入说明](web-running-enable-20260831.md)：先以网站账号验证候选配置、执行器健康接口和只读数据库，再备份并更新三个网站配置项，只重启 C++ 网站后端。检查失败时尝试恢复运行关闭，保留作品和任务。新增 17 项本地检查通过，当前完整测试 291 项中 290 通过、1 项可选 MySQL 跳过；Bash/Node、序列化检查程序、UTF-8/LF 通过，17 个既有部署脚本和 46 个原清单项未变。模拟 Linux 身份、执行器或数据库异常的检查不等于生产运行成功；实际服务器网站接入和浏览器首次完整运行待执行。

2026-08-31 12:52:31Z～12:53:14Z，用户回报 CPU 计量修正及全部 18 项服务器验证通过。运行 CPU 用例内核累计 3033666 微秒达到 3000000 微秒预算，输出、内存、取消和两个 137 误判对照均通过；只在验证完成后切换执行入口，两站与用户管理器未重启，总限额保持，网页运行关闭。私有记录 compiler-check-03-1PGlAA，日志 compiler-check-03-51f8fd4fe0a7.log。新增 start-runner-service-20260831.sh，自动生成私有密钥和用户服务，保持网站配置不变，先验证内部 HTTP 认证、编译/CPU/137 对照、幂等提交及服务重启恢复，再为新服务设置开机启动；不是机器重启验收。新增12项本地检查通过，完整291项中290通过、1可选MySQL跳过；Bash/Node与序列化检查程序语法、UTF-8/LF通过，16个已交付脚本和46个原清单项未变。长期服务在服务器上的实际启动仍待执行，详见 [内部执行服务步骤](runner-service-start-20260831.md)。

2026-08-31 12:29:25Z～12:29:37Z，用户回报 CPU 诊断完成：默认 PID1 忙循环在软/硬限3/4秒下，最后采样3763405微秒，约4152ms后退出137且OOM=false；处理SIGXCPU的对照收到信号并退出152，短程序主动返回137耗时137ms。记录 compiler-cpu-diagnostic-NwAqHX，日志 compiler-cpu-diagnostic-cfb9840cc6a2.log；两站、原文件、管理器与限额保持，网页运行关闭。新增 cpu-budget.mjs，按宿主机内核中对应容器scope的CPU累计用量停止，不依赖学生输出或把137直接归类；原podman.mjs与其注释、隔离参数不变。服务入口仅替换导入，通用Linux验证入口同步。新增 repair-compiler-cpu-20260831.sh，单文件内置模块，复用固定教学镜像c8579d…重验原16项和两个误判对照，全部通过才切换尚未启动的执行服务入口。新增19项测试通过，完整279项中278通过、1可选MySQL跳过；语法、序列化、辅助函数、编码、模块摘要和入口原文保留通过。服务器修正与18项验收尚待回报，详见 [CPU修正步骤](compiler-cpu-repair-20260831.md)。

2026-08-31 12:13:16Z～12:13:48Z，用户回报 02 接续已成功构建教学镜像，前12项验证通过，包括实际限额、隔离、编译输入输出、错误处理、进程上限及墙钟超时。CPU 时间上限用例预期 time_limit，实际 runtime_error / 退出137；此项未通过，输出上限、内存上限、取消未执行。随后网站、原配置、用户管理器与总限额复核通过，编译运行关闭。记录 compiler-check-02-PRb5s6，日志 compiler-check-02-75d4c542de48.log。新增 diagnose-compiler-cpu-20260831.sh，复用已构建镜像与原执行器，运行三个固定样本，记录CPU用时/限额、信号处理及OOM终止标记；不改应用代码、分类逻辑或隔离限制，不凭137断言原因。新增9项检查通过，完整260项中259通过、1可选MySQL跳过；Bash/Node/用户服务序列化和UTF-8/LF通过。服务器诊断与C++样本编译运行尚待回报；详见 [CPU退出诊断](compiler-cpu-diagnostic-20260831.md)。

2026-08-31 用户回报构建诊断完成：日志 compiler-build-diagnostic-27565cff7c4d.log。原脚本和 Containerfile 摘要一致，具体错误为 mkdir 创建 /work 被拒绝；旧临时单元已回收、所属进程为空、未生成 image.id，两个网站正常，写入开启、执行关闭。新增 resume-compiler-containers-20260831-02.sh，只在新构建副本中将 WORKDIR 提前并把 RUN 改为目录与编译器检查，不放宽构建或运行权限；旧文件、注释、失败记录和锁均保留，原16项服务器验证不变。新增8项本地测试通过，完整251项中250通过、1可选MySQL跳过；Bash/Node/序列化用户服务程序/RUN语法及UTF-8/LF通过。服务器接续构建尚未执行，不能记录为真实容器验收通过。详见 [接续说明](compiler-containers-resume-20260831-02.md)。

2026-08-31 11:44:49Z～11:44:50Z，用户回报教学镜像构建失败 IMAGE_BUILD_FAILED，尚未进入程序编译及隔离验收。退出前原配置、用户管理器、资源限额和两个网站复核通过，写入开启、执行关闭。私有记录 compiler-check-FEQ0jn，日志 compiler-check-5baa64361578.log。具体构建 stderr 已写入 worker-output.json，但当前输出未提供，不能猜测原因。新增 diagnose-compiler-build-20260831.sh，只提取构建错误、当前任务状态及目录元数据，复核网站并保存一份日志；不执行 Podman 或修改服务器配置。新增8项检查通过，完整243项中242通过、1可选MySQL跳过；Bash/Node/UTF-8/LF通过，原构建脚本不变。服务器诊断结果待回报。

2026-08-31 11:21:51Z～11:23:00Z，用户回报 GCC 基础镜像离线导入成功，原下载单元已回收且无所属进程，root 与 cpp-runner 两次核对归档内容通过。镜像 ID 为 sha256:6b4bd930afb1272016c64651ed6192f519f666edf9255213ad09c5cbdd657723，镜像1、容器0；网站、PM2进程、用户管理器、配置和总限额核验通过，编译运行关闭。私有记录 gcc-base-import-y9tsnD，日志 gcc-base-import-92ec65d669ba.log。新增 verify-compiler-containers-20260831.sh，用原执行器顺序执行16项教学镜像、真实容器隔离和编译验证；不启用执行服务、不改业务数据或网站。新增13项本地检查通过，完整235项中234通过、1可选MySQL跳过；Bash/Node/用户服务程序/探针语法与UTF-8/LF通过。服务器构建与容器验证尚未执行，不能记录为验收通过。

2026-08-31 用户已成功完成 Windows 镜像下载，离线包记录时间 10:46:33.370Z；再次独立读取归档，实际大小 540504576 字节、SHA256 4190852b88d938f8695a3208bcc76aaed5818b27556727d66541f2d508cac4fc，归档目录和原始镜像清单/配置摘要通过。新增 import-gcc-base-image-20260831.sh，仅从本地归档导入 cpp-runner 镜像库，导入前确认旧下载单元结束，保留 1GiB/1核/256任务/swap0，核对完整配置ID与8层DiffIDs，不联网拉取、不运行容器、不启动执行服务。新增10项检查通过，完整222项中221通过、1可选MySQL跳过；Bash/Node语法、UTF-8/LF通过，10个旧服务器脚本和46个清单项未变。服务器离线导入尚未执行，后续按 [离线导入说明](gcc-offline-import-20260831.md) 上传并回报。

2026-08-31 用户希望自己下载，新增 Windows 本地入口 download-gcc-offline-20260831.cmd/.mjs 和离线下载说明，不安装 Docker 或操作服务器。通过官方 GitHub API 核实便携 crane 0.22.0 Windows x64 下载地址、大小和 SHA256；仅查询发布元数据，未替用户下载工具或镜像。继续固定原 GCC amd64 清单与配置摘要，生成 OCI 归档前逐层核验。Windows 启动入口缺少工具时的提示/退出码已验证，新增4项逻辑与实际临时层文件检查通过。真实镜像下载和服务器导入待验证。

2026-08-31 09:52:35Z 用户回报 GCC 基础镜像准备失败：IMAGE_PREPARATION_FAILED / ETIMEDOUT，外层 IMAGE_WORKER_NOT_COMPLETED。rootless-checked 已出现，official-manifest-verified 尚未出现；按原脚本顺序未调用 Podman pull。失败前两个网站正常、写入开启/执行关闭，失败后未完成最终复核。私有记录 gcc-base-image-lthZ31，日志 gcc-base-image-15c3c59e6047.log。“停止请求未确认”可能由 --collect 回收已失败的临时单元造成，当前状态尚需验证。新增 diagnose-gcc-registry-20260831.sh，只生成日志，采集确切任务状态、所属进程、DNS、Node/curl IPv4/IPv6 对照与网站状态；不执行 Podman、不更换镜像源或修改配置。新增9项检查通过，完整208项中207通过、1可选MySQL跳过；Bash/Node、UTF-8/LF通过，9个既有脚本和46个清单项未变。未在本机执行服务器诊断，实际网络结果待回报。

2026-08-31 09:32:06Z～09:32:09Z，用户回报 CPU 委派修复与 rootless Podman 初始化成功。只新增 user@994.service 的专属 CPU 委派配置并重启该用户管理器，总限额1GiB/1核/256任务/swap0保持；实际UID/GID映射、rootless、systemd、cgroup v2、seccomp支持检查通过。两个网站 HTTPS、原配置与 PM2 进程核验保持，镜像0、容器0，编译运行关闭；真实容器和编译仍未验收。修复记录 rootless-delegation-d6YPe9，初始化记录 rootless-resume-0gFyZA。新交付 prepare-gcc-base-image-20260831.sh，只下载固定摘要的官方 GCC14.4.0基础镜像。本机实际查询 Docker官方仓库，校验索引/amd64清单/配置摘要，压缩层540483496字节，未下载层。新增10项测试通过；完整199项中198通过、1可选MySQL跳过；Bash/Node、用户服务程序语法、UTF-8/LF通过。服务器镜像下载结果待回报。

2026-08-31 用户回报资源委派诊断：日志 rootless-controllers-diagnostic-c586b81a10fa.log。user@994.service PID=3396803、active/running、UID994，DelegateControllers=memory pids；内核用户管理器同样只有 memory/pids。外层 cpu.max=100000 100000、memory.max=1073741824、memory.swap.max=0、pids.max=256；上级 DisableControllers 为空。两站 HTTPS 正常，C++ 写入开启/执行关闭；Podman 存储尚不存在，未进入探针。5280 的硬编码 ss 命令未成功，不记为端口空闲。新增 repair-rootless-delegation-20260831.sh：只为 UID994 追加 CPU 委派，核验空闲后限定重启该用户管理器，核验控制器、总限额、网站与 PM2 不变后自动接续原脚本。新增10项检查通过，完整189项中188通过、1可选MySQL跳过；Bash/Node、助手函数提取、UTF-8/LF通过。尚未操作服务器，修复及初始化结果待回报。

2026-08-31 08:24:08Z 用户回报 02 接续失败：USER_MANAGER_CONTROLLERS_MISSING；日志 rootless-resume-d4c3df4223bf.log，私有记录 backups/rootless-resume-hrUKkg。根据脚本位置，用户管理器/linger 与内核账号总限额已通过前序检查，具体控制器原始列表尚未取得；预检两个网站 HTTPS 通过、写入开启/执行关闭，失败后的最终复核未执行。未进入 Podman 探针。新增 diagnose-rootless-controllers-20260831.sh，只保存诊断日志并采集必要属性、配置资源行和 cgroup 层级，拒绝把未知状态当成通过，不修改配置或启动服务。新增 9 项检查通过，完整 179 项中 178 项通过、1 项可选 MySQL 跳过；Bash/Node 语法、UTF-8/LF 通过。本机无 Linux 执行，服务器诊断结果仍待回报。

2026-08-31 08:14:10Z，用户回报原初始化在用户管理阶段返回 PROPERTY_FORMAT。已写入专用容器配置、建立临时目录，并执行 linger/用户管理器启动命令；尚未进入 Podman 检查。日志 /var/www/teaching-cpp-backend/logs/rootless-init-9e358aabc659.log，私有记录 /var/www/teaching-cpp-backend/backups/rootless-init-X25XA6。源码确认 loginctl 252 不拆分 --property 的逗号参数，本地已复现空输出。 新增接续版，仅核对并保留已写入配置及已启动管理器，改为逐项读取属性，再继续原探针。新增 10 项检查通过；完整 170 项中 169 项通过、1 项可选 MySQL 跳过。Bash/Node 语法、原注释/探针和旧材料摘要检查通过；未操作服务器，接续结果待回报。

2026-08-31 服务器账号准备已完成：07:56:24Z～07:56:25Z 执行 02 版成功。cpp-runner UID=994、GID=991，家目录 /var/www/teaching-cpp-runner，subuid/subgid 新增 200000:65536，原行保留；文件权限分离与 NSS 链接/内容核验通过。user-994.slice 限额配置已加载但当时 inactive；内存 1 GiB、CPU 1 核额度、TasksMax=256、swap 0。原 p5.js PID=3341075/重启67，C++ PID=3375614/重启1，前后未变，两个网站 HTTPS 通过。未启用 linger、未初始化 Podman、未下载镜像、未启动执行服务。私有备份：/var/www/teaching-cpp-backend/backups/runner-account-RQI6nx；日志：/var/www/teaching-cpp-backend/logs/runner-account-d3b0c3650990.log。不要重跑账号准备。 本地新增 rootless 初始化脚本和 15 项纯逻辑检查，完整 160 项中 159 项通过、1 项可选 MySQL 跳过；Bash/Node 语法和 UTF-8/LF 通过。初始化脚本尚未在服务器执行，不能将账号准备成功记为 Podman 或容器隔离验证成功。

2026-08-31 账号准备 02 版：只兼容已确认的 authselect 链接，操作前后核对链接和目标内容，提前创建操作日志。新增 12 项本地检查通过，完整 145 项中 144 项通过、1 项可选 MySQL 跳过；Bash/Node 语法、UTF-8 无 BOM / LF 和原注释保留通过。未操作服务器，旧交付脚本不变。诊断服务器日志为 /var/www/teaching-cpp-backend/logs/runner-account-diagnostic-034235dd0ec9.log，证明账号和目录尚未创建、两个网站正常；不把此结果记为 02 版准备成功。

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

2026-08-31 独立执行账号脚本准备补充：本地最终检查：共 128 项测试，127 项通过、1 项可选 MySQL 跳过；Bash 和内嵌 Node 语法、UTF-8 无 BOM / LF 检查通过。46 个旧材料清单项及此前交付的 install-podman-20260831.sh 哈希保持不变。没有执行 Linux 账号创建、systemd 命令或连接服务器。

2026-08-31 用户已回报正式安装成功：新增 17 包，两个 SELinux 策略包从 38.1.65-1.el9_7.1 升至 38.1.75-2.el9_8，Podman 为 5.8.2。DNF 事务检查、事务测试和最终安装均通过，.env、/etc/selinux/config、/etc/subuid、/etc/subgid 校验通过，SELinux 仍 Disabled。两个网站 HTTPS 检查通过，PM2 中 p5js-backend / teaching-cpp-backend 均 online，前后重启计数为 67 / 1；本次列表未提供 PID，不能据此补记 PID 实测。安装记录：/var/www/teaching-cpp-backend/backups/podman-install-fkY7Dz5i；日志：/var/www/teaching-cpp-backend/logs/podman-install-tsbrcupt.log。执行服务仍未启动。 下一步已准备 prepare-runner-account-20260831.sh，仅创建新账号、目录、映射和资源单元配置，不启动用户服务或容器；18 项本地逻辑检查通过。账号创建及 systemd 实际检查尚待服务器回报。

2026-08-31 应用户要求，将已审阅的安装命令原样封装为 deploy/install-podman-20260831.sh（仅新增文件头说明）。UTF-8 无 BOM / LF、Bash/Node 语法及 8 组模拟网站响应检查通过；19 个版本参数保留，46 个旧发布材料哈希未变。用户只需用 WinSCP 上传此单个脚本，再在 PuTTY 启动；保留 DNF 原生清单确认。不在本机执行脚本安装流程，没有操作服务器，实际软件安装仍待回报。

2026-08-31 Podman 事务预览已回报：新增 17 包、升级 selinux-policy 与 selinux-policy-targeted 两包，约 28MB；Operation aborted / 退出码 1 为 --assumeno 的正常拒绝结果，未执行安装。新增正式安装说明，使用 DNF 原生确认和 19 个明确版本，仅在用户核对最终清单后继续。Bash 与两段 Node 语法检查通过，8 组模拟接口响应验证正确接受当前开关、拒绝错误状态。此次只更新部署文档，没有修改应用代码、旧发布包或服务器；没有本地 DNF/RPM 环境，正式安装、包脚本影响和 rootless 隔离仍待服务器分别核验。

日期：2026-08-30。执行位置：Windows 本地 `G:\teaching-cpp`，Node.js v24.14.1。没有操作云服务器或生产数据库。

2026-08-31 执行服务环境采集已完成：用户回报 Podman/crun/conmon/fuse-overlayfs/slirp4netns/passt 未安装，newuidmap/newgidmap 与 systemd 已具备；cgroup v2 含所需控制器，用户命名空间数量上限 14483，本地 ext4 剩余 26GB，5280 无监听。执行账号与目录未创建，apphttp 的两份 subordinate ID 映射均为 100000:65536，保留不改。下一步材料仅为 dnf --assumeno 安装清单预览，会刷新软件源索引和写日志，不执行软件事务。本机仅核对文档与命令语法，未连接服务器，也未安装容器组件；不能据此记录真实隔离验证通过。

2026-08-31 第 9 步已执行成功：用户回报 write-enable-20260831-02 于 2026-08-31T04:03:26.881Z 开始预检，随后完成配置备份、仅启用写入、仅重启 C++ 后端和各项核验。日志：/var/www/teaching-cpp-backend/logs/write-enable-02-crzIeNIg.log；备份：/var/www/teaching-cpp-backend/backups/write-enable-0uHa5u。C++ 写入现已启用、执行仍关闭。PM2 中 p5js-backend online、重启计数 67；teaching-cpp-backend online、重启计数 1。脚本确认原 p5.js 未重启，Apache、前端、PM2 保存记录及数据库结构未修改。用户明确确认 C++ 新建、保存、刷新后重新打开正常。用户随后澄清是笔误，明确确认 p5.js 修改作品后保存和运行也没有问题，因此本轮 p5.js 浏览器回归通过。C++ 与 p5.js 列表相互不混入、真实模板分发、学生视角及运行服务仍需各自验收，不由保存通过推定全部通过。下一步只采集执行服务安装前的环境信息。

2026-08-31 写入启用服务器结果与修正：用户回报 01 包在数据库预检中返回 ER_UNSUPPORTED_PS，日志为 /var/www/teaching-cpp-backend/logs/write-enable-lm5zd7Wp.log。根据执行顺序，尚未备份、更改 .env 或重启进程，写入与运行仍关闭。02 包仅把 START TRANSACTION READ ONLY 和 ROLLBACK 改用 connection.query，SELECT 保持预处理和超时。新增 9 项模拟协议回归可复现旧故障并验证修正版及拒绝路径；完整 110 项中 109 项通过、1 项可选 MySQL 跳过，42 个旧材料清单项未变。本机没有执行真实 MySQL，此包的服务器运行和保存验收尚待回报。

2026-08-31 最新部署安排：用户明确将同源问题交给原 p5.js 项目，要求本项目继续。新增 deploy/write-enable-20260831-01，只准备启用编辑的增量脚本、配置备份及失败恢复；没有修改应用源码、原 p5.js 或旧发布包。写入对所有已登录用户按原权限开放，执行保持关闭。本地完整检查 101 项，100 项通过、1 项可选 MySQL 跳过，其中新增开关字节保留与失败处理等 12 项；语法、材料检查和非 Linux 拒绝通过。此包未在服务器运行，C++ 写入及保存验收尚不能记为通过。

最新服务器结果（2026-08-31）：用户回报 `web-publish-20260831-02` 于北京时间 09:33:06 完成，只读 C++ 网页发布成功。日志实际捕获 reloading / reload-notify 转到 active / running；C++ API、首页及静态资源、深路径、缺失文件和敏感文件拒绝检查全部通过，主站及 p5.js 检查通过，主站 .htaccess 和两个后端 PID/重启计数不变。日志为 `/var/www/teaching-cpp-backend/logs/web-publish-20260831-02-M3AEskyQ.log`，备份为 `/var/www/teaching-cpp-backend/backups/web-publish-G8lHpu`。用户截图确认 C++ 页面加载和既有教师会话识别，随后明确确认原 p5.js 保存/预览以及 C++ 班级、学生展示正常。以上浏览器检查已经通过；C++ 写入、执行仍关闭。新建/保存、跨班级拒绝、重新登录、同源作品隔离和开机恢复尚未验证。以下失败和准备记录按发生顺序保留，以本段为最新状态。

用户随后执行作品响应头检查：一个现有作品返回 HTTP 200、text/html，未返回 CSP。该样本的服务器响应头核查已完成；不能据此认定曾发生账号泄露。随后新增 compat/preview-isolation-20260831 本机实验，使用已有 p5-1.11.13、虚拟 DOM 标记与素材，四组浏览器比较符合预期：现有同源方式可读取父页面，严格沙箱与独立来源均拒绝读取；严格沙箱需素材 CORS 且禁用 Storage API，独立来源保留此次验证的画布、图片、JSON 和 Storage API 可用性。直接打开严格沙箱加 CORS 页面也已检查。实验没有读取存储键值或真实登录信息，源码语法检查通过；未改应用代码、旧发布包、原 p5.js 项目或服务器。真实 DNS、证书、Apache、音频、全部作品及坐标桥接仍待实施验证。详见 preview-isolation.md 与实验 evidence.json。

2026-08-31 网页发布修正补充：用户回报旧版因主站对不存在的 C++ 地址返回 HTTP 200 而在预检停止，前端目录及 Apache 引用均尚未发布。新版 `deploy/web-publish-20260831-01` 只在响应与实际主站首页逐字一致时识别为主站回退，并在 C++ Directory 中关闭继承重写、保留独立页面回退；主站 .htaccess 原文件不修改。此次本地共 81 项检查，80 项通过、1 项可选 MySQL 跳过；包含三项新增入口判断检查。脚本语法、无连接检查、错误参数及非 Linux 拒绝通过，用户上传的 HTTPS 配置插入后原文和注释保持不变，旧版发布材料哈希未变。本机无可用 Linux/Apache；新包尚未在服务器执行，实际 Apache 配置与浏览器效果仍待回报。

后续服务器结果：用户回报 `web-publish-20260831-01` 已执行，Apache 语法检查通过并平滑加载，但后续 HTTPS 核验触发 `ERR_ASSERTION`。脚本已恢复原 Apache 配置、将新前端撤回到私有备份，原 p5.js 和主站检查通过；网页尚未上线，不能将语法通过记为 HTTPS 全部通过。日志为 `/var/www/teaching-cpp-backend/logs/web-publish-20260831-XJB7uOgT.log`，备份为 `/var/www/teaching-cpp-backend/backups/web-publish-3VOUaT`。`pm2 save` 本次已完成；具体失败项因原日志遗漏自动生成的断言信息尚待 Apache 访问日志定位。

第二次网页修正：用户随后提供的访问日志仅记录两次发布前 `/teaching-cpp/` 请求，没有重载后的 C++ API 请求。原脚本在首次 API 请求前立即要求 is-active 输出等于 active，而 systemd 官方源码也将 reloading 视为成功状态；据此修正过早判定，但当时状态未保存，原因仍记录为最可能的推断。`web-publish-20260831-02` 改为限时等待稳定就绪并记录状态、HTTP 摘要及失败源码位置，Apache 片段和前端保持不变。本地 89 项检查中 88 项通过、1 项可选 MySQL 跳过，八项新增检查使用模拟状态和受控时钟；新脚本语法、无连接检查、错误参数及非 Linux 拒绝通过，旧材料和既有注释均未变。新版本尚未在服务器执行，不能视为网页已上线。

后端启动补充：用户回报 2026-08-30 北京时间 21:57:20，C++ 后端已以 cpp-web（995:992）在 127.0.0.1:5180 只读启动，PID 3342469、重启计数 0；p5.js PID 3341075、重启计数 67 保持不变。两项 PM2 均 online，日志为 `/var/www/teaching-cpp-backend/logs/backend-start-dc9xcNnJ.log`。Apache、前端和 pm2 save 尚未执行，真实登录尚待检查。

正式发布补充：用户回报 2026-08-30 北京时间 21:38 正式库迁移及三个模型发布成功，迁移前后原表记录核验通过，p5.js 恢复并通过健康检查。日志为 `/var/www/teaching-cpp-backend/logs/production-publish-oavQgG6L.log`，新备份为 `/var/www/teaching-cpp-backend/backups/first-publish-xoptT8`。原站浏览器回归、备份下载尚待回报；C++ 服务已在后续步骤只读启动，公网接入和真实执行未完成。

最新补充：用户已回报服务器 `teachingcpp20260830test` 上 16 项 MySQL 8.4.9 验证全部通过，日志为 `/var/www/teaching-cpp-backend/logs/mysql-verification-E5B5he9F.log`；原站健康检查 HTTP 200、PM2 online、重启计数 67。这个测试使用虚拟数据，没有连接正式库，保留测试库供核查，不重复运行。

本轮本地合计 74 项通过、1 项可选 MySQL 检查跳过：原有应用 22 项、类别模型 17 项、原控制器调用边界 22 项、发布保护流程 13 项。控制器检查使用真实控制器和兼容模型，但数据库为内存适配器，文件写入、外部 AI 和余额调用为副作用监测替身；不等于真实 HTTP 登录或文件系统集成验证。发布保护检查覆盖原文变化拒绝、换行保留、密码选项转义、原字段数据摘要及各阶段失败时中止和调用恢复流程；尚未实测 Linux 上整套发布和恢复。下一步材料见 `deploy/production-20260830-01/README.md`。

以下保留初次交付时的检查记录；其中原先待执行的 MySQL 项目已有上述补充结果，正式库迁移与模型发布现已由用户执行成功，C++ 上线和真实运行仍未完成。

## 已执行

| 项目 | 结果 |
| --- | --- |
| 依赖安装 | 完成，已提供 package-lock.json |
| JavaScript 语法检查 | 通过 |
| 自动化检查 | 22 项通过，0 项失败；另有 1 项可选 MySQL 检查跳过 |
| React/Vite 生产构建 | 通过；编辑器分包约 533KB，gzip 约 174KB，存在体积提示但不影响构建 |
| `db:migrate` 默认行为 | 只输出 SQL，未连接数据库 |
| 生产依赖 npm audit | 0 个已知漏洞（仅为本次官方 npm 数据库查询结果，不是安全保证） |
| 本机浏览器功能检查 | 工作台加载、输入保存和版本更新、自动保存、新建示例、教师模板分发、查看学生只读代码、未接入 AI 的提示 |
| 本机“保存并运行” | 正确提示代码已保存但真实执行未启用，没有伪造运行结果 |

## 自动化覆盖重点

- 学生之间、教师班级之间、管理员班级范围和 p5js/cpp 项目类别的访问隔离。
- 代码大小、非法编译配置、无效身份、演示身份不能用于正式模式。
- 源码写入失败不会创建任务、旧版本不会被覆盖。
- 相同版本并发保存只成功一次；运行记录绑定当时源码和 stdin。
- 同一用户重复提交拒绝；同一请求重试返回原任务。
- 21 个模拟用户同时提交，只接受 20 个未完成任务，按入队顺序单任务处理。
- 停止尚未确认时，不释放执行槽位；网络中断不伪装为已停止。
- 取消请求先到达、迟到提交不会启动；执行记录重启后去重。
- 模板只分发到本班，重试不重复，学生副本独立，不改余额。
- 作品组不能循环或跨类别移动，非空组不能删除。
- 缓存清理保护正式当前代码及未完成任务快照。
- HTTP 协议从业务排队、模拟执行服务到结果与历史摘要贯通。
- 容器参数有资源限制；缺少 rootless/cgroup/seccomp 条件时拒绝启动；编译失败不执行程序；输出洪泛与宿主控制命令超时不会无限积累。

模拟适配器只用于测试，不存在可对公网开启的“模拟成功”运行模式。默认 demo 的真实执行始终禁用。

## 未执行，必须在上线前补验

1. Rocky Linux 上安装/启动 rootless Podman、实际 cgroup 委派和用户 slice 合计限制。
2. 真实 GCC 编译、stdin、错误/超时/内存/输出上限、网络隔离、进程数限制和异常退出清理。
3. MySQL 8 独立测试库中的迁移、DDL 兼容、真实并发事务及原平台共同访问。
4. 修改原 p5.js 的类别隔离与白名单登录返回；回归原运行、文件、AI 和管理功能。
5. 同源不可信学生作品的安全审查、Nginx HTTPS 合并配置、线上统一登录。
6. 课堂负载测试、运行内存峰值采集和长期磁盘增长观察。

同机独立测试和发布步骤见 `deployment.md`，原站待审查范围见 `p5js-compatibility.md`。本地测试通过不等于可以立即向公众开放学生代码执行。
