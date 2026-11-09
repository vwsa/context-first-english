# 桌面端 MVP v0.1 范围与实现

更新日期：2026-11-04。

首版面向个人使用：在 Windows 或 Linux 上，从 VS Code 或浏览器选中文字，主动打开一个轻量浮窗，查看当前语境中的解释、继续追问，并按统一 schema 收藏。以下描述当前代码与交付边界，具体运行方式见 [README](../README.md)。

## 已确定的产品范围

| 项目 | 首版实现 |
|---|---|
| 系统 | Windows、Linux 桌面应用 |
| 文本来源 | VS Code 编辑器选区、Chrome / Edge 普通网页正文 |
| 核心界面 | 暖白浮窗、原文与词义、译文、Context、讨论、收藏和来源入口 |
| 背景效果 | 普通不透明背景，毛玻璃暂缓 |
| 视频 | 暂缓 |
| AI | 本机 Codex；预留 `AIProvider` 接口，未来接自定义 API |
| 收藏 | 版本为 `0.1` 的 Saved Entry，存入本地 JSON，可导出 |
| 使用方式 | 个人工具，手动安装与配对采集扩展 |

原始 [UI/UX v0.7](design/floating-panel-uiux-spec-v0.7.md) 与 [视觉参考](design/floating-panel-visual-reference.png) 继续提供视觉和交互依据；其中视频及毛玻璃相关内容不进入首版。

## 当前架构

桌面端采用 Electron、React 和 TypeScript。Electron 主进程管理窗口、配对桥、AI、会话和收藏；渲染进程通过受限 preload 接口请求操作，不直接访问 Node.js。应用复用一个浮窗，关闭时隐藏，由托盘重新打开或退出。

浏览器和 VS Code 扩展输出相同的 `Capture`。浏览器在用户触发时注入采集脚本，读取真实 DOM 选区及附近块；VS Code 从活动编辑器取得选区、有限上下文、文档 URI 和行号。两端都使用 UTF-16 偏移记录选区，保留原始文本，不通过查找同名词猜测位置。

两个扩展均连接已配对的本机 HTTP 桥，默认 `127.0.0.1:37719`。`POST /capture` 与 `GET /health` 都要求 `Authorization: Bearer <配对码>`；服务仅监听回环地址，校验 Host、来源、JSON 格式和 Capture，单次请求上限为 64 KiB。页面自身不会获得配对码；浏览器扩展在自己的本地存储中保存配对信息，VS Code 使用 SecretStorage 保存配对码。安装及协议见 [扩展说明](extensions.md)。

收藏存储已经选定为 `library.json`，由单个桌面进程串行写入，使用临时文件、文件同步和原子替换。读取和写入都校验 schema 与跨字段约束；损坏文件不会被自动重置。桌面设置与配对码另存于 `settings.json`。两者位于 Electron 的应用用户数据目录。

## 浮窗与会话行为

1. 收到 Capture 后先显示表达和原文，再等待 AI；尚无解释时也能收藏。
2. 初次解释在完整返回并通过 schema 检查后展示词义、原句译文和 Context；追问按文本增量显示。
3. 译文和 Context 分别折叠，内容超过三行才出现展开入口；窗口随内容调整高度，超过可用高度后内部滚动。
4. 每次捕获拥有自己的解释、讨论与输入草稿。切换捕获会取消旧请求，旧请求的迟到结果不能覆盖当前内容。
5. 失败与取消可重试；未完成的回复不会被保存为完整回答。已发送的问题可以保留，以便重试对应回复。
6. 点击来源可打开 HTTP(S) 网页或 VS Code 本地文件行号。其他 URI 保留在数据中，当前不直接打开。

Windows / X11 尝试在鼠标附近显示浮窗并限制在屏幕工作区内。Wayland 下由桌面合成器安排位置，不要求固定坐标或置顶；焦点、多屏缩放和中文输入法行为仍需在目标桌面环境中确认。

## Codex 接入与速度

`CodexProvider` 通过本机 `codex app-server` 实现解释和讨论，界面与存储只依赖 `AIProvider` 接口。当前要求 Codex 0.164.0 或更新版本及已有登录，设置允许指定可执行文件路径和模型。自定义 HTTP API Provider 尚未实现。

首个请求启动常驻 App Server，每次捕获使用独立临时 thread，同一捕获的追问延续对应 thread。初次解释使用结构化输出；取消或切换会中断旧 turn，控制层再次过滤过期结果。传给模型的内容限于选中表达、已捕获的有限原文和该捕获的讨论；来源 URI、ID 和时间由采集端及应用提供。

