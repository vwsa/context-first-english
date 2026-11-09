const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const {explainSelection} = require('./dist/extension.cjs');

exports.run = async function () {
  const token = process.env.CONTEXT_FIRST_TEST_TOKEN;
  const port = Number(process.env.CONTEXT_FIRST_TEST_PORT);
  const fixture = process.env.CONTEXT_FIRST_TEST_DOCUMENT;
  if (!token || !port || !fixture) throw new Error('Missing isolated test environment');
  const context = {
    secrets: {get: async () => token},
    globalState: {get: () => port},
  };
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fixture));
  const editor = await vscode.window.showTextDocument(doc);
  const text = doc.getText();
  const first = text.indexOf('break the ice');
  editor.selection = new vscode.Selection(doc.positionAt(first), doc.positionAt(first + 13));
  await explainSelection(context);
  const second = text.lastIndexOf('bank');
  editor.selection = new vscode.Selection(doc.positionAt(second), doc.positionAt(second + 4));
  await explainSelection(context);
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await assert.rejects(() => explainSelection(context));
  await fs.writeFile(process.env.CONTEXT_FIRST_TEST_OUTPUT, JSON.stringify({editorApi: 'passed', captures: 2, emptySelection: 'rejected'}));
};
