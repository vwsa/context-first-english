const form = document.getElementById('connection-form');
const tokenInput = document.getElementById('token');
const portInput = document.getElementById('port');
const status = document.getElementById('status');
chrome.storage.local.get(['token', 'port', 'lastError']).then(settings => {
  tokenInput.value = settings.token || '';
  portInput.value = String(settings.port || 37719);
  status.textContent = settings.lastError || '';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const token = tokenInput.value.trim(), port = Number(portInput.value);
  if (token.length < 16 || !Number.isInteger(port) || port < 1024 || port > 65535) {status.textContent = '请检查连接码和端口。'; return;}
  const button = form.querySelector('button'); button.disabled = true;
  status.textContent = '正在检查连接…';
  await chrome.storage.local.set({token, port, lastError: ''});
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(5000)});
    status.textContent = response.ok ? '已连接，可以开始选词。' : response.status === 401 || response.status === 403 ? '连接码不匹配，请重新复制。' : `已保存，桌面应用返回 ${response.status}。`;
  } catch {status.textContent = '设置已保存。请先打开桌面应用，再检查连接。';}
  finally {button.disabled = false;}
});
