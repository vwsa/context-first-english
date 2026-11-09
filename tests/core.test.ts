import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import example from '../schemas/examples/saved-entry.v0.1.json';
import browser from '../schemas/examples/browser.v0.1.json';
import linux from '../schemas/examples/vscode-linux.v0.1.json';
import selectedOnly from '../schemas/examples/selection-only.v0.1.json';
import {assertCapture, assertExplanation, assertSavedEntry} from '../src/core/validation';
import {Store, type Snapshot} from '../src/core/store';
import {SessionController} from '../src/core/session-controller';
import type {AIProvider, Capture, Explanation, ProviderContext, ProviderOptions, SavedEntry} from '../src/shared/types';

const entryFixture = (): SavedEntry => structuredClone(example) as SavedEntry;
const captureFixture = (): Capture => ({...entryFixture().capture, id: randomUUID()});
const explanationFixture = (): Explanation => entryFixture().explanation!;
const snapshot = (capture: Capture, explanation: Explanation | null = null): Snapshot => ({capture, explanation, conversation: []});
async function temp(t: test.TestContext): Promise<string> {
  const prefix = path.join(os.tmpdir(), 'context-first-core-');
  const dir = await fs.mkdtemp(prefix);
  t.after(async () => {
    assert(path.resolve(dir).startsWith(path.resolve(prefix)));
    await fs.rm(dir, {recursive: true, force: true});
  });
  return dir;
}
async function storeFor(t: test.TestContext): Promise<Store> {
  const store = new Store(await temp(t)); await store.init(); return store;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
class FakeProvider implements AIProvider {
  explanations: Array<ReturnType<typeof deferred<Explanation>> & {capture: Capture; options: ProviderOptions}> = [];
  discussions: Array<ReturnType<typeof deferred<string>> & {context: ProviderContext; options: ProviderOptions}> = [];
  disposed = false;
  explain(capture: Capture, options: ProviderOptions): Promise<Explanation> {
    const task = {...deferred<Explanation>(), capture, options}; this.explanations.push(task); return task.promise;
  }
  discuss(context: ProviderContext, options: ProviderOptions): Promise<string> {
    const task = {...deferred<string>(), context, options}; this.discussions.push(task); return task.promise;
  }
  dispose(): void {this.disposed = true;}
}
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) {if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5));}
  assert.fail('Timed out waiting for state');
}
async function harness(t: test.TestContext) {
  const prefix = path.join(os.tmpdir(), 'context-first-core-');
  const dir = await fs.mkdtemp(prefix);
  const store = new Store(dir), provider = new FakeProvider();
  await store.init();
  let changes = 0;
  const controller = new SessionController(provider, store, () => {changes++;});
  t.after(async () => {
    await controller.dispose();
    assert(path.resolve(dir).startsWith(path.resolve(prefix)));
    await fs.rm(dir, {recursive: true, force: true});
  });
  return {store, provider, controller, changes: () => changes};
}

test('schema fixtures satisfy structural and cross-field rules', () => {
  for (const entry of [example, browser, linux, selectedOnly]) assertSavedEntry(entry);
});

test('validation rejects UTF-16 splits, text drift, incorrect provenance and invented translations', () => {
  const split = structuredClone(linux) as SavedEntry;
  split.capture.context.selectionStart = 1;
  split.capture.context.selectionEnd = 2;
  split.capture.selectedText = split.capture.context.text.slice(1, 2);
  assert.throws(() => assertCapture(split.capture), /Unicode/);
  const capture = captureFixture(); capture.selectedText = 'banks';
  assert.throws(() => assertCapture(capture), /不一致/);
  const mixed = captureFixture(); mixed.source.url = 'https://example.org';
  assert.throws(() => assertCapture(mixed), /协议/);
  const noSentence = captureFixture(); noSentence.context.sentenceRange = null;
  assert.throws(() => assertExplanation(explanationFixture(), noSentence), /未捕获原句/);
  const duplicate = entryFixture(); duplicate.conversation[1].id = duplicate.conversation[0].id;
  assert.throws(() => assertSavedEntry(duplicate), /ID 重复/);
});

