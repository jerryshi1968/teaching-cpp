# 第 10 步 E：接续 Podman 初始化

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

以下原交付步骤保留为历史记录，本页旧命令不再执行。

2026-08-31 用户回报：原初始化脚本于 `08:14:10.660Z` 在“只为 cpp-runner 启用后台用户管理，保持现有 slice 限额”阶段报 `PROPERTY_FORMAT`。日志：`/var/www/teaching-cpp-backend/logs/rootless-init-9e358aabc659.log`；私有记录：`/var/www/teaching-cpp-backend/backups/rootless-init-X25XA6`。

依据日志和脚本顺序，专用容器配置、临时目录已经创建，启用 linger 和提交用户管理器启动的命令已经返回成功；尚未进入 Podman 信息和 namespace 检查，也没有下载镜像或启用网站编译运行。原网站最后一次健康检查在此次预检中通过，失败后的最终复核没有执行。当前用户管理器是否正常、配置是否保持原样，由接续脚本重新核对，不凭旧日志代替实时检查。

## 原因

原脚本使用 `loginctl show-user cpp-runner --property=Linger,RuntimePath`。systemd 252 的 `loginctl` 把每次 `--property` 的参数整体加入筛选列表，不像 `systemctl` 那样拆分逗号。因此这个写法没有选中两个属性，空输出随后触发 `PROPERTY_FORMAT`。本地按官方源码的筛选语义复现了此问题；没有将模拟输出冒充服务器原始输出。[loginctl 252 参数解析源码](https://github.com/systemd/systemd/blob/v252/src/login/loginctl.c)、[systemctl 252 参数解析源码](https://github.com/systemd/systemd/blob/v252/src/systemctl/systemctl.c)

接续版改为分别传入 `--property=Linger` 和 `--property=RuntimePath`，所有状态读取都按单独属性参数处理。空输出、重复字段和缺少必要字段仍然报错；同时记录发生问题的工具和属性名，原始状态输出只保存在私有记录。

## 本次怎么操作

**不要删除配置，不要重跑原初始化或账号准备脚本。**

1. 用 WinSCP 上传 `G:\teaching-cpp\deploy\resume-rootless-podman-20260831-02.sh` 到服务器 `/var/www/teaching-cpp-backend/deploy/`。只上传这一个新文件，旧脚本和已有备份保留。
2. 在 PuTTY 的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/resume-rootless-podman-20260831-02.sh
```

发回完整输出即可。新日志为 `logs/rootless-resume-*.log`，新私有记录为 `backups/rootless-resume-*`；不会覆盖旧日志或旧备份。

## 接续范围

- 只接受 `rootless-init-X25XA6` 记录的这一中断阶段。核对已交付脚本的摘要、已有配置的内容和权限、原账号及映射、NSS 与网站配置摘要、当前用户管理器和账号限额。
- 发现已有 Podman 存储、后续阶段记录、配置变化或用户管理器未就绪就停止，不自行清空、接管、重启或降级检查。
- 不重复写入 `containers.conf`、`storage.conf` 或临时目录，不重复启用 linger，不重启用户管理器，也不重新创建账号。
- 核对通过后，继续在指定用户的临时服务中执行原定的 Podman 信息、实际 UID/GID 映射与资源环境检查。原探针、隔离要求和运行时限保持不变。
- 不下载镜像，不运行学生代码，不启动 C++ 执行服务，不修改网站开关，不重启两个网站。成功只表示本步初始化与检查完成，真实容器和编译仍需后续验收。

若再次报错，保留现场并发回输出，不重复执行。临时检查服务异常时只请求停止本次命名的服务，不停止已有用户管理器或其他服务。详细错误和配置摘要属于私有记录，不公开发送整个备份目录。

## 本地验证

新增 10 项针对性检查通过：旧参数错误复现、正确筛选两属性、空结果与缺字段拒绝、错误位置诊断、接续阶段约束、账号和配置摘要核验。完整本地检查共 **170 项，169 项通过、1 项可选 MySQL 跳过**。Bash、内嵌 Node 语法、UTF-8 无 BOM / LF、原注释和原探针保留检查通过。五个此前交付的脚本、8 份旧清单的 46 个文件摘要不变。

此次没有连接服务器，也没有在 Windows 上执行 Linux 用户服务或 Podman。接续脚本的服务器结果仍待回报。

脚本 SHA256：`5cdee3afefd5fa0f968e9703977f79e54d8efc89561995f31483faf7cade42de`。
