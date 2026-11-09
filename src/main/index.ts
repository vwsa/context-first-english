import {app,BrowserWindow,ipcMain,screen,shell,dialog,Menu,Tray,nativeImage,clipboard} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store} from '../core/store';
import {SessionController} from '../core/session-controller';
import {CodexProvider} from '../providers/codex';
import {TestProvider} from './test-provider';
import {startBridge} from './bridge';
import {dispatchCaptureAction} from './capture-actions';
import type {AppAction,AppState,Settings,AIProvider} from '../shared/types';
import sample from '../../schemas/examples/saved-entry.v0.1.json';

const testMode=process.argv.includes('--smoke-test') && process.env.CONTEXT_FIRST_TEST==='1';
const isolatedProfile=process.argv.includes('--isolated-profile')&&!!process.env.CONTEXT_FIRST_DATA;
if((testMode||isolatedProfile) && process.env.CONTEXT_FIRST_DATA)app.setPath('userData',path.resolve(process.env.CONTEXT_FIRST_DATA));
const hasLock=app.requestSingleInstanceLock();
if(!hasLock)app.quit();
let win:BrowserWindow;let tray:Tray;let controller:SessionController;let store:Store;
let settings:Settings={codexPath:'',model:''};let token='';let bridge:Awaited<ReturnType<typeof startBridge>>;
let notice:string|null=null;let quitting=false;
let settingsWrites:Promise<void>=Promise.resolve();
const dataDir=app.getPath('userData');
async function saveConfig(next:Settings){
  const target=path.join(dataDir,'settings.json');const temporary=target+`.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,JSON.stringify({settings:next,token},null,2),{mode:0o600});
  try{await fs.rename(temporary,target);}catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
}
function state():AppState{return {session:controller?.current||null,library:store?.list()||[],settings,connection:{port:bridge?.port||37719,token},notice};}
function broadcast(){if(win&&!win.isDestroyed())win.webContents.send('state',state());}
function provider():AIProvider{return testMode?new TestProvider():new CodexProvider({codexPath:settings.codexPath,model:settings.model,cwd:path.join(dataDir,'ai-workspace')});}
function showPanel(nearPointer=false){
  if(!win)return;
  const wayland=process.platform==='linux'&&!!process.env.WAYLAND_DISPLAY;
  if(nearPointer&&!wayland){const cursor=screen.getCursorScreenPoint();const bounds=screen.getDisplayNearestPoint(cursor).workArea;const [oldWidth,oldHeight]=win.getSize();const w=Math.min(oldWidth,bounds.width),h=Math.min(oldHeight,bounds.height);win.setMinimumSize(Math.min(350,bounds.width),Math.min(360,bounds.height));win.setSize(w,h);win.setPosition(Math.round(Math.max(bounds.x,Math.min(cursor.x+16,bounds.x+bounds.width-w))),Math.round(Math.max(bounds.y,Math.min(cursor.y+20,bounds.y+bounds.height-h))));}
  if(win.isMinimized())win.restore();
  if(nearPointer)win.showInactive();else {win.show();win.focus();}
}
async function openSource(){
  const source=controller.current?.capture.source;if(!source)return;
  if(source.kind==='browser'&&source.url){const url=new URL(source.url);if(['http:','https:'].includes(url.protocol))await shell.openExternal(url.href);return;}
  if(source.documentUri?.startsWith('file:')){
    const file=fileURLToPath(source.documentUri).replace(/\\/g,'/');
    const target=new URL('vscode://file/');target.pathname=`/${file.replace(/^\//,'').replace(/%/g,'%25')}${source.lineStart?`:${source.lineStart}`:''}`;
    await shell.openExternal(target.href);return;
  }
  throw new Error('这个来源暂时无法直接打开，可在原应用中查看。');
}
async function handleAction(action:AppAction|{type:'copy-token'}){
  if(!action||typeof action.type!=='string')throw new Error('无效操作');
  if(await dispatchCaptureAction(action,controller,openSource))return;
  switch(action.type){
    case 'open-entry':await controller.openEntry(action.id);showPanel();break;
    case 'delete-entry':await controller.deleteEntry(action.id);break;
    case 'settings':{
      if(typeof action.settings?.codexPath!=='string'||typeof action.settings?.model!=='string'||action.settings.codexPath.length>2048||action.settings.model.length>256)throw new Error('无效设置');
      const next={codexPath:action.settings.codexPath.trim(),model:action.settings.model.trim()};
      const task=settingsWrites.then(async()=>{await saveConfig(next);settings=next;await controller.setProvider(provider());notice='设置已保存';broadcast();});
      settingsWrites=task.catch(()=>{});await task;break;
    }
    case 'export':{
      const result=await dialog.showSaveDialog(win,{title:'导出收藏',defaultPath:'context-first-collection.json',filters:[{name:'JSON',extensions:['json']}]});
      if(!result.canceled&&result.filePath){await fs.writeFile(result.filePath,JSON.stringify(store.export(),null,2),'utf8');notice='收藏已导出';broadcast();}break;
    }
    case 'close':win.hide();break;
    case 'resize':{
      if(!Number.isFinite(action.height)||action.height<1||action.height>100000)break;
      const wayland=process.platform==='linux'&&!!process.env.WAYLAND_DISPLAY;
      const bounds=win.getBounds(),area=(wayland?screen.getPrimaryDisplay():screen.getDisplayMatching(bounds)).workArea;
      const height=Math.max(Math.min(300,area.height),Math.min(Math.ceil(action.height),area.height,800));
      win.setMinimumSize(Math.min(350,area.width),Math.min(300,area.height));
      if(height!==bounds.height)win.setSize(bounds.width,height);
      if(!wayland&&bounds.y+height>area.y+area.height)win.setPosition(bounds.x,Math.max(area.y,area.y+area.height-height));
      break;
    }
    case 'copy-token':clipboard.writeText(token);break;
    case 'example':{
      const capture=structuredClone(sample.capture) as import('../shared/types').Capture;
      capture.id=randomUUID();capture.capturedAt=new Date().toISOString();capture.source.documentUri=null;capture.source.title='示例原句';
      await controller.receive(capture);break;
    }
    default:throw new Error('未知操作');
  }
}
async function start(){
  await fs.mkdir(dataDir,{recursive:true});await fs.mkdir(path.join(dataDir,'ai-workspace'),{recursive:true});
  try{const config=JSON.parse(await fs.readFile(path.join(dataDir,'settings.json'),'utf8'));if(!config.settings||typeof config.settings.codexPath!=='string'||typeof config.settings.model!=='string'||!/^[a-f0-9]{64}$/.test(config.token))throw new Error('配置格式无效');settings=config.settings;token=config.token;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;token=randomBytes(32).toString('hex');await fs.writeFile(path.join(dataDir,'settings.json'),JSON.stringify({settings,token},null,2),{mode:0o600});}
  store=new Store(dataDir);await store.init();controller=new SessionController(provider(),store,broadcast);
  if(testMode)notice='测试模式 · 使用模拟解释';
  try{bridge=await startBridge(testMode||isolatedProfile?Number(process.env.CONTEXT_FIRST_PORT||0):37719,token,async capture=>{await controller.receive(capture);showPanel(true);});}
  catch(error){notice=`采集连接未启动：${error instanceof Error?error.message:String(error)}`;}
  const area=screen.getPrimaryDisplay().workArea;
  win=new BrowserWindow({width:470,height:Math.min(680,area.height),minWidth:350,minHeight:360,show:false,frame:false,backgroundColor:'#fafaf8',autoHideMenuBar:true,alwaysOnTop:!(process.platform==='linux'&&process.env.WAYLAND_DISPLAY),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  const validSender=(event:Electron.IpcMainInvokeEvent)=>event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame;
  ipcMain.handle('state',event=>{if(!validSender(event))throw new Error('Unknown sender');return state();});
  ipcMain.handle('action',async(event,action)=>{if(!validSender(event))throw new Error('Unknown sender');return handleAction(action);});
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  await win.loadFile(path.join(__dirname,'index.html'));showPanel();
  const bitmap=Buffer.alloc(20*20*4);for(let y=0;y<20;y++)for(let x=0;x<20;x++){
    const i=(y*20+x)*4;const letter=(x>=5&&x<=7&&y>=5&&y<=14)||(x>=7&&x<=14&&(y===4||y===5||y===14||y===15));
    bitmap[i]=letter?248:93;bitmap[i+1]=letter?250:117;bitmap[i+2]=letter?250:82;bitmap[i+3]=(x<2||x>17)&&(y<2||y>17)?0:255;
  }
  tray=new Tray(nativeImage.createFromBitmap(bitmap,{width:20,height:20}));
  tray.setToolTip('Context First');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Context First',click:()=>showPanel()},{label:'退出',click:()=>app.quit()}]));tray.on('click',()=>showPanel());
}
app.on('second-instance',()=>showPanel());app.on('activate',()=>showPanel());
app.on('window-all-closed',()=>{});
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;
  void Promise.allSettled([settingsWrites,bridge?.close(),controller?.dispose()]).finally(()=>app.exit(0));
});
if(hasLock)app.whenReady().then(start).catch(error=>{console.error(error);dialog.showErrorBox('Context First 启动失败',error instanceof Error?error.message:String(error));app.quit();});
