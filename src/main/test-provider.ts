import type {AIProvider,Capture,ProviderOptions,ProviderContext,Explanation} from '../shared/types';
const pause=(signal:AbortSignal,ms=180)=>new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Aborted'));},{once:true});
});
export class TestProvider implements AIProvider {
  private attempts=new Map<string,number>();
  async explain(capture:Capture,options:ProviderOptions):Promise<Explanation>{
    const attempt=(this.attempts.get(capture.id)||0)+1;this.attempts.set(capture.id,attempt);
    await pause(options.signal,capture.selectedText==='slow'?1500:180);
    if(capture.selectedText==='retry'&&attempt===1)throw new Error('模拟连接暂时中断');
    return {meaning:capture.selectedText==='bank'?'河岸':'超出预定范围',sentenceTranslation:capture.context.sentenceRange?'我们坐在河岸上。'.repeat(capture.selectedText==='long'?20:1):null,contextNote:'这里的含义由原句中出现的 river 决定。'.repeat(capture.selectedText==='long'?20:1),limitations:[],provider:'test-fixture',model:null,generatedAt:new Date().toISOString()};
  }
  async discuss(_context:ProviderContext,options:ProviderOptions){await pause(options.signal);options.onDelta?.('结合原句，');await pause(options.signal);return '结合原句，这里的表达描述当前语境中的含义。';}
  dispose(){}
}
