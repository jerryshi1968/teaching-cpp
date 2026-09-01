# 第 6 步 E：正式数据库迁移与 p5.js 类别隔离发布

本材料已准备，尚未在服务器执行。它接续用户回报的 16 项 MySQL 验证通过结果，只适用于当前服务器的首次发布。已经完成的验证包、测试库和原应用包不再覆盖或重跑。

## 本次会改变什么

1. 暂停 PM2 中的 `p5js-backend`，不停止其他应用、不重启 MySQL 或 Apache。
2. 在暂停期间重新备份 `teaching_p5js`、原站完整前后端目录、Apache 配置和当前 PM2 进程信息；备份位于 `/var/www/teaching-cpp-backend/backups/first-publish-*`。
3. 执行已经在独立 MySQL 8.4.9 测试库通过的 `001_cpp.sql`：给 projects 和 project_groups 新增 project_type 字段及索引，原记录默认 p5js；新增四张 C++ 业务表、一张队列锁表和一张迁移登记表。不删除原表、原字段或原作品。
4. 只替换 `/var/www/teaching-p5js-backend/models/` 下的 projectModel.js、projectGroupModel.js、fileModel.js，使用验证包中已测试的同一版本。保留原文件权限、注释及 LF/CRLF 换行。不会修改 app.js、services/exampleService.js、控制器、登录、班级加入或 AI 余额逻辑。
5. 恢复原 p5.js 进程，检查 5080 的数据库健康状态及未登录认证入口。不会执行 `pm2 restart all`、`pm2 save` 或 `--update-env`。

两个 `.env` 都保持不变；C++ 写入和执行仍关闭，5180/5280 不启动。不修改 Apache，不发布 C++ 前端，不安装容器组件。

## 备份和失败处理

开始维护前校验已安装应用、验证包、31 个原站代码文件、有效端口与数据库配置、16 项验证日志、正式库结构和可用磁盘。非预期状态会停止，不自动覆盖或猜测修复。当前首次发布要求库中没有存储过程、事件或触发器；发现这些额外对象就先停止审查，避免遗漏备份或有定时写入。

继续沿用 dbadmin，不新建账号或扩大权限。数据库密码只在进程内读取，导出工具使用 root 私有临时选项文件，完成后删除；不放在命令行或进度日志中。确认没有存储过程后不启用需要额外全局权限的 routines 导出。[MySQL mysqldump 说明](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)

备份完成后比较原八张表的行数及原字段值摘要；迁移前后再比较。日志只记录阶段，摘要不包含原始账号数据。备份中的 SQL、站点文件和 PM2 JSON 仍含私密资料，必须保持私有，成功后请用 WinSCP 下载整个新备份目录到电脑私有位置。检查导出完成标志、压缩包内容及 SHA256 不等于已做整库恢复演练。

正常错误会进入受检查的恢复流程：若确认尚无 C++ 业务数据、原记录没有变化且文件版本符合预期，则恢复这三个原模型并重新启动 p5.js；数据库的新增结构保留。MySQL DDL 不能当作一个可整体回滚的事务，因此脚本不会自动恢复整库或删除新字段。[MySQL 隐式提交说明](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)

如果无法确认恢复条件，保留现场并明确提示人工处理，原站可能仍暂停。不要重复迁移、清空测试库、删除新增表或手工覆盖旧模型，先发回进度日志。服务器断电、进程被强制结束和磁盘故障无法保证自动恢复；下方后台启动方式主要避免 PuTTY 断线直接中断发布。

## 执行方法

先保存正在编辑的作品，发布完成前不要编辑或运行原站作品，也不要同时修改服务器代码、配置或数据库。

WinSCP 使用二进制模式，将 `G:\teaching-cpp\releases` 中以下两个文件上传到 `/var/www/teaching-cpp-backend`：

- teaching-cpp-production-20260830-01.tar.gz
- teaching-cpp-production-20260830-01.tar.gz.sha256

在 root 的 PuTTY 会话中，按本次对话给出的压缩包固定 SHA256 核验、解压到全新的 `deploy/production-20260830-01` 目录。不要覆盖其他目录。然后从 `/var/www/teaching-cpp-backend` 核验 `deploy/production-20260830-01/PUBLISH-FILES.sha256`。

以下启动命令会真正进入维护、备份、迁移和发布流程；不是只读检查：

```bash
(
  set -euo pipefail
  test "$(id -u)" -eq 0
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  umask 077
  sha256sum -c deploy/production-20260830-01/PUBLISH-FILES.sha256
  cpp_node=/var/www/teaching-cpp-backend/tools/node/bin/node
  "$cpp_node" deploy/production-20260830-01/publish.mjs --check-only
  cpp_publish_log=$(mktemp /var/www/teaching-cpp-backend/logs/production-publish-XXXXXXXX.log)
  nohup "$cpp_node" deploy/production-20260830-01/publish.mjs \
    --apply --confirm-db teaching_p5js --accept-short-p5js-outage \
    > "$cpp_publish_log" 2>&1 < /dev/null &
  cpp_publish_pid=$!
  printf '发布进程：%s\n发布日志：%s\n' "$cpp_publish_pid" "$cpp_publish_log"
  for ((cpp_wait=0; cpp_wait<30; cpp_wait++)); do
    if ! kill -0 "$cpp_publish_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  tail -n 100 "$cpp_publish_log"
  printf '若尚未结束，只查看上方日志，不要重复启动。\n'
)
```

若 30 秒后没有结束，等待一会儿，再用 WinSCP 刷新并打开打印出的日志文件。日志只到“发布前检查通过”或“建立备份”不代表已完成。只有明确显示“正式兼容发布完成”才进入浏览器检查。命令块返回并不代表后台进程成功。

完成后，把这份发布日志及 `pm2 list` 结果发回。用原账号登录 p5.js，检查原作品列表，打开一个作品，在专门的测试作品中保存并预览；再确认作品组、复制、教师查看等日常功能。不要把备份、`.env` 或 PM2 JSON 内容发到对话中。

## 验证边界

服务器验证证据见本目录 evidence.json。新发布脚本在本机通过语法、只读材料核验及失败阶段调度测试，但本机没有 Linux PM2/MySQL，不能把这些检查称为已实测整套生产恢复流程。原站登录会话、真实文件操作、真实 AI 调用、浏览器和负载测试仍需分别验证。

C++ 正式上线前仍要验证统一身份和同源学生作品的安全边界；真实执行前还需安装并验证 rootless Podman、资源限制和编译运行。此次发布不代表这些步骤已经完成。
