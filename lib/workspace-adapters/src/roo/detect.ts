import { join } from "node:path";
import {
  addFile,
  collectDirFiles,
  compareArtifacts,
  fileInfoFromEntry,
  isTraversableDir,
  makeArtifact,
  sortedEntries,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `roo` detector (pivot T1.6) - inventories the Roo Code config surface as
 * verified against the Roo Code docs on 2026-08-24 (§3 fast-churn caveat):
 *
 * - rules: `.roo/rules/` and per-mode `.roo/rules-<slug>/` directories
 *   (recursive, every file counts), plus their root-level single-file
 *   fallbacks `.roorules` and `.roorules-<slug>`
 * - `AGENTS.md` / `AGENT.md` at the repo root (AGENTS.md wins; root-only is
 *   what Roo documents)
 * - `.roomodes` (project custom modes, YAML or JSON)
 * - `.roo/mcp.json` (project MCP servers - overrides global on collision)
 * - `.roo/commands/*.md` slash commands (single-level by design)
 * - `.rooignore`
 *
 * The removed `.roo/system-prompt-<slug>` override is not inventoried - the
 * feature no longer exists, so the file is debris, not config.
 *
 * Same guarantees as every other detector: pure, read-only, deterministic
 * sorted output, symlink-aware (literal targets, never resolved away -
 * §10.4), cycle-safe, and fs errors contained - never fatal.
 */

/** Artifact kinds this detector reports. */
export type RooArtifactKind =
  | "instructions" // root AGENTS.md / AGENT.md
  | "rule" // .roo/rules*/ trees, .roorules* fallbacks
  | "modes" // .roomodes
  | "mcp-config" // .roo/mcp.json
  | "command" // .roo/commands/*.md
  | "ignore"; // .rooignore

export interface RooArtifact extends DetectedArtifact {
  kind: RooArtifactKind;
}

const ROO_DIR = ".roo";

/** `rules` or `rules-<mode slug>`. */
const RULES_DIR_PATTERN = /^rules(-.+)?$/;

/** Root-level `.roorules` or `.roorules-<mode slug>`. */
const ROORULES_PATTERN = /^\.roorules(-.+)?$/;

export function detect(repo: RepoContext): RooArtifact[] {
  const root = repo.rootDir;
  const out: RooArtifact[] = [];

  // Rules trees: every `.roo/rules*/` directory, recursively, every file.
  const rooBase = join(root, ROO_DIR);
  for (const entry of sortedEntries(rooBase)) {
    const abs = join(rooBase, entry.name);
    if (RULES_DIR_PATTERN.test(entry.name) && isTraversableDir(entry, abs)) {
      walk(
        abs,
        `${ROO_DIR}/${entry.name}`,
        new Set(),
        () => true,
        () => true,
        (_name, rel, info) => {
          out.push(makeArtifact(rel, "rule", "project", info));
        },
      );
    }
  }

  // Root-level fallbacks and single files.
  for (const entry of sortedEntries(root)) {
    const abs = join(root, entry.name);
    if (!ROORULES_PATTERN.test(entry.name) || isTraversableDir(entry, abs)) {
      continue;
    }
    const info = fileInfoFromEntry(entry, abs);
    if (info) {
      out.push(makeArtifact(entry.name, "rule", "project", info));
    }
  }
  addFile(root, "AGENTS.md", "instructions", "project", out);
  addFile(root, "AGENT.md", "instructions", "project", out);
  addFile(root, ".roomodes", "modes", "project", out);
  addFile(root, ".rooignore", "ignore", "project", out);
  addFile(root, `${ROO_DIR}/mcp.json`, "mcp-config", "project", out);
  collectDirFiles(root, `${ROO_DIR}/commands`, (n) => n.endsWith(".md"), "command", out);

  return out.sort(compareArtifacts);
}
