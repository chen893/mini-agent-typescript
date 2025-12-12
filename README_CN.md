# Mini Agent TypeScript（教学版）

本项目是 MiniMax Agent 官方仓库（https://github.com/MiniMax-AI/Mini-Agent）中 `Mini-Agent-python` 的TypeScript 教学 移植版，目标是让中文 TypeScript 开发者用“最少的工程复杂度”学习 Agent 的核心技术

- 完整的 Agent 执行循环（LLM → tool_calls → 执行工具 → 回写结果 → 下一轮）
- 工具系统（Tools）：文件读写、终端执行（含后台进程）、会话笔记（持久化）
- 上下文管理：对过长历史做“执行过程摘要”，避免上下文溢出
- Skills（渐进式加载 / Progressive Disclosure）：系统提示词只注入元数据；需要时通过 `get_skill` 按需加载 SKILL.md 全文
- MCP（Model Context Protocol）工具接入：读取 `mcp.json`，启动 stdio server 并把其工具暴露给 Agent
- 运行日志：每轮请求/响应/工具结果落盘，方便调试复盘

> 说明：这是教学项目，因此实现偏“清晰可读”，不是生产级完备；但尽量保持与 Python 版一致的能力边界与结构。

## 快速开始（Windows / macOS / Linux）

### 1) 准备配置文件

把示例配置复制为 `config.yaml`（二选一放置）：

- 开发模式：`mini-agent-typescript/config/config.yaml`
- 用户目录：`~/.mini-agent/config/config.yaml`

示例文件在：`mini-agent-typescript/config/config-example.yaml`

填入你的 MiniMax Key 与平台地址：

- 国内平台：https://platform.minimaxi.com → `api_base: https://api.minimaxi.com`
- 海外平台：https://platform.minimax.io → `api_base: https://api.minimax.io`

### 2) 构建并运行

```bash
cd mini-agent-typescript
npm run build
npm start
```

指定工作区（建议）：

```bash
npm start -- --workspace ./workspace
```

也可以用脚本一键生成用户目录配置：

- Windows: `powershell -ExecutionPolicy Bypass -File mini-agent-typescript/scripts/setup-config.ps1`
- macOS/Linux: `bash mini-agent-typescript/scripts/setup-config.sh`

### 3) 交互式使用

启动后直接输入任务即可。内置命令：

- `/help` `/clear` `/history` `/stats` `/exit`

快捷键（尽量对齐 Python 版 prompt_toolkit）：

- `Ctrl+U` 清空当前输入
- `Ctrl+L` 清屏
- `Ctrl+J` 插入换行（多行输入）
- `Tab` 命令补全
- `↑/↓` 历史输入

## Skills（强烈建议先看）

Skill 的设计与写法参考仓库根目录的 `skill.md`（渐进式加载的官方说明）。

本项目默认自带一个教学 Skill：

- `mini-agent-typescript/skills/template-skill-cn`

你可以照着它新建自己的 Skill：只要目录下有 `SKILL.md` 且带 YAML frontmatter（name/description），就会被自动发现并加载元数据。

## 学习文档（推荐）

从 `mini-agent-typescript/docs/README.md` 开始，里面给了“阅读顺序 + 心智模型 + 练习题”。

## MCP（可选）

配置文件：`mini-agent-typescript/config/mcp.json`

默认 MCP server 往往是 `disabled: true`（避免你第一次运行就拉起外部进程）。把它改为 `false` 并确保本机具备对应命令（例如 `npx`），即可让 Agent 自动加载 MCP tools。

> 说明：教学项目内置了一个“最小 JSON-RPC stdio 客户端”，用于理解 MCP 的工作方式。若遇到兼容性问题，建议改用官方 TypeScript SDK：`@modelcontextprotocol/sdk`。

## 日志与持久化记忆

- 日志（对齐 Python 版路径）：`~/.mini-agent/log/agent_run_*.log`
- 笔记（持久化记忆）：`{workspace}/.agent_memory.json`

## ACP（可选：IDE/编辑器集成）

本项目提供一个教学版 ACP stdio server：

```bash
cd mini-agent-typescript
npm run build
npm run start:acp
```

说明：
- ACP/MCP 的 stdio 协议要求 stdout 只能输出协议帧，因此 ACP 模式下不要向 stdout 打印日志（本项目已按这个约束处理）。
- 该 ACP 实现主要用于“教学理解/结构对齐”。如果你要对接某个 IDE 的正式 ACP，建议使用官方 ACP SDK（若提供 TS 版本）替换协议层。

## ESLint / Prettier（工程化配置）

本项目已提供：

- ESLint：`mini-agent-typescript/eslint.config.js`
- Prettier：`mini-agent-typescript/.prettierrc`

安装依赖后使用：

```bash
npm i
npm run lint
npm run format
```

## 与 Python 版对齐点

- LLM provider：`anthropic` / `openai` 两种协议（自动拼接 `/anthropic` 或 `/v1`）
- tool calling：对 Anthropic 的 tool_use/tool_result 与 OpenAI 的 tool_calls/tool role 做了等价映射
- Skills：只注入元数据到 system prompt；通过 `get_skill` 按需加载全文
- bash：支持前台执行与后台执行（`bash_output` 读取增量输出，`bash_kill` 终止）
- Context overflow：支持基于 token 估算触发“执行过程摘要”
