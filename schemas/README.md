# 收藏数据协议 v0.1 草案

状态：v0.1 草案，已作为当前本地 MVP 的存储与验证基线，尚未冻结。用户已授权起草；当前没有需要迁移的已发布数据。首版面向 Windows、Linux 中的浏览器和 VS Code，解释内容默认使用简体中文。

一条收藏代表一次遇到表达的经历。例如，文章里的 `bank = 河岸` 和另一篇文章里的 `bank = 银行` 可以分别收藏。数据保存当时的真实原文、来源、解释和讨论，以便以后离线回看。

## 协议文件

| 文件 | 用途 |
|---|---|
| [saved-entry.v0.1.schema.json](saved-entry.v0.1.schema.json) | 完整收藏的存储和单条导出格式 |
| [explanation-result.v0.1.schema.json](explanation-result.v0.1.schema.json) | AI 初次解释返回的四个内容字段 |
| [VS Code Windows 示例](examples/saved-entry.v0.1.json) | 原文、解释及完整追问 |
| [网页示例](examples/browser.v0.1.json) | 相同单词的另一种含义和网页来源 |
| [VS Code Linux 示例](examples/vscode-linux.v0.1.json) | 表情符号之后的选区及尚无回复的追问 |
| [仅选词示例](examples/selection-only.v0.1.json) | 来源不完整、AI 尚未返回时先收藏 |

两个 schema 使用 JSON Schema Draft 2020-12。验证完整收藏前，应将两个文件注册到同一校验器，按各自 `$id` 解析引用；这些 `urn:` 是协议标识，不是网络地址。必须启用 `uuid`、`date-time` 和 `uri` 的格式断言。结构验证通过后，还需执行下文的跨字段检查。

示例中的文本、来源 URI 和时间均为人工构造的验证数据。

## 收藏主结构

| 字段 | 含义与规则 |
|---|---|
| `schemaVersion` | 固定为 `"0.1"`。读取时先识别版本；未知版本应明确报告，不能静默丢字段。 |
| `id` | 收藏记录 UUID，由本地应用生成，在这条收藏存续期间保持稳定。 |
| `capture` | 不可变的捕获快照，包含独立的 `capture.id`。 |
| `explanation` | 已完整生成并通过校验的解释；尚未成功生成时为 `null`。 |
| `conversation` | 该次捕获的已发送用户消息和完整 AI 回复，按会话顺序保存；没有讨论时为 `[]`。 |
| `savedAt` | 当前收藏第一次保存的时间。 |
| `updatedAt` | 收藏内容最后一次实际变更的时间。 |

所有规定的字段都必须出现，缺失信息使用明确的 `null`；数组无内容时使用 `[]`。不接收未声明的字段。时间由宿主记录为 UTC RFC 3339 字符串，输出时建议使用 `Z`；验证器也接受表示同一时刻的合法时区偏移。

## Capture 与原文范围

`capture` 包含 `id`、`capturedAt`、`selectedText`、`context`、`source`。

| Context 字段 | 含义 |
|---|---|
| `text` | 实际取得的、包含选词的有限文本片段；是原文内容的唯一依据。 |
| `selectionStart` / `selectionEnd` | 选词在 `text` 中的位置，从零开始，右端不包含。 |
| `coverage` | `selection-only` 表示只取得选词；`excerpt` 表示取得了选词之外的邻近文本。 |
| `sentenceRange` | 可以可靠识别原句时为 `{start, end}`，否则为 `null`。原句通过 `text.slice(start, end)` 得到。 |

所有偏移都以 UTF-16 code unit 计数，与 JavaScript 字符串和 VS Code 的字符位置约定衔接。不能使用 UTF-8 字节偏移，也不能把表情符号简单计作一个偏移单位。采集端应在完成文本拼接后计算偏移，保存后不再修改或归一化文本。

`sentenceRange` 必须对应包含本次选词的真实原句，范围可以覆盖整个片段。无法可靠断句或选词横跨多个句子时用 `null`；只选到一个完整句子且可确认边界时，也可以在 `selection-only` 下保留原句范围。模型不能自行补造这个范围或原文。

## 来源

所有来源都包含 `kind`、`title`、`url`、`documentUri`、`languageId`、`lineStart`、`lineEnd`。

| 来源类型 | 可用字段 | 其他字段 |
|---|---|---|
| `browser` | `title`、HTTP/HTTPS `url`；取得不到时可为 `null` | 文档 URI、语法类型与行号必须为 `null` |
| `vscode` | `title`、`documentUri`、`languageId`、选区所在行号；取得不到时可为 `null` | `url` 必须为 `null` |

