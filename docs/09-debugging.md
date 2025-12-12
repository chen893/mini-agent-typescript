# 调试与复盘（日志、常见问题、排查思路）

Agent 项目想跑稳，调试能力比“写 prompt”更重要。

## 1) 日志在哪里？

对齐 Python 版：日志写在用户目录下

- `~/.mini-agent/log/agent_run_*.log`

每次 `agent.run()` 会创建一个新文件，并记录：
- LLM Request（messages + tools）
- LLM Response（content/thinking/tool_calls）
- Tool Execution（每次工具执行的参数与结果）

对应实现：`src/logger.ts`

## 2) 遇到“模型重复调用工具”怎么查？

典型原因：
- tool message 没有带 toolCallId（模型对不上结果）
- tool 返回内容不稳定（同一输入返回不同输出）
- tool error 没有回传给模型（模型以为“没执行成功”，会重试）

排查步骤：
1. 打开日志，找到那一轮的 tool_calls
2. 确认后续是否有 role=tool 的 message 且 toolCallId 对得上
3. 看 tool_result 内容是否有明确的成功/失败信号

## 3) 遇到“文件路径不对/越界”怎么查？

文件工具会把相对路径限制在 workspace 内。

如果你看到类似错误：
- `Path escapes workspace: ../xxx`

说明模型尝试访问工作区外的文件。你应该：
- 明确告诉模型文件在 workspace 的相对路径
- 或把需要的文件复制到 workspace 内

对应实现：`src/utils/workspacePath.ts`

## 4) MCP/ACP 协议解析失败怎么查？

症状：
- MCP tools 加载失败
- ACP 宿主连不上

最常见原因是：某个进程把普通日志写到了 stdout，污染了协议帧。

排查：
- 确认 MCP/ACP server 把日志写到 stderr
- 如果你自己写 server：不要用 console.log（stdout），用 console.error（stderr）

## 5) provider 切换导致的工具 schema 问题

Anthropic 与 OpenAI 对工具 schema 的形状不一样：
- Anthropic：`{ name, description, input_schema }`
- OpenAI：`{ type:"function", function:{ name, description, parameters } }`

本项目会在运行时根据 provider 自动选择 schema：
- 逻辑在 `src/agent/Agent.ts`
- Tool 的两个 schema 转换在 `src/tools/Tool.ts`

如果你新增 Tool 后发现模型不调用/调用失败：
- 先确认 schema 是否符合 provider 要求
- 再确认 parameters 是否是合法 JSON Schema

