import { describe, expect, it } from "vitest";

import { gm009 } from "./gm009.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  path: string,
  scope: RiskArtifact["scope"],
  vcs: { tracked?: boolean; ignored?: boolean } = {},
  adapter = "claude-code",
): RiskArtifact => ({ adapter, path, kind: "settings", scope, ...vcs });

const run = (artifacts: RiskArtifact[]) => runRiskRules({ artifacts }, [gm009]);

describe("GM009 - committed local-scope files", () => {
  it("flags a committed local-scope file", () => {
    expect(run([artifact(".claude/settings.local.json", "local", { tracked: true })])).toEqual([
      expect.objectContaining({
        ruleId: "GM009",
        severity: "warning",
        path: ".claude/settings.local.json",
        message: expect.stringContaining("personal local-scope file but is committed"),
      }),
    ]);
  });

  it("stays silent on a healthy or unknown local file", () => {
    expect(
      run([
        artifact("CLAUDE.local.md", "local", { tracked: false, ignored: true }),
        artifact(".claude/settings.local.json", "local", {}),
      ]),
    ).toEqual([]);
  });

  it("includes third-party manager local files (hygiene is the repo's, not the manager's)", () => {
    expect(
      run([artifact("rulesync.local.jsonc", "local", { tracked: true }, "third-party-managers")]),
    ).toHaveLength(1);
  });
});

describe("GM009 - gitignored project-scope files", () => {
  it("flags a gitignored, untracked project file", () => {
    expect(run([artifact(".mcp.json", "project", { tracked: false, ignored: true })])).toEqual([
      expect.objectContaining({
        path: ".mcp.json",
        message: expect.stringContaining("shared project configuration but is gitignored"),
      }),
    ]);
  });

  it("stays silent without explicit evidence: unknown tracked, tracked-but-ignored, healthy", () => {
    expect(
      run([
        artifact(".mcp.json", "project", { ignored: true }),
        artifact(".claude/settings.json", "project", { tracked: true, ignored: true }),
        artifact("CLAUDE.md", "project", { tracked: true, ignored: false }),
      ]),
    ).toEqual([]);
  });

  it("never fires outside the repo tiers", () => {
    expect(
      run([
        artifact("~/.claude/CLAUDE.md", "user", { tracked: true }),
        artifact("managed-settings.json", "managed", { tracked: true }),
      ]),
    ).toEqual([]);
  });
});
