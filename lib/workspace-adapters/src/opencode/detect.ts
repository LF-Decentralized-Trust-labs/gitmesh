import { join } from "node:path";
import {
  addFile,
  collectDirFiles,
  collectMarkdownTree,
  compareArtifacts,
  makeArtifact,
  skillDirHasExecutable,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `opencode` detector (pivot T1.6) - inventories the OpenCode config surface.
 * §4.3 lists "AGENTS.md; `opencode.json`; permission JSON; commands"; the
 * surface verified against opencode.ai/docs and the anomalyco/opencode source
 * on 2026-08-24 is wider (§3 fast-churn caveat):
 *
 * - `AGENTS.md` at any depth (nested files are attached lazily as the agent
 *   reads nearby code)
 * - `opencode.json` / `opencode.jsonc` at any depth (config is discovered
 *   upward from the working directory, so ancestors inside the repo count),
 *   plus `.opencode/opencode.json{,c}`; MCP servers and per-pattern
 *   read/edit/bash permissions live inside this file, not in separate ones
 * - `.opencode/{command,commands}/` and `{agent,agents}/` markdown trees
 *   (the source accepts both singular and plural directory names)
 * - `.opencode/{mode,modes}/*.md` - the legacy modes surface, still read and
 *   folded into agents
 * - `SKILL.md` manifests at any depth under `.opencode/{skill,skills}/`
 *   (the `.claude/skills` and `.agents/skills` compat reads are the
 *   claude-code and codex adapters' surfaces)
 * - `.opencode/{plugin,plugins}/*.{js,ts}` (single-level by design) and
 *   `.opencode/themes/*.json`
 *
 * The `CLAUDE.md` / deprecated `CONTEXT.md` instruction fallbacks are not
 * reported here: the first is the claude-code adapter's surface, and both
 * are read only when no `AGENTS.md` wins.
 *
 * Same guarantees as every other detector: pure, read-only, deterministic
 * sorted output, symlink-aware (literal targets, never resolved away -
 * §10.4), cycle-safe, and fs errors contained - never fatal.
 */

/** Artifact kinds this detector reports. */
export type OpenCodeArtifactKind =
  | "instructions" // AGENTS.md hierarchy
  | "config" // opencode.json{,c} (holds MCP + permissions)
  | "command" // .opencode/{command,commands}/
  | "agent" // .opencode/{agent,agents}/
  | "mode" // .opencode/{mode,modes}/ (legacy)
  | "skill" // .opencode/{skill,skills}/**/SKILL.md
  | "plugin" // .opencode/{plugin,plugins}/*.{js,ts}
  | "theme"; // .opencode/themes/*.json

export interface OpenCodeArtifact extends DetectedArtifact {
  kind: OpenCodeArtifactKind;
}

/** The repo-wide walk skips these; `.opencode` holds config, not instructions. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules", ".opencode"]);

const CONFIG_NAMES: ReadonlySet<string> = new Set(["opencode.json", "opencode.jsonc"]);

const OPENCODE_DIR = ".opencode";

export function detect(repo: RepoContext): OpenCodeArtifact[] {
  const root = repo.rootDir;
  const out: OpenCodeArtifact[] = [];

  // One repo-wide walk covers both any-depth families.
  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md" || CONFIG_NAMES.has(name),
    (name, rel, info) => {
      const kind = name === "AGENTS.md" ? "instructions" : "config";
      out.push(makeArtifact(rel, kind, "project", info));
    },
  );

  for (const name of CONFIG_NAMES) {
    addFile(root, `${OPENCODE_DIR}/${name}`, "config", "project", out);
  }
  for (const dir of ["command", "commands"]) {
    collectMarkdownTree(root, `${OPENCODE_DIR}/${dir}`, "command", out);
  }
  for (const dir of ["agent", "agents"]) {
    collectMarkdownTree(root, `${OPENCODE_DIR}/${dir}`, "agent", out);
  }
  for (const dir of ["mode", "modes"]) {
    collectDirFiles(root, `${OPENCODE_DIR}/${dir}`, (n) => n.endsWith(".md"), "mode", out);
  }
  for (const dir of ["skill", "skills"]) {
    const base = `${OPENCODE_DIR}/${dir}`;
    walk(
      join(root, base),
      base,
      new Set(),
      () => true,
      (name) => name === "SKILL.md",
      (_name, rel, info) => {
        const artifact = makeArtifact(rel, "skill", "project", info);
        if (skillDirHasExecutable(join(root, rel, ".."))) {
          artifact.executable = true;
        }
        out.push(artifact);
      },
    );
  }
  for (const dir of ["plugin", "plugins"]) {
    collectDirFiles(
      root,
      `${OPENCODE_DIR}/${dir}`,
      (n) => n.endsWith(".js") || n.endsWith(".ts"),
      "plugin",
      out,
    );
  }
  collectDirFiles(root, `${OPENCODE_DIR}/themes`, (n) => n.endsWith(".json"), "theme", out);

  return out.sort(compareArtifacts);
}
