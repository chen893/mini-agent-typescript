# 学习指南（从 0 到 1 读懂 Mini Agent TypeScript）

这份文档面向中文 TypeScript 开发者：你不需要先懂“Agent 工程学”，也能用循序渐进的方式把这个项目吃透，并能自己扩展 Tool / Skill / MCP / ACP。

如果你同时在看 Python 版：本项目刻意保持与 `Mini-Agent-python` 的工程结构一致（LLMClient / Agent loop / Tools / Skills / MCP / ACP），只是把实现语言换成 TypeScript，并把关键点用中文注释展开。

## 建议阅读顺序（强烈推荐）

按下面顺序读代码，你会更容易形成“整体模型”：

1. 先跑起来：`docs/02-run-and-config.md`
2. 从入口理解初始化：`src/cli.ts` + `src/runtime/init.ts`（见 `docs/03-architecture.md`）
3. 抓住核心：Agent 执行循环：`docs/04-agent-loop.md`
4. 工具系统：Tool 设计与实现：`docs/05-tools.md`
5. Skills 渐进式加载：`docs/06-skills.md`
6. MCP：把外部工具接入 Agent：`docs/07-mcp.md`
7. ACP：把 Agent 接入 IDE/编辑器宿主：`docs/08-acp.md`
8. 调试与复盘：日志、常见坑：`docs/09-debugging.md`
9. 练习题：从模仿到改造：`docs/10-exercises.md`

## 学习目标（你学完应该能做到）

- 看懂一次完整的 Agent “多轮执行”：模型 → tool_calls → 执行工具 → 回写 tool 结果 → 下一轮
- 能写一个自己的 Tool（确定性能力），并让模型通过 tool calling 使用它
- 能写一个自己的 Skill（领域知识/流程），并理解 Progressive Disclosure 为什么能省 token
- 能接入一个 MCP server，把它的 tools 变成 Agent 可用的工具
- 能理解 ACP 的意义：把 Agent 的中间过程（thinking/tool 状态）流式推给宿主

## 关键概念词汇（第一次见也没关系）

- Tool calling：模型输出“我要调用哪个工具 + 参数”，你执行后把结果回传
- Progressive Disclosure：先告诉模型“有哪些技能”，需要时再加载技能全文
- MCP（Model Context Protocol）：统一协议把外部工具接进来
- ACP（Agent Client Protocol）：统一协议把 Agent 接到 IDE/编辑器里

