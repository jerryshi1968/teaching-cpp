import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// 本实验只监听两个随机本机端口；所有页面、标记和素材均为虚拟数据，不连接正式网站或数据库。
const libraryPath = process.argv[2];
if (!libraryPath || path.basename(libraryPath) !== 'p5-1.11.13.min.js') {
  throw new Error('请传入现有 p5-1.11.13.min.js 的完整路径；不下载或替换任何依赖。');
}
const library = fs.readFileSync(libraryPath);
const servers = [];
let mainOrigin;
let previewOrigin;
const modes = ['legacy', 'sandbox', 'sandbox-cors', 'separate-origin'];
const labels = ['现有同源预览', '仅增加 CSP 沙箱', 'CSP 沙箱 + 素材 CORS', '独立预览来源'];
const expected = {
  legacy: { parentReadable: true, storageAvailable: true, jsonLoaded: true, imageLoaded: true },
  sandbox: { parentReadable: false, storageAvailable: false, jsonLoaded: false, imageLoaded: false },
  'sandbox-cors': { parentReadable: false, storageAvailable: false, jsonLoaded: true, imageLoaded: true },
  'separate-origin': { parentReadable: false, storageAvailable: true, jsonLoaded: true, imageLoaded: true }
};
const styles = 'body{font:16px system-ui;max-width:1200px;margin:32px auto;color:#20334c}iframe{width:100%;height:210px;border:1px solid #ccd5e0}section{margin:20px 0;padding:16px;background:#f4f7fb}pre{white-space:pre-wrap}.pass{color:#167443}.fail{color:#b02424}';
function html(title, body) {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + title + '</title><style>' + styles + '</style><body>' + body + '</body></html>';
}
function dashboard() {
  return html('作品隔离本地验证', '<h1>作品隔离本地验证</h1><p>只使用虚拟数据和本机 p5.js 库；不会读取真实登录信息。</p>'
    + '<span id="fixture-marker">synthetic-public-marker</span><p id="summary">等待 4 组浏览器结果</p>'
    + modes.map((mode, index) => '<section><h2>' + labels[index] + '</h2><pre id="result-' + mode + '">等待</pre><iframe id="frame-' + mode + '" title="' + mode + '" sandbox="allow-scripts allow-same-origin"></iframe><p><a target="_blank" rel="noopener" href="' + (mode === 'separate-origin' ? previewOrigin : mainOrigin) + '/demo/' + mode + '/index.html">直接打开：' + mode + '</a></p></section>').join('')
    + '<script>const expected=' + JSON.stringify(expected) + ';const reports=new Map();const modes=' + JSON.stringify(modes) + ';'
    + 'addEventListener("message",event=>{const value=event.data;if(!value||value.kind!=="fixture-result"||!modes.includes(value.mode))return;'
    + 'const frame=document.getElementById("frame-"+value.mode);const origin=value.mode==="separate-origin"?' + JSON.stringify(previewOrigin) + ':(value.mode.startsWith("sandbox")?"null":location.origin);'
    + 'if(event.source!==frame.contentWindow||event.origin!==origin)return;'
    + 'const pass=Object.entries(expected[value.mode]).every(([key,item])=>value[key]===item)&&value.canvasDrawn===true;reports.set(value.mode,pass);'
    + 'const output=document.getElementById("result-"+value.mode);output.className=pass?"pass":"fail";output.textContent=(pass?"符合预期":"不符合预期")+"\\n"+JSON.stringify(value,null,2);'
    + 'document.getElementById("summary").textContent=reports.size===4?(Array.from(reports.values()).every(Boolean)?"4/4 组结果符合预期":"有结果不符合预期"):(reports.size+"/4 组完成");});'
    + 'for(const mode of modes)document.getElementById("frame-"+mode).src=(mode==="separate-origin"?' + JSON.stringify(previewOrigin) + ':location.origin)+"/demo/"+mode+"/index.html";</script>');
}
function demo(mode) {
  return html('虚拟作品 ' + mode, '<h2>' + mode + '</h2><div id="canvas"></div><pre id="checks">检查中</pre>'
    + '<script src="/teaching-p5js/libs/p5-1.11.13.min.js"></script><script>'
    + 'const result={kind:"fixture-result",mode:' + JSON.stringify(mode) + ',topLevel:parent===window,parentReadable:false,storageAvailable:false,canvasDrawn:false,jsonLoaded:false,imageLoaded:false};'
    + 'if(parent!==window){try{result.parentReadable=parent.document.getElementById("fixture-marker").textContent==="synthetic-public-marker";}catch{}}'
    // 只检查 Storage API 是否可用，不读取、枚举、写入或删除任何存储键值。
    + 'try{result.storageAvailable=typeof window.localStorage.getItem==="function";}catch{}'
    + 'let remaining=2;let finished=false;function finish(){if(finished)return;finished=true;clearTimeout(deadline);document.getElementById("checks").textContent=JSON.stringify(result,null,2);if(parent!==window)parent.postMessage(result,' + JSON.stringify(mainOrigin) + ');}'
    + 'function complete(){if(--remaining===0)finish();}const deadline=setTimeout(finish,12000);'
    + 'new p5(p=>{p.setup=()=>{const canvas=p.createCanvas(120,50);canvas.parent("canvas");p.background(70,120,220);p.noLoop();result.canvasDrawn=!!canvas.elt.getContext("2d");'
    + 'p.loadJSON("assets/data.json",data=>{result.jsonLoaded=data.fixture===true;complete();},()=>complete());'
    + 'p.loadImage("assets/tile.svg",image=>{result.imageLoaded=image.width===24;p.image(image,10,10);complete();},()=>complete());};});</script>');
}
function handle(req, res, isolated) {
  const expectedHost = new URL(isolated ? previewOrigin : mainOrigin).host;
  if (req.headers.host !== expectedHost) { res.writeHead(421).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const url = new URL(req.url, 'http://' + expectedHost);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Origin-Agent-Cluster', '?1');
  let body;
  if (!isolated && url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    body = dashboard();
  } else if (url.pathname === '/teaching-p5js/libs/p5-1.11.13.min.js') {
    res.setHeader('Content-Type', 'application/javascript');
    body = library;
  } else {
    const match = /^\/demo\/(legacy|sandbox|sandbox-cors|separate-origin)\/(index\.html|assets\/data\.json|assets\/tile\.svg)$/.exec(url.pathname);
    if (!match || isolated !== (match[1] === 'separate-origin')) { res.writeHead(404).end(); return; }
    const [, mode, file] = match;
    if (mode.startsWith('sandbox')) res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
    if (mode === 'sandbox-cors') res.setHeader('Access-Control-Allow-Origin', '*');
    if (file === 'index.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); body = demo(mode); }
    if (file === 'assets/data.json') { res.setHeader('Content-Type', 'application/json'); body = '{"fixture":true}'; }
    if (file === 'assets/tile.svg') { res.setHeader('Content-Type', 'image/svg+xml'); body = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#ffcf55"/></svg>'; }
  }
  res.writeHead(200);
  res.end(req.method === 'HEAD' ? undefined : body);
}
async function start(isolated) {
  const server = http.createServer((req, res) => handle(req, res, isolated));
  servers.push(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return 'http://127.0.0.1:' + server.address().port;
}
function stop() { for (const server of servers) { server.close(); server.closeAllConnections(); } }
mainOrigin = await start(false);
previewOrigin = await start(true);
console.log(JSON.stringify({ mainOrigin, previewOrigin, librarySha256: createHash('sha256').update(library).digest('hex') }));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
// 本地验证服务最多运行 15 分钟，不注册系统服务或定时任务。
setTimeout(stop, 15 * 60 * 1000).unref();
