import path from "node:path";

import type { AppConfig } from "../config.js";
import type { LLMClient } from "../llm/LLMClient.js";
import type { Message } from "../schema.js";
import type { Tool } from "../tools/Tool.js";
import { createAgentRuntime } from "../runtime/init.js";
import {
  session_notification,
  start_tool_call,
  text_block,
  tool_content,
  update_agent_message,
  update_agent_thought,
  update_tool_call
} from "./updates.js";

/**
 * MiniMaxACPAgent（尽量对齐 Python 版 mini_agent/acp/__init__.py 的逻辑）
 *
 * 它做的事：
 * - 把“我们的 Agent runtime（LLM + Tools + message history）”包装成 ACP 的会话/请求模型
 * - 一个 ACP session 对应一个 Agent 实例（有独立的 workspace 与历史）
 * - prompt() 会触发一次“turn”（最多 max_steps），并把中间过程通过 sessionUpdate 发给宿主
 *
 * 注意：
 * - Python 版依赖 acp SDK 来处理协议细节；TS 教学版实现最小适配层
 * - 如果你要对接真实 IDE（如 Zed）的 ACP，建议替换为官方 ACP SDK（如果提供 TS 版本）
 */

export type InitializeRequest = { protocolVersion?: string | number };
export type InitializeResponse = {
  protocolVersion: number;
  agentCapabilities: { loadSession: boolean };
  agentInfo: { name: string; title: string; version: string };
};

export type NewSessionRequest = { cwd?: string | null };
export type NewSessionResponse = { sessionId: string };

export type PromptBlock = { text: string };
export type PromptRequest = { sessionId: string; prompt: PromptBlock[] };
export type PromptResponse = { stopReason: string };

export type CancelNotification = { sessionId: string };

export interface ACPConnection {
  sessionUpdate(payload: any): Promise<void>;
}

type SessionState = { agent: any; cancelled: boolean };

function uuid8(): string {
  // 教学项目：避免引入依赖时的实现；这里用随机数，稳定性够用
  return Math.random().toString(16).slice(2, 10);
}

export class MiniMaxACPAgent {
  private sessions = new Map<string, SessionState>();

  constructor(
    private readonly conn: ACPConnection,
    private readonly config: AppConfig,
    private readonly llm: LLMClient,
    private readonly baseTools: Tool[],
    private readonly systemPrompt: string
  ) {}

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    void params;
    // Python 版从 acp.PROTOCOL_VERSION 返回；这里用 1 作为教学默认值
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "mini-agent-typescript", title: "Mini-Agent TypeScript", version: "0.1.0" }
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = `sess-${this.sessions.size}-${uuid8()}`;

    // workspace：优先使用 params.cwd（宿主传入），否则用 config 默认
    const workspaceDirAbs = path.resolve(params.cwd || this.config.agent.workspaceDir);

    // 为每个 session 创建独立 agent（共享 llm/baseTools/systemPrompt）
    const agent = await createAgentRuntime({
      config: this.config,
      workspaceDirAbs,
      baseTools: this.baseTools,
      skillLoader: null, // systemPrompt 已经由外部注入过 skills metadata（与 Python 版一致）
      llm: this.llm,
      systemPrompt: this.systemPrompt,
      verbose: false // ACP 模式：不要向 stdout 打印（会干扰协议）
    });

    this.sessions.set(sessionId, { agent, cancelled: false });
    return { sessionId };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const state = this.sessions.get(params.sessionId);
    if (!state) return { stopReason: "refusal" };

    state.cancelled = false;

    // ACP prompt 是 blocks；我们按 Python 版逻辑拼成纯文本
    const userText = params.prompt.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n");
    state.agent.messages.push({ role: "user", content: userText } satisfies Message);

    const stopReason = await this.runTurn(state, params.sessionId);
    return { stopReason };
  }

  async cancel(params: CancelNotification): Promise<void> {
    const state = this.sessions.get(params.sessionId);
    if (state) state.cancelled = true;
  }

  private async runTurn(state: SessionState, sessionId: string): Promise<string> {
    const agent = state.agent;

    for (let i = 0; i < this.config.agent.maxSteps; i++) {
      if (state.cancelled) return "cancelled";

      // tool schemas（与 Agent.run 的逻辑一致）
      const toolSchemas = Object.values(agent.tools as Record<string, Tool>).map((t) =>
        this.llm.provider === "anthropic" ? t.toAnthropicSchema() : t.toOpenAISchema()
      );

      let resp;
      try {
        resp = await this.llm.generate(agent.messages, toolSchemas);
      } catch (e) {
        await this.send(sessionId, update_agent_message(text_block(`Error: ${(e as Error).message}`)));
        return "refusal";
      }

      if (resp.thinking) await this.send(sessionId, update_agent_thought(text_block(resp.thinking)));
      if (resp.content) await this.send(sessionId, update_agent_message(text_block(resp.content)));

      agent.messages.push({
        role: "assistant",
        content: resp.content,
        thinking: resp.thinking,
        toolCalls: resp.toolCalls
      });

      if (!resp.toolCalls?.length) return "end_turn";

      for (const call of resp.toolCalls) {
        const name = call.function.name;
        const args = call.function.arguments;

        const argsPreview =
          args && typeof args === "object"
            ? Object.entries(args)
                .slice(0, 2)
                .map(([k, v]) => `${k}=${String(v).slice(0, 50)}`)
                .join(", ")
            : "";
        const label = argsPreview ? `🔧 ${name}(${argsPreview})` : `🔧 ${name}()`;

        await this.send(sessionId, start_tool_call(call.id, label, "execute", args));

        const tool: Tool | undefined = agent.tools[name];
        let text = "";
        let status: "completed" | "failed" = "completed";

        if (!tool) {
          status = "failed";
          text = `❌ Unknown tool: ${name}`;
        } else {
          try {
            const result = await tool.execute(args);
            status = result.success ? "completed" : "failed";
            text = result.success ? `✅ ${result.content}` : `❌ ${result.error ?? "Tool execution failed"}`;
          } catch (e) {
            status = "failed";
            text = `❌ Tool error: ${(e as Error).message}`;
          }
        }

        await this.send(
          sessionId,
          update_tool_call(call.id, { status, content: [tool_content(text_block(text))], raw_output: text })
        );

        agent.messages.push({ role: "tool", content: text, toolCallId: call.id, name });
      }
    }

    return "max_turn_requests";
  }

  private async send(sessionId: string, update: any): Promise<void> {
    await this.conn.sessionUpdate(session_notification(sessionId, update));
  }
}
