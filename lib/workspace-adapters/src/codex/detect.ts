import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import {
  compareArtifacts,
  fileInfoFromEntry,
  inspectFile,
  isTraversableDir,
  lastSegment,
  makeArtifact,
  safeStat,
  sortedEntries,
  walk,
} from "../detect-fs.js";
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

  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md",
    (name, rel, info) => {
      out.push(makeArtifact(rel, "instructions", "project", info));
    },
  );

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
  walk(
    join(root, ".codex"),
    ".codex",
    new Set(),
    () => true,
    (name) => name.endsWith(".rules"),
    (name, rel, info) => {
      out.push(makeArtifact(rel, "execpolicy", "project", info));
    },
  );

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
    const name = lastSegment(probe);
    if (!seen.has(name) && safeStat(probe) !== undefined) {
      seen.add(name);
      out.push(makeArtifact(name, "requirements", "managed"));
    }
  }

  return out.sort(compareArtifacts);
}
