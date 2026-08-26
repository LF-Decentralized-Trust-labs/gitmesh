import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { computeDriftReport, type DriftDocumentInput } from "./drift.js";
import { resolveLogicalPath } from "../normalizer/index.js";

/**
 * Seeded 3-way-drift fixture (T1.9 AC): three logical documents - AGENTS.md
 * (with CLAUDE.md symlinked to it), GEMINI.md, and a scoped
 * `.cursor/rules/style.mdc` - with known seeded divergences. The computed
 * report must match `expected.json` byte-for-byte: exactly the seeded
 * drift, nothing more, nothing less.
 */
const FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/drift/three-way/", import.meta.url),
);

/** The instruction files of the fixture repo, as the doctor would feed them. */
function readFixtureInputs(): DriftDocumentInput[] {
  const paths = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursor/rules/style.mdc"];
  return paths.map((path) => {
    const absolute = join(FIXTURE_DIR, path);
    const input: DriftDocumentInput = {
      path,
      content: readFileSync(absolute, "utf8"),
    };
    const logicalPath = resolveLogicalPath(absolute);
    if (logicalPath !== undefined) {
      input.logicalPath = logicalPath;
    }
    return input;
  });
}

describe("three-way drift fixture", () => {
  it("is set up with a real CLAUDE.md → AGENTS.md symlink", () => {
    expect(readdirSync(FIXTURE_DIR).sort()).toEqual([
      ".cursor",
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    expect(resolveLogicalPath(join(FIXTURE_DIR, "CLAUDE.md"))).toBe(
      resolveLogicalPath(join(FIXTURE_DIR, "AGENTS.md")),
    );
  });

  it("reports exactly the seeded drift, byte-for-byte", () => {
    const report = computeDriftReport(readFixtureInputs());
    const rendered = JSON.stringify(report, null, 2) + "\n";
    const expected = readFileSync(join(FIXTURE_DIR, "..", "three-way-expected.json"), "utf8");
    expect(rendered).toBe(expected);
  });

  it("collapses the symlink to zero drift and pins the seeded divergences", () => {
    const report = computeDriftReport(readFixtureInputs());
    expect(report.symlinkGroups).toEqual([["AGENTS.md", "CLAUDE.md"]]);
    expect(report.pairs).toHaveLength(3);
    expect(
      report.divergentBlocks.map((entry) => ({
        text: entry.block.text,
        presentIn: entry.presentIn,
        missingFrom: entry.missingFrom,
      })),
    ).toEqual([
      {
        text: "- Run tests before every commit.\n- Sign off commits with -s.",
        presentIn: [".cursor/rules/style.mdc", "AGENTS.md"],
        missingFrom: ["GEMINI.md"],
      },
      {
        text: "Never commit secrets.",
        presentIn: [".cursor/rules/style.mdc"],
        missingFrom: ["AGENTS.md", "GEMINI.md"],
      },
      {
        text: "Use pnpm for all installs.",
        presentIn: ["AGENTS.md", "GEMINI.md"],
        missingFrom: [".cursor/rules/style.mdc"],
      },
      {
        text: "Prefer tabs over spaces.",
        presentIn: ["GEMINI.md"],
        missingFrom: [".cursor/rules/style.mdc", "AGENTS.md"],
      },
    ]);
  });
});
