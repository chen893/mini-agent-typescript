export type Role = "system" | "user" | "assistant" | "tool";

// 说明：
// - 这里的 JsonValue 用于“工具参数/JSON Schema/LLM arguments”等场景
// - 允许 readonly array 是为了兼容 `as const` 产生的只读数组（例如 JSON Schema 的 required: ["x"] as const）
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | readonly JsonValue[]
  | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

export type LLMProvider = "anthropic" | "openai";

export interface FunctionCall {
  name: string;
  arguments: JsonObject;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: FunctionCall;
}

export interface Message {
  role: Role;
  content: string;
  // 可选：用于“思考/推理”分离（不同厂商字段不一样，内部统一存起来）
  thinking?: string;
  toolCalls?: ToolCall[];

  // tool message 需要关联 tool_call_id
  toolCallId?: string;
  name?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  finishReason: string;
  usage?: TokenUsage;
}
