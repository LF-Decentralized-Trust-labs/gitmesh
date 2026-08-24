import { compareArtifacts, makeArtifact, walk } from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `agentsmd` detector (pivot T1.6) - the pure AGENTS.md standard surface
 * (§10.6 "agentsmd (pure)"): `AGENTS.md` at any depth, exactly as the
 * agents.md spec defines it - the nearest file wins per subtree, so every
 * nested copy is an artifact. Nothing else: the standard has no config,
 * rules, MCP, or permission surface.
 *
 * Same guarantees as every other detector: pure, read-only, deterministic
 * sorted output, symlink-aware (literal targets, never resolved away -
 * §10.4), cycle-safe, and fs errors contained - never fatal.
 */

/** Artifact kinds this detector reports. */
export type AgentsMdArtifactKind = "instructions";

export interface AgentsMdArtifact extends DetectedArtifact {
  kind: AgentsMdArtifactKind;
}

/** The repo-wide AGENTS.md walk never enters these. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

export function detect(repo: RepoContext): AgentsMdArtifact[] {
  const out: AgentsMdArtifact[] = [];
  walk(
    repo.rootDir,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md",
    (_name, rel, info) => {
      out.push(makeArtifact(rel, "instructions", "project", info));
    },
  );
  return out.sort(compareArtifacts);
}
