import type { RetryConfig } from "../config.js";
import { asyncRetry } from "../retry.js";
import type { JsonObject, LLMResponse, Message, ToolCall, TokenUsage } from "../schema.js";
import type { LLMClientBase } from "./base.js";

/**
 * Anthropic 协议（兼容端点）HTTP 客户端。
 *
 * 与 Python 版保持一致：
 * - 使用 /messages 接口
 * - 支持 thinking block
 * - 支持 tool_use / tool_result
 *
 * 备注：
 * - 这里不引入官方 SDK，直接用 fetch 实现，便于 TypeScript 教学阅读。
 * - 不同兼容厂商对 header 的要求可能略有差异；我们尽量同时兼容：
 *   - Anthropic 官方：x-api-key + anthropic-version
 *   - 一些兼容端点：Authorization: Bearer
 */
export class AnthropicClient implements LLMClientBase {
  constructor(
    private readonly apiKey: string,
    private readonly apiBase: string,
    private readonly model: string,
    private readonly retry: RetryConfig
  ) {}

  async generate(messages: Message[], tools?: JsonObject[]): Promise<LLMResponse> {
    return asyncRetry(this.retry, async () => {
      const { system, apiMessages } = this.convertMessages(messages);

      const body: JsonObject = {
        model: this.model,
        max_tokens: 16384,
        messages: apiMessages
      };
      if (system) body.system = system;
      if (tools?.length) body.tools = tools;

      const resp = await fetch(`${this.apiBase.replace(/\/$/, "")}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          authorization: `Bearer ${this.apiKey}`,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body)
      });

      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`Anthropic API error: HTTP ${resp.status}\n${text}`);
      }

      const data = JSON.parse(text) as any;
      return this.parseResponse(data);
    });
  }

  /**
   * 把内部 Message 结构转换为 Anthropic 协议所需的 messages。
   *
   * 关键点（与 Python 版一致）：
   * - system message 单独放在 system 字段
   * - assistant 若包含 thinking/tool_calls，需要把内容拆成 content blocks
   * - tool 结果要用 user role + tool_result block 回传给模型
   */
  private convertMessages(messages: Message[]): { system: string | null; apiMessages: any[] } {
    let system: string | null = null;
    const apiMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        system = msg.content;
        continue;
      }

      if (msg.role === "user") {
        apiMessages.push({ role: "user", content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        const hasBlocks = Boolean(msg.thinking) || Boolean(msg.toolCalls?.length);
        if (!hasBlocks) {
          apiMessages.push({ role: "assistant", content: msg.content });
          continue;
        }

        const blocks: any[] = [];
        if (msg.thinking) blocks.push({ type: "thinking", thinking: msg.thinking });
        if (msg.content) blocks.push({ type: "text", text: msg.content });
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: tc.function.arguments
            });
          }
        }
        apiMessages.push({ role: "assistant", content: blocks });
        continue;
      }

      if (msg.role === "tool") {
        apiMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId,
              content: msg.content
            }
          ]
        });
      }
    }

    return { system, apiMessages };
  }

  private parseResponse(data: any): LLMResponse {
    // Anthropic 返回：{ content: [{type,text/thinking/...}], stop_reason, usage: {input_tokens, output_tokens} }
    let content = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content ?? []) {
      if (block.type === "text") content += block.text ?? "";
      if (block.type === "thinking") thinking += block.thinking ?? "";
      if (block.type === "tool_use") {
        toolCalls.push({
          id: String(block.id),
          type: "function",
          function: { name: String(block.name), arguments: (block.input ?? {}) as JsonObject }
        });
      }
    }

    let usage: TokenUsage | undefined;
    if (data.usage) {
      const promptTokens = Number(data.usage.input_tokens ?? 0) || 0;
      const completionTokens = Number(data.usage.output_tokens ?? 0) || 0;
      usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
    }

    return {
      content,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: String(data.stop_reason ?? "stop"),
      usage
    };
  }
}

