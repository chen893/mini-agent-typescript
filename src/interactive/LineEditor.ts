import { ansi } from "./ansi.js";
import { calculateDisplayWidth } from "../utils/displayWidth.js";

export type Completer = (prefix: string) => { completed: string; candidates: string[] } | null;

/**
 * 一个“最小可用”的交互式输入编辑器（尽量对齐 Python prompt_toolkit 的关键体验）
 *
 * 支持：
 * - Enter 提交
 * - Ctrl+J 插入换行（multi-line 输入）
 * - Ctrl+U 清空当前输入
 * - Ctrl+L 清屏
 * - ↑/↓ 历史
 * - Tab 自动补全（命令补全；候选多时会列出来）
 *
 * 教学取舍：
 * - 我们实现了“够用”的行编辑，不追求完全等价于 prompt_toolkit
 * - 不处理复杂的“自动换行/终端宽度折行”导致的光标定位问题
 */
export class LineEditor {
  private buf = "";
  private cursor = 0;
  private lastRenderLines = 0;

  private history: string[];
  private historyIndex = -1; // -1 表示“正在编辑新输入”
  private draft = "";

  constructor(
    private readonly stdin: any,
    private readonly stdout: any,
    private readonly prompt: string,
    history: string[],
    private readonly completer: Completer | null
  ) {
    this.history = history;
  }

  async read(): Promise<string> {
    this.buf = "";
    this.cursor = 0;
    this.lastRenderLines = 0;
    this.historyIndex = -1;
    this.draft = "";

    this.ensureRawMode(true);
    this.stdout.write(ansi.hideCursor());

    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        const s = chunk.toString("utf-8");

        // 处理常见按键序列（在 raw 模式下收到的是字节流）
        if (s === "\x03") {
          // Ctrl+C
          cleanup();
          reject(new Error("Interrupted"));
          return;
        }

        // Arrow keys: ESC [ A/B/C/D
        if (s.startsWith("\x1b[")) {
          const code = s.slice(2);
          if (code.startsWith("A")) this.onHistoryUp();
          else if (code.startsWith("B")) this.onHistoryDown();
          else if (code.startsWith("C")) this.onRight();
          else if (code.startsWith("D")) this.onLeft();
          this.render();
          return;
        }

        // Enter: \r
        if (s === "\r") {
          const out = this.buf;
          this.stdout.write("\n");
          cleanup();
          resolve(out);
          return;
        }

        // Ctrl+J: \n（插入换行，不提交）
        if (s === "\n") {
          this.insert("\n");
          this.render();
          return;
        }

        // Tab: \t
        if (s === "\t") {
          this.onTab();
          this.render();
          return;
        }

        // Ctrl+U: 0x15
        if (s === "\x15") {
          this.buf = "";
          this.cursor = 0;
          this.render();
          return;
        }

        // Ctrl+L: 0x0c
        if (s === "\x0c") {
          this.stdout.write(ansi.clearScreen());
          this.lastRenderLines = 0;
          this.render();
          return;
        }

        // Backspace: 0x7f
        if (s === "\x7f") {
          this.backspace();
          this.render();
          return;
        }

        // 普通可打印字符：直接插入
        // 注意：这里不做复杂的宽字符/组合字符处理，教学项目够用
        if (s.length) {
          this.insert(s);
          this.render();
        }
      };

      const cleanup = () => {
        this.stdin.off("data", onData);
        this.stdout.write(ansi.showCursor());
        this.ensureRawMode(false);
      };

