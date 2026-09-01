# 教学镜像构建失败：只读诊断

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

用户回报 `verify-compiler-containers-20260831.sh` 于 `2026-08-31T11:44:49Z` 进入构建，随后返回 `IMAGE_BUILD_FAILED`。程序编译及隔离验证尚未开始，不能记录为任何一项验收通过。

脚本结束前已核对原配置、用户管理器、资源限额及两个网站；两个网站正常，C++ 写入开启、执行关闭。记录目录为 `/var/www/teaching-cpp-backend/backups/compiler-check-FEQ0jn`，日志为 `/var/www/teaching-cpp-backend/logs/compiler-check-5baa64361578.log`。

`IMAGE_BUILD_FAILED` 是外层汇总错误码。Podman 的具体退出码及 stdout/stderr 已保存在私有记录中的 `worker-output.json`，但上一版终端没有展示它们。在取得这些信息之前，不推断为内存不足、权限问题、参数不兼容或镜像损坏。

## 当前操作

只上传这个新文件：

| 本地文件 | 服务器完整路径 |
| --- | --- |
| `G:\teaching-cpp\deploy\diagnose-compiler-build-20260831.sh` | `/var/www/teaching-cpp-backend/deploy/diagnose-compiler-build-20260831.sh` |

在 PuTTY 的 root 会话执行：

```bash
bash /var/www/teaching-cpp-backend/deploy/diagnose-compiler-build-20260831.sh
```

发回完整输出，特别是“构建 stderr”部分。不要重跑原验证脚本，不删除镜像、测试目录或 `compiler-check.lock`。

## 诊断范围

- 比较服务器原验证脚本与已交付版本的 SHA256。
- 从上次记录中提取构建退出码、标准输出、错误输出、是否超时及当时记录的容器数量。不是重新运行构建。
- 去除终端控制符，遮蔽常见密码、令牌和 URL 凭据；不读取 `.env`、进程命令行或进程环境变量。
- 核对上次任务的确切名称，读取其当前 systemd 属性及所属进程的 cgroup。未知状态不当成已停止。
- 查看本次构建目录和镜像 ID 文件的存在情况及权限，并核对 Containerfile 内容摘要；不解压、覆盖或删除文件。
- 读取上次网站复核摘要，再访问现有的两个 HTTPS 健康/配置入口，仅输出状态及开关值。

脚本不执行任何 Podman 命令，不重新构建、不运行容器、不启动/停止/重启服务、不修改账号或资源配置。它只新增一个诊断日志：`/var/www/teaching-cpp-backend/logs/compiler-build-diagnostic-随机名.log`。

诊断中显示的容器数量来自上次保存的记录，并非新的镜像库查询。当前临时任务状态和进程扫描另外列出，不能用它们代替后续对镜像库的核查。

## 本地检查

新增 8 项检查通过，覆盖真实错误提取、记录损坏拒绝、凭据脱敏、任务范围、未知状态处理和现有站点返回协议。完整检查 243 项：242 项通过，1 项可选 MySQL 跳过。Bash/内嵌 Node 语法及 UTF-8 无 BOM/LF 通过。原构建脚本保持不变。

```text
diagnose-compiler-build-20260831.sh
SHA256: 872a1c60a7f1d5d839d0661fc86cf7e5f28134dc760707b3887d3ca9b2f4e065
```

本机没有执行服务器诊断。取得用户回报后，再按具体原因准备修正或接续，不提前更换基础镜像或降低隔离要求。
