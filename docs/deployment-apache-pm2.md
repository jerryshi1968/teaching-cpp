# 在现有 Apache + PM2 服务器上逐步部署 C++ 平台

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

这份指南对应你实际的服务器。服务器操作由你在 PuTTY / WinSCP 中完成；我根据每一步结果给出下一步命令，不要求另外购买服务器。第 1～5 步及第 6 步 A～D 已完成：用户回报专用测试库上的 16 项 MySQL 8.4.9 验证全部通过，原站健康检查 HTTP 200、PM2 online、重启计数 67。测试库现在已有虚拟数据，保留供核查，不再重跑建库或验证命令。第 6 步 E 也已完成：用户回报正式库迁移、三个模型发布和原站恢复成功，原表记录核验通过。第 7 步已完成：用户回报 cpp-web 身份的 C++ 后端在 127.0.0.1:5180 正常运行，写入和执行关闭；p5.js PID 3341075、重启计数 67 未变，C++ PID 3342469、重启计数 0，两个进程均 online。第 8 步已于 2026-08-31 北京时间 09:33:06 完成：Apache 与只读前端发布成功，pm2 save 已执行，用户截图显示 C++ 工作台并识别了既有教师会话。用户随后确认原 p5.js 作品保存、预览正常，C++ 班级与学生展示正常，这两项浏览器回归已通过。用户还回报一个现有 p5.js 作品返回 HTTP 200、text/html，但没有 CSP 响应头；本地浏览器比较已确认独立预览来源可阻止作品读取平台页面并保留测试素材加载。第 9 步 02 修正版已于 2026-08-31 执行成功，C++ 写入现已启用、运行仍关闭；用户明确确认新建、保存、刷新后重新打开正常。p5.js 自动健康检查通过，原进程重启计数仍为 67；用户随后澄清 p5.js 修改作品后的保存和运行也正常，本轮原站浏览器回归通过。用户已将同源风险交由原 p5.js 项目处理，独立执行服务的只读环境检查已完成，基本前提符合继续准备条件，尚未安装容器组件；Podman 正式安装也已完成：新增 17 项、升级 2 个 SELinux 策略包；安装后两个网站、原配置和 PM2 重启计数检查通过。本项目第 10 步 F 的服务器下载曾在元数据请求阶段超时；用户随后已在 Windows 成功生成 GCC 离线包，本地复核通过。服务器离线导入和教学镜像构建现已成功；CPU 计量修正及全部 18 项真实容器验证也已由用户回报通过，执行入口已经切换。内部执行服务已于 13:16:52Z～13:17:05Z 完成启动、认证、真实编译、CPU/137 对照及服务重启恢复验证，已设置开机启动，记录 runner-service-start-zMMEp9；网站运行保持关闭。网站接入已于 13:46:03Z～13:46:09Z 完成，记录 web-running-enable-hTFDVJ；只重启 C++ 网站后端，其他服务保持。用户截图确认网页输入 17 30、输出 a + b = 47、状态运行完成。基础部署与首次真实网页运行通过，下一步验证刷新后的运行历史及测试班的模板分发、学生运行和教师只读查看。暂缓服务器网络诊断，不重跑原下载，不再安排预览站点或 DNS 改动。原站完整浏览器回归、备份下载和开机恢复实测仍待回报。以下早期检查按发生时记录，以本段和各步骤的最新结果为准。

## 已确认的情况

- Rocky Linux，2 核 / 4GB；Apache 提供 HTTPS 网站，原 p5.js 后端由 PM2 管理。
- p5.js 后端目录 `/var/www/teaching-p5js-backend`，后端端口 **5080**。
- p5.js 前端目录 `/var/www/html/teaching-p5js`。
- MySQL 在 `127.0.0.1:3306`，现有数据库 **teaching_p5js**。
- 5000～5002 已被其他服务占用，不修改、不停用这些服务。
- 本次在当前生产服务器部署。虽然目前只有你使用，仍保留备份、避免覆盖旧目录、先关闭 C++ 写入和执行等保护措施。
- 已核对 MySQL **8.4.9**，以及 projects/project_groups/users/classes/files 五张表的结构，符合当前迁移的主要类型与排序规则要求；这不等于迁移已经执行或所有业务兼容性已验证。
- 当前 Node 为 **20.20.2**，npm 为 **10.8.2**，PM2 为 **7.0.1**；均位于 `/usr/bin`。原 `p5js-backend` 在 root 的 PM2 中以 fork 模式运行。
- Apache 为 **2.4.62**，已加载 proxy、proxy_http、ssl、alias、dir 模块。已读取域名的 HTTPS 配置 `/etc/httpd/conf.d/tigao123-le-ssl.conf` 和 HTTP 配置 `/etc/httpd/conf.d/tigao123.conf`。主站 DocumentRoot 为 `/var/www/html`，HTTP 与 www 入口会重定向，三个 `/tools/` 服务保留现状。
- 本次端口检查中 5180、5280 未被监听；5080 实际监听在 `*`，不只是回环地址。后续 C++ 的两个服务仍只绑定 `127.0.0.1`，本步骤不改变原站监听方式或防火墙。
- 服务器架构为 **x86_64**；`/var/www` 所在磁盘剩余 **26GB**，原后端 **48MB**、前端 **11MB**，空间足够进行本轮文件备份。
- 2026-08-30 16:36，数据库已导出至 `/var/www/teaching-cpp-backend/backups/before-cpp-Hw7zPYSp/teaching_p5js.sql`，大小约 **153KB**，用户回报 SHA256 校验通过。尚未确认下载至本机或完成恢复验证。
- 2026-08-30 16:47，文件备份完成于上述目录的 `files-iq9mnRzu` 子目录；`site-files.tar.gz` 约 **42MB**，文件清单、PM2 JSON/保存记录/服务配置等均通过 SHA256 校验。原 `p5js-backend` 仍为 `online`，重启计数仍为 66。本机下载和恢复验证仍未确认。
- 第 3 步安装成功：C++ 专用 Node 为 **24.20.0**，自带 npm **11.19.0**，固定入口为 `/var/www/teaching-cpp-backend/tools/node`。系统 `/usr/bin/node` 仍为 **20.20.2**，原 p5.js 仍在线、重启计数仍为 66。安装包 SHA256 已在服务器校验通过。
- 第 4 步准备成功：网站账号 cpp-web 的 UID 为 **995**、GID 为 **992**；88 个运行依赖已安装，配置加载及目录权限检查通过。当时写入和执行关闭，未连接数据库、密码尚待配置；后续连接已在第 5 步 C 验证。npm 的新版本提示不需要执行。
- 01 包修复记录位于 `/var/www/teaching-cpp-backend/backups/useradd-fix-NoMZXnat`，其中 `DEPLOYMENT-FILES.after.sha256` 为本次修复后的有效校验清单。服务器保留原 01 包，不用重新上传 02 包；原 p5.js 仍在线、重启计数仍为 66。
- 第 5 步 A 查询已完成：实际匹配的数据库账号为 **dbadmin@%**，没有启用角色；在 teaching_p5js 和 qbank 两个库拥有库级 ALL PRIVILEGES，但没有 CREATE USER 或 GRANT OPTION 权限。teaching_p5js 中现有 8 张表全部为 InnoDB、utf8mb4_0900_ai_ci；C++ 表和 project_type 字段计数均为 **0**。第 5 步 B 已修改 `.env`，沿用 dbadmin。
- 第 5 步 C 已通过：`.env` 权限为 **root:cpp-web 640**；以 cpp-web 身份加载生产配置，写入和执行仍关闭；实际数据库连接为 **dbadmin@% / teaching_p5js**，原有五张表的字段读取权限检查通过。没有修改数据、迁移或启动 C++ 服务。原 p5js-backend 为 online、重启计数 66、内存约 91.4MB。
- 第 6 步 A 已完成：线上共 31 个代码文件，29 个规范化 SHA256 与本机一致；差异只有 app.js 和 services/exampleService.js。三个核心 model 文件均一致。线上清单已记录于 deploy/p5js-server-20260830.sha256；仅把本机 app.js 的默认端口 5000 改成 5080 仍不能得到线上校验值，不据此猜测差异内容。
- 第 6 步 B 已通过：用户同步后的 app.js、services/exampleService.js 与本机内容一致，系统 Node 语法检查通过；5080 配置通过，健康检查 HTTP 200，p5js-backend online、重启计数 67、内存约 66.8MB。deploy/p5js-server-20260830.sha256 保留同步前记录；本次核验记录写入兼容草稿的 manifest.json，尚未进行全站业务回归。
- 第 6 步 C 已通过：teachingcpp20260830test 已创建，字符集 utf8mb4、排序规则 utf8mb4_0900_ai_ci，test_table_count 为 0。dbadmin@% 已拥有该测试库的 SELECT、INSERT、UPDATE、DELETE、CREATE、REFERENCES、INDEX、ALTER 权限；teaching_p5js 与 qbank 的原有 ALL PRIVILEGES 保留。这是建库时的记录，之后已完成第 6 步 D，测试库现在包含验证数据。
- 原 p5.js 的作品由 Apache Alias 映射至 `/var/www/teaching-p5js-backend/storage/projects/`，文件备份必须覆盖这个目录。原 API 使用不带结尾斜杠的 `ProxyPass /api http://127.0.0.1:5080/api`；新增 `/api/cpp/` 代理应放在主站 HTTPS VirtualHost 内、原 p5.js 代理段之前，不能直接追加到文件末尾。本轮尚不编辑该配置。

