# 第 8 步：Apache 接入和只读前端发布

材料已准备，尚未执行。前一步后端启动已由用户回报成功：2026-08-30 北京时间 21:57:20，C++ 使用 cpp-web（995:992）监听本机 5180，PID 3342469、重启计数 0；p5.js PID 3341075、重启计数 67 保持不变。日志为 `/var/www/teaching-cpp-backend/logs/backend-start-dc9xcNnJ.log`。当时尚未执行 pm2 save。

## 这一步会做什么

1. 核验两项 PM2 进程仍在线、C++ 写入和执行关闭、原站 HTTPS 正常、Apache 配置与上次维护备份一致、前端目录尚未存在。不会连接数据库或读取作品内容，只读取原站公开首页和未登录的状态接口。
2. 在 `/var/www/teaching-cpp-backend/backups/web-publish-*` 备份当前两个 Apache 域名配置、PM2 进程信息和已有保存文件。随后执行 pm2 save，保存现有两个已验证的进程，不重启它们。列出现有 `pm2*.service` 的启用状态，但不创建或修改 systemd 服务；保存列表不等于已经验证开机自动恢复。
3. 将服务器已有 `frontend/dist` 中经过校验的四个文件复制到新的 `/var/www/html/teaching-cpp`。不重新构建，不上传 node_modules，不复制源码、.env、日志或备份。
4. 在 `/etc/httpd/conf.d/tigao123-le-ssl.conf` 的主站 443 VirtualHost 内、原 `ProxyPass /api ...5080/api` 之前，仅插入一段注释和一条 Include。引用本目录 site.conf。原文不删除、不修改，HTTP 的 tigao123.conf 保持不变。
5. 新片段把 `/api/cpp/` 代理到本机 5180，并为 C++ 静态目录配置页面回退、正确的脚本类型与安全响应头。原 p5.js、三个 tools 服务、证书路径和 www 跳转配置不变，不给 5280 配置公网代理或开放新端口。
6. Apache 语法检查通过后平滑加载，再逐个核验页面、静态文件内容和类型、C++ API、缺失脚本返回 404，以及原站 HTTPS 首页和公共 API。确认两个后端进程没有重启。

代理顺序依据 [Apache ProxyPass 说明](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypass)，页面回退依据 [FallbackResource 说明](https://httpd.apache.org/docs/2.4/mod/mod_dir.html#fallbackresource)，平滑加载依据 [Apache graceful 说明](https://httpd.apache.org/docs/2.4/stopping.html#graceful)。C++ 页面安全头只适用于新前端，不代表原 p5.js 学生作品的同源风险已解决。

## 如何执行

不要同时修改 Apache、.env、前端文件或 PM2 进程。用 WinSCP 把 releases 下的 `teaching-cpp-web-publish-20260830-01.tar.gz` 及其 `.sha256` 上传到 `/var/www/teaching-cpp-backend`，使用二进制传输。旧包不重传、旧脚本不重跑。按对话给出的固定 SHA256 校验并解压到全新的 `deploy/web-publish-20260830-01` 目录，再从项目根目录校验 `WEB-FILES.sha256`。

```bash
/var/www/teaching-cpp-backend/tools/node/bin/node deploy/web-publish-20260830-01/publish.mjs --check-only
/var/www/teaching-cpp-backend/tools/node/bin/node deploy/web-publish-20260830-01/publish.mjs --publish-readonly
```

第一条只检查本地材料。第二条才执行备份、保存 PM2 列表、发布前端、修改并平滑加载 Apache；应按对话命令在后台运行并保存日志，避免 PuTTY 断线直接中断。

HTTPS 检查通过 `curl --resolve` 使用正式域名和证书连接本机 Apache，不经过外部 DNS 或 CDN，也不跳过证书校验。这能验证本机站点配置，但外网可访问性和浏览器登录仍由用户随后检查。

成功标志是“C++ 网页接入完成：HTTPS 页面、资源和 API 检查通过；写入关闭，执行关闭”。把完整发布日志和最后的 PM2 列表发回；随后访问 `https://tigao123.com/teaching-cpp/`。若没有登录，点击公共账号登录，在原平台登录后返回 C++ 标签页，必要时点击“我已登录，重新验证”。不要把登录令牌、密码或 .env 发到对话。

当前应显示“生产写入已关闭”；不能新建、保存、分发或运行，是当前阶段的预期状态。此时核验页面显示和真实账号识别，不把按钮禁用误认为部署失败。原 p5.js 的浏览器登录、列表、测试作品保存/预览，以及上次备份下载仍需用户补充结果。

## 失败和恢复

在修改 Apache 前发生错误则停止，不对原配置做修复猜测。修改后如果语法或 HTTPS 核验失败，脚本仅在文件仍符合本次预期版本时恢复原 Apache 配置并平滑加载，将本次新前端移到私有备份目录的 withdrawn-frontend，保留现场，不删除文件或还原数据库。如果恢复条件不满足，明确提示人工处理，不能保证自动恢复；请立即发回日志，不要重新执行发布或重启其他服务。

已经保存的 PM2 进程列表不随网页撤回而还原；两个后端继续运行，C++ 仍只监听本机且业务只读。备份含 PM2 环境信息，应下载到电脑私有位置，不对外分享。不要删除被 Apache 引用的 site.conf 所在目录。

## 验证范围

本机已验证三个 Apache 原文插入测试，包括保持注释/空白、CRLF、重复与歧义拒绝；JavaScript 语法、无连接材料检查、错误参数和非 Linux 执行拒绝；四个前端文件与首次服务器上传包逐字一致。本机没有 Apache，真实配置检查和平滑加载以服务器结果为准。浏览器登录、原站完整业务回归、同源学生作品隔离、真实编译运行和后续课堂负载测试尚未完成，不开放 C++ 写入和执行。
