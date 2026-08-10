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
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `copilot` detector (pivot T1.4) - inventories every GitHub Copilot config
 * artifact in a repository per the §4.3 config-surface row.
 *
 * Artifacts detected:
 * - `AGENTS.md` at any depth (Copilot reads AGENTS.md natively)
 * - `.github/copilot-instructions.md`
 * - `.github/instructions/**.instructions.md` with parsed YAML frontmatter (`applyTo`)
 * - `.vscode/mcp.json`
 * - `.github/agents/` (recursive `*.md`)
 * - `.vscode/settings.json` only when it contains a recognized auto-approve key
 *
 * Pure, read-only, deterministic sorted output, symlink-aware, cycle-safe.
 */

export interface CopilotFrontmatter {
  applyTo?: string | string[];
}

export type CopilotArtifactKind =
  | "instructions"
  | "rule"
  | "mcp-config"
  | "agent"
  | "settings";

export interface CopilotArtifact extends DetectedArtifact {
  kind: CopilotArtifactKind;
  frontmatter?: CopilotFrontmatter;
}

/**
 * Real VS Code settings keys Copilot uses for auto-approve. Only flag the
 * file if at least one of these is present so we don't annotate unrelated
 * settings files.
 */
const AUTO_APPROVE_KEYS = new Set([
  "chat.tools.global.autoApprove",
  "chat.tools.terminal.autoApprove",
  "chat.tools.urls.autoApprove",
]);

/**
 * Directories the unified walk never descends into.
 * Note: `.github` is NOT excluded — `.github/AGENTS.md` must be detected.
 */
const WALK_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

export function detect(repo: RepoContext): CopilotArtifact[] {
  const root = repo.rootDir;
  const out: CopilotArtifact[] = [];

  // Single unified traversal: collects AGENTS.md everywhere, routes
  // .github/copilot-instructions.md, .github/instructions/*.instructions.md,
  // and .github/agents/*.md by path segment.
  walk(
    root,
    "",
    new Set(),
    (dir) => !WALK_EXCLUDES.has(dir),
    (name) =>
      name === "AGENTS.md" ||
      name === "copilot-instructions.md" ||
      name.endsWith(".instructions.md") ||
      name.endsWith(".md"),
    (name, rel, info) => {
      const segments = rel.split("/");

      if (name === "AGENTS.md") {
        out.push(makeArtifact(rel, "instructions", "project", info));
        return;
      }

      // .github/copilot-instructions.md
      if (
        name === "copilot-instructions.md" &&
        segments.length === 2 &&
        segments[0] === ".github"
      ) {
        out.push(makeArtifact(rel, "instructions", "project", info));
        return;
      }

      // .github/instructions/**/*.instructions.md
      if (name.endsWith(".instructions.md") && segments[0] === ".github" && segments[1] === "instructions") {
        const artifact: CopilotArtifact = makeArtifact(rel, "rule", "project", info);
        if (!info.broken) {
          const fm = parseCopilotFrontmatter(join(root, rel));
          if (fm) {
            artifact.frontmatter = fm;
          }
        }
        out.push(artifact);
        return;
      }

      // .github/agents/**/*.md
      if (
        name.endsWith(".md") &&
        segments[0] === ".github" &&
        segments[1] === "agents"
      ) {
        out.push(makeArtifact(rel, "agent", "project", info));
        return;
      }
    },
  );

  // .vscode/mcp.json — singleton, no content inspection needed.
  addFile(root, ".vscode/mcp.json", "mcp-config", "project", out);

  // .vscode/settings.json — only emit if it contains a real auto-approve key.
  addSettingsIfAutoApprove(root, out);

  return out.sort(compareArtifacts);
}

/** Emits the `.vscode/settings.json` artifact only when an auto-approve key is present. */
function addSettingsIfAutoApprove(root: string, out: CopilotArtifact[]): void {
  const rel = ".vscode/settings.json";
  const abs = join(root, rel);
  const info = inspectFile(abs);
  if (!info) {
    return;
  }
  // Symlinked-but-broken: report presence without parsing.
  if (info.broken) {
    out.push(makeArtifact(rel, "settings", "project", info));
    return;
  }
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const hasAutoApprove = AUTO_APPROVE_KEYS.size > 0 &&
    [...AUTO_APPROVE_KEYS].some((k) => k in parsed);
  if (hasAutoApprove) {
    out.push(makeArtifact(rel, "settings", "project", info));
  }
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
  let i = 0;

  while (i < fmLines.length) {
    const line = fmLines[i]!;

    // Require the key to start at column 0 (no indented keys).
    if (!line.startsWith("applyTo:")) {
      i++;
      continue;
    }

    const rawVal = stripYamlComment(line.slice("applyTo:".length).trim());

    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      // Inline flow array: `applyTo: ["a", "b"]` or `applyTo: []`
      const inner = rawVal.slice(1, -1);
      fm.applyTo = splitFlowItems(inner); // returns [] for empty inner
      break;
    }

    if (rawVal !== "") {
      // Scalar: `applyTo: "glob"` or `applyTo: glob`
      fm.applyTo = yamlUnquote(rawVal);
      break;
    }

    // Bare key — block-list mode: read following `- item` lines.
    const { items } = readBlockList(fmLines, i + 1);
    if (items.length > 0) {
      fm.applyTo = items;
    }
    break;
  }

  return fm;
}
