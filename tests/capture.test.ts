import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapture, findSentenceRange, MAX_CONTEXT_LENGTH, MAX_SELECTION_LENGTH} from '../src/shared/capture';
import type {Capture} from '../src/shared/types';

const source: Capture['source'] = {kind: 'browser', title: 'Article', url: 'https://example.org/article', documentUri: null, languageId: null, lineStart: null, lineEnd: null};
function capture(text: string, word: string, occurrence = 0) {
  const start = text.indexOf(word, occurrence);
  return createCapture({text, selectionStart: start, selectionEnd: start + word.length, source});
}
test('keeps the selected occurrence and its sentence instead of the first matching word', () => {
  const text = 'The bank lent money. We sat on the bank of the river.';
  const item = capture(text, 'bank', 10);
  assert.equal(item.context.selectionStart, 35);
  const sentence = item.context.sentenceRange!;
  assert.equal(text.slice(sentence.start, sentence.end), 'We sat on the bank of the river.');
});
test('uses UTF-16 indices after emoji and retains exact original text', () => {
  const text = '📘 We decided to break the ice.';
  const item = capture(text, 'break the ice');
  assert.equal(item.context.text.slice(item.context.selectionStart, item.context.selectionEnd), 'break the ice');
  assert.equal(item.context.selectionStart, 17);
});
test('does not invent a sentence for a selection spanning sentences or a fragment', () => {
  assert.equal(findSentenceRange('First sentence. Second sentence.', 6, 22), null);
  assert.equal(findSentenceRange('bank', 0, 4), null);
  assert.equal(findSentenceRange('clipped words before the bank.', 25, 29, false), null);
  assert.equal(findSentenceRange('We met Dr.', 7, 10, true, false), null);
});
test('limits surrounding text while preserving selection and avoids split surrogates', () => {
  const text = '📘'.repeat(4000) + ' Selected expression. ' + '📘'.repeat(4000);
  const item = capture(text, 'Selected expression');
  assert(item.context.text.length <= MAX_CONTEXT_LENGTH);
  assert.equal(item.context.text.slice(item.context.selectionStart, item.context.selectionEnd), item.selectedText);
  assert(!/^[\uDC00-\uDFFF]/.test(item.context.text));
  assert(!/[\uD800-\uDBFF]$/.test(item.context.text));
});
test('rejects whitespace, broken UTF-16 selections, invalid bounds, and excessive selections', () => {
  assert.throws(() => createCapture({text: ' ', selectionStart: 0, selectionEnd: 1, source}));
  assert.throws(() => createCapture({text: '📘 hello', selectionStart: 1, selectionEnd: 2, source}));
  assert.throws(() => createCapture({text: 'bank', selectionStart: 1, selectionEnd: 9, source}));
  assert.throws(() => createCapture({text: 'a'.repeat(MAX_SELECTION_LENGTH + 1), selectionStart: 0, selectionEnd: MAX_SELECTION_LENGTH + 1, source}));
});
test('records only selection when it is the only available text', () => {
  const item = capture('bank', 'bank');
  assert.equal(item.context.coverage, 'selection-only');
  assert.equal(item.context.sentenceRange, null);
  assert.match(item.id, /^[0-9a-f-]{36}$/);
});
