import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';

async function worker(settings: Record<string, unknown>) {
  const output = await build({entryPoints: ['extensions/browser/src/background.ts'], bundle: true, format: 'iife', platform: 'browser', write: false, target: 'chrome120'});
  let click: ((tab: {id: number}) => void) | undefined;
  let injected = 0, optionsOpened = 0;
  let resolveTitle!: (title: string) => void;
  const completed = new Promise<string>(resolve => {resolveTitle = resolve;});
  const storage = {...settings};
  const chrome = {
    storage: {local: {get: async () => storage, set: async (values: object) => Object.assign(storage, values)}},
    scripting: {executeScript: async (options: {target: {tabId: number; frameIds: number[]}}) => {
      assert.equal(options.target.tabId, 42); assert.deepEqual(Array.from(options.target.frameIds), [0]); injected++;
      return [{result: {text: 'The bank approved my loan.', selectionStart: 4, selectionEnd: 8, title: 'Reading', url: 'https://example.org/', startsAtBoundary: true, endsAtBoundary: true}}];
    }},
    runtime: {openOptionsPage: async () => {optionsOpened++;}, onInstalled: {addListener() {}}},
    action: {
      onClicked: {addListener(fn: typeof click) {click = fn;}},
      setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
      setTitle: async ({title}: {title: string}) => {resolveTitle(title);},
    },
    commands: {onCommand: {addListener() {}}}, contextMenus: {onClicked: {addListener() {}}},
  };
  runInNewContext(output.outputFiles[0].text, {chrome, fetch, AbortSignal, crypto: webcrypto, Intl});
  return {click: () => click!({id: 42}), completed, storage, injected: () => injected, optionsOpened: () => optionsOpened};
}

test('browser worker forwards an actual authenticated HTTP request with exact capture', async () => {
  let received: any;
  const token = 'test-token-with-sufficient-entropy-for-fixture';
  const server = createServer(async (request, response) => {
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/capture');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    let body = ''; for await (const chunk of request) body += chunk;
    received = JSON.parse(body); response.writeHead(202).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as {port: number};
    const instance = await worker({token, port: address.port, lastError: 'previous failure'});
    instance.click();
    const title = await instance.completed;
    assert.match(title, /已在 Context First/);
    assert.equal(received.selectedText, 'bank');
    assert.equal(received.capture, undefined);
    assert.equal(received.source.url, 'https://example.org/');
    assert.equal(received.context.selectionStart, 4);
    assert.equal(instance.storage.lastError, '');
  } finally {await new Promise<void>(resolve => server.close(() => resolve()));}
});

test('missing pairing never injects a collector or sends content', async () => {
  const instance = await worker({}); instance.click();
  assert.match(await instance.completed, /先在扩展设置/);
  assert.equal(instance.injected(), 0);
  assert.equal(instance.optionsOpened(), 1);
});
