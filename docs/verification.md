# MVP v0.1 验证记录

日期：2026-11-04。对象为当前源码与 `release` 下的 x64 文件夹产物。测试使用独立数据目录，未安装到用户的浏览器或 VS Code 日常配置中。

## 2026-11-05：自动连接更新

- Windows 新包位于 `release/auto-connect/win-unpacked/Context First.exe`。原目录的程序正在运行，更新包另放目录，未强制结束用户进程。此前的 Linux 包不含本次更新。
- 类型检查及 36 项测试通过，新增无 PATH 桌面安装发现、更新后重新发现、不兼容版本回退、npm 原生程序发现和缺失安装检查。
- 新 Windows 打包程序通过桌面回归；设置页默认折叠高级选项，保存手动覆盖与“恢复自动连接”通过界面验证。
- 设置为空、未指定 Codex 路径、测试进程 PATH 仅保留 Windows System32 时，打包程序成功自动查找 Codex 并复用已有登录，真实解释完成用时 22.737 秒，返回模型为 `gpt-6-astra`。提前收藏与重启恢复通过，重启后路径和模型仍为空。这是单次样本。
- 可通过设置 `CONTEXT_FIRST_AUTO_DISCOVERY=1` 并运行 `scripts/live-smoke.mjs` 复现；不要同时设置 `CONTEXT_FIRST_CODEX`。本次未增加浏览器或 PDF 支持范围。

## 桌面端

| 检查 | Windows 10 x64 | Ubuntu 24.04 x64 / WSL2 + WSLg |
|---|---|---|
| Electron 45.2.2 文件夹打包 | 通过 | 通过 |
| 直接运行打包可执行文件的自动化回归 | 通过 | 通过 |
| 本机鉴权桥接、原文、模拟解释、讨论 | 通过 | 通过 |
| 收藏与讨论重启恢复 | 通过 | 通过 |
| 中文草稿输入、收起再展开保留 | 通过 | 通过 |
| 350 px 窄窗口、译文与 Context 独立展开、正文内部滚动 | 通过 | 通过 |
| 模拟连接失败后重试、取消解释 | 通过 | 通过 |
| 打包程序调用真实 Codex、提前收藏、重启后解释不变 | 通过 | 通过 |

桌面自动化启动显式设置 `chromiumSandbox: true`，没有依赖 Playwright 默认附加的 `--no-sandbox`。Linux 额外直接启动 Electron，进程保持运行到测试定时结束，没有启动错误。

真实 Codex 的这次打包验证使用 `codex-cli 0.164.0-alpha.11.1`、已有 ChatGPT 登录及服务端返回的 `gpt-6.1-sol`。输入为人工构造的 `We sat on the bank of the river.`：

| 样本 | 原文可见 | 完整解释（含连接准备） |
|---|---:|---:|
| Windows 打包程序 | 41 ms | 12.794 s |
| Linux 打包程序 | 31 ms | 11.928 s |

这是两个样本，不是延迟分位数或速度承诺。初次解释完整校验后展示；追问流式显示。其他真实解释与追问样本见 [Codex 接入记录](codex-integration.md)。

## 核心与采集

`npm run typecheck` 通过；`npm test` 的 32 项检查全部通过，覆盖捕获偏移、schema 跨字段约束、原子保存和损坏文件保护、早收藏、删除后迟到结果、独立草稿、讨论重试、模型取消与超时、鉴权桥以及切词时过期 IPC 操作的隔离。

- 真实无头 Edge 的 8 个 DOM 场景通过，覆盖正常选区、重复词、表情符号、内联节点、隐藏文本、超大块与可编辑区域排除。
- 实际浏览器 worker 代码通过带鉴权的本机 HTTP 转发检查。缺少配对时不会注入或发送文本。
- 隔离的真实 Edge 扩展加载、service worker 和 options 页面配对检查通过。浏览器级 `Alt+Shift+D` 未能由 CDP 键盘事件触发，因此没有宣称这一整条用户触发链路自动验收通过；仍需要在实际浏览器中手动按快捷键、点击工具栏或右键菜单验收。
- VSIX 已成功安装到隔离目录；真实 VS Code 宿主的两次选区（含 emoji 和重复词的第二个出现位置）、来源行号、鉴权发送及空选区拒绝通过。该测试使用测试 SecretStorage 替身调用实际采集函数，未自动操作交互式配对输入。为避开已安装 VS Code 的更新锁，测试使用官方便携版；没有干预用户的更新进程或日常配置。

## 复现

基础命令见 [README](../README.md#验证)。构建后，可指定文件夹产物运行相同回归，而非仅测试开发运行时：

```powershell
$env:CONTEXT_FIRST_ELECTRON = "$PWD/release/win-unpacked/Context First.exe"
node scripts/smoke.mjs
node scripts/live-smoke.mjs
```

```sh
CONTEXT_FIRST_ELECTRON="$PWD/release/linux-unpacked/context-first-english" node scripts/smoke.mjs
CONTEXT_FIRST_ELECTRON="$PWD/release/linux-unpacked/context-first-english" node scripts/live-smoke.mjs
```

真实模型测试可另设 `CONTEXT_FIRST_CODEX` 指向兼容的本机 Codex。运行结果、截图及隔离数据分别写入 `test-results` 与 `.test-data`，不纳入 Git。

浏览器整链路脚本需实际浏览器操作，出现 `READY` 后在隔离的测试文章窗口按 `Alt+Shift+D`：

```powershell
$env:CONTEXT_FIRST_MANUAL_TRIGGER = '1'
node scripts/browser-desktop-smoke.mjs
```

该脚本的 AI 明确为模拟实现，只验采集、来源、桌面显示与收藏。DOM 和 VS Code 宿主命令见 [扩展验证说明](extensions.md#验证命令)。

## 尚未覆盖

原生 Linux 各发行版及 Wayland/X11 桌面组合、多显示器与高 DPI、真实中文输入法组合键、Linux VS Code 宿主、系统来源协议跳转和交互式导出对话框仍需目标环境实测。当前只有 x64 文件夹包及压缩包，没有签名安装器、自动更新或已验收的 AppImage。
