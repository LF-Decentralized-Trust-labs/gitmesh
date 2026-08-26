/**
 * Scope frontmatter parsing for instruction documents (pivot.md §10.4).
 *
 * Cursor `.mdc` frontmatter (`description`, `globs`, `alwaysApply`) and
 * Copilot `.instructions.md` frontmatter (`applyTo`) both scope a rule body
 * to file globs. Both map onto one {@link InstructionScope} so the drift
 * differ (T1.9) can compare scoped rules across tools, and so the body can
 * be hashed without the tool-specific frontmatter dialect.
 *
 * Implemented as a lightweight quote-aware line parser, like the detector
 * parsers in `@gitmesh/workspace-adapters` (which core cannot import - the
 * dependency points the other way). Only the keys above are meaningful;
 * unknown keys are ignored, never an error.
 */

/** Unified scope parsed from Cursor `.mdc` or Copilot `applyTo` frontmatter. */
export interface InstructionScope {
  /** Cursor rule description, when present. */
  description?: string;
  /**
   * Normalized scope globs: Cursor `globs` (scalar, comma list, flow or
   * block sequence) and Copilot `applyTo` (same shapes) merged, trimmed,
   * de-duplicated in first-seen order.
   */
  globs: string[];
  /** Cursor `alwaysApply`, when present. */
  alwaysApply?: boolean;
}

/** Result of splitting a document into scope frontmatter and body. */
export interface FrontmatterSplit {
  /** Parsed scope; undefined when the document has no frontmatter block. */
  scope?: InstructionScope;
  /** Document content after the frontmatter block (or the whole input). */
  body: string;
}

/**
 * Splits a document into scope frontmatter and body. Frontmatter is a
 * leading `---` line closed by the next `---` line; an unterminated opener
 * is treated as content, not frontmatter. Line endings are normalized to
 * `\n` in the returned body.
 */
export function parseScopeFrontmatter(content: string): FrontmatterSplit {
  const text = content.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { body: text };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return { body: text };
  }
  const scope = parseScopeLines(lines.slice(1, close));
  return { scope, body: lines.slice(close + 1).join("\n") };
}

/** Parses the known scope keys from frontmatter lines. */
function parseScopeLines(lines: string[]): InstructionScope {
  const scope: InstructionScope = { globs: [] };
  const globs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Column 0 required so values inside nested mappings are not matched.
    const match = /^([A-Za-z][\w-]*):(.*)$/.exec(lines[i]!);
    if (!match) {
      continue;
    }
    const key = match[1]!;
    const rawValue = stripYamlComment(match[2]!).trim();
    switch (key) {
      case "description": {
        const value = yamlUnquote(rawValue);
        if (value !== "") {
          scope.description = value;
        }
        break;
      }
      case "globs":
      case "applyTo": {
        if (rawValue === "") {
          const block = readBlockSequence(lines, i + 1);
          globs.push(...block.items);
          i = block.end - 1;
        } else {
          globs.push(...parseGlobValue(rawValue));
        }
        break;
      }
      case "alwaysApply": {
        if (rawValue === "true") {
          scope.alwaysApply = true;
        } else if (rawValue === "false") {
          scope.alwaysApply = false;
        }
        break;
      }
      default:
        break;
    }
  }
  for (const glob of globs) {
    if (!scope.globs.includes(glob)) {
      scope.globs.push(glob);
    }
  }
  return scope;
}

/**
 * Parses a scalar glob value: a `[a, b]` flow sequence, or a scalar that may
 * itself be a comma list (Cursor accepts `globs: *.ts, *.tsx`). Splitting is
 * quote-aware so brace globs like `**{@literal /}*.{ts,tsx}` survive only in
 * quoted or flow form - matching how Cursor itself disambiguates.
 */
function parseGlobValue(rawValue: string): string[] {
  const flow = /^\[(.*)\]$/.exec(rawValue);
  if (flow) {
    return splitFlowItems(flow[1]!);
  }
  const unquoted = yamlUnquote(rawValue);
  if (unquoted !== rawValue.trim()) {
    // A quoted scalar is a single glob, commas and all.
    return unquoted === "" ? [] : [unquoted];
  }
  return splitFlowItems(rawValue);
}

/** Reads a `- item` block sequence starting at `start`; returns items and end index. */
function readBlockSequence(lines: string[], start: number): { items: string[]; end: number } {
  const items: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const match = /^\s*-\s*(.*)$/.exec(lines[i]!);
    if (!match) {
      break;
    }
    const item = yamlUnquote(stripYamlComment(match[1]!).trim());
    if (item !== "") {
      items.push(item);
    }
  }
  return { items, end: i };
}

/** Splits on commas outside quotes; items trimmed, unquoted, empties dropped. */
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
  return items.map((item) => yamlUnquote(item.trim())).filter((item) => item !== "");
}

/** Strips a trailing `# …` comment that starts outside a quoted region. */
function stripYamlComment(value: string): string {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || value[i - 1] === " " || value[i - 1] === "\t")) {
      return value.slice(0, i);
    }
  }
  return value;
}

/** Removes one layer of matching single or double quotes. */
function yamlUnquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
