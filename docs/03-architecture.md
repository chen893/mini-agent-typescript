# 项目结构导览（先建立地图）

这份导览的目标：让你知道每一层的职责边界是什么。Agent 项目最怕“所有逻辑混在一个文件里”，因为你很快会无法安全扩展。

## 1) 目录结构（你需要记住的部分）

核心代码在 `mini-agent-typescript/src/`：

- `src/cli.ts`：交互式入口（类似 Python 版 `mini_agent/cli.py`）
- `src/runtime/init.ts`：初始化层（加载 config、skills、mcp、组装 tools、创建 Agent）
- `src/agent/Agent.ts`：Agent 核心循环（最重要）
- `src/llm/*`：协议适配（Anthropic/OpenAI 两套 HTTP 请求/响应解析）
- `src/tools/*`：工具系统（文件、bash、note、skills、mcp）
- `src/acp/*`：ACP server（可选，IDE/编辑器集成）
- `src/interactive/*`：CLI 交互增强（历史、补全、多行输入）

资源与配置：

- `mini-agent-typescript/config/*`：示例 config.yaml / system_prompt.md / mcp.json
- `mini-agent-typescript/skills/*`：内置 Skills（从 Python 版同步）
- `skill.md`（仓库根目录）：Skills 的“官方解释/参考文档”

## 2) 从入口走一遍（强烈推荐跟读）

建议你打开 `src/cli.ts`，按下面顺序跟读：

1. 解析参数：workspace / version
2. `loadConfig()`：加载 config.yaml（含 fallback 与报错策略）
3. `initializeBaseTools()`：
   - bash 工具
   - skills loader + get_skill 工具
   - mcp tools（从 mcp.json 拉起 server 并包装为 tools）
4. `createAgentRuntime()`：
   - 读取 system prompt
   - 注入 skills metadata
   - 追加 workspace 工具（file/note）
   - 创建 Agent 实例
5. 进入交互循环：读取用户输入 → `agent.addUserMessage()` → `agent.run()`

其中第 3-4 步被抽到了 `src/runtime/init.ts`，目的是：
- CLI 与 ACP server 共用同一套初始化逻辑（对齐 Python 版工程结构）
- 新手读者更容易定位“初始化在哪里”

## 3) 配置是怎么影响行为的？

你改 config.yaml 的某一项，项目行为变化大致在这些点发生：

- `provider/api_base/model` → `src/llm/LLMClient.ts`
- `tools.enable_*` → `src/runtime/init.ts` 决定加载哪些 tools
- `skills_dir` → `src/runtime/init.ts` + `src/tools/skills/skillLoader.ts`
- `mcp_config_path` → `src/tools/mcpLoader.ts`
- `max_steps/token_limit` → `src/agent/Agent.ts`

## 4) “保持与 Python 版一致”的策略

你会在代码里看到大量对齐点：

- 同名工具：`read_file/write_file/edit_file`、`bash/bash_output/bash_kill`、`record_note/recall_notes`、`get_skill`
- 相同的 message role 设计：system/user/assistant/tool
- OpenAI 兼容端点的 reasoning_details 透传（保持 interleaved thinking 连贯）
- Skills 渐进式加载：metadata-only prompt（Level 1）+ get_skill（Level 2）+ 资源路径替换（Level 3）
- MCP：读取 `mcp.json`，启动 stdio server，tools/list + tools/call
- ACP：session → Agent 实例；prompt → 一次 turn；sessionUpdate 流式推送过程

如果你要做“功能等价扩展”，建议优先保持这些边界不变：这会让你同时能读懂 Python 与 TS 两套实现。

