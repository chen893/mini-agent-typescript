import fs from "node:fs/promises";
import path from "node:path";
import type { JsonObject } from "../schema.js";
import { resolveInWorkspace } from "../utils/workspacePath.js";
import { BaseTool, type ToolResult } from "./Tool.js";

type Note = { timestamp: string; category: string; content: string };

/**
 * Session Note / Memory 工具（与 Python 版 mini_agent/tools/note_tool.py 对齐）
 *
 * 目标：
 * - 让 Agent 能“持久化”关键信息：用户偏好、重要决策、项目上下文
 * - 在后续对话中通过 recall_notes 取回（不需要每次用户手动重复说明）
 *
 * 设计取舍（教学项目）：
 * - 存储格式：JSON 数组（Note[]），易读易编辑
 * - 存储位置：工作区内 `.mini-agent/agent_memory.json`（更直观；也便于 gitignore）
 * - “懒创建”：只有第一次 record_note 才会创建目录与文件
 */

function asString(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`Expected '${name}' to be string`);
  return v;
}

export function defaultMemoryFile(workspaceDirAbs: string): string {
  // 与 Python 版保持一致：默认放在 workspace 根目录下的隐藏文件。
  // Python 版默认是 "./workspace/.agent_memory.json"（相对路径），最终效果也是落在 workspace 内。
  return resolveInWorkspace(workspaceDirAbs, ".agent_memory.json");
}

async function loadNotes(fileAbs: string): Promise<Note[]> {
  try {
    const raw = await fs.readFile(fileAbs, "utf-8");
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as Note[]) : [];
  } catch {
    // 文件不存在或 JSON 损坏：按“无记录”处理（避免影响主流程）
    return [];
  }
}

async function saveNotes(fileAbs: string, notes: Note[]): Promise<void> {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, JSON.stringify(notes, null, 2), "utf-8");
}

export class RecordNoteTool extends BaseTool {
  readonly name = "record_note";
  readonly description =
    "记录重要信息到“会话笔记/长期记忆”（带时间戳）。用于记录关键事实、用户偏好、决策结果，便于后续 recall_notes。";
  readonly parameters = {
    type: "object",
    properties: {
      content: { type: "string", description: "要记录的内容（尽量简洁但具体）" },
      category: { type: "string", description: "可选分类，如 user_preference/project_info/decision" }
    },
    required: ["content"]
  } as const;

  constructor(private readonly memoryFileAbs: string) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const content = asString(args.content, "content");
      const category = (args.category ? asString(args.category, "category") : "general") || "general";
      const notes = await loadNotes(this.memoryFileAbs);
      notes.push({ timestamp: new Date().toISOString(), category, content });
      await saveNotes(this.memoryFileAbs, notes);
      return { success: true, content: `Recorded note: ${content} (category: ${category})` };
    } catch (e) {
      return { success: false, content: "", error: (e as Error).message };
    }
  }
}

export class RecallNotesTool extends BaseTool {
  readonly name = "recall_notes";
  readonly description = "读取所有已记录的会话笔记/长期记忆，可按 category 过滤。";
  readonly parameters = {
    type: "object",
    properties: {
      category: { type: "string", description: "可选：按分类过滤" }
    }
  } as const;

  constructor(private readonly memoryFileAbs: string) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const category = args.category ? asString(args.category, "category") : undefined;
      const notes = await loadNotes(this.memoryFileAbs);
      if (!notes.length) return { success: true, content: "No notes recorded yet." };

      const filtered = category ? notes.filter((n) => n.category === category) : notes;
      if (category && !filtered.length) return { success: true, content: `No notes found in category: ${category}` };

      const out = filtered
        .map((n, i) => `${i + 1}. [${n.category}] ${n.content}\n   (recorded at ${n.timestamp})`)
        .join("\n");
      return { success: true, content: `Recorded Notes:\n${out}` };
    } catch (e) {
      return { success: false, content: "", error: (e as Error).message };
    }
  }
}
