import {createCapture} from '../../../src/shared/capture';
import {collectPageSelection, type PageSelection} from './collector';

declare const chrome: any;
const DEFAULT_PORT = 37719;
async function capture(tab: {id?: number}, frameId = 0) {
  if (typeof tab.id !== 'number') throw new Error('未找到当前网页。');
  const settings = await chrome.storage.local.get(['token', 'port']);
  if (typeof settings.token !== 'string' || settings.token.length < 16) {
    await chrome.runtime.openOptionsPage();
    throw new Error('请先在扩展设置中连接桌面应用。');
  }
  const port = Number(settings.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('连接端口无效，请检查扩展设置。');
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: {tabId: tab.id, frameIds: [frameId]}, func: collectPageSelection,
    });
  } catch {throw new Error('此页面不允许读取选区，请尝试普通网页正文。');}
  const result = results?.[0]?.result as PageSelection | {error: string} | undefined;
  if (!result) throw new Error('此页面无法读取选区。请尝试普通网页正文。');
  if ('error' in result) throw new Error(result.error);
  const item = createCapture({
    ...result,
    source: {kind: 'browser', title: result.title || null, url: /^https?:\/\//.test(result.url) ? result.url : null,
      documentUri: null, languageId: null, lineStart: null, lineEnd: null},
  });
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}`},
      body: JSON.stringify(item), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new Error('无法连接桌面应用，请先打开 Context First。'); }
  if (response.status === 401 || response.status === 403) throw new Error('连接码不匹配，请从桌面设置重新复制。');
  if (!response.ok) throw new Error(`桌面应用未接收选区（${response.status}）。`);
  await chrome.storage.local.set({lastError: ''});
  await chrome.action.setBadgeText({text: '', tabId: tab.id});
  await chrome.action.setTitle({title: '已在 Context First 中打开', tabId: tab.id});
}
async function run(tab: {id?: number}, frameId = 0) {
  try { await capture(tab, frameId); }
  catch (error) {
    const message = error instanceof Error ? error.message : '无法解释选区。';
    await chrome.storage.local.set({lastError: message});
    await chrome.action.setBadgeBackgroundColor({color: '#98573f'});
    await chrome.action.setBadgeText({text: '!', ...(tab.id !== undefined ? {tabId: tab.id} : {})});
    await chrome.action.setTitle({title: message, ...(tab.id !== undefined ? {tabId: tab.id} : {})});
  }
}
chrome.action.onClicked.addListener((tab: {id?: number}) => {void run(tab);});
chrome.commands.onCommand.addListener(async (command: string) => {
  if (command !== 'explain-selection') return;
  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (tab) await run(tab);
});
chrome.contextMenus.onClicked.addListener((info: {menuItemId: string; frameId?: number}, tab?: {id?: number}) => {
  if (info.menuItemId === 'explain-selection' && tab) void run(tab, info.frameId ?? 0);
});
chrome.runtime.onInstalled.addListener(async (details: {reason: string}) => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id: 'explain-selection', title: '用 Context First 解释', contexts: ['selection']});
  if (details.reason === 'install') await chrome.runtime.openOptionsPage();
});
