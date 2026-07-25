import {
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `claude-code` detector (pivot T1.1) — inventories every Claude Code config
 * artifact in a repository per the §4.3 config-surface row.
 *
 * Pure, read-only file inspection: no writes, no network, deterministic
 * output (sorted, no wallclock, no absolute paths in results). Symlink-aware:
 * symlinked artifacts are inventoried with their literal target — a symlinked
 * CLAUDE.md is a healthy pattern (§10.4), never resolved away — symlinked
 * directories are traversed, and traversal is cycle-safe. Filesystem errors on
 * individual entries — an unreadable directory, a symlink cycle — are
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
  collectInstructions(root, "", artifacts, new Set());

  // 2. `.claude/` surface. Settings are resolved from the git root only
  //    (Claude Code v2.1.211+ semantics; callers pass that root as rootDir),
  //    so nested `.claude/` directories are deliberately not scanned.
  addFile(artifacts, root, ".claude/settings.json", "settings", "project");
  addFile(artifacts, root, ".claude/settings.local.json", "settings", "local");
  collectMarkdownTree(root, ".claude/rules", "rule", artifacts);
  collectMarkdownTree(root, ".claude/commands", "command", artifacts);
  collectMarkdownTree(root, ".claude/agents", "subagent", artifacts);
  collectSkills(root, artifacts);

  // 3. Repo-root singletons: MCP config and plugin/marketplace manifests.
  addFile(artifacts, root, ".mcp.json", "mcp-config", "project");
  addFile(artifacts, root, ".claude-plugin/plugin.json", "plugin-manifest", "project");
  addFile(artifacts, root, ".claude-plugin/marketplace.json", "marketplace", "project");

  // 4. User scope, only when requested (`doctor --user`; §10.1 trust boundary).
  if (repo.userScope) {
    const home = repo.homeDir ?? homedir();
    const info = inspectFile(join(home, ".claude", "CLAUDE.md"));
    if (info) {
      artifacts.push(makeArtifact(USER_MEMORY_PATH, "instructions", "user", info));
    }
  }

  // 5. Managed-settings presence probe: report presence only — never the
  //    location (machine-specific) and never the content.
  for (const probe of repo.managedSettingsPaths ?? defaultManagedSettingsPaths()) {
    if (safeStat(probe) !== undefined) {
      artifacts.push(makeArtifact(lastSegment(probe), "settings", "managed"));
    }
  }

  return dedupe(artifacts).sort(compareArtifacts);
}

/** Symlink details of an inventoried file; empty for a regular file. */
interface FileInfo {
  symlinkTarget?: string;
  broken?: boolean;
}

function makeArtifact(
  path: string,
  kind: ClaudeCodeArtifactKind,
  scope: ClaudeCodeArtifact["scope"],
  info: FileInfo = {},
): ClaudeCodeArtifact {
  const artifact: ClaudeCodeArtifact = { path, kind, scope };
  if (info.symlinkTarget !== undefined) {
    artifact.symlinkTarget = info.symlinkTarget;
  }
  if (info.broken) {
    artifact.broken = true;
  }
  return artifact;
}

/** Inventories `relPath` under `root` when it holds a file (or file symlink). */
function addFile(
  out: ClaudeCodeArtifact[],
  root: string,
  relPath: string,
  kind: ClaudeCodeArtifactKind,
  scope: ClaudeCodeArtifact["scope"],
): void {
  const info = inspectFile(join(root, relPath));
  if (info) {
    out.push(makeArtifact(relPath, kind, scope, info));
  }
}

/**
 * `stat` (follows symlinks) that never throws: `undefined` for any unreachable
 * path — missing (`ENOENT`), a symlink cycle (`ELOOP`), or one we lack
 * permission to resolve (`EACCES`). `throwIfNoEntry` suppresses only `ENOENT`,
 * so the `try` covers the rest; a doctor scan must not abort on one bad entry.
 */
