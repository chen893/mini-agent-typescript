import fs from "node:fs/promises";
import path from "node:path";

import { getHomeDir } from "./utils/homeDir.js";

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  initialDelaySec: number;
  maxDelaySec: number;
  exponentialBase: number;
}

export interface LLMConfig {
  apiKey: string;
  apiBase: string;
  model: string;
  provider: "anthropic" | "openai";
}

export interface AgentConfig {
  maxSteps: number;
  tokenLimit: number;
  workspaceDir: string;
  systemPromptPath: string;
}

export interface ToolsConfig {
  enableFileTools: boolean;
  enableBash: boolean;
  enableNote: boolean;
  enableSkills: boolean;
  skillsDir: string;
  enableMcp: boolean;
  mcpConfigPath: string;
}

export interface AppConfig {
  llm: LLMConfig;
  retry: RetryConfig;
  agent: AgentConfig;
  tools: ToolsConfig;
  /** config.yaml 所在目录；用于解析 system_prompt / mcp.json 的相对路径 */
  configDirAbs: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

async function firstExistingFile(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await fileExists(p)) return p;
  }
  return null;
}

/**
 * 一个“够用的 YAML 子集解析器”，专门服务于 config.yaml（仅 map + scalar）。
 *
 * 设计取舍（教学项目）：
 * - 不支持数组（list），不支持复杂类型
 * - 支持：缩进表示嵌套对象；支持字符串/数字/布尔；支持引号字符串；支持行内注释（#）
 *
 * 为什么不直接用 yaml npm 包？
 * - 这个仓库默认不依赖第三方包（读者即使没装依赖也能看懂/跑通编译）
 * - 真实项目建议：`npm i yaml` 然后替换为成熟解析器
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];

  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    // 去掉注释（非常简化：遇到 # 就截断；适用于我们的配置文件）
    const lineNoComment = rawLine.split("#")[0] ?? "";
    if (!lineNoComment.trim()) continue;

    const indent = (lineNoComment.match(/^\s*/)?.[0]?.length ?? 0) | 0;
    const line = lineNoComment.trim();

    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;

    const key = m[1]!;
    const rawValue = m[2] ?? "";

    // 通过缩进找到父对象
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.obj;

    if (!rawValue) {
      // key:  => 新对象
      const next: Record<string, unknown> = {};
      parent[key] = next;
      stack.push({ indent, obj: next });
      continue;
    }

    parent[key] = parseYamlScalar(rawValue.trim());
  }

  return root;
}

function parseYamlScalar(v: string): string | number | boolean {
  // 去掉成对引号
  const quoted = /^"(.*)"$/.exec(v) || /^'(.*)'$/.exec(v);
  if (quoted) return quoted[1] ?? "";

  if (v === "true") return true;
  if (v === "false") return false;

  // 数字（整数/小数）
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);

  return v;
}

function getString(obj: Record<string, unknown>, key: string, fallback?: string): string {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new Error(`Invalid config: '${key}' must be string`);
}

function getNumber(obj: Record<string, unknown>, key: string, fallback?: number): number {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new Error(`Invalid config: '${key}' must be number`);
}

function getBool(obj: Record<string, unknown>, key: string, fallback?: boolean): boolean {
  const v = obj[key];
  if (typeof v === "boolean") return v;
  if (v === undefined && fallback !== undefined) return fallback;
  throw new Error(`Invalid config: '${key}' must be boolean`);
}

function getObj(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = obj[key];
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}

export class ConfigLoader {
   /**
    * 查找 config.yaml：
    * - dev:  {cwd}/config/config.yaml
    * - dev2: {cwd}/mini-agent-typescript/config/config.yaml
    * - user: {home}/.mini-agent/config/config.yaml
    */
  private static getConfigSearchPaths(): string[] {
    return [
      path.resolve(process.cwd(), "config", "config.yaml"),
      path.resolve(process.cwd(), "mini-agent-typescript", "config", "config.yaml"),
      path.resolve(getHomeDir(), ".mini-agent", "config", "config.yaml")
    ];
  }

