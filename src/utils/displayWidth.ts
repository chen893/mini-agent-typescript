/**
 * 计算“终端显示宽度”（近似实现），用于对齐 banner/表格。
 *
 * 为什么需要它？
 * - 中文/日文/韩文等 CJK 字符在等宽终端里通常占 2 列宽
 * - 直接用 string.length 会导致对齐错位
 *
 * 教学取舍：
 * - 这里用常见 Unicode 区间做近似判断（够用）
 * - 生产级可换成成熟库（例如 wcwidth）
 */
export function calculateDisplayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += isWideChar(code) ? 2 : 1;
  }
  return w;
}

function isWideChar(code: number): boolean {
  // CJK Unified Ideographs
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  // CJK Symbols and Punctuation
  if (code >= 0x3000 && code <= 0x303f) return true;
  // Hiragana / Katakana
  if (code >= 0x3040 && code <= 0x30ff) return true;
  // Hangul Syllables
  if (code >= 0xac00 && code <= 0xd7af) return true;
  // Fullwidth Forms
  if (code >= 0xff01 && code <= 0xff60) return true;

  return false;
}

