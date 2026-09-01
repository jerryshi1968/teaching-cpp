# 第 8 步第二次修正：等待 Apache 就绪并记录检查位置

本版本尚未在服务器执行。使用新目录 `deploy/web-publish-20260831-02`；旧版发布文件、校验值、日志和备份保持不变，不删除或覆盖。

## 已知事实与判断

用户回报：20260831-01 已备份、保存 PM2 列表、复制前端、插入 Apache Include，并通过语法检查；随后出现无详细说明的 `ERR_ASSERTION`，脚本成功恢复原配置并撤回前端。日志为 `/var/www/teaching-cpp-backend/logs/web-publish-20260831-XJB7uOgT.log`，备份为 `/var/www/teaching-cpp-backend/backups/web-publish-3VOUaT`。两项 PM2 进程列表已保存；开机单元列出 `pm2-root.service enabled disabled`，但未验证整机重启恢复。

用户随后提供的本机 C++ 访问日志只有发布前 `/teaching-cpp/` 的两条 HTTP 200、42703 字节记录，没有重载后 `/api/cpp/config` 的请求。在原脚本执行顺序中，首次 API 请求前存在一个没有自定义说明的 `assert.equal(isActiveOutput, 'active')`。因此重载过渡状态被误判是当前最可能的解释，但旧日志未保留当时的状态和断言位置，不能将此推断写成服务器实测结论。

[systemd v252 官方源码](https://github.com/systemd/systemd/blob/v252/src/systemctl/systemctl-is-active.c) 将 active 和 reloading 都视为 is-active 成功状态；[Apache 官方 mod_systemd 源码](https://github.com/apache/httpd/blob/trunk/modules/arch/unix/mod_systemd.c) 包含重载通知和随后就绪通知。因此旧脚本在重载命令结束后立即要求输出严格等于 active，存在过早失败的问题。

## 本版本修改

1. 发布前、正式平滑加载后及失败恢复平滑加载后，读取 LoadState、ActiveState、SubState。允许 reloading 过渡，约 15 秒内等到 loaded / active / running 连续稳定 600 毫秒才继续；失败、停止、状态读取失败、取消或超时仍停止，绝不跳过检查。轮询只读取状态，不反复重载服务。
2. 输出状态变化以及每次 HTTPS 请求的开始、状态码、内容类型、字节数、内容 SHA256 和相关响应头是否存在。检查结果不记录响应正文、Cookie、认证头或密码。
3. 即使是自动生成的断言，也记录本版本源码文件名和行号，以及最后一个请求的安全摘要；将信息存入新的私有备份目录 failure.json。补充公开配置、响应头和深路径内容检查的具体说明。

本版 `site.conf` 与 20260831-01 逐字相同，四个前端文件不变，不再猜测调整路由规则。主站 .htaccess 原文和注释不修改；Apache 原 HTTPS 配置仍只在主站原 /api 代理之前插入一段新注释和指向本版本 site.conf 的 Include，原 /api、三个工具、证书和 www 跳转配置保留。

## 操作

以二进制方式将 `teaching-cpp-web-publish-20260831-02.tar.gz` 和 `.sha256` 上传到 `/var/www/teaching-cpp-backend`，按对话给出的固定哈希校验、解压和后台发布命令执行。不手工修改 Apache，不重复启动后端、不重新迁移数据库，不删除先前撤回的前端。

`publish.mjs --check-only` 只验证本地材料；`--publish-readonly` 才操作服务器。执行步骤仍包括检查原文件和服务、创建私有备份、保存现有两项 PM2 进程、复制原四个前端文件到 `/var/www/html/teaching-cpp`、修改并平滑加载 Apache，随后验证全部公开资源、API、深路径、敏感路径拒绝和原站行为。C++ 写入及运行始终关闭，不重启现有两个后端，也不开放 5280。

原文件备份位于新建的 `/var/www/teaching-cpp-backend/backups/web-publish-*`，日志位置由命令打印。成功标志仍为“C++ 网页接入完成：HTTPS 页面、资源和 API 检查通过；写入关闭，执行关闭”。成功后再打开 `https://tigao123.com/teaching-cpp/` 检查页面和真实公共账号登录；显示生产写入关闭是当前预期状态。

失败时在原文件仍符合本次版本条件的前提下恢复原 Apache 配置，等待恢复就绪，再把本次前端移回私有备份，并检查原站。恢复不能确认时明确提示人工处理；不要重跑、删除文件、还原数据库或重启其他服务。已经保存的 PM2 列表保留。若外层等待结束但后台尚未完成，只读取已打印的日志。

本机为 Windows，没有可用 Apache/Linux 环境；本地模拟状态转换和代码检查不能替代服务器实际验证。浏览器回归、真实登录、C++ 写入和真实编译执行均未完成。

## 本地验证

2026-08-31：完整检查共 89 项，88 项通过、1 项可选 MySQL 跳过。新增八项检查覆盖状态字段解析、重载到稳定就绪、短暂 active 后重载、服务停止或失败、等待超时、取消或状态读取失败、HTTP 诊断敏感信息排除，以及自动生成断言的源码位置提取。等待测试使用受控时钟和模拟状态，未在本机运行 systemd。

新脚本语法、无连接材料检查、错误参数和非 Linux 执行拒绝通过；用户上传的实际 Apache HTTPS 配置只插入新的 Include 段，原字节和注释保持完整。旧两版网页包的清单文件、后端启动包和正式发布包所列文件校验未变；新 site.conf、入口判断和前端清单与上一版逐字一致。包内文件与本机对应文件逐字核对后交付，实际服务器结果仍待执行回报。
