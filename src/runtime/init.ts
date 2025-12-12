import path from "node:path";
import fs from "node:fs/promises";

import { Agent } from "../agent/Agent.js";
import { ConfigLoader, type AppConfig } from "../config.js";
import { LLMClient } from "../llm/LLMClient.js";
import { BashKillTool, BashOutputTool, BashTool, cleanupBashBackgroundShells } from "../tools/bashTool.js";
import { ReadFileTool, WriteFileTool, EditFileTool } from "../tools/fileTools.js";
import { defaultMemoryFile, RecallNotesTool, RecordNoteTool } from "../tools/noteTools.js";
import { cleanupMcpConnections, loadMcpTools, resolveMcpConfigPath } from "../tools/mcpLoader.js";
import { SkillLoader } from "../tools/skills/skillLoader.js";
import { GetSkillTool } from "../tools/skills/skillTool.js";
import type { Tool } from "../tools/Tool.js";

/**
 * 把 CLI 与 ACP 复用的“初始化逻辑”抽出来：
 * - 加载配置
 * - 初始化基础工具（bash/skills/mcp）
 * - 根据 workspace 追加 workspace 工具（file/note）
 * - 构造 system prompt（注入 skills metadata + workspace info 由 Agent 做）
 * - 构造 Agent 实例
 *
 * 这样做的好处：
 * - 与 Python 版一致：CLI 与 ACP server 共用同一套 Agent runtime
 * - 教学更清晰：读者能看到“工程化初始化”应该放在哪一层
 */

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function resolveSkillsDir(config: AppConfig): Promise<string> {
  const skillsDir = config.tools.skillsDir;
  if (path.isAbsolute(skillsDir)) return skillsDir;

  // 与 Python 版类似：优先找开发目录，再找项目默认位置
  const candidates = [
    // 1) 相对 config.yaml 所在目录（与 Python 版“同目录放置 config/skills”习惯一致）
    path.resolve(config.configDirAbs, skillsDir),
    path.resolve(process.cwd(), skillsDir),
    path.resolve(process.cwd(), "mini-agent-typescript", skillsDir),
    path.resolve(process.cwd(), "mini-agent-typescript", "skills")
  ];

    for (const c of candidates) {
      try {
        const s = await fs.stat(c);
        if (s.isDirectory()) return c;
      } catch {
      // 忽略
      }
    }

  return path.resolve(process.cwd(), "mini-agent-typescript", "skills");
}

export async function initializeBaseTools(config: AppConfig): Promise<{
  tools: Tool[];
  skillLoader: SkillLoader | null;
}> {
  const tools: Tool[] = [];
  let skillLoader: SkillLoader | null = null;

  // 1) Bash 工具
  if (config.tools.enableBash) {
    tools.push(new BashTool(), new BashOutputTool(), new BashKillTool());
  }

  // 2) Skills（渐进式加载 / Progressive Disclosure）
  if (config.tools.enableSkills) {
    const skillsDirAbs = await resolveSkillsDir(config);
    skillLoader = new SkillLoader(skillsDirAbs);
    await skillLoader.discoverSkills();
    tools.push(new GetSkillTool(skillLoader));
  }

  // 3) MCP 工具
  if (config.tools.enableMcp) {
    try {
      const mcpPathAbs = resolveMcpConfigPath(config.configDirAbs, config.tools.mcpConfigPath);
      const mcpTools = await loadMcpTools(mcpPathAbs);
      tools.push(...mcpTools);
    } catch {
      // 教学项目：MCP 失败不阻塞主流程（与 Python 版 cli.py 的容错策略一致）
    }
  }

  return { tools, skillLoader };
}

export function addWorkspaceTools(tools: Tool[], config: AppConfig, workspaceDirAbs: string): void {
  // 文件工具：限制在 workspace 内
  if (config.tools.enableFileTools) {
    tools.push(new ReadFileTool(workspaceDirAbs), new WriteFileTool(workspaceDirAbs), new EditFileTool(workspaceDirAbs));
  }

  // Note 工具：持久化记忆
  if (config.tools.enableNote) {
    const mem = defaultMemoryFile(workspaceDirAbs);
    tools.push(new RecordNoteTool(mem), new RecallNotesTool(mem));
  }
}

export async function buildSystemPrompt(config: AppConfig, skillLoader: SkillLoader | null): Promise<string> {
  let systemPrompt = await ConfigLoader.loadSystemPrompt(config);
  if (skillLoader) {
    const meta = skillLoader.getSkillsMetadataPrompt();
    if (meta) systemPrompt = `${systemPrompt.trim()}\n\n${meta}`;
  }
  return systemPrompt;
}

export function createLLMClient(config: AppConfig): LLMClient {
  return new LLMClient({
    apiKey: config.llm.apiKey,
    apiBase: config.llm.apiBase,
    model: config.llm.model,
    provider: config.llm.provider,
    retry: config.retry
  });
}

export async function createAgentRuntime(opts: {
  config: AppConfig;
  workspaceDirAbs: string;
  baseTools: Tool[];
  skillLoader: SkillLoader | null;
  llm?: LLMClient;
  systemPrompt?: string;
  verbose?: boolean;
}): Promise<Agent> {
  const systemPrompt = opts.systemPrompt ?? (await buildSystemPrompt(opts.config, opts.skillLoader));
  const llm = opts.llm ?? createLLMClient(opts.config);

  const tools = [...opts.baseTools];
  addWorkspaceTools(tools, opts.config, opts.workspaceDirAbs);

  return new Agent({
    llm,
    systemPrompt,
    tools,
    maxSteps: opts.config.agent.maxSteps,
    tokenLimit: opts.config.agent.tokenLimit,
    workspaceDir: opts.workspaceDirAbs,
    verbose: opts.verbose ?? true
  });
}

export async function loadConfig(): Promise<AppConfig> {
  return ConfigLoader.load();
}

export async function cleanup(): Promise<void> {
  await cleanupMcpConnections();
  await cleanupBashBackgroundShells();
}
