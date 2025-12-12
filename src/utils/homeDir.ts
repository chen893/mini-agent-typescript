/**
 * 跨平台获取“用户主目录”（供 config/log/history 使用）。
 *
 * 教学说明：
 * - 为了避免强依赖 @types/node + os.homedir()，这里用一个很小的实现。
 * - 在受限环境下兜底到 process.cwd()，保证程序仍可运行。
 */
export function getHomeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || process.cwd();
}
