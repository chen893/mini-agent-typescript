/**
 * ANSI escape helpers（教学用最小集合）
 *
 * 说明：
 * - 终端里很多“交互体验”（清屏、移动光标、清行）都靠 ANSI escape code
 * - Windows 新版终端一般支持；老环境可能不支持（教学项目先假定支持）
 */

export const ansi = {
  clearScreen: () => "\x1b[2J\x1b[H",
  clearLine: () => "\x1b[2K",
  cursorUp: (n: number) => (n > 0 ? `\x1b[${n}A` : ""),
  cursorDown: (n: number) => (n > 0 ? `\x1b[${n}B` : ""),
  cursorToCol: (col1: number) => `\x1b[${Math.max(1, col1)}G`,
  hideCursor: () => "\x1b[?25l",
  showCursor: () => "\x1b[?25h"
};

