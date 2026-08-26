/**
 * Cross-tool instruction drift differ (pivot.md §10.4, T1.9).
 *
 * Cross-tool drift = set/sequence diff of normalized block hashes with
 * provenance. Inputs are instruction documents already read by the caller
 * (the doctor pipeline); each is normalized (T1.8) and compared:
 *
 * - Documents sharing a `logicalPath` (a symlink and its target, resolved
 *   via `resolveLogicalPath`) collapse into ONE logical document - zero
 *   drift by construction, reported in `symlinkGroups` as the healthy
 *   pattern it is (§10.4, ADR-003).
 * - Every unordered pair of logical documents gets a set diff (blocks only
 *   in one side, multiset semantics so duplicated blocks count) and a
 *   sequence diff (`reordered`: shared blocks whose relative order
 *   differs, via longest-common-subsequence).
 * - `divergentBlocks` aggregates across all documents: each block that is
 *   missing somewhere, with `presentIn`/`missingFrom` - the
 *   "present in A, missing in B/C" view.
 *
 * Pure data → data: no filesystem access, no wallclock, deterministic
 * ordering everywhere (documents and pairs sorted by label, blocks in
 * first-seen document order). Rendering prose/TTY/JSON output is T1.16's
 * job; this module only computes the report.
 */

import {
  normalizeInstructionMarkdown,
  type BlockKind,
  type NormalizedDocument,
} from "../normalizer/index.js";

/** One instruction file handed to the differ. */
export interface DriftDocumentInput {
  /** Stable display path (repo-relative POSIX, like detector output). */
  path: string;
  /** Raw file content. */
  content: string;
  /**
   * Canonical identity from `resolveLogicalPath`; inputs sharing a value
   * are one logical document (symlink topology). Omitted → the path is
   * its own logical document.
   */
  logicalPath?: string;
}

/** A logical document in the report: one or more paths, one content. */
export interface DriftDocument {
  /** Sorted display paths; more than one means a symlink group. */
  paths: string[];
  /** `paths[0]`; the name used in pairs and presence lists. */
  label: string;
  /** Normalized content (blocks, hashes, scope). */
  doc: NormalizedDocument;
}

/** Provenance-free reference to one normalized block. */
export interface DriftBlockRef {
  kind: BlockKind;
  text: string;
  hash: string;
}

/** Set/sequence diff between one pair of logical documents. */
export interface PairDrift {
  /** Labels of the compared documents; `a` sorts before `b`. */
  a: string;
  b: string;
  /** Blocks (multiset) present in `a` but not `b`, in `a` order. */
  onlyInA: DriftBlockRef[];
  /** Blocks (multiset) present in `b` but not `a`, in `b` order. */
  onlyInB: DriftBlockRef[];
  /** Shared blocks whose relative order differs, in `a` order. */
  reordered: DriftBlockRef[];
  /** Number of shared blocks (multiset intersection size). */
  sharedCount: number;
  /** True when both sides carry the same blocks in the same order. */
  identical: boolean;
}

/** Cross-document presence of one divergent block. */
export interface BlockPresence {
  block: DriftBlockRef;
  /** Labels of documents containing the block, sorted. */
  presentIn: string[];
  /** Labels of documents missing the block, sorted. */
  missingFrom: string[];
}

/** The full cross-tool drift report. */
export interface DriftReport {
  /** Logical documents, sorted by label. */
  documents: DriftDocument[];
  /** Path groups (≥2) collapsed by symlink topology - healthy, zero drift. */
  symlinkGroups: string[][];
  /** Every unordered pair of logical documents, lexicographic by labels. */
  pairs: PairDrift[];
  /** Blocks missing from at least one document, first-seen order. */
  divergentBlocks: BlockPresence[];
}

/** Computes the cross-tool drift report for a set of instruction files. */
export function computeDriftReport(inputs: readonly DriftDocumentInput[]): DriftReport {
  const documents = groupLogicalDocuments(inputs);
  const symlinkGroups = documents
    .filter((document) => document.paths.length > 1)
    .map((document) => document.paths);

  const pairs: PairDrift[] = [];
  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      pairs.push(diffPair(documents[i]!, documents[j]!));
    }
  }

  return { documents, symlinkGroups, pairs, divergentBlocks: aggregatePresence(documents) };
}

