import test from 'node:test';
import assert from 'node:assert/strict';
import { insertInclude, INCLUDE } from '../deploy/web-publish-20260830-01/patch.mjs';

const original = `<IfModule mod_ssl.c>
# 原注释：不得改动
<VirtualHost *:443>
    ServerName tigao123.com
    ProxyPass /tools/example/ http://127.0.0.1:5000/
    <Location "/tools/example/">
        LimitRequestBody 104857600
    </Location>
    # p5.js 代理原注释
    ProxyPass /api http://127.0.0.1:5080/api timeout=600 flushpackets=on
    ProxyPassReverse /api http://127.0.0.1:5080/api
    DocumentRoot /var/www/html
    SSLCertificateFile /etc/letsencrypt/live/tigao123.com/fullchain.pem
</VirtualHost>
<VirtualHost *:443>
    ServerName www.tigao123.com
    RewriteRule ^(.*)$ https://tigao123.com$1 [R=301,L]
</VirtualHost>
</IfModule>
`;

test('只在主站原代理之前插入引用，其他配置和注释逐字不变', () => {
  const changed = insertInclude(original);
  assert.ok(changed.indexOf(INCLUDE) < changed.indexOf('    ProxyPass /api'));
  assert.equal(changed.replace('    # --- C++ 教学平台入口 ---\n    Include "' + INCLUDE + '"\n\n', ''), original);
  assert.equal(changed.slice(changed.indexOf('    ServerName www.')), original.slice(original.indexOf('    ServerName www.')));
});
test('保留 CRLF，重复执行和混合换行均拒绝', () => {
  const crlf = original.replace(/\n/g, '\r\n');
  assert.equal(insertInclude(crlf), insertInclude(original).replace(/\n/g, '\r\n'));
  assert.throws(() => insertInclude(insertInclude(original)));
  assert.throws(() => insertInclude(original.replace('\n', '\r\n')));
});
test('错误端口、重复主站、错误根目录和嵌套代理均拒绝', () => {
  assert.throws(() => insertInclude(original.replaceAll(':5080', ':5000')));
  assert.throws(() => insertInclude(original.replace('ServerName www.tigao123.com', 'ServerName tigao123.com')));
  assert.throws(() => insertInclude(original.replace('DocumentRoot /var/www/html', 'DocumentRoot /srv/site')));
  assert.throws(() => insertInclude(original.replace('    ProxyPass /api', '    <Location "/api">\n    ProxyPass /api')));
});
