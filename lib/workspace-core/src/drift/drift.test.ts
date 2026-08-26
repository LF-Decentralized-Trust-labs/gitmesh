import { describe, expect, it } from "vitest";

import { computeDriftReport } from "./drift.js";

const doc = (path: string, content: string, logicalPath?: string) => ({
  path,
  content,
  ...(logicalPath === undefined ? {} : { logicalPath }),
});

describe("computeDriftReport - pairs", () => {
  it("reports identical documents as identical despite formatting differences", () => {
    const report = computeDriftReport([
      doc("AGENTS.md", "# Rules\n\nUse pnpm.\n"),
      doc("CLAUDE.md", "#  Rules \r\n\r\nUse   pnpm.\r\n"),
    ]);
    expect(report.pairs).toEqual([
      {
        a: "AGENTS.md",
        b: "CLAUDE.md",
        onlyInA: [],
        onlyInB: [],
        reordered: [],
        sharedCount: 2,
        identical: true,
      },
    ]);
    expect(report.divergentBlocks).toEqual([]);
  });

  it("computes the block set diff per pair, in document order", () => {
    const report = computeDriftReport([
      doc("AGENTS.md", "# Rules\n\nUse pnpm.\n\n- run tests\n"),
      doc("GEMINI.md", "# Rules\n\nPrefer tabs.\n"),
    ]);
    const [pair] = report.pairs;
    expect(pair!.onlyInA.map((block) => block.text)).toEqual(["Use pnpm.", "- run tests"]);
    expect(pair!.onlyInB.map((block) => block.text)).toEqual(["Prefer tabs."]);
    expect(pair!.sharedCount).toBe(1);
    expect(pair!.identical).toBe(false);
  });

  it("detects sequence drift among shared blocks", () => {
    const report = computeDriftReport([
      doc("AGENTS.md", "# A\n\n# B\n\n# C\n"),
      doc("CLAUDE.md", "# B\n\n# A\n\n# C\n"),
    ]);
    const [pair] = report.pairs;
    expect(pair!.onlyInA).toEqual([]);
    expect(pair!.onlyInB).toEqual([]);
    expect(pair!.reordered.map((block) => block.text)).toEqual(["# A"]);
    expect(pair!.identical).toBe(false);
  });

  it("uses multiset semantics for duplicated blocks", () => {
    const report = computeDriftReport([
      doc("AGENTS.md", "same\n\nsame\n"),
      doc("CLAUDE.md", "same\n"),
    ]);
    const [pair] = report.pairs;
    expect(pair!.onlyInA.map((block) => block.text)).toEqual(["same"]);
    expect(pair!.sharedCount).toBe(1);
  });

  it("emits every unordered pair in deterministic label order", () => {
    const report = computeDriftReport([
      doc("b.md", "x\n"),
      doc("c.md", "x\n"),
      doc("a.md", "x\n"),
    ]);
    expect(report.pairs.map((pair) => [pair.a, pair.b])).toEqual([
      ["a.md", "b.md"],
      ["a.md", "c.md"],
      ["b.md", "c.md"],
    ]);
  });
});

describe("computeDriftReport - symlink topology", () => {
  it("collapses paths sharing a logicalPath into one zero-drift document", () => {
    const report = computeDriftReport([
      doc("AGENTS.md", "# Rules\n", "/repo/AGENTS.md"),
      doc("CLAUDE.md", "# Rules\n", "/repo/AGENTS.md"),
      doc("GEMINI.md", "# Other\n", "/repo/GEMINI.md"),
    ]);
    expect(report.documents.map((document) => document.paths)).toEqual([
      ["AGENTS.md", "CLAUDE.md"],
      ["GEMINI.md"],
    ]);
    expect(report.symlinkGroups).toEqual([["AGENTS.md", "CLAUDE.md"]]);
    // One logical pair, not three: the symlink never drifts against its target.
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]).toMatchObject({ a: "AGENTS.md", b: "GEMINI.md" });
  });

  it("keeps documents without logicalPath as their own logical document", () => {
    const report = computeDriftReport([doc("a.md", "x\n"), doc("b.md", "x\n")]);
    expect(report.symlinkGroups).toEqual([]);
    expect(report.pairs).toHaveLength(1);
  });
});

describe("computeDriftReport - divergent block aggregation", () => {
  it('reports "present in A, missing in B/C" with sorted provenance', () => {
    const report = computeDriftReport([
      doc(".cursor/rules/style.mdc", "# Shared\n\n- cursor only rule\n"),
      doc("AGENTS.md", "# Shared\n\nUse pnpm.\n"),
      doc("CLAUDE.md", "# Shared\n\nUse pnpm.\n"),
    ]);
    expect(
      report.divergentBlocks.map((entry) => ({
        text: entry.block.text,
        presentIn: entry.presentIn,
        missingFrom: entry.missingFrom,
      })),
    ).toEqual([
      {
        text: "- cursor only rule",
        presentIn: [".cursor/rules/style.mdc"],
        missingFrom: ["AGENTS.md", "CLAUDE.md"],
      },
      {
        text: "Use pnpm.",
        presentIn: ["AGENTS.md", "CLAUDE.md"],
        missingFrom: [".cursor/rules/style.mdc"],
      },
    ]);
  });

  it("excludes universal blocks and handles empty documents", () => {
    const report = computeDriftReport([doc("a.md", "# Same\n"), doc("b.md", "")]);
    expect(report.divergentBlocks).toEqual([
      expect.objectContaining({ presentIn: ["a.md"], missingFrom: ["b.md"] }),
    ]);
    const empty = computeDriftReport([doc("a.md", ""), doc("b.md", "\n\n")]);
    expect(empty.pairs[0]!.identical).toBe(true);
    expect(empty.divergentBlocks).toEqual([]);
  });
});
