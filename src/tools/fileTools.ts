import fs from "node:fs/promises";
import path from "node:path";
import type { JsonObject } from "../schema.js";
import { resolveInWorkspace } from "../utils/workspacePath.js";
import { BaseTool, type ToolResult } from "./Tool.js";

/**
 * 文件工具（与 Python 版 mini_agent/tools/file_tools.py 对齐）
 *
 * 设计目标：
 * - Agent 读文件时：输出带行号，方便模型做“精确定位与引用”
 * - Agent 写文件时：明确“会覆盖”，避免隐式修改导致不可控
 * - Agent 编辑文件时：采用“精确字符串替换”，保证修改是确定性的（避免模型自己拼 patch）
 *
 * 安全边界（非常重要）：
 * - 所有相对路径都必须解析到 workspaceDir 内，禁止 `../` 路径逃逸
 *   （生产级实现还需要处理符号链接等边界，这里是教学简化版）
 */

function asString(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`Expected '${name}' to be string`);
  return v;
}

function asNumberOpt(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Expected '${name}' to be number`);
  return v;
}

function withLineNumbers(lines: string[], startLineNo: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const n = startLineNo + i;
    out.push(`${String(n).padStart(6, " ")}|${lines[i]}`);
  }
  return out.join("\n");
}

/**
 * 教学项目里的“输出截断”：
 * - Python 版用 tiktoken 按 token 截断（更准确）
 * - TS 版为了零依赖，按字符截断，并保留 head+tail（便于看到开头/结尾信息）
 */
const DEFAULT_MAX_CHARS = 200_000;
function truncateText(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const tail = text.slice(-Math.floor(maxChars * 0.4));
  return `${head}\n\n... [Content truncated: ${text.length} chars -> ${maxChars} chars limit] ...\n\n${tail}`;
}

export class ReadFileTool extends BaseTool {
  readonly name = "read_file";
  readonly description =
    "读取文件内容（输出包含行号：LINE|CONTENT，1 起）。支持 offset/limit 用于大文件分块读取。";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（绝对或相对工作区）" },
      offset: { type: "number", description: "起始行号（1 起）" },
      limit: { type: "number", description: "读取行数" }
    },
    required: ["path"]
  } as const;

  constructor(private readonly workspaceDirAbs: string) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const p = asString(args.path, "path");
      const offset = asNumberOpt(args.offset, "offset");
      const limit = asNumberOpt(args.limit, "limit");

      // 关键：把路径限制在 workspace 内
      const absPath = resolveInWorkspace(this.workspaceDirAbs, p);
      const raw = await fs.readFile(absPath, "utf-8");
      const lines = raw.split(/\r?\n/);

      // offset/limit（1 起）用于大文件分块读取，避免一次把整个文件塞进上下文
      const start = Math.max(0, (offset ? offset - 1 : 0) | 0);
      const end = Math.min(lines.length, limit ? start + (limit | 0) : lines.length);
      const selected = lines.slice(start, end);

      const content = truncateText(withLineNumbers(selected, start + 1));
      return { success: true, content };
    } catch (e) {
      return { success: false, content: "", error: (e as Error).message };
    }
  }
}

export class WriteFileTool extends BaseTool {
  readonly name = "write_file";
  readonly description = "写入文件（会完全覆盖）。对已有文件，建议先 read_file 再写入。";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（绝对或相对工作区）" },
      content: { type: "string", description: "要写入的完整内容" }
    },
    required: ["path", "content"]
  } as const;

  constructor(private readonly workspaceDirAbs: string) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const p = asString(args.path, "path");
      const content = asString(args.content, "content");
      const absPath = resolveInWorkspace(this.workspaceDirAbs, p);
      await fs.mkdir(path.dirname(absPath), { recursive: true });

      // 与 Python 版一致：write_file 是“全量覆盖”
      await fs.writeFile(absPath, content, "utf-8");
      return { success: true, content: `Successfully wrote to ${absPath}` };
    } catch (e) {
      return { success: false, content: "", error: (e as Error).message };
    }
  }
}

export class EditFileTool extends BaseTool {
  readonly name = "edit_file";
  readonly description =
    "对文件做“精确字符串替换”。old_str 必须在文件中唯一匹配，否则失败。使用前应先 read_file。";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径（绝对或相对工作区）" },
      old_str: { type: "string", description: "待替换的原始字符串（必须唯一匹配）" },
      new_str: { type: "string", description: "替换后的字符串" }
    },
    required: ["path", "old_str", "new_str"]
  } as const;

  constructor(private readonly workspaceDirAbs: string) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const p = asString(args.path, "path");
      const oldStr = asString(args.old_str, "old_str");
      const newStr = asString(args.new_str, "new_str");
      const absPath = resolveInWorkspace(this.workspaceDirAbs, p);

      // “精确替换”的关键：必须唯一匹配，避免把多个位置都替换掉造成不可控修改
      const raw = await fs.readFile(absPath, "utf-8");
      const idx = raw.indexOf(oldStr);
      if (idx === -1) return { success: false, content: "", error: "old_str not found" };
      if (raw.indexOf(oldStr, idx + 1) !== -1) {
        return { success: false, content: "", error: "old_str is not unique in file" };
      }

      const next = raw.slice(0, idx) + newStr + raw.slice(idx + oldStr.length);
      await fs.writeFile(absPath, next, "utf-8");
      return { success: true, content: `Edited ${absPath}` };
    } catch (e) {
      return { success: false, content: "", error: (e as Error).message };
    }
  }
}