/** Groups inputs by logical identity and normalizes each group once. */
function groupLogicalDocuments(inputs: readonly DriftDocumentInput[]): DriftDocument[] {
  const groups = new Map<string, { paths: Set<string>; content: string }>();
  for (const input of inputs) {
    // A path with no logical identity (e.g. an unresolvable file the caller
    // still wants compared) stands alone under its own display path.
    const key = input.logicalPath ?? `path:${input.path}`;
    const group = groups.get(key);
    if (group) {
      group.paths.add(input.path);
    } else {
      groups.set(key, { paths: new Set([input.path]), content: input.content });
    }
  }
  return [...groups.values()]
    .map(({ paths, content }) => {
      const sorted = [...paths].sort();
      return {
        paths: sorted,
        label: sorted[0]!,
        doc: normalizeInstructionMarkdown(content),
      };
    })
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Set diff (multiset) + sequence diff for one document pair. */
function diffPair(a: DriftDocument, b: DriftDocument): PairDrift {
  const countsB = countByHash(b.doc.blocks);
  const sharedA: DriftBlockRef[] = [];
  const onlyInA: DriftBlockRef[] = [];
  for (const block of a.doc.blocks) {
    const remaining = countsB.get(block.hash) ?? 0;
    if (remaining > 0) {
      countsB.set(block.hash, remaining - 1);
      sharedA.push(toRef(block));
    } else {
      onlyInA.push(toRef(block));
    }
  }

  const countsA = countByHash(a.doc.blocks);
  const sharedB: DriftBlockRef[] = [];
  const onlyInB: DriftBlockRef[] = [];
  for (const block of b.doc.blocks) {
    const remaining = countsA.get(block.hash) ?? 0;
    if (remaining > 0) {
      countsA.set(block.hash, remaining - 1);
      sharedB.push(toRef(block));
    } else {
      onlyInB.push(toRef(block));
    }
  }

  const inSequence = lcsMembership(
    sharedA.map((block) => block.hash),
    sharedB.map((block) => block.hash),
  );
  const reordered = sharedA.filter((_, index) => !inSequence[index]);

  return {
    a: a.label,
    b: b.label,
    onlyInA,
    onlyInB,
    reordered,
    sharedCount: sharedA.length,
    identical: onlyInA.length === 0 && onlyInB.length === 0 && reordered.length === 0,
  };
}

/** Blocks missing from at least one document, with presence provenance. */
function aggregatePresence(documents: readonly DriftDocument[]): BlockPresence[] {
  const seen = new Map<string, DriftBlockRef>();
  for (const document of documents) {
    for (const block of document.doc.blocks) {
      if (!seen.has(block.hash)) {
        seen.set(block.hash, toRef(block));
      }
    }
  }
  const result: BlockPresence[] = [];
  for (const [hash, block] of seen) {
    const presentIn: string[] = [];
    const missingFrom: string[] = [];
    for (const document of documents) {
      const has = document.doc.blocks.some((candidate) => candidate.hash === hash);
      (has ? presentIn : missingFrom).push(document.label);
    }
    if (missingFrom.length > 0) {
      result.push({ block, presentIn, missingFrom });
    }
  }
  return result;
}

/**
 * Marks which elements of `a` belong to one deterministic longest common
 * subsequence of `a` and `b`; elements outside it are "out of order".
 */
function lcsMembership(a: readonly string[], b: readonly string[]): boolean[] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const member = new Array<boolean>(a.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      member[i] = true;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return member;
}

function countByHash(blocks: readonly { hash: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    counts.set(block.hash, (counts.get(block.hash) ?? 0) + 1);
  }
  return counts;
}

function toRef(block: { kind: BlockKind; text: string; hash: string }): DriftBlockRef {
  return { kind: block.kind, text: block.text, hash: block.hash };
}
