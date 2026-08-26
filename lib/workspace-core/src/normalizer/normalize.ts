/**
 * Instruction markdown normalizer + block hasher (pivot.md §10.4, T1.8).
 *
 * Markdown → block list (headings, paragraphs, fences, lists) → strip
 * adapter wrappers/markers → normalize whitespace → stable SHA-256 per
 * block and per document. Cross-tool drift (T1.9) is then a set/sequence
 * diff of block hashes, so two files carrying the same instructions in
 * different formatting dialects must hash identically here.
 *
 * Normalization rules (the contract the tests pin down):
 * - Line endings normalized to `\n`; trailing whitespace dropped.
 * - Scope frontmatter (Cursor `.mdc`, Copilot `applyTo`) is parsed into
 *   {@link InstructionScope} and excluded from block content, so the same
 *   rule body scoped in different dialects compares equal.
 * - Full-line HTML comments are adapter wrappers/markers (gitmesh managed
 *   markers, Ruler `Source:` banners, generated-by notices) and are
 *   stripped. gitmesh managed markers (ADR-003) additionally set the
 *   `managed` flag on the blocks they enclose - §10.4 compares managed
 *   content against expected emitter output, user-owned content only
 *   across tools. Inline comments inside a text line are content.
 * - Headings: ATX only, canonicalized to `## text` (closing hashes
 *   dropped, whitespace collapsed).
 * - Paragraphs: lines joined with a single space, whitespace collapsed -
 *   hard-wrapping is formatting, not drift.
 * - Lists: one block per contiguous run of items; unordered markers
 *   canonicalized to `-`, ordered to `n.` (numbers kept as written);
 *   continuation lines joined into their item; leading indentation kept
 *   (tabs → two spaces) because nesting depth is structure, not
 *   formatting.
 * - Fences: ``` and ~~~ both canonicalized to ```; info string trimmed;
 *   inner content byte-preserved (only line endings normalized) - code is
 *   whitespace-significant.
 *
 * Pure content → structure; no filesystem access (symlink identity lives
 * in `symlink.ts`), no wallclock, no ordering nondeterminism.
 */

import { createHash } from "node:crypto";

import { parseScopeFrontmatter, type InstructionScope } from "./frontmatter.js";

/** Kinds of normalized instruction blocks. */
export type BlockKind = "heading" | "paragraph" | "fence" | "list";

/** One normalized block of an instruction document. */
export interface NormalizedBlock {
  kind: BlockKind;
  /** Canonical text per the module normalization rules. */
  text: string;
  /** SHA-256 (hex) of `kind` and `text`; the unit of drift comparison. */
  hash: string;
  /**
   * True when the block lies inside a gitmesh managed region (ADR-003).
   * Managed content compares against expected emitter output; the flag
   * does not participate in the hash.
   */
  managed: boolean;
}

/** A fully normalized instruction document. */
export interface NormalizedDocument {
  /** Scope parsed from frontmatter; undefined when there is none. */
  scope?: InstructionScope;
  /** Normalized blocks in document order. */
  blocks: NormalizedBlock[];
  /**
   * SHA-256 (hex) over the ordered block hashes. Content-only: scope and
   * managed flags are reported alongside, not folded in, so the differ
   * decides what counts as drift.
   */
  hash: string;
}

const GITMESH_MANAGED_OPEN = /^<!--\s*gitmesh:managed\b[^>]*-->$/;
const GITMESH_MANAGED_CLOSE = /^<!--\s*\/gitmesh:managed\s*-->$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const LIST_ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})[.)])[ \t]+(.*)$/;

/** Normalizes one instruction markdown document into hashed blocks. */
export function normalizeInstructionMarkdown(content: string): NormalizedDocument {
  const { scope, body } = parseScopeFrontmatter(content);
  const lines = body.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop(); // artifact of the document's final newline, not a blank line
  }

  const blocks: NormalizedBlock[] = [];
  let managed = false;
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(makeBlock("paragraph", paragraph.join(" "), managed));
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(makeBlock("list", listItems.join("\n"), managed));
      listItems = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    // Adapter wrappers/markers: full-line HTML comments.
    if (trimmed.startsWith("<!--")) {
      flushAll();
      let comment = trimmed;
      while (!comment.includes("-->") && i + 1 < lines.length) {
        i++;
        comment += "\n" + lines[i]!.trim();
      }
      const single = comment.replace(/\n/g, " ");
      if (GITMESH_MANAGED_OPEN.test(single)) {
        managed = true;
      } else if (GITMESH_MANAGED_CLOSE.test(single)) {
        managed = false;
      }
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      flushAll();
      const marker = fence[1]!;
      const info = fence[2]!.trim();
      const inner: string[] = [];
      const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
      i++;
      for (; i < lines.length && !close.test(lines[i]!); i++) {
        inner.push(lines[i]!);
      }
      const innerText = inner.length > 0 ? inner.join("\n") + "\n" : "";
      blocks.push(makeBlock("fence", "```" + info + "\n" + innerText + "```", managed));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const text = collapseWhitespace((heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, ""));
      blocks.push(makeBlock("heading", `${heading[1]!} ${text}`.trimEnd(), managed));
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const indent = item[1]!.replace(/\t/g, "  ");
      const marker = item[2] !== undefined ? "-" : `${item[3]!}.`;
      listItems.push(`${indent}${marker} ${collapseWhitespace(item[4]!)}`);
      continue;
    }
    if (listItems.length > 0) {
      // Non-blank, non-item line while in a list: continuation of the item.
      listItems[listItems.length - 1] += ` ${collapseWhitespace(line)}`;
      continue;
    }

    paragraph.push(collapseWhitespace(line));
  }
  flushAll();

  return { scope, blocks, hash: hashDocument(blocks) };
}

/** SHA-256 (hex) of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hashes one block: kind and text, NUL-separated so kinds cannot collide. */
export function hashBlock(kind: BlockKind, text: string): string {
  return sha256Hex(`${kind}\u0000${text}`);
}

/** Document hash: SHA-256 over the ordered block hashes. */
export function hashDocument(blocks: readonly NormalizedBlock[]): string {
  return sha256Hex(blocks.map((block) => block.hash).join("\n"));
}

function makeBlock(kind: BlockKind, text: string, managed: boolean): NormalizedBlock {
  return { kind, text, hash: hashBlock(kind, text), managed };
}

/** Collapses runs of spaces/tabs to one space and trims the ends. */
function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").trim();
}