test('store persists early saves, adds explanation and discussion, and reloads unchanged', async t => {
  const store = await storeFor(t), capture = captureFixture();
  const first = await store.save(snapshot(capture));
  assert.equal(first.explanation, null);
  const completed = {...snapshot(capture, explanationFixture()), conversation: entryFixture().conversation};
  await store.updateIfSaved(completed);
  const second = store.list()[0];
  assert.equal(second.id, first.id); assert.equal(second.savedAt, first.savedAt);
  assert.deepEqual(second.conversation, completed.conversation);
  const reloaded = new Store(path.dirname(store.filePath)); await reloaded.init();
  assert.deepEqual(reloaded.export(), store.export());
  reloaded.list()[0].capture.selectedText = 'mutated';
  assert.equal(reloaded.list()[0].capture.selectedText, capture.selectedText);
});

test('store serializes duplicate saves by capture ID but keeps different encounters', async t => {
  const store = await storeFor(t), capture = captureFixture();
  const records = await Promise.all(Array.from({length: 8}, () => store.save(snapshot(capture))));
  assert.equal(new Set(records.map(item => item.id)).size, 1); assert.equal(store.list().length, 1);
  await store.save(snapshot({...capture, id: randomUUID()}));
  assert.equal(store.list().length, 2);
});

test('store never restores deleted captures on late updates and resaving gives a new entry ID', async t => {
  const store = await storeFor(t), capture = captureFixture();
  const first = await store.save(snapshot(capture));
  await Promise.all([store.remove(first.id), store.updateIfSaved(snapshot(capture, explanationFixture()))]);
  assert.deepEqual(store.list(), []);
  const next = await store.save(snapshot(capture));
  assert.notEqual(next.id, first.id);
});

test('stale snapshots cannot regress a completed explanation or conversation', async t => {
  const store = await storeFor(t), capture = captureFixture();
  const complete = {...snapshot(capture, explanationFixture()), conversation: entryFixture().conversation};
  await store.save(complete);
  await store.updateIfSaved(snapshot(capture));
  assert.deepEqual(store.list()[0].explanation, complete.explanation);
  assert.deepEqual(store.list()[0].conversation, complete.conversation);
  const changed = structuredClone(complete); changed.capture.source.title = 'different source';
  await assert.rejects(store.save(changed), /快照/);
});

test('invalid or future-version library is not overwritten and cannot be used for writes', async t => {
  const dir = await temp(t), target = path.join(dir, 'library.json');
  const future = entryFixture() as unknown as Record<string, unknown>; future.schemaVersion = '5.0';
  const bytes = JSON.stringify([future]); await fs.writeFile(target, bytes);
  const store = new Store(dir);
  await assert.rejects(store.init(), /原文件未被覆盖/);
  await assert.rejects(store.save(snapshot(captureFixture())), /未初始化/);
  assert.equal(await fs.readFile(target, 'utf8'), bytes);
});

test('failed atomic write leaves memory unchanged and later writes can recover', async t => {
  const store = await storeFor(t);
  await fs.mkdir(store.filePath);
  await assert.rejects(store.save(snapshot(captureFixture())));
  assert.deepEqual(store.list(), []);
  assert.deepEqual((await fs.readdir(path.dirname(store.filePath))).filter(name => name.endsWith('.tmp')), []);
  await fs.rmdir(store.filePath);
  await store.save(snapshot(captureFixture()));
  assert.equal(store.list().length, 1);
});

test('receive exposes original text immediately and ignores an old provider that disregards cancellation', async t => {
  const {store, provider, controller} = await harness(t);
  const first = captureFixture(), next = captureFixture();
  await controller.receive(first);
  assert.equal(controller.current?.status, 'loading');
  assert.equal(controller.current?.capture.selectedText, first.selectedText);
  await controller.toggleSave();
  await controller.receive(next);
  assert(provider.explanations[0].options.signal.aborted);
  provider.explanations[0].resolve(explanationFixture());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(controller.current?.capture.id, next.id);
  assert.equal(controller.current?.explanation, null);
  assert.equal(store.getByCapture(first.id)?.explanation, null);
  provider.explanations[1].resolve(explanationFixture());
  await waitFor(() => controller.current?.status === 'ready');
});

