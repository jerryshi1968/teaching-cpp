# p5.js 类别隔离补丁草稿：2026-08-30

**当前不是部署包，不要把 patched 目录上传覆盖到原 p5.js 后端。** 正式数据库尚未迁移。两个同步文件的内容与语法检查已通过，5080 健康检查 HTTP 200，PM2 为 online、重启计数 67。MySQL 和 HTTP 集成验证尚未完成。整个 compat 子目录可作为验证材料放在 C++ 后端下，不会自动替换原站文件。

本目录中的三个 model 源文件与用户回报的线上校验值一致（仅统一 CRLF/LF 后比较）。reference 保留本机原文件字节，patched 保存修改副本，manifest.json 记录修改前后校验值。生成草稿没有写入 G:\teaching-p5js 或生产服务器；用户另行同步两个应用文件的操作不属于本补丁。

## 草稿改变的行为

- projectModel.js：个人、教师、管理员的列表、搜索、计数和按 ID 查询限定 p5js；重命名、删除、移动、排序、清理父组同样限定类别。新建项目显式写入 p5js。
- projectGroupModel.js：作品组列表、递归子树、面包屑、计数及修改限定 p5js；拖动时目标组和排序参考项保持相同用户及类别。新建作品组显式写入 p5js。
- fileModel.js：查询和修改文件时检查所属项目为 p5js；两条创建入口通过 INSERT ... SELECT 限定目标项目，未插入时返回 404 错误，不能对 C++ 项目建立旧平台文件记录。[MySQL INSERT ... SELECT 说明](https://dev.mysql.com/doc/refman/8.4/en/insert-select.html)

本次仅改 SQL 类别限制及文件创建结果处理，没有删除或修改已有注释，没有对其他代码进行格式化。注册、密码、班级码直接入班、用户角色、余额、充值与 AI 扣费逻辑不在本补丁修改范围。

## 验证记录及边界

本机执行：

```powershell
& 'D:\Program Files\nodejs\node.exe' --test compat\p5js-20260830-01\tests\category-isolation.test.mjs
```

结果：17 项通过。使用独立的 SQLite 内存数据库，实际执行模型产生的查询，验证同一用户混合 p5js/cpp 项目时的行为，并检查修改前后的 C++ 记录保持不变。保留了一个原模型对照案例，确认原版本会混入 C++ 项目和文件。三个修改文件均通过 JavaScript 语法检查。

测试仅移除了 SQLite 不支持的 FOR UPDATE；它不能验证 MySQL 方言、行锁、死锁和并发行为。测试也未启动原网站或覆盖全部 HTTP/文件系统操作，不能称为生产回归完成。授权仍由已有调用层负责，模型类别条件不能替代用户/教师权限验证；创建父组关系仍需经过已有控制器校验，不能直接拿底层 create/move 函数当开放接口。

两个线上差异文件已完成同步后的核验。正式发布前仍须完成 MySQL 及相关入口验证，安排维护窗口和最终备份。必须先完成正式库的 001_cpp 数据库迁移，再启用本补丁；类别字段不存在时这些查询会报错，不会自动降级为无类别限制查询。C++ 写入和执行仍应关闭，直到对应验证完成。

MySQL 验证材料见 MYSQL-VERIFICATION.md、mysql-fixture.sql 和 verify-mysql.mjs。它使用同一 MySQL 实例中的专用空库 teachingcpp20260830test，读取现有 dbadmin 凭据但固定覆盖连接目标；不修改生产 .env，不连接正式库。包含 16 组检查，目前仅通过本机材料和语法检查，尚无服务器 MySQL 执行结果。

同域名学生作品的浏览器隔离仍是单独待核验事项，本补丁不解决该风险。见 docs/p5js-compatibility.md。
