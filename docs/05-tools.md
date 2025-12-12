# Tools（工具系统：让 Agent 具备“确定性能力”）

你可以把 Tool 理解为“给模型配的函数能力”：

- 模型负责“决策”：什么时候需要外部能力、传什么参数
- 你负责“执行”：把参数变成确定性结果（读文件、写文件、跑命令…）

这就是 Agent 工程和纯 prompt 的最大差别：结果可验证、可复现、可调试。

## 1) Tool 的接口长什么样？

看 `src/tools/Tool.ts`：

- `name/description/parameters`：给模型看的“工具说明”
- `execute(args)`：给运行时调用的“执行入口”
- `toAnthropicSchema()/toOpenAISchema()`：适配不同协议的工具 schema 形状

为什么要保留 schema？
- 模型需要知道每个参数的含义与类型，否则工具调用很容易“传错参数”

## 2) 读文件为什么要带行号？

看 `src/tools/fileTools.ts` 的 `ReadFileTool`。

带行号的价值：
- 模型可以精确引用：例如“请把第 120 行的 import 改成…”
- 结合 `edit_file` 的“唯一匹配替换”，能大幅减少误改

## 3) edit_file 为什么用“精确字符串替换”？

这是一种工程化约束：
- 让修改是确定性的（可复盘）
- 让失败可解释（old_str 找不到/不唯一）
- 避免模型“脑补 patch”造成不可控修改

这也是很多 Agent 工具（包括 claude code 类工具）常用的策略。

## 4) bash 工具为什么要支持后台进程？

看 `src/tools/bashTool.ts`：

- `bash`：前台/后台运行
- `bash_output`：增量拉取输出（避免每次把全部输出塞回上下文）
- `bash_kill`：终止后台任务

典型场景：
- 启动一个本地 server
- 跑一个长时间的构建/测试
- 运行 MCP server（如果你选择由 Agent 自己拉起）

## 5) note 工具是什么？为什么要落盘？

看 `src/tools/noteTools.ts`：

- `record_note`：把关键事实写入 `{workspace}/.agent_memory.json`
- `recall_notes`：在后续任务中取回

它解决的是“跨轮/跨任务”的信息遗忘问题。

建议你记录的内容：
- 用户偏好（“回答简洁/中文/输出格式”）
- 重要决策（“我们选用 openai 协议”）
- 项目上下文（“这是一个 monorepo，入口在 packages/app”）

## 6) 写一个新 Tool 的推荐步骤

1. 先定义 Tool 的使用场景：模型在什么时候会想用它？
2. 写 `name/description/parameters`（description 写清楚触发条件）
3. 实现 `execute`（要么成功给 content，要么失败给 error）
4. 在 `src/runtime/init.ts` 或 CLI 初始化里注册它
5. 用一个最小任务验证：让模型主动调用它

练习题在：`docs/10-exercises.md`

