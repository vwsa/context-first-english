# 文本采集扩展

Windows 和 Linux 使用相同的捕获协议。扩展只在快捷键、右键菜单或工具栏按钮被主动触发时获取文本，并发送到本机 `127.0.0.1`。桌面连接码用于鉴权，浏览器页面本身不会取得该连接码。

## 浏览器

先执行仓库根目录的构建命令，然后在 Chrome 或 Edge 的扩展管理页开启开发者模式，加载 `extensions/browser` 目录。打开扩展详情中的设置页，填入桌面应用设置中的连接码和端口（默认 `37719`），点击“保存并检查连接”。

在普通网页正文中选择词或短语，按 `Alt+Shift+D`。也可点击工具栏图标，或右键选择“用 Context First 解释”。可通过浏览器的扩展快捷键设置修改快捷键。如果图标显示 `!`，悬停图标可查看失败原因，设置页也会显示最近一次错误。

扩展使用 `activeTab` 在当前页面临时运行采集脚本，无需授予全部网站的常驻读取权限。首版不读取输入框、密码框、可编辑区域、浏览器内部页面或浏览器 PDF 查看器。跨域 iframe 可能因临时权限不足而无法读取；此时报告错误，不构造原句。选区跨越多个块或所在块过大时，只发送选词。

来源 URL 和标题来自实际选区所在页面。上下文最多 6000 个 UTF-16 单位，单次选区最多 2000 个单位。原句使用分句器识别并要求可见句末标点；无法可靠确认时 `sentenceRange` 为 `null`。

## VS Code

构建扩展后，执行 `node extensions/vscode/package.mjs` 可生成 `release/context-first-vscode-0.1.0.vsix`。在 VS Code 扩展面板的菜单中选择“从 VSIX 安装”即可；也可在扩展开发宿主中加载 `extensions/vscode`。打包脚本使用官方 `@vscode/vsce`，首次运行需要下载该开发工具。

1. 打开命令面板，运行 `Context First: 连接桌面应用`。
2. 填入桌面应用设置中的连接码和端口。连接码存储在 VS Code SecretStorage 中。
3. 在编辑器选择一个连续选区，按 `Alt+Shift+D`，或使用编辑器右键菜单。

首版支持编辑器选区，终端选区暂不支持。代码只读取选区及有限的邻近内容，不默认读取整个文件。扩展在本地 UI 宿主执行，因此本机桥接地址不随远程工作区改变；远程 URI 会按原样保存，来源跳转是否可用取决于桌面应用支持。

## 构建接口

- `extensions/browser/src/background.ts` 使用 esbuild 打包为 `extensions/browser/background.js`，浏览器目标、IIFE 格式。`collectPageSelection` 是独立函数，可直接被 Chromium 序列化注入，不能添加依赖外层变量的代码。
- `extensions/vscode/src/extension.ts` 打包为 `extensions/vscode/dist/extension.cjs`，Node.js 目标、CommonJS 格式，将 `vscode` 标为外部模块。
- `src/shared/capture.ts` 提供 `createCapture` 和 `findSentenceRange`，两端复用同样的文本范围规则。

连接协议：`POST /capture`，`Authorization: Bearer <连接码>`，请求 JSON 为 Capture；`GET /health` 同样需要鉴权。请求超时会报告连接失败，不将任何未获取的上下文补造为原文。

## 验证命令

- `npm test` 包含捕获数据单元检查。
- `node extensions/browser/test-dom.mjs` 在真实无头浏览器中验证 DOM 选区；Windows 默认使用已安装的 Edge，也可通过 `CONTEXT_FIRST_BROWSER` 指定浏览器可执行文件。
- `node extensions/vscode/test-host.mjs` 使用独立用户数据目录和扩展目录启动真实 VS Code 测试宿主，打开临时文档并检查选区及鉴权请求。可通过 `CONTEXT_FIRST_CODE` 指定 VS Code 可执行文件。该测试使用隔离的测试 SecretStorage 替身调用实际采集函数，不代表已经自动验证交互式连接码输入流程。
- `CONTEXT_FIRST_MANUAL_TRIGGER=1 node scripts/browser-desktop-smoke.mjs` 加载隔离的真实浏览器扩展、通过 options 页面配对，等待在实际浏览器中按 `Alt+Shift+D`，再检查桌面 Capture 与收藏（AI 为模拟实现）。PowerShell 设置环境变量的写法及当前验证边界见 [验证记录](verification.md)。CDP 键盘事件未触发浏览器级快捷键，不能用它的失败推断真实用户快捷键失效，也没有据此宣称整链路已自动通过。

官方接口依据：[Chrome 内容脚本](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[脚本注入 API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[VS Code API](https://code.visualstudio.com/api/references/vscode-api)、[扩展宿主](https://code.visualstudio.com/api/advanced-topics/extension-host)。
