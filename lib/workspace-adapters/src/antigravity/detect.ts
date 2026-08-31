import { homedir } from "node:os";
import { join } from "node:path";
import {
  addFile,
  collectSkillManifests,
  compareArtifacts,
  makeArtifact,
  safeStat,
  skillDirHasExecutable,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `antigravity` detector (pivot T1.5) - inventories the Antigravity 2.0
 * (Gemini) config surface per the §4.3 row:
 *
 * - `GEMINI.md` at any depth (nested instructions)
 * - `.gemini/settings.json`
 * - plugin bundles under `.gemini/`: `plugin.json`, `hooks.json`,
 *   `mcp_config.json`, and their bundled `skills/`, `agents/`, `rules/`
 * - `.agent/skills/<name>/SKILL.md`
 * - a presence-only probe for the antigravity-cli settings file, the
 *   enforcement surface (allowed/denied commands, `enableTerminalSandbox`)
 *
 * Same guarantees as the claude-code, codex, cursor and copilot detectors:
 * pure, read-only, deterministic sorted output, symlink-aware (literal
 * targets, never resolved away - §10.4), cycle-safe, and fs errors contained
 * - never fatal.
 */

/** Artifact kinds this detector reports. */
export type AntigravityArtifactKind =
  | "instructions" // GEMINI.md hierarchy
  | "settings" // .gemini/settings.json + the antigravity-cli presence probe
  | "mcp-config" // plugin mcp_config.json
  | "plugin-manifest" // plugin.json
  | "hooks" // hooks.json
  | "skill" // .agent/skills/<name>/SKILL.md + plugin-bundled skills
  | "agent" // plugin-bundled agents/**/*.md
  | "rule"; // plugin-bundled rules/**/*.md

export interface AntigravityArtifact extends DetectedArtifact {
  kind: AntigravityArtifactKind;
}

/**
 * Default probe location of the antigravity-cli settings file as of
 * mid-2026 (§3 fast-churn caveat; format-canary TX.1 guards it):
 * `~/.gemini/antigravity-cli/settings.json`. Overridable via
 * `RepoContext.antigravitySettingsPaths`.
 */
export function defaultAntigravitySettingsPaths(home: string = homedir()): string[] {
  return [join(home, ".gemini", "antigravity-cli", "settings.json")];
}

/**
 * Display path of the settings probe. A constant, not the probed path's
 * basename: the probe reports presence only, the real location is
 * machine-specific, and a bare `settings.json` would read as the project
 * `.gemini/settings.json` in doctor output.
 */
const CLI_SETTINGS_PROBE_PATH = "antigravity-cli/settings.json";

/** The GEMINI.md walk skips these; `.gemini`/`.agent` hold config, not instructions. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".gemini",
  ".agent",
]);

const GEMINI_DIR = ".gemini";

/** Plugin-bundle files identified by basename, wherever they sit in a bundle. */
const PLUGIN_FILE_KINDS: ReadonlyMap<string, AntigravityArtifactKind> = new Map([
  ["plugin.json", "plugin-manifest" as const],
  ["hooks.json", "hooks" as const],
  ["mcp_config.json", "mcp-config" as const],
]);

export function detect(repo: RepoContext): AntigravityArtifact[] {
  const root = repo.rootDir;
  const out: AntigravityArtifact[] = [];

  // 1. GEMINI.md at any depth - the only family that can live anywhere, so
  //    the only one needing a repo-wide walk.
  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "GEMINI.md",
    (_name, rel, info) => {
      out.push(makeArtifact(rel, "instructions", "project", info));
    },
  );

  // 2. Project settings - the repo-tier half of the enforcement surface.
  addFile(root, `${GEMINI_DIR}/settings.json`, "settings", "project", out);

  // 3. Plugin bundles. §4.3 names the bundle *files* (`plugin.json`,
  //    `hooks.json`, bundled skills/agents/rules) but fixes no bundle root,
  //    and the MCP config path is reported inconsistently across sources
  //    (research_results.md §4, flagged [I]). So the scan is confined to
  //    `.gemini/` and classifies by file shape rather than guessing a
  //    directory name that would silently miss every other layout.
  walk(
    join(root, GEMINI_DIR),
    GEMINI_DIR,
    new Set(),
    () => true,
    (name) => PLUGIN_FILE_KINDS.has(name) || name.endsWith(".md"),
    (_name, rel, info) => {
      const kind = pluginArtifactKind(rel);
      if (kind !== undefined) {
        const artifact = makeArtifact(rel, kind, "project", info);
        if (kind === "skill" && skillDirHasExecutable(join(root, rel, ".."))) {
          artifact.executable = true;
        }
        out.push(artifact);
      }
    },
  );

  // 4. Repo skills: one `.agent/skills/<name>/SKILL.md` manifest per skill.
  collectSkillManifests(root, ".agent/skills", "skill", out);

  // 5. antigravity-cli settings: presence only - never location or content.
  const probes = repo.antigravitySettingsPaths ?? defaultAntigravitySettingsPaths();
  if (probes.some((probe) => safeStat(probe) !== undefined)) {
    out.push(makeArtifact(CLI_SETTINGS_PROBE_PATH, "settings", "managed"));
  }

  return out.sort(compareArtifacts);
}

/**
 * Classifies one file found under `.gemini/` by its bundle shape, or
 * `undefined` for anything unrecognized (a bundle README, `.gemini/settings.json`
 * - inventoried by step 2 - and so on).
 */
function pluginArtifactKind(rel: string): AntigravityArtifactKind | undefined {
  const known = PLUGIN_FILE_KINDS.get(rel.slice(rel.lastIndexOf("/") + 1));
  if (known !== undefined) {
    return known;
  }
  // Bundled resource directories: one artifact per skill manifest, every
  // markdown file under `agents/` and `rules/`.
  if (/\/skills\/[^/]+\/SKILL\.md$/.test(rel)) {
    return "skill";
  }
  if (/\/agents\/.+\.md$/.test(rel)) {
    return "agent";
  }
  if (/\/rules\/.+\.md$/.test(rel)) {
    return "rule";
  }
  return undefined;
}