function safeStat(absPath: string): Stats | undefined {
  try {
    return statSync(absPath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/** `lstat` (does not follow symlinks) that never throws; see {@link safeStat}. */
function safeLstat(absPath: string): Stats | undefined {
  try {
    return lstatSync(absPath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/**
 * Inspects one path expected to hold a regular file. Returns `null` when it
 * does not exist or is a directory; symlinks are reported with their literal
 * target, flagged broken when they do not resolve to a file.
 */
function inspectFile(absPath: string): FileInfo | null {
  const stats = safeLstat(absPath);
  if (stats === undefined) {
    return null;
  }
  if (stats.isSymbolicLink()) {
    return symlinkInfo(absPath);
  }
  return stats.isFile() ? {} : null;
}

/** Like {@link inspectFile}, reusing the `Dirent` from a directory listing. */
function fileInfoFromEntry(entry: Dirent, absPath: string): FileInfo | null {
  if (entry.isSymbolicLink()) {
    return symlinkInfo(absPath);
  }
  return entry.isFile() ? {} : null;
}

function symlinkInfo(absPath: string): FileInfo {
  let symlinkTarget: string;
  try {
    symlinkTarget = readlinkSync(absPath).replaceAll("\\", "/");
  } catch {
    // A symlink we cannot even read (e.g. permission denied): flag it broken
    // rather than aborting the scan.
    return { broken: true };
  }
  const resolved = safeStat(absPath);
  return resolved?.isFile() ? { symlinkTarget } : { symlinkTarget, broken: true };
}

/** True for directories, including symlinks that resolve to directories. */
function isTraversableDir(entry: Dirent, absPath: string): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  return safeStat(absPath)?.isDirectory() ?? false;
}

/**
 * Marks a directory as visited by real path; returns false when it was seen
 * before (symlink cycle or an aliased tree) so walks terminate and each real
 * directory is inventoried exactly once.
 */
function markVisited(absDir: string, visited: Set<string>): boolean {
  let real: string;
  try {
    real = realpathSync(absDir);
  } catch {
    return false;
  }
  if (visited.has(real)) {
    return false;
  }
  visited.add(real);
  return true;
}

function sortedEntries(absDir: string): Dirent[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, a race, a special file): contribute
    // nothing rather than aborting the whole inventory.
    return [];
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Walks the repo for CLAUDE.md (project) and CLAUDE.local.md (local) files. */
function collectInstructions(
  absDir: string,
  relDir: string,
  out: ClaudeCodeArtifact[],
  visited: Set<string>,
): void {
  if (!markVisited(absDir, visited)) {
    return;
  }
  for (const entry of sortedEntries(absDir)) {
    const abs = join(absDir, entry.name);
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (isTraversableDir(entry, abs)) {
      if (!INSTRUCTION_WALK_EXCLUDES.has(entry.name)) {
        collectInstructions(abs, rel, out, visited);
      }
    } else if (entry.name === "CLAUDE.md" || entry.name === "CLAUDE.local.md") {
      const info = fileInfoFromEntry(entry, abs);
      if (info) {
        const scope = entry.name === "CLAUDE.md" ? "project" : "local";
        out.push(makeArtifact(rel, "instructions", scope, info));
      }
    }
  }
}

/** Recursively inventories every `*.md` file under `root`/`relBase`. */
function collectMarkdownTree(
  root: string,
  relBase: string,
  kind: ClaudeCodeArtifactKind,
  out: ClaudeCodeArtifact[],
): void {
  if (!isDirectory(join(root, relBase))) {
    return;
  }
  walkMarkdown(join(root, relBase), relBase, kind, out, new Set());
}

function walkMarkdown(
  absDir: string,
  relDir: string,
  kind: ClaudeCodeArtifactKind,
  out: ClaudeCodeArtifact[],
  visited: Set<string>,
): void {
  if (!markVisited(absDir, visited)) {
    return;
  }
  for (const entry of sortedEntries(absDir)) {
    const abs = join(absDir, entry.name);
    const rel = `${relDir}/${entry.name}`;
    if (isTraversableDir(entry, abs)) {
      walkMarkdown(abs, rel, kind, out, visited);
    } else if (entry.name.endsWith(".md")) {
      const info = fileInfoFromEntry(entry, abs);
      if (info) {
        out.push(makeArtifact(rel, kind, "project", info));
      }
    }
  }
}

/**
 * Inventories `.claude/skills/<name>/SKILL.md` — one artifact per skill; a
 * skill's other resource files belong to the skill, not the inventory.
 */
function collectSkills(root: string, out: ClaudeCodeArtifact[]): void {
  const base = join(root, ".claude", "skills");
  if (!isDirectory(base)) {
    return;
  }
  for (const entry of sortedEntries(base)) {
    if (!isTraversableDir(entry, join(base, entry.name))) {
      continue;
    }
    const rel = `.claude/skills/${entry.name}/SKILL.md`;
    const info = inspectFile(join(base, entry.name, "SKILL.md"));
    if (info) {
      out.push(makeArtifact(rel, "skill", "project", info));
    }
  }
}

function isDirectory(absPath: string): boolean {
  return safeStat(absPath)?.isDirectory() ?? false;
}

/** Final path segment, tolerant of either separator (managed probe display). */
function lastSegment(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
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

/** Deterministic code-unit ordering by path, then kind, then scope. */
function compareArtifacts(a: DetectedArtifact, b: DetectedArtifact): number {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  return a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0;
}
