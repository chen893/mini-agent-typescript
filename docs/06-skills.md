# Skills（渐进式加载：Progressive Disclosure）

Skills 是“把领域知识/固定流程”从对话里抽出来，做成可复用的文件夹资源。

如果你还没读仓库根目录的 `skill.md`，建议先读一遍：它解释了 Skills 的三层加载模型（元数据/指令/资源代码）。

## 1) 为什么需要 Skills？

只靠 prompt 的问题：
- 同样的流程要反复描述
- 长文档会吃掉上下文
- 你很难维护“组织级最佳实践”（容易漂移）

Skills 的思路：
- 把“专业流程”写成 SKILL.md
- 把“长参考资料”放进 reference/
- 把“确定性操作”放进 scripts/
- 让模型按需加载（而不是一上来就塞进 system prompt）

## 2) Progressive Disclosure 的三层加载

### Level 1：元数据（始终加载）

模型启动时只看到：
- skill 的 `name`
- skill 的 `description`

TS 版实现：`src/tools/skills/skillLoader.ts` 的 `getSkillsMetadataPrompt()`

为什么只加载元数据？
- 让你可以装很多 skills，但不产生上下文成本
- 模型只需要知道“有哪些技能、什么时候用”

### Level 2：指令（触发时加载）

当模型判断需要某 skill 时，会调用工具：

- `get_skill({ skill_name })`

TS 版实现：
- 工具：`src/tools/skills/skillTool.ts`
- 查找：`src/tools/skills/skillLoader.ts`

返回内容会以“Skill: xxx”块的形式进入上下文。

### Level 3：资源与代码（按需加载）

Skill 里经常写：
- “请阅读 reference/xxx.md”
- “运行 scripts/yyy.py”

TS 版会把这类相对路径替换为绝对路径（避免工作目录变化导致找不到）：

- `src/tools/skills/skillLoader.ts` 的 `processSkillPaths()`

这就是 Progressive Disclosure 的关键：只有“被引用的文件”才进入上下文。

## 3) Skill 的目录结构怎么写？

最小结构：

```
my-skill/
└── SKILL.md
```

推荐结构：

```
my-skill/
├── SKILL.md
├── reference/
│   └── guide.md
└── scripts/
    └── helper.ts
```

你可以参考中文教学示例：
- `skills/template-skill-cn/`

## 4) frontmatter 写得好，Skill 才会“被想起来”

Skill 能否被模型正确使用，关键在 `description`：

好的 description 应该回答：
- “什么时候用”（触发条件/关键词）
- “能做什么”（能力边界）
- “不要做什么”（安全/版权/风险边界）

## 5) 常见踩坑

1. 忘记写 YAML frontmatter（--- ... ---）→ skill 会被跳过
2. name/description 为空 → skill 会被跳过
3. description 太泛 → 模型在不该用时也会乱用
4. 把超长参考资料写进 SKILL.md 主体 → 失去渐进式加载的意义

