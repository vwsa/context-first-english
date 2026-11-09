import type {Capture} from './types';

export const MAX_SELECTION_LENGTH = 2_000;
export const MAX_CONTEXT_LENGTH = 6_000;
export interface CaptureInput {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  source: Capture['source'];
  startsAtBoundary?: boolean;
  endsAtBoundary?: boolean;
  id?: string;
  capturedAt?: string;
}

function safeBoundary(text: string, offset: number): boolean {
  const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}

/** Offsets refer to immutable source text, in UTF-16 code units. */
export function findSentenceRange(
  text: string, selectionStart: number, selectionEnd: number,
  startsAtBoundary = true, endsAtBoundary = true,
): {start: number; end: number} | null {
  if (typeof Intl.Segmenter !== 'function') return null;
  const segments = new Intl.Segmenter('en', {granularity: 'sentence'}).segment(text);
  for (const part of segments) {
    let start = part.index, end = start + part.segment.length;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start > selectionStart || end < selectionEnd) continue;
    if (!startsAtBoundary && part.index === 0) return null;
    // Segmenter also returns isolated fragments as segments. A visible terminator
    // is required before we promise a complete original sentence to the model.
    if (!/[.!?。！？]["'”’\])}]*$/.test(text.slice(start, end))) return null;
    // At a clipped right edge even a period may be an unfinished abbreviation.
    if (!endsAtBoundary && end === text.trimEnd().length) return null;
    return {start, end};
  }
  return null;
}

export function createCapture(input: CaptureInput): Capture {
  const {text, selectionStart: start, selectionEnd: end} = input;
  if (typeof text !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
    throw new Error('选区位置无效，请重新选择文本。');
  }
  if (!safeBoundary(text, start) || !safeBoundary(text, end)) throw new Error('选区截断了字符，请重新选择文本。');
  const selectedText = text.slice(start, end);
  if (!selectedText.trim()) throw new Error('请先选中要解释的词或短语。');
  if (selectedText.length > MAX_SELECTION_LENGTH) throw new Error('选中文字过长，请缩小到 2000 个字符以内。');
  const spare = MAX_CONTEXT_LENGTH - selectedText.length;
  let left = Math.max(0, start - Math.floor(spare / 2));
  let right = Math.min(text.length, left + MAX_CONTEXT_LENGTH);
  left = Math.max(0, right - MAX_CONTEXT_LENGTH);
  if (!safeBoundary(text, left)) left++;
  if (!safeBoundary(text, right)) right--;
  const excerpt = text.slice(left, right);
  const selectionStart = start - left, selectionEnd = end - left;
  const source = input.source;
  if (source.title && source.title.length > 512) throw new Error('来源标题过长。');
  if ((source.url?.length ?? 0) > 4096 || (source.documentUri?.length ?? 0) > 4096) throw new Error('来源地址过长。');
  return {
    id: input.id ?? globalThis.crypto.randomUUID(),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    selectedText,
    context: {
      text: excerpt, selectionStart, selectionEnd,
      coverage: excerpt === selectedText ? 'selection-only' : 'excerpt',
      sentenceRange: findSentenceRange(excerpt, selectionStart, selectionEnd,
        left === 0 && input.startsAtBoundary !== false,
        right === text.length && input.endsAtBoundary !== false),
    },
    source: {...source},
  };
}
