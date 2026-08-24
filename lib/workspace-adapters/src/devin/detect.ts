import {
  addFile,
  collectMarkdownTree,
  collectSkillManifests,
  compareArtifacts,
  makeArtifact,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `devin` detector (pivot T1.6) - inventories the Devin Desktop (ex-Windsurf,
 * renamed 2026-06-02) config surface. §4.3 lists only "AGENTS.md; legacy
 * `.windsurf/rules`"; the surface verified against docs.devin.ai on
 * 2026-08-24 is wider (§3 fast-churn caveat):
 *
 * - `AGENTS.md` at any depth (root = always-on, subdirectory = dir-scoped)
 * - rules: `.devin/rules/` (preferred) and the still-read legacy locations
 *   `.windsurf/rules/` and the single-file `.windsurfrules`
 * - `.windsurf/workflows/` (no `.devin/` equivalent is documented)
 * - `.windsurf/hooks.json` (workspace hooks; 12 pre/post events)
 * - skills: `.devin/skills/<name>/SKILL.md` and `.windsurf/skills/…`
 *   (`.agents/skills/` compat is the codex adapter's surface)
 * - `.devin/blueprint.yaml` (Devin Cloud environment config)
 *
 * There is no project-level MCP file - MCP config is user-level only.
 * Devin Cloud "Knowledge" is server-side, so no repo artifact exists for it.
 *
 * Same guarantees as every other detector: pure, read-only, deterministic
 * sorted output, symlink-aware (literal targets, never resolved away -
 * §10.4), cycle-safe, and fs errors contained - never fatal.
 */

/** Artifact kinds this detector reports. */
export type DevinArtifactKind =
  | "instructions" // AGENTS.md hierarchy
  | "rule" // .devin/rules/, .windsurf/rules/, .windsurfrules
  | "workflow" // .windsurf/workflows/
  | "hooks" // .windsurf/hooks.json
  | "skill" // .devin/skills/, .windsurf/skills/
  | "config"; // .devin/blueprint.yaml

export interface DevinArtifact extends DetectedArtifact {
  kind: DevinArtifactKind;
}

/** The AGENTS.md walk skips these; `.devin`/`.windsurf` hold config, not instructions. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".devin",
  ".windsurf",
]);

export function detect(repo: RepoContext): DevinArtifact[] {
  const root = repo.rootDir;
  const out: DevinArtifact[] = [];

  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md",
    (_name, rel, info) => {
      out.push(makeArtifact(rel, "instructions", "project", info));
    },
  );

  addFile(root, ".windsurfrules", "rule", "project", out);
  collectMarkdownTree(root, ".devin/rules", "rule", out);
  collectMarkdownTree(root, ".windsurf/rules", "rule", out);
  collectMarkdownTree(root, ".windsurf/workflows", "workflow", out);
  addFile(root, ".windsurf/hooks.json", "hooks", "project", out);
  collectSkillManifests(root, ".devin/skills", "skill", out);
  collectSkillManifests(root, ".windsurf/skills", "skill", out);
  addFile(root, ".devin/blueprint.yaml", "config", "project", out);

  return out.sort(compareArtifacts);
}
