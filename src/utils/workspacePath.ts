import path from "node:path";

/**
 * 把用户给的相对路径解析到工作区，并阻止 `..` 逃逸。
 *
 * 说明：
 * - 教学项目里只做基础约束：最终路径必须以 workspaceDir 作为前缀（path.relative 不以 .. 开头）。
 * - 真实项目还需要处理符号链接、UNC 路径等边界情况。
 */
export function resolveInWorkspace(workspaceDirAbs: string, userPath: string): string {
  const abs = path.isAbsolute(userPath) ? path.normalize(userPath) : path.resolve(workspaceDirAbs, userPath);
  const rel = path.relative(workspaceDirAbs, abs);
  // rel === "" 表示就是 workspaceDir 本身，允许（用于写入目录等）
  if (rel === "") return abs;
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${userPath}`);
  }
  return abs;
}
