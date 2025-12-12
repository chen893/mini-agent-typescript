import type { RetryConfig } from "../config.js";
import type { JsonObject, LLMProvider, LLMResponse, Message } from "../schema.js";
import type { LLMClientBase } from "./base.js";
import { AnthropicClient } from "./anthropicClient.js";
import { OpenAIClient } from "./openaiClient.js";

/**
 * 统一的 LLM Client 包装器（与 Python 版 LLMClient 的职责一致）。
 *
 * 设计目标：
 * - 上层 Agent 不关心“你是 Anthropic 协议还是 OpenAI 协议”
 * - 只关心：messages + tools -> response（包含 tool_calls / thinking / usage）
 *
 * 与 Python 版保持一致的行为：
 * - provider = anthropic: 自动在 api_base 末尾拼上 /anthropic
 * - provider = openai:    自动在 api_base 末尾拼上 /v1
 */
export class LLMClient implements LLMClientBase {
  private readonly impl: LLMClientBase;
  readonly apiBase: string;
  readonly provider: LLMProvider;

  constructor(opts: {
    apiKey: string;
    provider: LLMProvider;
    apiBase: string;
    model: string;
    retry: RetryConfig;
  }) {
    this.provider = opts.provider;

    // 兼容用户把 /anthropic 写进 api_base 的情况（Python 版也做了这个处理）
    const normalized = opts.apiBase.replace(/\/anthropic\/?$/, "").replace(/\/v1\/?$/, "");

    if (opts.provider === "anthropic") {
      this.apiBase = `${normalized.replace(/\/$/, "")}/anthropic`;
      this.impl = new AnthropicClient(opts.apiKey, this.apiBase, opts.model, opts.retry);
    } else {
      this.apiBase = `${normalized.replace(/\/$/, "")}/v1`;
      this.impl = new OpenAIClient(opts.apiKey, this.apiBase, opts.model, opts.retry);
    }
  }

  generate(messages: Message[], tools?: JsonObject[]): Promise<LLMResponse> {
    return this.impl.generate(messages, tools);
  }
}

