# C++ 班级分发名称修正

本发布包只修正 C++ 项目向班级分发时的副本名称，使其与 p5.js 一致为 `来自教师名 - 原作品名`。班级收件人仍由后端完整枚举，副本继续放在每位学生的根作品组，并保留完整的不可变多文件快照。

## 固定范围

- 只替换 `/var/www/teaching-cpp-backend/backend/src/service.mjs`。
- 只重启 `teaching-cpp-backend`，不重启 Runner 或 p5.js。
- 不修改数据库结构、现有项目名称、前端、`.env`、PM2 保存记录或 systemd 单元。
- 只影响修正后新发起的分发；已经分发的副本不会被自动改名或重复创建。

## 服务器检查与发布

```bash
cd /var/www/teaching-cpp-backend
sha256sum --check --strict teaching-cpp-distribution-fix-20260915-01.tar.gz.sha256
test ! -e deploy/distribution-fix-20260915-01
tar -xzf teaching-cpp-distribution-fix-20260915-01.tar.gz
tools/node/bin/node deploy/distribution-fix-20260915-01/update.mjs --check-only
tools/node/bin/node deploy/distribution-fix-20260915-01/update.mjs --preflight
tools/node/bin/node deploy/distribution-fix-20260915-01/update.mjs --publish --backup-confirmed --production-reviewed
```

正式执行会再次完成只读预检、建立一次性锁和私有备份、原子替换一个后端文件、只重启 C++ 后端并核验服务、数据库、Runner、p5.js 和前端均保持预期状态。失败时会恢复旧文件并再次启动 C++ 后端。
