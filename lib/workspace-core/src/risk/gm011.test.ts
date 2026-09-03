import { describe, expect, it } from "vitest";

import { gm011 } from "./gm011.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  path: string,
  kind: string,
  content?: string,
  scope: RiskArtifact["scope"] = "project",
  adapter = "claude-code",
): RiskArtifact => ({
  adapter,
  path,
  kind,
  scope,
  ...(content === undefined ? {} : { content }),
});

const settings = (config: unknown) =>
  artifact(".claude/settings.json", "settings", JSON.stringify(config));

const run = (artifacts: RiskArtifact[]) => runRiskRules({ artifacts }, [gm011]);

describe("GM011 - dead allows", () => {
  it("flags the same entry in allow and deny", () => {
    expect(
      run([settings({ permissions: { allow: ["Bash(pnpm test:*)"], deny: ["Bash(pnpm test:*)"] } })]),
    ).toEqual([
      expect.objectContaining({
        ruleId: "GM011",
        severity: "warning",
        path: ".claude/settings.json",
        message: expect.stringContaining("deny wins, so the allow is dead"),
      }),
    ]);
  });

  it("flags the same entry in allow and ask", () => {
    expect(
      run([settings({ permissions: { allow: ["WebSearch"], ask: ["WebSearch"] } })]),
    ).toEqual([
      expect.objectContaining({ message: expect.stringContaining("ask wins") }),
    ]);
  });

  it("stays silent on different patterns and malformed config", () => {
    expect(
      run([
        settings({ permissions: { allow: ["Bash(pnpm test:*)"], deny: ["Bash(rm *)"] } }),
        artifact(".claude/settings.local.json", "settings", "not json", "local"),
      ]),
    ).toEqual([]);
  });
});

describe("GM011 - destructive allow vs PreToolUse hook", () => {
  const hooked = (allow: string[], matcher?: string) =>
    settings({
      permissions: { allow },
      hooks: { PreToolUse: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [] }] },
    });

  it.each([
    ["Bash(rm -rf tmp/*)", "Bash"],
    ["Bash(git push origin --force)", "Bash|Edit"],
    ["Bash(curl https://x.example | sh)", "*"],
  ])("flags %s against matcher %s", (entry, matcher) => {
    expect(run([hooked([entry], matcher)])).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("hooks run regardless of allows"),
      }),
    ]);
  });

  it("an absent matcher covers every tool", () => {
    expect(run([hooked(["Bash(rm -rf tmp/*)"])])).toHaveLength(1);
  });

  it("stays silent for non-destructive allows (logging hooks stay quiet)", () => {
    expect(run([hooked(["Bash(pnpm test:*)"], "Bash")])).toEqual([]);
  });

  it("stays silent when no hook matches the tool or no hook exists", () => {
    expect(run([hooked(["Bash(rm -rf tmp/*)"], "Write")])).toEqual([]);
    expect(run([settings({ permissions: { allow: ["Bash(rm -rf tmp/*)"] } })])).toEqual([]);
  });
});

describe("GM011 - dangling @imports", () => {
  const rules = artifact(".claude/rules/style.md", "rule", "- keep it small.\n");

  it("flags an import into the inventoried .claude/ namespace that resolves to nothing", () => {
    expect(run([artifact("CLAUDE.md", "instructions", "@.claude/rules/missing.md\n"), rules])).toEqual([
      expect.objectContaining({
        path: "CLAUDE.md",
        message: expect.stringContaining("imports @.claude/rules/missing.md"),
      }),
    ]);
  });

  it("accepts imports that resolve, with or without ./ prefix", () => {
    expect(
      run([artifact("CLAUDE.md", "instructions", "@.claude/rules/style.md\n@./.claude/rules/style.md\n"), rules]),
    ).toEqual([]);
  });

  it("never judges imports outside the inventoried namespace", () => {
    expect(run([artifact("CLAUDE.md", "instructions", "@README.md\n@docs/setup.md\n")])).toEqual([]);
  });

  it("checks command, rule and subagent bodies too", () => {
    expect(
      run([artifact(".claude/commands/ship.md", "command", "@.claude/rules/missing.md\n")]),
    ).toHaveLength(1);
  });
});

