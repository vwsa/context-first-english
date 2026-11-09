import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {discoverCodexPath} from '../src/providers/codex';

async function fixture(t: any) {
  const home=await mkdtemp(path.join(tmpdir(),'context-first-discovery-'));
  t.after(()=>rm(home,{recursive:true,force:true,maxRetries:5}));
  const env={PATH:'',LOCALAPPDATA:path.join(home,'local'),APPDATA:path.join(home,'roaming')};
  const options={home,env,platform:'win32' as const,arch:'x64',validate:async (_candidate:string)=>{}};
  const file=async (relative:string)=>{const target=path.join(home,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,'fixture');return target;};
  return {home,options,file};
}

test('finds desktop Codex without PATH configuration and rediscovers after an update',async t=>{
  const {options,file}=await fixture(t);
  const old=await file('local/OpenAI/Codex/bin/old/codex.exe');
  assert.equal(await discoverCodexPath(options),old);
  await rm(old);
  const next=await file('local/OpenAI/Codex/bin/new/codex.exe');
  assert.equal(await discoverCodexPath(options),next);
});

test('skips incompatible PATH Codex and finds compatible VS Code installation',async t=>{
  const {options,file}=await fixture(t);
  const old=await file('path/codex.exe');
  options.env.PATH=path.dirname(old);
  const next=await file('.vscode/extensions/openai.chatgpt-26.1/bin/windows-x86_64/codex.exe');
  const checked:string[]=[];
  assert.equal(await discoverCodexPath({...options,validate:async candidate=>{checked.push(candidate);if(candidate===old)throw new Error('old');}}),next);
  assert.deepEqual(checked,[old,next]);
});

test('finds native npm binary without executing a command shim',async t=>{
  const {options,file}=await fixture(t);
  const binary=await file('roaming/npm/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe');
  assert.equal(await discoverCodexPath(options),binary);
});

test('handles missing installations and reports unusable ones',async t=>{
  const {options,file}=await fixture(t);
  assert.equal(await discoverCodexPath(options),'');
  await file('local/OpenAI/Codex/bin/broken/codex.exe');
  await assert.rejects(discoverCodexPath({...options,validate:async()=>{throw new Error('broken');}}),/没有可用的兼容版本/);
});
