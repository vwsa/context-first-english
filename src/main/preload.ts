import {contextBridge,ipcRenderer} from 'electron';
import type {AppAction,AppState,DesktopAPI} from '../shared/types';
const api:DesktopAPI={
  getState:()=>ipcRenderer.invoke('state'),
  action:(action:AppAction)=>ipcRenderer.invoke('action',action),
  onState:(listener:(state:AppState)=>void)=>{
    const handler=(_event:unknown,state:AppState)=>listener(state);
    ipcRenderer.on('state',handler);
    return ()=>ipcRenderer.removeListener('state',handler);
  },
};
contextBridge.exposeInMainWorld('desktop',api);
