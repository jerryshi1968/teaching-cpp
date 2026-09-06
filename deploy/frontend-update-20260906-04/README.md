# C++ 前端更新：teaching-prj-mgmt v0.1.3

本发布材料只更新 `https://tigao123.com/teaching-cpp/` 的静态前端，来源提交固定为 `8f8ff90970f382d90e50c9aec99f501533f58dbc`。它不迁移或连接数据库，不修改 `.env`、Apache 配置、主站 `.htaccess`、PM2 配置或 systemd 配置，不重启或平滑加载任何服务，也不操作 C++ 执行容器。

当前生产基线是 C++ 保存与运行均已启用。发布前和发布后都必须确认公开及本机 C++ 配置仍为 `production / writesEnabled=true / runEnabled=true`，两个网站 PM2 进程的 PID 与重启次数不变，原 p5.js 健康检查、首页和主站首页保持原响应。

## 固定范围

- 新前端继续使用 `teaching-prj-mgmt v0.1.3`，并仿照 p5.js 将作品组和作品分区显示；C++ 现有作品管理、拖放、编辑器、运行和保存行为保持不变。
- `source` 目录保存根 `package-lock.json`、前端 `package.json` 和四个固定版本 `.tgz`，只用于复现与审计，不在服务器安装或执行。
- 现有 Apache 继续引用 `deploy/web-publish-20260831-02/site.conf`；该历史目录和实际 HTTPS 配置不能删除、覆盖或重新发布。
- 当前公开前端必须与已成功发布的 `frontend-update-20260906-03` 四个构建文件完全一致。不同则只读预检停止，不猜测覆盖。
- `frontend-update-20260905-01` 只执行过材料检查和只读预检，未建立锁、备份或切换前端；因其旧基线早于品牌名称更新，本版本取代它。
- `frontend-update-20260905-02` 的新前端目录受进程 `umask 077` 影响成为 `0700`，HTTPS 检查返回 403 后已自动恢复旧前端；本版本显式把公开前端目录及 `assets` 目录设为 `0755`。
- `frontend-update-20260905-03` 已成功发布并通过公开检查，后续版本继续保持不改变后端或服务器配置。
- `frontend-update-20260905-04` 已成功发布并通过公开检查，加入了全宽作品工坊布局。
- `frontend-update-20260905-05` 已成功发布并通过公开检查，继续对齐了 p5.js 的班级选择、标题、按钮和作品卡片布局。
- `frontend-update-20260905-06` 已成功发布并通过公开检查，修正了卡片操作按钮的一致性。
- `frontend-update-20260905-07` 已成功发布并通过公开检查，分离了拖放排序与移入作品组的目标，并阻止作品组拖入自身。
- `frontend-update-20260905-08` 已成功发布并通过公开检查，精确对齐了操作图标、按钮盒子和底栏分隔线。
- `frontend-update-20260906-01` 已成功发布并通过公开检查，升级共享组件并修正网格排序及面包屑拖放；本版本继续修正向下拖放排序。
- `frontend-update-20260906-02` 已成功发布并通过公开检查，修正了作品及作品组向下拖到中间或末尾时恢复原位的问题。
- `frontend-update-20260906-03` 已成功发布并通过公开检查，升级共享组件到 v0.1.3，支持只读项目的宿主操作。
- 每个版本只允许发布一次。发布开始后保留一次性锁、日志现场和私有备份，失败后不能重跑同一包。

## 本地生成

先在来源提交上完成 `npm ci`、`npm test`、`npm run check`、`npm run build` 和 `git diff --check`，再执行：

```powershell
& 'D:\Program Files\nodejs\node.exe' deploy\frontend-update-20260906-04\package.mjs
```

生成文件位于 `releases/`，发布包和外部 `.sha256` 不进入 Git。打包程序只接受 `origin/main` 已包含来源提交、且前端源码及 vendor 文件相对该提交未变化的状态；不会连接生产服务器。

## 上传与材料检查

使用 WinSCP 二进制上传 `.tar.gz` 和 `.sha256` 到 `/var/www/teaching-cpp-backend`。不要上传 Windows `node_modules`、`.npm-cache`、`.env` 或本地构建暂存目录。

服务器上先只校验并解压到新的版本目录；若该目录已经存在，停止并发回结果，不覆盖或删除：

```bash
cd /var/www/teaching-cpp-backend
sha256sum -c teaching-cpp-frontend-update-20260906-04.tar.gz.sha256
test ! -e deploy/frontend-update-20260906-04
tar -tzf teaching-cpp-frontend-update-20260906-04.tar.gz
tar -xzf teaching-cpp-frontend-update-20260906-04.tar.gz
/var/www/teaching-cpp-backend/tools/node/bin/node deploy/frontend-update-20260906-04/update.mjs --check-only
```

压缩包内容必须全部位于 `deploy/frontend-update-20260906-04/`。`--check-only` 只核对包内清单、构建文件和可复现依赖，不读取生产配置或连接服务。

## 只读生产预检

材料检查通过后执行：

```bash
/var/www/teaching-cpp-backend/tools/node/bin/node deploy/frontend-update-20260906-04/update.mjs --preflight
```

预检会读取当前前端、Apache 引用、网站公开响应和 PM2 进程状态，并运行 `httpd -t`；不会建立发布锁或备份，不修改文件和服务。把完整输出发回，确认后才执行正式发布。

## 正式发布与恢复边界

正式模式为 `--publish`。它会重新执行全部预检，创建权限 `0700` 的新备份目录，把新文件放在私有暂存目录，随后在同一文件系统内将旧前端移入备份并切换新前端。发布后逐文件核对 HTTPS 内容、深路径、缺失资源、敏感路径拒绝、C++ 配置、原 p5.js、主站和 PM2 基线。

若切换后的检查失败，程序会把失败前端移到私有备份，并将旧前端恢复到原路径后重新检查。无论成功或失败，一次性锁都会保留；不要重复执行本版本。自动恢复不能确认时，不删除目录、不重启服务、不手工覆盖 Apache 或数据库，立即发回完整输出和程序显示的备份目录。

成功后再用真实浏览器检查桌面与窄屏：根目录、深层面包屑、新建、重命名、删除、上下排序、拖放、跨组移动、只读查看、保存运行和刷新重读；同时确认原 p5.js 首页、作品列表、保存和预览正常。
