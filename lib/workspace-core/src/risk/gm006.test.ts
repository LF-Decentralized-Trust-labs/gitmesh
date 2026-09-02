import { describe, expect, it } from "vitest";

import { gm006 } from "./gm006.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  path: string,
  content?: string,
  adapter = "claude-code",
  kind = "instructions",
): RiskArtifact => ({
  adapter,
  path,
  kind,
  scope: "project",
  ...(content === undefined ? {} : { content }),
});

const run = (artifacts: RiskArtifact[]) => runRiskRules({ artifacts }, [gm006]);

const md = (...lines: string[]) => lines.join("\n") + "\n";

describe("GM006 - balanced markers", () => {
  it("stays silent on a balanced pair, attributes allowed on the opener", () => {
    expect(
      run([
        artifact(
          "CLAUDE.md",
          md("# Project", "", "<!-- gitmesh:managed adapter=claude-code -->", "- rule", "<!-- /gitmesh:managed -->"),
        ),
      ]),
    ).toEqual([]);
  });

  it("stays silent on files without markers, JSON content and content-less probes", () => {
    expect(
      run([
        artifact("CLAUDE.md", md("# Project", "", "plain instructions")),
        artifact(".claude/settings.json", '{"permissions": {}}', "claude-code", "settings"),
        artifact("managed-settings.json", undefined, "claude-code", "settings"),
      ]),
    ).toEqual([]);
  });

  it("accepts CRLF line endings", () => {
    expect(
      run([artifact("CLAUDE.md", "<!-- gitmesh:managed -->\r\n- rule\r\n<!-- /gitmesh:managed -->\r\n")]),
    ).toEqual([]);
  });
});

describe("GM006 - violations", () => {
  it("flags a region never closed, naming the opening line", () => {
    expect(
      run([artifact("CLAUDE.md", md("# Project", "", "<!-- gitmesh:managed -->", "- rule"))]),
    ).toEqual([
      expect.objectContaining({
        ruleId: "GM006",
        severity: "warning",
        path: "CLAUDE.md",
        message: expect.stringContaining("opened on line 3 of CLAUDE.md is never closed"),
      }),
    ]);
  });

  it("flags a closing marker with no open region", () => {
    expect(run([artifact("AGENTS.md", md("# Agents", "<!-- /gitmesh:managed -->"))])).toEqual([
      expect.objectContaining({
        path: "AGENTS.md",
        message: expect.stringContaining("on line 2 of AGENTS.md matches no open region"),
      }),
    ]);
  });

  it("flags a nested opener, naming both lines, and still closes the region", () => {
    const findings = run([
      artifact(
        "CLAUDE.md",
        md(
          "<!-- gitmesh:managed -->",
          "<!-- gitmesh:managed adapter=claude-code -->",
          "- rule",
          "<!-- /gitmesh:managed -->",
        ),
      ),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("line 2 of CLAUDE.md opens inside the region opened on line 1"),
      }),
    ]);
  });

  it.each([
    ["deleted arrow", "<!-- gitmesh:managed"],
    ["trailing text", "<!-- gitmesh:managed --> extra"],
    ["damaged close", "<!-- /gitmesh:managed -- >"],
  ])("flags a damaged marker line: %s", (_name, line) => {
    const findings = run([artifact("CLAUDE.md", md("# Project", line))]);
    expect(findings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Damaged gitmesh:managed marker on line 2"),
      }),
    ]);
  });

  it("reports each violation in a file", () => {
    const findings = run([
      artifact(
        "CLAUDE.md",
        md("<!-- /gitmesh:managed -->", "", "<!-- gitmesh:managed -->", "- rule"),
      ),
    ]);
    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining("line 1 of CLAUDE.md matches no open region"),
      expect.stringContaining("opened on line 3 of CLAUDE.md is never closed"),
    ]);
  });

  it("reports a file inventoried by several adapters once (no adapter on findings)", () => {
    const content = md("<!-- /gitmesh:managed -->");
    const findings = run([
      artifact("AGENTS.md", content, "codex"),
      artifact("AGENTS.md", content, "cursor"),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.adapter).toBeUndefined();
  });
});

describe("GM006 - fences and prose", () => {
  it("ignores markers inside fenced code blocks (docs about gitmesh)", () => {
    expect(
      run([
        artifact(
          "AGENTS.md",
          md("# Docs", "", "```md", "<!-- gitmesh:managed -->", "```", "", "~~~", "<!-- /gitmesh:managed -->", "~~~"),
        ),
      ]),
    ).toEqual([]);
  });

  it("honors the fence close-length rule: a shorter run does not close", () => {
    expect(
      run([
        artifact(
          "AGENTS.md",
          md("````", "```", "<!-- /gitmesh:managed -->", "````"),
        ),
      ]),
    ).toEqual([]);
  });

  it("ignores an inline-code mention that does not start the line", () => {
    expect(
      run([artifact("AGENTS.md", md("Write docs about `<!-- gitmesh:managed -->` markers."))]),
    ).toEqual([]);
  });
});
