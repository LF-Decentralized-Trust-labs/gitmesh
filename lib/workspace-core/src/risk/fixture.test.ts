import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runRiskRules, type RiskArtifact, type RiskInput } from "./risk.js";
import { riskRules } from "./rules.js";

/**
 * Golden cases for the GM rule table: `fixtures/risk/<case>/` holds an
 * `input-repo/` tree, an `inventory.json` listing the artifacts a doctor run
 * would detect there (`{ adapter, path, kind, scope }` plus optional VCS
 * flags; either a bare array or `{ historyAdapters, artifacts }` when a
 * case supplies GM008's history evidence), and `expected.json`
 * with the full table's findings. Content is attached from `input-repo/`
 * when the file exists; presence probes (managed scope) have none. Every
 * case runs every rule, so each triggering case for one rule is a
 * non-triggering case for the others.
 */
const FIXTURES = fileURLToPath(new URL("../../fixtures/risk/", import.meta.url));

function readInput(caseDir: string): RiskInput {
  const parsed = JSON.parse(readFileSync(join(caseDir, "inventory.json"), "utf8")) as
    | RiskArtifact[]
    | { historyAdapters?: string[]; artifacts: RiskArtifact[] };
  const inventory = Array.isArray(parsed) ? parsed : parsed.artifacts;
  const artifacts = inventory.map((artifact) => {
    const file = join(caseDir, "input-repo", artifact.path);
    return existsSync(file) ? { ...artifact, content: readFileSync(file, "utf8") } : artifact;
  });
  return Array.isArray(parsed) || parsed.historyAdapters === undefined
    ? { artifacts }
    : { artifacts, historyAdapters: parsed.historyAdapters };
}

describe("risk rule fixtures", () => {
  for (const name of readdirSync(FIXTURES).sort()) {
    it(`${name} matches expected.json byte-for-byte`, () => {
      const caseDir = join(FIXTURES, name);
      const rendered = JSON.stringify(runRiskRules(readInput(caseDir), riskRules), null, 2) + "\n";
      expect(rendered).toBe(readFileSync(join(caseDir, "expected.json"), "utf8"));
    });
  }

  it("gm001-plaintext-secrets reports every seeded file and nothing for the managed probe", () => {
    const findings = runRiskRules(readInput(join(FIXTURES, "gm001-plaintext-secrets")), riskRules);
    const gm001 = findings.filter((finding) => finding.ruleId === "GM001");
    expect(gm001).toHaveLength(7);
    expect(new Set(gm001.map((finding) => finding.path))).toEqual(
      new Set([".mcp.json", ".codex/config.toml", "opencode.jsonc", ".ruler/mcp.json"]),
    );
    // claude-code is present only via .mcp.json and a content-less managed
    // settings probe, so GM002 fires: the repo carries no portable deny rule.
    expect(findings.filter((finding) => finding.ruleId === "GM002")).toEqual([
      expect.objectContaining({ adapter: "claude-code" }),
    ]);
  });
});
