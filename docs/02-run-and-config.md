# 运行与配置（先跑起来）

本项目支持两种协议（与 Python 版一致）：

- `provider: anthropic`：走 Anthropic Messages 协议（自动使用 `${api_base}/anthropic`）
- `provider: openai`：走 OpenAI Chat Completions 协议（自动使用 `${api_base}/v1`）

## 1) 准备 config.yaml

你可以把配置放在任意一个位置（按优先级查找）：

1. `mini-agent-typescript/config/config.yaml`（开发模式：项目内）
2. `~/.mini-agent/config/config.yaml`（用户目录：推荐）

快速生成用户目录配置：

- Windows:
  - `powershell -ExecutionPolicy Bypass -File mini-agent-typescript/scripts/setup-config.ps1`
- macOS/Linux:
  - `bash mini-agent-typescript/scripts/setup-config.sh`

然后编辑 `config.yaml` 填入：

- `api_key`
- `api_base`（国内：https://api.minimaxi.com；海外：https://api.minimax.io）
- `provider`（anthropic/openai）

示例文件参考：`mini-agent-typescript/config/config-example.yaml`

## 2) 构建与运行

```bash
cd mini-agent-typescript
npm run build
npm start -- --workspace ./workspace
```

提示：
- `--workspace` 强烈建议显式指定（对“文件工具路径解析”更直观）
- 运行时会自动创建 workspace 目录

## 3) 常用内置命令（CLI 内）

- `/help`：帮助
- `/clear`：清空会话（保留 system prompt）
- `/history`：查看 message 数量
- `/stats`：会话统计
- `/exit`：退出

快捷键（类 prompt_toolkit）：
- `Ctrl+U`：清空当前输入
- `Ctrl+L`：清屏
- `Ctrl+J`：插入换行（多行输入）
- `Tab`：命令补全
- `↑/↓`：历史输入

## 4) 你应该先试的 3 个任务

1. 文件读写链路：
   - “在工作区创建一个 hello.txt，写入两行内容，然后读取并带行号打印”
2. bash 工具链路：
   - “运行 `node -v` 并告诉我输出”
3. skills 链路：
   - “我想创建一个新的 Skill，参考 template-skill-cn 给我生成目录结构和 SKILL.md”

你要观察的重点不是答案，而是过程：
- 是否出现 tool_call / tool_result
- 是否按需加载了 `get_skill`

