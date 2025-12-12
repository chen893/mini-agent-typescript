import fs from "node:fs/promises";
import path from "node:path";

/**
 * 输入历史（对齐 Python 版 prompt_toolkit FileHistory）
 *
 * Python 版会把历史写到一个文件，下次启动还能 ↑/↓ 找回。
 * 这里我们实现一个简化版本：
 * - 文件位置：~/.mini-agent/history.txt
 * - 每次用户“提交”一条输入，就 append 一行
 * - 启动时加载最近 N 条进入内存
 */

export function defaultHistoryFile(): string {
  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  return path.resolve(home, ".mini-agent", "history.txt");
}

export async function loadHistory(fileAbs: string, limit = 200): Promise<string[]> {
  try {
    const raw = await fs.readFile(fileAbs, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendHistory(fileAbs: string, line: string): Promise<void> {
  const dir = path.dirname(fileAbs);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(fileAbs, line.replace(/\r?\n/g, "\\n") + "\n", "utf-8");
}

