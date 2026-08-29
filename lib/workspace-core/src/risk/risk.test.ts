import { describe, expect, it } from "vitest";

import {
  runRiskRules,
  type RiskArtifact,
  type RiskInput,
  type RiskRule,
} from "./risk.js";

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

  it("copies only message, path and adapter - never artifact content", () => {
    const secret = "GITHUB_TOKEN=ghp_secret";
    const leaky = listRule({
      check: ({ matched }) => matched.map((a) => ({ ...a, message: "spread the artifact" })),
    });
    const findings = runRiskRules({ artifacts: [artifact({ content: secret })] }, [leaky]);
    expect(findings).toEqual([
      {
        ruleId: "GM901",
        severity: "warning",
        message: "spread the artifact",
        path: "CLAUDE.md",
        adapter: "claude-code",
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain("ghp_");
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
  /** The same root AGENTS.md as inventoried by two adapters. */
  const SHARED: RiskInput = {
    artifacts: [
      artifact({ adapter: "codex", path: "AGENTS.md" }),
      artifact({ adapter: "cline", path: "AGENTS.md" }),
    ],
  };
  const reversed = (input: RiskInput): RiskInput => ({
    artifacts: [...input.artifacts].reverse(),
  });

  it("orders findings by rule id, path, message regardless of table order", () => {
    const a = listRule({ id: "GM903", appliesTo: { adapters: ["codex"] } });
    const b = listRule({ id: "GM901", appliesTo: { kinds: ["mcp-config"] } });
    const forward = runRiskRules(INPUT, [a, b]);
    expect(forward).toEqual(runRiskRules(INPUT, [b, a]));
    expect(forward.map((finding) => finding.ruleId)).toEqual(["GM901", "GM903"]);
  });

  it("sorts by path before message, and path-less findings first", () => {
    const rule = listRule({
      check: () => [
        { message: "a", path: "CLAUDE.md" },
        { message: "z", path: "AGENTS.md" },
        { message: "b" },
      ],
    });
    expect(runRiskRules(INPUT, [rule]).map(({ path, message }) => [path, message])).toEqual([
      [undefined, "b"],
      ["AGENTS.md", "z"],
      ["CLAUDE.md", "a"],
    ]);
  });

  it("orders same-path findings by adapter regardless of inventory order", () => {
    const perAdapter = listRule({
      check: ({ matched }) => matched.map(({ path, adapter }) => ({ message: "seen", path, adapter })),
    });
    const forward = runRiskRules(SHARED, [perAdapter]);
    expect(forward).toEqual(runRiskRules(reversed(SHARED), [perAdapter]));
    expect(forward.map((finding) => finding.adapter)).toEqual(["cline", "codex"]);
  });

  it("collapses identical findings, e.g. one file inventoried by several adapters", () => {
    expect(runRiskRules(SHARED, [listRule({})])).toEqual([
      { ruleId: "GM901", severity: "warning", message: "seen", path: "AGENTS.md" },
    ]);
  });

  it("returns nothing for an empty table or empty inventory", () => {
    expect(runRiskRules(INPUT, [])).toEqual([]);
    expect(runRiskRules({ artifacts: [] }, [listRule({})])).toEqual([]);
  });
});
