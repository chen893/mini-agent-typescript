import fs from "node:fs/promises";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  content: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  skillPathAbs: string;
}

/**
 * SkillLoader（与 Python 版 SkillLoader 对齐）：
 * - 递归扫描 skills_dir 下的所有 SKILL.md
 * - 解析 YAML frontmatter（仅取 name / description 等元数据）
 * - 生成“metadata-only prompt”（Progressive Disclosure Level 1）
 * - 通过 get_skill 工具按需返回完整 Skill 内容（Level 2）
 *
 * Skill 文件结构（与 skill.md 一致）：
 * skill-name/（技能目录）
 *   SKILL.md   # 必须：YAML frontmatter + 指令主体
 *   scripts/   # 可选：脚本
 *   reference/ # 可选：更多文档
 */
export class SkillLoader {
  private readonly loaded = new Map<string, Skill>();

  constructor(private readonly skillsDirAbs: string) {}

  listSkills(): string[] {
    return [...this.loaded.keys()];
  }

  getSkill(name: string): Skill | undefined {
    return this.loaded.get(name);
  }

  /**
   * Level 1：只返回 name + description，用于“让模型知道有哪些技能，但不提前把全部内容塞进上下文”。
   */
  getSkillsMetadataPrompt(): string {
    if (!this.loaded.size) return "";

    const lines: string[] = [];
    lines.push("## Available Skills");
    lines.push("");
    lines.push("You have access to specialized skills. Each skill provides expert guidance for specific tasks.");
    lines.push("Load a skill's full content using the get_skill tool when needed.");
    lines.push("");

    for (const sk of this.loaded.values()) {
      lines.push(`- \`${sk.name}\`: ${sk.description}`);
    }

    return lines.join("\n");
  }

  /**
   * 发现并加载所有 skills。
   */
  async discoverSkills(): Promise<Skill[]> {
    const files = await this.walk(this.skillsDirAbs);
    const skillFiles = files.filter((f) => f.endsWith(`${path.sep}SKILL.md`) || f.endsWith("/SKILL.md"));

    const skills: Skill[] = [];
    for (const skillPathAbs of skillFiles) {
      const s = await this.loadSkill(skillPathAbs);
      if (s) {
        this.loaded.set(s.name, s);
        skills.push(s);
      }
    }
    return skills;
  }

  /**
   * 加载单个 SKILL.md。
   *
   * 与 Python 版保持一致的校验：
   * - 必须包含 YAML frontmatter（--- ... ---）
   * - frontmatter 必须包含 name / description
   */
  async loadSkill(skillPathAbs: string): Promise<Skill | null> {
    try {
      const raw = await fs.readFile(skillPathAbs, "utf-8");
      const parsed = parseFrontmatter(raw);
      if (!parsed) {
        // 教学项目：直接返回 null，不抛异常（避免一个坏 skill 影响全部加载）
        return null;
      }

      const { frontmatter, body } = parsed;
      const name = frontmatter.name;
      const description = frontmatter.description;
      if (!name || !description) return null;

      const skillDirAbs = path.dirname(skillPathAbs);
      const processedContent = await this.processSkillPaths(body.trim(), skillDirAbs);

      return {
        name,
        description,
        content: processedContent,
        license: frontmatter.license,
        allowedTools: parseAllowedTools(frontmatter["allowed-tools"]),
        metadata: parseMetadata(frontmatter.metadata),
        skillPathAbs
      };
    } catch {
      return null;
    }
  }

