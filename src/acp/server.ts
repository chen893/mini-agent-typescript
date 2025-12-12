import { ConfigLoader } from "../config.js";
import { createLLMClient, initializeBaseTools, loadConfig } from "../runtime/init.js";
import { JsonRpcStdioConnection } from "../utils/jsonRpcStdio.js";
import { MiniMaxACPAgent, type ACPConnection } from "./MiniMaxACPAgent.js";

/**
 * ACP Server（stdio JSON-RPC）
 *
 * 用法（构建后）：
 * - `node dist/acp/server.js`
 *
 * 注意事项（非常重要）：
 * - ACP/MCP 的 stdio 协议要求：stdout 只能输出协议帧
 * - 所以任何调试输出必须写到 stderr
 */

class JsonRpcACPConnection implements ACPConnection {
  constructor(private readonly rpc: JsonRpcStdioConnection) {}

  async sessionUpdate(payload: any): Promise<void> {
    // ACP 用 notification 形式把 session update 推给宿主
    this.rpc.notify("sessionUpdate", payload);
  }
}

export async function runAcpServer(): Promise<void> {
  const config = await loadConfig();
  const { tools: baseTools, skillLoader } = await initializeBaseTools(config);

  // system prompt（含 skills metadata）
  let systemPrompt = await ConfigLoader.loadSystemPrompt(config);
  if (skillLoader) {
    const meta = skillLoader.getSkillsMetadataPrompt();
    if (meta) systemPrompt = `${systemPrompt.trim()}\n\n${meta}`;
  }

  const llm = createLLMClient(config);

  const rpc = new JsonRpcStdioConnection(
    process.stdin,
    process.stdout,
    (err) => process.stderr.write(`[acp] error: ${err.message}\n`)
  );

  const conn = new JsonRpcACPConnection(rpc);
  const agent = new MiniMaxACPAgent(conn, config, llm, baseTools, systemPrompt);

  // 注册 ACP methods
  rpc.on("initialize", (params) => agent.initialize(params));
  rpc.on("newSession", (params) => agent.newSession(params));
  rpc.on("prompt", (params) => agent.prompt(params));
  rpc.on("cancel", (params) => agent.cancel(params));

  rpc.start();

  // 进程保持运行：等待 stdio 请求
  // 这里不需要额外的 event loop，stdin data 事件会保持进程活跃
}

// entry
// eslint-disable-next-line @typescript-eslint/no-floating-promises
runAcpServer();

