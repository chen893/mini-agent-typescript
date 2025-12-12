# 练习题（从模仿到改造）

建议你边做边写笔记：每个练习你都应该能回答“我改了哪里、为什么这么改、验证方式是什么”。

## 练习 1：写一个最小 Tool（count_lines）

目标：让模型不要“猜文件行数”，而是调用工具得到确定性结果。

要求：
- 新增一个 `count_lines` tool
- 参数：`path`
- 输出：该文件总行数（数字或文本都行）

推荐步骤：
1) 在 `src/tools/` 新建 `countLinesTool.ts`
2) 在 `src/runtime/init.ts` 里注册（像其它 tools 一样 push 到 tools 数组）
3) 运行后让模型做任务：“统计 workspace 下某文件行数”

你将学到：
- Tool schema 如何影响模型调用
- workspace 路径约束怎么复用

## 练习 2：写一个 Skill（typescript-refactor）

目标：把你常用的 TS 工程化流程沉淀为 Skill。

要求：
- `skills/typescript-refactor/SKILL.md`
- frontmatter 要写好：name/description
- 主体要包含：
  - eslint/prettier 基本配置检查清单
  - 常见 TS 重构套路（例如从 any 收敛到 unknown，再到具体类型）
  - 推荐命令（npm scripts / tsc / eslint）

验证：
- 让模型完成一个“给某 TS 项目加 eslint/prettier 并修复问题”的任务
- 观察它是否先 `get_skill` 再按步骤执行

## 练习 3：启用一个 MCP server

目标：让你理解“外部工具如何进入 Agent 工具列表”。

步骤：
1) 修改 `config/mcp.json`，把某个 server 的 `disabled` 改为 `false`
2) 运行 CLI，观察启动日志中是否出现“Loaded MCP tools”
3) 设计一个会触发该工具的任务，让模型主动调用

你将学到：
- stdio JSON-RPC 的 framing（Content-Length）
- tools/list 与 tools/call 的意义

## 练习 4：把 CLI 的命令补全扩展到 Tool 名称

目标：体验“交互层”如何增强使用体验。

方向：
- 现在 CLI 只补全 `/help` 这类命令
- 你可以把 tool 名称也加进去（例如输入 `bash` 时提示）

提示：
- 入口在 `src/cli.ts` 的 completer
- editor 在 `src/interactive/LineEditor.ts`

## 练习 5：ACP 对接一个宿主

目标：理解 ACP 的价值：让宿主实时展示 thinking/tool 状态。

步骤：
1) `npm run start:acp`
2) 用你自己的“宿主脚本”连接 stdio（或把它接到某个 IDE）
3) 观察 sessionUpdate 的消息序列：initialize → newSession → prompt → (tool updates) → end_turn

你将学到：
- 为什么 ACP/MCP 都要求 stdout 纯协议帧
- 为什么要用 sessionId 管理多会话

