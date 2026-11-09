import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CodexProvider,CodexRPC} from '../src/providers/codex';
import sample from '../schemas/examples/saved-entry.v0.1.json';
import type {Capture} from '../src/shared/types';

const SERVER = String.raw`
const readline=require('node:readline');let thread=0,turn=0;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params||{};
 const reply=r=>send({id:m.id,result:r});
 if(m.method==='initialize')reply({});
 else if(m.method==='config/read')reply({config:{features:{shell_tool:false,plugins:false,hooks:false},mcp_servers:{},plugins:{}}});
 else if(m.method==='account/read')reply({account:{type:'apiKey'},requiresOpenaiAuth:true});
 else if(m.method==='thread/start'){
   if(p.environments.length||p.sandbox!=='read-only'||p.approvalPolicy!=='never')return send({id:m.id,error:{message:'Unsafe thread config'}});
   reply({thread:{id:'thread'+(++thread)},model:'test-model'});
 }
 else if(m.method==='turn/interrupt'){reply({});send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}}});}
 else if(m.method==='turn/start'){
  const turnId='turn'+(++turn),threadId=p.threadId,text=p.input[0].text;
  reply({turn:{id:turnId}});send({method:'turn/started',params:{threadId,turn:{id:turnId}}});
  if(text.includes('SLOW'))return;
  if(text.includes('TOOL')){send({id:'approval1',method:'item/commandExecution/requestApproval',params:{threadId}});return;}
  const output=text.includes('INVALID')?'not json':p.outputSchema?JSON.stringify({meaning:'river bank',sentenceTranslation:'We sat by the river.',contextNote:'river specifies the meaning',limitations:[]}):'This is a follow-up answer.';
  setTimeout(()=>{
    send({method:'item/agentMessage/delta',params:{threadId,turnId,delta:output.slice(0,5)}});
    send({method:'item/agentMessage/delta',params:{threadId,turnId,delta:output.slice(5)}});
    send({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',text:output}}});
    send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:text.includes('FAILED')?'failed':'completed',error:text.includes('FAILED')?{message:'Simulated failure'}:null}}});
  },15);
 }
});
`;
async function fixture(t: any, timeoutMs=5000){
 const dir=await mkdtemp(path.join(tmpdir(),'context-first-provider-'));
 const fake=path.join(dir,'server.cjs');await writeFile(fake,SERVER);
 let launches=0;
 const provider=new CodexProvider({codexPath:process.execPath,model:'',cwd:dir,timeoutMs,
 rpcFactory:(_command,args,cwd,env)=>{
   launches++;
   assert(args.includes('features.shell_tool=false'));
   assert(args.includes('features.plugins=false'));
   assert(args.includes('features.hooks=false'));
   assert.equal(env.CODEX_THREAD_ID,undefined);
   return new CodexRPC(process.execPath,[fake],cwd,env);
 }});
 t.after(async()=>{provider.dispose();await new Promise(resolve=>setTimeout(resolve,50));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 return {provider,launches:()=>launches};
}
const capture=()=>structuredClone(sample.capture) as Capture;

test('Codex persistent transport validates explanation and streams a follow-up',async t=>{
 const f=await fixture(t),c=capture();
 const explanation=await f.provider.explain(c,{signal:new AbortController().signal});
 assert.equal(explanation.meaning,'river bank');assert.equal(explanation.model,'test-model');assert.equal(explanation.provider,'codex');
 let stream='';
 const reply=await f.provider.discuss({capture:c,explanation,conversation:[{id:'question',role:'user',text:'Why?',createdAt:new Date().toISOString()}]}, {signal:new AbortController().signal,onDelta:part=>{stream+=part;}});
 assert.equal(reply,'This is a follow-up answer.');assert.equal(stream,reply);assert.equal(f.launches(),1);
});
test('Codex invalid structured output is not accepted',async t=>{
 const f=await fixture(t),c=capture();c.selectedText='INVALID';
 await assert.rejects(f.provider.explain(c,{signal:new AbortController().signal}),/有效 JSON/);
});
test('Codex incomplete/failed turn is not accepted as success',async t=>{
 const f=await fixture(t),c=capture();c.selectedText='FAILED';
 await assert.rejects(f.provider.explain(c,{signal:new AbortController().signal}),/Simulated failure/);
});
test('Codex cancels in-flight turns and can handle a later request',async t=>{
 const f=await fixture(t),c=capture();c.selectedText='SLOW';
 const abort=new AbortController();const pending=f.provider.explain(c,{signal:abort.signal});
 setTimeout(()=>abort.abort(),100);
 await assert.rejects(pending,{name:'AbortError'});
 assert.equal((await f.provider.explain(capture(),{signal:new AbortController().signal})).meaning,'river bank');
});
test('Codex rejects tool approval requests',async t=>{
 const f=await fixture(t),c=capture();c.selectedText='TOOL';
 await assert.rejects(f.provider.explain(c,{signal:new AbortController().signal}),/操作/);
});
test('Codex request has a finite generation deadline',async t=>{
 const f=await fixture(t,100),c=capture();c.selectedText='SLOW';
 await assert.rejects(f.provider.explain(c,{signal:new AbortController().signal}),/超时/);
});
