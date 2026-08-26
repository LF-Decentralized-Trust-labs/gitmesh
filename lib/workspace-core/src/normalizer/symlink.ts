/**
 * Symlink resolution for instruction documents (pivot.md §10.4, ADR-003).
 *
 * A symlinked instruction file (e.g. `CLAUDE.md → AGENTS.md`) is a single
 * logical document: the drift differ (T1.9) must report it as *zero* drift
 * and as the healthy pattern it is. Detectors inventory symlinks literally
 * and never resolve them away; this module is the one place resolution
 * happens, so paths can be canonicalized to logical-document identity just
 * before comparison.
 *
 * Read-only filesystem access; resolution failures (broken links, missing
 * files) return `undefined`, never throw.
 */

import { realpathSync } from "node:fs";

/**
 * Resolves a path to its canonical logical-document path, following
 * symlinks. Returns `undefined` when the path does not resolve to an
 * existing file (missing file, broken or cyclic symlink).
 */
export function resolveLogicalPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * True when both paths resolve to the same existing logical document -
 * e.g. a `CLAUDE.md → AGENTS.md` symlink and `AGENTS.md` itself. Unresolvable
 * paths are never the same document.
 */
export function isSameLogicalDocument(a: string, b: string): boolean {
  const resolvedA = resolveLogicalPath(a);
  return resolvedA !== undefined && resolvedA === resolveLogicalPath(b);
}
