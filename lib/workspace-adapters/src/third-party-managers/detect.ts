import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  collectMarkdownTree,
  compareArtifacts,
  inspectFile,
  makeArtifact,
  safeLstat,
  sortedEntries,
  symlinkInfo,
} from "../detect-fs.js";
import type { ArtifactScope, DetectedArtifact, RepoContext } from "../types.js";

/**
 * `third-party-managers` detector (pivot T1.7) - recognizes repos whose agent
 * config is already managed by another tool, per ADR-004 (coexistence):
 * every artifact here is **informational** - "managed by X" is never itself
 * a finding, and nothing downstream may suggest touching this territory.
 *
 * Recognized managers (paths verified against each project on 2026-08-24;
 * §3 fast-churn caveat):
 *
 * - **ruler**: `.ruler/ruler.toml` (the only config location), the
 *   recursively-concatenated `*.md` sources under `.ruler/` (AGENTS.md
 *   primary, skills/subagents included), and the deprecated `.ruler/mcp.json`.
 *   Ruler leaves no state file; its `.bak`/`.bak.ruler-generated` backup
 *   sidecars and generated-file markers are not inventoried
 * - **rulesync**: root `rulesync.jsonc` + machine-local
 *   `rulesync.local.jsonc`, the `.rulesync/` markdown source tree (`rules/`,
 *   `commands/`, `subagents/`, `skills/`, `checks/`), its top-level
 *   `mcp`/`hooks`/`permissions` `.json(c)` feature files, and the deprecated
 *   ignore files (`.rulesync/.aiignore`, root `.rulesyncignore`)
 * - **agents-json** (amtiYo `@agents-dev/cli`): `.agents/agents.json` +
 *   `.agents/local.json` (local secrets split - presence only, local scope)
 * - the **agentsync family** (several unrelated tools share the name):
 *   `.agents/agentsync.toml` (baranovxyz and dallay both use this path),
 *   `.agentsync/agentsync.toml` (spxrogers), `agentsync.config.json`
 *   (claaslange), and ai-rules-sync's root `agentsync.json` +
 *   `.agentsync-state.json`
 * - **agent_sync** (yelmuratoff): `.ai/agent_sync.yaml` + `.ai/.sync-manifest`
 * - **agent-sync** (GowayLee symlinker): `.agent-sync.toml`
 * - **agentlink**: optional `.agentlink.yaml` (its footprint is otherwise
 *   pure symlinks, caught by the topology scan below)
 * - **skills-lock**: `skills-lock.json` (Vercel skills CLI project lock;
 *   the v3 `~/.agents/.skill-lock.json` is user-global, never in-repo)
 * - **mcp-lock** (`@mcpguards/mcp-lock`): `.mcp.lock`
 * - **symlinks**: the topology scan - known agent config paths that are
 *   symlinks (agentlink / dallay / GowayLee patterns, or a hand-rolled
 *   `CLAUDE.md -> AGENTS.md`). A symlinked config is a healthy zero-drift
 *   pattern (§10.4), reported with its literal target, never resolved away;
 *   a link resolving to a *directory* is healthy here too
 *
 * Same guarantees as every other detector: pure, read-only, deterministic
 * sorted output, cycle-safe, and fs errors contained - never fatal.
 */

/** Artifact kinds this detector reports. */
export type ThirdPartyManagerArtifactKind =
  | "config" // a manager's own config file
  | "source" // a manager's source-of-truth content
  | "state" // generated-state / drift manifests
  | "lockfile" // skills-lock.json, .mcp.lock
  | "symlink"; // topology scan: a symlinked agent config path

export interface ThirdPartyManagerArtifact extends DetectedArtifact {
  kind: ThirdPartyManagerArtifactKind;
  /** The X in doctor's "managed by X" label. */
  manager: string;
}

/**
 * The coexistence note renderers attach to every managed-by-X artifact
 * (ADR-004): informational, never a finding, never a migration prompt.
 */
export const COEXISTENCE_NOTE =
  "Managed by a third-party tool. GitMesh detects and respects this territory; " +
  "it will never write here, and migration happens only via an explicit " +
  "`gitmesh migrate` (ADR-004).";

interface ManagerProbe {
  path: string;
  kind: ThirdPartyManagerArtifactKind;
  manager: string;
  scope?: ArtifactScope;
}

/** Single-file probes, one per manager artifact whose path identifies it. */
const MANAGER_FILES: readonly ManagerProbe[] = [
  { path: ".ruler/ruler.toml", kind: "config", manager: "ruler" },
  { path: ".ruler/mcp.json", kind: "config", manager: "ruler" },
  { path: "rulesync.jsonc", kind: "config", manager: "rulesync" },
  { path: "rulesync.local.jsonc", kind: "config", manager: "rulesync", scope: "local" },
  { path: ".rulesync/mcp.jsonc", kind: "config", manager: "rulesync" },
  { path: ".rulesync/mcp.json", kind: "config", manager: "rulesync" },
  { path: ".rulesync/hooks.jsonc", kind: "config", manager: "rulesync" },
  { path: ".rulesync/hooks.json", kind: "config", manager: "rulesync" },
  { path: ".rulesync/permissions.jsonc", kind: "config", manager: "rulesync" },
  { path: ".rulesync/permissions.json", kind: "config", manager: "rulesync" },
  { path: ".rulesync/.aiignore", kind: "source", manager: "rulesync" },
  { path: ".rulesyncignore", kind: "source", manager: "rulesync" },
  { path: ".agent-sync.toml", kind: "config", manager: "agent-sync" },
  { path: ".agentlink.yaml", kind: "config", manager: "agentlink" },
  { path: ".agents/agents.json", kind: "source", manager: "agents-json" },
  { path: ".agents/local.json", kind: "config", manager: "agents-json", scope: "local" },
  { path: ".agents/agentsync.toml", kind: "config", manager: "agentsync" },
  { path: ".agentsync/agentsync.toml", kind: "config", manager: "agentsync" },
  { path: ".agentsync-state.json", kind: "state", manager: "agentsync" },
  { path: "agentsync.json", kind: "config", manager: "agentsync" },
  { path: "agentsync.config.json", kind: "config", manager: "agentsync" },
  { path: ".ai/agent_sync.yaml", kind: "config", manager: "agent_sync" },
  { path: ".ai/.sync-manifest", kind: "state", manager: "agent_sync" },
  { path: "skills-lock.json", kind: "lockfile", manager: "skills-lock" },
  { path: ".mcp.lock", kind: "lockfile", manager: "mcp-lock" },
];

