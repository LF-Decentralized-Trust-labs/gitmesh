import {
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { join, win32 } from "node:path";
import type { ArtifactScope, DetectedArtifact } from "./types.js";

/**
 * Filesystem plumbing shared by the detectors (extracted from T1.1/T1.2
 * before T1.3 adds a third copy). Everything here upholds the detector
 * guarantees: pure, read-only, deterministic sorted output, symlink-aware
 * (literal targets, never resolved away - pivot.md §10.4), cycle-safe, and
 * filesystem errors contained - an unreadable directory or a broken symlink
 * skips or flags the entry, never aborts, so a doctor scan survives any
 * repository.
 */

/** Symlink details of an inventoried file; empty for a regular file. */
export interface FileInfo {
  symlinkTarget?: string;
  broken?: boolean;
}

/** Builds one artifact, attaching symlink details only when present. */
export function makeArtifact<K extends string>(
  path: string,
  kind: K,
  scope: ArtifactScope,
  info: FileInfo = {},
): DetectedArtifact & { kind: K } {
  const artifact: DetectedArtifact & { kind: K } = { path, kind, scope };
  if (info.symlinkTarget !== undefined) {
    artifact.symlinkTarget = info.symlinkTarget;
  }
  if (info.broken) {
    artifact.broken = true;
  }
  return artifact;
}

/**
 * `stat` (follows symlinks) that never throws: `undefined` for any unreachable
 * path - missing (`ENOENT`), a symlink cycle (`ELOOP`), or one we lack
 * permission to resolve (`EACCES`). `throwIfNoEntry` suppresses only `ENOENT`,
 * so the `try` covers the rest; a doctor scan must not abort on one bad entry.
 */
export function safeStat(absPath: string): Stats | undefined {
  try {
    return statSync(absPath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/** `lstat` (does not follow symlinks) that never throws; see {@link safeStat}. */
export function safeLstat(absPath: string): Stats | undefined {
  try {
    return lstatSync(absPath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

/**
 * Inspects one path expected to hold a regular file. Returns `null` when it
 * does not exist or is a directory; symlinks are reported with their literal
 * target, flagged broken when they do not resolve to a file.
 */
export function inspectFile(absPath: string): FileInfo | null {
  const stats = safeLstat(absPath);
  if (stats === undefined) {
    return null;
  }
  if (stats.isSymbolicLink()) {
    return symlinkInfo(absPath);
  }
  return stats.isFile() ? {} : null;
}

/** Like {@link inspectFile}, reusing the `Dirent` from a directory listing. */
export function fileInfoFromEntry(entry: Dirent, absPath: string): FileInfo | null {
  if (entry.isSymbolicLink()) {
    return symlinkInfo(absPath);
  }
  return entry.isFile() ? {} : null;
}

export function symlinkInfo(absPath: string): FileInfo {
  let symlinkTarget: string;
  try {
    symlinkTarget = readlinkSync(absPath).replaceAll("\\", "/");
  } catch {
    // A symlink we cannot even read (e.g. permission denied): flag it broken
    // rather than aborting the scan.
    return { broken: true };
  }
  const resolved = safeStat(absPath);
  return resolved?.isFile() ? { symlinkTarget } : { symlinkTarget, broken: true };
}

/** True for directories, including symlinks that resolve to directories. */
export function isTraversableDir(entry: Dirent, absPath: string): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  return entry.isSymbolicLink() && (safeStat(absPath)?.isDirectory() ?? false);
}

/** Sorted listing; an unreadable or missing directory contributes nothing. */
export function sortedEntries(absDir: string): Dirent[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Cycle-safe recursive walk. Directories are marked visited by real path, so
 * symlink cycles and aliased trees terminate and each real directory is
 * inventoried exactly once; `recurse` gates descent by directory name;
 * `fileFilter` gates which file names are inspected at all - inspecting a
 * symlink costs `readlink` + `stat`, so filtering happens before inspection,
 * not in `onFile`; `onFile` receives each matching file (or file symlink)
 * with its POSIX-style path relative to the walk root.
 */
export function walk(
  absDir: string,
  relDir: string,
  visited: Set<string>,
  recurse: (dirName: string) => boolean,
  fileFilter: (name: string) => boolean,
  onFile: (name: string, rel: string, info: FileInfo) => void,
): void {
  let real: string;
  try {
    real = realpathSync(absDir);
  } catch {
    return;
  }
  if (visited.has(real)) {
    return;
  }
  visited.add(real);
  for (const entry of sortedEntries(absDir)) {
    const abs = join(absDir, entry.name);
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (isTraversableDir(entry, abs)) {
      if (recurse(entry.name)) {
        walk(abs, rel, visited, recurse, fileFilter, onFile);
      }
    } else if (fileFilter(entry.name)) {
      const info = fileInfoFromEntry(entry, abs);
      if (info) {
        onFile(entry.name, rel, info);
      }
    }
  }
}

/** Inventories `relPath` under `root` when it holds a file (or file symlink). */
export function addFile<K extends string>(
  root: string,
  relPath: string,
  kind: K,
  scope: ArtifactScope,
  out: Array<DetectedArtifact & { kind: K }>,
): void {
  const info = inspectFile(join(root, relPath));
  if (info) {
    out.push(makeArtifact(relPath, kind, scope, info));
  }
}

/** Recursively inventories every `*.md` file under `root`/`relBase` at project scope. */
export function collectMarkdownTree<K extends string>(
  root: string,
  relBase: string,
  kind: K,
  out: Array<DetectedArtifact & { kind: K }>,
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
 * Final path segment, used as the machine-independent display name of probe
 * paths. `win32.basename` handles both separators (POSIX `basename` would
 * treat `C:\a\b` as a single segment), so probe paths from any OS work.
 */
export function lastSegment(path: string): string {
  return win32.basename(path);
}

/** Deterministic code-unit ordering by path, then kind, then scope. */
export function compareArtifacts(a: DetectedArtifact, b: DetectedArtifact): number {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.kind !== b.kind) {
    return a.kind < b.kind ? -1 : 1;
  }
  return a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0;
}
