import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(extensionDir, '../..');
const candidates = [process.env.CONTEXT_FIRST_CODE, path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code/Code.exe'), 'C:/Program Files/Microsoft VS Code/Code.exe'].filter(Boolean);
let code;
for (const candidate of candidates) {try {await access(candidate); code = candidate; break;} catch {}}
if (!code) throw new Error('Set CONTEXT_FIRST_CODE to an installed VS Code executable.');
await access(path.join(extensionDir, 'dist/extension.cjs'));
await mkdir(path.join(repo, '.test-data'), {recursive: true});
const temporary = await mkdtemp(path.join(repo, '.test-data/vscode-capture-'));
const documentPath = path.join(temporary, 'reading.md'), output = path.join(temporary, 'result.json');
await writeFile(documentPath, '# Reading\n📘 We decided to break the ice.\nThe bank lent money. We sat on the bank of the river.\n');
const token = randomBytes(32).toString('hex'), captures = [];
let requestError;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/capture');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    let body = ''; for await (const chunk of request) body += chunk;
    captures.push(JSON.parse(body));
    response.writeHead(202, {'Content-Type': 'application/json'}).end('{"ok":true}');
  } catch (error) {requestError = error; response.writeHead(400).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
try {
  const child = spawn(code, [
    '--user-data-dir', path.join(temporary, 'user'), '--extensions-dir', path.join(temporary, 'installed-extensions'),
    '--extensionDevelopmentPath=' + extensionDir, '--extensionTestsPath=' + path.join(extensionDir, 'test-runner.cjs'),
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window',
  ], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
    CONTEXT_FIRST_TEST_TOKEN: token, CONTEXT_FIRST_TEST_PORT: String(port), CONTEXT_FIRST_TEST_DOCUMENT: documentPath, CONTEXT_FIRST_TEST_OUTPUT: output,
  }});
  let diagnostic = '';
  child.stdout.on('data', data => {diagnostic = (diagnostic + data).slice(-10000);});
  child.stderr.on('data', data => {diagnostic = (diagnostic + data).slice(-10000);});
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {child.kill(); reject(new Error('VS Code host test timed out. ' + diagnostic));}, 120000);
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('exit', status => {clearTimeout(timer); resolve(status);});
  });
  assert.equal(exitCode, 0, diagnostic);
  if (requestError) throw requestError;
  assert.equal(captures.length, 2);
  assert.equal(captures[0].selectedText, 'break the ice');
  assert.equal(captures[0].source.kind, 'vscode');
  assert.equal(captures[0].source.lineStart, 2);
  assert.equal(captures[0].source.lineEnd, 2);
  assert.equal(captures[1].selectedText, 'bank');
  for (const item of captures) {
    assert.equal(item.context.text.slice(item.context.selectionStart, item.context.selectionEnd), item.selectedText);
    assert.equal(item.capture, undefined);
  }
  const sentence = captures[1].context.sentenceRange;
  assert.equal(captures[1].context.text.slice(sentence.start, sentence.end), 'We sat on the bank of the river.');
  const result = JSON.parse(await readFile(output, 'utf8'));
  console.log('VS Code real extension host: ' + JSON.stringify(result) + '; authenticated HTTP captures verified.');
} finally {await new Promise(resolve => server.close(resolve));}
