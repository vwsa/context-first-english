"use strict";
(() => {
  // src/shared/capture.ts
  var MAX_SELECTION_LENGTH = 2e3;
  var MAX_CONTEXT_LENGTH = 6e3;
  function safeBoundary(text, offset) {
    const left = text.charCodeAt(offset - 1), right = text.charCodeAt(offset);
    return !(left >= 55296 && left <= 56319 && right >= 56320 && right <= 57343);
  }
  function findSentenceRange(text, selectionStart, selectionEnd, startsAtBoundary = true, endsAtBoundary = true) {
    if (typeof Intl.Segmenter !== "function") return null;
    const segments = new Intl.Segmenter("en", { granularity: "sentence" }).segment(text);
    for (const part of segments) {
      let start = part.index, end = start + part.segment.length;
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (start > selectionStart || end < selectionEnd) continue;
      if (!startsAtBoundary && part.index === 0) return null;
      if (!/[.!?。！？]["'”’\])}]*$/.test(text.slice(start, end))) return null;
      if (!endsAtBoundary && end === text.trimEnd().length) return null;
      return { start, end };
    }
    return null;
  }
  function createCapture(input) {
    const { text, selectionStart: start, selectionEnd: end } = input;
    if (typeof text !== "string" || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
      throw new Error("\u9009\u533A\u4F4D\u7F6E\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u672C\u3002");
    }
    if (!safeBoundary(text, start) || !safeBoundary(text, end)) throw new Error("\u9009\u533A\u622A\u65AD\u4E86\u5B57\u7B26\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u6587\u672C\u3002");
    const selectedText = text.slice(start, end);
    if (!selectedText.trim()) throw new Error("\u8BF7\u5148\u9009\u4E2D\u8981\u89E3\u91CA\u7684\u8BCD\u6216\u77ED\u8BED\u3002");
    if (selectedText.length > MAX_SELECTION_LENGTH) throw new Error("\u9009\u4E2D\u6587\u5B57\u8FC7\u957F\uFF0C\u8BF7\u7F29\u5C0F\u5230 2000 \u4E2A\u5B57\u7B26\u4EE5\u5185\u3002");
    const spare = MAX_CONTEXT_LENGTH - selectedText.length;
    let left = Math.max(0, start - Math.floor(spare / 2));
    let right = Math.min(text.length, left + MAX_CONTEXT_LENGTH);
    left = Math.max(0, right - MAX_CONTEXT_LENGTH);
    if (!safeBoundary(text, left)) left++;
    if (!safeBoundary(text, right)) right--;
    const excerpt = text.slice(left, right);
    const selectionStart = start - left, selectionEnd = end - left;
    const source = input.source;
    if (source.title && source.title.length > 512) throw new Error("\u6765\u6E90\u6807\u9898\u8FC7\u957F\u3002");
    if ((source.url?.length ?? 0) > 4096 || (source.documentUri?.length ?? 0) > 4096) throw new Error("\u6765\u6E90\u5730\u5740\u8FC7\u957F\u3002");
    return {
      id: input.id ?? globalThis.crypto.randomUUID(),
      capturedAt: input.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      selectedText,
      context: {
        text: excerpt,
        selectionStart,
        selectionEnd,
        coverage: excerpt === selectedText ? "selection-only" : "excerpt",
        sentenceRange: findSentenceRange(
          excerpt,
          selectionStart,
          selectionEnd,
          left === 0 && input.startsAtBoundary !== false,
          right === text.length && input.endsAtBoundary !== false
        )
      },
      source: { ...source }
    };
  }

  // extensions/browser/src/collector.ts
  function collectPageSelection() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLElement && active.isContentEditable) {
      return { error: "\u9996\u7248\u652F\u6301\u7F51\u9875\u6B63\u6587\uFF0C\u8BF7\u5728\u6B63\u6587\u4E2D\u9009\u62E9\u8BCD\u6216\u77ED\u8BED\u3002" };
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return { error: "\u8BF7\u5148\u5728\u7F51\u9875\u6B63\u6587\u4E2D\u9009\u62E9\u8BCD\u6216\u77ED\u8BED\u3002" };
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();
    if (!selectedText.trim()) return { error: "\u9009\u533A\u4E3A\u7A7A\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002" };
    if (selectedText.length > 2e3) return { error: "\u9009\u4E2D\u6587\u5B57\u8FC7\u957F\uFF0C\u8BF7\u7F29\u5C0F\u5230 2000 \u4E2A\u5B57\u7B26\u4EE5\u5185\u3002" };
    const parent = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    if (!parent || parent.closest('input,textarea,[contenteditable]:not([contenteditable="false"]),script,style')) return { error: "\u8BF7\u5728\u7F51\u9875\u6B63\u6587\u4E2D\u9009\u62E9\u6587\u672C\u3002" };
    const source = { title: document.title.slice(0, 512), url: location.href, startsAtBoundary: false, endsAtBoundary: false };
    const selectedOnly = () => ({ ...source, text: selectedText, selectionStart: 0, selectionEnd: selectedText.length });
    let container = parent.closest("p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,dd,dt") ?? parent;
    if (container === document.body || container === document.documentElement || !container.contains(range.endContainer)) return selectedOnly();
    if (container.querySelector('script,style,[hidden],input,textarea,[contenteditable]:not([contenteditable="false"])')) return selectedOnly();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let current, length = 0, nodes = 0;
    while (current = walker.nextNode()) {
      length += current.textContent?.length ?? 0;
      if (++nodes > 1e3 || length > 24e3) return selectedOnly();
      let element = current.parentElement;
      while (element && container.contains(element)) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return selectedOnly();
        if (element === container) break;
        element = element.parentElement;
      }
    }
    const text = container.textContent ?? "";
    const prefix = document.createRange();
    prefix.selectNodeContents(container);
    try {
      prefix.setEnd(range.startContainer, range.startOffset);
    } catch {
      return selectedOnly();
    }
    const selectionStart = prefix.toString().length;
    const selectionEnd = selectionStart + selectedText.length;
    if (text.slice(selectionStart, selectionEnd) !== selectedText) return selectedOnly();
    const isBlock = /^(P|LI|PRE|BLOCKQUOTE|H[1-6]|TD|DD|DT)$/.test(container.tagName);
    return { ...source, text, selectionStart, selectionEnd, startsAtBoundary: isBlock, endsAtBoundary: isBlock };
  }

  // extensions/browser/src/background.ts
  var DEFAULT_PORT = 37719;
  async function capture(tab, frameId = 0) {
    if (typeof tab.id !== "number") throw new Error("\u672A\u627E\u5230\u5F53\u524D\u7F51\u9875\u3002");
    const settings = await chrome.storage.local.get(["token", "port"]);
    if (typeof settings.token !== "string" || settings.token.length < 16) {
      await chrome.runtime.openOptionsPage();
      throw new Error("\u8BF7\u5148\u5728\u6269\u5C55\u8BBE\u7F6E\u4E2D\u8FDE\u63A5\u684C\u9762\u5E94\u7528\u3002");
    }
    const port = Number(settings.port ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("\u8FDE\u63A5\u7AEF\u53E3\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u6269\u5C55\u8BBE\u7F6E\u3002");
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        func: collectPageSelection
      });
    } catch {
      throw new Error("\u6B64\u9875\u9762\u4E0D\u5141\u8BB8\u8BFB\u53D6\u9009\u533A\uFF0C\u8BF7\u5C1D\u8BD5\u666E\u901A\u7F51\u9875\u6B63\u6587\u3002");
    }
    const result = results?.[0]?.result;
    if (!result) throw new Error("\u6B64\u9875\u9762\u65E0\u6CD5\u8BFB\u53D6\u9009\u533A\u3002\u8BF7\u5C1D\u8BD5\u666E\u901A\u7F51\u9875\u6B63\u6587\u3002");
    if ("error" in result) throw new Error(result.error);
    const item = createCapture({
      ...result,
      source: {
        kind: "browser",
        title: result.title || null,
        url: /^https?:\/\//.test(result.url) ? result.url : null,
        documentUri: null,
        languageId: null,
        lineStart: null,
        lineEnd: null
      }
    });
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.token}` },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(8e3)
      });
    } catch {
      throw new Error("\u65E0\u6CD5\u8FDE\u63A5\u684C\u9762\u5E94\u7528\uFF0C\u8BF7\u5148\u6253\u5F00 Context First\u3002");
    }
    if (response.status === 401 || response.status === 403) throw new Error("\u8FDE\u63A5\u7801\u4E0D\u5339\u914D\uFF0C\u8BF7\u4ECE\u684C\u9762\u8BBE\u7F6E\u91CD\u65B0\u590D\u5236\u3002");
    if (!response.ok) throw new Error(`\u684C\u9762\u5E94\u7528\u672A\u63A5\u6536\u9009\u533A\uFF08${response.status}\uFF09\u3002`);
    await chrome.storage.local.set({ lastError: "" });
    await chrome.action.setBadgeText({ text: "", tabId: tab.id });
    await chrome.action.setTitle({ title: "\u5DF2\u5728 Context First \u4E2D\u6253\u5F00", tabId: tab.id });
  }
  async function run(tab, frameId = 0) {
    try {
      await capture(tab, frameId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u65E0\u6CD5\u89E3\u91CA\u9009\u533A\u3002";
      await chrome.storage.local.set({ lastError: message });
      await chrome.action.setBadgeBackgroundColor({ color: "#98573f" });
      await chrome.action.setBadgeText({ text: "!", ...tab.id !== void 0 ? { tabId: tab.id } : {} });
      await chrome.action.setTitle({ title: message, ...tab.id !== void 0 ? { tabId: tab.id } : {} });
    }
  }
  chrome.action.onClicked.addListener((tab) => {
    void run(tab);
  });
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "explain-selection") return;
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) await run(tab);
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "explain-selection" && tab) void run(tab, info.frameId ?? 0);
  });
  chrome.runtime.onInstalled.addListener(async (details) => {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: "explain-selection", title: "\u7528 Context First \u89E3\u91CA", contexts: ["selection"] });
    if (details.reason === "install") await chrome.runtime.openOptionsPage();
  });
})();
