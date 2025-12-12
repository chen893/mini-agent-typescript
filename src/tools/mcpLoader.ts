import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { JsonObject } from "../schema.js";
import { BaseTool, type Tool, type ToolResult } from "./Tool.js";

/**
 * MCP（Model Context Protocol）工具加载器（与 Python 版 mcp_loader.py 对齐）。
 *
 * 目标：
 * - 读取 mcp.json，启动 stdio MCP server 子进程
 * - 通过 JSON-RPC 调用 initialize / tools/list / tools/call
 * - 把 MCP server 暴露的工具包装成我们自己的 Tool，挂到 Agent 的 tools 列表中
 *
 * 注意：
 * - MCP 的“正式 TypeScript SDK”是 `@modelcontextprotocol/sdk`。
 * - 教学项目为了避免强依赖，我们实现一个“最小 JSON-RPC stdio 客户端”（足以跑起来/便于阅读）。
 * - 由于生态里存在不同实现差异，如果你遇到协议不兼容，建议直接换用官方 SDK。
 */

type McpServerConfig = {
  description?: string;
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
};

type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

class JsonRpcStdioClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer: Buffer = Buffer.from("");

  constructor(private readonly proc: ReturnType<typeof spawn>) {
    proc.stdout?.on("data", (chunk: Uint8Array) => this.onData(Buffer.from(chunk)));
    proc.stderr?.on("data", () => {
      // MCP server 不应向 stdout 打印日志；stderr 可忽略或用于调试
    });
    proc.on("close", () => {
      for (const [id, p] of this.pending) {
        p.reject(new Error(`MCP process closed (pending id=${id})`));
      }
      this.pending.clear();
    });
  }

  /**
   * MCP stdio 通常使用“Content-Length: N\r\n\r\n<json>”的 framing（类似 LSP）。
   * 我们在这里按这个格式解析。
   */
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const headerText = this.buffer.slice(0, headerEnd).toString("utf-8");
      const m = /content-length:\s*(\d+)/i.exec(headerText);
      if (!m) {
        // 找不到 Content-Length：丢弃到下一个分隔符（容错）
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + len;
      if (this.buffer.length < bodyEnd) break; // 等更多数据

      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf-8");
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const msg = JSON.parse(body) as JsonRpcResponse;
        this.dispatch(msg);
      } catch {
        // ignore malformed
      }
    }
  }

  private dispatch(resp: JsonRpcResponse): void {
    const p = this.pending.get(resp.id);
    if (!p) return;
    this.pending.delete(resp.id);

    if (resp.error) {
      p.reject(new Error(`JSON-RPC error ${resp.error.code}: ${resp.error.message}`));
      return;
    }
    p.resolve(resp.result);
  }

  async request<T = any>(method: string, params?: any): Promise<T> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const json = JSON.stringify(req);
    const frame = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n${json}`;

    const result = await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin?.write(frame);
    });
    return result;
  }

  close(): void {
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

class McpTool extends BaseTool {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly parameters: JsonObject,
    private readonly client: JsonRpcStdioClient
  ) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      // MCP 标准：tools/call { name, arguments }
      const result = await this.client.request("tools/call", { name: this.name, arguments: args });

      // MCP tool 返回通常是 { content: [{type:'text', text:'...'}], isError?: boolean }
      const parts: string[] = [];
      const content = result?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item && typeof item.text === "string") parts.push(item.text);
          else parts.push(String(item));
        }
      } else if (typeof result === "string") {
        parts.push(result);
      } else {
        parts.push(JSON.stringify(result, null, 2));
      }

      const isError = Boolean(result?.isError);
      return { success: !isError, content: parts.join("\n"), error: isError ? "Tool returned error" : undefined };
    } catch (e) {
      return { success: false, content: "", error: `MCP tool execution failed: ${(e as Error).message}` };
    }
  }
}

type McpConnection = {
  name: string;
  client: JsonRpcStdioClient;
  tools: Tool[];
};

const connections: McpConnection[] = [];

export async function loadMcpTools(configPathAbs: string): Promise<Tool[]> {
  const cfgText = await fs.readFile(configPathAbs, "utf-8");
  const cfg = JSON.parse(cfgText) as McpConfigFile;

  const servers = cfg.mcpServers ?? {};
  const tools: Tool[] = [];

  for (const [name, server] of Object.entries(servers)) {
    if (server.disabled) continue;
    if (!server.command) continue;

    const proc = spawn(server.command, server.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(server.env ?? {}) },
      shell: false
    });

    const client = new JsonRpcStdioClient(proc);

    // initialize：不同 server 的 params 可能不同；这里尽量用最小参数
    // 若你遇到初始化失败，建议直接使用官方 SDK（会自动带 capabilities）。
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mini-agent-typescript", version: "0.1.0" }
    });

    const list = await client.request("tools/list", {});
    const toolDefs = list?.tools ?? [];

    const wrapped: Tool[] = [];
    for (const t of toolDefs) {
      const params = (t?.inputSchema ?? {}) as JsonObject;
      wrapped.push(new McpTool(String(t.name), String(t.description ?? ""), params, client));
    }

    connections.push({ name, client, tools: wrapped });
    tools.push(...wrapped);
  }

  return tools;
}

export async function cleanupMcpConnections(): Promise<void> {
  for (const c of connections) c.client.close();
  connections.length = 0;
}

/**
 * 解析 mcp.json 路径（与 Python 版一致：相对路径相对于 config.yaml 所在目录）。
 */
export function resolveMcpConfigPath(configDirAbs: string, mcpConfigPath: string): string {
  return path.isAbsolute(mcpConfigPath) ? mcpConfigPath : path.resolve(configDirAbs, mcpConfigPath);
}

