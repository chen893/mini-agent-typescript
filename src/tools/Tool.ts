import type { JsonObject } from "../schema.js";

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

/**
 * Tool 的参数使用 JSON Schema（简化版）来描述，便于对接 OpenAI/Anthropic 风格的 tool calling。
 * 教学项目里我们不做完整校验；真实项目建议引入 zod / ajv。
 */
export type JsonSchema = JsonObject;

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(args: JsonObject): Promise<ToolResult>;

  toAnthropicSchema(): JsonObject;
  toOpenAISchema(): JsonObject;
}

export abstract class BaseTool implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: JsonSchema;
  abstract execute(args: JsonObject): Promise<ToolResult>;

  toAnthropicSchema(): JsonObject {
    return {
      name: this.name,
      description: this.description,
      input_schema: this.parameters
    };
  }

  toOpenAISchema(): JsonObject {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }
}

