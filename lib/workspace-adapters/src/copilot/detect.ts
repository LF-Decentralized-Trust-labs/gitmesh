import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addFile,
  collectMarkdownTree,
  compareArtifacts,
  inspectFile,
  makeArtifact,
  parseFrontmatterBlock,
  readBlockList,
  splitFlowItems,
  stripYamlComment,
  walk,
  yamlUnquote,
  type FileInfo,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `copilot` detector (pivot T1.4) - inventories every GitHub Copilot config
 * artifact in a repository per the §4.3 config-surface row.
 *
 * Artifacts detected:
 * - `AGENTS.md` at any depth (Copilot reads AGENTS.md natively)
 * - `.github/copilot-instructions.md`
 * - `.github/instructions/` (recursive `*.instructions.md`) with parsed
 *   `applyTo` frontmatter
 * - `.github/agents/` (recursive `*.md`)
 * - `.vscode/mcp.json`
 * - `.vscode/settings.json`, only when it sets an auto-approve key, and only
 *   naming the keys it sets - never a settings value
 *
 * Same guarantees as the claude-code, codex and cursor detectors: pure,
 * read-only, deterministic sorted output, symlink-aware (literal targets,
 * never resolved away), cycle-safe, and fs errors contained - never fatal.
 */

/** Parsed `.instructions.md` frontmatter; only `applyTo` is meaningful. */
export interface CopilotFrontmatter {
  applyTo?: string | string[];
}

/** Artifact kinds this detector reports. */
export type CopilotArtifactKind =
  | "instructions" // AGENTS.md hierarchy, .github/copilot-instructions.md
  | "rule" // .github/instructions/**/*.instructions.md
  | "mcp-config" // .vscode/mcp.json
  | "agent" // .github/agents/**/*.md
  | "settings"; // .vscode/settings.json (auto-approve keys only)

export interface CopilotArtifact extends DetectedArtifact {
  kind: CopilotArtifactKind;
  /** Parsed frontmatter; present only for `rule` artifacts. */
  frontmatter?: CopilotFrontmatter;
  /** Auto-approve keys the file sets; present only for `settings` artifacts. */
  autoApprove?: string[];
}

/**
 * The VS Code settings keys that hand Copilot blanket approval (§4.3). Kept
 * in sorted order: the detector filters this list, so it is the output order.
 */
const AUTO_APPROVE_KEYS = [
  "chat.tools.global.autoApprove",
  "chat.tools.terminal.autoApprove",
  "chat.tools.urls.autoApprove",
] as const;

const INSTRUCTIONS_DIR = ".github/instructions";
const AGENTS_DIR = ".github/agents";

/** The repo-wide AGENTS.md walk never enters these. */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

export function detect(repo: RepoContext): CopilotArtifact[] {
  const root = repo.rootDir;
  const out: CopilotArtifact[] = [];

  // 1. AGENTS.md at any depth - the only family that can live anywhere, so
  //    the only one needing a repo-wide walk. One under `.github/agents/` is
  //    an agent definition, not instructions; step 4 inventories it as such.
  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) => name === "AGENTS.md",
    (_name, rel, info) => {
      if (!rel.startsWith(`${AGENTS_DIR}/`)) {
        out.push(makeArtifact(rel, "instructions", "project", info));
      }
    },
  );

  // 2. `.github/copilot-instructions.md` - repo-wide instructions.
  addFile(root, ".github/copilot-instructions.md", "instructions", "project", out);

  // 3. `.github/instructions/` - searched recursively (VS Code docs).
  walk(
    join(root, INSTRUCTIONS_DIR),
    INSTRUCTIONS_DIR,
    new Set(),
    () => true,
    (name) => name.endsWith(".instructions.md"),
    (_name, rel, info) => {
      out.push(instructionsRuleArtifact(root, rel, info));
    },
  );

  // 4. `.github/agents/` - recursive `*.md` agent definitions.
  collectMarkdownTree(root, AGENTS_DIR, "agent", out);

  // 5. `.vscode/mcp.json` - MCP server configuration.
  addFile(root, ".vscode/mcp.json", "mcp-config", "project", out);

  // 6. `.vscode/settings.json` - auto-approve keys only.
  addAutoApproveSettings(root, out);

  return out.sort(compareArtifacts);
}

