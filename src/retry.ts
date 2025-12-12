import type { RetryConfig } from "./config.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 一个简单但实用的异步重试器（与 Python 版的 RetryConfig 语义尽量保持一致）。
 *
 * 典型用法：
 * - 网络请求失败（超时、5xx、临时网络波动）
 * - 需要指数退避（exponential backoff）
 *
 * 说明：
 * - 教学项目里，我们把“什么错误值得重试”交给调用方判断：只要 throw，就会走重试逻辑。
 * - 真实项目建议：区分 4xx/5xx、超时、连接错误，并记录可观测性数据。
 */
export async function asyncRetry<T>(cfg: RetryConfig, fn: (attempt: number) => Promise<T>): Promise<T> {
  if (!cfg.enabled) return fn(0);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= cfg.maxRetries) break;

      // 退避：initial * base^attempt，封顶 maxDelay
      const delaySec = Math.min(cfg.maxDelaySec, cfg.initialDelaySec * Math.pow(cfg.exponentialBase, attempt));

      // 轻微 jitter，避免“惊群”
      const jitter = 0.2 + Math.random() * 0.2; // 0.2~0.4
      await sleep(delaySec * 1000 * jitter);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

