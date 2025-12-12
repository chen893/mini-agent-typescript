# 学习路线（深入浅出）

这份路线图的目标不是“把每个文件背下来”，而是让你形成一套稳定的心智模型：你知道每层负责什么、为什么这么设计、改动会影响哪里。

## 0. 你只需要记住一句话

Agent 的本质是一段循环：

1) 把当前对话历史 + 可用工具列表发给模型  
2) 模型要么直接回答，要么要求调用工具（tool_calls）  
3) 如果要调用工具：我们执行工具，把结果作为 tool message 回写到历史  
4) 回到 1)，直到模型不再要求调用工具（任务完成）

你掌握这条循环，就掌握了 80%。

## 1. 第 1 天游泳：先跑起来

目标：不理解也没关系，先把交互跑通。

- 看：`docs/02-run-and-config.md`
- 跑：`npm run build && npm start`
- 试：输入一个简单任务，比如“读取某文件并总结”、“创建一个 README.md”

你要观察的不是回答内容，而是：
- 控制台是否打印了 `[tool_call] xxx`、`[tool_result]` 这些过程
- 工具返回结果后，模型如何在下一轮继续推进

## 2. 第 2 天看地图：搞懂项目结构

目标：知道“入口在哪、初始化在哪里、Agent 核心循环在哪里”。

- 从 `src/cli.ts` 看起：CLI 做了哪些事？
- 跟到 `src/runtime/init.ts`：配置、工具、skills、mcp 的加载都在这里
- 再到 `src/agent/Agent.ts`：这里是整套系统的“发动机”

配套阅读：`docs/03-architecture.md`

## 3. 第 3 天抓核心：Agent loop

目标：能用自己的话讲清楚“为什么需要 tool message”、“为什么要保留 thinking”、“为什么要做摘要”。

- 阅读：`docs/04-agent-loop.md`
- 实验：把 `max_steps` 改小/改大，观察模型行为

## 4. 第 4 天学工程化：Tools

目标：能写一个新 Tool，并让模型正确调用。

推荐做一个非常实用的练习：
- 写一个 `count_lines` 工具：统计某个文件有多少行
- 在 prompt 中让模型用工具给出结果，而不是“猜”

配套阅读：`docs/05-tools.md`、练习：`docs/10-exercises.md`

## 5. 第 5 天学省 token：Skills（渐进式加载）

目标：理解“为什么不把所有技能内容一次性塞进 system prompt”。

你会看到：
- system prompt 只注入 skills 的 name/description（Level 1）
- 当模型判断需要某 skill 时，才调用 `get_skill` 拉取全文（Level 2）
- skill 内容里引用脚本/参考文档时，我们把相对路径替换为绝对路径（Level 3）

配套阅读：`docs/06-skills.md`

## 6. 第 6 天学扩展：MCP

目标：理解“外部工具如何变成 Agent tool”。

你会做的事：
- 在 `config/mcp.json` 打开一个 server（disabled: false）
- 让 Agent 自动加载 MCP tools
- 观察 MCP tool 的输入 schema 与返回内容如何进入对话历史

配套阅读：`docs/07-mcp.md`

## 7. 第 7 天学集成：ACP

目标：理解“把 Agent 的中间过程推给 IDE/编辑器”的价值。

你会看到：
- ACP session 对应一个 Agent 实例（各自 workspace 与历史）
- prompt 是“一次 turn”，turn 内会多次调用 LLM + tools
- sessionUpdate 让宿主实时看到思考/工具状态，而不是等最终答案

配套阅读：`docs/08-acp.md`

