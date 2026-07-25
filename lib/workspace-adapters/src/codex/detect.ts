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
 * `codex` detector (pivot T1.2) — inventories the Codex CLI config surface
 * per the §4.3 row: AGENTS.md at any depth, `.codex/config.toml`,
 * `.agents/skills/`, `.codex/agents/*.toml` subagents, execpolicy `.rules`
 * files, a presence-only `CODEX_HOME` hint, and a presence-only probe for
 * the org-managed `requirements.toml` admin ceiling.
 *
 * Same guarantees as the claude-code detector: pure, read-only,
 * deterministic sorted output, symlink-aware (literal targets, never
 * resolved away), cycle-safe, and fs errors contained — never fatal.
 */

export type CodexArtifactKind =
  | "instructions"
  | "config"
  | "skill"
  | "subagent"
  | "execpolicy"
  | "env-hint"
  | "requirements";

export interface CodexArtifact extends DetectedArtifact {
  kind: CodexArtifactKind;
}

/**
 * Default `requirements.toml` probe locations as of mid-2026 (§3 fast-churn
 * caveat; format-canary TX.1 guards them): `$CODEX_HOME/requirements.toml`
 * (`~/.codex` when unset), plus `/etc/codex/requirements.toml` on Linux.
 */
export function defaultRequirementsTomlPaths(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string[] {
  const path = platform === "win32" ? win32 : posix;
  const codexHome = env["CODEX_HOME"] || path.join(home, ".codex");
  const paths = [path.join(codexHome, "requirements.toml")];
  if (platform === "linux") {
    paths.push("/etc/codex/requirements.toml");
  }
  return paths;
}

/** The AGENTS.md walk skips these; `.codex`/`.agents` hold config, not instructions. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".codex",
  ".agents",
]);

export function detect(repo: RepoContext): CodexArtifact[] {
  const root = repo.rootDir;
  const env = repo.env ?? process.env;
  const out: CodexArtifact[] = [];

  walk(root, "", new Set(), (dir) => !WALK_EXCLUDES.has(dir), (name, rel, info) => {
    if (name === "AGENTS.md") {
      out.push(makeArtifact(rel, "instructions", "project", info));
    }
  });

  const configInfo = inspectFile(join(root, ".codex", "config.toml"));
  if (configInfo) {
    out.push(makeArtifact(".codex/config.toml", "config", "project", configInfo));
  }

  // Subagents: top-level `.codex/agents/*.toml` only.
  const agentsBase = join(root, ".codex", "agents");
  for (const entry of sortedEntries(agentsBase)) {
    const abs = join(agentsBase, entry.name);
    if (!entry.name.endsWith(".toml") || isTraversableDir(entry, abs)) {
      continue;
    }
    const info = fileInfoFromEntry(entry, abs);
    if (info) {
      out.push(makeArtifact(`.codex/agents/${entry.name}`, "subagent", "project", info));
    }
  }

  // Execpolicy `.rules`: §4.3 fixes no location, so scan `.codex/` only —
  // a repo-wide sweep would false-positive on unrelated `.rules` files.
  walk(join(root, ".codex"), ".codex", new Set(), () => true, (name, rel, info) => {
    if (name.endsWith(".rules")) {
      out.push(makeArtifact(rel, "execpolicy", "project", info));
    }
  });

  // Skills: one `.agents/skills/<name>/SKILL.md` manifest per skill.
  const skillsBase = join(root, ".agents", "skills");
  for (const entry of sortedEntries(skillsBase)) {
    if (!isTraversableDir(entry, join(skillsBase, entry.name))) {
      continue;
    }
    const info = inspectFile(join(skillsBase, entry.name, "SKILL.md"));
    if (info) {
      out.push(makeArtifact(`.agents/skills/${entry.name}/SKILL.md`, "skill", "project", info));
    }
  }

  // CODEX_HOME hint: presence only — the value is a machine-specific path.
  const codexHomeEnv = env["CODEX_HOME"];
  if (codexHomeEnv) {
    out.push(makeArtifact("CODEX_HOME", "env-hint", "user"));
  }

  // User scope only when requested (`doctor --user`; §10.1 trust boundary);
  // display paths stay machine-independent.
  if (repo.userScope) {
    const codexHome = codexHomeEnv || join(repo.homeDir ?? homedir(), ".codex");
    const info = inspectFile(join(codexHome, "config.toml"));
    if (info) {
      const base = codexHomeEnv ? "$CODEX_HOME" : "~/.codex";
      out.push(makeArtifact(`${base}/config.toml`, "config", "user", info));
    }
  }

  // Managed requirements.toml: presence only — never location or content.
  const seen = new Set<string>();
  for (const probe of repo.requirementsTomlPaths ??
    defaultRequirementsTomlPaths(process.platform, env)) {
    const name = win32.basename(probe);
    if (!seen.has(name) && safeStat(probe) !== undefined) {
      seen.add(name);
      out.push(makeArtifact(name, "requirements", "managed"));
    }
  }

  return out.sort(compareArtifacts);
}

interface FileInfo {
  symlinkTarget?: string;
  broken?: boolean;
}

function makeArtifact(
  path: string,
  kind: CodexArtifactKind,
  scope: CodexArtifact["scope"],
  info: FileInfo = {},
): CodexArtifact {
  const artifact: CodexArtifact = { path, kind, scope };
  if (info.symlinkTarget !== undefined) {
    artifact.symlinkTarget = info.symlinkTarget;
  }
  if (info.broken) {
    artifact.broken = true;
  }
  return artifact;
}

function safeStat(absPath: string): Stats | undefined {
  try {
    return statSync(absPath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

function inspectFile(absPath: string): FileInfo | null {
  let stats: Stats | undefined;
  try {
    stats = lstatSync(absPath, { throwIfNoEntry: false });
  } catch {
    return null;
  }
  if (stats === undefined) {
    return null;
  }
  if (stats.isSymbolicLink()) {
    return symlinkInfo(absPath);
  }
  return stats.isFile() ? {} : null;
}

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
    return { broken: true };
  }
  return safeStat(absPath)?.isFile() ? { symlinkTarget } : { symlinkTarget, broken: true };
}

function isTraversableDir(entry: Dirent, absPath: string): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  return entry.isSymbolicLink() && (safeStat(absPath)?.isDirectory() ?? false);
}

/** Sorted listing; an unreadable or missing directory contributes nothing. */
function sortedEntries(absDir: string): Dirent[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Cycle-safe recursive walk (visited real paths); `recurse` gates descent. */
function walk(
  absDir: string,
  relDir: string,
  visited: Set<string>,
  recurse: (dirName: string) => boolean,
  onFile: (name: string, rel: string, info: FileInfo) => void,
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
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (isTraversableDir(entry, abs)) {
      if (recurse(entry.name)) {
        walk(abs, rel, visited, recurse, onFile);
      }
    } else {
      const info = fileInfoFromEntry(entry, abs);
      if (info) {
        onFile(entry.name, rel, info);
      }
    }
  }
}

function compareArtifacts(a: DetectedArtifact, b: DetectedArtifact): number {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  return a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0;
}
