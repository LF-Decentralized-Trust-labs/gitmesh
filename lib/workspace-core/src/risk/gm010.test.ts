import { describe, expect, it } from "vitest";

import { gm010 } from "./gm010.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  path: string,
  content?: string,
  extra: Partial<RiskArtifact> = {},
  adapter = "claude-code",
): RiskArtifact => ({
  adapter,
  path,
  kind: "instructions",
  scope: "project",
  ...(content === undefined ? {} : { content }),
  ...extra,
});

const agentsMd = (extra: Partial<RiskArtifact> = {}) =>
  artifact("AGENTS.md", "# Agents\n\n- rule.\n", extra, "codex");

const run = (artifacts: RiskArtifact[]) => runRiskRules({ artifacts }, [gm010]);

describe("GM010 - firing shapes", () => {
  it("flags AGENTS.md with no CLAUDE.md shim", () => {
    expect(run([agentsMd()])).toEqual([
      expect.objectContaining({
        ruleId: "GM010",
        severity: "warning",
        path: "AGENTS.md",
        message: expect.stringContaining("anthropics/claude-code#6235"),
      }),
    ]);
  });

  it("flags CLAUDE.md with no AGENTS.md for the other agents", () => {
    expect(run([artifact("CLAUDE.md", "# Claude\n")])).toEqual([
      expect.objectContaining({
        path: "CLAUDE.md",
        message: expect.stringContaining("there is no AGENTS.md"),
      }),
    ]);
  });

  it("flags both present without a bridge", () => {
    expect(run([agentsMd(), artifact("CLAUDE.md", "# Claude\n\n- extras.\n")])).toEqual([
      expect.objectContaining({
        path: "CLAUDE.md",
        message: expect.stringContaining("does not bridge to AGENTS.md"),
      }),
    ]);
  });

  it("reports AGENTS.md inventoried by several adapters once", () => {
    expect(run([agentsMd(), artifact("AGENTS.md", "# Agents\n", {}, "cursor")])).toHaveLength(1);
  });
});

describe("GM010 - bridges", () => {
  it.each([["@AGENTS.md"], ["@./AGENTS.md"], ["see @AGENTS.md for shared rules"]])(
    "accepts an import token: %s",
    (line) => {
      expect(run([agentsMd(), artifact("CLAUDE.md", `# Claude\n\n${line}\n`)])).toEqual([]);
    },
  );

  it("rejects a token that only prefixes another name", () => {
    expect(run([agentsMd(), artifact("CLAUDE.md", "@AGENTS.mdx\n")])).toHaveLength(1);
  });

  it("accepts a symlink in either direction", () => {
    expect(
      run([agentsMd(), artifact("CLAUDE.md", "# Agents\n", { symlinkTarget: "AGENTS.md" })]),
    ).toEqual([]);
    expect(
      run([agentsMd({ symlinkTarget: "./CLAUDE.md" }), artifact("CLAUDE.md", "# Claude\n")]),
    ).toEqual([]);
  });

  it("treats unreadable CLAUDE.md content as bridged (explicit evidence only)", () => {
    expect(run([agentsMd(), artifact("CLAUDE.md")])).toEqual([]);
  });
});

describe("GM010 - scope", () => {
  it("ignores nested pairs (the drift differ's lane) and non-project scopes", () => {
    expect(
      run([
        artifact("packages/app/CLAUDE.md", "# Nested\n"),
        artifact("packages/app/AGENTS.md", "# Nested\n", {}, "codex"),
        artifact("~/.claude/CLAUDE.md", "# Memory\n", { scope: "user" }),
      ]),
    ).toEqual([]);
  });

  it("treats a broken CLAUDE.md symlink as missing", () => {
    expect(
      run([agentsMd(), artifact("CLAUDE.md", undefined, { symlinkTarget: "gone.md", broken: true })]),
    ).toEqual([
      expect.objectContaining({ path: "AGENTS.md" }),
    ]);
  });
});

describe("GM010 - duplicate inventory entries", () => {
  it("aggregates bridge evidence across duplicates, in any order", () => {
    const resolved = artifact("CLAUDE.md", "# Agents\n- rule.\n");
    const link = artifact("CLAUDE.md", undefined, { symlinkTarget: "AGENTS.md" }, "cursor");
    expect(run([agentsMd(), resolved, link])).toEqual([]);
    expect(run([agentsMd(), link, resolved])).toEqual([]);
  });
});
