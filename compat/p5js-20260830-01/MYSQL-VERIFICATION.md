# 同一服务器上的独立 MySQL 验证

当前阶段：两个线上同步文件已核验；三个模型仍是未部署的草稿。正式 teaching_p5js 尚未迁移。

测试库固定命名为 **teachingcpp20260830test**，与 teaching_p5js、qbank 分开。只使用虚拟用户、班级、项目、作品组和文件记录；不复制生产数据，不启动 HTTP 服务，不执行 C++，不安装新依赖。继续使用现有 dbadmin，不创建新的数据库账号。脚本没有自动删库、清库或覆盖表的步骤。

## 第一步：管理员建立空库并授权

既有 dbadmin 仅在 teaching_p5js 和 qbank 获得库内权限，没有为新库授权的权限。因此这个一次性的步骤使用 MySQL 管理员；不改变原账号密码或原有库的授权，不需要重启 MySQL、PM2 或 Apache。[MySQL CREATE DATABASE](https://dev.mysql.com/doc/refman/8.4/en/create-database.html)、[MySQL GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html)

在 PuTTY 执行：

```bash
mysql --protocol=socket --user=root --password --show-warnings --execute="
CREATE DATABASE teachingcpp20260830test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON teachingcpp20260830test.* TO 'dbadmin'@'%';
SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='teachingcpp20260830test';
SELECT COUNT(*) AS test_table_count FROM information_schema.TABLES
WHERE TABLE_SCHEMA='teachingcpp20260830test';
SHOW GRANTS FOR 'dbadmin'@'%';
"
```

密码提示要求的是 **MySQL root 密码**，不一定与 Linux root 密码相同；不把密码写在命令后，也不发到对话中。如果你使用另一个 MySQL 管理员，先说明账号名。如果不知道管理员密码，不重置密码或停用认证，先保留现场。

预期新库排序规则 utf8mb4_0900_ai_ci、test_table_count 为 0，dbadmin 新增该测试库的授权。没有使用 IF NOT EXISTS：库名已存在时命令应该报错，不能直接沿用或删除已有库。若建库成功但授权失败，保留空库，不能盲目重跑整块命令。完成后先发回结果，下一步再上传并执行验证包。

## 第二步：使用验证包（建库结果核对后进行）

验证包只新增 `/var/www/teaching-cpp-backend/compat/p5js-20260830-01` 下的文件，不覆盖应用代码、.env 或 `/var/www/teaching-p5js-backend`。外层和包内分别带 SHA256 清单。上传、校验及解压命令根据第一步结果再给出；本文件不是让你现在越过校验直接执行。

核对文件后，从 C++ 应用根目录以 cpp-web 运行：

```bash
runuser -u cpp-web -- /var/www/teaching-cpp-backend/tools/node/bin/node \
  compat/p5js-20260830-01/verify-mysql.mjs \
  --run --confirm-empty-test-db teachingcpp20260830test
```

不改生产 .env 的 DB_NAME、APP_MODE 或两个开关。脚本在内存里从原配置只取连接凭据，数据库目标固定为 teachingcpp20260830test；需要确认参数完全相符才允许连接。先检查 MySQL 8.4、当前库名、空库和互斥锁，再执行任何建表操作；单条查询与行锁等待均有超时。所有模型通过注入这一个测试连接加载，不加载原 p5.js 的 config/db。

本机或服务器的无连接材料检查可以使用 --check-only。它不会读取 .env 中的数据库密码或连接数据库。

## 验证范围和边界

16 组检查覆盖：迁移前原查询；真实迁移及旧字段值保留；迁移重复执行保护；原模型混入 C++ 的对照；学生、教师及管理员范围；项目按 ID 查询；递归组与面包屑；文件查询和修改；C++ 仓储对 p5.js 的反向隔离；两类拖动事务；显式创建类别；文件插入及级联；导入所用的数据库事务回滚；两个连接下的 FOR UPDATE 锁等待与释放；正常 p5.js 修改和删除。涉及旧模型的每组写入后，完整比较虚拟 C++ 项目、作品组及文件记录是否保持不变。

这些检查会在测试库创建、修改虚拟记录和表结构；不会访问正式业务库。测试库不与原应用共享表，但仍共用 MySQL 实例的 CPU、内存和磁盘。本次数据量很小，仅顺序运行，最多两个连接，不是性能压测。

即使全部通过，也不能称为全站 HTTP、登录、AI 扣费、磁盘文件导入及完整并发回归通过；学生作品的同源浏览器风险、正式迁移备份和后续运行沙箱验证仍需处理。

执行成功或失败后均保留测试库。第二次运行会因库非空而拒绝；需要复测时先审查失败位置和测试库状态，不提供自动清库重跑命令。正式库的迁移与 p5.js 三个模型的发布另行安排。