/** Builds a `rule` artifact, parsing frontmatter for non-broken files. */
function instructionsRuleArtifact(
  root: string,
  rel: string,
  info: FileInfo,
): CopilotArtifact {
  const artifact: CopilotArtifact = makeArtifact(rel, "rule", "project", info);
  if (!info.broken) {
    const fm = parseCopilotFrontmatter(join(root, rel));
    if (fm) {
      artifact.frontmatter = fm;
    }
  }
  return artifact;
}

/**
 * Inventories `.vscode/settings.json` only when it sets an auto-approve key,
 * reporting which keys are set and never a settings value (T1.4). A broken
 * symlink is reported on presence alone - there is nothing to read, and a
 * dangling settings link is worth surfacing by itself.
 */
function addAutoApproveSettings(root: string, out: CopilotArtifact[]): void {
  const rel = ".vscode/settings.json";
  const abs = join(root, rel);
  const info = inspectFile(abs);
  if (!info) {
    return;
  }
  if (info.broken) {
    out.push(makeArtifact(rel, "settings", "project", info));
    return;
  }
  const keys = autoApproveKeys(abs);
  if (keys.length > 0) {
    const artifact: CopilotArtifact = makeArtifact(rel, "settings", "project", info);
    artifact.autoApprove = keys;
    out.push(artifact);
  }
}

/**
 * The auto-approve keys set by the settings file at `absPath`. Empty when the
 * file is unreadable, is not JSON, or is not a JSON object: a settings file
 * we cannot read is reported as nothing rather than guessed at.
 */
function autoApproveKeys(absPath: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(readFileSync(absPath, "utf8")));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  return AUTO_APPROVE_KEYS.filter((key) => key in parsed);
}

/**
 * Turns JSONC - the dialect VS Code writes `settings.json` in - into JSON
 * `JSON.parse` accepts: `//` and block comments are dropped and trailing
 * commas removed. String literals are copied through untouched, so no
 * comment marker or comma inside a value is mistaken for syntax.
 */
function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i++;
      }
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      if (ch === "}" || ch === "]") {
        out = dropTrailingComma(out);
      }
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Drops the comma dangling at the end of `out`, if any. Only structural
 * commas can be last: a comma inside a string is followed by its closing
 * quote, which is copied through with it.
 */
function dropTrailingComma(out: string): string {
  const trimmed = out.trimEnd();
  return trimmed.endsWith(",") ? trimmed.slice(0, -1) : out;
}

/** Index one past the JSON string literal starting at `start`. */
function endOfString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
    } else if (text[i] === '"') {
      return i + 1;
    }
  }
  return text.length;
}

export function parseCopilotFrontmatter(absPath: string): CopilotFrontmatter | undefined {
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return undefined;
  }
  return extractFrontmatter(content);
}

/**
 * Extracts the `applyTo` field from a `.instructions.md` frontmatter block.
 *
 * Parsing rules (column 0 required to avoid matching indented YAML values):
 * - `applyTo: "glob"` → string scalar
 * - `applyTo: ["a", "b"]` → inline flow array (comma-split is quote-aware)
 * - `applyTo: []` → empty inline array, NOT block-list mode
 * - `applyTo:` (bare) → block-list mode; reads following `- item` lines
 * - Trailing YAML comments stripped outside quoted regions
 * - Indented keys (e.g. inside a mapping block) are ignored
 *
 * Returns `undefined` when the file has no frontmatter.
 * Returns `{}` when frontmatter is present but `applyTo` is absent.
 */
export function extractFrontmatter(content: string): CopilotFrontmatter | undefined {
  const fmLines = parseFrontmatterBlock(content);
  if (fmLines === null) {
    return undefined;
  }

  const fm: CopilotFrontmatter = {};
  for (let i = 0; i < fmLines.length; i++) {
    // Require the key to start at column 0 (no indented keys).
    if (!fmLines[i]!.startsWith("applyTo:")) {
      continue;
    }
    const rawVal = stripYamlComment(fmLines[i]!.slice("applyTo:".length).trim());

    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      // Inline flow array: `applyTo: ["a", "b"]` or `applyTo: []`.
      fm.applyTo = splitFlowItems(rawVal.slice(1, -1));
    } else if (rawVal !== "") {
      // Scalar: `applyTo: "glob"` or `applyTo: glob`.
      fm.applyTo = yamlUnquote(rawVal);
    } else {
      // Bare key - block-list mode: read the following `- item` lines.
      const { items } = readBlockList(fmLines, i + 1);
      if (items.length > 0) {
        fm.applyTo = items;
      }
    }
    break;
  }

  return fm;
}
