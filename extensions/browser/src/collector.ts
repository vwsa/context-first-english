export interface PageSelection {
  text: string; selectionStart: number; selectionEnd: number;
  title: string; url: string; startsAtBoundary: boolean; endsAtBoundary: boolean;
}

/** This function is serialized into the page's isolated world; keep it self-contained. */
export function collectPageSelection(): PageSelection | {error: string} {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) {
    return {error: '首版支持网页正文，请在正文中选择词或短语。'};
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return {error: '请先在网页正文中选择词或短语。'};
  const range = selection.getRangeAt(0);
  // Selection.toString reflects visible selected text. Range.toString may include
  // display:none descendants, which must never enter a selected-only fallback.
  const selectedText = selection.toString();
  if (!selectedText.trim()) return {error: '选区为空，请重新选择。'};
  if (selectedText.length > 2000) return {error: '选中文字过长，请缩小到 2000 个字符以内。'};
  const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
  if (!parent || parent.closest('input,textarea,[contenteditable]:not([contenteditable="false"]),script,style')) return {error: '请在网页正文中选择文本。'};
  const source = {title: document.title.slice(0, 512), url: location.href, startsAtBoundary: false, endsAtBoundary: false};
  const selectedOnly = () => ({...source, text: selectedText, selectionStart: 0, selectionEnd: selectedText.length});
  let container = parent.closest('p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,dd,dt') ?? parent;
  if (container === document.body || container === document.documentElement || !container.contains(range.endContainer)) return selectedOnly();
  if (container.querySelector('script,style,[hidden],input,textarea,[contenteditable]:not([contenteditable="false"])')) return selectedOnly();
  // Inspect only this local block; refuse huge blocks instead of collecting an entire page.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current: Node | null, length = 0, nodes = 0;
  while ((current = walker.nextNode())) {
    length += current.textContent?.length ?? 0;
    if (++nodes > 1000 || length > 24000) return selectedOnly();
    let element = current.parentElement;
    while (element && container.contains(element)) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return selectedOnly();
      if (element === container) break;
      element = element.parentElement;
    }
  }
  const text = container.textContent ?? '';
  const prefix = document.createRange();
  prefix.selectNodeContents(container);
  try { prefix.setEnd(range.startContainer, range.startOffset); } catch { return selectedOnly(); }
  const selectionStart = prefix.toString().length;
  const selectionEnd = selectionStart + selectedText.length;
  if (text.slice(selectionStart, selectionEnd) !== selectedText) return selectedOnly();
  const isBlock = /^(P|LI|PRE|BLOCKQUOTE|H[1-6]|TD|DD|DT)$/.test(container.tagName);
  return {...source, text, selectionStart, selectionEnd, startsAtBoundary: isBlock, endsAtBoundary: isBlock};
}
