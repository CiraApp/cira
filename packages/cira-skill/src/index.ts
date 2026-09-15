import { readFileSync } from "node:fs";

/**
 * The Cira Skill: one file, read by every coding agent we support.
 *
 * There is deliberately no per-agent version. Agents differ in where a skill
 * lives and what wrapper it needs, not in what Cira wants them to know, so the
 * installers adapt the packaging and never the content.
 */

export interface CanonicalSkill {
  /** Directory or rule name an agent files this under. */
  name: string;
  /** One line telling an agent when this applies. */
  description: string;
  /**
   * The markdown, without frontmatter. Identical everywhere it is installed:
   * this is the part that must not fork.
   */
  body: string;
  /** The canonical file as written, frontmatter included. */
  source: string;
}

const SKILL_PATH = new URL("../SKILL.md", import.meta.url);

/**
 * Read the skill off disk rather than inlining it at build time, so SKILL.md
 * stays a real file that a person can read, review and edit in a diff.
 */
export function canonicalSkill(): CanonicalSkill {
  const source = readFileSync(SKILL_PATH, "utf8");
  const parsed = splitFrontmatter(source);

  return {
    name: parsed.fields["name"] ?? "cira",
    description: parsed.fields["description"] ?? "Build and deploy to Cira.",
    body: parsed.body,
    source,
  };
}

/**
 * Enough YAML for this one file's frontmatter, which is two scalar fields.
 * A parser would be a dependency bought to read something we also write.
 */
function splitFrontmatter(source: string): {
  fields: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (match === null) return { fields: {}, body: source.trim() };

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key !== "") fields[key] = value;
  }

  return { fields, body: source.slice(match[0].length).trim() };
}
