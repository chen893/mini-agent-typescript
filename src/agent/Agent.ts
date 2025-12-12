import path from "node:path";
import type { LLMClient } from "../llm/LLMClient.js";
import { AgentLogger } from "../logger.js";
import type { JsonObject, Message, ToolCall } from "../schema.js";
import type { Tool, ToolResult } from "../tools/Tool.js";

const SUMMARY_MARKER = "[Assistant Execution Summary]";

/**
 * Agent（与 Python 版 mini_agent/agent.py 尽量保持一致）
 *
 * 核心职责：
 * - 维护 message history（system/user/assistant/tool）
 * - 反复调用 LLM，直到：
 *   - 模型不再发起 tool_calls（认为任务完成），或
 *   - 达到 max_steps（防止无限循环）
 * - 执行 tool_calls，并把 tool 结果回写到 message history
 * - 进行“上下文管理”：当历史过长时，对执行过程做摘要（避免上下文溢出）
 *
 * 重要概念：
 * - Tool calling：模型输出 tool_calls，我们执行，然后把结果作为 role=tool 回传给模型
 * - Progressive Disclosure（Skills）：系统提示词只注入技能元数据；需要时由模型调用 get_skill 加载全文
 */
export class Agent {
  readonly tools: Record<string, Tool>;
  readonly messages: Message[];

  // API 返回的“最近一次请求 totalTokens”（prompt+completion），不是累计值。
  private apiLastTotalTokens = 0;
  private skipNextTokenCheck = false;
  private readonly logger: AgentLogger;
  private readonly workspaceDirAbs: string;
  private readonly verbose: boolean;

  constructor(opts: {
    llm: LLMClient;
    systemPrompt: string;
    tools: Tool[];
    maxSteps: number;
    tokenLimit: number;
    workspaceDir: string;
    verbose?: boolean;
  }) {
    this.llm = opts.llm;
    this.tools = Object.fromEntries(opts.tools.map((t) => [t.name, t]));
    this.maxSteps = opts.maxSteps;
    this.tokenLimit = opts.tokenLimit;
    this.workspaceDirAbs = path.resolve(opts.workspaceDir);
    this.logger = new AgentLogger();
    this.verbose = opts.verbose ?? true;

    // 与 Python 版一致：把 workspace 信息注入 system prompt（如果尚未包含）
    let systemPrompt = opts.systemPrompt;
    if (!systemPrompt.includes("Current Workspace")) {
      systemPrompt +=
        `\n\n## Current Workspace\n` +
        `You are currently working in: \`${this.workspaceDirAbs}\`\n` +
        `All relative paths will be resolved relative to this directory.`;
    }

    this.messages = [{ role: "system", content: systemPrompt }];
  }

  private readonly llm: LLMClient;
  private readonly maxSteps: number;
  private readonly tokenLimit: number;

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  /**
   * token 估算（教学项目的简化版）：
   * - Python 版使用 tiktoken 做准确估算
   * - TS 教学版避免引入额外依赖，采用字符数近似（平均 2.5 字符 ≈ 1 token）
   *
   * 说明：
   * - 这是“触发摘要”的启发式；不要求完全准确
   */
  private estimateTokensFallback(): number {
    let chars = 0;
    for (const m of this.messages) {
      chars += m.content.length;
      if (m.thinking) chars += m.thinking.length;
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
    }
    return Math.floor(chars / 2.5);
  }

