import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const directory = path.dirname(fileURLToPath(import.meta.url));
const compiled = await build({entryPoints: [path.join(directory, 'src/collector.ts')], bundle: true, format: 'esm', write: false, target: 'es2022'});
const {collectPageSelection} = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({headless: true, ...(process.env.CONTEXT_FIRST_BROWSER ? {executablePath: process.env.CONTEXT_FIRST_BROWSER} : existsSync(edge) ? {executablePath: edge} : {})});
const page = await browser.newPage();
async function select(selector, start, end) {
  await page.evaluate(({selector, start, end}) => {
    const text = document.querySelector(selector).firstChild;
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, {selector, start, end});
}
try {
  await page.setContent('<title>Reading fixture</title><p>📘 We sat on the <em>bank</em> of the river, near another bank.</p>');
  await select('em', 0, 4);
  let item = await page.evaluate(collectPageSelection);
  assert.equal(item.text, '📘 We sat on the bank of the river, near another bank.');
  assert.equal(item.text.slice(item.selectionStart, item.selectionEnd), 'bank');
  assert.equal(item.selectionStart, 17);
  assert.equal(item.title, 'Reading fixture');
  await page.setContent('<p id="first">First paragraph.</p><p id="second">Second paragraph.</p>');
  await page.evaluate(() => {
    const range = document.createRange(); range.setStart(document.querySelector('#first').firstChild, 6); range.setEnd(document.querySelector('#second').firstChild, 6);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  item = await page.evaluate(collectPageSelection);
  assert.equal(item.selectionStart, 0);
  assert.equal(item.selectionEnd, item.text.length);
  assert.equal(item.startsAtBoundary, false);
  await page.setContent('<p>Visible <span hidden>SECRET</span><em>word</em>.</p>');
  await select('em', 0, 4);
  item = await page.evaluate(collectPageSelection);
  assert.equal(item.text, 'word');
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('p'));
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  item = await page.evaluate(collectPageSelection);
  assert.equal(item.text, 'Visible word.');
  assert(!item.text.includes('SECRET'));
  await page.setContent('<p>Visible <span style="display:none"><b>SECRET</b></span><em>word</em>.</p>');
  await select('em', 0, 4);
  item = await page.evaluate(collectPageSelection);
  assert.equal(item.text, 'word');
  await page.setContent('<p>' + 'x'.repeat(25000) + '<em>word</em></p>');
  await select('em', 0, 4);
  item = await page.evaluate(collectPageSelection);
  assert.equal(item.text, 'word');
  await page.setContent('<p id="text">Read this word.</p><input type="password" value="sensitive">');
  await select('#text', 10, 14);
  await page.locator('input').focus();
  item = await page.evaluate(collectPageSelection);
  assert('error' in item);
  await page.setContent('<div contenteditable="true">Editable text.</div>');
  await page.locator('div').focus(); await select('div', 0, 8);
  item = await page.evaluate(collectPageSelection);
  assert('error' in item);
  console.log('Browser DOM capture: 8 cases passed (inline nodes/emoji, cross-block, hidden context, hidden selection, inherited hidden content, large block, password, editable content).');
} finally {await browser.close();}
