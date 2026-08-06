import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  addFile,
  collectMarkdownTree,
  compareArtifacts,
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
 * - `.cursor/rules/*.mdc` with parsed YAML frontmatter, at the root and in
 *   nested `.cursor` directories (monorepo subproject rules, Cursor v0.50+)
 * - Legacy `.cursorrules` (root-only)
 * - `.cursor/mcp.json` (root-only)
 * - `.cursor/agents/` (recursive `*.md`, root-only)
 * - `.cursor/hooks.json` (v1.7+ hooks config, root-only)
 *
 * Same guarantees as the claude-code and codex detectors: pure, read-only,
 * deterministic sorted output, symlink-aware (literal targets, never
 * resolved away), cycle-safe, and fs errors contained - never fatal.
 */

/**
 * Parsed YAML-like frontmatter from a `.mdc` file. `globs` is normalized to
 * Cursor's canonical comma-separated form (YAML block and flow lists are
 * flattened); a key whose value is null or empty is omitted entirely.
 */
export interface MdcFrontmatter {
  description?: string;
  globs?: string;
  alwaysApply?: boolean;
}

/** Artifact kinds this detector reports. */
export type CursorArtifactKind =
  | "instructions" // AGENTS.md hierarchy, legacy .cursorrules
  | "rule" // .cursor/rules/*.mdc (root and nested)
  | "mcp-config" // .cursor/mcp.json
  | "agent" // .cursor/agents/**/*.md
  | "hooks"; // .cursor/hooks.json (v1.7+)

export interface CursorArtifact extends DetectedArtifact {
  kind: CursorArtifactKind;
  /** Parsed .mdc frontmatter; present only for `rule` artifacts from `.mdc` files. */
  frontmatter?: MdcFrontmatter;
}

/** The repo walk never enters these. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

export function detect(repo: RepoContext): CursorArtifact[] {
  const root = repo.rootDir;
  const out: CursorArtifact[] = [];

  // 1. One repo-wide walk covers both families that may live at any depth:
  //    AGENTS.md (Cursor reads it natively per §4.3) and `.cursor/rules/*.mdc`
  //    (nested `.cursor` dirs carry subproject rules since Cursor v0.50).
  //    Routing by path keeps it a single traversal; an AGENTS.md inside a
  //    `.cursor` dir is config housekeeping, not instructions.
  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md" || name.endsWith(".mdc"),
    (name, rel, info) => {
      const segments = rel.split("/");
      if (name === "AGENTS.md") {
        if (!segments.includes(".cursor")) {
          out.push(makeArtifact(rel, "instructions", "project", info));
        }
      } else if (underCursorRules(segments)) {
        out.push(mdcRuleArtifact(root, rel, info));
      }
    },
  );

  // 2. Legacy `.cursorrules` (root-only, single file).
  addFile(root, ".cursorrules", "instructions", "project", out);

  // 3. `.cursor/mcp.json` - MCP server configuration.
  addFile(root, ".cursor/mcp.json", "mcp-config", "project", out);

  // 4. `.cursor/agents/` - recursive `*.md` agent definitions.
  collectMarkdownTree(root, ".cursor/agents", "agent", out);

  // 5. `.cursor/hooks.json` - v1.7+ hooks config.
  addFile(root, ".cursor/hooks.json", "hooks", "project", out);

  return out.sort(compareArtifacts);
}

/** True when `segments` places a file below any `.cursor/rules/` directory. */
function underCursorRules(segments: string[]): boolean {
  for (let i = 0; i + 2 < segments.length; i++) {
    if (segments[i] === ".cursor" && segments[i + 1] === "rules") {
      return true;
    }
  }
  return false;
}

/** Builds a `rule` artifact, parsing frontmatter for non-broken files. */
function mdcRuleArtifact(root: string, rel: string, info: FileInfo): CursorArtifact {
  const artifact: CursorArtifact = makeArtifact(rel, "rule", "project", info);
  if (!info.broken) {
    const fm = parseMdcFrontmatter(join(root, rel));
    if (fm) {
      artifact.frontmatter = fm;
    }
  }
  return artifact;
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
      case "description": {
        const value = unquote(rawValue);
        if (value !== "") {
          fm.description = value;
        }
        break;
      }
      case "globs": {
        let value: string;
        if (rawValue === "") {
          // Bare key: a YAML block list (`- pattern` lines) or null.
          const list = readBlockList(lines, i + 1, endIndex);
          value = list.items.join(",");
          i = list.end - 1;
        } else {
          value = normalizeGlobs(rawValue);
        }
        if (value !== "") {
          fm.globs = value;
        }
        break;
      }
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

/** Reads consecutive `- item` lines from `start`; items are trimmed and unquoted. */
function readBlockList(
  lines: string[],
  start: number,
  endIndex: number,
): { items: string[]; end: number } {
  const items: string[] = [];
  let i = start;
  for (; i < endIndex; i++) {
    const match = /^\s*-\s*(.*)$/.exec(lines[i]!);
    if (!match) {
      break;
    }
    const item = unquote(match[1]!.trim());
    if (item !== "") {
      items.push(item);
    }
  }
  return { items, end: i };
}

/**
 * Normalizes a scalar `globs` value to Cursor's canonical comma-separated
 * form: a flow list (`["a", "b"]`) is flattened, a plain scalar passes
 * through unquoted.
 */
function normalizeGlobs(rawValue: string): string {
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    return splitFlowItems(rawValue.slice(1, -1)).join(",");
  }
  return unquote(rawValue);
}

/** Splits flow-list items on commas outside quotes; items are trimmed and unquoted. */
function splitFlowItems(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const ch of inner) {
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
      }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map((item) => unquote(item.trim())).filter((item) => item !== "");
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
