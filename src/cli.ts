import path from "node:path";

import type { AppConfig } from "./config.js";
import { cleanup, createAgentRuntime, ensureDir, initializeBaseTools, loadConfig } from "./runtime/init.js";
import { LineEditor } from "./interactive/LineEditor.js";
import { appendHistory, defaultHistoryFile, loadHistory } from "./interactive/history.js";
import { calculateDisplayWidth } from "./utils/displayWidth.js";

/**
 * CLI（与 Python 版 mini_agent/cli.py 的“交互式运行”定位一致）
 *
 * 使用方式：
 * - `npm run build` 后：`npm start -- --workspace ./workspace`
 *
 * 说明：
 * - 为了让教学项目“零依赖”，这里没有引入 prompt_toolkit 一类的高级交互库
 * - 交互体验比 Python 版简单，但 Agent 核心循环、Tools、Skills、MCP 的工程结构保持一致
 */

function parseArgs(argv: string[]): { workspace?: string; version?: boolean } {
  const out: { workspace?: string; version?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--workspace" || a === "-w") out.workspace = argv[i + 1];
    if (a === "--version" || a === "-v") out.version = true;
  }
  return out;
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    console.log("mini-agent-typescript 0.1.0");
    return;
  }

  const config: AppConfig = await loadConfig();

  const workspaceDirAbs = path.resolve(args.workspace ?? config.agent.workspaceDir ?? process.cwd());
  await ensureDir(workspaceDirAbs);

  // 初始化基础工具（与 workspace 无关）
  const { tools: baseTools, skillLoader } = await initializeBaseTools(config);
  const agent = await createAgentRuntime({
    config,
    workspaceDirAbs,
    baseTools,
    skillLoader,
    verbose: true
  });

  printBanner();
  printSessionInfo(config, workspaceDirAbs, Object.keys(agent.tools).length);

  try {
    const historyFile = defaultHistoryFile();
    const history = await loadHistory(historyFile, 500);

    const commands = ["/help", "/clear", "/history", "/stats", "/exit"];
    const completer = (prefix: string) => {
      if (!prefix.startsWith("/")) return null;
      const candidates = commands.filter((c) => c.startsWith(prefix)).sort();
      if (!candidates.length) return null;
      return { completed: candidates[0]!, candidates };
    };

    const editor = new LineEditor(process.stdin, process.stdout, "> ", history, completer);
    const sessionStart = Date.now();

    while (true) {
      const inputRaw = await editor.read();
      const input = inputRaw.trim();
      if (!input) continue;

      if (input === "/exit" || input === "exit" || input === "quit" || input === "q") break;

      if (input === "/help") {
        printHelp();
        continue;
      }

      if (input === "/clear") {
        // 保留 system prompt
        agent.messages.splice(1);
        console.log("✓ Cleared session (kept system prompt).");
        continue;
      }

      if (input === "/history") {
        console.log(`Messages: ${agent.messages.length}`);
        continue;
      }

      if (input === "/stats") {
        const durSec = Math.floor((Date.now() - sessionStart) / 1000);
        const byRole = { system: 0, user: 0, assistant: 0, tool: 0 };
        for (const m of agent.messages) (byRole as any)[m.role] += 1;
        console.log(
          [
            "",
            `Session Duration: ${durSec}s`,
            `Messages: ${agent.messages.length}`,
            `  - system: ${byRole.system}`,
            `  - user: ${byRole.user}`,
            `  - assistant: ${byRole.assistant}`,
            `  - tool: ${byRole.tool}`,
            ""
          ].join("\n")
        );
        continue;
      }

      // 记录历史（包含多行输入；文件里会用 \n 转义保存）
      await appendHistory(historyFile, inputRaw);
      history.push(inputRaw);

      agent.addUserMessage(inputRaw);
      await agent.run(); // Agent 内部会打印 step/thinking/tool/assistant
    }
  } finally {
    await cleanup();
  }
}

// 直接执行：node dist/cli.js
// 注意：这是 CLI 入口文件，因此这里直接调用 main。
// 如果你想把 Agent 作为库使用，请自行创建新的 entry，并避免自动执行。
// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

function printBanner(): void {
  const width = 58;
  const title = "🤖 Mini Agent - Multi-turn Interactive Session";
  const w = calculateDisplayWidth(title);
  const left = Math.floor((width - w) / 2);
  const right = Math.max(0, width - w - left);
  console.log("");
  console.log(`╔${"═".repeat(width)}╗`);
  console.log(`║${" ".repeat(left)}${title}${" ".repeat(right)}║`);
  console.log(`╚${"═".repeat(width)}╝`);
  console.log("");
}

function printSessionInfo(config: AppConfig, workspaceDirAbs: string, toolsCount: number): void {
  const width = 58;
  const lines = [
    `Model: ${config.llm.model} (${config.llm.provider})`,
    `Workspace: ${workspaceDirAbs}`,
    `Available Tools: ${toolsCount}`
  ];
  console.log(`┌${"─".repeat(width)}┐`);
  for (const t of lines) {
    const w = calculateDisplayWidth(t);
    const pad = Math.max(0, width - 1 - w);
    console.log(`│ ${t}${" ".repeat(pad)}│`);
  }
  console.log(`└${"─".repeat(width)}┘`);
  console.log("");
  console.log("Type /help for help, /exit to quit");
  console.log("");
}

function printHelp(): void {
  console.log(
    [
      "",
      "Available Commands:",
      "  /help      - Show this help message",
      "  /clear     - Clear session history (keep system prompt)",
      "  /history   - Show current session message count",
      "  /stats     - Show session statistics",
      "  /exit      - Exit program (also: exit, quit, q)",
      "",
      "Keyboard Shortcuts:",
      "  Ctrl+U     - Clear current input buffer",
      "  Ctrl+L     - Clear screen",
      "  Ctrl+J     - Insert newline (multi-line input)",
      "  Tab        - Auto-complete commands",
      "  ↑/↓        - Browse history",
      ""
    ].join("\n")
  );
}
