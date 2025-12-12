import { exec, spawn } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { JsonObject } from "../schema.js";
import { BaseTool, type ToolResult } from "./Tool.js";

const execAsync = promisify(exec);

function asString(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`Expected '${name}' to be string`);
  return v;
}

function asNumberOpt(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Expected '${name}' to be number`);
  return v;
}

function asBoolOpt(v: unknown, name: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`Expected '${name}' to be boolean`);
  return v;
}

type BackgroundShell = {
  bashId: string;
  command: string;
  startTime: number;
  status: "running" | "completed" | "failed" | "terminated";
  exitCode: number | null;
  outputLines: string[];
  lastReadIndex: number;
  proc: ReturnType<typeof spawn>;
};

/**
 * BackgroundShellManager（与 Python 版一致）：
 * - 管理所有后台进程（run_in_background=true）
 * - 缓存输出（按行），并支持增量读取（bash_output）
 * - 支持终止（bash_kill）
 *
 * 注意：
 * - 教学项目中我们把 stdout + stderr 合并（stderr -> stdout），与 Python 版保持一致。
 * - MCP / LLM 等长连接工具通常需要后台运行，这个能力是 Agent 工程里很常见的一块。
 */
class BackgroundShellManager {
  private static shells = new Map<string, BackgroundShell>();

  static add(shell: BackgroundShell): void {
    this.shells.set(shell.bashId, shell);
  }

  static get(id: string): BackgroundShell | undefined {
    return this.shells.get(id);
  }

  static listIds(): string[] {
    return [...this.shells.keys()];
  }

  static remove(id: string): void {
    this.shells.delete(id);
  }
}

function genId(): string {
  // 生成一个短 ID，方便用户手动粘贴（与 Python 版 uuid[:8] 的体验类似）
  return Math.random().toString(16).slice(2, 10);
}

function splitLines(chunk: Uint8Array): string[] {
  // 这里用 utf-8 解码；Windows 下 PowerShell 可能输出非 utf8，但教学项目先简化
  const text = Buffer.from(chunk).toString("utf-8");
  return text.split(/\r?\n/).filter((l) => l.length);
}

function formatBashOutput(opts: {
  stdout: string;
  stderr: string;
  exitCode: number;
  bashId?: string;
}): string {
  let out = "";
  if (opts.stdout) out += opts.stdout;
  if (opts.stderr) out += `\n[stderr]:\n${opts.stderr}`;
  if (opts.bashId) out += `\n[bash_id]:\n${opts.bashId}`;
  if (opts.exitCode) out += `\n[exit_code]:\n${opts.exitCode}`;
  return out.trim() || "(no output)";
}

/**
 * bash 工具（与 Python 版 BashTool 对齐）
 *
 * 参数：
 * - command: string（必填）
 * - timeout: number（秒，默认 120，最大 600；仅前台执行时生效）
 * - run_in_background: boolean（默认 false）
 */
export class BashTool extends BaseTool {
  readonly name = "bash";
  readonly description =
    "执行终端命令（Windows=PowerShell；macOS/Linux=bash）。支持前台/后台运行。不要用它做文件读写（请用 read_file/write_file/edit_file）。";
  readonly parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令字符串" },
      timeout: { type: "number", description: "超时（秒，默认 120，最大 600；仅前台执行）" },
      run_in_background: { type: "boolean", description: "是否后台运行（适用于 server/长任务）" }
    },
    required: ["command"]
  } as const;

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const command = asString(args.command, "command");
      const timeoutSec = Math.min(Math.max(asNumberOpt(args.timeout, "timeout") ?? 120, 1), 600);
      const runInBackground = asBoolOpt(args.run_in_background, "run_in_background") ?? false;

      const isWindows = os.platform() === "win32";

      if (runInBackground) {
        const bashId = genId();

        // Windows: powershell -Command <cmd>；Unix: bash -lc <cmd>
        const proc = isWindows
          ? spawn("powershell.exe", ["-NoProfile", "-Command", command], { stdio: ["ignore", "pipe", "pipe"] })
          : spawn("bash", ["-lc", command], { stdio: ["ignore", "pipe", "pipe"] });

        const shell: BackgroundShell = {
          bashId,
          command,
          startTime: Date.now(),
          status: "running",
          exitCode: null,
          outputLines: [],
          lastReadIndex: 0,
          proc
        };

        // 合并 stdout/stderr 到一份 outputLines（与 Python 版一致）
        proc.stdout?.on("data", (chunk: Uint8Array) => shell.outputLines.push(...splitLines(chunk)));
        proc.stderr?.on("data", (chunk: Uint8Array) => shell.outputLines.push(...splitLines(chunk)));
        proc.on("close", (code: number | null) => {
          shell.exitCode = code;
          shell.status = code === 0 ? "completed" : "failed";
        });

        BackgroundShellManager.add(shell);

        return {
          success: true,
          content: formatBashOutput({
            stdout: `Background command started with ID: ${bashId}\n\nCommand: ${command}\nBash ID: ${bashId}`,
            stderr: "",
            exitCode: 0,
            bashId
          })
        };
      }

      // 前台执行：用 exec + timeout
      const wrapped = isWindows
        ? `powershell -NoProfile -ExecutionPolicy Bypass -Command ${JSON.stringify(command)}`
        : `bash -lc ${JSON.stringify(command)}`;

      const { stdout, stderr } = await execAsync(wrapped, {
        timeout: timeoutSec * 1000,
        maxBuffer: 20 * 1024 * 1024
      });

      return {
        success: true,
        content: formatBashOutput({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 })
      };
    } catch (e) {
      // Node 的 exec 在“非 0 退出码”时也会抛错；错误对象通常包含 code/stdout/stderr。
      const err = e as { message?: string; stdout?: string; stderr?: string; code?: number };
      const exitCode = typeof err.code === "number" ? err.code : -1;
      const exitInfo = err.message ? `Command failed: ${err.message}` : "Command failed";
      return {
        success: false,
        content: "",
        error: formatBashOutput({
          stdout: err.stdout ?? "",
          stderr: err.stderr ? `${exitInfo}\n${err.stderr}` : exitInfo,
          exitCode
        })
      };
    }
  }
}

/**
 * bash_output 工具（与 Python 版 BashOutputTool 对齐）
 *
 * 读取某个后台 bash_id 的“增量输出”：
 * - 每次调用只返回上次调用之后的新行（避免反复把旧输出塞回上下文）
 * - 可选 filter_str（正则）做筛选；未匹配的行将“被消费掉”（与 Python 版一致）
 */
export class BashOutputTool extends BaseTool {
  readonly name = "bash_output";
  readonly description = "读取后台 bash 进程的增量输出（可选正则过滤）。";
  readonly parameters = {
    type: "object",
    properties: {
      bash_id: { type: "string", description: "后台进程 ID（bash run_in_background=true 时返回）" },
      filter_str: {
        type: "string",
        description: "可选：用于过滤输出行的正则。未匹配的行也会被消费，不会在后续再出现。"
      }
    },
    required: ["bash_id"]
  } as const;

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const bashId = asString(args.bash_id, "bash_id");
      const filterStr = args.filter_str ? asString(args.filter_str, "filter_str") : undefined;

      const shell = BackgroundShellManager.get(bashId);
      if (!shell) {
        return {
          success: false,
          content: "",
          error: `Shell not found: ${bashId}. Available: ${BackgroundShellManager.listIds().join(", ") || "none"}`
        };
      }

      let newLines = shell.outputLines.slice(shell.lastReadIndex);
      shell.lastReadIndex = shell.outputLines.length;

      if (filterStr) {
        try {
          const re = new RegExp(filterStr);
          newLines = newLines.filter((l) => re.test(l));
        } catch {
          // 正则不合法：按“不过滤”处理
        }
      }

      const stdout = newLines.join("\n");
      return {
        success: true,
        content: formatBashOutput({
          stdout,
          stderr: "",
          exitCode: shell.exitCode ?? 0,
          bashId
        })
      };
    } catch (e) {
      return { success: false, content: "", error: `Failed to get bash output: ${(e as Error).message}` };
    }
  }
}

/**
 * bash_kill 工具（与 Python 版 BashKillTool 对齐）
 *
 * - 终止后台 bash 进程，并清理 manager 中的状态
 * - 返回终止前最后一段增量输出，避免信息丢失
 */
export class BashKillTool extends BaseTool {
  readonly name = "bash_kill";
  readonly description = "终止一个后台 bash 进程（通过 bash_id）。";
  readonly parameters = {
    type: "object",
    properties: {
      bash_id: { type: "string", description: "后台进程 ID（bash run_in_background=true 时返回）" }
    },
    required: ["bash_id"]
  } as const;

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const bashId = asString(args.bash_id, "bash_id");
      const shell = BackgroundShellManager.get(bashId);
      if (!shell) {
        return {
          success: false,
          content: "",
          error: `Shell not found: ${bashId}. Available: ${BackgroundShellManager.listIds().join(", ") || "none"}`
        };
      }

      // 取剩余输出（并消费）
      const remaining = shell.outputLines.slice(shell.lastReadIndex);
      shell.lastReadIndex = shell.outputLines.length;

      try {
        shell.proc.kill("SIGTERM");
      } catch {
        // ignore
      }

      // 与 Python 版一致：先尝试温和终止，再在短时间后强杀（避免卡住）
      await new Promise((r) => setTimeout(r, 500));
      if (shell.exitCode === null) {
        try {
          shell.proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }

      shell.status = "terminated";

      BackgroundShellManager.remove(bashId);

      return {
        success: true,
        content: formatBashOutput({
          stdout: remaining.join("\n"),
          stderr: "",
          exitCode: shell.exitCode ?? 0,
          bashId
        })
      };
    } catch (e) {
      return { success: false, content: "", error: `Failed to terminate bash shell: ${(e as Error).message}` };
    }
  }
}
