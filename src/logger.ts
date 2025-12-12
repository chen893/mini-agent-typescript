import fs from "node:fs/promises";
import path from "node:path";
import type { JsonObject, Message, ToolCall } from "./schema.js";
import { getHomeDir } from "./utils/homeDir.js";

/**
 * AgentLogger（尽量对齐 Python 版 mini_agent/logger.py）
 *
 * 设计目标：
 * - “每次 run”生成一个独立日志文件
 * - 记录：LLM 请求 / LLM 响应 / 工具执行结果
 * - 让教学读者可以直接打开日志复盘：模型何时调用了什么工具、工具返回了什么、模型下一轮怎么继续
 *
 * 与 Python 版保持一致的点：
 * - 日志目录：~/.mini-agent/log/
 * - 文件名：agent_run_YYYYMMDD_HHMMSS.log
 * - 文本日志格式：带分隔线与递增 index
 */
export class AgentLogger {
  private logDirAbs = "";
  private logFileAbs = "";
  private logIndex = 0;

  constructor() {
    this.logDirAbs = path.resolve(getHomeDir(), ".mini-agent", "log");
  }

  async startNewRun(): Promise<void> {
    await fs.mkdir(this.logDirAbs, { recursive: true });
    const ts = formatTimestampForFilename(new Date());
    this.logFileAbs = path.resolve(this.logDirAbs, `agent_run_${ts}.log`);
    this.logIndex = 0;

    const header =
      "=".repeat(80) +
      "\n" +
      `Agent Run Log - ${formatTimestampForHuman(new Date())}\n` +
      "=".repeat(80) +
      "\n\n";
    await fs.writeFile(this.logFileAbs, header, "utf-8");
  }

  getLogFilePath(): string {
    return this.logFileAbs;
  }

  async logRequest(opts: { messages: Message[]; toolNames: string[] }): Promise<void> {
    this.logIndex += 1;

    // 为了尽量对齐 Python 版日志：把 messages 结构完整写入（包含 thinking/toolCalls/toolCallId 等）
    const requestData: JsonObject = {
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
        thinking: m.thinking ?? null,
        tool_calls: (m.toolCalls ?? null) as any,
        tool_call_id: m.toolCallId ?? null,
        name: m.name ?? null
      })),
      tools: opts.toolNames
    };

    const content = "LLM Request:\n\n" + JSON.stringify(requestData, null, 2);
    await this.writeLog("REQUEST", content);
  }

  async logResponse(opts: {
    content: string;
    thinking?: string;
    toolCalls?: ToolCall[];
    finishReason?: string;
    usage?: JsonObject;
  }): Promise<void> {
    this.logIndex += 1;

    const responseData: JsonObject = {
      content: opts.content,
      thinking: opts.thinking ?? null,
      tool_calls: (opts.toolCalls ?? null) as any,
      finish_reason: opts.finishReason ?? null,
      usage: opts.usage ?? null
    };

    const content = "LLM Response:\n\n" + JSON.stringify(responseData, null, 2);
    await this.writeLog("RESPONSE", content);
  }

  async logToolResult(opts: {
    toolName: string;
    arguments: JsonObject;
    success: boolean;
    resultContent?: string;
    resultError?: string;
  }): Promise<void> {
    this.logIndex += 1;

    const toolData: JsonObject = {
      tool_name: opts.toolName,
      arguments: opts.arguments,
      success: opts.success,
      result: opts.success ? (opts.resultContent ?? "") : null,
      error: opts.success ? null : (opts.resultError ?? "Tool execution failed")
    };

    const content = "Tool Execution:\n\n" + JSON.stringify(toolData, null, 2);
    await this.writeLog("TOOL_RESULT", content);
  }

  private async writeLog(kind: string, content: string): Promise<void> {
    if (!this.logFileAbs) return;

    const entry =
      "\n" +
      "-".repeat(80) +
      "\n" +
      `[${this.logIndex}] ${kind}\n` +
      `Timestamp: ${formatTimestampForHuman(new Date())}\n` +
      "-".repeat(80) +
      "\n" +
      content +
      "\n";

    await fs.appendFile(this.logFileAbs, entry, "utf-8");
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestampForFilename(d: Date): string {
  // YYYYMMDD_HHMMSS（用于文件名）
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    "_" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function formatTimestampForHuman(d: Date): string {
  // YYYY-MM-DD HH:mm:ss.SSS（用于日志展示）
  return (
    String(d.getFullYear()) +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds()) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}
