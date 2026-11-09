import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import savedSchema from '../../schemas/saved-entry.v0.1.schema.json';
import resultSchema from '../../schemas/explanation-result.v0.1.schema.json';
import type {Capture, Explanation, ExplanationResult, Message, SavedEntry} from '../shared/types';

const ajv = new Ajv2020({allErrors: true, strict: true, validateFormats: true});
addFormats(ajv);
ajv.addSchema(resultSchema);
ajv.addSchema(savedSchema);
const captureValidator = ajv.compile({$ref: `${savedSchema.$id}#/$defs/capture`});
const explanationValidator = ajv.compile({$ref: `${savedSchema.$id}#/$defs/explanation`});
const messageValidator = ajv.compile({$ref: `${savedSchema.$id}#/$defs/message`});
const resultValidator = ajv.getSchema(resultSchema.$id)!;
const savedValidator = ajv.getSchema(savedSchema.$id)!;

export class ValidationError extends Error {
  constructor(message: string) {super(message); this.name = 'ValidationError';}
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}
function isBoundary(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
function assertRange(text: string, start: number, end: number, label: string): void {
  check(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length,
    `${label}超出原文范围`);
  check(isBoundary(text, start) && isBoundary(text, end), `${label}截断了 Unicode 字符`);
}

export function assertCapture(value: unknown): asserts value is Capture {
  check(captureValidator(value), '捕获数据不符合 v0.1 协议');
  const capture = value as Capture;
  check(capture.selectedText.length <= 2000, '选中文本过长，请缩小选区');
  const context = capture.context;
  check(context.text.length <= 16000, '上下文过长，请缩小文本范围');
  assertRange(context.text, context.selectionStart, context.selectionEnd, '选区');
  check(context.text.slice(context.selectionStart, context.selectionEnd) === capture.selectedText, '选区与原文不一致');
  if (context.coverage === 'selection-only') {
    check(context.selectionStart === 0 && context.selectionEnd === context.text.length, '仅选词模式必须覆盖全部捕获文本');
  } else {
    check(context.selectionStart > 0 || context.selectionEnd < context.text.length, '上下文片段必须包含选区之外的文本');
  }
  if (context.sentenceRange) {
    const {start, end} = context.sentenceRange;
    assertRange(context.text, start, end, '原句');
    check(start <= context.selectionStart && end >= context.selectionEnd, '原句必须包含选区');
  }
  const source = capture.source;
  if (source.lineStart !== null && source.lineEnd !== null) check(source.lineEnd >= source.lineStart, '来源行号顺序错误');
  for (const text of [source.title, source.url, source.documentUri, source.languageId]) {
    check(text === null || text.length <= 8192, '来源信息过长');
  }
}

export function assertExplanationResult(value: unknown, capture?: Capture): asserts value is ExplanationResult {
  check(resultValidator(value), 'AI 解释格式不正确，请重试');
  const result = value as ExplanationResult;
  for (const text of [result.meaning, result.sentenceTranslation, result.contextNote, ...result.limitations]) {
    check(text === null || text.length <= 20000, 'AI 返回内容过长');
  }
  check(result.limitations.length <= 100, 'AI 返回的限制说明过多');
  if (capture && capture.context.sentenceRange === null) {
    check(result.sentenceTranslation === null, '未捕获原句，不能保存整句翻译');
  }
}

export function assertExplanation(value: unknown, capture?: Capture): asserts value is Explanation {
  check(explanationValidator(value), 'AI 解释元数据不正确');
  const explanation = value as Explanation;
  assertExplanationResult({meaning: explanation.meaning, sentenceTranslation: explanation.sentenceTranslation,
    contextNote: explanation.contextNote, limitations: explanation.limitations}, capture);
}

export function assertConversation(value: unknown): asserts value is Message[] {
  check(Array.isArray(value), '讨论记录格式不正确');
  const ids = new Set<string>();
  for (const item of value) {
    check(messageValidator(item), '讨论消息格式不正确');
    const message = item as Message;
    check(message.text.length <= 20000, '讨论消息过长');
    check(!ids.has(message.id), '讨论消息 ID 重复');
    ids.add(message.id);
  }
}

export function assertSavedEntry(value: unknown): asserts value is SavedEntry {
  check(savedValidator(value), '收藏数据不符合 v0.1 协议');
  const entry = value as SavedEntry;
  assertCapture(entry.capture);
  if (entry.explanation !== null) assertExplanation(entry.explanation, entry.capture);
  assertConversation(entry.conversation);
  check(Date.parse(entry.updatedAt) >= Date.parse(entry.savedAt), '收藏更新时间早于保存时间');
}
