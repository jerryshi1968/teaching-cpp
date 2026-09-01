# 本轮操作：启用 C++ 编辑，暂不开编译运行

> 本页已停用，仅保留历史。用户执行后在数据库预检遇到 ER_UNSUPPORTED_PS，配置与服务未改变。现在使用 [02 修正版操作](write-enable-20260831-02.md)，不要再执行本页命令。

服务器上还没有执行本步骤。上传下面两个本地文件到 `/var/www/teaching-cpp-backend`，使用 WinSCP 二进制传输，不上传整个项目：

- `G:\teaching-cpp\releases\teaching-cpp-write-enable-20260831-01.tar.gz`
- `G:\teaching-cpp\releases\teaching-cpp-write-enable-20260831-01.tar.gz.sha256`

随后在 root 的 PuTTY 会话中整段执行。期间不要同时发布 p5.js 或编辑服务器配置。本步骤只改 C++ 写入开关、备份配置并重启 C++ 后端；保留 Apache、原站、数据库结构和运行开关。写入对所有已登录用户按原权限生效。

```bash
(
  set -euo pipefail
  umask 022
  test "$(id -u)" -eq 0
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  command -v tar sha256sum flock nohup >/dev/null

  cpp_archive=teaching-cpp-write-enable-20260831-01.tar.gz
  cpp_sha=da0e7352023967fc94bacdc6b3d92b0b6cb3e70301c662d609b628e17b24081d
  printf '%s  %s\n' "$cpp_sha" "$cpp_archive" | sha256sum -c -
  sha256sum -c "$cpp_archive.sha256"

  cpp_step=deploy/write-enable-20260831-01
  if [ -e "$cpp_step" ] || [ -L "$cpp_step" ]; then
    printf '本步骤目录已存在，请保留现场，不要重复执行。\n' >&2
    exit 1
  fi
  tar --no-same-owner --no-same-permissions --keep-old-files -xzf "$cpp_archive"
  chmod 0755 "$cpp_step"
  chmod 0644 "$cpp_step/"*.mjs "$cpp_step/README.md" "$cpp_step/WRITE-FILES.sha256"
  sha256sum -c "$cpp_step/WRITE-FILES.sha256"

  cpp_node=/var/www/teaching-cpp-backend/tools/node/bin/node
  "$cpp_node" "$cpp_step/enable.mjs" --check-only

  umask 077
  cpp_lock=/var/www/teaching-cpp-backend/backups/write-enable-20260831-01.lock
  test ! -L "$cpp_lock"
  cpp_log=$(mktemp /var/www/teaching-cpp-backend/logs/write-enable-XXXXXXXX.log)
  nohup flock -n "$cpp_lock" "$cpp_node" "$cpp_step/enable.mjs" --enable-writes >"$cpp_log" 2>&1 < /dev/null &
  cpp_pid=$!
  printf '操作进程：%s\n日志：%s\n' "$cpp_pid" "$cpp_log"

  for cpp_wait in {1..20}; do
    if ! kill -0 "$cpp_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  tail -n 80 "$cpp_log"
  if kill -0 "$cpp_pid" 2>/dev/null; then
    printf '后台仍在检查，只查看上述日志，不要重复执行。\n'
  elif wait "$cpp_pid"; then
    /usr/bin/pm2 list
  else
    printf '本步骤未成功，请发回上述日志，不要重跑。\n' >&2
    exit 1
  fi
)
```

执行后把输出发回。正常结束会提示“C++ 写入已启用”，此时刷新 C++ 页面，用自己的账号新建“部署验收”，修改代码并保存，刷新后重新打开确认保存结果。同时确认 p5.js 列表没有混入这个 C++ 练习，原 p5.js 作品仍可保存、预览。本轮先不点击运行，也不向真实教学班分发模板。

如果提示后台仍在检查，只读取上面打印出的实际日志路径；不要重复执行整段命令。失败会尝试恢复只读，如提示自动恢复未确认，请保留现场并发回日志。私有备份含密码，不要发给聊天或放进公网目录。

完整范围与恢复说明见 [写入启用说明](../deploy/write-enable-20260831-01/README.md)。本地检查为 100 项通过、1 项可选 MySQL 跳过；服务器上的实际启用和浏览器验收仍待回报。
