import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import {
  addFile,
  collectMarkdownTree,
  collectSkillManifests,
  compareArtifacts,
  inspectFile,
  lastSegment,
  makeArtifact,
  safeStat,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `claude-code` detector (pivot T1.1) - inventories every Claude Code config
 * artifact in a repository per the §4.3 config-surface row.
 *
 * Pure, read-only file inspection: no writes, no network, deterministic
 * output (sorted, no wallclock, no absolute paths in results). Symlink-aware:
 * symlinked artifacts are inventoried with their literal target - a symlinked
 * CLAUDE.md is a healthy pattern (§10.4), never resolved away - symlinked
 * directories are traversed, and traversal is cycle-safe. Filesystem errors on
 * individual entries - an unreadable directory, a symlink cycle - are
 * contained: the entry is skipped or flagged `broken`, never fatal, so a
 * doctor scan survives any repository.
 */

/** Artifact kinds this detector reports. */
export type ClaudeCodeArtifactKind =
  | "instructions" // CLAUDE.md / CLAUDE.local.md hierarchy, ~/.claude/CLAUDE.md
  | "rule" // .claude/rules/**/*.md
  | "skill" // .claude/skills/<name>/SKILL.md
  | "command" // .claude/commands/**/*.md
  | "subagent" // .claude/agents/**/*.md
  | "settings" // .claude/settings*.json + managed-settings presence probes
  | "mcp-config" // .mcp.json
  | "plugin-manifest" // .claude-plugin/plugin.json
  | "marketplace"; // .claude-plugin/marketplace.json

export interface ClaudeCodeArtifact extends DetectedArtifact {
  kind: ClaudeCodeArtifactKind;
}

/**
 * Per-OS locations Claude Code reads org-managed settings from (MDM/console
 * deployed), probed for presence only. `managed-settings.d/` is the drop-in
 * fragment directory. Overridable via `RepoContext.managedSettingsPaths`.
 */
export function defaultManagedSettingsPaths(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (platform === "win32") {
    const dir = win32.join(env["ProgramData"] ?? "C:\\ProgramData", "ClaudeCode");
    return [win32.join(dir, "managed-settings.json"), win32.join(dir, "managed-settings.d")];
  }
  const dir =
    platform === "darwin" ? "/Library/Application Support/ClaudeCode" : "/etc/claude-code";
  return [posix.join(dir, "managed-settings.json"), posix.join(dir, "managed-settings.d")];
}

/**
 * Directories the CLAUDE.md hierarchy walk never enters: VCS internals,
 * dependency trees, and `.claude/` itself (its contents are inventoried by
 * the dedicated scans below, and files inside it are not memory files).
 */
const INSTRUCTION_WALK_EXCLUDES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".claude",
]);

/** Display path used for the user-scope memory file, stable across machines. */
const USER_MEMORY_PATH = "~/.claude/CLAUDE.md";

export function detect(repo: RepoContext): ClaudeCodeArtifact[] {
  const root = repo.rootDir;
  const artifacts: ClaudeCodeArtifact[] = [];

  // 1. CLAUDE.md / CLAUDE.local.md hierarchy: repo root + every subdirectory.
  walk(
    root,
    "",
    new Set(),
    (name) => !INSTRUCTION_WALK_EXCLUDES.has(name),
    (name) => name === "CLAUDE.md" || name === "CLAUDE.local.md",
    (name, rel, info) => {
      const scope = name === "CLAUDE.md" ? "project" : "local";
      artifacts.push(makeArtifact(rel, "instructions", scope, info));
    },
  );

  // 2. `.claude/` surface. Settings are resolved from the git root only
  //    (Claude Code v2.1.211+ semantics; callers pass that root as rootDir),
  //    so nested `.claude/` directories are deliberately not scanned.
  addFile(root, ".claude/settings.json", "settings", "project", artifacts);
  addFile(root, ".claude/settings.local.json", "settings", "local", artifacts);
  collectMarkdownTree(root, ".claude/rules", "rule", artifacts);
  collectMarkdownTree(root, ".claude/commands", "command", artifacts);
  collectMarkdownTree(root, ".claude/agents", "subagent", artifacts);
  collectSkillManifests(root, ".claude/skills", "skill", artifacts);

  // 3. Repo-root singletons: MCP config and plugin/marketplace manifests.
  addFile(root, ".mcp.json", "mcp-config", "project", artifacts);
  addFile(root, ".claude-plugin/plugin.json", "plugin-manifest", "project", artifacts);
  addFile(root, ".claude-plugin/marketplace.json", "marketplace", "project", artifacts);

  // 4. User scope, only when requested (`doctor --user`; §10.1 trust boundary).
  if (repo.userScope) {
    const home = repo.homeDir ?? homedir();
    const info = inspectFile(join(home, ".claude", "CLAUDE.md"));
    if (info) {
      artifacts.push(makeArtifact(USER_MEMORY_PATH, "instructions", "user", info));
    }
  }

  // 5. Managed-settings presence probe: report presence only - never the
  //    location (machine-specific) and never the content.
  for (const probe of repo.managedSettingsPaths ?? defaultManagedSettingsPaths()) {
    if (safeStat(probe) !== undefined) {
      artifacts.push(makeArtifact(lastSegment(probe), "settings", "managed"));
    }
  }

  return dedupe(artifacts).sort(compareArtifacts);
}

/** Managed probes may alias; everything else is unique by construction. */
function dedupe(artifacts: ClaudeCodeArtifact[]): ClaudeCodeArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.scope}\u0000${artifact.kind}\u0000${artifact.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
