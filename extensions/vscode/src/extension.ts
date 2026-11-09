import * as vscode from 'vscode';
import {createCapture, MAX_SELECTION_LENGTH} from '../../../src/shared/capture';
import type {Capture} from '../../../src/shared/types';

const TOKEN_KEY = 'contextFirst.connectionToken';
const PORT_KEY = 'contextFirst.connectionPort';
async function send(context: vscode.ExtensionContext, item: Capture): Promise<void> {
  const token = await context.secrets.get(TOKEN_KEY);
  if (!token) throw new Error('请先运行“Context First: 连接桌面应用”。');
  const port = context.globalState.get<number>(PORT_KEY, 37719);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify(item), signal: AbortSignal.timeout(8000),
    });
  } catch {throw new Error('无法连接桌面应用，请先打开 Context First。');}
  if (response.status === 401 || response.status === 403) throw new Error('连接码不匹配，请重新连接桌面应用。');
  if (!response.ok) throw new Error(`桌面应用未接收选区（${response.status}）。`);
}

export async function explainSelection(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) throw new Error('请先在编辑器中选中词或短语。');
  if (editor.selections.length !== 1) throw new Error('请一次选择一个连续的词或短语。');
  const doc = editor.document, selection = editor.selection;
  const selectedStart = doc.offsetAt(selection.start), selectedEnd = doc.offsetAt(selection.end);
  if (selectedEnd - selectedStart > MAX_SELECTION_LENGTH) throw new Error('选中文字过长，请缩小到 2000 个字符以内。');
  const documentEnd = doc.offsetAt(doc.lineAt(doc.lineCount - 1).range.end);
  let excerptStart = Math.max(0, selectedStart - 1800), excerptEnd = Math.min(documentEnd, selectedEnd + 1800);
  // Obtain at most a bounded neighbourhood, never the whole document by default.
  let text = doc.getText(new vscode.Range(doc.positionAt(excerptStart), doc.positionAt(excerptEnd)));
  if (/^[\uDC00-\uDFFF]/.test(text)) {excerptStart++; text = text.slice(1);}
  if (/[\uD800-\uDBFF]$/.test(text)) {excerptEnd--; text = text.slice(0, -1);}
  const item = createCapture({
    text, selectionStart: selectedStart - excerptStart, selectionEnd: selectedEnd - excerptStart,
    startsAtBoundary: excerptStart === 0, endsAtBoundary: excerptEnd === documentEnd,
    source: {
      kind: 'vscode', title: doc.uri.path.split('/').pop()?.slice(0, 512) || doc.fileName.slice(-512),
      url: null, documentUri: doc.uri.toString(), languageId: doc.languageId,
      lineStart: selection.start.line + 1, lineEnd: doc.positionAt(selectedEnd - 1).line + 1,
    },
  });
  await send(context, item);
}

async function connect(context: vscode.ExtensionContext): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: '连接 Context First', prompt: '粘贴桌面应用设置中的连接码', password: true, ignoreFocusOut: true,
    validateInput: value => value.trim().length >= 16 ? null : '请粘贴完整连接码。',
  });
  if (token === undefined) return;
  const portText = await vscode.window.showInputBox({
    title: '连接 Context First', prompt: '桌面应用端口', value: String(context.globalState.get(PORT_KEY, 37719)),
    validateInput: value => /^\d+$/.test(value) && +value >= 1024 && +value <= 65535 ? null : '请输入有效端口。',
  });
  if (portText === undefined) return;
  await context.secrets.store(TOKEN_KEY, token.trim());
  await context.globalState.update(PORT_KEY, Number(portText));
  try {
    const response = await fetch(`http://127.0.0.1:${Number(portText)}/health`, {
      headers: {Authorization: `Bearer ${token.trim()}`}, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`连接失败（${response.status}），请检查连接码。`);
    void vscode.window.showInformationMessage('已连接 Context First。选词后按 Alt+Shift+D。');
  } catch (error) {
    void vscode.window.showWarningMessage(`连接设置已保存。${error instanceof Error ? error.message : '请先打开桌面应用。'}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('contextFirst.connect', () => connect(context)),
    vscode.commands.registerCommand('contextFirst.explainSelection', async () => {
      try {await explainSelection(context);}
      catch (error) {void vscode.window.showErrorMessage(error instanceof Error ? error.message : '无法解释选中文本。');}
    }),
  );
}
export function deactivate(): void {}