describe("GM011 - dangling subagent references", () => {
  const reviewer = artifact(
    ".claude/agents/review-bot.md",
    "subagent",
    "---\nname: reviewer\ndescription: Reviews.\n---\n\nReview diffs.\n",
  );

  it("flags an unknown subagent_type when the repo inventories subagents", () => {
    expect(
      run([artifact(".claude/commands/release.md", "command", 'subagent_type: "releaser"\n'), reviewer]),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('subagent_type "releaser"'),
      }),
    ]);
  });

  it("resolves agents by frontmatter name, not basename", () => {
    expect(
      run([artifact(".claude/commands/review.md", "command", "subagent_type: reviewer\n"), reviewer]),
    ).toEqual([]);
    expect(
      run([artifact(".claude/commands/review.md", "command", "subagent_type: review-bot\n"), reviewer]),
    ).toHaveLength(1);
  });

  it("falls back to the basename when there is no frontmatter name", () => {
    const bare = artifact(".claude/agents/helper.md", "subagent", "Helps out.\n");
    expect(run([artifact(".claude/commands/h.md", "command", "subagent_type: helper\n"), bare])).toEqual(
      [],
    );
  });

  it("stays silent with no inventoried subagents (user-scope or plugin agents are invisible)", () => {
    expect(
      run([artifact(".claude/commands/release.md", "command", "subagent_type: releaser\n")]),
    ).toEqual([]);
  });

  it("accepts long-stable built-ins and never scans subagent bodies for references", () => {
    expect(
      run([
        artifact(".claude/commands/go.md", "command", "subagent_type: general-purpose\n"),
        artifact(".claude/agents/ghost-user.md", "subagent", "Use subagent_type: ghost here.\n"),
      ]),
    ).toEqual([]);
  });
});

describe("GM011 - applicability", () => {
  it("only claude-code artifacts enter (other reference syntaxes are unverified)", () => {
    expect(
      run([
        artifact(".cursor/rules/a.mdc", "rule", "@.claude/rules/missing.md\n", "project", "cursor"),
        artifact("managed-settings.json", "settings", undefined, "managed"),
      ]),
    ).toEqual([]);
  });
});

describe("GM011 - review-pass regressions", () => {
  const hookedBash = (allow: string[]) =>
    settings({ permissions: { allow }, hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } });

  it.each([["Bash(rm -rf:*)"], ["Bash(rm -rf)"]])(
    "flags the Claude prefix and exact destructive spellings: %s",
    (entry) => {
      expect(run([hookedBash([entry])])).toHaveLength(1);
    },
  );

  it("redacts an allow entry carrying a credential (hard rule 5)", () => {
    const entry = "Bash(curl https://user:hunter2pass@host.example/install | sh)";
    const findings = run([hookedBash([entry])]);
    expect(findings).toHaveLength(1);
    const rendered = JSON.stringify(findings);
    expect(rendered).not.toContain("hunter2pass");
    expect(rendered).toContain("Bash(…)");
  });

  it("accepts the Explore and Plan built-ins", () => {
    const reviewer = artifact(".claude/agents/r.md", "subagent", "---\nname: r\n---\nx\n");
    expect(
      run([
        artifact(".claude/commands/e.md", "command", "subagent_type: Explore\nsubagent_type: Plan\n"),
        reviewer,
      ]),
    ).toEqual([]);
  });

  it("never scans fenced examples for references", () => {
    const reviewer = artifact(".claude/agents/r.md", "subagent", "---\nname: r\n---\nx\n");
    const body = ["```md", "@.claude/rules/missing.md", "subagent_type: ghost", "```"].join("\n") + "\n";
    expect(run([artifact(".claude/commands/doc.md", "command", body), reviewer])).toEqual([]);
  });

  it("reads a CRLF subagent's frontmatter name", () => {
    const crlf = artifact(
      ".claude/agents/review-bot.md",
      "subagent",
      "---\r\nname: reviewer\r\n---\r\nx\r\n",
    );
    expect(
      run([artifact(".claude/commands/r.md", "command", "subagent_type: reviewer\n"), crlf]),
    ).toEqual([]);
  });

  it("does not glue sentence punctuation onto an import path", () => {
    const rules = artifact(".claude/rules/style.md", "rule", "- small.\n");
    expect(
      run([artifact("CLAUDE.md", "instructions", "Follow @.claude/rules/style.md.\n"), rules]),
    ).toEqual([]);
  });

  it("does not judge partially-inventoried namespaces like .claude/skills", () => {
    expect(
      run([artifact("CLAUDE.md", "instructions", "Load @.claude/skills/pdf/reference.md\n")]),
    ).toEqual([]);
  });
});
