import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import type {Capture} from '../shared/types';
import {assertCapture} from '../core/validation';

export async function startBridge(port:number, token:string, onCapture:(capture:Capture)=>void|Promise<void>) {
  const secret=Buffer.from(`Bearer ${token}`);
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    const reply=(status:number,body:unknown)=>{res.writeHead(status);res.end(JSON.stringify(body));};
    const auth=Buffer.from(req.headers.authorization||'');
    const origin=req.headers.origin;
    if(req.headers.host!==`127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}` ||
       (origin && !/^(chrome-extension|moz-extension):\/\/[a-z0-9-]+$/.test(origin))) {reply(403,{error:'不允许此来源连接'}); return;}
    if(auth.length!==secret.length || !timingSafeEqual(auth,secret)){reply(401,{error:'请检查配对码'});return;}
    if(req.method==='GET' && req.url==='/health'){reply(200,{ok:true,name:'Context First',version:'0.1.0'});return;}
    if(req.method!=='POST'||req.url!=='/capture'){reply(404,{error:'Not found'});return;}
    if(!req.headers['content-type']?.startsWith('application/json')){reply(415,{error:'需要 JSON'});return;}
    let size=0; const chunks:Buffer[]=[];
    try{
      for await(const chunk of req){size+=chunk.length;if(size>65536){reply(413,{error:'所选文本过长'});return;}chunks.push(chunk);}
      const capture=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assertCapture(capture);
      await onCapture(capture);
      reply(202,{ok:true,captureId:capture.id});
    }catch(error){if(!res.headersSent)reply(400,{error:error instanceof Error?error.message:'无效的选区'});}
  });
  server.requestTimeout=10000; server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {port:(server.address() as import('node:net').AddressInfo).port,close:()=>new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();})};
}
