# C++ 多文件项目正式更新

本发布包将 teaching-cpp 从单个 `code` 字段更新为不可变的完整多文件快照，同时更新后端、Runner 和前端。包内内容由源码基准 `781c4a5ffacbe453bfec282665691def208e7eab` 上的已验证工作树生成，所有安装文件都由 SHA256 和字节数固定。

## 固定范围

- 替换 7 个后端源码文件、1 个共享合约文件和 2 个 Runner 文件。
- 新增 `backend/migrations/002_cpp_multifile.sql`；只为 `cpp_revisions` 和 `cpp_runs` 增加按项目清理索引，不修改共享 `files` 表结构，不写入源码正文。
- 将前端从服务器已核对的 `frontend-update-20260912-02` 基线切换到多文件构建。
- 不修改 `.env`、Apache、PM2 保存记录、systemd 单元、编译器镜像、p5.js 文件或主站文件。
- 正式执行顺序固定为：只读预检、私有备份、应用源码、数据库迁移、Runner 重启、C++ 后端重启、前端切换、完整核验。
- 替换后失败会恢复旧应用文件和旧前端，并再次重启这两个 C++ 服务。`002_cpp_multifile` 只增加索引；如已完成则恢复时保留，旧代码可安全忽略。

## 本地生成

```powershell
& 'D:\Program Files\nodejs\node.exe' deploy\multifile-update-20260915-01\package.mjs
```

输出的 `.tar.gz` 和 `.sha256` 位于 `releases/`。打包只读取当前工作区并执行离线材料检查，不连接生产环境。

## 服务器材料检查

将压缩包和外部 `.sha256` 上传到 `/var/www/teaching-cpp-backend`，核对后解压。包内所有内容都位于 `deploy/multifile-update-20260915-01/`。

```bash
cd /var/www/teaching-cpp-backend
sha256sum -c teaching-cpp-multifile-update-20260915-01.tar.gz.sha256
test ! -e deploy/multifile-update-20260915-01
tar -xzf teaching-cpp-multifile-update-20260915-01.tar.gz
tools/node/bin/node deploy/multifile-update-20260915-01/update.mjs --check-only
```

`--check-only` 只核对发布材料，不读取 `.env`、不连接数据库或服务，不修改文件。

## 生产只读预检

```bash
tools/node/bin/node deploy/multifile-update-20260915-01/update.mjs --preflight
```

预检会核对已采集的旧源码和前端基线、两个 C++ 服务、C++ 配置、Runner 健康状态、`001_cpp` 迁移、`002_cpp_multifile` 缺失状态、新索引缺失状态和空运行队列。不建立锁、不创建备份、不修改数据库或服务。

## 正式发布

只能在已完成数据库及 SourceStore 备份、已审查预检输出的维护窗口中执行：

```bash
tools/node/bin/node deploy/multifile-update-20260915-01/update.mjs --publish --backup-confirmed --production-reviewed
```

发布开始后会保留一次性锁和私有备份记录。无论成功或失败，都不要重复执行同一版本；先保留完整输出和备份目录。
