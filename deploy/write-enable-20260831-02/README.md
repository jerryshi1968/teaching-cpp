# 第 9 步修正版：修复 MySQL 只读检查的事务调用

本包尚未在服务器执行。上一版 `write-enable-20260831-01` 已由用户执行，在 2026-08-31T03:44:31.172Z 的启用前检查中返回 `ER_UNSUPPORTED_PS`，日志为 `/var/www/teaching-cpp-backend/logs/write-enable-lm5zd7Wp.log`。错误出现在 `preflight` 的数据库检查，尚未进入配置备份、开关修改或 PM2 重启，C++ 写入与运行仍关闭。旧目录、日志、发布包和校验值保留，不重跑、不覆盖。

## 原因与修改

原 `check-db.mjs` 将所有 SQL 都交给 mysql2 的 `connection.execute()`，因此 `START TRANSACTION READ ONLY` 也走服务器端预处理。MySQL 对可预处理语句有限制，此事务命令不能使用该方式。随后原脚本中的 `ROLLBACK` 也使用相同调用，一并修正。该问题属于本项目部署检查脚本，不要求更改 MySQL 版本、密码、权限或数据库结构。参见 [MySQL 8.4 官方预处理语句说明](https://docs.oracle.com/cd/E17952_01/mysql-8.4-en/sql-prepared-statements.html) 和 [事务命令说明](https://dev.mysql.com/doc/refman/8.4/en/commit.html)。

实际数据库逻辑仅修改两条调用：`START TRANSACTION READ ONLY` 和 `ROLLBACK` 改用 `connection.query({ sql, timeout: 10000 })`。事务仍为只读；所有结构、迁移状态、首次空数据条件及无运行记录的 SELECT 仍使用预处理查询并保留 10 秒超时。没有取消只读事务或跳过任何核验。

新 `enable.mjs` 仅将版本目录从 `01` 换为 `02`；配置补丁、备份、启用、重启、核验、恢复逻辑不变。`guard.mjs` 与上一版逐字一致。原代码注释、其余代码、空格和换行全部保留。

## 操作范围

将本版 tar.gz 及其 sha256 上传到 `/var/www/teaching-cpp-backend`，按本轮对话的新命令解压至 `deploy/write-enable-20260831-02`。不要手工修改旧包或原 `.env`，不要重新迁移数据库。

`--check-only` 只校验材料，不读取 `.env` 或连接数据库；`--enable-writes` 执行完整服务器检查，然后备份 C++ 配置及 PM2 记录，只启用编辑并重启既有 `teaching-cpp-backend`。`CPP_RUN_ENABLED=false` 保持不变，不改 Apache、前端、p5.js、PM2 保存记录或数据库结构。写入对所有已登录用户按原权限开放；同源问题仍由原 p5.js 项目处理，本包不处理也不声称已解决。

配置备份在本项目的 `backups/write-enable-*`，包含密码，只保留在管理员可读目录。开始修改开关后的失败会尝试恢复只读；不回滚数据库、不删除期间可能保存的作品。连接失败或检查失败不能视为启用成功。若恢复不能确认，发回日志和 PM2 列表，不自行还原旧数据库。

执行时沿用上一版的部署锁文件名 `backups/write-enable-20260831-01.lock`，使新旧命令不能同时启用。新包使用独立目录与日志，旧步骤不重跑。操作期间不要同时发布其他版本或手工改配置。

## 本地验证与限制

本地新增检查直接在受控 VM 中执行新旧 `check-db.mjs`，使用真实 `MysqlRepository.checkSchema` 与模拟数据库连接：原版本在事务开始时复现 `ER_UNSUPPORTED_PS`；新版本启用前后两种模式通过，事务走普通查询，SELECT 保持预处理与超时。开始事务失败、迁移未完成、已有 C++ 作品、已有运行记录、结束事务失败均仍拒绝，并释放连接、关闭连接池。

这是基于官方协议限制的模拟回归，不是本机运行真实 MySQL 8.4.9；不能代替用户服务器上的结果。旧 01 包和其他已交付材料的校验值不改。完成服务器操作后，先确认日志出现“C++ 写入已启用”，再用自己的账号新建、保存并刷新重新打开；运行及向真实教学班分发暂不测试。

2026-08-31 本地完整检查：110 项中 109 项通过、1 项可选 MySQL 跳过，包含新增 9 项数据库调用回归。42 个旧发布材料清单项校验不变；新版语法和不连接数据库的材料检查通过。实际启用与浏览器保存验收待服务器回报。
