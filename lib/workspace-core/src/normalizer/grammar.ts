/**
 * The §10.4 marker and fence grammar - one definition shared by the
 * normalizer (T1.8), GM006 and GM011. ADR-003 makes the managed-marker
 * grammar the ownership contract between `doctor` and the merge engine;
 * a private copy per consumer is how the two end up disagreeing about
 * what counts as a marker or a fence on the same file.
 */

export const GITMESH_MANAGED_OPEN = /^<!--\s*gitmesh:managed\b[^>]*-->$/;
export const GITMESH_MANAGED_CLOSE = /^<!--\s*\/gitmesh:managed\s*-->$/;

/** Fence opener: a backtick/tilde run plus an info string (no backticks). */
export const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/;

/** The close pattern for a fence opened with `marker` (same char, ≥ length). */
export function fenceClose(marker: string): RegExp {
  return new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
}

/** One line outside every fenced code block, CR-stripped, 1-indexed. */
export interface UnfencedLine {
  n: number;
  line: string;
  trimmed: string;
}

/**
 * The lines of `content` outside fenced code blocks (fence delimiter lines
 * excluded), under the exact fence rules the normalizer applies - so a
 * marker or reference shown in a fenced example never reaches a scanner.
 */
export function unfencedLines(content: string): UnfencedLine[] {
  const out: UnfencedLine[] = [];
  let close: RegExp | undefined;
  content.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    if (close) {
      if (close.test(line)) {
        close = undefined;
      }
      return;
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      close = fenceClose(fence[1]!);
      return;
    }
    out.push({ n: index + 1, line, trimmed: line.trim() });
  });
  return out;
}