/** Manager source trees: every markdown file under them, recursively. */
const MANAGER_SOURCE_TREES: ReadonlyArray<[dir: string, manager: string]> = [
  [".ruler", "ruler"],
  [".rulesync", "rulesync"],
];

/**
 * Root-level agent config files probed by the symlink-topology scan - the
 * union of the per-agent detectors' root surfaces plus the symlink
 * managers' known link names. `CLAUDE.local.md` is the one local-tier name.
 */
const SYMLINK_PROBE_FILES: readonly string[] = [
  ".clineignore",
  ".clinerules",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".mcp.json",
  ".rooignore",
  ".roomodes",
  ".roorules",
  ".windsurfrules",
  "AGENT.md",
  "AGENTS.md",
  "AGENT_GUIDE.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  "GEMINI.md",
  "opencode.json",
  "opencode.jsonc",
];

/** Agent config directories whose entries the symlink scan inspects. */
const SYMLINK_PROBE_DIRS: readonly string[] = [
  ".agent",
  ".agents",
  ".claude",
  ".claude-plugin",
  ".clinerules",
  ".codex",
  ".cursor",
  ".devin",
  ".gemini",
  ".github/agents",
  ".github/instructions",
  ".opencode",
  ".roo",
  ".vscode",
  ".windsurf",
];

/** The symlink scan never descends into these. */
const SCAN_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

export function detect(repo: RepoContext): ThirdPartyManagerArtifact[] {
  const root = repo.rootDir;
  const out: ThirdPartyManagerArtifact[] = [];

  for (const probe of MANAGER_FILES) {
    const info = inspectFile(join(root, probe.path));
    if (info) {
      out.push({
        ...makeArtifact(probe.path, probe.kind, probe.scope ?? "project", info),
        manager: probe.manager,
      });
    }
  }

  for (const [dir, manager] of MANAGER_SOURCE_TREES) {
    const sources: Array<DetectedArtifact & { kind: "source" }> = [];
    collectMarkdownTree(root, dir, "source", sources);
    for (const artifact of sources) {
      out.push({ ...artifact, manager });
    }
  }

  collectSymlinkTopology(root, out);

  return out.sort(compareArtifacts);
}

/**
 * Maps the symlink topology of the known agent config surface: root config
 * files that are symlinks, plus symlinked entries anywhere inside the known
 * config directories. Only symlinks are reported - regular files are the
 * other detectors' inventory, and a path already inventoried above (a
 * symlinked manager file) is not reported a second time. A symlinked
 * directory is reported as the link itself; its contents belong to the
 * target and are not walked.
 */
function collectSymlinkTopology(root: string, out: ThirdPartyManagerArtifact[]): void {
  const seen = new Set(out.map((artifact) => artifact.path));
  const push = (rel: string, abs: string): void => {
    if (seen.has(rel)) {
      return;
    }
    seen.add(rel);
    const scope = rel === "CLAUDE.local.md" ? "local" : "project";
    out.push({
      ...makeArtifact(rel, "symlink", scope, symlinkInfo(abs, () => true)),
      manager: "symlinks",
    });
  };

  for (const rel of SYMLINK_PROBE_FILES) {
    const abs = join(root, rel);
    if (safeLstat(abs)?.isSymbolicLink()) {
      push(rel, abs);
    }
  }

  for (const rel of SYMLINK_PROBE_DIRS) {
    const abs = join(root, rel);
    if (safeLstat(abs)?.isSymbolicLink()) {
      push(rel, abs);
      continue;
    }
    scanForSymlinks(abs, rel, new Set(), push);
  }
}

/**
 * Recursively reports symlinked entries under a real config directory.
 * Symlinked directories are reported, never descended, so link cycles are
 * impossible; the visited-realpath set additionally terminates aliased
 * trees (bind mounts) the way `detect-fs.walk` does.
 */
function scanForSymlinks(
  absDir: string,
  relDir: string,
  visited: Set<string>,
  push: (rel: string, abs: string) => void,
): void {
  let real: string;
  try {
    real = realpathSync(absDir);
  } catch {
    return;
  }
  if (visited.has(real)) {
    return;
  }
  visited.add(real);
  for (const entry of sortedEntries(absDir)) {
    const abs = join(absDir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      push(rel, abs);
    } else if (entry.isDirectory() && !SCAN_EXCLUDES.has(entry.name)) {
      scanForSymlinks(abs, rel, visited, push);
    }
  }
}