`languageId` 指 `markdown`、`typescript` 等编辑器语法类型。`documentUri` 保留原始 URI，允许 `file:`、`untitled:` 或远程文档 URI；保存 URI 不代表已经实现对应的跳转能力。行号从 1 开始，终止行表示最后一个被选中字符所在的行；两端要么都已知，要么都为 `null`。

来源是捕获时的快照，文件移动、编辑或网页变化后仍保留原记录；跳转失败不影响回看。URI 不参与模型生成，跳转能力由应用按允许的协议实现，不能仅凭数据通过 schema 校验就执行 URI。

## AI 结果与讨论

AI 初次解释只返回四个字段：

| 字段 | 含义 |
|---|---|
| `meaning` | 简洁中文词义；语境不足时准确表达歧义。 |
| `sentenceTranslation` | `sentenceRange` 对应原句的中文翻译；没有原句范围时必须为 `null`。 |
| `contextNote` | 基于原文说明为什么在这里这样理解；没有有用补充时可以为空字符串。 |
| `limitations` | 影响判断的上下文缺失或不确定性，通常为 `[]`。 |

应用验证结果后，追加宿主提供的 `provider`、`model`、`generatedAt`，形成收藏里的 `explanation`。`provider` 是可扩展字符串，例如 `codex` 或未来自定义 API 标识；无法取得模型标识时 `model` 为 `null`。当前 Codex Provider 的结构化输出已验证；新增供应方仍需独立验证其输出协议。

每条讨论消息包含 `id`、`role`（`user` 或 `assistant`）、`text`、`createdAt`。用户消息提交后即可保存，即使生成失败也保留；仅保存已完整结束的 AI 回复。流式片段、取消的 AI 回复、错误提示和未发送草稿不写入 `conversation`。允许最后一条是用户消息，也允许连续用户消息；重试同一问题复用原消息 ID。

未发送草稿仍需按 capture ID 保留在会话状态中，展开或收起讨论区不能丢失。Codex thread ID、request ID、访问凭证和工具执行记录不属于此收藏协议；以后替换 AI Provider 时，应用可以使用保存的原文、解释和讨论重新建立上下文。

## 保存与更新规则

1. 首次捕获即分配 `capture.id`。同一次捕获的重复保存应按这个 ID 更新同一条记录，而不是按单词去重。
2. 允许在 AI 返回前保存，使用 `explanation: null`。有效解释后来完成时更新同一收藏；新增完整讨论消息同样更新该收藏。
3. `capture` 保存后保持不变。不同来源、不同上下文或重新捕获的表达分配新的 capture ID，即使选词相同也保留为不同经历。
4. 成功解释不因追问自动改写；首版重试针对尚未成功的请求。后续若增加“重新生成”，再明确解释修订与旧讨论的关系。
5. 收藏按钮的状态由记录是否存在决定。取消收藏删除这条收藏，保留当前会话；再次收藏新建记录，重新设置 `id` 和 `savedAt`。取消后迟到的 AI 结果不能重建收藏。
6. 保存、更新和删除应由同一个存储层串行处理或事务处理，避免半条记录和重复记录；实际数据库或文件存储方式不影响这个协议。

## 应用层必须检查的约束

JSON Schema 能校验字段类型、必填项、来源互斥和格式；以下关系需要应用层另行检查：

- 选区必须满足 `0 <= start < end <= text.length`，不得截断 UTF-16 代理对，且 `text.slice(start, end)` 必须等于 `selectedText`。
- `selection-only` 时 `text` 就是选词、选区覆盖全文；`excerpt` 必须实际包含选区之外的文本。
- `sentenceRange` 非空时范围合法、不得截断代理对、必须包含选区；为空时 `sentenceTranslation` 必须为空。
- 来源行号已知时 `lineEnd >= lineStart`。真实来源与原句的准确性仍需采集端验证，结构校验不能证明来源真实。
- 同一记录内消息 ID 唯一；同一收藏库中的 entry ID 和 capture ID 各自唯一。
- 写入时 `updatedAt` 不早于 `savedAt`。存在解释和消息时，更新操作应同步刷新 `updatedAt`。
- 请求结果只能写回它所属的捕获和仍存在的收藏；取消收藏、切词或超时后不能误写其他记录。

## v0.1 的边界

当前协议保留个人查词与语境回看所需的信息。标签、个人笔记、复习进度、账户与同步可以在有实际需求时增加；未知字段不能直接塞进 v0.1。冻结之后的结构变更应提供新版本及显式迁移。
