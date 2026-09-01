#!/usr/bin/env bash
# 仅用于当前服务器的 C++ 首次准备，不迁移数据库、不启动服务、不发布前端。
# 原 p5.js、系统 Node、原 PM2、Apache、备份与工具目录的权限保持不变。
set -euo pipefail
umask 022

cpp_fail() {
  printf '准备停止：%s\n' "$1" >&2
  exit 1
}

test "$(id -u)" -eq 0 || cpp_fail '请在现有 root 的 PuTTY 会话中执行。'
test "$(uname -s)" = Linux || cpp_fail '此脚本只能在 Linux 服务器执行。'
cpp_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
test "$cpp_root" = /var/www/teaching-cpp-backend || cpp_fail '项目必须位于 /var/www/teaching-cpp-backend。'
cpp_node="$cpp_root/tools/node/bin/node"
cpp_npm="$cpp_root/tools/node/lib/node_modules/npm/bin/npm-cli.js"
test -x "$cpp_node" && test -r "$cpp_npm" || cpp_fail '未找到前一步安装的专用 Node/npm。'
test "$("$cpp_node" -v)" = v24.20.0 || cpp_fail '专用 Node 版本与本次已确认的安装版本不同。'
for cpp_command in getent useradd runuser install stat; do
  command -v "$cpp_command" >/dev/null || cpp_fail "缺少系统命令 $cpp_command。"
done
test -x /sbin/nologin || cpp_fail '未找到 /sbin/nologin。'
cd "$cpp_root"
for cpp_file in package.json package-lock.json backend/src/server.mjs runner/src/server.mjs frontend/dist/index.html deploy/production.env.example; do
  test -f "$cpp_file" && test ! -L "$cpp_file" || cpp_fail "上传包文件缺失或不应为链接：$cpp_file。"
done
for cpp_dir in "$cpp_root" "$cpp_root/tools" "$cpp_root/tools/downloads"; do
  test "$(stat -c '%u:%a' "$cpp_dir")" = 0:755 || cpp_fail "目录应由 root 管理且权限为 755：$cpp_dir。"
done
test "$(stat -c '%u:%a' "$cpp_root/backups")" = 0:700 || cpp_fail '备份目录应保持 root 所有、权限 700。'
for cpp_dir in runtime storage logs node_modules backend/node_modules runner/node_modules frontend/node_modules; do
  test ! -L "$cpp_root/$cpp_dir" || cpp_fail "拒绝修改符号链接目录：$cpp_dir。"
done
test ! -L .env || cpp_fail '.env 不能是符号链接。'

# 网站账号不能登录 SSH，也不用于执行学生程序；执行服务账号在后续单独建立。
if getent passwd cpp-web >/dev/null; then
  IFS=: read -r cpp_account cpp_passwd_field cpp_uid cpp_gid cpp_gecos cpp_home cpp_shell < <(getent passwd cpp-web)
  test "$cpp_uid" -ne 0 && test "$cpp_home" = "$cpp_root/runtime" && test "$cpp_shell" = /sbin/nologin || cpp_fail '现有 cpp-web 账号用途不同，不自动改动。'
  test "$(id -gn cpp-web)" = cpp-web && test "$(id -Gn cpp-web)" = cpp-web || cpp_fail '现有 cpp-web 的用户组与本项目要求不同。'
else
  if getent group cpp-web >/dev/null; then cpp_fail '已有同名 cpp-web 用户组，请先核对。'; fi
  useradd --system --user-group --no-create-home \
    --home-dir "$cpp_root/runtime" --shell /sbin/nologin \
    cpp-web
fi
for cpp_dir in runtime storage logs; do
  if [ -e "$cpp_root/$cpp_dir" ]; then
    test -d "$cpp_root/$cpp_dir" && test "$(stat -c '%U:%G' "$cpp_root/$cpp_dir")" = cpp-web:cpp-web || cpp_fail "可写目录已有其他所有者，不自动接管：$cpp_dir。"
  fi
done
install -d -o cpp-web -g cpp-web -m 0700 "$cpp_root/runtime" "$cpp_root/storage"
install -d -o cpp-web -g cpp-web -m 0750 "$cpp_root/logs"

# 只安装两个后端工作区的运行依赖，禁用依赖安装脚本；不安装或更新全局 npm/PM2。
# PATH 只用于这一条安装命令及其子进程，不修改当前会话或系统环境。
install -d -m 0700 "$cpp_root/tools/downloads/npm-cache"
env PATH="$cpp_root/tools/node/bin:$PATH" "$cpp_node" "$cpp_npm" ci \
  --workspace=@teaching-cpp/backend --workspace=@teaching-cpp/runner \
  --include-workspace-root=false --omit=dev --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org --strict-ssl=true \
  --cache="$cpp_root/tools/downloads/npm-cache"

# 只在不存在时创建初始配置；保留已有配置文本，绝不把数据库密码输出到终端。
if [ ! -e .env ]; then
  install -o root -g cpp-web -m 0640 deploy/production.env.example .env
fi
test -f .env || cpp_fail '.env 不是普通文件。'
chown root:cpp-web .env
chmod 0640 .env
runuser -u cpp-web -- "$cpp_node" --input-type=module -e '
  import fs from "node:fs";
  import dotenv from "dotenv";
  await import("express"); await import("mysql2/promise"); await import("helmet");
  const env = dotenv.parse(fs.readFileSync(".env"));
  const { readConfig } = await import("./backend/src/config.mjs");
  const config = readConfig(env);
  if (config.mode !== "production" || config.writesEnabled || config.runEnabled || config.port !== 5180 || config.commonApi !== "http://127.0.0.1:5080/api" || config.runnerUrl !== "http://127.0.0.1:5280" || config.db.database !== "teaching_p5js" || config.db.user !== "cpp_app") {
    throw new Error("初始生产配置与本阶段要求不同；不自动修改，也不启动服务。");
  }
  console.log("网站账号可加载运行依赖与配置；写入关闭，执行关闭，未连接数据库。");
'
if runuser -u cpp-web -- test -w "$cpp_root"; then cpp_fail '网站账号不应能改写项目根目录。'; fi
if runuser -u cpp-web -- test -w "$cpp_node"; then cpp_fail '网站账号不应能改写 Node 程序。'; fi
if runuser -u cpp-web -- test -x "$cpp_root/backups"; then cpp_fail '网站账号不应能进入备份目录。'; fi
for cpp_dir in runtime storage logs; do
  runuser -u cpp-web -- test -w "$cpp_root/$cpp_dir" || cpp_fail "网站账号无法写入 $cpp_dir。"
done
id cpp-web
stat -c '%U:%G %a %n' runtime storage logs .env backups tools
printf 'C++ 上传与初始准备完成。未迁移数据库、未启动服务、未修改 Apache、未发布前端。\n'