test('early bookmark updates after inference, while removing a bookmark blocks late resurrection', async t => {
  const {store, provider, controller} = await harness(t), capture = captureFixture();
  await controller.receive(capture); await controller.toggleSave();
  const firstId = store.list()[0].id;
  provider.explanations[0].resolve(explanationFixture());
  await waitFor(() => store.list()[0]?.explanation !== null);
  assert.equal(store.list()[0].id, firstId);
  const next = captureFixture();
  await controller.receive(next); await controller.toggleSave(); await controller.toggleSave();
  provider.explanations[1].resolve(explanationFixture());
  await waitFor(() => controller.current?.status === 'ready');
  assert.equal(store.getByCapture(next.id), undefined);
  assert.equal(controller.current?.saved, false);
});

test('rapid bookmark toggles are serialized', async t => {
  const {store, controller} = await harness(t);
  await controller.receive(captureFixture());
  await Promise.all([controller.toggleSave(), controller.toggleSave()]);
  assert.equal(store.list().length, 0); assert.equal(controller.current?.saved, false);
});

test('drafts and completed explanations survive switching away and reopening the capture', async t => {
  const {store, provider, controller} = await harness(t);
  const first = captureFixture(); await controller.receive(first);
  provider.explanations[0].resolve(explanationFixture());
  await waitFor(() => controller.current?.status === 'ready');
  controller.setDraft('这里为什么这样用？'); await controller.toggleSave();
  await controller.receive(captureFixture());
  await controller.openEntry(store.getByCapture(first.id)!.id);
  assert.equal(controller.current?.draft, '这里为什么这样用？');
  assert.equal(controller.current?.status, 'ready');
  assert.equal(provider.explanations.length, 2);
});

test('failed streamed discussion keeps only the question; retry reuses its ID and saves a complete reply', async t => {
  const {store, provider, controller} = await harness(t);
  await controller.receive(captureFixture()); provider.explanations[0].resolve(explanationFixture());
  await waitFor(() => controller.current?.status === 'ready'); await controller.toggleSave();
  await controller.discuss('为什么是河岸？');
  const questionId = controller.current!.conversation[0].id;
  provider.discussions[0].options.onDelta?.('incomplete');
  assert.equal(controller.current?.partialReply, 'incomplete');
  provider.discussions[0].reject(new Error('offline'));
  await waitFor(() => controller.current?.discussing === false);
  assert.equal(store.list()[0].conversation.length, 1);
  assert.equal(controller.current?.partialReply, '');
  await controller.discuss('', true);
  assert.equal(provider.discussions[1].context.conversation[0].id, questionId);
  provider.discussions[1].resolve('原文说明它是河的一部分。');
  await waitFor(() => store.list()[0].conversation.length === 2);
  assert.equal(store.list()[0].conversation[0].id, questionId);
  assert.equal(store.list()[0].conversation[1].role, 'assistant');
});

test('switching capture cancels discussion and ignores late text and final output', async t => {
  const {store, provider, controller} = await harness(t), first = captureFixture();
  await controller.receive(first); provider.explanations[0].resolve(explanationFixture());
  await waitFor(() => controller.current?.status === 'ready'); await controller.toggleSave();
  await controller.discuss('Why?'); const next = captureFixture(); await controller.receive(next);
  assert(provider.discussions[0].options.signal.aborted);
  provider.discussions[0].options.onDelta?.('stale'); provider.discussions[0].resolve('stale final');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(controller.current?.capture.id, next.id);
  assert.equal(controller.current?.partialReply, '');
  assert.equal(store.getByCapture(first.id)?.conversation.length, 1);
});
