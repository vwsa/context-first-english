import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dispatchCaptureAction} from '../src/main/capture-actions';
import {SessionController} from '../src/core/session-controller';
import {Store} from '../src/core/store';
import fixture from '../schemas/examples/saved-entry.v0.1.json';
import type {AIProvider, AppAction, Capture, Explanation, ProviderContext, ProviderOptions} from '../src/shared/types';

class PendingProvider implements AIProvider {
  requests: Array<{signal: AbortSignal; resolve: (explanation: Explanation) => void}> = [];
  discussions: ProviderContext[] = [];
  explain(_capture: Capture, options: ProviderOptions): Promise<Explanation> {
    return new Promise(resolve => {this.requests.push({signal: options.signal, resolve});});
  }
  async discuss(context: ProviderContext): Promise<string> {this.discussions.push(context); return '这是当前原句中的用法。';}
  dispose(): void {}
}
async function setup(t: test.TestContext) {
  const prefix = path.join(os.tmpdir(), 'context-first-actions-');
  const dir = await fs.mkdtemp(prefix);
  const store = new Store(dir); await store.init();
  const provider = new PendingProvider();
  const controller = new SessionController(provider, store, () => {});
  let sourceOpens = 0;
  const dispatch = (action: AppAction) => dispatchCaptureAction(action, controller, async () => {sourceOpens++;});
  t.after(async () => {
    await controller.dispose();
    assert(path.resolve(dir).startsWith(path.resolve(prefix)));
    await fs.rm(dir, {recursive: true, force: true});
  });
  return {store, provider, controller, dispatch, sourceOpens: () => sourceOpens};
}
const capture = (): Capture => ({...structuredClone(fixture.capture) as Capture, id: randomUUID()});
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5));}
  assert.fail('Timed out waiting for state');
}

test('capture B cannot receive delayed actions from a renderer still displaying A', async t => {
  const {store, provider, controller, dispatch, sourceOpens} = await setup(t);
  const a = capture(), b = capture();
  await controller.receive(a);
  await dispatch({type: 'draft', captureId: a.id, text: 'A 的草稿'});
  await controller.receive(b);

  assert.equal(await dispatch({type: 'draft', captureId: a.id, text: '迟到的 A 输入'}), true);
  assert.equal(await dispatch({type: 'cancel', captureId: a.id}), true);
  assert.equal(controller.current?.draft, '');
  assert.equal(provider.requests[1].signal.aborted, false);

  const staleActions: AppAction[] = [
    {type: 'toggle-save', captureId: a.id},
    {type: 'discuss', captureId: a.id, text: '关于 A 的追问'},
    {type: 'discuss', captureId: a.id, text: '', retry: true},
    {type: 'retry', captureId: a.id},
    {type: 'open-source', captureId: a.id},
  ];
  for (const action of staleActions) await assert.rejects(dispatch(action), /表达已切换/);
  assert.deepEqual(store.list(), []);
  assert.deepEqual(controller.current?.conversation, []);
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.discussions.length, 0);
  assert.equal(sourceOpens(), 0);

  await controller.receive(a);
  assert.equal(controller.current?.draft, 'A 的草稿');
});

test('matching capture actions still edit, save, discuss and open their own source', async t => {
  const {store, provider, controller, dispatch, sourceOpens} = await setup(t);
  const a = capture(); await controller.receive(a);
  await dispatch({type: 'draft', captureId: a.id, text: '为什么？'});
  assert.equal(controller.current?.draft, '为什么？');
  await dispatch({type: 'toggle-save', captureId: a.id});
  assert.equal(store.list()[0].capture.id, a.id);
  provider.requests[0].resolve(structuredClone(fixture.explanation) as Explanation);
  await waitFor(() => controller.current?.status === 'ready');
  await dispatch({type: 'discuss', captureId: a.id, text: '为什么？'});
  await waitFor(() => store.list()[0].conversation.length === 2);
  assert.equal(provider.discussions[0].capture.id, a.id);
  await dispatch({type: 'open-source', captureId: a.id});
  assert.equal(sourceOpens(), 1);
});

test('missing capture IDs fail closed, while global actions bypass the capture dispatcher', async t => {
  const {dispatch} = await setup(t);
  for (const type of ['retry', 'cancel', 'toggle-save', 'draft', 'discuss', 'open-source']) {
    await assert.rejects(dispatch({type, text: 'question'} as AppAction), /缺少原文标识/);
  }
  for (const action of [{type: 'close'}, {type: 'export'}, {type: 'resize', height: 450},
    {type: 'settings', settings: {codexPath: '', model: ''}}] as AppAction[]) {
    assert.equal(await dispatch(action), false);
  }
});