  static async findConfigPath(): Promise<string | null> {
    return firstExistingFile(ConfigLoader.getConfigSearchPaths());
  }

  static async load(): Promise<AppConfig> {
    const searchPaths = ConfigLoader.getConfigSearchPaths();
    const configPath = await ConfigLoader.findConfigPath();
    if (!configPath) {
      const exampleCandidates = [
        path.resolve(process.cwd(), "config", "config-example.yaml"),
        path.resolve(process.cwd(), "mini-agent-typescript", "config", "config-example.yaml")
      ];
      const examplePath = (await firstExistingFile(exampleCandidates)) ?? exampleCandidates[0]!;

      throw new Error(
        [
          "Configuration file not found.",
          ...searchPaths.map((p) => `- Tried: ${p}`),
          `You can copy \`${examplePath}\` to one of the search locations as config.yaml.`
        ].join("\n")
      );
    }

    const configDirAbs = path.dirname(configPath);

    const raw = await fs.readFile(configPath, "utf-8");
    const data = parseSimpleYaml(raw);

    const apiKey = getString(data, "api_key");
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      throw new Error("Please configure a valid api_key in config.yaml");
    }

    const provider = getString(data, "provider", "anthropic");
    if (provider !== "anthropic" && provider !== "openai") {
      throw new Error("Invalid provider: must be 'anthropic' or 'openai'");
    }

    const retryObj = getObj(data, "retry");
    const toolsObj = getObj(data, "tools");

    // 注意：为了保持与 Python 版一致，这里沿用同名 key（api_key/max_steps/tools.enable_skills ...）
    // 同时在 TypeScript 层改成更符合习惯的 camelCase 字段，便于日常编码。
    return {
      configDirAbs,
      llm: {
        apiKey,
        apiBase: getString(data, "api_base", "https://api.minimax.io"),
        model: getString(data, "model", "MiniMax-M2"),
        provider
      },
      retry: {
        enabled: getBool(retryObj, "enabled", true),
        maxRetries: getNumber(retryObj, "max_retries", 3),
        initialDelaySec: getNumber(retryObj, "initial_delay", 1.0),
        maxDelaySec: getNumber(retryObj, "max_delay", 60.0),
        exponentialBase: getNumber(retryObj, "exponential_base", 2.0)
      },
      agent: {
        maxSteps: getNumber(data, "max_steps", 50),
        tokenLimit: getNumber(data, "token_limit", 80000),
        workspaceDir: getString(data, "workspace_dir", "./workspace"),
        systemPromptPath: getString(data, "system_prompt_path", "system_prompt.md")
      },
      tools: {
        enableFileTools: getBool(toolsObj, "enable_file_tools", true),
        enableBash: getBool(toolsObj, "enable_bash", true),
        enableNote: getBool(toolsObj, "enable_note", true),
        enableSkills: getBool(toolsObj, "enable_skills", true),
        skillsDir: getString(toolsObj, "skills_dir", "./skills"),
        enableMcp: getBool(toolsObj, "enable_mcp", true),
        mcpConfigPath: getString(toolsObj, "mcp_config_path", "mcp.json")
      }
    };
  }

  /**
   * 读取系统提示词：
   * - 如果是相对路径：相对于 config.yaml 所在目录解析（与 Python 版一致）
   * - 如果找不到，返回一个兜底提示词
   */
  static async loadSystemPrompt(config: AppConfig): Promise<string> {
    const p = config.agent.systemPromptPath;
    const promptPath = path.isAbsolute(p) ? p : path.resolve(config.configDirAbs, p);
    try {
      return await fs.readFile(promptPath, "utf-8");
    } catch {
      return "You are a helpful AI assistant.";
    }
  }
}
