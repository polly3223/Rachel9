import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.ts";

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
}

/**
 * Scan the skills/ directory and return metadata for all valid skills.
 * A valid skill is a directory containing SKILL.md with YAML frontmatter (name + description).
 */
export function loadSkillMetadata(skillsDir: string): SkillMeta[] {
  if (!existsSync(skillsDir)) {
    logger.debug("Skills directory not found", { skillsDir });
    return [];
  }

  const skills: SkillMeta[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsDir, entry.name);
    const skillMd = join(skillPath, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    try {
      const content = readFileSync(skillMd, "utf-8");
      const meta = parseSkillFrontmatter(content);
      if (meta) {
        skills.push({ ...meta, path: skillPath });
      }
    } catch {
      logger.warn("Failed to parse skill", { skill: entry.name });
    }
  }

  logger.debug("Skills loaded", { count: skills.length, names: skills.map((s) => s.name) });
  return skills;
}

/**
 * Build a skill list section for the system prompt.
 * Returns empty string if no skills found.
 */
export function buildSkillPromptSection(skillsDir: string): string {
  const skills = loadSkillMetadata(skillsDir);
  if (skills.length === 0) return "";

  const lines = skills.map((s) => `- *${s.name}*: ${s.description}`);
  return `\n\n## Available Skills
You have specialized skills in the skills/ directory. When a task matches a skill, read the full SKILL.md for detailed instructions:
${lines.join("\n")}`;
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Extracts name and description fields.
 */
function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;

  const yaml = match[1];
  const nameMatch = yaml.match(/name:\s*["']?([^"'\n]+)["']?/);
  const descMatch = yaml.match(/description:\s*["']?([\s\S]*?)["']?\s*(?:\n[a-z]|\n---|\n$)/);

  const name = nameMatch?.[1]?.trim();

  // Description can be multi-line quoted — extract just the content
  let desc = descMatch?.[1]?.trim();
  if (!desc) {
    // Simpler fallback: just get everything after "description:"
    const simpleParse = yaml.match(/description:\s*["']?(.+)/);
    desc = simpleParse?.[1]?.trim().replace(/["']$/, "");
  }

  if (!name || !desc) return null;

  // Truncate long descriptions for system prompt
  if (desc.length > 200) {
    desc = desc.slice(0, 200) + "...";
  }

  return { name, description: desc };
}
