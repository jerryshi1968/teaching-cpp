# 教学镜像构建接续：02 版

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

2026-08-31，用户回报只读诊断完成。直接失败位置已确认：构建步骤中的 `mkdir -p /work` 返回 `Permission denied`。原验证脚本和构建文件摘要均一致，临时任务已回收且没有所属进程，尚未生成 `image.id`。两个网站正常，C++ 写入开启、编译运行关闭。

诊断日志：`/var/www/teaching-cpp-backend/logs/compiler-build-diagnostic-27565cff7c4d.log`。旧构建记录：`/var/www/teaching-cpp-backend/backups/compiler-check-FEQ0jn`。日志能确定目录创建失败，尚不足以单独证明具体的用户映射或底层挂载权限原因。

## 本次修正

只在本次新建的构建副本中，把 `WORKDIR /work` 提到 `RUN` 前面。不存在的工作目录由镜像构建器创建；后面的受限 `RUN` 只检查编译器、目录及其 755 权限，不再创建或修改目录。[WORKDIR 官方说明](https://docs.docker.com/reference/dockerfile/#workdir)

原 `runner/Containerfile`、旧部署脚本、注释以及未涉及的内容全部保留。构建仍使用固定的本地基础镜像，禁止拉取、禁止联网，`--cap-drop=ALL` 和资源限制均保持；学生程序的运行参数也不变。

脚本先核对旧失败原因、旧任务结束状态和记录，再确认当前镜像库没有遗留容器。在新目录中构建，随后继续原来的 16 项验证，包括镜像来源、真实容器隔离、资源限制、正常编译运行、错误处理及取消。没有跳过原测试。

## 上传与执行

用 WinSCP 只上传这个新文件，保留 LF 换行：

| 本地文件 | 服务器完整路径 |
| --- | --- |
| `G:\teaching-cpp\deploy\resume-compiler-containers-20260831-02.sh` | `/var/www/teaching-cpp-backend/deploy/resume-compiler-containers-20260831-02.sh` |

不用重新上传镜像，不覆盖其他脚本，不删除旧目录、记录或锁文件。

在 PuTTY 的 root 会话执行一次：

```bash
bash /var/www/teaching-cpp-backend/deploy/resume-compiler-containers-20260831-02.sh
```

保持 PuTTY 连接，结束后发回完整输出。若再次失败，新版会直接显示经过常见凭据脱敏的构建错误摘要；完整输出仍保存在私有记录中。不要重跑或自行清理现场。

## 操作边界及记录

- 保留旧 `compiler-check.lock`，本次另用 `compiler-check-02.lock` 防止重复操作。
- 新日志位于 `/var/www/teaching-cpp-backend/logs/compiler-check-02-随机名.log`。
- 新私有记录位于 `/var/www/teaching-cpp-backend/backups/compiler-check-02-随机名`。
- 新构建与测试目录位于 `/var/www/teaching-cpp-runner/compiler-check-随机名`，不会复用旧失败目录。
- 不安装软件、不修改账号、Apache、数据库或网站配置，不重启网站或用户管理器。
- 仍受账号总限额 1 GiB 内存、1 核 CPU、256 个进程/线程、swap 0 约束。
- 不启动执行服务，不创建 `.env.runner`，不开放网页编译运行。此次也不是课堂并发性能验收。

只有实际完成 16 项验证并通过网站、配置和进程复核后，才写入本次成功记录。任何预检或验证失败都保留现场并停止。

## 本地验证

新增 8 项测试通过：覆盖构建副本变换、原文和注释保留、旧失败状态识别，以及原构建参数、隔离探针、测试用例和验收函数不变。完整测试 251 项：250 项通过，1 项可选 MySQL 跳过。Bash、内嵌 Node、序列化用户服务程序、修改后的 RUN 指令语法及 UTF-8 无 BOM / LF 检查通过。

```text
resume-compiler-containers-20260831-02.sh
SHA256: 814b2f79e5c25e95a65fdb7796d2b38f488a2c32009e29ee3ab7b14c147eb116

本次派生的构建副本 Containerfile
SHA256: c20ac222f94847b5aa205fc9bede86158f97eab97afda06baef24fbb267d27f1
```

本机没有 Linux/Podman 执行环境，以上不代表服务器构建和容器验收已通过。实际结果以用户执行此次脚本后的回报为准。
