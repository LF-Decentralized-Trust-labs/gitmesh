import { describe, expect, it } from "vitest";

import {
  runRiskRules,
  type RiskArtifact,
  type RiskInput,
  type RiskRule,
} from "./risk.js";
import { riskRules } from "./rules.js";

const artifact = (overrides: Partial<RiskArtifact>): RiskArtifact => ({
  adapter: "claude-code",
  path: "CLAUDE.md",
  kind: "instructions",
  scope: "project",
  ...overrides,
});

const INPUT: RiskInput = {
  artifacts: [
    artifact({}),
    artifact({ adapter: "codex", path: "AGENTS.md" }),
    artifact({ adapter: "claude-code", path: ".mcp.json", kind: "mcp-config" }),
    artifact({ adapter: "claude-code", path: "~/.claude/CLAUDE.md", scope: "user" }),
  ],
};

/** Rule reporting every matched artifact's path, for filter assertions. */
const listRule = (overrides: Partial<RiskRule>): RiskRule => ({
  id: "GM901",
  severity: "warning",
  appliesTo: {},
  check: ({ matched }) => matched.map(({ path }) => ({ message: "seen", path })),
  ...overrides,
});

describe("runRiskRules - stamping", () => {
  it("stamps the rule's id and severity onto every finding", () => {
    const findings = runRiskRules(INPUT, [
      listRule({ id: "GM902", severity: "error", appliesTo: { kinds: ["mcp-config"] } }),
    ]);
    expect(findings).toEqual([
      { ruleId: "GM902", severity: "error", message: "seen", path: ".mcp.json" },
    ]);
  });

  it("throws on duplicate rule ids", () => {
    expect(() => runRiskRules(INPUT, [listRule({}), listRule({})])).toThrow(
      "duplicate risk rule id: GM901",
    );
  });
});

describe("runRiskRules - appliesTo filtering", () => {
  const paths = (rule: RiskRule) => runRiskRules(INPUT, [rule]).map((finding) => finding.path);

  it("matches every artifact when appliesTo is empty", () => {
    expect(paths(listRule({}))).toEqual([
      ".mcp.json",
      "AGENTS.md",
      "CLAUDE.md",
      "~/.claude/CLAUDE.md",
    ]);
  });

  it("filters by adapter, kind and scope, ANDed together", () => {
    expect(paths(listRule({ appliesTo: { adapters: ["codex"] } }))).toEqual(["AGENTS.md"]);
    expect(paths(listRule({ appliesTo: { kinds: ["instructions"], scopes: ["user"] } }))).toEqual([
      "~/.claude/CLAUDE.md",
    ]);
    expect(
      paths(listRule({ appliesTo: { adapters: ["claude-code"], kinds: ["instructions"], scopes: ["project"] } })),
    ).toEqual(["CLAUDE.md"]);
  });

  it("matches nothing on an empty list", () => {
    expect(paths(listRule({ appliesTo: { adapters: [] } }))).toEqual([]);
  });

  it("runs check on zero matches, so an absence rule can report via the full input", () => {
    const noAgentsMd: RiskRule = listRule({
      appliesTo: { kinds: ["instructions"] },
      check: ({ matched, input }) =>
        matched.length === 0 && input.artifacts.length > 0
          ? [{ message: "no instruction file found" }]
          : [],
    });
    expect(runRiskRules({ artifacts: [artifact({ kind: "mcp-config" })] }, [noAgentsMd])).toEqual([
      { ruleId: "GM901", severity: "warning", message: "no instruction file found" },
    ]);
    expect(runRiskRules(INPUT, [noAgentsMd])).toEqual([]);
  });
});

describe("runRiskRules - determinism", () => {
  it("orders findings by rule id, path, message regardless of table order", () => {
    const a = listRule({ id: "GM903", appliesTo: { adapters: ["codex"] } });
    const b = listRule({ id: "GM901", appliesTo: { kinds: ["mcp-config"] } });
    const forward = runRiskRules(INPUT, [a, b]);
    const reversed = runRiskRules(INPUT, [b, a]);
    expect(forward).toEqual(reversed);
    expect(forward.map((finding) => finding.ruleId)).toEqual(["GM901", "GM903"]);
  });

  it("sorts path-less findings before pathed ones within a rule", () => {
    const rule = listRule({
      check: () => [
        { message: "b", path: "CLAUDE.md" },
        { message: "a" },
      ],
    });
    expect(runRiskRules(INPUT, [rule]).map((finding) => finding.path)).toEqual([
      undefined,
      "CLAUDE.md",
    ]);
  });

  it("returns nothing for an empty table or empty inventory", () => {
    expect(runRiskRules(INPUT, [])).toEqual([]);
    expect(runRiskRules({ artifacts: [] }, [listRule({})])).toEqual([]);
  });
});

describe("riskRules table", () => {
  it("ships empty until T1.11+ land GM rules", () => {
    expect(riskRules).toEqual([]);
  });
});
