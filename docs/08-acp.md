# ACP（Agent Client Protocol：把 Agent 接入 IDE/编辑器）

ACP 的定位：让“宿主”（IDE/编辑器/桌面客户端）能以统一协议与 Agent 交互，并实时看到 Agent 的中间过程。

直觉理解：
- CLI 模式：你在终端里看过程
- ACP 模式：宿主通过协议拿到过程（thinking、tool 状态），在 UI 里展示

## 1) 本项目 ACP 的实现方式（对齐 Python 版思路）

TS 版提供一个教学版 ACP server（stdio JSON-RPC）：

- 入口：`src/acp/server.ts`
- 适配器：`src/acp/MiniMaxACPAgent.ts`
- 消息构造：`src/acp/updates.ts`
- JSON-RPC framing：`src/utils/jsonRpcStdio.ts`

### 会话模型

- 一个 ACP session 对应一个 Agent 实例
- 不同 session 之间互不影响（各自的 workspace 与 message history）

### turn 模型

`prompt()` 不是“调用一次模型就结束”，而是一次 turn：
- 在 turn 内可能多次调用 LLM + tools
- 直到模型不再请求 tool_calls，或达到 max_steps

这与 Python 版 `MiniMaxACPAgent._run_turn()` 的行为一致。

## 2) 为什么 ACP 模式不能打印 stdout？

ACP 也是 stdio 协议：
- stdout 是协议帧通道
- 任何普通 console.log 都会污染 stdout，导致宿主解析失败

因此：
- ACP 模式下要把日志写 stderr（本项目已这样做）

## 3) 如何启动 ACP server

```bash
cd mini-agent-typescript
npm run build
npm run start:acp
```

然后由你的宿主以 stdio 方式启动/连接它（具体取决于宿主实现）。

## 4) 教学实现 vs 正式对接

本项目 ACP 的消息结构是“教学版最小集合”，用于理解：
- sessionUpdate 的存在意义
- tool call 生命周期（start → update）
- thought/message 的流式更新

如果你要对接某个 IDE 的“正式 ACP”：
- 请以宿主的 ACP 规范为准，替换 `src/acp/updates.ts` 的结构
- 协议层建议使用官方 ACP SDK（如果提供 TypeScript 版本）

