# Agent 执行循环（项目的发动机）

如果你只读一个文件，请读：`src/agent/Agent.ts`。

它回答了 Agent 项目的三个灵魂问题：

1) 模型和工具如何协作？  
2) 为什么要维护 message history？  
3) 为什么要做上下文管理（摘要）？

## 1) 最小闭环：模型 → 工具 → 模型

一次完整的循环长这样：

1. 组装请求：
   - messages：system + 历史 user/assistant/tool
   - tools：当前可用工具的 schema（让模型知道“能调用哪些工具”）
2. 调用 LLM：
   - 如果模型直接回答：结束（finish）
   - 如果模型输出 tool_calls：进入下一步
3. 执行工具：
   - 找到对应 Tool 实例
   - 用 arguments 执行
4. 回写 tool message：
   - role=tool
   - toolCallId=模型发来的 tool_call.id（非常关键）
5. 回到第 1 步

你会在 `Agent.run()` 里看到这个流程（并且在控制台打印 `[tool_call]` / `[tool_result]`）。

## 2) message history 为什么这么设计？

### 2.1 role 的意义

四种 role 的意义非常工程化：

- `system`：全局规则（系统提示词 + skills metadata）
- `user`：用户需求（必须保留，不能被“摘要吞掉”）
- `assistant`：模型的自然语言输出（以及 thinking/tool_calls）
- `tool`：工具执行结果（作为“外部世界的事实”回传给模型）

### 2.2 为什么 tool message 一定要带 toolCallId？

因为模型可能在同一轮里调用多个工具。toolCallId 是“工具结果对应哪个调用”的唯一关联键。

如果你丢了它：
- 模型会“对不上号”
- 下一轮会出现：模型重复调用、或误解工具输出

## 3) interleaved thinking 为什么要“原样保留并回传”？

在 OpenAI 兼容协议里，一些端点会返回 `reasoning_details`（思考拆分）。

Python 版特别强调：你必须把它保留在 message history 并在下一轮回传，才能保证推理链不断。

TS 版同样做了这个事：
- 解析：`src/llm/openaiClient.ts`
- 回传：把 `assistant` message 的 `thinking` 映射回 `reasoning_details`

## 4) 上下文管理：为什么要做“执行过程摘要”？

Agent 跑复杂任务时会产生大量“中间过程”：
- 模型的解释
- 工具输出
- 多轮试错

这些内容占用上下文，但对“最终目标”不一定重要。

### 4.1 摘要策略（对齐 Python 版）

策略是：
- 保留所有 user messages（用户意图必须完整保留）
- 把每个 user message 之后、下一个 user message 之前的 assistant/tool 过程汇总成一条摘要消息
- 结构变成：system → user1 → summary1 → user2 → summary2 → ...

这样做的好处：
- 用户意图不丢
- 中间过程压缩
- 模型仍然知道“做过什么、用过什么工具”

### 4.2 TS 版的 token 估算为什么更粗糙？

Python 版用 tiktoken 准确算 token；TS 教学版为了零依赖，用字符数做近似（2.5 chars ≈ 1 token）。

理解重点：
- 触发摘要只需要“差不多”，不需要完全准确
- 如果你要生产级：建议引入 token 计算库做精确估算

## 5) 你可以做的一个小实验（强烈推荐）

让模型反复读写一个大文件，直到触发摘要，然后观察：
- 摘要前后 message history 的结构变化
- 模型在摘要后是否仍能继续完成任务

