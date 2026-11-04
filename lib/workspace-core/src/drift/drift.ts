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
 *   differs, via longest-common-subsequence), and a `relation` saying what
 *   the diff means: only `diverged` copies are drift. A pair sharing no
 *   block is a `pointer` (the shorter side, at most three blocks, names the
 *   other file: "See AGENTS.md") or `separate` documents, neither a copy
 *   that drifted (#501; the definitions the census uses).
 * - `divergentBlocks` aggregates across the documents that are copies of
 *   one another: each block that is missing somewhere, with
 *   `presentIn`/`missingFrom` - the "present in A, missing in B/C" view.
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

/**
 * What a pair's diff means. `identical`: same blocks, same order.
 * `diverged`: copies sharing at least one block and differing elsewhere -
 * the only relation that is drift and costs score. `pointer`: no shared
 * block, and the shorter document, at most `POINTER_MAX_BLOCKS` blocks,
 * names the other file. `separate`: no shared block otherwise - a document
 * of its own, written for one agent, not a copy.
 */
export type PairRelation = "identical" | "diverged" | "pointer" | "separate";

/** Set/sequence diff between one pair of logical documents. */
export interface PairDrift {
  /** Labels of the compared documents; `a` sorts before `b`. */
  a: string;
  b: string;
  relation: PairRelation;
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
  /**
   * Blocks missing from at least one of the documents that are copies of
   * another (an `identical` or `diverged` pair), first-seen order. A pointer
   * or a separate document shares nothing by definition and contributes none.
   */
  divergentBlocks: BlockPresence[];
}

/** A pointer names the other file in at most this many blocks. */
const POINTER_MAX_BLOCKS = 3;

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

  const copies = new Set<string>();
  for (const pair of pairs) {
    if (pair.relation === "identical" || pair.relation === "diverged") {
      copies.add(pair.a);
      copies.add(pair.b);
    }
  }
  const divergentBlocks = aggregatePresence(documents.filter((document) => copies.has(document.label)));
  return { documents, symlinkGroups, pairs, divergentBlocks };
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
  const identical = onlyInA.length === 0 && onlyInB.length === 0 && reordered.length === 0;
  const relation: PairRelation = identical
    ? "identical"
    : sharedA.length > 0
      ? "diverged"
      : pointerOrSeparate(a, b);

  return {
    a: a.label,
    b: b.label,
    relation,
    onlyInA,
    onlyInB,
    reordered,
    sharedCount: sharedA.length,
    identical,
  };
}

/**
 * For a pair sharing no block: `pointer` when the shorter document (at most
 * `POINTER_MAX_BLOCKS` blocks) names the other file - with equal lengths,
 * either side may do the naming - else `separate`.
 */
function pointerOrSeparate(a: DriftDocument, b: DriftDocument): PairRelation {
  const [shorter, longer] = a.doc.blocks.length <= b.doc.blocks.length ? [a, b] : [b, a];
  if (shorter.doc.blocks.length > POINTER_MAX_BLOCKS) {
    return "separate";
  }
  const tie = shorter.doc.blocks.length === longer.doc.blocks.length;
  return names(shorter, longer) || (tie && names(longer, shorter)) ? "pointer" : "separate";
}

/** True when `from` mentions the file name of any of `to`'s paths, case-insensitively. */
function names(from: DriftDocument, to: DriftDocument): boolean {
  const text = from.doc.blocks.map((block) => block.text.toLowerCase()).join("\n");
  return to.paths.some((path) => text.includes(path.slice(path.lastIndexOf("/") + 1).toLowerCase()));
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
