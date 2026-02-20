# Plan 03: Skills System (Wave 2)

Covers: SKILL-01, SKILL-02, SKILL-03

## Step 1: Copy skills directory

```bash
cp -r /home/rachel/rachel8/skills/ /home/rachel/rachel9/skills/
```

All 12 skills + whatsapp-bridge.md (from Wave 1).

## Step 2: Create `src/lib/skills.ts`

Simple skill loader that reads SKILL.md frontmatter:

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.ts";

export interface SkillMeta {
  name: string;
  description: string;
  path: string; // absolute path to skill directory
}

/**
 * Scan the skills/ directory and return metadata for all valid skills.
 * A valid skill has a SKILL.md with YAML frontmatter containing name + description.
 */
export function loadSkillMetadata(skillsDir: string): SkillMeta[] {
  if (!existsSync(skillsDir)) return [];

  const skills: SkillMeta[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(skillsDir, entry.name);
    const skillMd = join(skillPath, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    const content = readFileSync(skillMd, "utf-8");
    const meta = parseSkillFrontmatter(content);
    if (meta) {
      skills.push({ ...meta, path: skillPath });
    }
  }

  logger.debug("Skills loaded", { count: skills.length });
  return skills;
}

function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1]!;
  const name = yaml.match(/name:\s*(.+)/)?.[1]?.trim();
  const desc = yaml.match(/description:\s*(.+)/)?.[1]?.trim();

  if (!name || !desc) return null;
  return { name, description: desc };
}
```

## Step 3: Integrate into system prompt

Modify `src/agent/system-prompt.ts`:

```typescript
import { loadSkillMetadata } from "../lib/skills.ts";
import { join } from "node:path";

// In buildSystemPrompt(), after memory injection:
const skillsDir = join(process.cwd(), "skills");
const skills = loadSkillMetadata(skillsDir);

if (skills.length > 0) {
  const skillList = skills
    .map((s) => `- *${s.name}*: ${s.description}`)
    .join("\n");

  prompt += `\n\n## Available Skills\nYou have skills in the skills/ directory. When a task matches, read the full SKILL.md:\n${skillList}`;
}
```

## Step 4: Add skills mention to base system prompt

In the BASE_PROMPT, add near the end (before closing backtick):

```markdown
## Skills
You have specialized skills installed. Check the "Available Skills" section below for capabilities like PDF manipulation, Excel, Word, PowerPoint, web design, and more. When a task matches a skill, read the full SKILL.md for detailed instructions.
```

## Verification

1. `bun run typecheck` passes
2. Skills loaded in system prompt (check via debug log or test)
3. Count: should find 12+ skills
4. Agent can read any SKILL.md via file tools when triggered
