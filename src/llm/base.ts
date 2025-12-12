import type { JsonObject, LLMResponse, Message } from "../schema.js";

export interface LLMClientBase {
  /**
   * 生成一次模型响应（可能包含 tool_calls）。
   *
   * 约定：
   * - messages 是完整的对话历史（含 system / tool）
   * - tools 是“当前可用工具集合”的 schema（用于模型决定是否调用工具）
   */
  generate(messages: Message[], tools?: JsonObject[]): Promise<LLMResponse>;
}

