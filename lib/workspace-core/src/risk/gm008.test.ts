import { describe, expect, it } from "vitest";

import { gm008 } from "./gm008.js";
import { runRiskRules, type RiskArtifact, type RiskInput } from "./risk.js";

const artifact = (
  adapter: string,
  path: string,
  scope: RiskArtifact["scope"] = "project",
): RiskArtifact => ({ adapter, path, kind: "instructions", scope });

const run = (input: RiskInput) => runRiskRules(input, [gm008]);

describe("GM008", () => {
  it("stays silent when history is unknown (no historyAdapters supplied)", () => {
    expect(run({ artifacts: [artifact("devin", ".windsurfrules")] })).toEqual([]);
  });

  it("flags an adapter with repo config but no history evidence, once, as info", () => {
    const findings = run({
      artifacts: [
        artifact("devin", ".windsurfrules"),
        artifact("devin", ".windsurf/rules/style.md"),
        artifact("claude-code", "CLAUDE.md"),
      ],
      historyAdapters: ["claude-code"],
    });
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "GM008",
        severity: "info",
        adapter: "devin",
        message: expect.stringContaining("devin is unseen in its history"),
      }),
    ]);
    expect(findings[0]!.path).toBeUndefined();
  });

  it("flags every unseen adapter under an explicit empty history", () => {
    const findings = run({
      artifacts: [artifact("claude-code", "CLAUDE.md"), artifact("cursor", ".cursor/rules/a.mdc")],
      historyAdapters: [],
    });
    expect(findings.map((finding) => finding.adapter)).toEqual(["claude-code", "cursor"]);
  });

  it("only repo-tier artifacts make an adapter 'present'", () => {
    expect(
      run({
        artifacts: [
          artifact("codex", "~/.codex/config.toml", "user"),
          artifact("claude-code", "managed-settings.json", "managed"),
        ],
        historyAdapters: [],
      }),
    ).toEqual([]);
  });

  it("local-scope config counts as presence", () => {
    expect(
      run({ artifacts: [artifact("claude-code", "CLAUDE.local.md", "local")], historyAdapters: [] }),
    ).toHaveLength(1);
  });

  it("never flags third-party managers (not an agent; ADR-004)", () => {
    expect(
      run({
        artifacts: [artifact("third-party-managers", ".ruler/ruler.toml")],
        historyAdapters: [],
      }),
    ).toEqual([]);
  });
});
