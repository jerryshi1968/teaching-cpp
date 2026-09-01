# 第 7 步：C++ 后端只读启动

本材料已准备，尚未在服务器执行。前一步正式兼容发布已由用户回报成功：2026-08-30 北京时间 21:38:18，原表记录核验通过，三个模型已发布，p5.js 健康检查通过。

- 发布日志：`/var/www/teaching-cpp-backend/logs/production-publish-oavQgG6L.log`
- 新备份：`/var/www/teaching-cpp-backend/backups/first-publish-xoptT8`
- 原站浏览器检查、备份下载、发布后的完整 PM2 列表尚待用户回报，不能从健康检查推定已经完成。

## 本次范围

沿用现有 root PM2，新增名为 `teaching-cpp-backend` 的单个 fork 进程。实际业务进程使用已经创建的普通账号 cpp-web（UID 995 / GID 992），使用 C++ 专用 Node 24.20.0，监听 `127.0.0.1:5180`。PM2 仍是 root 管理，不代表业务进程也以 root 身份运行；脚本会读取实际进程身份并核验。

启动配置为本目录 ecosystem.json；业务配置和数据库密码继续由后端读取原 `.env`。PM2 配置中不复制数据库密码，不修改两个平台的 `.env`。启动管理命令使用明确的基础环境变量，避免把操作终端中的数据库配置或开关意外带进新服务。

保持 `CPP_PRODUCTION_WRITES=disabled`、`CPP_RUN_ENABLED=false`，不会创建 C++ 业务记录、运行学生程序或启动 5280。服务初始化会创建自己的 `storage/sources` 目录；日志保存在本项目 logs 下。PM2 自身的进程元数据继续放在现有 `/root/.pm2`，不另外创建一套 PM2 或开机服务。

不会再迁移数据库，不停止、重启、覆盖原 p5.js，不修改 Apache，不发布 C++ 前端。公网 `/teaching-cpp/` 暂时还不能用于验收，不要为 5180 开放防火墙端口。

`--max-old-space-size=256` 是 Node 堆设置；`max_memory_restart=384M` 是 PM2 内存检查后的重启条件，不是操作系统的硬内存隔离。本次不进行课堂压力测试。[PM2 配置说明](https://pm2.keymetrics.io/docs/usage/application-declaration/)

## 执行与检查

先在原 p5.js 浏览器页面确认登录、作品列表、测试作品保存和预览正常，并用 WinSCP 下载上述新备份到电脑私有位置。若原站出现异常，先发回现象，不继续接入公网或开放 C++ 写入。

上传 releases 下的 `teaching-cpp-backend-start-20260830-01.tar.gz` 及其 `.sha256` 到 `/var/www/teaching-cpp-backend`，使用二进制传输。按对话提供的固定校验值校验，解压到全新的 `deploy/backend-start-20260830-01`，不能覆盖已有同名目录。

从 `/var/www/teaching-cpp-backend` 运行 `sha256sum -c deploy/backend-start-20260830-01/START-FILES.sha256`。以下两种调用的作用不同：

```bash
/var/www/teaching-cpp-backend/tools/node/bin/node deploy/backend-start-20260830-01/start.mjs --check-only
/var/www/teaching-cpp-backend/tools/node/bin/node deploy/backend-start-20260830-01/start.mjs --start-readonly
```

第一条只校验启动材料，不读取 `.env` 或连接数据库。第二条以 root 调用现有 PM2 创建新进程，会先检查前一步发布结果、31 个原站代码文件、现有 C++ 代码、普通账号权限、空闲端口、写入和执行关闭，以及 cpp-web 读取迁移结构的权限。

启动后核验实际进程 UID/GID、Node 路径、5180 仅监听本机、健康接口与配置接口、演示身份被拒绝、5280 仍未启动，并检查 p5.js 的 PID、重启计数和健康状态没有变化。检查失败时只尝试停止本次新增的 C++ 进程，保留配置和日志，不删除进程记录或重跑迁移。

成功时明确显示：

```text
C++ 后端只读启动完成：cpp-web，127.0.0.1:5180，写入关闭，执行关闭
原 p5.js 进程未重启，5080 健康检查通过；Apache 和前端未改动。
```

结果会记录到私有的 `backups/backend-start-20260830-01-result.json`。把启动检查日志及最后的 PM2 列表发回即可，不发送 `.env`、站点备份、数据库导出或 PM2 完整 JSON。

本步骤不执行 `pm2 save` 或修改开机启动配置，核验结果后再安排保存。若 PuTTY 断线，先查看已经打印出的日志和 `pm2 list`，不要重复首次启动。之后再接入 Apache、上传前端并验证真实登录；保存、教师查看、模板分发和执行功能仍分阶段核验。

## 验证范围

本地检查覆盖 JSON、JavaScript 语法、无连接材料检查、错误参数与非 Linux 执行拒绝，以及新压缩包内容校验。没有在本地实测 Linux PM2 切换用户或连接生产 MySQL；这些以本次服务器执行结果为准。不能把健康检查或未登录请求被拒绝称为真实账号联调通过。

已交付的正式发布包与 MySQL 验证包保持不变，包内 evidence.json 表示它们打包时的状态。当前部署进展记在 docs/deployment-apache-pm2.md。`G:\teaching-p5js` 的三个本地模型没有自动改写；以后同步原项目时不要用旧模型覆盖服务器已发布的类别隔离版本。
