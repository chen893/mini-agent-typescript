# MCP（Model Context Protocol：把外部工具接入 Agent）

MCP 的定位：让你用统一协议把“外部工具/服务”挂到 Agent 上。

直觉理解：
- Tools：项目内自己写的工具（read_file、bash…）
- MCP Tools：外部进程提供的工具（通过标准协议发现与调用）

## 1) 本项目 MCP 的行为（对齐 Python 版）

启动时：

1. 读取 `mcp.json`
2. 对每个 enabled server：
   - 启动子进程（stdio）
   - JSON-RPC initialize
   - JSON-RPC tools/list 获取工具列表
   - 把每个工具包装成我们自己的 Tool（可被模型 tool calling）

调用时：
- 当模型发起 tool_call（工具名是 MCP tool 的 name），我们执行 `tools/call` 把 arguments 发给 MCP server

TS 版实现文件：
- `src/tools/mcpLoader.ts`

## 2) 配置文件：mcp.json

示例：`mini-agent-typescript/config/mcp.json`

核心结构：

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "disabled": true
    }
  }
}
```

要启用某个 server：
- 把 `disabled` 改为 `false`
- 确保本机能运行对应的 command（例如 npx）

## 3) 为什么 MCP server 不应该向 stdout 打日志？

因为 stdout 是协议通道（JSON-RPC 帧）。
一旦 MCP server 往 stdout 输出了普通日志，会直接破坏 framing，客户端就无法解析消息。

正确做法：
- stdout 只输出协议帧
- 日志写 stderr

这点在 MCP/ACP 都一样。

## 4) 教学实现 vs 生产实现

本项目为了“易读”，自己实现了一个最小 JSON-RPC stdio 客户端（Content-Length framing）。

生产建议：
- 直接使用官方 MCP SDK（TypeScript: `@modelcontextprotocol/sdk`）
- 它能更好地处理 capabilities、错误码、边界情况

## 5) 你可以做的一个最小练习

1) 启用 `config/mcp.json` 的某个 server  
2) 启动 agent，观察启动时是否提示加载到 MCP tools  
3) 给一个会触发该 MCP tool 的任务（例如“搜索/记忆”类），观察模型是否主动调用它  

