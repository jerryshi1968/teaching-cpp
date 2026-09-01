#!/usr/bin/env bash
# 在已确认的 Rocky Linux 服务器安装 Podman 组件，保留 DNF 的交互确认。
# 不创建执行账号、不启动容器、不启用 C++ 编译运行。

(
  set -euo pipefail
  umask 077
  test "$(id -u)" -eq 0
  test "$(uname -m)" = x86_64
  cd /var/www/teaching-cpp-backend
  test "$(pwd -P)" = /var/www/teaching-cpp-backend
  test "$(getenforce)" = Disabled
  command -v dnf rpm curl tee sha256sum pm2 >/dev/null
  cpp_node=/var/www/teaching-cpp-backend/tools/node/bin/node
  test -x "$cpp_node"
  cpp_record=$(mktemp -d /var/www/teaching-cpp-backend/backups/podman-install-XXXXXXXX)
  cpp_log=$(mktemp /var/www/teaching-cpp-backend/logs/podman-install-XXXXXXXX.log)
  printf '安装记录：%s\n安装日志：%s\n' "$cpp_record" "$cpp_log"
  cp -p /etc/selinux/config "$cpp_record/selinux-config.before"
  sha256sum .env /etc/selinux/config /etc/subuid /etc/subgid > "$cpp_record/UNCHANGED.sha256"
  rpm -qa --qf '%{NAME} %{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n' | sort > "$cpp_record/rpm-before.txt"

  cpp_check_sites() {
    curl --fail --silent --show-error --noproxy '*' \
      --resolve tigao123.com:443:127.0.0.1 --connect-timeout 5 --max-time 15 \
      https://tigao123.com/api/health |
      "$cpp_node" -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8")); if(v.status!=="OK"||v.db_check!=="Database Active") process.exit(1); console.log("p5.js HTTPS 健康检查通过");'
    curl --fail --silent --show-error --noproxy '*' \
      --resolve tigao123.com:443:127.0.0.1 --connect-timeout 5 --max-time 15 \
      https://tigao123.com/api/cpp/config |
      "$cpp_node" -e 'const v=JSON.parse(require("fs").readFileSync(0,"utf8")); if(v.mode!=="production"||v.writesEnabled!==true||v.runEnabled!==false) process.exit(1); console.log("C++ HTTPS 检查通过：写入开启，执行关闭");'
  }

  printf '\n安装前检查：\n'
  cpp_check_sites
  pm2 list
  printf '\n清单须为新增 17 项、升级 2 个 SELinux 策略包；符合时输入 y。\n'
  if LC_ALL=C dnf \
    --disablerepo='*' \
    --enablerepo=baseos --enablerepo=appstream --enablerepo=extras \
    --setopt=assumeyes=False --setopt=assumeno=False --setopt=defaultyes=False \
    --setopt=install_weak_deps=False \
    --setopt=baseos.gpgcheck=True --setopt=appstream.gpgcheck=True --setopt=extras.gpgcheck=True \
    --setopt=timeout=20 --setopt=retries=2 \
    install-nevra \
    'conmon-3:2.2.1-2.el9_8.x86_64' \
    'crun-0:1.27-1.el9_7.x86_64' \
    'fuse-overlayfs-0:1.16-1.el9_7.x86_64' \
    'passt-0:0^20251210.gd04c480-6.el9_8.x86_64' \
    'podman-6:5.8.2-6.el9_8.x86_64' \
    'selinux-policy-0:38.1.75-2.el9_8.noarch' \
    'selinux-policy-targeted-0:38.1.75-2.el9_8.noarch' \
    'aardvark-dns-2:1.17.1-1.el9_8.x86_64' \
    'container-selinux-4:2.245.0-1.el9.noarch' \
    'containers-common-5:5.8-1.el9.x86_64' \
    'fuse-common-0:3.10.2-9.el9.x86_64' \
    'fuse3-0:3.10.2-9.el9.x86_64' \
    'fuse3-libs-0:3.10.2-9.el9.x86_64' \
    'libslirp-0:4.4.0-8.el9.x86_64' \
    'netavark-2:1.17.2-1.el9.x86_64' \
    'passt-selinux-0:0^20251210.gd04c480-6.el9_8.noarch' \
    'shadow-utils-subid-2:4.9-16.el9.x86_64' \
    'slirp4netns-0:1.3.3-1.el9.x86_64' \
    'yajl-0:2.1.0-25.el9.x86_64' 2>&1 | tee "$cpp_log"; then
    printf '\nDNF 安装命令成功结束。\n'
  else
    printf '\n安装未成功完成或已取消，请发回日志，不重复执行：%s\n' "$cpp_log" >&2
    exit 1
  fi

  printf '\n安装后检查：\n'
  rpm -qa --qf '%{NAME} %{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n' | sort > "$cpp_record/rpm-after.txt"
  rpm -q podman crun conmon fuse-overlayfs passt slirp4netns selinux-policy selinux-policy-targeted
  sha256sum -c "$cpp_record/UNCHANGED.sha256"
  test "$(getenforce)" = Disabled
  printf 'SELinux 状态保持 Disabled。\n'
  cpp_check_sites
  pm2 list
  printf '\n本步检查完成；未开启 C++ 编译运行。\n安装记录：%s\n安装日志：%s\n' "$cpp_record" "$cpp_log"
)