  /**
   * 与 Python 版一致的摘要策略：
   * - 保留所有 user 消息（用户意图必须完整保留）
   * - 将每个 user 消息之后、下一个 user 消息之前的“执行过程”（assistant/tool）汇总成一条摘要消息
   * - 结构：system -> user1 -> summary1 -> user2 -> summary2 -> ...
   */
  private async summarizeMessagesIfNeeded(): Promise<void> {
    if (this.skipNextTokenCheck) {
      this.skipNextTokenCheck = false;
      return;
    }

    const estimated = this.estimateTokensFallback();
    const should = estimated > this.tokenLimit || this.apiLastTotalTokens > this.tokenLimit;
    if (!should) return;

    if (this.verbose) {
      console.log(
        `\n[context] token usage (estimated=${estimated}, api_total=${this.apiLastTotalTokens}, limit=${this.tokenLimit})`
      );
      console.log("[context] triggering message history summarization...");
    }

    const userIdx: number[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i]!.role === "user" && i > 0) userIdx.push(i);
    }
    if (!userIdx.length) return;

    const newMessages: Message[] = [this.messages[0]!];
    let summaryCount = 0;

    for (let i = 0; i < userIdx.length; i++) {
      const cur = userIdx[i]!;
      const next = i < userIdx.length - 1 ? userIdx[i + 1]! : this.messages.length;

      newMessages.push(this.messages[cur]!); // 保留 user 消息

      const execMessages = this.messages.slice(cur + 1, next);
      if (execMessages.length) {
        // 避免重复触发摘要时出现“摘要的摘要”。
        if (
          execMessages.length === 1 &&
          execMessages[0]!.role === "assistant" &&
          execMessages[0]!.content.startsWith(SUMMARY_MARKER)
        ) {
          newMessages.push(execMessages[0]!);
          continue;
        }

        const summaryText = await this.createSummary(execMessages, i + 1);
        if (summaryText) {
          newMessages.push({
            // 使用 assistant，避免覆盖 Anthropic 的单 system 字段。
            role: "assistant",
            content: `${SUMMARY_MARKER}\n\n${summaryText}`
          });
          summaryCount++;
        }
      }
    }

    this.messages.length = 0;
    this.messages.push(...newMessages);

    this.skipNextTokenCheck = true;
    void summaryCount; // 与 Python 版日志保持一致；CLI 里可按需打印
  }

  private async createSummary(messages: Message[], roundNum: number): Promise<string> {
    if (!messages.length) return "";

    const MAX_SUMMARY_INPUT_CHARS = 40_000;
    const MAX_TOOL_SNIPPET_CHARS = 2_000;
    const MAX_ASSISTANT_SNIPPET_CHARS = 4_000;

    // 为了最大化一致性，这里复刻 Python 版 summary prompt 的风格与要求（英文摘要）。
    let summaryContent = `Round ${roundNum} execution process:\n\n`;
    for (const msg of messages) {
      if (msg.role === "assistant") {
        summaryContent += `Assistant: ${truncateForSummary(msg.content, MAX_ASSISTANT_SNIPPET_CHARS)}\n`;
        if (msg.toolCalls?.length) {
          const names = msg.toolCalls.map((t) => t.function.name);
          summaryContent += `  -> Called tools: ${names.join(", ")}\n`;
        }
      } else if (msg.role === "tool") {
        summaryContent += `  <- Tool returned: ${truncateForSummary(msg.content, MAX_TOOL_SNIPPET_CHARS)}\n`;
      }

      if (summaryContent.length >= MAX_SUMMARY_INPUT_CHARS) {
        summaryContent += "\n...(truncated summary input to avoid context overflow)...\n";
        break;
      }
    }

    const summaryPrompt =
      "Please provide a concise summary of the following Agent execution process:\n\n" +
      summaryContent +
      "\n\nRequirements:\n" +
      "1. Focus on what tasks were completed and which tools were called\n" +
      "2. Keep key execution results and important findings\n" +
      "3. Be concise and clear, within 1000 words\n" +
      "4. Use English\n" +
      '5. Do not include "user" related content, only summarize the Agent\'s execution process';

    const resp = await this.llm.generate(
      [
        { role: "system", content: "You are an assistant skilled at summarizing Agent execution processes." },
        { role: "user", content: summaryPrompt }
      ],
      undefined
    );

    return resp.content ?? "";
  }

  /**
   * 主执行循环（与 Python 版 Agent.run() 对齐）
   */
  async run(): Promise<string> {
    await this.logger.startNewRun();
    if (this.verbose) {
      console.log(`📝 Log file: ${this.logger.getLogFilePath()}`);
    }

    for (let step = 0; step < this.maxSteps; step++) {
      await this.summarizeMessagesIfNeeded();

      if (this.verbose) {
        console.log(`\n=== Step ${step + 1}/${this.maxSteps} ===`);
      }

      // 把工具 schema 发给模型（不同 provider 的 schema 形状不同）
      const toolSchemas = Object.values(this.tools).map((t) =>
        this.llm.provider === "anthropic" ? t.toAnthropicSchema() : t.toOpenAISchema()
      );

      await this.logger.logRequest({
        messages: this.messages,
        toolNames: Object.values(this.tools).map((t) => t.name)
      });
      const response = await this.llm.generate(this.messages, toolSchemas);
      this.apiLastTotalTokens = response.usage?.totalTokens ?? this.apiLastTotalTokens;

      await this.logger.logResponse({
        content: response.content,
        thinking: response.thinking,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: (response.usage as unknown as JsonObject) ?? null
      });

      // 把 assistant 消息写入历史（思考 + tool_calls 也要保留，保证 interleaved thinking 连贯）
      this.messages.push({
        role: "assistant",
        content: response.content,
        thinking: response.thinking,
        toolCalls: response.toolCalls
      });

      if (this.verbose) {
        if (response.thinking) console.log(`\n[thinking]\n${response.thinking}`);
        if (response.content) console.log(`\n[assistant]\n${response.content}`);
      }

      // 如果没有 tool_calls，任务结束
      if (!response.toolCalls?.length) return response.content;

      // 执行工具调用
      for (const call of response.toolCalls) {
        const name = call.function.name;
        const args = call.function.arguments;

        if (this.verbose) {
          const preview = JSON.stringify(truncateArgs(args), null, 2);
          console.log(`\n[tool_call] ${name}`);
          console.log(preview);
        }

        const tool = this.tools[name];
        if (!tool) {
          const err = `Unknown tool: ${name}`;
          await this.logger.logToolResult({ toolName: name, arguments: args, success: false, resultError: err });
          this.messages.push({ role: "tool", content: `Error: ${err}`, toolCallId: call.id, name });
          continue;
        }

        let result: ToolResult;
        try {
          result = await tool.execute(args);
        } catch (e) {
          result = { success: false, content: "", error: `Tool execution failed: ${(e as Error).message}` };
        }

        await this.logger.logToolResult({
          toolName: name,
          arguments: args,
          success: result.success,
          resultContent: result.success ? result.content : undefined,
          resultError: result.success ? undefined : result.error
        });

        if (this.verbose) {
          if (result.success) {
            console.log(`\n[tool_result] ✅ ${name}`);
            console.log(truncateText(result.content, 1200));
          } else {
            console.log(`\n[tool_result] ❌ ${name}`);
            console.log(result.error ?? "Tool execution failed");
          }
        }

        this.messages.push({
          role: "tool",
          content: result.success ? result.content : `Error: ${result.error ?? "Tool execution failed"}`,
          toolCallId: call.id,
          name
        });
      }
    }

    return `Task couldn't be completed after ${this.maxSteps} steps.`;
  }
}

function truncateArgs(args: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(args)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    out[k] = s.length > 200 ? (s.slice(0, 200) + "...") : (v as any);
  }
  return out;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... (truncated)";
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headLen = Math.floor(maxChars * 0.7);
  const tailLen = Math.max(0, maxChars - headLen);
  const head = text.slice(0, headLen);
  const tail = tailLen ? text.slice(-tailLen) : "";
  return `${head}\n... (truncated ${text.length} chars) ...\n${tail}`;
}
