import type { RetryConfig } from "../config.js";
import { asyncRetry } from "../retry.js";
import type { JsonObject, LLMResponse, Message, ToolCall, TokenUsage } from "../schema.js";
import type { LLMClientBase } from "./base.js";

/**
 * OpenAI 协议（兼容端点）HTTP 客户端。
 *
 * 与 Python 版保持一致：
 * - 使用 /chat/completions 接口
 * - 支持 tool calling（tools + tool_calls）
 * - 支持 reasoning_split（把“思考/推理”拆出来）
 *
 * 关键实现点：
 * - OpenAI 兼容端点通常要求：Authorization: Bearer
 * - tool_calls.arguments 是 JSON 字符串，需要 JSON.parse
 * - 一些兼容端点（如 MiniMax）会返回 reasoning_details，并要求你把它在下一轮原样带回（保持 interleaved thinking 连贯）
 */
export class OpenAIClient implements LLMClientBase {
  constructor(
    private readonly apiKey: string,
    private readonly apiBase: string,
    private readonly model: string,
    private readonly retry: RetryConfig
  ) {}

  async generate(messages: Message[], tools?: JsonObject[]): Promise<LLMResponse> {
    return asyncRetry(this.retry, async () => {
      const apiMessages = this.convertMessages(messages);

      const body: JsonObject = {
        model: this.model,
        messages: apiMessages,
        // MiniMax 的 OpenAI 兼容端点用 extra_body 开启推理拆分（与 Python 版一致）
        extra_body: { reasoning_split: true }
      };
      if (tools?.length) body.tools = tools;

      const resp = await fetch(`${this.apiBase.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`OpenAI API error: HTTP ${resp.status}\n${text}`);
      }

      const data = JSON.parse(text) as any;
      return this.parseResponse(data);
    });
  }

  private convertMessages(messages: Message[]): any[] {
    const apiMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        apiMessages.push({ role: "system", content: msg.content });
        continue;
      }

      if (msg.role === "user") {
        apiMessages.push({ role: "user", content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        const m: any = { role: "assistant" };
        if (msg.content) m.content = msg.content;

        if (msg.toolCalls?.length) {
          m.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: JSON.stringify(tc.function.arguments ?? {})
            }
          }));
        }

        // 保持 interleaved thinking：把 reasoning_details 原样回传（与 Python 版一致）
        if (msg.thinking) {
          m.reasoning_details = [{ text: msg.thinking }];
        }

        apiMessages.push(m);
        continue;
      }

      if (msg.role === "tool") {
        apiMessages.push({
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: msg.content
        });
      }
    }

    return apiMessages;
  }

  private parseResponse(data: any): LLMResponse {
    const choice = data.choices?.[0];
    const message = choice?.message ?? {};

    const content = message.content ?? "";

    // reasoning_details：数组形式
    let thinking = "";
    if (Array.isArray(message.reasoning_details)) {
      for (const d of message.reasoning_details) {
        if (d && typeof d.text === "string") thinking += d.text;
      }
    }

    const toolCalls: ToolCall[] = [];
    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        const argsText = tc?.function?.arguments;
        let args: JsonObject = {};
        if (typeof argsText === "string" && argsText.trim()) {
          try {
            args = JSON.parse(argsText);
          } catch {
            // 兼容：如果服务端返回了非 JSON 字符串，保持空对象并把原文丢给模型（tool 执行会失败并反馈）
            args = {};
          }
        }

        toolCalls.push({
          id: String(tc.id),
          type: "function",
          function: {
            name: String(tc.function?.name ?? ""),
            arguments: args
          }
        });
      }
    }

    let usage: TokenUsage | undefined;
    if (data.usage) {
      usage = {
        promptTokens: Number(data.usage.prompt_tokens ?? 0) || 0,
        completionTokens: Number(data.usage.completion_tokens ?? 0) || 0,
        totalTokens: Number(data.usage.total_tokens ?? 0) || 0
      };
    }

    return {
      content,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: "stop",
      usage
    };
  }
}

