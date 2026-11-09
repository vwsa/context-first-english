import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.join(root,'.test-data',`live-desktop-${process.platform}-${Date.now()}`);
await fs.mkdir(dataDir,{recursive:true});await fs.mkdir(path.join(root,'test-results'),{recursive:true});
const options={chromiumSandbox:true,args:[root,'--isolated-profile'],env:{...process.env,CONTEXT_FIRST_DATA:dataDir,CONTEXT_FIRST_PORT:'0'}};
const autoDiscovery=process.env.CONTEXT_FIRST_AUTO_DISCOVERY==='1';
if(autoDiscovery) {
  assert.equal(process.env.CONTEXT_FIRST_CODEX || '', '', 'Automatic test must not supply a Codex path');
  // Reproduce a desktop launch without Codex on PATH, using the existing user login.
  options.env.PATH=process.platform==='win32'?path.join(process.env.SystemRoot || 'C:\\Windows','System32'):'/usr/bin:/bin';
}
if(process.env.CONTEXT_FIRST_ELECTRON)options.executablePath=process.env.CONTEXT_FIRST_ELECTRON;
let app=await electron.launch(options);
async function until(page,predicate,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const state=await page.evaluate(()=>window.desktop.getState());if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Timed out waiting for app state');}
try{
  let page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).waitFor();
  if(process.env.CONTEXT_FIRST_CODEX)await page.evaluate(codexPath=>window.desktop.action({type:'settings',settings:{codexPath,model:''}}),process.env.CONTEXT_FIRST_CODEX);
  const state=await page.evaluate(()=>window.desktop.getState());
  if(autoDiscovery)assert.deepEqual(state.settings,{codexPath:'',model:''});
  const capture=JSON.parse(await fs.readFile(path.join(root,'schemas/examples/saved-entry.v0.1.json'),'utf8')).capture;capture.id=randomUUID();
  const started=Date.now();const response=await fetch(`http://127.0.0.1:${state.connection.port}/capture`,{method:'POST',headers:{Authorization:`Bearer ${state.connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(capture)});
  assert.equal(response.status,202);
  await page.getByRole('heading',{name:'bank',exact:true}).waitFor();
  const visibleMs=Date.now()-started;
  await page.getByRole('button',{name:'收藏',exact:true}).click();
  const ready=await until(page,s=>s.session?.status==='ready'||s.session?.status==='error');assert.equal(ready.session.status,'ready',ready.session.error||'Inference failed');assert.equal(ready.session.explanation.provider,'codex');
  const explanationMs=Date.now()-started;
  await until(page,s=>!!s.library[0]?.explanation);
  await page.waitForFunction(()=>{const main=document.querySelector('main');return main.scrollHeight<=main.clientHeight+1;});
  await page.waitForTimeout(200); // Let the native resize repaint before capturing its screenshot.
  await page.screenshot({path:path.join(root,`test-results/desktop-${process.platform}-live.png`)});
  await app.close();app=await electron.launch(options);page=await app.firstWindow();await page.getByRole('button',{name:'查看收藏'}).click();await page.locator('.entry>button').first().click();await page.getByRole('heading',{name:'bank',exact:true}).waitFor();
  const reopened=await page.evaluate(()=>window.desktop.getState());assert.deepEqual(reopened.session.explanation,ready.session.explanation);
  if(autoDiscovery)assert.deepEqual(reopened.settings,{codexPath:'',model:''});
  const report={platform:process.platform,provider:ready.session.explanation.provider,model:ready.session.explanation.model,captureVisibleMs:visibleMs,completeExplanationMs:explanationMs,earlySaveAndRestart:true,autoDiscovery};
  await fs.writeFile(path.join(root,`test-results/live-${process.platform}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await app.close();}
