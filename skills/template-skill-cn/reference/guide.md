# Skill 写作指南（简版）

## frontmatter 写什么？

- `name`：建议用短且稳定的 id（例如 `pdf-processing`）
- `description`：写清楚“什么时候用”。一句话规则：如果用户话里出现某类关键词，你就希望模型能联想到这个 Skill。

示例：

```yaml
---
name: typescript-refactor
description: 用于 TypeScript 项目重构：目录结构调整、类型收敛、eslint/prettier 配置、常见坑排查。涉及 TS 重构或工程化配置时使用。
---
```

## SKILL.md 主体怎么写？

- 用“步骤 + 产出物”的形式写：每一步要产生什么文件/输出什么信息
- 把“通用但很长”的内容拆出去：放到 reference/ 里，避免每次都占上下文
- 如果某一步可以确定性完成：优先写成脚本放 scripts/，再教模型如何调用

