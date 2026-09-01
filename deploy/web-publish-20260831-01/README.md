# 第 8 步修正版：识别主站回退后发布 C++ 网页

本材料尚未在服务器执行。2026-08-31 用户回报：C++ 前端目录不存在，HTTPS 配置没有 C++ 引用；旧版在任何发布改动前停止，提示“C++ 公网入口已存在，不自动替换”。原因是主站 `.htaccess` 把不存在且不含点的路径交给主站 `/index.html`，HTTP 状态仍为 200。不是 C++ 后端启动失败。

旧包和 `deploy/web-publish-20260830-01` 原样保留，不覆盖、不重复运行。此次新目录为 `deploy/web-publish-20260831-01`。

## 修正内容

1. 不再把所有 HTTP 200 都当作已有 C++ 入口。仍要求 C++ 前端目录不存在、Apache 原配置与维护备份一致、两个后端在线且 C++ 写入与运行关闭；额外核验主站 HTTPS 首页与服务器实际首页文件逐字相同。只有 C++ 地址返回这份完全相同的 HTML 时，才识别为主站回退并允许继续；其他页面、重定向或错误仍拒绝。
2. 在新的 C++ Directory 配置中设置 `RewriteEngine Off`，仅停止 C++ 目录继承的主站重写，使用 `FallbackResource /teaching-cpp/index.html` 处理其深路径。构建资源不存在时返回 404，隐藏文件、配置及服务端脚本类文件由 C++ 目录规则拒绝。
3. 不修改 `/var/www/html/.htaccess`。将它备份，并在发布前后检查原字节未变；不重写其中显示乱码的注释，也不推断或转换原编码。主站首页和无扩展名路径仍按原规则处理。

`RewriteEngine Off` 可以在目录范围关闭重写，见 [Apache RewriteEngine](https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html#rewriteengine)；目录配置合并和关闭重写时跳过 FollowSymLinks 检查的行为也核对了 [Apache 源码](https://github.com/apache/httpd/blob/2.4.x/modules/mappers/mod_rewrite.c)。页面回退见 [FallbackResource](https://httpd.apache.org/docs/2.4/mod/mod_dir.html#fallbackresource)。仅阅读文档与源码不能替代本机 Apache 实测，脚本仍会在服务器完成语法和真实 HTTPS 检查。

## 实际会改动的位置

- `/var/www/html/teaching-cpp`：新建并复制服务器现有 `frontend/dist` 中已核验的四个文件。不重建前端，不复制源码、依赖或密钥。
- `/etc/httpd/conf.d/tigao123-le-ssl.conf`：只在主站 443 VirtualHost 的原 `/api` 代理之前插入新注释及 `Include "/var/www/teaching-cpp-backend/deploy/web-publish-20260831-01/site.conf"`，其他原文和注释逐字保留。引用片段含 `/api/cpp/` 到本机 5180 的代理及 C++ 静态目录规则。
- `/var/www/teaching-cpp-backend/backups/web-publish-*`：新建私有备份和执行记录，备份 Apache 配置、主站 `.htaccess` 和 PM2 保存信息。
- 原有 `/root/.pm2`：执行 `pm2 save` 保存两个现有进程，不重启进程；仅列出现有开机服务，不创建或修改 systemd 服务，也不声称已经验证重启恢复。

不会修改主站 `.htaccess`、HTTP 的 `tigao123.conf`、p5.js 应用或前端、数据库、`.env`、证书、其他端口服务。不会启动 C++ 执行服务、开放写入或运行、对外代理 5280。新配置目录被 Apache 引用后不要删除。

## 操作和结果

仅将新的 `teaching-cpp-web-publish-20260831-01.tar.gz` 及配套 `.sha256` 以二进制模式上传到 `/var/www/teaching-cpp-backend`。按对话命令检查固定 SHA256、解压到全新目录、检查 `WEB-FILES.sha256`，再后台运行 `publish.mjs --publish-readonly`。`--check-only` 只校验材料，不连接数据库、不读取 `.env`、不操作服务器。

本次不需要手工编辑 Apache 文件或重启 PM2。服务器先备份，再复制前端、修改 Apache、检查配置并平滑加载；随后检查每个公开文件的内容和类型、C++ API、深路径、缺失脚本和敏感文件拒绝情况。主站首页、原回退规则和 p5.js 入口均作前后核验；两个后端不能发生重启。

成功标志：`C++ 网页接入完成：HTTPS 页面、资源和 API 检查通过；写入关闭，执行关闭`。随后访问 `https://tigao123.com/teaching-cpp/`，检查平台页面和公共账号登录。显示“生产写入已关闭”以及保存、运行按钮不可用是当前阶段的预期状态。

若命令仍在后台运行，只查看已打印的日志，不重复发布。若检查失败，保留完整日志和备份；脚本在版本仍符合本次预期时恢复原 Apache 配置并平滑加载，将本次前端移回私有备份中，不删除文件或还原数据库。无法确认恢复时会明确提示人工处理。已保存的 PM2 列表保留，因为两个只读阶段的后端原本就已运行。

本次仅准备和验证部署材料；服务器发布、真实浏览器登录以及原站完整业务回归尚待用户执行并回报。写入、编译执行和同源学生作品隔离仍未完成。

## 本地验证结果

2026-08-31，Windows、Node 24.14.1：自动检查共 81 项，80 项通过，1 项可选 MySQL 检查跳过。新增检查覆盖已核验主站回退放行，以及其他页面、错误状态、非 HTML 和缺少主站基准时的拒绝；服务器此前通过的 16 项真实 MySQL 验证不受此次本地跳过项影响。

新脚本语法、无连接材料检查、错误参数和非 Linux 执行拒绝通过。用用户上传的实际 HTTPS 配置验证了只新增 Include 段且所有原字节保留；复制代码及配置的全部既有注释保留。旧网页包、后端启动包、正式迁移发布包及其所列文件均校验未变。前端仍使用原四个文件，没有重新构建。本机没有可用的 Linux/Apache 环境，本次未实际运行 Apache 或操作服务器。