Provider 通过进程配置和协议检查限制为文本任务，关闭无关工具与连接，拒绝服务端操作请求，无法确认关键限制时报告错误。配置仅影响本应用启动的进程，不改写用户全局 Codex 配置。认证、版本、超时、隔离措施及真实推理结果见 [Codex 接入与验证](codex-integration.md)。

界面显示速度与模型完成速度分别衡量。已有 Windows 与 WSL Ubuntu 的真实解释和追问样本，耗时记录在接入文档中；少量样本不构成 p50/p95 或秒级响应承诺。初次解释要等完整结构化结果，追问可以逐步显示；当前不提供跨捕获的解释缓存。

## 收藏协议与保存生命周期

[Saved Entry v0.1](../schemas/saved-entry.v0.1.schema.json) 已作为当前运行时的数据协议；字段仍可迭代，变更需考虑版本与迁移。[字段说明](../schemas/README.md) 和 [AI 解释结果协议](../schemas/explanation-result.v0.1.schema.json) 描述具体约束。

| 部分 | 内容与规则 |
|---|---|
| Capture | 捕获 ID、时间、表达、真实上下文、选区范围及来源；保存后原文快照不可修改 |
| Explanation | 语境词义、可空的句子翻译、解释、限制说明及生成信息；允许为空，支持先收藏原文 |
| Conversation | 当前捕获已发送的问题与完整回答；不保存未发送草稿或流式片段 |
| Saved Entry | schema 版本、收藏 ID、Capture、Explanation、Conversation 和保存时间 |

选区范围为从零开始、右端不包含的 UTF-16 偏移。运行时检查范围、代理对边界，以及 `context.text.slice(selectionStart, selectionEnd) === selectedText`。行号从 1 开始；缺失来源使用 `null`。`sentenceRange` 只有在采集端能确认原句时才提供，模型不补造原句或来源。

同一 Capture 只有一条收藏，书签按钮切换收藏状态；同一词的不同捕获可以分别收藏。先保存原文后，成功解释与后续讨论自动补入已有收藏；已完成解释和既有消息不能被后续写入修改。导出为 Saved Entry 数组，不包含设置、配对码或未发送草稿。未收藏会话与草稿只保留在当前进程；首版不含导入、云同步或自动备份。

## 验证入口与剩余边界

| 验证入口 | 覆盖与前提 |
|---|---|
| `npm run typecheck` / `npm test` | 类型、捕获范围、schema、会话、存储、配对桥及 Provider 协议逻辑 |
| `npm run test:e2e` | 独立数据目录中的真实 Electron 窗口，使用模拟 AI 验证交互与重启恢复；需要图形环境 |
| `npm run test:live` | 真实 Codex 解释、提前收藏与重启恢复；需要兼容 Codex 及登录，会发起真实模型请求 |
| `node extensions/browser/test-dom.mjs` | 真实无头浏览器中的 DOM 选区与隐藏文本等边界 |
| `node extensions/vscode/test-host.mjs` | 隔离 VS Code 宿主中的实际编辑器选区及鉴权发送；使用测试 SecretStorage 替身，不覆盖交互式配对输入 |

Windows 与 Linux 的应用文件夹，以及浏览器 ZIP、VS Code VSIX 已可构建。构建成功与目标环境验收分开记录，不能据此推断所有 Linux 发行版、窗口系统或打包形式已经通过测试。

当前限制与后续验证范围：

- 浏览器仅覆盖 Chromium 普通网页正文；输入框、密码框、可编辑区域、内部页面、PDF 查看器和 Firefox 不在首版支持范围。跨域 iframe 可能没有临时读取权限。
- 单次选区最多 2000 个 UTF-16 单位，上下文最多 6000 个；跨块或过大 DOM 会退化为仅选区，不能可靠确认句子时不提供原句范围。
- VS Code 支持编辑器单个连续选区，暂不支持终端。扩展在本地 UI 宿主运行，远程 URI 可被保存，但远程及虚拟文档跳转未实现，完整远程工作流仍需验证。
- 不同 Linux 桌面环境、Wayland / X11、多屏、高 DPI、中文输入法与系统托盘需要目标机器实测。没有签名安装器、自动更新或已验收的 AppImage。
- 后续自定义 API、收藏导入、schema 迁移、长期性能统计仍未实现；视频和毛玻璃继续暂缓。