# C++ 作品管理后端接口更新

本发布材料只把来源提交 `b7763ad6e0753b5a442bd6940c8829eeaaebcd56` 中已经通过测试的 `backend/src/app.mjs` 和 `backend/src/service.mjs` 更新到生产 C++ 后端，用于补齐共享作品管理组件需要的作品与作品组定位接口。它不修改数据库结构或业务数据，不修改 `.env`、Apache、静态前端、PM2 保存记录、systemd、运行容器或原 p5.js 文件。

## 固定范围

- 新增 `PUT /api/cpp/projects/:id/reposition` 和 `PUT /api/cpp/groups/:id/reposition`，并使用现有仓库事务完成同组排序、跨组移动、父组校验、权限校验及失败回滚。
- 生产当前两个目标文件必须仍与 `predeploy-20260830-02` 的固定 SHA256 完全一致；不同则只读预检停止，不覆盖未知改动。
- 正式执行前先备份两个旧文件，随后用保留原属主和权限的临时文件原子替换；只通过 PM2 重启 `teaching-cpp-backend` 一项进程，不执行 `pm2 save`、`--update-env` 或 `restart all`。
- 发布前后核对 C++ 配置为 `production / writesEnabled=true / runEnabled=true`，固定的 05 静态前端、原 p5.js、主站、Apache、环境文件、PM2 保存记录和其他后端源码保持不变。
- 若替换或重启后的检查失败，程序会从私有备份恢复两个旧文件并再次只重启 C++ 后端。一次性锁会保留；不要重跑同一版本。

## 本地生成

先完成仓库测试、检查和构建，再执行：

```powershell
& 'D:\Program Files\nodejs\node.exe' deploy\backend-organizer-update-20260905-01\package.mjs
```

生成的 `.tar.gz` 和外部 `.sha256` 位于 `releases/`，不进入 Git。打包程序要求来源提交已在 `origin/main`，且两个后端文件相对来源提交没有变化；不会连接生产服务器。

## 上传与材料检查

用 WinSCP 二进制上传以下两个文件到 `/var/www/teaching-cpp-backend`：

- `teaching-cpp-backend-organizer-update-20260905-01.tar.gz`
- `teaching-cpp-backend-organizer-update-20260905-01.tar.gz.sha256`

服务器上执行：

```bash
cd /var/www/teaching-cpp-backend
sha256sum -c teaching-cpp-backend-organizer-update-20260905-01.tar.gz.sha256
test ! -e deploy/backend-organizer-update-20260905-01
tar -tzf teaching-cpp-backend-organizer-update-20260905-01.tar.gz
tar -xzf teaching-cpp-backend-organizer-update-20260905-01.tar.gz
tools/node/bin/node deploy/backend-organizer-update-20260905-01/update.mjs --check-only
```

压缩包内容必须全部位于 `deploy/backend-organizer-update-20260905-01/`。`--check-only` 只核对材料和新后端文件，不读取生产配置、不连接服务、不修改文件。

## 只读生产预检

```bash
tools/node/bin/node deploy/backend-organizer-update-20260905-01/update.mjs --preflight
```

预检会读取两个目标文件、C++ 与 p5.js 进程状态、公开接口和受保护文件，检查新文件语法；不会建立锁、备份、重启进程或修改文件。把完整输出发回，确认通过后再正式执行。

## 正式更新

正式模式为：

```bash
tools/node/bin/node deploy/backend-organizer-update-20260905-01/update.mjs --publish
```

成功后先把完整输出发回，再发布独立的 06 静态前端包。若输出提示已经自动恢复，或无法确认恢复完成，不要重跑、不要手工覆盖文件、不要重启其他进程，保留显示的备份目录并发回完整输出。
