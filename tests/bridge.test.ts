import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startBridge} from '../src/main/bridge';
import fixture from '../schemas/examples/saved-entry.v0.1.json';
import type {Capture} from '../src/shared/types';

test('bridge accepts only paired local requests and validated captures',async()=>{
  const captures:Capture[]=[];const bridge=await startBridge(0,'secret',c=>{captures.push(c);});
  const url=`http://127.0.0.1:${bridge.port}`;
  const post=(data:unknown,headers:Record<string,string>={})=>fetch(`${url}/capture`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer secret',...headers},body:JSON.stringify(data)});
  try{
    assert.equal((await fetch(`${url}/health`)).status,401);
    assert.equal((await post(fixture.capture,{Origin:'https://evil.example'})).status,403);
    assert.equal((await post(fixture.capture,{Authorization:'Bearer other'})).status,401);
    assert.equal((await post({...fixture.capture,selectedText:'incorrect'})).status,400);
    assert.equal((await post({...fixture.capture,extra:'no'})).status,400);
    assert.equal((await post({data:'x'.repeat(70000)})).status,413);
    assert.equal((await post(fixture.capture,{Origin:'chrome-extension://abcdefghijklmnop'})).status,202);
    assert.equal(captures.length,1);assert.equal(captures[0].selectedText,'bank');
  }finally{await bridge.close();}
});
