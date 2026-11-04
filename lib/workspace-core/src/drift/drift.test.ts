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
        relation: "identical",
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

describe("computeDriftReport - pair relations (#501)", () => {
  const AGENTS = "# Rules\n\nUse pnpm.\n\n- Run tests before every commit.\n";

  it("calls copies that share a block and differ elsewhere diverged", () => {
    const { pairs } = computeDriftReport([doc("AGENTS.md", AGENTS), doc("GEMINI.md", "# Rules\n\nUse pnpm.\n\nPrefer tabs.\n")]);
    expect(pairs.map((pair) => pair.relation)).toEqual(["diverged"]);
  });

  it("calls identical copies identical", () => {
    const { pairs } = computeDriftReport([doc("AGENTS.md", AGENTS), doc("CLAUDE.md", AGENTS)]);
    expect(pairs.map((pair) => pair.relation)).toEqual(["identical"]);
  });

  it("calls a short file that names the other a pointer, whichever side is shorter", () => {
    const pointer = "See AGENTS.md for the instructions in this repository.\n";
    expect(computeDriftReport([doc("AGENTS.md", AGENTS), doc("CLAUDE.md", pointer)]).pairs[0]?.relation).toBe("pointer");
    expect(computeDriftReport([doc("AGENTS.md", pointer.replace("AGENTS.md", "CLAUDE.md")), doc("CLAUDE.md", AGENTS)]).pairs[0]?.relation).toBe(
      "pointer",
    );
    // Naming is case-insensitive and by file name, so a nested path is found by its basename.
    expect(
      computeDriftReport([doc("AGENTS.md", AGENTS), doc(".github/copilot-instructions.md", "Read agents.md first.\n")]).pairs[0]?.relation,
    ).toBe("pointer");
    // Equal lengths: either side may do the naming.
    expect(computeDriftReport([doc("AGENTS.md", "Use pnpm.\n"), doc("CLAUDE.md", "Follow AGENTS.md.\n")]).pairs[0]?.relation).toBe("pointer");
  });

  it("calls a pair sharing no block separate when the shorter side has more than three blocks or names nothing", () => {
    const other = "# Claude\n\nPrefer the Edit tool.\n\n- Never run git push.\n";
    expect(computeDriftReport([doc("AGENTS.md", AGENTS), doc("CLAUDE.md", other)]).pairs[0]?.relation).toBe("separate");
    const long = "# Guide\n\nOne.\n\nTwo.\n\nThree.\n\nFour, see AGENTS.md.\n";
    expect(computeDriftReport([doc("AGENTS.md", AGENTS), doc("CLAUDE.md", long)]).pairs[0]?.relation).toBe("separate");
    expect(computeDriftReport([doc("AGENTS.md", AGENTS), doc("CLAUDE.md", "")]).pairs[0]?.relation).toBe("separate");
  });

  it("aggregates divergent blocks over copies only", () => {
    const { divergentBlocks, pairs } = computeDriftReport([
      doc("AGENTS.md", AGENTS),
      doc("CLAUDE.md", "See AGENTS.md.\n"),
      doc("GEMINI.md", "# Rules\n\nUse pnpm.\n"),
    ]);
    expect(pairs.map((pair) => [pair.a, pair.b, pair.relation])).toEqual([
      ["AGENTS.md", "CLAUDE.md", "pointer"],
      ["AGENTS.md", "GEMINI.md", "diverged"],
      ["CLAUDE.md", "GEMINI.md", "separate"],
    ]);
    expect(divergentBlocks.map(({ block, presentIn, missingFrom }) => [block.text, presentIn, missingFrom])).toEqual([
      ["- Run tests before every commit.", ["AGENTS.md"], ["GEMINI.md"]],
    ]);
    expect(computeDriftReport([doc("AGENTS.md", AGENTS), doc("CLAUDE.md", "See AGENTS.md.\n")]).divergentBlocks).toEqual([]);
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

  it("excludes universal blocks and treats an empty document as separate, not as a copy missing everything", () => {
    const report = computeDriftReport([doc("a.md", "# Same\n"), doc("b.md", "")]);
    expect(report.pairs[0]!.relation).toBe("separate");
    expect(report.divergentBlocks).toEqual([]);
    const empty = computeDriftReport([doc("a.md", ""), doc("b.md", "\n\n")]);
    expect(empty.pairs[0]!.identical).toBe(true);
    expect(empty.divergentBlocks).toEqual([]);
  });
});