  /**
   * Progressive Disclosure Level 3：把 Skill 指令里提到的“相对路径资源”，替换为绝对路径。
   *
   * 为什么要做这一步？
   * - 模型在执行 Skill 的过程中经常会引用 scripts/xxx.py、reference/xxx.md 等文件
   * - 如果只写相对路径，当当前工作目录变化时就容易找不到
   * - 替换成绝对路径后，配合 read_file 工具就稳定了
   *
   * 与 Python 版一致：主要处理三类路径引用
   * 1) `scripts/...` / `examples/...` / `templates/...` / `reference/...`（常出现在代码块或反引号中）
   * 2) see/read/check xxx.md 这种“自然语言引用”
   * 3) Markdown 链接 [text](./reference/xxx.md)
   */
  private async processSkillPaths(content: string, skillDirAbs: string): Promise<string> {
    // 模式 1：匹配 (python\s+|`) 后跟 scripts/... 等相对路径
    const patternDirs = /(python\s+|`)((?:scripts|examples|templates|reference)\/[^\s`\)]+)/g;
    content = await replaceAsync(content, patternDirs, async (m, prefix, relPath) => {
      const abs = path.resolve(skillDirAbs, relPath);
      if (await exists(abs)) return `${prefix}${abs}`;
      return m;
    });

    // 模式 2：匹配 "see/read/refer to/check xxx.md" 这类自然语言引用
    const patternDocs = /(see|read|refer to|check)\s+([a-zA-Z0-9_-]+\.(?:md|txt|json|yaml))([.,;\s])/gi;
    content = await replaceAsync(content, patternDocs, async (m, prefix, filename, suffix) => {
      const abs = path.resolve(skillDirAbs, filename);
      if (await exists(abs)) return `${prefix} \`${abs}\` (use read_file to access)${suffix}`;
      return m;
    });

    // 模式 3：匹配 Markdown 链接（可带 Read/See/Check... 等前缀词）
    const patternMarkdown =
      /(?:(Read|See|Check|Refer to|Load|View)\s+)?\[(`?[^`\]]+`?)\]\(((?:\.\/)?[^)]+\.(?:md|txt|json|yaml|js|py|html))\)/gi;
    content = await replaceAsync(content, patternMarkdown, async (m, prefix, linkText, filepath) => {
      const clean = String(filepath).startsWith("./") ? String(filepath).slice(2) : String(filepath);
      const abs = path.resolve(skillDirAbs, clean);
      if (await exists(abs)) {
        const p = prefix ? `${prefix} ` : "";
        return `${p}[${linkText}](\`${abs}\`) (use read_file to access)`;
      }
      return m;
    });

    return content;
  }

  private async walk(dirAbs: string): Promise<string[]> {
    const out: string[] = [];
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return out;
    }

    for (const ent of entries) {
      const p = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        out.push(...(await this.walk(p)));
      } else if (ent.isFile()) {
        out.push(p);
      }
    }
    return out;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isFile() || s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 解析 YAML frontmatter（极简版，仅用于 Skill 的 frontmatter）。
 *
 * Skill 的 frontmatter 通常很小，字段也固定，因此这里用“简化解析”：
 * - 只支持 key: value 的一层结构（不支持嵌套、数组）
 * - 足够满足 name/description/license 等字段
  */
function parseFrontmatter(input: string): { frontmatter: Record<string, string>; body: string } | null {
  // 同时支持 LF 与 CRLF（Windows 常见）。
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/m.exec(input);
  if (!m) return null;

  const rawYaml = m[1] ?? "";
  const body = m[2] ?? "";

  const frontmatter: Record<string, string> = {};
  for (const line of rawYaml.split(/\r?\n/)) {
    const trimmed = (line.split("#")[0] ?? "").trim();
    if (!trimmed) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1]!;
    let value: string = kv[2] ?? "";
    value = value.trim();
    const quoted = /^"(.*)"$/.exec(value) || /^'(.*)'$/.exec(value);
    if (quoted) value = quoted[1] ?? "";
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function parseAllowedTools(v: unknown): string[] | undefined {
  if (typeof v !== "string") return undefined;
  const raw = v.trim();
  if (!raw) return undefined;

  // 支持极简的行内列表："a, b" 或 "[a, b]"。
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const parts = inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(stripQuotes);
  return parts.length ? parts : undefined;
}

function parseMetadata(v: unknown): Record<string, string> | undefined {
  if (typeof v !== "string") return undefined;
  const raw = v.trim();
  if (!raw) return undefined;

  // 允许用 JSON 对象字符串作为紧凑的一行写法。
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
        out[String(k)] = typeof val === "string" ? val : String(val);
      }
      return Object.keys(out).length ? out : undefined;
    }
  } catch {
    // 解析失败：继续尝试后备格式
  }

  // 兜底：解析 "k=v, a=b" 这种键值对写法。
  const out: Record<string, string> = {};
  for (const part of raw.split(/[;,]/)) {
    const p = part.trim();
    if (!p) continue;
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = stripQuotes(value);
  }
  return Object.keys(out).length ? out : undefined;
}

function stripQuotes(s: string): string {
  const quoted = /^"(.*)"$/.exec(s) || /^'(.*)'$/.exec(s);
  return quoted ? (quoted[1] ?? "") : s;
}

async function replaceAsync(
  input: string,
  regex: RegExp,
  replacer: (...args: any[]) => Promise<string>
): Promise<string> {
  const matches: Array<{ start: number; end: number; text: string; groups: any[] }> = [];
  input.replace(regex, (...args: any[]) => {
    const matchText = String(args[0]);
    const offset = Number(args[args.length - 2]); // 标准 replace 回调参数：... , offset, string
    matches.push({ start: offset, end: offset + matchText.length, text: matchText, groups: args });
    return matchText;
  });

  if (!matches.length) return input;

  // 从后往前替换，避免 offset 失效
  let out = input;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const rep = await replacer(...m.groups);
    out = out.slice(0, m.start) + rep + out.slice(m.end);
  }
  return out;
}
