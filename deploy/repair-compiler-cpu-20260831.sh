#!/usr/bin/env bash
# 安装独立 CPU 计量模块并复用现有教学镜像验证；全部验证通过才切换尚未启动的执行服务入口。
# 不修改原 Podman 隔离参数，不重建镜像、不重启网站、不开放网页运行，旧记录和锁保留。
set -euo pipefail
umask 077
test "$#" -eq 0 || { printf '本脚本不接受参数。\n' >&2; exit 1; }
test "$(uname -s)" = Linux && test "$(id -u)" -eq 0 || { printf '请在 Linux 服务器原来的 root 会话执行。\n' >&2; exit 1; }
exec /var/www/teaching-cpp-backend/tools/node/bin/node --input-type=module - --repair-compiler-cpu <<'CPP_CPU_REPAIR_NODE'
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const ROOT = '/var/www/teaching-cpp-backend', HOME_DIR = '/var/www/teaching-cpp-runner';
const NODE = ROOT + '/tools/node/bin/node';
const DIAGNOSTIC = ROOT + '/backups/compiler-cpu-diagnostic-NwAqHX';
const PREVIOUS = ROOT + '/backups/compiler-check-02-PRb5s6';
const LOCK = ROOT + '/backups/compiler-check-03.lock';
export const IMAGE = 'sha256:c8579da6d7ec08b0ca85310d947bcea10450288b6b1f96167029fa42e22556fe';
export const MODULE_SHA = '2b4d6da57db00d3ff5707ec6bfe338ea70058741ef5a4620a571dd1e2b6b3c4b';
export const SERVER_BEFORE = '0cb88b2d6314ce6ad9be3c5e194f2cb438015d45e5b959dd1147a6cff352c43f';
export const SERVER_AFTER = '8c5e49771a2dc667fe65f24f14b455968f9db261d3f487d33c5ed2dd4430eda2';
export const MODULE_BASE64 = 'aW1wb3J0IGZzIGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnOwppbXBvcnQgeyBQb2RtYW5TYW5kYm94LCBjb21tYW5kLCBMSU1JVFMgfSBmcm9tICcuL3BvZG1hbi5tanMnOwoKZnVuY3Rpb24gY2hlY2sob2ssIGNvZGUpIHsgaWYgKCFvaykgdGhyb3cgT2JqZWN0LmFzc2lnbihuZXcgRXJyb3IoY29kZSksIHsgY29kZSB9KTsgfQpjb25zdCBkZWxheSA9ICgpID0+IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCA1MCkpOwoKZXhwb3J0IGZ1bmN0aW9uIGNwdVVzYWdlKHRleHQpIHsKICBjaGVjayh0eXBlb2YgdGV4dCA9PT0gJ3N0cmluZycgJiYgdGV4dC5sZW5ndGggPCAxNjM4NCwgJ0NQVV9TVEFUX0lOVkFMSUQnKTsKICBjb25zdCByb3dzID0gdGV4dC50cmltKCkuc3BsaXQoJ1xuJykuZmlsdGVyKGxpbmUgPT4gL151c2FnZV91c2VjXHMvLnRlc3QobGluZSkpOwogIGNoZWNrKHJvd3MubGVuZ3RoID09PSAxICYmIC9edXNhZ2VfdXNlY1xzK1swLTldKyQvLnRlc3Qocm93c1swXSksICdDUFVfU1RBVF9JTlZBTElEJyk7CiAgY29uc3QgdmFsdWUgPSBOdW1iZXIocm93c1swXS50cmltKCkuc3BsaXQoL1xzKy8pWzFdKTsKICBjaGVjayhOdW1iZXIuaXNTYWZlSW50ZWdlcih2YWx1ZSkgJiYgdmFsdWUgPj0gMCwgJ0NQVV9TVEFUX0lOVkFMSUQnKTsKICByZXR1cm4gdmFsdWU7Cn0KCmV4cG9ydCBmdW5jdGlvbiBjb250YWluZXJTdGF0ZShyb3dzLCBuYW1lKSB7CiAgY2hlY2soQXJyYXkuaXNBcnJheShyb3dzKSAmJiByb3dzLmxlbmd0aCA9PT0gMSwgJ0NQVV9DT05UQUlORVJfSU5WQUxJRCcpOwogIGNvbnN0IHZhbHVlID0gcm93c1swXSwgc3RhdGUgPSB2YWx1ZT8uU3RhdGU7CiAgY2hlY2sodmFsdWU/Lk5hbWU/LnJlcGxhY2UoL15cLy8sICcnKSA9PT0gbmFtZSAmJiAvXlthLWYwLTldezY0fSQvLnRlc3QodmFsdWUuSWQgfHwgJycpICYmIHR5cGVvZiBzdGF0ZT8uUnVubmluZyA9PT0gJ2Jvb2xlYW4nLCAnQ1BVX0NPTlRBSU5FUl9JTlZBTElEJyk7CiAgaWYgKHN0YXRlLlJ1bm5pbmcpIGNoZWNrKE51bWJlci5pc1NhZmVJbnRlZ2VyKHN0YXRlLlBpZCkgJiYgc3RhdGUuUGlkID4gMCwgJ0NQVV9QSURfSU5WQUxJRCcpOwogIHJldHVybiB7IGlkOiB2YWx1ZS5JZCwgcGlkOiBzdGF0ZS5QaWQsIHJ1bm5pbmc6IHN0YXRlLlJ1bm5pbmcsIHN0YXR1czogc3RhdGUuU3RhdHVzLCBvb206IHN0YXRlLk9PTUtpbGxlZCwgZXhpdDogc3RhdGUuRXhpdENvZGUgfTsKfQoKZXhwb3J0IGZ1bmN0aW9uIGNwdVN0YXRQYXRoKHRleHQsIHVpZCwgY29udGFpbmVySWQpIHsKICBjaGVjayhOdW1iZXIuaXNTYWZlSW50ZWdlcih1aWQpICYmIHVpZCA+IDAgJiYgL15bYS1mMC05XXs2NH0kLy50ZXN0KGNvbnRhaW5lcklkKSwgJ0NQVV9TQ09QRV9JTlZBTElEJyk7CiAgY2hlY2sodHlwZW9mIHRleHQgPT09ICdzdHJpbmcnICYmIHRleHQubGVuZ3RoIDwgMTYzODQsICdDUFVfU0NPUEVfSU5WQUxJRCcpOwogIGNvbnN0IHJvd3MgPSB0ZXh0LnRyaW0oKS5zcGxpdCgnXG4nKS5maWx0ZXIobGluZSA9PiBsaW5lLnN0YXJ0c1dpdGgoJzA6OicpKTsKICBjaGVjayhyb3dzLmxlbmd0aCA9PT0gMSwgJ0NQVV9TQ09QRV9JTlZBTElEJyk7CiAgY29uc3QgZ3JvdXAgPSByb3dzWzBdLnNsaWNlKDMpLCBwcmVmaXggPSBgL3VzZXIuc2xpY2UvdXNlci0ke3VpZH0uc2xpY2UvdXNlckAke3VpZH0uc2VydmljZS9gOwogIGNoZWNrKGdyb3VwLnN0YXJ0c1dpdGgocHJlZml4KSAmJiAhZ3JvdXAuaW5jbHVkZXMoJy8vJyksICdDUFVfU0NPUEVfSU5WQUxJRCcpOwogIGNvbnN0IHBhcnRzID0gZ3JvdXAuc3BsaXQoJy8nKS5zbGljZSgxKTsKICBjaGVjayhwYXJ0cy5ldmVyeShwYXJ0ID0+IC9eW2EtekEtWjAtOV8uQC1dKyQvLnRlc3QocGFydCkgJiYgcGFydCAhPT0gJy4nICYmIHBhcnQgIT09ICcuLicpLCAnQ1BVX1NDT1BFX0lOVkFMSUQnKTsKICBjb25zdCBzY29wZSA9ICdsaWJwb2QtJyArIGNvbnRhaW5lcklkICsgJy5zY29wZScsIGluZGV4ID0gcGFydHMuaW5kZXhPZihzY29wZSk7CiAgY2hlY2soaW5kZXggPj0gMyAmJiBwYXJ0cy5sYXN0SW5kZXhPZihzY29wZSkgPT09IGluZGV4LCAnQ1BVX1NDT1BFX0lOVkFMSUQnKTsKICAvLyDor7vlj5blrrnlmajmiYDlsZ4gc2NvcGUg55qE5oC7IENQVSDnlKjml7bvvIzljIXlkKvlrrnlmajlrZDov5vnqIvvvJvkuI3or7vlj5bmlbTkuKrotKblj7fmiJblhbbku5blrrnlmajnmoTorqHmlbDjgIIKICByZXR1cm4gJy9zeXMvZnMvY2dyb3VwLycgKyBwYXJ0cy5zbGljZSgwLCBpbmRleCArIDEpLmpvaW4oJy8nKSArICcvY3B1LnN0YXQnOwp9CgpleHBvcnQgYXN5bmMgZnVuY3Rpb24gY3B1TGltaXRlZENvbW1hbmQoY29uZmlnLCBleGVjdXRhYmxlLCBhcmdzLCBvcHRpb25zLCBleGVjdXRlID0gY29tbWFuZCwgeyByZWFkRmlsZSA9IGZzLnJlYWRGaWxlLCBwYXVzZSA9IGRlbGF5LCBvbkNwdUxpbWl0IH0gPSB7fSkgewogIGlmIChhcmdzWzBdICE9PSAnc3RhcnQnKSByZXR1cm4gZXhlY3V0ZShleGVjdXRhYmxlLCBhcmdzLCBvcHRpb25zKTsKICBjb25zdCBuYW1lID0gYXJnc1szXSwgbWF0Y2ggPSAvXmNwcC1qb2ItW2EtZjAtOS1dezM2fS0oY29tcGlsZXxydW4pJC8uZXhlYyhuYW1lIHx8ICcnKTsKICBjaGVjayhleGVjdXRhYmxlID09PSBjb25maWcucG9kbWFuICYmIGFyZ3MubGVuZ3RoID09PSA0ICYmIGFyZ3NbMV0gPT09ICctLWF0dGFjaCcgJiYgYXJnc1syXSA9PT0gJy0taW50ZXJhY3RpdmUnICYmIG1hdGNoLCAnQ1BVX1NUQVJUX1NDT1BFX0lOVkFMSUQnKTsKICBjb25zdCBwaGFzZSA9IG1hdGNoWzFdLCBsaW1pdFVzZWMgPSBMSU1JVFNbcGhhc2VdLmNwdSAqIDEwMDAwMDA7CiAgbGV0IGVuZGVkID0gZmFsc2UsIGV4Y2VlZGVkID0gZmFsc2UsIGZhaWx1cmUsIGZpbGUsIGlkZW50aXR5LCB1c2FnZVVzZWMgPSAwOwogIGNvbnN0IGluc3BlY3QgPSBhc3luYyAoKSA9PiB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBleGVjdXRlKGV4ZWN1dGFibGUsIFsnaW5zcGVjdCcsIG5hbWVdLCB7IHRpbWVvdXQ6IDEwMDAsIG91dHB1dExpbWl0OiAxMjggKiAxMDI0IH0pOwogICAgY2hlY2soIXJlc3VsdC5yZWFzb24gJiYgcmVzdWx0LmNvZGUgPT09IDAsICdDUFVfSU5TUEVDVF9GQUlMRUQnKTsKICAgIHJldHVybiBjb250YWluZXJTdGF0ZShKU09OLnBhcnNlKHJlc3VsdC5zdGRvdXQpLCBuYW1lKTsKICB9OwogIGNvbnN0IGtpbGwgPSBhc3luYyAoKSA9PiB7CiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBleGVjdXRlKGV4ZWN1dGFibGUsIFsna2lsbCcsICctLXNpZ25hbCcsICdLSUxMJywgbmFtZV0sIHsgdGltZW91dDogMTAwMCwgb3V0cHV0TGltaXQ6IDE2Mzg0IH0pOwogICAgaWYgKHJlc3VsdC5yZWFzb24gfHwgcmVzdWx0LmNvZGUgIT09IDApIGNoZWNrKCEoYXdhaXQgaW5zcGVjdCgpKS5ydW5uaW5nLCAnQ1BVX1NUT1BfVU5DT05GSVJNRUQnKTsKICB9OwogIC8vIOWtpueUn+i/m+eoi+S7jeS9v+eUqOWOn+adpeeahOWQr+WKqOWPguaVsOOAguebkea1i+WPquivu+WPluWuv+S4u+acuuWGheaguOiuoeaVsO+8jOS4jeS+nei1lueoi+W6j+i+k+WHuuaIlumAgOWHuueggeOAggogIGNvbnN0IGF0dGFjaGVkID0gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiBleGVjdXRlKGV4ZWN1dGFibGUsIGFyZ3MsIG9wdGlvbnMpKS50aGVuKHZhbHVlID0+IHsgZW5kZWQgPSB0cnVlOyByZXR1cm4gdmFsdWU7IH0sIGVycm9yID0+IHsgZW5kZWQgPSB0cnVlOyB0aHJvdyBlcnJvcjsgfSk7CiAgY29uc3Qgd2F0Y2hpbmcgPSAoYXN5bmMgKCkgPT4gewogICAgd2hpbGUgKCFlbmRlZCAmJiAhb3B0aW9ucz8uc2lnbmFsPy5hYm9ydGVkKSB7CiAgICAgIHRyeSB7CiAgICAgICAgaWYgKCFmaWxlKSB7CiAgICAgICAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IGluc3BlY3QoKTsKICAgICAgICAgIGlmIChlbmRlZCB8fCBvcHRpb25zPy5zaWduYWw/LmFib3J0ZWQpIHJldHVybjsKICAgICAgICAgIGlmICghc3RhdGUucnVubmluZykgewogICAgICAgICAgICBpZiAoWydleGl0ZWQnLCAnc3RvcHBlZCddLmluY2x1ZGVzKHN0YXRlLnN0YXR1cykpIHJldHVybjsKICAgICAgICAgICAgY2hlY2soWydjcmVhdGVkJywgJ2NvbmZpZ3VyZWQnLCAnaW5pdGlhbGl6ZWQnXS5pbmNsdWRlcyhzdGF0ZS5zdGF0dXMpLCAnQ1BVX1NUQVJUX1NUQVRFX0lOVkFMSUQnKTsKICAgICAgICAgICAgYXdhaXQgcGF1c2UoKTsgY29udGludWU7CiAgICAgICAgICB9CiAgICAgICAgICBpZGVudGl0eSA9IHN0YXRlLmlkOwogICAgICAgICAgY29uc3QgZ3JvdXAgPSBhd2FpdCByZWFkRmlsZSgnL3Byb2MvJyArIHN0YXRlLnBpZCArICcvY2dyb3VwJywgJ3V0ZjgnKTsKICAgICAgICAgIGlmIChlbmRlZCB8fCBvcHRpb25zPy5zaWduYWw/LmFib3J0ZWQpIHJldHVybjsKICAgICAgICAgIGZpbGUgPSBjcHVTdGF0UGF0aChncm91cCwgY29uZmlnLnVpZCwgaWRlbnRpdHkpOwogICAgICAgIH0KICAgICAgICBjb25zdCBuZXh0ID0gY3B1VXNhZ2UoYXdhaXQgcmVhZEZpbGUoZmlsZSwgJ3V0ZjgnKSk7CiAgICAgICAgaWYgKGVuZGVkIHx8IG9wdGlvbnM/LnNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuOwogICAgICAgIGNoZWNrKG5leHQgPj0gdXNhZ2VVc2VjLCAnQ1BVX0NPVU5URVJfUkVWRVJTRUQnKTsgdXNhZ2VVc2VjID0gbmV4dDsKICAgICAgICBpZiAodXNhZ2VVc2VjID49IGxpbWl0VXNlYykgewogICAgICAgICAgZXhjZWVkZWQgPSB0cnVlOwogICAgICAgICAgb25DcHVMaW1pdD8uKHsgbmFtZSwgcGhhc2UsIHVzYWdlVXNlYywgbGltaXRVc2VjLCBjb250YWluZXJJZDogaWRlbnRpdHkgfSk7CiAgICAgICAgICBhd2FpdCBraWxsKCk7IHJldHVybjsKICAgICAgICB9CiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7CiAgICAgICAgaWYgKGVuZGVkIHx8IG9wdGlvbnM/LnNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuOwogICAgICAgIC8vIOi/m+eoi+mAgOWHuuaXtiAvcHJvYyDlkowgY2dyb3VwIOWPr+iDveWFiOa2iOWkse+8m+WPquWcqOWuueWZqOehruW3suWBnOatouaXtuaOpeWPl+atpOernuS6ieOAggogICAgICAgIGlmIChbJ0VOT0VOVCcsICdFU1JDSCcsICdDUFVfU0NPUEVfSU5WQUxJRCcsICdDUFVfU1RBVF9JTlZBTElEJ10uaW5jbHVkZXMoZXJyb3IuY29kZSkgJiYgIShhd2FpdCBpbnNwZWN0KCkpLnJ1bm5pbmcpIHJldHVybjsKICAgICAgICB0aHJvdyBlcnJvcjsKICAgICAgfQogICAgICBhd2FpdCBwYXVzZSgpOwogICAgfQogIH0pKCkuY2F0Y2goYXN5bmMgZXJyb3IgPT4gewogICAgZmFpbHVyZSA9IGVycm9yOwogICAgaWYgKCFlbmRlZCAmJiAhb3B0aW9ucz8uc2lnbmFsPy5hYm9ydGVkKSB7IHRyeSB7IGF3YWl0IGtpbGwoKTsgfSBjYXRjaCAoc3RvcEVycm9yKSB7IGZhaWx1cmUgPSBzdG9wRXJyb3I7IH0gfQogIH0pOwogIGxldCByZXN1bHQ7CiAgdHJ5IHsgcmVzdWx0ID0gYXdhaXQgYXR0YWNoZWQ7IH0gZmluYWxseSB7IGVuZGVkID0gdHJ1ZTsgYXdhaXQgd2F0Y2hpbmc7IH0KICAvLyDlj5bmtojjgIHovpPlh7rkuIrpmZDlkozlt7LmnInlopnpkp/otoXml7bkvJjlhYjvvJvnm5HmtYvlpLHotKXkuI3og73lhpLlhYUgQ1BVIOi2heaXtuOAggogIGlmIChyZXN1bHQucmVhc29uIHx8IG9wdGlvbnM/LnNpZ25hbD8uYWJvcnRlZCkgcmV0dXJuIHJlc3VsdDsKICBpZiAoZmFpbHVyZSkgdGhyb3cgZmFpbHVyZTsKICBpZiAoZXhjZWVkZWQpIHsKICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgaW5zcGVjdCgpOwogICAgY2hlY2soIXN0YXRlLnJ1bm5pbmcgJiYgc3RhdGUuaWQgPT09IGlkZW50aXR5ICYmIHR5cGVvZiBzdGF0ZS5vb20gPT09ICdib29sZWFuJyAmJiBOdW1iZXIuaXNJbnRlZ2VyKHN0YXRlLmV4aXQpLCAnQ1BVX0ZJTkFMX1NUQVRFX0lOVkFMSUQnKTsKICAgIGlmICghc3RhdGUub29tKSByZXR1cm4geyAuLi5yZXN1bHQsIHJlYXNvbjogJ3RpbWUnLCBjb2RlOiBzdGF0ZS5leGl0LCBjcHVMaW1pdDogeyB1c2FnZVVzZWMsIGxpbWl0VXNlYyB9IH07CiAgfQogIHJldHVybiByZXN1bHQ7Cn0KCmV4cG9ydCBjbGFzcyBDcHVNZXRlcmVkU2FuZGJveCBleHRlbmRzIFBvZG1hblNhbmRib3ggewogIGNvbnN0cnVjdG9yKGNvbmZpZywgcnVuQ29tbWFuZCA9IGNvbW1hbmQsIG1vbml0b3JpbmcgPSB7fSkgewogICAgc3VwZXIoY29uZmlnLCAoZXhlY3V0YWJsZSwgYXJncywgb3B0aW9ucykgPT4gY3B1TGltaXRlZENvbW1hbmQoY29uZmlnLCBleGVjdXRhYmxlLCBhcmdzLCBvcHRpb25zLCBydW5Db21tYW5kLCBtb25pdG9yaW5nKSk7CiAgfQp9Cg==';
export const EXTRA_CASES = Object.freeze([
  { name: '主动返回 137 不误报超时', code: 'int main(){return 137;}', state: 'runtime_error' },
  { name: '伪造 CPU 输出不影响分类', code: '#include <iostream>\nint main(){std::cout<<"cpu_usec=999999999\\n";return 137;}', state: 'runtime_error', output: 'cpu_usec=999999999\n' }
]);
const runnerEnv = { HOME: HOME_DIR, USER: 'cpp-runner', LOGNAME: 'cpp-runner', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', XDG_CONFIG_HOME: HOME_DIR + '/.config', XDG_DATA_HOME: HOME_DIR + '/.local/share', XDG_RUNTIME_DIR: '/run/user/994', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/994/bus', TMPDIR: HOME_DIR + '/tmp' };
let record, logFd, lockFd, checks, diagnostic, switched = false, entryBytes, entryStat;
let phase = '初始检查';
function ensure(ok, code) { if (!ok) throw Object.assign(new Error(), { code }); }
function safeCode(value) { return /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : 'CPU_REPAIR_FAILED'; }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function log(value) { const line = new Date().toISOString() + ' ' + (typeof value === 'string' ? value : JSON.stringify(value)) + '\n'; process.stdout.write(line); if (logFd !== undefined) fs.writeSync(logFd, line); }
function save(name, value) { fs.writeFileSync(record + '/' + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
function step(value) { phase = value; log(value); }
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function readScript(file, digest, marker) {
  const stat = fs.lstatSync(file); ensure(stat.isFile() && stat.uid === 0 && stat.nlink === 1 && !(stat.mode & 0o022) && stat.size < 256 * 1024 && fs.realpathSync(file) === file, 'HELPER_UNSAFE');
  const bytes = fs.readFileSync(file); ensure(hash(bytes) === digest, 'HELPER_CHANGED');
  const body = new RegExp("<<'" + marker + "'\\n([\\s\\S]+)\\n" + marker + '\\n$').exec(bytes.toString('utf8'))?.[1]; ensure(body, 'HELPER_FORMAT'); return body;
}
export function patchEntry(bytes) {
  ensure(hash(bytes) === SERVER_BEFORE, 'RUNNER_ENTRY_CHANGED');
  const text = bytes.toString('utf8'), before = "import { PodmanSandbox } from './podman.mjs';", after = "import { CpuMeteredSandbox as PodmanSandbox } from './cpu-budget.mjs';";
  ensure(text.split(before).length === 2, 'RUNNER_ENTRY_AMBIGUOUS');
  const result = Buffer.from(text.replace(before, after)); ensure(hash(result) === SERVER_AFTER, 'RUNNER_ENTRY_PATCH_INVALID'); return result;
}
export function checkDiagnosis(value) {
  ensure(value?.stage === 'cpu-exit-diagnostic-collected' && value.previous === PREVIOUS && value.runEnabled === false && value.final?.image === IMAGE && value.final.containers === 0 && value.final.runEnabled === false && value.probes?.length === 3, 'DIAGNOSIS_INCOMPLETE');
  const expected = [137, 152, 137];
  value.probes.forEach((probe, i) => {
    const s = probe.summary, inspected = s?.observations?.filter(row => row.kind === 'inspect' && row.phase === 'run'), attached = s?.observations?.filter(row => row.kind === 'attach' && row.phase === 'run');
    ensure(probe.mode === i && s?.reported?.pid === 1 && s.reported.soft === 3 && s.reported.hard === 4 && s.reported.disposition === 'default', 'DIAGNOSIS_LIMITS_CHANGED');
    ensure(inspected?.length === 1 && inspected[0].exitCode === expected[i] && inspected[0].oomKilled === false && inspected[0].running === false && attached?.length === 1 && !attached[0].reason && !attached[0].signal, 'DIAGNOSIS_EXIT_CHANGED');
    ensure(s.state === (i === 1 ? 'time_limit' : 'runtime_error') && s.signalHandlerObserved === (i === 1), 'DIAGNOSIS_RESULT_CHANGED');
  });
  ensure(value.probes[0].summary.lastCpuUsec >= 3500000 && value.probes[0].summary.lastCpuUsec < 4000000 && value.probes[1].summary.lastCpuUsec >= 2500000 && value.probes[2].summary.lastCpuUsec === null, 'DIAGNOSIS_CPU_SAMPLES_CHANGED');
}
function replaceOnce(text, before, after) { ensure(text.split(before).length === 2, 'WORKER_PATCH_AMBIGUOUS'); return text.replace(before, after); }
export function buildWorkerSource(originalSource, previousLabel, baseCases) {
  ensure(/^[a-f0-9]{12}$/.test(previousLabel), 'PREVIOUS_LABEL_INVALID');
  let source = replaceOnce(originalSource, 'const CASES=' + JSON.stringify(baseCases) + ';', 'const CASES=' + JSON.stringify([...baseCases, ...EXTRA_CASES]) + ';');
  source = replaceOnce(source, "checkHostInfo(JSON.parse(call(['info', '--format=json'])), 1); assertEmpty();", "checkHostInfo(JSON.parse(call(['info', '--format=json'])), 2); assertEmpty();");
  const begin = "    fs.mkdirSync(area, { mode: 0o700 }); fs.mkdirSync(area + '/build', { mode: 0o700 });";
  const end = "    const config = { image: imageId, uid: 994, gid: 991, podman: '/usr/bin/podman', dataRoot: area + '/jobs-data', minFreeBytes: 4 * 1024 ** 3 };";
  ensure(source.split(begin).length === 2 && source.split(end).length === 2, 'WORKER_BUILD_BLOCK_INVALID');
  const at = source.indexOf(begin), to = source.indexOf(end, at); ensure(to > at, 'WORKER_BUILD_BLOCK_INVALID');
  source = source.slice(0, at) + [
    "    fs.mkdirSync(area, { mode: 0o700 });",
    "    checkSource(root + '/runner/src/cpu-budget.mjs', '" + MODULE_SHA + "');",
    "    const { command, containerOptions } = await import('file://' + root + '/runner/src/podman.mjs');",
    "    const { CpuMeteredSandbox: PodmanSandbox } = await import('file://' + root + '/runner/src/cpu-budget.mjs');",
    "    const { JobManager } = await import('file://' + root + '/runner/src/jobs.mjs');",
    "    const imageId = '" + IMAGE + "', containerfileSha256 = 'c20ac222f94847b5aa205fc9bede86158f97eab97afda06baef24fbb267d27f1';",
    "    const inspect = JSON.parse(call(['image', 'inspect', imageId]))[0];",
    "    const image = checkTeachingImage(inspect, imageId, pin, diffIds, '" + previousLabel + "');",
    "    passed('复用已验证教学镜像（不重新构建）', { image, inspect });",
    "    const cpuEvents = [];"
  ].join('\n') + '\n' + source.slice(to);
  source = replaceOnce(source, '    const sandbox = new PodmanSandbox(config);', "    const sandbox = new PodmanSandbox(config, command, { onCpuLimit: value => { cpuEvents.push(value); emit({ event: 'cpu-limit', value }); } });");
  source = replaceOnce(source, '      checkCase(item, result); ensure(manager.current === null,', "      if (item.name === 'CPU 时间上限') ensure(cpuEvents.some(event => event.name === sandbox.names(id)[1] && event.phase === 'run' && event.usageUsec >= 3000000 && event.limitUsec === 3000000), 'CPU_BUDGET_NOT_OBSERVED');\n      checkCase(item, result); ensure(manager.current === null,");
  source = replaceOnce(source, "    emit({ event: 'complete', image, inspect, info, checks: checkCount, area, containerfileSha256, runEnabled: false, containers: 0 });", "    emit({ event: 'complete', image, inspect, info, checks: checkCount, area, containerfileSha256, cpuEvents, runEnabled: false, containers: 0 });");
  return source;
}
export function checkVerification(result, cases, validateCase) {
  ensure(typeof result?.stdout === 'string', 'WORKER_OUTPUT_INVALID');
  const rows = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const error = rows.find(row => row.event === 'error'); if (error) throw Object.assign(new Error(), { code: safeCode(error.code) });
  ensure(result.status === 0 && !result.signal && !rows.some(row => ['cleanup-unconfirmed', 'container-state-unconfirmed'].includes(row.event)), 'WORKER_NOT_COMPLETED');
  const done = rows.filter(row => row.event === 'complete'), passes = rows.filter(row => row.event === 'pass'), results = rows.filter(row => row.event === 'case-result');
  ensure(done.length === 1 && done[0].checks === cases.length + 5 && done[0].containers === 0 && done[0].runEnabled === false && done[0].image?.imageId === IMAGE, 'VERIFICATION_INCOMPLETE');
  ensure(passes.length === cases.length + 5 && passes.every((row, i) => row.number === i + 1) && results.length === cases.length && results.every((row, i) => row.name === cases[i].name), 'VERIFICATION_RECORDS_INCOMPLETE');
  results.forEach((row, i) => validateCase(cases[i], row.result));
  const cpu = results.find(row => row.name === 'CPU 时间上限');
  const event = rows.find(row => row.event === 'cpu-limit' && row.value?.name === 'cpp-job-' + cpu?.result?.id + '-run' && row.value.phase === 'run' && row.value.usageUsec >= 3000000 && row.value.limitUsec === 3000000);
  ensure(event && done[0].cpuEvents?.some(value => JSON.stringify(value) === JSON.stringify(event.value)), 'CPU_BUDGET_NOT_OBSERVED');
  return done[0];
}
async function loadChecks() {
  const body = readScript(ROOT + '/deploy/resume-compiler-containers-20260831-02.sh', '814b2f79e5c25e95a65fdb7796d2b38f488a2c32009e29ee3ab7b14c147eb116', 'CPP_COMPILER_CHECK_NODE');
  const extra = '\nexport { loadChecks, old, imageHelpers, accountHelpers, repairHelpers, rootlessHelpers, diagnosticHelpers, observeWorker };\nexport function bindRepair(folder, fd){record=folder;logFd=fd;}';
  checks = await import('data:text/javascript;base64,' + Buffer.from(body + extra).toString('base64'));
  checks.bindRepair(record, logFd); await checks.loadChecks();
  const diagBody = readScript(ROOT + '/deploy/diagnose-compiler-cpu-20260831.sh', 'fed51c00301e31a395cdff2cc559371022399c13b9b4c30488b9dcb3361a6b1f', 'CPP_CPU_DIAG_NODE');
  diagnostic = await import('data:text/javascript;base64,' + Buffer.from(diagBody + '\nexport { observe };\nexport function bindRepair(value){checks=value;}').toString('base64')); diagnostic.bindRepair(checks);
}
async function runWorker(previousLabel) {
  const label = randomBytes(6).toString('hex'), unit = 'cpp-compiler-check-' + label + '.service'; save('worker-unit.json', { unit, label });
  const base = checks.workerSource(unit, label, checks.imageHelpers.PIN, checks.old.DIFF_IDS, checks.imageHelpers.checkHostInfo, checks.imageHelpers.checkSpace, checks.old.checkLoadedImage);
  const source = buildWorkerSource(base, previousLabel, checks.CASES);
  const args = ['--reuid', '994', '--regid', '991', '--clear-groups', '/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + unit, '--service-type=exec', '--property=Delegate=yes', '--property=UMask=0077', '--property=RuntimeMaxSec=900', '--property=TimeoutStopSec=30', '--property=WorkingDirectory=' + HOME_DIR, '/usr/bin/env', '-i', ...Object.entries(runnerEnv).map(([key, value]) => key + '=' + value), NODE, '--input-type=module', '-e', source];
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/setpriv', args, { env: runnerEnv, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8'); let stdout = '', stderr = '', pending = '';
    child.stdout.on('data', bytes => {
      const text = decoder.write(bytes); stdout = (stdout + text).slice(-12 * 1024 ** 2); pending += text;
      for (;;) {
        const at = pending.indexOf('\n'); if (at < 0) break;
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try {
          const row = JSON.parse(line), clean = checks.diagnosticHelpers.redact;
          if (row.event === 'stage') log('验证阶段：' + clean(row.name, 100));
          if (row.event === 'pass') log('通过 ' + row.number + '：' + clean(row.name, 100));
          if (row.event === 'progress') log({ elapsedSeconds: row.seconds, freeMiB: row.freeMiB });
          if (row.event === 'cpu-limit') log({ cpuBudget: row.value });
          if (row.event === 'error') { log('验证错误：' + safeCode(row.code) + '；阶段：' + clean(row.phase, 100)); if (row.detail) log(clean(row.detail, 4000)); }
          if (row.event === 'case-result') {
            const expected = [...checks.CASES, ...EXTRA_CASES].find(item => item.name === row.name);
            if (expected && expected.state !== row.result?.state) log('状态不符：' + clean(JSON.stringify({ expected: expected.state, actual: row.result?.state, compiler: row.result?.compiler_output, stderr: row.result?.stderr, message: row.result?.message }), 4000));
          }
        } catch { /* 完整输出保存在私有记录；解析不完整不能通过验收。 */ }
      }
    });
    child.stdout.on('end', () => { stdout += decoder.end(); }); child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-512 * 1024); });
    child.once('error', () => reject(Object.assign(new Error(), { code: 'WORKER_START_FAILED' })));
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  save('worker-output.json', result); if (result.status !== 0 && result.stderr) log('用户服务错误：\n' + checks.diagnosticHelpers.redact(result.stderr, 4000));
  const deadline = Date.now() + 5000;
  for (;;) {
    const state = checks.observeWorker(unit);
    try { checks.old.checkInactiveUnit(state.exit, state.values, state.processes); save('worker-final-state.json', state); break; }
    catch (error) { if (Date.now() >= deadline) { save('worker-state-unconfirmed.json', state); throw error; } await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const completed = checkVerification(result, [...checks.CASES, ...EXTRA_CASES], checks.checkCase);
  checks.checkTeachingImage(completed.inspect, IMAGE, checks.imageHelpers.PIN, checks.old.DIFF_IDS, previousLabel); checks.imageHelpers.checkHostInfo(completed.info, 2);
  return completed;
}
function atomicEntry(bytes, expected) {
  const file = ROOT + '/runner/src/server.mjs'; ensure(checks.old.hash(file) === expected, 'RUNNER_ENTRY_CHANGED');
  const temp = ROOT + '/runner/src/.cpu-entry-' + randomBytes(6).toString('hex') + '.tmp';
  const fd = fs.openSync(temp, 'wx', entryStat.mode & 0o777);
  try { fs.writeFileSync(fd, bytes); fs.fchownSync(fd, entryStat.uid, entryStat.gid); fs.fchmodSync(fd, entryStat.mode & 0o777); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  ensure(checks.old.hash(file) === expected && hash(fs.readFileSync(temp)) === hash(bytes), 'RUNNER_ENTRY_CHANGED');
  fs.renameSync(temp, file);
}
async function main() {
  ensure(process.platform === 'linux' && process.getuid() === 0, 'LINUX_ROOT_REQUIRED');
  for (const [file, uid, mode] of [[ROOT, 0, 0o755], [ROOT + '/logs', 995, 0o750], [ROOT + '/backups', 0, 0o700]]) { const stat = fs.lstatSync(file); ensure(stat.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === mode && fs.realpathSync(file) === file, 'DIRECTORY_UNEXPECTED'); }
  ensure(!exists(LOCK), 'REPAIR_ALREADY_STARTED_DO_NOT_REPEAT');
  const logPath = ROOT + '/logs/compiler-check-03-' + randomBytes(6).toString('hex') + '.log'; logFd = fs.openSync(logPath, 'wx', 0o600); log('操作日志：' + logPath);
  record = fs.mkdtempSync(ROOT + '/backups/compiler-check-03-'); log('私有操作记录：' + record);
  step('只读预检：CPU 诊断结论、旧任务、代码、镜像记录及两个网站'); await loadChecks();
  const { old, accountHelpers, repairHelpers } = checks;
  old.directory(HOME_DIR, 994, 0o700); old.directory('/run/user/994', 994, 0o700); old.directory(DIAGNOSTIC, 0, 0o700); old.directory(PREVIOUS, 0, 0o700);
  const diagnosis = old.readJson(DIAGNOSTIC + '/result.json'); checkDiagnosis(diagnosis);
  diagnostic.checkDiagnosticCompletion(old.readJson(DIAGNOSTIC + '/worker-output.json'));
  const diagPost = old.readJson(DIAGNOSTIC + '/website-postcheck.json'); ensure(diagPost.unchanged === true && diagPost.runEnabled === false, 'DIAGNOSIS_POSTCHECK_INVALID');
  for (const [folder, lockFile] of [[DIAGNOSTIC, 'compiler-cpu-diagnostic.lock'], [PREVIOUS, 'compiler-check-02.lock']]) {
    const lock = old.readJson(ROOT + '/backups/' + lockFile); ensure(lock.record === folder && Number.isSafeInteger(lock.pid) && lock.pid > 1 && !exists('/proc/' + lock.pid), 'PREVIOUS_CONTROLLER_NOT_STOPPED');
    const unit = old.readJson(folder + '/worker-unit.json').unit, state = diagnostic.observe(unit); old.checkInactiveUnit(state.exit, state.values, state.processes);
  }
  const previous = diagnostic.previousEvidence(old.readJson(PREVIOUS + '/worker-output.json'), old.readJson(PREVIOUS + '/worker-unit.json'), checks.CASES);
  ensure(previous.image.imageId === IMAGE, 'TEACHING_IMAGE_CHANGED'); checks.checkTeachingImage(previous.inspect, IMAGE, checks.imageHelpers.PIN, old.DIFF_IDS, previous.task.label);
  const previousArea = checks.diagnosticHelpers.task(previous.task).area; old.directory(previousArea, 994, 0o700);
  ensure(old.hash(previousArea + '/build/Containerfile') === 'c20ac222f94847b5aa205fc9bede86158f97eab97afda06baef24fbb267d27f1' && checks.normalizeImageId(old.read(previousArea + '/build/image.id').toString()) === IMAGE, 'PREVIOUS_IMAGE_FILES_CHANGED');
  for (const [file, digest] of Object.entries(checks.SOURCE_HASHES)) checks.checkSource(ROOT + '/' + file, digest);
  const entry = ROOT + '/runner/src/server.mjs', module = ROOT + '/runner/src/cpu-budget.mjs';
  entryBytes = checks.checkSource(entry, SERVER_BEFORE); entryStat = fs.lstatSync(entry); patchEntry(entryBytes); ensure(!exists(module), 'CPU_MODULE_ALREADY_EXISTS');
  const sourceDirectory = fs.lstatSync(ROOT + '/runner/src'); ensure(sourceDirectory.isDirectory() && sourceDirectory.uid === 0 && !(sourceDirectory.mode & 0o022) && fs.realpathSync(ROOT + '/runner/src') === ROOT + '/runner/src', 'RUNNER_SOURCE_DIRECTORY_UNSAFE');
  ensure(!exists(ROOT + '/.env.runner') && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_ALREADY_STARTED');
  const manager = old.manager(); repairHelpers.checkManager(manager, true); old.limits();
  const files = [ROOT + '/.env', '/etc/selinux/config', '/etc/passwd', '/etc/group', '/etc/shadow', '/etc/gshadow', '/etc/subuid', '/etc/subgid', '/etc/httpd/conf.d/tigao123-le-ssl.conf', '/etc/httpd/conf.d/tigao123.conf', '/root/.pm2/dump.pm2', '/etc/systemd/system/user-994.slice.d/90-teaching-cpp-limits.conf', '/etc/systemd/system/user@994.service.d/90-teaching-cpp-delegate.conf', HOME_DIR + '/.config/containers/storage.conf', HOME_DIR + '/.config/containers/containers.conf', ROOT + '/backups/compiler-check-02.lock', ROOT + '/backups/compiler-cpu-diagnostic.lock', DIAGNOSTIC + '/result.json', DIAGNOSTIC + '/worker-output.json', DIAGNOSTIC + '/website-postcheck.json', PREVIOUS + '/worker-output.json', previousArea + '/build/Containerfile', previousArea + '/build/image.id', entry, ...Object.keys(checks.SOURCE_HASHES).map(file => ROOT + '/' + file)];
  const hashes = Object.fromEntries(files.map(file => [file, old.hash(file)])), nss = accountHelpers.nssSnapshot(), pm2 = old.pm2Snapshot(); old.websites(); save('before.json', { hashes, nss, pm2, manager });
  fs.writeFileSync(record + '/server.before.mjs', entryBytes, { flag: 'wx', mode: 0o600 });
  lockFd = fs.openSync(LOCK, 'wx', 0o600); fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, record }) + '\n');
  step('只新增 CPU 计量模块，执行服务入口暂不改动；随后验证原 16 项及两个误判对照');
  const payload = Buffer.from(MODULE_BASE64, 'base64'); ensure(hash(payload) === MODULE_SHA, 'MODULE_PAYLOAD_INVALID');
  const fd = fs.openSync(module, 'wx', 0o644); try { fs.writeFileSync(fd, payload); fs.fchmodSync(fd, 0o644); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  checks.checkSource(module, MODULE_SHA);
  let completed, failure; try { completed = await runWorker(previous.task.label); } catch (error) { failure = error; }
  step('复核原文件、网站进程、用户管理器与总限额');
  for (const [file, digest] of Object.entries(hashes)) ensure(old.hash(file) === digest, 'EXISTING_FILE_CHANGED'); checks.checkSource(module, MODULE_SHA);
  accountHelpers.assertNssUnchanged(nss); const afterManager = old.manager(); repairHelpers.checkManager(afterManager, true); old.limits();
  ensure(afterManager.MainPID === manager.MainPID && JSON.stringify(old.pm2Snapshot()) === JSON.stringify(pm2), 'EXISTING_PROCESS_CHANGED');
  ensure(!exists(ROOT + '/.env.runner') && old.run('ss', ['-H', '-lnt', '( sport = :5280 )']).trim() === '', 'RUNNER_ALREADY_STARTED'); old.websites(); save('website-postcheck.json', { unchanged: true, runEnabled: false, pm2, manager: afterManager });
  if (failure) throw failure;
  save('verification.json', completed);
  step('18 项验证通过，只切换尚未启动的执行服务入口；不启动服务或开放网页运行');
  atomicEntry(patchEntry(entryBytes), SERVER_BEFORE); switched = true; checks.checkSource(entry, SERVER_AFTER);
  save('result.json', { stage: 'cpu-budget-repaired-and-verified', checks: completed.checks, image: IMAGE, moduleSha256: MODULE_SHA, serverSha256: SERVER_AFTER, previous: PREVIOUS, diagnostic: DIAGNOSTIC, runEnabled: false, containers: 0 });
  log('CPU 计量修正及全部 18 项验证完成；原 Podman 隔离参数不变，新增按容器累计 CPU 用量停止。');
  log('两个网站及用户管理器未重启，网页编译运行仍关闭；下一步才准备执行服务。');
  log('请发回完整输出。私有记录：' + record);
}
if (process.argv[2] === '--repair-compiler-cpu') {
  try { await main(); }
  catch (error) {
    log('修正验证未完成；阶段：' + phase + '；错误码：' + safeCode(error.code));
    if (switched) { try { atomicEntry(entryBytes, SERVER_AFTER); log('已恢复执行服务原入口，新增模块及验证记录保留。'); } catch (restoreError) { log('入口恢复未确认：' + safeCode(restoreError.code)); } }
    if (record) log('私有操作记录：' + record); log('网页运行未开启。保留镜像、模块、目录与锁，不重跑；请发回完整输出。'); process.exitCode = 1;
  } finally { if (lockFd !== undefined) fs.closeSync(lockFd); if (logFd !== undefined) fs.closeSync(logFd); }
}
CPP_CPU_REPAIR_NODE
