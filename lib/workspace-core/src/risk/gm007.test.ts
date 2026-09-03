import { describe, expect, it } from "vitest";

import { GM007_DEFAULT_THRESHOLD, gm007, makeGm007 } from "./gm007.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  path: string,
  content?: string,
  kind = "instructions",
  scope: RiskArtifact["scope"] = "project",
): RiskArtifact => ({
  adapter: "claude-code",
  path,
  kind,
  scope,
  ...(content === undefined ? {} : { content }),
});

describe("GM007", () => {
  it("flags an instruction file over the threshold, naming exact size and threshold", () => {
    const findings = runRiskRules({ artifacts: [artifact("CLAUDE.md", "x".repeat(101))] }, [
      makeGm007(100),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "GM007",
        severity: "warning",
        path: "CLAUDE.md",
        message: expect.stringContaining("CLAUDE.md is 101 characters, over the 100-character"),
      }),
    ]);
    expect(findings[0]!.message).toContain("ICSE 2026");
  });

  it("stays silent at exactly the threshold", () => {
    expect(
      runRiskRules({ artifacts: [artifact("CLAUDE.md", "x".repeat(100))] }, [makeGm007(100)]),
    ).toEqual([]);
  });

  it("applies to rule files and user-scope memory, in any scope", () => {
    const findings = runRiskRules(
      {
        artifacts: [
          artifact(".claude/rules/style.md", "y".repeat(101), "rule"),
          artifact("~/.claude/CLAUDE.md", "z".repeat(101), "instructions", "user"),
        ],
      },
      [makeGm007(100)],
    );
    expect(findings.map((finding) => finding.path)).toEqual([
      ".claude/rules/style.md",
      "~/.claude/CLAUDE.md",
    ]);
  });

  it("never applies to on-demand surfaces (skills, commands, subagents) or probes", () => {
    expect(
      runRiskRules(
        {
          artifacts: [
            artifact(".claude/skills/deploy/SKILL.md", "s".repeat(101), "skill"),
            artifact(".claude/commands/ship.md", "c".repeat(101), "command"),
            artifact(".claude/agents/reviewer.md", "a".repeat(101), "subagent"),
            artifact("managed-settings.json", undefined, "settings", "managed"),
          ],
        },
        [makeGm007(100)],
      ),
    ).toEqual([]);
  });

  it("the table entry uses the default threshold", () => {
    const over = "x".repeat(GM007_DEFAULT_THRESHOLD + 1);
    const under = "x".repeat(GM007_DEFAULT_THRESHOLD);
    expect(runRiskRules({ artifacts: [artifact("CLAUDE.md", over)] }, [gm007])).toHaveLength(1);
    expect(runRiskRules({ artifacts: [artifact("CLAUDE.md", under)] }, [gm007])).toEqual([]);
  });
});