本项目清单要求 Node.js 至少 22.12。现在 C++ 使用已单独安装的 Node 24 LTS，通过 `/var/www/teaching-cpp-backend/tools/node` 明确指定，不替换 `/usr/bin/node`、原 PM2 或修改全局环境。Node 20 已结束官方支持，原站的升级另行安排，避免把升级风险混入本次新增平台部署。[Node.js 官方版本状态](https://nodejs.org/en/about/previous-releases)

## 目录和端口统一这样安排

```text
/var/www/
├── teaching-p5js-backend/           原后端，不覆盖
├── teaching-cpp-backend/            C++ 应用根目录
│   ├── package.json
│   ├── package-lock.json
│   ├── backend/                    C++ 网站后端代码
│   ├── shared/                     共用定义
│   ├── runner/                     执行服务代码
│   ├── frontend/                   工作区清单/构建文件，不能代替公网发布目录
│   ├── scripts/
│   ├── deploy/
│   ├── docs/
│   ├── .env                        网站配置，仅网站服务用户可读
│   ├── .env.runner                 执行配置，仅执行用户可读
│   ├── storage/                    正式 C++ 代码，不允许通过 HTTP 访问
│   ├── logs/                       网站进程日志
│   ├── backups/                    部署备份，仅管理员可读，建议再下载一份
│   ├── tools/                      C++ 专用 Node，由 root 管理，不改变系统 Node
│   └── runtime/                    网站服务用户的运行文件
├── teaching-cpp-runner/             独立执行用户的家目录
│   ├── runner-data/                编译临时目录和内部结果
│   ├── .config/                    Podman 和用户服务配置
│   └── .local/                     rootless Podman 镜像等文件
└── html/
    ├── teaching-p5js/              原前端，不覆盖
    └── teaching-cpp/               仅发布构建后的前端文件
```

额外分出 `teaching-cpp-runner` 是为了让执行学生程序的 Linux 用户和网站用户分开。目录都集中在 `/var/www`，但不能把两者权限混在一起，也不能用 `chmod -R 777` 解决权限问题。Apache 配置仍在现有系统配置目录，系统生成的 `/run/user/<UID>` 等运行目录也保留默认位置。

| 用途 | 地址 | 对公网开放？ |
| --- | --- | --- |
| 原 p5.js / 公共身份后端 | `127.0.0.1:5080` | 保持现有 Apache 代理规则 |
| 新 C++ 网站后端 | 暂定 `127.0.0.1:5180` | 只通过 Apache 的 `/api/cpp/` 路径访问 |
| 新 C++ 执行服务 | 暂定 `127.0.0.1:5280` | 不配置公网入口 |
| 新 C++ 前端 | `https://tigao123.com/teaching-cpp/` | 由 Apache 读取前端发布目录 |

5180 和 5280 必须先检查没有被占用。公网仍只访问原来的 HTTPS 端口，不需要在云安全组或防火墙放行 5180/5280。

## 第 1 步：核对环境（已完成，以下命令留作记录）

在平时能看到原 p5.js PM2 进程的 PuTTY 会话中，逐行执行：

```bash
whoami
node -v
npm -v
pm2 -v
command -v node npm pm2 httpd mysql mysqldump
pm2 list
httpd -v
httpd -S
httpd -M | grep -E 'proxy_module|proxy_http_module|ssl_module|alias_module|dir_module|headers_module'
ss -lntp '( sport = :5080 or sport = :5180 or sport = :5280 )'
```

这些命令用于了解当前用户、软件版本、程序位置、已有 PM2 进程、Apache 配置文件位置和端口情况，不会修改网站配置或数据库。`pm2 list` 若看不到原项目，请不要新启动一个原项目实例，先把结果发来。

然后执行这条只读数据库查询：

```bash
mysql -h 127.0.0.1 -P 3306 -u dbadmin -p --vertical teaching_p5js -e "SELECT VERSION() AS mysql_version; SHOW CREATE TABLE users; SHOW CREATE TABLE classes; SHOW CREATE TABLE files;"
```

出现 `Enter password:` 时在 PuTTY 输入数据库密码并回车。输入不显示是正常现象，**密码不用发给我，也不要写成命令参数**。查询只返回数据库版本与表结构，不读取用户密码、手机号或作品内容。

把这两组输出发回。如某个命令报错，贴报错即可，不要自行安装、升级、重启服务或执行 SQL 修复。

## 第 2 步 A：创建私有备份目录，导出数据库（已完成，以下命令留作记录）

这一步只创建 C++ 后端目录及其备份目录，并读取数据库生成备份。不会停止原站、执行迁移、覆盖原文件或重启服务。备份期间不要改表或发布新版本，也先不要编辑作品。

在当前 root 的 PuTTY 会话中，完整复制执行下面一整块，包含开头和结尾的圆括号。出现 `Enter password:` 时输入数据库密码；不要把密码或备份内容发回对话。

```bash
(
  set -euo pipefail
  umask 077
  test "$(id -u)" -eq 0
  install -d -m 0755 /var/www/teaching-cpp-backend
  install -d -m 0700 /var/www/teaching-cpp-backend/backups
  cpp_backup_dir=$(mktemp -d /var/www/teaching-cpp-backend/backups/before-cpp-XXXXXXXX)
  printf '备份目录：%s\n' "$cpp_backup_dir"

  mysqldump -h 127.0.0.1 -P 3306 -u dbadmin -p \
    --single-transaction --quick --no-tablespaces \
    --set-gtid-purged=OFF --default-character-set=utf8mb4 \
    --routines --events --triggers --hex-blob --comments --dump-date \
    --result-file="$cpp_backup_dir/teaching_p5js.sql.partial" teaching_p5js

  test -s "$cpp_backup_dir/teaching_p5js.sql.partial"
  tail -n 5 "$cpp_backup_dir/teaching_p5js.sql.partial" | grep -q '^-- Dump completed on '
  mv "$cpp_backup_dir/teaching_p5js.sql.partial" "$cpp_backup_dir/teaching_p5js.sql"
  cd "$cpp_backup_dir"
  sha256sum teaching_p5js.sql > SHA256SUMS
  sha256sum -c SHA256SUMS
  ls -lh teaching_p5js.sql SHA256SUMS
  printf '数据库导出完成：%s\n' "$cpp_backup_dir"
)
```

正常结束应显示 `teaching_p5js.sql: OK`（或本地化的成功提示）和最后的“数据库导出完成”。命令会检查导出退出状态、非空文件和完成标记，再计算校验值；任一步失败即停止后续操作。导出或完成标记检查失败时，文件保留 `.partial` 后缀，不能认定备份成功；改名后的校验若报错，也须先处理错误。报错时发回错误信息，不自行删掉导出选项、放宽数据库权限或尝试恢复 SQL。每次执行都会建立不同的备份子目录，不覆盖上次结果。

使用 WinSCP 把最后显示的整个 `before-cpp-...` 目录下载到自己的私有备份位置。这些文件包含账号密码哈希、用户信息和作品索引，不能放进 `/var/www/html`、公开分享或上传到代码仓库。文件校验成功只说明导出文件可读取且校验值匹配，**尚不等于完成恢复验证，也不是整个网站的备份**；后续还要打包原站文件、配置并核验恢复方案。此备份不包含 MySQL 系统账号与授权。

数据库导出采用适用于 InnoDB 的一致性快照；导出期间不能进行表结构变更。若库中还有其他存储引擎，需在迁移前另外核对其备份一致性。[MySQL 官方备份说明](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html#option_mysqldump_single-transaction)

随后查看原目录体积、剩余空间、机器架构及实际 Apache 配置，为下一步文件备份与安装做准备：

```bash
df -h /var/www
du -sh /var/www/teaching-p5js-backend /var/www/html/teaching-p5js
uname -m
cat /etc/httpd/conf.d/tigao123-le-ssl.conf
cat /etc/httpd/conf.d/tigao123.conf
```

发回备份命令的终端结果和上面这组输出，不发送 SQL 文件、`.env`、PM2 环境变量快照或证书私钥。如果 Apache 配置里有密码、令牌或带账号密码的代理地址，先遮盖这些值；证书文件路径不等于私钥内容，可以保留。

## 第 2 步 B：备份原站文件、Apache 配置和 PM2 信息（已完成，以下命令留作记录）

本轮不停止或重启任何服务，不修改原站文件或数据库。先暂停自己编辑作品、上传文件、修改配置的操作。以下属于部署准备阶段的在线备份，数据库与文件并非同一时刻的原子快照；正式迁移前还需在停止业务写入的窗口做最后备份并核验恢复方案。

仍在 root 的 PuTTY 会话中，完整复制执行下面一整块，包含首尾圆括号。沿用已经确认的数据库备份目录，但文件备份每次建立不同子目录，不覆盖现有 SQL 或校验文件。

```bash
(
  set -euo pipefail
  umask 077
  test "$(id -u)" -eq 0
  cpp_backup_root=/var/www/teaching-cpp-backend/backups/before-cpp-Hw7zPYSp
  cd "$cpp_backup_root"
  sha256sum -c SHA256SUMS
  cpp_files_dir=$(mktemp -d "$cpp_backup_root/files-XXXXXXXX")
  cd "$cpp_files_dir"
  printf '文件备份目录：%s\n' "$cpp_files_dir"

  tar --acls --xattrs --selinux -czf site-files.tar.gz.partial -C / \
    var/www/teaching-p5js-backend \
    var/www/html/teaching-p5js \
    etc/httpd/conf etc/httpd/conf.d etc/httpd/conf.modules.d \
    etc/letsencrypt/options-ssl-apache.conf

  tar -tzf site-files.tar.gz.partial > ARCHIVE-FILES.txt
  grep -q '^var/www/teaching-p5js-backend/storage/projects/' ARCHIVE-FILES.txt
  grep -q '^var/www/html/teaching-p5js/index.html$' ARCHIVE-FILES.txt
  mv site-files.tar.gz.partial site-files.tar.gz

  pm2 jlist > pm2-processes.json
  node --input-type=commonjs -e 'JSON.parse(require("fs").readFileSync("pm2-processes.json", "utf8"));'
  cpp_pm2_home="${PM2_HOME:-/root/.pm2}"
  if [ -f "$cpp_pm2_home/dump.pm2" ]; then
    cp -p "$cpp_pm2_home/dump.pm2" pm2-saved-dump.json
  fi
  systemctl list-unit-files --no-legend --no-pager 'pm2*.service' > pm2-services.txt
  while read -r cpp_unit cpp_unit_state; do
    systemctl cat "$cpp_unit"
  done < pm2-services.txt > pm2-service-config.txt

  sha256sum site-files.tar.gz ARCHIVE-FILES.txt pm2-*.json pm2-*.txt > SHA256SUMS
  sha256sum -c SHA256SUMS
  ls -lh site-files.tar.gz
  pm2 list
  printf '文件备份完成：%s\n' "$cpp_files_dir"
)
```

应看到各文件校验成功、`p5js-backend` 仍为 `online`，以及最后的“文件备份完成”。任一步报错就停在这里，把错误消息发回，不加 `|| true` 跳过检查，也不要因为 tar 报“file changed as we read it”而把不完整备份当作成功。目录或文件缺失、存储路径是外部符号链接等情况也需要先核实。

备份范围为原前后端完整目录（含 `.env`、依赖、学生作品）、Apache 主配置/虚拟主机/模块配置、SSL 公共选项配置、PM2 当前进程信息、已有保存记录（若存在）和可发现的 `pm2*.service` 开机服务配置。不会复制证书私钥，也不包含整台服务器、其他网站数据或 MySQL 系统账号。自定义为其他名称的 PM2 启动服务、外部符号链接目标需另行确认。

`pm2 jlist` 只读取当前进程列表；这里不调用 `pm2 save`、`pm2 restart`、`pm2 update` 或 `pm2 startup`，不覆盖原 PM2 状态。保存的 JSON 可能包含环境变量与密码，只放在当前私有目录，不把内容贴到对话中。[PM2 官方命令说明](https://pm2.keymetrics.io/docs/usage/pm2-doc-single-page/)

使用 WinSCP 将整个 `/var/www/teaching-cpp-backend/backups/before-cpp-Hw7zPYSp` 目录下载到本机私有位置，包括原 SQL、两个层级的 SHA256SUMS 和这次新增的 files 子目录。不要放进公网目录或上传到 Git。发回终端输出即可；无需发任何备份文件、`.env`、PM2 JSON 或服务配置内容。

确认这一步后，再单独安装 C++ 使用的 Node 24，不替换 `/usr/bin/node`，也不运行全局 npm/PM2 更新。

## 第 3 步：为 C++ 单独安装 Node 24（已完成，以下命令留作记录）

本步骤使用 2026-08-30 核对过的官方 **Node v24.20.0 Linux x64** 预编译包，适合已确认的 x86_64 架构。选择 `.tar.gz` 包约 58MB，沿用前面已经成功使用的 gzip/tar，不额外要求安装 xz。不编译 Node，不升级系统软件，也不修改全局 PATH、原 PM2 或 `/usr/bin/node`。

安装位置：

```text
/var/www/teaching-cpp-backend/tools/
├── downloads/node24-XXXXXXXX/       本次下载、校验记录及临时解压位置
├── node-v24.20.0-linux-x64/          新 Node 的完整目录
└── node -> node-v24.20.0-linux-x64   供后续配置使用的固定入口
```

这些运行工具由 root 管理，后续网站和执行服务的普通用户仅使用它们，不获得修改工具目录的权限。不要对整个 `/var/www/teaching-cpp-backend` 递归改属主，否则可能同时暴露备份或使服务账号能够替换运行工具。

如尚未把前两步的整个备份目录下载到电脑，请先通过 WinSCP 下载到私有位置。然后在 root 的 PuTTY 会话中完整执行下面一整块，包含首尾圆括号：

```bash
(
  set -euo pipefail
  umask 022
  test "$(id -u)" -eq 0
  test "$(uname -m)" = x86_64
  command -v curl tar sha256sum >/dev/null
  cpp_tools=/var/www/teaching-cpp-backend/tools
  cpp_node_name=node-v24.20.0-linux-x64
  cpp_node_archive="$cpp_node_name.tar.gz"
  cpp_node_sha=855d581f8a4eb1a8117e3426de25fe02770592febcfb31369aee1ffbfee9e8ec

  for cpp_path in "$cpp_tools/node" "$cpp_tools/$cpp_node_name"; do
    if [ -e "$cpp_path" ] || [ -L "$cpp_path" ]; then
      printf '安装目标已存在，停止以避免覆盖：%s\n' "$cpp_path" >&2
      exit 1
    fi
  done
  install -d -m 0755 "$cpp_tools" "$cpp_tools/downloads"
  cpp_download_dir=$(mktemp -d "$cpp_tools/downloads/node24-XXXXXXXX")
  cd "$cpp_download_dir"
  printf '下载目录：%s\n' "$cpp_download_dir"

  curl --fail --location --proto '=https' --proto-redir '=https' \
    --retry 2 --connect-timeout 15 --max-time 300 \
    --output "$cpp_node_archive" \
    "https://nodejs.org/dist/v24.20.0/$cpp_node_archive"

  printf '%s  %s\n' "$cpp_node_sha" "$cpp_node_archive" > SHA256SUMS
  sha256sum -c SHA256SUMS
  tar --no-same-owner --no-same-permissions -xzf "$cpp_node_archive"
  test "$("$cpp_download_dir/$cpp_node_name/bin/node" -v)" = v24.20.0
  "$cpp_download_dir/$cpp_node_name/bin/node" \
    "$cpp_download_dir/$cpp_node_name/lib/node_modules/npm/bin/npm-cli.js" --version

  mv -T "$cpp_download_dir/$cpp_node_name" "$cpp_tools/$cpp_node_name"
  ln -s "$cpp_node_name" "$cpp_tools/node"
  printf 'C++ 专用 Node：\n'
  "$cpp_tools/node/bin/node" -v
  printf '系统原有 Node：\n'
  /usr/bin/node -v
  pm2 list
  printf '独立 Node 安装完成：%s\n' "$cpp_tools/node"
)
```

预期看到压缩包校验 `OK`、一个 npm 版本号、C++ 专用 Node 为 `v24.20.0`、系统原有 Node 仍为 `v20.20.2`，以及原 `p5js-backend` 仍为 `online`。此时直接输入 `node -v` 仍得到旧版本是正常的，因为没有更改全局环境；后续会为 C++ 启动与依赖安装明确指定新 Node。

新版 npm 随官方 Node 包一起安装。上面用新 Node 的完整路径调用 npm，避免 npm 的启动脚本误用系统旧 Node。后续安装应用依赖时，还要为那条命令的子进程设置临时 PATH；不要现在自行运行全局 `npm install -g`、PM2 更新或系统 Node 升级。

任一步失败即停止，不跳过校验、不关闭 HTTPS 证书验证，也不直接删除已存在的目标目录。下载超时、缺少 curl、缺少运行库或出现目标已存在时，把终端错误发回；可以按情况改为 WinSCP 上传同一官方安装包后校验。不要自行下载未知镜像站或运行来源不明的一键安装脚本。

版本、文件名及 SHA256 值取自 [Node 官方下载目录](https://nodejs.org/dist/latest-v24.x/) 与 [官方校验清单](https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)，校验记录固定为本次的 v24.20.0，不会自动追随后续更新。官方支持条件见 [Node v24.20.0 平台说明](https://github.com/nodejs/node/blob/v24.20.0/BUILDING.md#platform-list)。这里只提供并检查了部署命令，实际安装是否完成以你发回的服务器结果为准。

下一步再准备应用上传包、服务账号和依赖安装；尚不开放 C++ 数据写入或程序运行。

## 第 4 步：上传应用、准备网站账号和运行依赖（已完成，以下留作记录）

本轮只在新 C++ 后端目录中准备文件、账号与依赖，不启动 PM2 应用，不连接或修改数据库，不修改 Apache，也不将前端复制到公开网站目录。旧 p5.js 的类别隔离补丁尚未完成，C++ 保存写入与程序执行继续保持关闭。

### 4.1 用 WinSCP 上传两个文件

本机部署包位于 `G:\teaching-cpp\releases`：

- `teaching-cpp-predeploy-20260830-02.tar.gz`
- `teaching-cpp-predeploy-20260830-02.tar.gz.sha256`

02 包修正了创建账号的参数，仅供尚未上传应用的首次部署使用。**当前服务器已完成 01 包解压、第 4.4 节修复及后续准备，不再上传或解压 02 包，也不重复执行修复块。**

用 WinSCP 将这两个文件原样上传到服务器 **`/var/www/teaching-cpp-backend/`**。压缩包使用二进制传输，不在 Windows 解压后逐文件上传，不放进 `/var/www/html`。后端目录内原有的 `backups` 和 `tools` 保持不变，不删除或覆盖。

压缩包保留应用根目录、backend/shared/runner/frontend/scripts/deploy/docs/tests 的相对结构，并包含已构建的 `frontend/dist`；不含本机 node_modules、演示数据、运行缓存、真实 `.env`、备份或 Node 工具。这里只准备 C++ 代码，不包含旧 p5.js 的兼容修改，也不应直接当作已经可公开运行的版本。

### 4.2 在 PuTTY 校验、解压和准备

仍使用当前 root 会话，完整复制执行下面一整块：

```bash
(
  set -euo pipefail
  umask 022
  test "$(id -u)" -eq 0
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  sha256sum -c teaching-cpp-predeploy-20260830-02.tar.gz.sha256

  for cpp_entry in package.json package-lock.json README.md backend shared runner frontend scripts deploy docs tests deployment-manifest.json DEPLOYMENT-FILES.sha256; do
    if [ -e "$cpp_entry" ] || [ -L "$cpp_entry" ]; then
      printf '发现已有应用文件，停止以避免覆盖：%s\n' "$cpp_entry" >&2
      exit 1
    fi
  done
  tar --no-same-owner --no-same-permissions --keep-old-files \
    -xzf teaching-cpp-predeploy-20260830-02.tar.gz
  sha256sum --quiet -c DEPLOYMENT-FILES.sha256
  bash deploy/prepare-first-install.sh
  pm2 list
)
```

如果解压后因为网络等原因中断，先发回报错；不要重复整个解压块，不要删除目录，不要运行 `chmod -R 777` 或对整个项目 `chown -R`。核对已有状态后，可以仅继续尚未完成的准备步骤。

### 4.3 这一步会做什么

- 创建专用网站系统账号 **cpp-web**，不设置登录密码，不允许通过 SSH 登录，不接管原 p5.js，也不用于执行学生程序。
- 账号家目录与 PM2 运行文件放在 `/var/www/teaching-cpp-backend/runtime`，权限 700；正式源码存储目录 `storage` 权限 700；日志目录 `logs` 权限 750。这三个目录属于 cpp-web。
- 项目代码、安装好的 Node 与依赖仍由 root 管理。`backups` 继续为 root 所有、权限 700；网站账号不能进入备份目录或修改 Node。
- 使用已确认的新 Node/npm，仅安装 backend 和 runner 两个工作区的生产依赖，禁用依赖安装脚本，不安装或更新全局软件。npm 下载缓存放在已有 `tools/downloads` 下。前端已经本机构建，不在服务器重新构建。[npm 官方安装说明](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
- 从本次专用示例创建初始 `.env`，所有者 root、用户组 cpp-web、权限 640。保持生产身份模式、5180/5080/5280 地址，以及写入和运行关闭。数据库账号 cpp_app 和真实密码将在后续单独配置，**此时不尝试数据库连接，也不需要你发送密码**。
- 以 cpp-web 身份检查依赖与配置可读、三个指定目录可写，同时确认项目根目录、Node 与备份没有被放开权限。

Linux 用户信息写入 `/etc/passwd` 等系统文件是创建账号的必要操作；账号附属的系统文件按服务器自身规则处理，不为省去它们而修改全局账号配置。执行服务的 cpp-runner 账号、Podman 和真实 C++ 编译仍留待后续步骤处理。

正常结束应显示“网站账号可加载运行依赖与配置；写入关闭，执行关闭，未连接数据库”、cpp-web 的账号与目录权限，以及“C++ 上传与初始准备完成”。最后原 `p5js-backend` 仍应为 `online`。发回终端输出即可；不要发送 `.env` 的内容。

本机构建成功，原有自动检查 22 项通过，1 项 MySQL 集成检查未执行；两个后端工作区的生产依赖已在独立临时目录中安装并成功加载。Linux 账号创建与权限检查需以本轮服务器实际结果确认。前端发布包有一个编辑器体积提示，不影响当前构建；本轮不修改编辑器实现。

后续先准备数据库专用账号、核对迁移和旧平台兼容修改，随后才启动受保护的 C++ 后端并接入 Apache。不要现在复制 frontend/dist 到公网目录或自行启动应用。

### 4.4 修复 01 包创建账号时的 CREATE_MAIL_SPOOL 报错（已完成）

用户回报 01 包的压缩包与逐文件校验已通过，随后出现 `configuration error - unknown item 'CREATE_MAIL_SPOOL'`。这是准备脚本的参数错误，不是上传失败。`useradd -K` 用于 login.defs 配置项，CREATE_MAIL_SPOOL 属于 useradd 自身的默认配置，不能通过这里的 `-K` 覆盖。[上游参数说明](https://github.com/shadow-maint/shadow/blob/master/man/useradd.8.xml)、[上游默认配置读取代码](https://github.com/shadow-maint/shadow/blob/master/src/useradd.c)

修复只删除创建账号命令里的 `-K CREATE_MAIL_SPOOL=no`，保留全部注释、其他参数、原有权限检查与保护开关；不修改 `/etc/login.defs` 或 `/etc/default/useradd`，不删除账号或用户组。不要重新上传或解压整个项目。

以下是已执行成功的修复命令，保留作记录；当前服务器不重复执行：

```bash
(
  set -euo pipefail
  test "$(id -u)" -eq 0
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  cpp_before=689ed0f1906b50e1cd7a58f24806949dae4337a39864630e67b5c30935a36075
  cpp_after=2ae760d98702ab583e74c7312517473cec2a726cbffd8475ff1a9f5fff6871f4
  sha256sum --quiet -c DEPLOYMENT-FILES.sha256
  printf '%s  deploy/prepare-first-install.sh\n' "$cpp_before" | sha256sum -c -

  cpp_fix_dir=$(mktemp -d /var/www/teaching-cpp-backend/backups/useradd-fix-XXXXXXXX)
  cp -p deploy/prepare-first-install.sh DEPLOYMENT-FILES.sha256 "$cpp_fix_dir/"
  sed -i 's/-K CREATE_MAIL_SPOOL=no cpp-web/cpp-web/' deploy/prepare-first-install.sh
  printf '%s  deploy/prepare-first-install.sh\n' "$cpp_after" | sha256sum -c -
  sed "s/^$cpp_before /$cpp_after /" DEPLOYMENT-FILES.sha256 > "$cpp_fix_dir/DEPLOYMENT-FILES.after.sha256"
  sha256sum --quiet -c "$cpp_fix_dir/DEPLOYMENT-FILES.after.sha256"
  bash -n deploy/prepare-first-install.sh
  printf '脚本修复通过，原文件与修复后校验清单保存在：%s\n' "$cpp_fix_dir"

  bash deploy/prepare-first-install.sh
  pm2 list
)
```

这段命令先确认原文件与 01 包完全相同，再做唯一的一处替换并验证预期新文件哈希。原部署包、JSON 清单及原始 DEPLOYMENT-FILES.sha256 保留作 01 包的基线；修复后有效的逐文件清单保存在打印的修复目录内。以后复核已修复目录时，应从项目根目录对该 `DEPLOYMENT-FILES.after.sha256` 执行校验，不将原基线中这一项预期变化当作未知改动。

若修复成功后遇到网络、账号或依赖错误，先发回输出，不重复上面的修复块。准备脚本会核对已有 cpp-web 账号的家目录、shell 和用户组，不会因为重试而改动用途不同的现有账号；同名组存在但账号缺失时也会停止要求核对。修复成功不代表第 4 步整体完成，需看到准备完成提示和原 p5.js 仍在线的结果。

## 第 5 步 A：检查数据库授权与迁移前状态（已完成，以下留作记录）

刚创建的 **cpp-web 是 Linux 账号**，负责运行网站进程；原计划建议的 **cpp_app 是 MySQL 账号**，负责访问数据库。它们是两种不同的账号。下面保留当时的检查步骤；查询完成后，用户提出沿用现有 dbadmin，第 5 步 B 按此路径继续，不要求先创建 cpp_app。

先确认现有 dbadmin 是否具有创建和授权账号的权限，并检查库中是否已有 C++ 表或类别字段。本步只有查询，不创建账号、不改表、不读取学生资料或源码，也不启动服务。`SHOW GRANTS` 可以查看当前连接账号的授权，不要求先授予读取整个 mysql 系统库的权限。[MySQL 官方说明](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html)

在 PuTTY 完整复制执行下面这一条命令。出现 `Enter password:` 时输入原 dbadmin 数据库密码；输入不显示是正常的，密码不要发回。

```bash
mysql -h 127.0.0.1 -P 3306 -u dbadmin -p --table teaching_p5js -e "
SELECT CURRENT_USER() AS authenticated_account,
       CURRENT_ROLE() AS active_roles,
       DATABASE() AS database_name;
SHOW GRANTS;
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;
SELECT COUNT(*) AS existing_cpp_tables
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND LEFT(TABLE_NAME, 4) = 'cpp_';
SELECT COUNT(*) AS existing_project_type_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('projects', 'project_groups')
  AND COLUMN_NAME = 'project_type';
"
```

正常情况下，末尾两个计数都应是 **0**，表示当前账号可见的范围内尚无 C++ 表及类别字段；仍需结合授权结果判断，不能仅凭计数断言整个数据库的状态。发回完整终端输出即可。如果报权限错误，或计数不是 0，保留现状并发回结果，不自行创建、删除表或重复执行迁移。

已核对结果：当前 dbadmin 权限足够进行应用读写及计划中的库内表结构变更，但不能创建或授权新账号。库级 ALL PRIVILEGES 不包含全局 CREATE USER，也不会自动带上 GRANT OPTION。[MySQL 授权说明](https://dev.mysql.com/doc/refman/8.4/en/grant.html)、[创建账号所需权限](https://dev.mysql.com/doc/refman/8.4/en/create-user.html)。本次可沿用 dbadmin，不需要提升它的权限或取得 MySQL root 密码。正式改表与开放写入前仍需处理旧 p5.js 的类别隔离、维护窗口备份及恢复核验。

## 第 5 步 B：沿用现有 dbadmin 配置连接（已完成）

独立的低权限数据库账号是安全建议，不是程序运行的硬性前提。C++ 后端从 DB_USER 读取账号，运行时没有要求账号名必须是 cpp_app。现有 dbadmin 可以继续使用，无需新建账号、修改原 p5.js 配置或增加数据库授权。

需要了解的取舍是：dbadmin 对 teaching_p5js 和 qbank 都有完整的库级权限，包括删除表。如果 C++ 网站后端发生漏洞或数据库凭据泄露，影响可能扩展到这两个库。低权限独立账号能够缩小影响范围，面向公众开放时仍建议采用；它不能代替学生程序的隔离。独立 cpp-web 网站用户和后续 cpp-runner 执行用户继续保留，执行服务不得获得网站 `.env` 或数据库密码。

本步只编辑新 C++ 网站的配置文件，不修改数据库，不启动服务：

1. 用 WinSCP 打开 `/var/www/teaching-cpp-backend/`，如看不到 `.env`，启用显示隐藏文件。将当前 `.env` 复制一份到该项目的私有 `backups` 目录，使用一个未占用的备份文件名，不放进 `/var/www/html`。
2. 编辑 `/var/www/teaching-cpp-backend/.env`，把 `DB_USER=cpp_app` 改为 **`DB_USER=dbadmin`**。
3. 将原 `/var/www/teaching-p5js-backend/.env` 中的 **DB_PASSWORD 整行原样复制**过来，替换新配置中的 `DB_PASSWORD=REPLACE_ON_SERVER`。保留原行的引号等格式，不复制整个旧 `.env`，不修改旧文件，也不要把密码发到对话里。
4. 保持 `DB_HOST=127.0.0.1`、`DB_PORT=3306`、`DB_NAME=teaching_p5js`、`CPP_PRODUCTION_WRITES=disabled` 和 `CPP_RUN_ENABLED=false` 不变，其他配置、注释也保持原样。

保存后文件仍应由 root 所有、用户组 cpp-web、权限 640。下一步将检查权限、解析配置并做只读连接验证；此时 C++ 表尚不存在，不能直接启动正式后端来测试连接。

第 4 步已经完成，**不要重新运行 `deploy/prepare-first-install.sh`**：它是首次准备工具，末尾按初始模板核对 cpp_app，改用 dbadmin 后重跑会报配置阶段不匹配；这不代表应用不支持 dbadmin。不需要为这次配置选择修改业务代码、解压新包或改动既有校验清单。

## 第 5 步 C：以网站账号验证配置和数据库连接（已完成，以下留作记录）

在 root 的 PuTTY 会话中完整执行下面一整块。它只会将新项目 `.env` 的所有者、用户组和权限恢复为 root:cpp-web、640；不会改写文件内容。随后以 cpp-web 身份读取配置并建立一个数据库连接，只查询连接身份和验证原有五张表的字段读取权限，不返回业务记录，不执行迁移，不启动或重启服务。

密码直接从服务器 `.env` 读取，不需要再输入，也不会输出配置内容。发生错误时只显示错误码；例如 CONFIG_DB_USER 表示对应配置项不符合当前阶段要求，DB_PASSWORD_MISSING 表示密码未填写，ER_ACCESS_DENIED_ERROR 表示数据库拒绝登录。不要改用 root 运行网站或开放配置文件权限来跳过错误。

```bash
(
  set -euo pipefail
  test "$(id -u)" -eq 0
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  test -f .env && test ! -L .env
  chown root:cpp-web .env
  chmod 0640 .env
  stat -c '%U:%G %a %n' .env

  runuser -u cpp-web -- /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module <<'NODE'
import fs from 'node:fs';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
let pool;
try {
  const env = dotenv.parse(fs.readFileSync('.env'));
  const expected = {
    NODE_ENV: 'production', APP_MODE: 'production', PORT: '5180',
    DB_HOST: '127.0.0.1', DB_PORT: '3306',
    DB_NAME: 'teaching_p5js', DB_USER: 'dbadmin',
    CPP_PRODUCTION_WRITES: 'disabled', CPP_RUN_ENABLED: 'false',
    COMMON_API_URL: 'http://127.0.0.1:5080/api',
    RUNNER_URL: 'http://127.0.0.1:5280',
    CPP_STORAGE_ROOT: '/var/www/teaching-cpp-backend/storage'
  };
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) throw Object.assign(new Error(), { code: 'CONFIG_' + key });
  }
  if (!env.DB_PASSWORD || env.DB_PASSWORD === 'REPLACE_ON_SERVER') {
    throw Object.assign(new Error(), { code: 'DB_PASSWORD_MISSING' });
  }
  const { readConfig } = await import('./backend/src/config.mjs');
  const config = readConfig(env);
  console.log('配置检查通过；生产身份模式，写入关闭，执行关闭。');
  pool = mysql.createPool({ ...config.db, connectionLimit: 1, connectTimeout: 10000 });
  const [rows] = await pool.query({
    sql: 'SELECT CURRENT_USER() AS account, DATABASE() AS database_name', timeout: 10000
  });
  console.table(rows);
  for (const sql of [
    'SELECT id, username, role, class_code, tokens FROM users LIMIT 0',
    'SELECT id, class_code, teacher_user_id FROM classes LIMIT 0',
    'SELECT id, user_id, name, parent_id, sort_order FROM projects LIMIT 0',
    'SELECT id, user_id, name, parent_id, sort_order FROM project_groups LIMIT 0',
    'SELECT id, project_id, name, path FROM files LIMIT 0'
  ]) await pool.query({ sql, timeout: 10000 });
  console.log('数据库连接及原有表读取权限检查通过；未修改数据、未迁移、未启动服务。');
} catch (error) {
  console.error('检查失败，错误码：', error.code || 'CONFIG_CHECK_FAILED');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
NODE

  pm2 list
)
```

预期先显示 `root:cpp-web 640 .env`，随后显示配置检查通过、数据库身份 dbadmin@%、数据库 teaching_p5js，以及最后的数据库连接检查通过。原 p5js-backend 应仍为 online、重启计数 66。请发回终端输出；不要发送 `.env`、密码或备份内容。任一步失败都保持现状，先根据错误码处理。

本机仅检查了这段命令的 shell 和 JavaScript 语法，没有连接生产数据库；服务器结果以上述实际执行输出为准。连接成功也不等于可以直接上线：接下来仍需准备旧 p5.js 类别隔离修改，并按维护窗口和备份安排迁移。

## 第 6 步 A：核对线上 p5.js 后端代码版本（已完成，以下留作记录）

第 5 步 C 已通过，C++ 网站账号能够读取配置并连接 teaching_p5js；这还不代表共享表已迁移或两个平台已隔离。现在先为兼容修改确定线上源文件版本，避免把本机版本直接覆盖到生产服务器。

只读检查本机 G:\teaching-p5js 后发现，项目、作品组和文件查询尚未按 project_type 区分平台，核心 SQL 位于三个对应的 model 文件；旧接口还包括复制、分发、排序、文件操作、示例导入、教师查看、AI 和管理员项目列表。兼容修改要覆盖这些调用范围，但保留现有注册、班级码直接入班及余额逻辑。本轮没有修改原 p5.js 的代码、配置或数据库。

先在 PuTTY 执行下面这一整块。它只读取 app.js、package.json 及指定应用代码目录中的 JavaScript 文件，输出文件名和校验值；不会执行这些文件，不读取 .env、学生作品、node_modules 或整站备份，不连接数据库，也不修改文件或重启服务。

```bash
(
  set -euo pipefail
  cd /var/www/teaching-p5js-backend
  test "$(pwd -P)" = /var/www/teaching-p5js-backend
  /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - /var/www/teaching-p5js-backend <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fs.realpathSync(process.argv[2]);
const files = [];
function collect(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error('拒绝读取符号链接：' + relative);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute).sort()) {
      if (!name.startsWith('.') && name !== 'node_modules') collect(relative + '/' + name);
    }
  } else if (stat.isFile() && (/\.(js|cjs|mjs)$/.test(relative) || relative === 'package.json')) {
    files.push(relative);
  }
}
for (const relative of ['app.js', 'package.json', 'config', 'controllers', 'middleware', 'models', 'routes', 'services', 'utils']) {
  collect(relative);
}
for (const relative of files.sort()) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
  const digest = createHash('sha256').update(source, 'utf8').digest('hex');
  console.log(digest + '  ' + relative);
}
console.log('代码文件数量：' + files.length);
NODE
)
```

请发回完整终端输出。本机参考包含 **31 个文件**；线上数量或个别值不同不一定是错误，可能是线上有更新，需要逐项核对，不能因此覆盖、删除或重新上传旧平台文件。

此处的 SHA256 在内存中把 Windows 的 CRLF 换行统一为 LF 后计算，避免单纯换行格式造成差异；不会忽略代码、注释或其他空白，也不改写原文件。本机参考清单保存在 deploy/p5js-reference-20260830.sha256，只用于这种规范化比较，不能直接用 sha256sum -c 核验未处理换行的源文件。本步骤不需要上传该清单或其他新文件。

本机已运行相同的只读扫描并检查服务器命令的语法。待服务器结果对齐后，按实际版本制作兼容修改及验证材料；如果有差异，只补取有差异的相关文件，不要求上传含密码和用户数据的整站备份。

## 第 6 步 B：同步后的只读核验（已完成，以下留作记录）

用户已确认漏同步并自行更新服务器上的 app.js 和 services/exampleService.js。本步骤替代先前的下载安排，不需要再下载两个文件，也不需要额外修改它们。同步前的线上校验记录仍保留在 deploy/p5js-server-20260830.sha256。

本机 app.js 使用 process.env.PORT，未配置时备用端口为 5000；服务器的 5000 已被其他服务占用，因此需确认原 p5.js 的配置仍选择 5080。文件同步不等于已经核验运行中进程加载的版本；这里不重启原站，后续发布时再安排受控重启与回归。

在 PuTTY 执行下面一整块。它核对两个文件的内容和语法，读取原站 .env 及 PM2 配置以确认端口，并访问 5080 健康检查；不输出密码、令牌或完整环境，不修改配置、不执行迁移，也不重启服务。健康检查只显示 HTTP 状态，不打印响应正文。

```bash
(
  set -euo pipefail
  cd /var/www/teaching-p5js-backend
  test "$(pwd -P)" = /var/www/teaching-p5js-backend
  /usr/bin/node --check app.js
  /usr/bin/node --check services/exampleService.js
  /usr/bin/node --input-type=commonjs <<'NODE'
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
let stage = '文件校验';
try {
  const expected = {
    'app.js': '52c7faec2a641a0f21e8a16b754757f01f65d5902f5f0b7ef4a4b28633d51203',
    'services/exampleService.js': '9f1e7d2f3bd401072cc06a7eb50727ecfd00ff7811ded2ce9f4a16b52fd3bb70'
  };
  for (const [file, hash] of Object.entries(expected)) {
    stage = file + ' 内容校验';
    if (!fs.lstatSync(file).isFile()) throw new Error();
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    if (createHash('sha256').update(source).digest('hex') !== hash) throw new Error();
    console.log(file + '：与本地一致，语法检查通过');
  }
  stage = '读取原站端口配置';
  const fileEnv = require('dotenv').parse(fs.readFileSync('.env'));
  const processes = JSON.parse(execFileSync('/usr/bin/pm2', ['jlist'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024
  }));
  const matches = processes.filter(item => item.name === 'p5js-backend');
  if (matches.length !== 1) throw new Error();
  const config = matches[0].pm2_env;
  stage = 'PM2 运行目录、入口和状态';
  if (config.status !== 'online' ||
      fs.realpathSync(config.pm_cwd) !== process.cwd() ||
      fs.realpathSync(config.pm_exec_path) !== process.cwd() + '/app.js') throw new Error();
  stage = '5080 端口配置';
  const port = config.PORT ?? config.env?.PORT ?? fileEnv.PORT;
  if (String(port) !== '5080') throw new Error();
  console.log('p5.js 配置端口 5080：通过；PM2 状态：online');
} catch {
  console.error('检查未通过：' + stage + '。请保留现状，不要重启或修改文件。');
  process.exitCode = 1;
}
NODE
  curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
    --output /dev/null --write-out '5080 健康检查：HTTP %{http_code}\n' \
    http://127.0.0.1:5080/api/health
  pm2 list
)
```

请发回完整输出，预期两个文件一致、5080 配置通过、健康检查 HTTP 200、p5js-backend 为 online。任一步失败先按提示核查，不自动覆盖文件或改端口。这里只确认磁盘文件及当前服务可用，不证明同步后的代码已经被进程加载，也不替代后续兼容补丁的回归验证。

本项目 compat/p5js-20260830-01 中保留三个原 model 的原文副本、修改草稿和校验清单。17 项 SQLite 内存数据检查通过，覆盖平台筛选、教师范围、管理员列表、排序、拖动和文件操作；这不是 MySQL 行锁或线上 HTTP 回归验证。草稿没有修改 G:\teaching-p5js，不能直接部署，更不能在类别字段迁移前替换原站模型。既有备份保留同步前版本，正式发布前还须备份同步后的当前版本。

## 第 6 步 C：建立独立 MySQL 测试库（已完成，以下留作记录）

测试仍在这台服务器上完成，不需要新服务器、容器或数据库账号。使用新库 **teachingcpp20260830test**，里面只有虚拟测试数据，与正式 teaching_p5js 的表分开。已有 dbadmin 的权限足够操作正式库，但尚无新测试库权限，所以这一步需要 MySQL 管理员建库及授权；前文“不需要 MySQL root”指现有正式库的应用连接和库内迁移，不包含额外建立、授权测试库。

在 PuTTY 执行下面这一块，在 Enter password 提示时输入 **MySQL root 密码**，不把密码写入命令或发到对话中：

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

预期显示新库 utf8mb4 / utf8mb4_0900_ai_ci，test_table_count 为 0，dbadmin 增加该测试库的授权，原 teaching_p5js 与 qbank 权限保留。不修改正式表，不重启任何服务，不改生产 .env。建库和授权的权限要求见 [MySQL CREATE DATABASE](https://dev.mysql.com/doc/refman/8.4/en/create-database.html)、[MySQL GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html)。

如果不知道 MySQL 管理员密码，或平时用另一个管理员账号，请说明，不重置密码。如果库已存在、建库或授权失败，先发回错误，不删除已有库、不盲目重跑。完成后发回输出，下一步才上传并执行已准备的验证材料。

验证材料位于 compat/p5js-20260830-01，详见 MYSQL-VERIFICATION.md。脚本固定测试库名、检查空库，使用与正式迁移相同的 SQL 和模型原文；不会加载原 p5.js 数据库配置。16 组 MySQL 检查包含迁移数据保留、双向类别隔离、正常修改、事务回滚及双连接行锁。用户现已回报 16 项均在服务器 MySQL 8.4.9 上通过，日志为 /var/www/teaching-cpp-backend/logs/mysql-verification-E5B5he9F.log。

已准备独立验证包 releases/teaching-cpp-mysql-verification-20260830-01.tar.gz，共 12 个文件、17092 字节，SHA256 为 b942d27b18658646a3f5db1447e6f76a1b0e115ebbacf69ab3e2ffe1548b035f。它只包含 compat 子目录，不包含 .env、数据库密码或正式应用替换文件；上传、校验及执行现已通过；保持此包不变，后续无需重传或重新解压。

## 第 6 步 D：上传并运行 MySQL 验证包（已完成，不重跑）

在 WinSCP 左侧打开 `G:\teaching-cpp\releases`，右侧打开 `/var/www/teaching-cpp-backend`，只上传以下两个文件，使用二进制传输，不手工解压、不上传到 p5.js 后端或前端目录：

- teaching-cpp-mysql-verification-20260830-01.tar.gz
- teaching-cpp-mysql-verification-20260830-01.tar.gz.sha256

上传后在 PuTTY 执行下面一整块。先验证已安装 C++ 代码、压缩包及解压文件，再以 cpp-web 运行检查。它会在 teachingcpp20260830test 中建表并修改虚拟数据，不连接正式业务库，不替换原 p5.js 模型，不重启服务。**保持生产 .env 不变，不把 DB_NAME 改成测试库名，也不需要再输入 MySQL root 密码。**

```bash
(
  set -euo pipefail
  umask 022
  test "$(id -u)" -eq 0
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  cpp_archive=teaching-cpp-mysql-verification-20260830-01.tar.gz
  cpp_verify_dir=compat/p5js-20260830-01
  cpp_node=/var/www/teaching-cpp-backend/tools/node/bin/node

  sha256sum --quiet -c backups/useradd-fix-NoMZXnat/DEPLOYMENT-FILES.after.sha256
  printf '%s  %s\n' b942d27b18658646a3f5db1447e6f76a1b0e115ebbacf69ab3e2ffe1548b035f "$cpp_archive" | sha256sum -c -
  sha256sum -c "$cpp_archive.sha256"
  test -f .env && test ! -L .env
  test "$(stat -c '%U:%G:%a' .env)" = root:cpp-web:640
  test ! -L compat
  if [ -e compat ]; then test -d compat; fi
  if [ -e "$cpp_verify_dir" ] || [ -L "$cpp_verify_dir" ]; then
    printf '验证目录已存在，停止以避免覆盖：%s\n' "$cpp_verify_dir" >&2
    exit 1
  fi
  tar --no-same-owner --no-same-permissions --keep-old-files -xzf "$cpp_archive"
  sha256sum -c "$cpp_verify_dir/VERIFICATION-FILES.sha256"
  runuser -u cpp-web -- "$cpp_node" --check "$cpp_verify_dir/verify-mysql.mjs"
  runuser -u cpp-web -- "$cpp_node" "$cpp_verify_dir/verify-mysql.mjs" --check-only

  cpp_verify_log=$(mktemp /var/www/teaching-cpp-backend/logs/mysql-verification-XXXXXXXX.log)
  printf 'MySQL 验证日志：%s\n' "$cpp_verify_log"
  runuser -u cpp-web -- "$cpp_node" "$cpp_verify_dir/verify-mysql.mjs" \
    --run --confirm-empty-test-db teachingcpp20260830test 2>&1 | tee "$cpp_verify_log"
  curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
    --output /dev/null --write-out '原 p5.js 健康检查：HTTP %{http_code}\n' \
    http://127.0.0.1:5080/api/health
  pm2 list
)
```

预期包及文件校验通过，显示目标测试库 teachingcpp20260830test、MySQL 8.4.9，然后依次显示 16 组通过；最后原站健康检查 HTTP 200、PM2 online。行锁检查会故意短暂等待，属于正常验证。日志只记录阶段、虚拟测试结果及错误码，不记录密码或 .env。

请发回完整输出。任何一步失败就停止；**不要重跑整块命令、删除测试库或覆盖现有验证目录**。脚本保留失败现场，测试库一旦有表会拒绝从头再跑。核对错误后再给出对应的下一步处理方法。

本机已核对压缩包完整性、12 个文件的内容和路径范围、脚本语法、--check-only 及错误目标参数拒绝行为。随后用户回报服务器 16 项 MySQL 验证通过；验证包保持原校验值不变，包内文档反映准备时状态，最新结果和下一步以第 6 步 E 为准。

## 第 6 步 E：维护备份、正式迁移与三个模型发布（已完成，不重跑）

专用材料及操作说明见 [首次正式发布说明](../deploy/production-20260830-01/README.md)。只上传 releases 中 teaching-cpp-production-20260830-01.tar.gz 及其 .sha256 文件，按本次对话的固定 SHA256 核验。新包只添加 deploy/production-20260830-01，不覆盖旧应用或已验证的 compat 文件。

本次会短暂停止 p5js-backend，在停止期间重新备份同步后的原站与数据库，再迁移并只发布 models/projectModel.js、models/projectGroupModel.js、models/fileModel.js，检查后恢复原站。app.js、services/exampleService.js、两个 .env、Apache、其他服务均不修改；C++ 写入和执行仍关闭。发布完成前不要编辑原站作品或同时更改服务器文件。

发布脚本已通过本机语法、无连接材料检查和失败阶段调度测试；本机没有 Linux PM2/MySQL，尚未执行整套服务器发布。当前本地检查合计 74 项通过、1 项可选 MySQL 检查跳过，其中包括 22 项原控制器调用边界检查。服务器的 16 项真实 MySQL 结果另行记录于发布包 evidence.json。不能把这些结果等同于完整线上登录、文件系统、AI 或浏览器回归。

收到“正式兼容发布完成”后再检查原站登录、作品列表、测试作品保存与预览，下载新建的私有备份目录，并发回发布日志和 PM2 状态。异常时保留现场；脚本不自动还原整库或删除新增字段，恢复条件不满足可能保持原站暂停。

第 6 步 E 实际结果：2026-08-30 北京时间 21:38:12～21:38:18，脚本完成预检、暂停、维护窗口备份、迁移、三个模型发布和原站恢复，日志显示成功；健康检查通过不等于浏览器业务回归。日志：`/var/www/teaching-cpp-backend/logs/production-publish-oavQgG6L.log`。备份：`/var/www/teaching-cpp-backend/backups/first-publish-xoptT8`。正式发布包及包内清单保持不变，其中打包时的 prepared 状态不用于覆盖本条服务器结果。

## 第 7 步：C++ 后端只读启动（已完成，不重跑）

见 [C++ 后端启动说明](../deploy/backend-start-20260830-01/README.md)。使用新包 teaching-cpp-backend-start-20260830-01.tar.gz，不重传整个应用或重新迁移。沿用 root PM2，新进程名 teaching-cpp-backend，实际以 cpp-web（995:992）运行，使用专用 Node 24.20.0，仅监听 127.0.0.1:5180。配置和密码仍从原 .env 读取，写入及执行继续关闭。

脚本核验普通用户、实际监听者、配置接口及原站进程未重启。该步骤不修改 Apache、不开放防火墙、不发布前端，暂不执行 pm2 save；成功后再安排公网接入与开机恢复保存。启动材料已通过本地语法和无连接检查，Linux/PM2/MySQL 启动结果尚待服务器回报。

第 7 步实际结果：2026-08-30 北京时间 21:57:20，普通账号数据库结构读取、实际 UID/GID、Node、监听地址、只读配置及原站健康检查通过。日志：`/var/www/teaching-cpp-backend/logs/backend-start-dc9xcNnJ.log`。C++ 内存约 83.9MB，p5.js 约 60.9MB，这是当时单次观测，不是课堂性能结论。

## 第 8 步：保存进程列表、Apache 与只读前端接入（已完成，不重跑）

本步实际使用 [网页发布第二次修正版说明](../deploy/web-publish-20260831-02/README.md) 中的 teaching-cpp-web-publish-20260831-02.tar.gz，已经执行成功，不再上传或运行。四个前端文件直接使用服务器原先的 frontend/dist，已与首次上传包核对一致。web-publish-20260830-01 在发布前停止；web-publish-20260831-01 在重载后失败并成功撤回。旧包和目录均不重跑、不覆盖。

本步先备份 Apache 和 PM2 保存信息，保存两个已验证的进程，再复制新前端到 /var/www/html/teaching-cpp，并在主站 HTTPS 原 /api 代理之前加入对新 site.conf 的引用。原配置原文、注释、证书、三个工具和 p5.js 路径保留，语法通过后平滑加载。脚本检查 HTTPS 页面、资源内容与类型、API 和原站入口，失败时有条件恢复原配置并撤回新前端，不重启两个后端、不修改数据库或 .env。

2026-08-31 用户回报确认：旧版日志在 2026-08-30T14:23:56.894Z 开始预检，因主站回退返回 HTTP 200 被误判为已有 C++ 入口而停止；新前端目录不存在，Apache 无 C++ 入口，本次未进入备份、PM2 保存或发布改动阶段。修正版核验返回内容与实际主站首页逐字一致后允许继续，只在 C++ Directory 中关闭继承的主站重写并配置自己的页面回退；主站 .htaccess 不修改，注释和原编码均保留。新版尚未在服务器执行；本机没有 Apache，真正的语法和路由检查以服务器结果为准。成功后到 https://tigao123.com/teaching-cpp/ 用原账号验证登录，预期仍显示生产写入关闭。先不要新建、保存、分发或运行。

## 第 9 步：只启用 C++ 编辑（02 版已完成，不重跑）

使用 [写入启用说明](../deploy/write-enable-20260831-02/README.md) 对应的新包 teaching-cpp-write-enable-20260831-02.tar.gz。该包只修改 C++ 的写入开关并重启 teaching-cpp-backend，自动保存私有配置备份；不修改 Apache、前端、原 p5.js 或数据库结构，不重新执行 pm2 save。编译运行保持关闭。失败后有条件恢复只读，不回滚业务数据。

用户已经明确授权把同源问题交由原 p5.js 项目处理；本轮不以该问题阻断部署，也不宣称它已修复。类别兼容模型和正式迁移仍按已发布结果核验，防止平台间作品混用。

成功后先用自己的账号新建“部署验收”、修改代码并保存，刷新后重新打开核对；再确认 p5.js 列表不出现 C++ 作品且原作保存、预览正常。真实模板分发稍后在只有测试账号的班级验证，不直接给全班试发。执行服务、单程序隔离验证和性能测试属于后续步骤。

修正版本地完整检查 110 项：109 项通过，1 项可选 MySQL 跳过；本轮没有连接服务器或生产数据库。上传、后台执行及验收命令随本轮对话交付。

01 版服务器结果：在 2026-08-31T03:44:31.172Z 的启用前检查中出现 ER_UNSUPPORTED_PS，日志为 /var/www/teaching-cpp-backend/logs/write-enable-lm5zd7Wp.log。未进入备份、开关修改或重启，仍为只读。02 版只修正事务控制语句的发送接口，旧目录、包和校验值不改。实际命令见 [本轮修正版操作](write-enable-20260831-02.md)。

2026-08-31 第 9 步已执行成功：用户回报 write-enable-20260831-02 于 2026-08-31T04:03:26.881Z 开始预检，随后完成配置备份、仅启用写入、仅重启 C++ 后端和各项核验。日志：/var/www/teaching-cpp-backend/logs/write-enable-02-crzIeNIg.log；备份：/var/www/teaching-cpp-backend/backups/write-enable-0uHa5u。C++ 写入现已启用、执行仍关闭。PM2 中 p5js-backend online、重启计数 67；teaching-cpp-backend online、重启计数 1。脚本确认原 p5.js 未重启，Apache、前端、PM2 保存记录及数据库结构未修改。用户明确确认 C++ 新建、保存、刷新后重新打开正常。用户随后澄清是笔误，确认 p5.js 修改作品后的保存和运行也正常；本轮原站浏览器回归通过。

下一步为独立执行服务的环境采集，见 [Runner 准备检查](runner-preparation-20260831.md)。先只读检查，不安装软件、不创建账号、不启动容器或开启运行。

## 第 10 步 A：执行服务环境采集（已完成）

2026-08-31 用户已回报采集结果：六项容器组件均未安装；shadow-utils 4.9-15.el9、systemd 252-55.el9_7.8.rocky.0.1 已安装，newuidmap/newgidmap 均存在。cpp-runner 账号与目录尚无；subuid/subgid 均仅见 apphttp:100000:65536，此范围保留。cgroup v2 控制器包含 cpu、memory、pids，user.max_user_namespaces=14483；/var/www 为 ext4、剩余 26GB、5280 无监听。基础条件支持继续准备，但尚未实测 rootless 容器、seccomp 或资源限制。下一步见 [Podman 安装清单预览](runner-install-plan-20260831.md)。

## 第 10 步 B：预览 Podman 安装事务（已完成）

用户回报完整清单：新增 17 包、升级 selinux-policy 与 selinux-policy-targeted 两包，下载约 28MB；没有删除或替换项，未列出 Apache、MySQL、Node、systemd 的升级。日志：`/var/www/teaching-cpp-backend/logs/podman-install-plan-78jwV6p1.log`。Operation aborted / 退出码 1 来自 --assumeno，未安装软件。原预览说明保留为历史，不重复执行。

## 第 10 步 C：正式安装 Podman（已完成）

2026-08-31 用户已回报正式安装成功：新增 17 包，两个 SELinux 策略包从 38.1.65-1.el9_7.1 升至 38.1.75-2.el9_8，Podman 为 5.8.2。DNF 事务检查、事务测试和最终安装均通过，.env、/etc/selinux/config、/etc/subuid、/etc/subgid 校验通过，SELinux 仍 Disabled。两个网站 HTTPS 检查通过，PM2 中 p5js-backend / teaching-cpp-backend 均 online，前后重启计数为 67 / 1；本次列表未提供 PID，不能据此补记 PID 实测。安装记录：/var/www/teaching-cpp-backend/backups/podman-install-fkY7Dz5i；日志：/var/www/teaching-cpp-backend/logs/podman-install-tsbrcupt.log。执行服务仍未启动。

## 第 10 步 D：准备独立执行账号（02 版已完成，不重跑）

2026-08-31 最新状态：网页运行已启用，网站账号连接和调度锁检查通过；用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次真实网页运行成功。只重启了 C++ 网站后端，p5.js、Apache、执行服务和用户管理器保持。下一步按 [课堂功能检查](classroom-acceptance-20260831.md) 验证刷新与历史、原站及测试班流程，不再执行安装或启用脚本。下方旧步骤保留作历史记录，不重跑。

按 [独立执行账号准备](runner-account-20260831.md) 上传并执行一个 .sh 文件。只创建 cpp-runner、独立家目录、无冲突的 subordinate ID 映射及专属资源单元配置，保留原账号和 apphttp 映射。检查配置已加载，但不启动用户服务、linger 或容器，不启用 C++ 运行。这个阶段的实际 UID/GID、文件权限及 systemd 结果待用户回报；后续再初始化 rootless Podman、准备镜像并验证编译。

## 第 10 步 E：初始化 rootless Podman（修复与初始化均已完成）

用户回报 CPU 委派修复与初始化检查于 2026-08-31 09:32:09Z 完成。rootless、systemd、cgroup v2、seccomp 支持和实际 UID/GID 映射通过，账号总限额保持；两个网站、原配置和 PM2 进程前后核验不变。当前镜像0、容器0，未启用编译运行。修复记录 backups/rootless-delegation-d6YPe9，初始化记录 backups/rootless-resume-0gFyZA。不要重跑准备、初始化或修复脚本。

## 第 10 步 F：GCC 基础镜像（离线导入完成）

Windows 下载及服务器离线导入均已通过，官方基础镜像现已在 cpp-runner 镜像库内。教学镜像构建、CPU 修正、全部 18 项验证和内部执行服务启动已完成，下一步只按 [开放网页运行](web-running-enable-20260831.md) 上传新脚本。下方为此前服务器下载失败的历史记录，不再运行这些旧命令。

2026-08-31 09:52:35Z 用户回报 ETIMEDOUT，未进入镜像层下载。当前只按 [镜像仓库超时诊断](gcc-registry-diagnostic-20260831.md) 执行新诊断脚本。以下为原下载步骤记录，暂不重跑。

按 [GCC 基础镜像下载说明](gcc-base-image-20260831.md) 上传单个 prepare-gcc-base-image-20260831.sh。只在独立账号原有资源限额内下载并核验官方 GCC 14.4.0 / amd64 的固定摘要，压缩层约515MiB；不构建镜像、不运行容器、不安装宿主机 GCC，不重启网站或用户管理器，编译运行仍关闭。

## 第 10 步 G：内部执行服务（已完成，不重跑）

用户于 2026-08-31 13:16:52Z～13:17:05Z 回报 [内部执行服务](runner-service-start-20260831.md) 全部检查成功。cpp-runner 用户服务仅监听 127.0.0.1:5280，内部密钥认证、真实 C++17 输入输出、CPU 超时、137 对照及服务重启后记录恢复通过，无残留容器；已设置该用户服务开机启动，未重启服务器。私有记录 runner-service-start-zMMEp9，日志 runner-service-start-bb4ac3f67cec.log。网站配置、PM2、两站及用户管理器未变，网页运行仍关闭，不重跑此脚本。

## 第 10 步 H：网站接入及开放运行（已完成，网页首跑通过）

用户于 13:46:03Z～13:46:09Z 完成 [开放网页运行](web-running-enable-20260831.md)。网站连接、调度锁和公开入口核验通过，只重启 teaching-cpp-backend；私有备份 web-running-enable-hTFDVJ，日志 web-running-enable-bcf281dccc38.log。随后用户截图确认“两数之和”输入 17 30、输出 a + b = 47，首次网页保存、提交及结果回显通过。不要重跑启用脚本，现在按 [课堂功能检查](classroom-acceptance-20260831.md) 进行浏览器验收，暂不需要服务器命令。

## 后续按这个顺序推进

下面是完整操作顺序，不是让你现在连续执行的命令清单。第 1～9 步已完成，C++ 新建、保存、重新打开与 p5.js 原站保存、运行已由用户确认通过；公共身份、班级和学生展示也已通过。用户已将同源问题交由原 p5.js 项目处理。本项目执行服务与网页运行已启用，基础部署及首次真实运行通过；下一步验收刷新与历史、模板分发、学生视角和教师只读查看，不从一次运行通过推定全部完成。

1. **备份**：建立新项目目录中的私有 backups 目录；备份 teaching_p5js 数据库、原站代码/源码、实际 Apache 配置和 PM2 启动配置。检查备份命令退出状态、文件大小和内容，再下载到本机。不能只凭“生成了一个 .sql 文件”就认定备份有效。
2. **准备上传**：本机构建前端。上传应用根目录的必要文件到 teaching-cpp-backend，保持 backend/shared/runner/scripts 等相对结构；将 frontend/dist 的**内容**上传到 `/var/www/html/teaching-cpp`。不能只把本机 backend 子目录上传，因为它引用相邻的 shared，并依赖根目录清单。Linux 上重新安装依赖，不上传 Windows node_modules、本机 .env、演示 storage 或 .npm-cache。
3. **兼容与迁移**：审查原 p5.js 的类别过滤补丁，核对备份；在维护窗口给共享表新增类别字段和 C++ 专用表，然后部署对应过滤补丁。新字段默认 p5js，保留原作品。不能跳过原平台改造就开放 C++ 保存，否则 C++ 项目会进入原 p5.js 工作台和文件操作链路。
4. **启动 C++ 网站后端**：继续使用 PM2，但只启动一个 fork 实例，不开启 cluster 或 watch。根据核对结果为新服务安排普通用户、Node 路径和运行目录，不重启或删除其他 PM2 应用。先使用生产身份验证，保持写入和执行关闭。
5. **接入 Apache**：确认现有 tigao123.com 的 HTTPS VirtualHost 与 DocumentRoot，再加入 C++ 静态目录和 `/api/cpp/` 代理。先检查配置语法，再平滑加载；原 `/api/`、证书、p5.js 路径保持不变。
6. **验证账号与编辑功能**：验证原账号登录、班级范围、p5js/cpp 类别隔离，再开放 C++ 保存、教师查看和模板分发。不会增加“教师批准入班”的逻辑。现有注册、班级码和公共余额继续共用。
7. **启用真实 C++ 运行**：准备独立 cpp-runner 用户、rootless Podman、固定编译镜像和限额；执行单任务隔离检查，确认后启用 5280 内部服务与网站运行开关。运行服务与网站 PM2 进程分开，以适合 rootless Podman 的用户服务管理，不能用 root 直接执行学生代码。

性能压测留到后面。基本隔离、停止任务和正常编译检查属于启用执行功能的必要核验，不等于要求现在完成课堂负载测试。

## 此次使用的配置材料

- `deploy/apache-cpp.conf.example`：Apache 合并片段，待检查现有配置后确定插入位置。
- `deploy/production.env.example`：网站生产配置示例，端口 5180，公共身份端口 5080，数据库 teaching_p5js。
- `deploy/production-runner.env.example`：内部执行服务示例，端口 5280，运行目录集中到 `/var/www/teaching-cpp-runner`。
- `docs/p5js-compatibility.md`：记录已发布的三个模型及尚待完成的浏览器、登录衔接和同源内容检查。

原项目根目录 `.env.example` 是通用本机示例，不是此次服务器配置；仅修改部署文档不会改变程序端口，真正生效的是服务器 `.env`。不要使用旧 Nginx 示例。

数据库仍是同一个 teaching_p5js。本次可按第 5 步 B 沿用现有 dbadmin，独立低权限账号保留为安全建议，不作为继续部署的强制前提。数据库密码始终只在服务器填写，执行服务配置中没有数据库密码。

Apache 的 ProxyPass 按规则匹配顺序处理，同一配置层中的 `/api/cpp/` 应放在较宽的 `/api/` 或 `/` 代理之前；如果原站使用 Location/Rewrite 方式，需看过实际配置再合并，不能只在文件末尾随意追加。[Apache 官方说明](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypass)

PM2 支持用配置文件固定工作目录、fork 模式及单实例；启动用户和开机恢复设置取决于当前安装位置，不能直接覆盖原 PM2 的服务。[PM2 配置说明](https://pm2.keymetrics.io/docs/usage/application-declaration/)、[PM2 开机恢复说明](https://pm2.keymetrics.io/docs/usage/startup/)

## 2026-08-31 网页入口排查补充

用户访问 `/teaching-cpp/` 时截图显示主站页面外壳，没有显示 C++ 编辑平台。本次上传的 `tigao123-le-ssl.conf` 中仍无 `/api/cpp/` 代理或 C++ 配置 Include。此前回报的第 7 步成功只确认了本机后端启动，不能据此认定第 8 步网页接入已经完成；尚未收到第 8 步的执行日志。

核查发现 `deploy/web-publish-20260830-01/publish.mjs` 发布前只接受 `/teaching-cpp/` 返回 403 或 404。如果主站对未知路径返回 HTTP 200 的主站页面，该检查会提前停止，提示“C++ 公网入口已存在”，但这并不说明 C++ 已发布。截图本身不能证明 HTTP 状态码或具体的回退规则，需要结合服务器的发布日志、前端目录、当前 Apache 配置和 `/var/www/html/.htaccess` 判断。

在这些信息核对前，不重跑旧网页发布包、不手工覆盖整个 HTTPS 配置，不重新迁移数据库或启动后端。既有版本材料和校验值保持不变。本次只补充本地部署记录，没有修改服务器或用户上传的 Apache 文件。

后续已收到上述只读检查结果，确认了 HTTP 200 主站回退和旧版提前停止。修正材料已准备在 `deploy/web-publish-20260831-01`，详见第 8 步当前说明；不再执行上一版网页发布命令。新增三项入口判断检查通过，本地完整检查 80 项通过、1 项可选 MySQL 跳过；尚未验证服务器上的新 Apache 配置或浏览器登录。

### 修正版服务器执行结果：已撤回，尚未上线

用户回报 `web-publish-20260831-01` 于 2026-08-31 北京时间 09:12:17 开始执行。主站回退识别通过，备份完成，`pm2 save` 已保存现有两项进程；随后前端复制、Include 插入、Apache 语法检查和平滑加载均已执行。在 HTTPS 核验阶段触发 `ERR_ASSERTION`，脚本恢复原 Apache 配置并撤回新前端，原 p5.js 和主站检查通过。C++ 网页尚未上线，不能重复运行本次包。

本次日志：`/var/www/teaching-cpp-backend/logs/web-publish-20260831-XJB7uOgT.log`。备份及撤回的前端：`/var/www/teaching-cpp-backend/backups/web-publish-3VOUaT`，保留不删除。PM2 保存列表没有随网页撤回而还原；两个原有后端仍属于只读部署阶段，没有开启 C++ 写入或执行。

现有脚本没有记录自动生成的断言说明或具体位置，因此这份日志不足以确定失败的是公开配置、响应头、深路径内容还是其他后置检查。下一步只摘取 Apache 中本机 C++ 检查请求的访问日志，定位最后请求后再修正；不凭错误码继续猜测修改配置。已发出的版本和校验值保持不变。

后续只读访问日志只有 08:57:57 和 09:12:19 的发布前 `/teaching-cpp/` 请求，均为 HTTP 200、42703 字节，没有重载后的 C++ API 请求。结合执行顺序，最可能是首次 API 请求前立即比较 is-active 输出的断言失败。systemd 将 reloading 也视为运行中的成功状态，旧脚本却只接受字符串 active；当时实际输出没有被保存，因此此处记录为推断。

当前第二次修正版 `web-publish-20260831-02` 只修正部署生命周期检查和诊断，不改变上一版的 Apache 片段或前端。它在发布前、重载后和恢复重载后限时等待服务稳定就绪，记录状态变化、HTTPS 响应摘要及具体失败源码位置；检查不通过仍撤回。新版尚未在服务器执行，当前网页仍未上线。

### 第二次修正版实际结果：只读网页发布成功

用户回报 `web-publish-20260831-02` 于 2026-08-31 北京时间 09:33:01～09:33:06 执行成功。日志确实出现 `reloading / reload-notify`，随后转为 `active / running`，等待后全部检查通过。日志：`/var/www/teaching-cpp-backend/logs/web-publish-20260831-02-M3AEskyQ.log`。本次备份：`/var/www/teaching-cpp-backend/backups/web-publish-G8lHpu`。

实际结果包括：C++ config 返回 200 且写入/执行关闭；未登录 me 返回 401；首页及三个资源逐字 SHA256、类型和安全响应头正确；深路径返回同一份 C++ 首页；缺失脚本 404，隐藏文件和配置/服务端脚本探测 403。主站首页和原路径回退、p5.js 首页及公共接口均保持正常，主站 .htaccess 原字节未变。p5.js PID 3341075、重启计数 67，C++ PID 3342469、重启计数 0，均未重启。

用户随后确认浏览器能打开页面，截图显示真实 C++ 工作台和既有教师账号身份。此项确认了现有会话识别，不等于退出后重新登录、其他角色/班级权限或完整原站业务回归已经验证。页面黄色“生产写入已关闭”提示来自当前开关；正式库迁移和三个类别隔离模型已完成，无需重做。

服务器 `/etc/httpd/conf.d/tigao123-le-ssl.conf` 现在引用 `deploy/web-publish-20260831-02/site.conf`，不要删除该目录，也不要用电脑上发布前的旧 HTTPS 配置覆盖服务器。已交付压缩包及包内说明保持原哈希，包内的“尚未执行”是交付时记录，当前状态以本节服务器结果为准。备份仍需下载到私有位置，不能公开分享含 PM2 环境信息的备份文件。

### 浏览器回归与作品响应头核查（已完成）

2026-08-31 用户确认：原 p5.js 作品可以保存和预览，C++“我的课堂”的班级、学生列表也正常。正式类别迁移、三个模型发布和这两项手工回归无需重做。C++ 编辑与执行开关仍关闭。

本地只读审查发现 p5.js 作品 URL 与平台同源，iframe 使用 `allow-scripts allow-same-origin`，独立大视窗直接打开作品。登录信息同样存在该来源的 localStorage 中，因此先核查线上是否通过作品响应头另作隔离；本地源代码不等于线上完整安全配置，暂不判断已有账号泄露。详见 `p5js-compatibility.md` 的同源学生作品风险。

在 PuTTY 执行以下只读命令。它选取一个现有作品的 index.html，通过本机 HTTPS 请求检查响应头；不在浏览器执行作品、不连接数据库、不读取 .env 或登录信息、不改配置、不重启服务，也不输出作品源码或完整 URL。这里只核对一个样本，不是全站安全认证；`Content-Security-Policy: [not returned]` 表示该响应没有返回此头，最终判断须结合状态码和其他响应头。

```bash
(
  set -euo pipefail
  test "$(id -u)" -eq 0
  cpp_projects=/var/www/teaching-p5js-backend/storage/projects
  test -d "$cpp_projects"
  test ! -L "$cpp_projects"
  cpp_index=$(find -P "$cpp_projects" -mindepth 2 -maxdepth 2 -type f -name index.html -print -quit)
  if [ -z "$cpp_index" ]; then
    printf '没有找到可检查的作品 index.html，请发回此提示。\n'
    exit 1
  fi
  cpp_id=$(basename "$(dirname "$cpp_index")")
  if [[ ! "$cpp_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    printf '作品目录格式不符合预期，未发起请求。\n'
    exit 1
  fi
  printf '检查一个已有作品的 HTTPS 响应头（不显示作品内容）：\n'
  curl --silent --show-error --noproxy '*' --proto '=https' \
    --resolve tigao123.com:443:127.0.0.1 \
    --connect-timeout 5 --max-time 15 \
    --dump-header - --output /dev/null \
    "https://tigao123.com/teaching-p5js/projects/$cpp_id/index.html" |
  awk '
    { sub(/\r$/, ""); lower = tolower($0) }
    /^HTTP\// { print; next }
    lower ~ /^(content-type|content-security-policy|content-security-policy-report-only|x-frame-options|x-content-type-options|cross-origin-opener-policy|cross-origin-resource-policy|access-control-allow-origin):/ { print }
    lower ~ /^content-security-policy:/ { csp = 1 }
    END { if (!csp) print "Content-Security-Policy: [not returned]" }
  '
  printf '检查结束；未修改文件、数据库、配置或服务状态。\n'
)
```

用户已执行上述命令，回报 HTTP/1.1 200 OK、Content-Type: text/html; charset=UTF-8、Content-Security-Policy: [not returned]。该样本没有服务器 CSP，核查已完成，不重复执行。后续本地四组浏览器比较发现：严格沙箱影响素材加载及作品存储；独立预览来源保留已测试功能，并阻止读取平台页面。建议仍在同一台服务器使用 preview.tigao123.com 承载无登录信息的作品预览，两个平台入口不变。实施范围、验证限制及现在需要新增的一条 DNS 记录见 [作品预览隔离说明](preview-isolation.md)。尚未修改服务器、签发证书或发布预览补丁；C++ 写入与运行继续关闭。
