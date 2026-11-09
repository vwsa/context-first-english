import {_electron as electron, chromium} from 'playwright';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runDir=path.join(root,'.test-data',`browser-desktop-${Date.now()}`);
const extension=path.join(root,'extensions/browser');
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browserPath=process.env.CONTEXT_FIRST_BROWSER || (existsSync(chromium.executablePath())?chromium.executablePath():existsSync(edge)?edge:undefined);
await fs.mkdir(runDir,{recursive:true});
await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const server=http.createServer((_request,response)=>{
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  response.end('<!doctype html><html><head><title>Context First extension integration fixture</title></head><body style="font:22px Georgia;max-width:700px;margin:100px auto;color:#28312b"><h1>A quiet afternoon</h1><p id="reading">We sat on the <span id="word">bank</span> of the river.</p><p>This page is a synthetic browser integration fixture.</p></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
// localhost is deliberately outside the extension's sole 127.0.0.1 host permission.
// Capturing this page therefore exercises the real activeTab user-gesture grant.
const articleUrl=`http://localhost:${server.address().port}/reading`;
const app=await electron.launch({
  chromiumSandbox:true,
  ...(process.env.CONTEXT_FIRST_ELECTRON?{executablePath:process.env.CONTEXT_FIRST_ELECTRON}:{}),
  args:[root,'--smoke-test'],
  env:{...process.env,CONTEXT_FIRST_TEST:'1',CONTEXT_FIRST_DATA:path.join(runDir,'desktop'),CONTEXT_FIRST_PORT:'0'},
});
let browser;
try{
  const desktop=await app.firstWindow();
  await desktop.getByRole('button',{name:'设置',exact:true}).waitFor();
  const connection=(await desktop.evaluate(()=>window.desktop.getState())).connection;
  browser=await chromium.launchPersistentContext(path.join(runDir,'browser'),{
    executablePath:browserPath,headless:false,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run'],
  });
  const worker=browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker',{timeout:15000});
  const extensionId=new URL(worker.url()).host;
  const options=await browser.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator('#token').fill(connection.token);
  await options.locator('#port').fill(String(connection.port));
  await options.getByRole('button',{name:'保存并检查连接'}).click();
  await options.getByText('已连接，可以开始选词。',{exact:true}).waitFor();
  const article=await browser.newPage();
  await article.goto(articleUrl);
  await article.bringToFront();
  await article.locator('#word').evaluate(element=>{
    const range=document.createRange();range.selectNodeContents(element);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  assert.equal(await article.evaluate(()=>getSelection().toString()),'bank');
  // CDP key events do not always reach browser-level extension commands. Manual
  // mode leaves the actual browser window ready for native Alt+Shift+D input.
  const nativeTrigger=process.env.CONTEXT_FIRST_MANUAL_TRIGGER==='1';
  if(nativeTrigger) console.log('READY: press native Alt+Shift+D in the isolated "Context First extension integration fixture" browser window.');
  else await article.keyboard.press('Alt+Shift+KeyD');
  try{
    await desktop.getByRole('heading',{name:'bank',exact:true}).waitFor({timeout:nativeTrigger?180000:15000});
  }catch(error){
    const diagnostic=await worker.evaluate(async()=>({
      commands:await chrome.commands.getAll(),lastError:(await chrome.storage.local.get('lastError')).lastError || null,
    }));
    throw new Error(`Browser capture did not reach the desktop: ${JSON.stringify(diagnostic)}`,{cause:error});
  }
  const current=(await desktop.evaluate(()=>window.desktop.getState())).session;
  assert.equal(current.capture.selectedText,'bank');
  assert.equal(current.capture.context.text,'We sat on the bank of the river.');
  assert.equal(current.capture.source.kind,'browser');
  assert.equal(current.capture.source.url,articleUrl);
  assert.equal(current.capture.source.title,'Context First extension integration fixture');
  assert.equal(current.capture.context.text.slice(current.capture.context.selectionStart,current.capture.context.selectionEnd),'bank');
  assert.deepEqual(current.capture.context.sentenceRange,{start:0,end:31});
  await desktop.getByText('河岸',{exact:true}).waitFor();
  await desktop.getByRole('button',{name:'收藏',exact:true}).click();
  await desktop.getByRole('button',{name:'取消收藏',exact:true}).waitFor();
  assert.equal((await desktop.evaluate(()=>window.desktop.getState())).library.length,1);
  const visible=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible());
  assert.equal(visible,true);
  await desktop.screenshot({path:path.join(root,'test-results/browser-desktop.png')});
  await article.screenshot({path:path.join(root,'test-results/browser-article.png')});
  console.log(JSON.stringify({platform:process.platform,browserVersion:browser.browser()?.version(),extensionLoaded:true,pairingUI:true,trigger:nativeTrigger?'external native browser action':'CDP Alt+Shift+D',activeTabOnNonHostPage:true,captureAndSource:true,visibleDesktop:true,save:true,ai:'explicit mock test mode'},null,2));
}finally{
  await browser?.close();await app.close();await new Promise(resolve=>server.close(resolve));
}
