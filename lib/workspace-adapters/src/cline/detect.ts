import { join } from "node:path";
import {
  addFile,
  compareArtifacts,
  inspectFile,
  makeArtifact,
  safeStat,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `cline` detector (pivot T1.6) - inventories the Cline config surface as
 * verified against docs.cline.bot and the cline.bot changelog on 2026-08-24
 * (§3 fast-churn caveat):
 *
 * - `.clinerules` - either the legacy single file or a directory whose
 *   `*.md` / `*.txt` files are all rules, with two special subtrees:
 *   `workflows/` (slash-command workflows) and `hooks/` (executable hook
 *   scripts named by hook type, extensionless)
 * - `AGENTS.md` at the repo root (root-only is what Cline documents)
 * - the `.cursorrules` / `.windsurfrules` fallbacks Cline also reads (their
 *   home adapters inventory them too; Cline reading them is its own fact)
 * - `.clineignore` (docs mark it "deprecate soon" - still read today)
 *
 * There is no project-level MCP file (global-only) and no CLAUDE.md support.
 *
 * Same guarantees as every other detector: pure, read-only, deterministic
 * sorted output, symlink-aware (literal targets, never resolved away -
 * §10.4), cycle-safe, and fs errors contained - never fatal.
 */

/** Artifact kinds this detector reports. */
export type ClineArtifactKind =
  | "instructions" // root AGENTS.md
  | "rule" // .clinerules (file or directory), .cursorrules, .windsurfrules
  | "workflow" // .clinerules/workflows/
  | "hooks" // .clinerules/hooks/
  | "ignore"; // .clineignore

export interface ClineArtifact extends DetectedArtifact {
  kind: ClineArtifactKind;
}

const RULES_DIR = ".clinerules";

export function detect(repo: RepoContext): ClineArtifact[] {
  const root = repo.rootDir;
  const out: ClineArtifact[] = [];

  // `.clinerules` is either a directory (walked, including one reached via a
  // symlink) or the legacy single file - `safeStat` follows symlinks, so a
  // link to a directory is not mistaken for a broken rule file.
  const rulesAbs = join(root, RULES_DIR);
  if (safeStat(rulesAbs)?.isDirectory()) {
    walk(
      rulesAbs,
      RULES_DIR,
      new Set(),
      () => true,
      () => true,
      (name, rel, info) => {
        const kind = clineArtifactKind(name, rel);
        if (kind !== undefined) {
          out.push(makeArtifact(rel, kind, "project", info));
        }
      },
    );
  } else {
    const singleFile = inspectFile(rulesAbs);
    if (singleFile) {
      out.push(makeArtifact(RULES_DIR, "rule", "project", singleFile));
    }
  }

  addFile(root, "AGENTS.md", "instructions", "project", out);
  addFile(root, ".cursorrules", "rule", "project", out);
  addFile(root, ".windsurfrules", "rule", "project", out);
  addFile(root, ".clineignore", "ignore", "project", out);

  return out.sort(compareArtifacts);
}

/**
 * Classifies one file inside `.clinerules/`. Both special subtrees are
 * documented flat, so only their direct children count: `workflows/*.md`
 * slash-command workflows, and `hooks/*` hook scripts (extensionless
 * executables named by hook type, so any file counts). Deeper files there
 * are helpers, not artifacts. Everywhere else `*.md` / `*.txt` are rules.
 */
function clineArtifactKind(name: string, rel: string): ClineArtifactKind | undefined {
  if (rel === `${RULES_DIR}/workflows/${name}`) {
    return name.endsWith(".md") ? "workflow" : undefined;
  }
  if (rel === `${RULES_DIR}/hooks/${name}`) {
    return "hooks";
  }
  if (
    rel.startsWith(`${RULES_DIR}/workflows/`) ||
    rel.startsWith(`${RULES_DIR}/hooks/`)
  ) {
    return undefined;
  }
  return name.endsWith(".md") || name.endsWith(".txt") ? "rule" : undefined;
}
