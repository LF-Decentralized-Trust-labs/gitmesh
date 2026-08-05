import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  compareArtifacts,
  inspectFile,
  makeArtifact,
  walk,
} from "../detect-fs.js";
import type { DetectedArtifact, RepoContext } from "../types.js";

/**
 * `copilot` detector (pivot T1.4) - inventories every GitHub Copilot config
 * artifact in a repository per the §4.3 config-surface row.
 *
 * Artifacts detected:
 * - `AGENTS.md` at any depth (Copilot reads AGENTS.md natively)
 * - `.github/copilot-instructions.md`
 * - `.github/instructions/*.instructions.md` with parsed YAML frontmatter (`applyTo`)
 * - `.vscode/mcp.json`
 * - `.github/agents/` (recursive `*.md`)
 * - `.vscode/settings.json` (for VS Code auto-approve booleans)
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

const WALK_EXCLUDES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".github", // Internal config will be picked up separately
]);

export function detect(repo: RepoContext): CopilotArtifact[] {
  const root = repo.rootDir;
  const out: CopilotArtifact[] = [];

  // 1. AGENTS.md at any depth.
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

  // 2. `.github/copilot-instructions.md`
  addFile(out, root, ".github/copilot-instructions.md", "instructions", "project");

  // 3. `.github/instructions/*.instructions.md` — recursive walk, parse frontmatter.
  collectInstructions(root, out);

  // 4. `.vscode/mcp.json`
  addFile(out, root, ".vscode/mcp.json", "mcp-config", "project");

  // 5. `.github/agents/` — recursive `*.md`
  collectMarkdownTree(root, ".github/agents", "agent", out);

  // 6. `.vscode/settings.json` (auto-approve booleans presence check)
  addFile(out, root, ".vscode/settings.json", "settings", "project");

  return out.sort(compareCopilotArtifacts);
}

function addFile(
  out: CopilotArtifact[],
  root: string,
  relPath: string,
  kind: CopilotArtifactKind,
  scope: CopilotArtifact["scope"],
): void {
  const info = inspectFile(join(root, relPath));
  if (info) {
    out.push(makeArtifact(relPath, kind, scope, info));
  }
}

function collectMarkdownTree(
  root: string,
  relBase: string,
  kind: CopilotArtifactKind,
  out: CopilotArtifact[],
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

function collectInstructions(root: string, out: CopilotArtifact[]): void {
  walk(
    join(root, ".github", "instructions"),
    ".github/instructions",
    new Set(),
    () => true,
    (name) => name.endsWith(".instructions.md"),
    (_name, rel, info) => {
      const artifact = makeArtifact(rel, "rule" as const, "project", info) as CopilotArtifact;
      if (!info.broken) {
        const fm = parseCopilotFrontmatter(join(root, rel));
        if (fm) {
          artifact.frontmatter = fm;
        }
      }
      out.push(artifact);
    },
  );
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

export function extractFrontmatter(content: string): CopilotFrontmatter | undefined {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0]!.trim() !== "---") {
    return undefined;
  }

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

  const fm: CopilotFrontmatter = {};
  
  // Extract applyTo using simple state tracking since it can be multiline YAML array
  let inApplyTo = false;
  let applyToList: string[] = [];

  for (let i = 1; i < endIndex; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("applyTo:")) {
      const val = trimmed.slice(8).trim();
      if (val === "" || val === "[]") {
        inApplyTo = true;
      } else if (val.startsWith("[") && val.endsWith("]")) {
        // inline array format
        const items = val.slice(1, -1).split(",").map(s => unquote(s.trim()));
        fm.applyTo = items;
      } else {
        // string format
        fm.applyTo = unquote(val);
      }
      continue;
    }

    if (inApplyTo && trimmed.startsWith("-")) {
      const val = trimmed.slice(1).trim();
      applyToList.push(unquote(val));
    } else if (inApplyTo && trimmed.includes(":")) {
      // Reached another key, stop array parsing
      inApplyTo = false;
      if (applyToList.length > 0) {
        fm.applyTo = applyToList;
      }
    }
  }

  if (inApplyTo && applyToList.length > 0) {
    fm.applyTo = applyToList;
  }

  return fm;
}

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

function compareCopilotArtifacts(a: CopilotArtifact, b: CopilotArtifact): number {
  return compareArtifacts(a, b);
}
