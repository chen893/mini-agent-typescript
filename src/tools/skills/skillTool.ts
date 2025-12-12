import type { JsonObject } from "../../schema.js";
import { BaseTool, type ToolResult } from "../Tool.js";
import type { Skill, SkillLoader } from "./skillLoader.js";

function asString(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`Expected '${name}' to be string`);
  return v;
}

function skillToPrompt(skill: Skill): string {
  // 与 Python 版 Skill.to_prompt() 对齐：给模型一个清晰的“技能块”
  return `\n# Skill: ${skill.name}\n\n${skill.description}\n\n---\n\n${skill.content}\n`;
}

/**
 * Progressive Disclosure Level 2：
 * - 系统提示词里只放技能元数据（name/description）
 * - 当模型确认需要某个技能时，调用 get_skill 拉取该技能完整内容（SKILL.md 的主体）
 */
export class GetSkillTool extends BaseTool {
  readonly name = "get_skill";
  readonly description = "按名称获取某个 Skill 的完整内容（用于执行某类专业任务）。";
  readonly parameters = {
    type: "object",
    properties: {
      skill_name: { type: "string", description: "Skill 名称（可从系统提示词的 Available Skills 中查看）" }
    },
    required: ["skill_name"]
  } as const;

  constructor(private readonly loader: SkillLoader) {
    super();
  }

  async execute(args: JsonObject): Promise<ToolResult> {
    try {
      const name = asString(args.skill_name, "skill_name");
      const skill = this.loader.getSkill(name);
      if (!skill) {
        const available = this.loader.listSkills().join(", ");
        return {
          success: false,
          content: "",
          error: `Skill '${name}' does not exist. Available skills: ${available}`
        };
      }
      return { success: true, content: skillToPrompt(skill) };
    } catch (e) {
      return { success: false, content: "", error: (e as Error).message };
    }
  }
}

