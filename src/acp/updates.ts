/**
 * ACP（Agent Client Protocol）更新消息构造器。
 *
 * Python 版通过 acp 库提供的 helpers 来构造这些结构：
 * - update_agent_message
 * - update_agent_thought
 * - start_tool_call
 * - update_tool_call
 *
 * 这里我们实现“教学版的最小结构”：
 * - 重点是让读者理解：ACP 是“把 Agent 的中间过程流式地发给宿主（IDE/编辑器）”
 * - 不追求与某个具体宿主 100% 字段一致（真实项目建议直接使用官方 ACP SDK）
 *
 * 为了与 Python 版阅读体验一致，我们尽量沿用相同函数名与字段命名。
 */

export type TextBlock = { type: "text"; text: string };
export type ToolContent = { type: "tool_content"; content: TextBlock[] };

export function text_block(text: string): TextBlock {
  return { type: "text", text };
}

export function tool_content(...blocks: TextBlock[]): ToolContent {
  return { type: "tool_content", content: blocks };
}

export function update_agent_message(...blocks: TextBlock[]) {
  return { type: "update_agent_message", content: blocks };
}

export function update_agent_thought(...blocks: TextBlock[]) {
  return { type: "update_agent_thought", content: blocks };
}

export function start_tool_call(toolCallId: string, label: string, kind: "execute" = "execute", raw_input?: any) {
  return { type: "start_tool_call", toolCallId, label, kind, raw_input };
}

export function update_tool_call(
  toolCallId: string,
  opts: { status: "completed" | "failed"; content: ToolContent[]; raw_output?: any }
) {
  return { type: "update_tool_call", toolCallId, status: opts.status, content: opts.content, raw_output: opts.raw_output };
}

export function session_notification(sessionId: string, update: any) {
  return { sessionId, update };
}

