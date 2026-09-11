let mode = 'production';
let demoUser = 1;
let language = 'zh';
export function configureApi(config, userId = 1) { mode = config.mode; demoUser = userId; }
export function configureApiLanguage(value) { language = value === 'en' ? 'en' : 'zh'; }
export class ApiError extends Error {
  constructor(status, data) { super(data.message || '请求失败'); this.status = status; Object.assign(this, data); }
}
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'Accept-Language': language === 'en' ? 'en' : 'zh-CN' };
  if (mode === 'demo') headers['X-Demo-User'] = String(demoUser);
  else {
    let token;
    try { token = localStorage.getItem('teaching_token'); } catch { token = null; }
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(`/api/cpp${path}`, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal || AbortSignal.timeout(15000), cache: 'no-store' });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: '连接中断，尚未确认本次操作结果。请保留本地草稿后重试' });
  }
  const data = await response.json().catch(() => ({ code: 'INVALID_RESPONSE', message: '服务器返回了无法识别的响应' }));
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}
export function storeLocal(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function readLocal(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function downloadCode(code, title = 'main.cpp') {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = title; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
