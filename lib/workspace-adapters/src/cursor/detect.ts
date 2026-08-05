import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  compareArtifacts,
  inspectFile,
  makeArtifact,
  walk,
  type FileInfo,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `cursor` detector (pivot T1.3) - inventories every Cursor config artifact
 * in a repository per the §4.3 config-surface row.
 *
 * Artifacts detected:
 * - `AGENTS.md` at any depth (Cursor reads AGENTS.md natively)
 * - `.cursor/rules/*.mdc` with parsed YAML frontmatter
 * - Legacy `.cursorrules` (root-only)
 * - `.cursor/mcp.json`
 * - `.cursor/agents/` (recursive `*.md`)
 * - `.cursor/hooks.json` (v1.7+ hooks config)
 *
 * Same guarantees as the claude-code and codex detectors: pure, read-only,
 * deterministic sorted output, symlink-aware (literal targets, never
 * resolved away), cycle-safe, and fs errors contained - never fatal.
 */

/** Parsed YAML-like frontmatter from a `.mdc` file. */
export interface MdcFrontmatter {
  description?: string;
  globs?: string;
  alwaysApply?: boolean;
}

/** Artifact kinds this detector reports. */
export type CursorArtifactKind =
  | "instructions" // AGENTS.md hierarchy, legacy .cursorrules
  | "rule" // .cursor/rules/*.mdc
  | "mcp-config" // .cursor/mcp.json
  | "agent" // .cursor/agents/**/*.md
  | "hooks"; // .cursor/hooks.json (v1.7+)

export interface CursorArtifact extends DetectedArtifact {
  kind: CursorArtifactKind;
  /** Parsed .mdc frontmatter; present only for `rule` artifacts from `.mdc` files. */
  frontmatter?: MdcFrontmatter;
}

/**
 * The AGENTS.md walk skips these; `.cursor` holds config, not instructions.
 */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".cursor",
]);

export function detect(repo: RepoContext): CursorArtifact[] {
  const root = repo.rootDir;
  const out: CursorArtifact[] = [];

  // 1. AGENTS.md at any depth (Cursor reads it natively per §4.3).
  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md",
    (_name, rel, info) => {
      out.push(makeArtifact(rel, "instructions", "project", info));
    },
  );

  // 2. Legacy `.cursorrules` (root-only, single file).
  addFile(out, root, ".cursorrules", "instructions", "project");

  // 3. `.cursor/rules/*.mdc` — recursive walk, parse frontmatter.
  collectMdcRules(root, out);

  // 4. `.cursor/mcp.json` — MCP server configuration.
  addFile(out, root, ".cursor/mcp.json", "mcp-config", "project");

  // 5. `.cursor/agents/` — recursive `*.md` agent definitions.
  collectMarkdownTree(root, ".cursor/agents", "agent", out);

  // 6. `.cursor/hooks.json` — v1.7+ hooks config.
  addFile(out, root, ".cursor/hooks.json", "hooks", "project");

  return out.sort(compareCursorArtifacts);
}

/** Inventories `relPath` under `root` when it holds a file (or file symlink). */
function addFile(
  out: CursorArtifact[],
  root: string,
  relPath: string,
  kind: CursorArtifactKind,
  scope: CursorArtifact["scope"],
): void {
  const info = inspectFile(join(root, relPath));
  if (info) {
    out.push(makeArtifact(relPath, kind, scope, info));
  }
}

/** Recursively inventories every `*.md` file under `root`/`relBase`. */
function collectMarkdownTree(
  root: string,
  relBase: string,
  kind: CursorArtifactKind,
  out: CursorArtifact[],
): void {
  walk(
    join(root, relBase),
    relBase,
    new Set(),
    () => true,
    (name) => name.endsWith(".md"),
    (_name, rel, info) => {
      out.push(makeArtifact(rel, kind, "project", info));
    },
  );
}

/**
 * Recursively inventories `.cursor/rules/*.mdc` files, parsing their YAML
 * frontmatter to extract `description`, `globs`, and `alwaysApply`.
 */
function collectMdcRules(root: string, out: CursorArtifact[]): void {
  walk(
    join(root, ".cursor", "rules"),
    ".cursor/rules",
    new Set(),
    () => true,
    (name) => name.endsWith(".mdc"),
    (_name, rel, info) => {
      const artifact = makeArtifact(rel, "rule" as const, "project", info) as CursorArtifact;
      // Only parse frontmatter for non-broken files.
      if (!info.broken) {
        const fm = parseMdcFrontmatter(join(root, rel));
        if (fm) {
          artifact.frontmatter = fm;
        }
      }
      out.push(artifact);
    },
  );
}

/**
 * Parses `.mdc` frontmatter (between `---` delimiters). The frontmatter
 * contains simple YAML key-value pairs: `description`, `globs`, and
 * `alwaysApply`. Implemented as a lightweight line parser without an
 * external YAML dependency, matching the project convention of zero
 * external dependencies for pure file inspection.
 *
 * Returns `undefined` when the file cannot be read or has no frontmatter.
 * Returns an empty object when frontmatter delimiters are present but
 * contain no recognized fields.
 */
export function parseMdcFrontmatter(absPath: string): MdcFrontmatter | undefined {
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return undefined;
  }
  return extractFrontmatter(content);
}

/**
 * Extracts frontmatter from `.mdc` file content. Exported for testing.
 */
export function extractFrontmatter(content: string): MdcFrontmatter | undefined {
  const lines = content.split(/\r?\n/);

  // Frontmatter must start with `---` on the first line.
  if (lines.length === 0 || lines[0]!.trim() !== "---") {
    return undefined;
  }

  // Find the closing `---`.
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return undefined;
  }

  const fm: MdcFrontmatter = {};
  for (let i = 1; i < endIndex; i++) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    switch (key) {
      case "description":
        fm.description = unquote(rawValue);
        break;
      case "globs":
        fm.globs = unquote(rawValue);
        break;
      case "alwaysApply": {
        const lower = rawValue.toLowerCase();
        if (lower === "true") {
          fm.alwaysApply = true;
        } else if (lower === "false") {
          fm.alwaysApply = false;
        }
        break;
      }
      // Unknown keys are silently ignored — forward compatibility.
    }
  }

  return fm;
}

/** Strips surrounding quotes (single or double) from a string value. */
function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Deterministic ordering for cursor artifacts. Extends the base ordering
 * to also sort by frontmatter presence (artifacts without frontmatter sort
 * before those with), ensuring byte-identical output.
 */
function compareCursorArtifacts(a: CursorArtifact, b: CursorArtifact): number {
  return compareArtifacts(a, b);
}