      this.stdin.on("data", onData);
      this.render();
    });
  }

  private ensureRawMode(enabled: boolean): void {
    // 在 TTY 环境下才可用 raw mode
    try {
      if (typeof this.stdin.setRawMode === "function") this.stdin.setRawMode(enabled);
      this.stdin.resume?.();
    } catch {
      // ignore
    }
  }

  private insert(text: string): void {
    this.buf = this.buf.slice(0, this.cursor) + text + this.buf.slice(this.cursor);
    this.cursor += text.length;
  }

  private backspace(): void {
    if (this.cursor <= 0) return;
    this.buf = this.buf.slice(0, this.cursor - 1) + this.buf.slice(this.cursor);
    this.cursor -= 1;
  }

  private onLeft(): void {
    if (this.cursor > 0) this.cursor -= 1;
  }

  private onRight(): void {
    if (this.cursor < this.buf.length) this.cursor += 1;
  }

  private onHistoryUp(): void {
    if (!this.history.length) return;
    if (this.historyIndex === -1) {
      this.draft = this.buf;
      this.historyIndex = this.history.length - 1;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    }
    this.buf = unescapeHistory(this.history[this.historyIndex]!);
    this.cursor = this.buf.length;
  }

  private onHistoryDown(): void {
    if (this.historyIndex === -1) return;
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.buf = unescapeHistory(this.history[this.historyIndex]!);
      this.cursor = this.buf.length;
      return;
    }
    // 回到草稿
    this.historyIndex = -1;
    this.buf = this.draft;
    this.cursor = this.buf.length;
  }

  private onTab(): void {
    if (!this.completer) return;

    const lastLine = this.buf.split("\n").pop() ?? "";
    const prefix = lastLine.trimStart();
    const res = this.completer(prefix);
    if (!res) return;

    if (res.candidates.length > 1) {
      // 候选多：打印候选列表，再重绘输入框
      this.stdout.write("\n" + res.candidates.join("  ") + "\n");
      this.lastRenderLines = 0;
    }

    // 用 completed 覆盖当前行（只处理“最后一行”的补全）
    const lines = this.buf.split("\n");
    lines[lines.length - 1] = replaceLastLine(lines[lines.length - 1]!, prefix, res.completed);
    this.buf = lines.join("\n");
    this.cursor = this.buf.length;
  }

  private render(): void {
    // 清除上一次渲染占用的行
    if (this.lastRenderLines > 0) {
      this.stdout.write(ansi.cursorUp(this.lastRenderLines - 1));
      for (let i = 0; i < this.lastRenderLines; i++) {
        this.stdout.write(ansi.clearLine() + ansi.cursorToCol(1));
        if (i < this.lastRenderLines - 1) this.stdout.write("\n");
      }
      this.stdout.write(ansi.cursorUp(this.lastRenderLines - 1));
    }

    const lines = this.buf.split("\n");
    const rendered: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const p = i === 0 ? this.prompt : "... ";
      rendered.push(p + lines[i]);
    }

    const out = rendered.join("\n");
    this.stdout.write(out);

    // 光标定位：只保证“粗略正确”（不处理折行）
    const { row, col1 } = this.cursorPosition();
    const totalRows = rendered.length;
    const up = totalRows - 1 - row;
    if (up > 0) this.stdout.write(ansi.cursorUp(up));
    this.stdout.write(ansi.cursorToCol(col1));

    this.lastRenderLines = rendered.length;
  }

  private cursorPosition(): { row: number; col1: number } {
    const before = this.buf.slice(0, this.cursor);
    const rows = before.split("\n");
    const row = rows.length - 1;
    const lineText = rows[row] ?? "";
    const promptWidth = row === 0 ? calculateDisplayWidth(this.prompt) : calculateDisplayWidth("... ");
    const col1 = promptWidth + calculateDisplayWidth(lineText) + 1; // 1-based
    return { row, col1 };
  }
}

function replaceLastLine(fullLine: string, trimmedPrefix: string, completed: string): string {
  // fullLine 可能有左侧空格；trimmedPrefix 是 trimStart 后的 prefix
  const leading = fullLine.slice(0, fullLine.length - fullLine.trimStart().length);
  if (!trimmedPrefix) return leading + completed;
  if (fullLine.trimStart().startsWith(trimmedPrefix)) {
    return leading + completed + fullLine.trimStart().slice(trimmedPrefix.length);
  }
  return leading + completed;
}

function unescapeHistory(line: string): string {
  // appendHistory 会把换行写成 \n
  return line.replace(/\\n/g, "\n");
}

