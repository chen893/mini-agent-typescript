/**
 * 通过 stdio 传输的 JSON-RPC 2.0（使用 "Content-Length" 分帧，风格类似 LSP）。
 *
 * 这是 Agent/MCP/ACP 生态里非常常见的一种“进程间通信”方式：
 * - 父进程启动子进程
 * - 双方通过 stdin/stdout 发送消息
 * - 为了解决“粘包/拆包”，使用 Content-Length 头部标明 JSON 的字节长度
 *
 * 帧格式：
 *   Content-Length: <N>\r\n
 *   \r\n
 *   <N bytes JSON>
 *
 * 这个文件提供：
 * - 一个最小的 JSON-RPC stdio 连接类：负责
 *   1) 解析流式输入（按帧拆包）
 *   2) 分发 request / notification
 *   3) 发送 response / notification
 *
 * 说明（教学取舍）：
 * - 我们不追求 100% 覆盖所有边界情况（例如多种 header、字符集等）
 * - 但保证核心思路清晰，读者能把它迁移到真实项目中
 */

export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: any;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: any;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

export type JsonRpcHandler = (params: any) => Promise<any> | any;

const MAX_CONTENT_LENGTH_BYTES = 10 * 1024 * 1024; // 上限：10MB
const MAX_BUFFER_BYTES = 20 * 1024 * 1024; // 防护：避免畸形输入导致 buffer 无限制增长

export class JsonRpcStdioConnection {
  private buffer: Buffer = Buffer.from("");
  private handlers = new Map<string, JsonRpcHandler>();

  constructor(
    private readonly stdin: { on(ev: "data", cb: (chunk: Uint8Array) => void): void },
    private readonly stdout: { write(data: string): void },
    private readonly onError: (err: Error) => void = () => {}
  ) {}

  on(method: string, handler: JsonRpcHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * 开始监听 stdin，并处理输入的 JSON-RPC 消息。
   */
  start(): void {
    this.stdin.on("data", (chunk: Uint8Array) => {
      try {
        this.onData(Buffer.from(chunk));
      } catch (e) {
        this.onError(e as Error);
      }
    });
  }

  notify(method: string, params?: any): void {
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.send(msg);
  }

  private send(msg: object): void {
    const json = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(json, "utf-8")}\r\n\r\n${json}`;
    this.stdout.write(frame);
  }

  private async dispatchRequest(req: JsonRpcRequest): Promise<void> {
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.send({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` }
      } satisfies JsonRpcResponse);
      return;
    }

    try {
      const result = await handler(req.params);
      this.send({ jsonrpc: "2.0", id: req.id, result } satisfies JsonRpcResponse);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      this.send({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: msg }
      } satisfies JsonRpcResponse);
    }
  }

  private dispatchNotification(note: JsonRpcNotification): void {
    const handler = this.handlers.get(note.method);
    if (!handler) return;
    Promise.resolve(handler(note.params)).catch((e) => this.onError(e as Error));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // 防护：对端若发送畸形数据（例如 header 永远不结束），避免内存无限增长。
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.onError(new Error(`JSON-RPC buffer exceeded ${MAX_BUFFER_BYTES} bytes; dropping buffer`));
      this.buffer = Buffer.from("");
      return;
    }

    // 流式解析：可能一次 data 里包含多个帧，也可能只包含半个帧
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerText = this.buffer.slice(0, headerEnd).toString("utf-8");
      const m = /content-length:\s*(\d+)/i.exec(headerText);
      if (!m) {
        // 解析不到长度：丢弃 header，尝试继续（容错）
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const len = Number(m[1]);
      if (!Number.isFinite(len) || len < 0 || len > MAX_CONTENT_LENGTH_BYTES) {
        this.onError(new Error(`Invalid Content-Length: ${String(m[1])}`));
        // 丢弃当前 header，继续寻找下一帧（容错）。
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + len;
      if (this.buffer.length < bodyEnd) return; // 等更多数据

      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf-8");
      this.buffer = this.buffer.slice(bodyEnd);

      let msg: any;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }

      // JSON-RPC：有 id => request/response；无 id => notification
      const methodOk = typeof msg?.method === "string" && msg.method.length > 0;
      const idOk = typeof msg?.id === "number" || typeof msg?.id === "string";
      if (msg && msg.jsonrpc === "2.0" && methodOk && idOk) {
        void this.dispatchRequest(msg as JsonRpcRequest);
      } else if (msg && msg.jsonrpc === "2.0" && methodOk && msg.id === undefined) {
        this.dispatchNotification(msg as JsonRpcNotification);
      }
    }
  }
}
