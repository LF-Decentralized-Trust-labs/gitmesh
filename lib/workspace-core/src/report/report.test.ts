import { describe, expect, it } from "vitest";

import { computeDriftReport } from "../drift/index.js";
import type { RiskFinding } from "../risk/index.js";
import { summarizeDoctorReport, type DoctorArtifact, type DoctorReport } from "./report.js";
import { renderDoctorTty } from "./tty.js";
import { renderDoctorJson } from "./json.js";
import { renderDoctorMarkdown } from "./markdown.js";

/** A value that must never appear in any output mode (hard rule 5). */
const SECRET = "ghp_FAKE0123456789abcdefghijklmnopqrstu";

const AGENTS_MD = `# Project rules

Use pnpm for all installs.

- Run tests before every commit.
- Sign off commits with -s.
`;
const GEMINI_MD = `# Project rules

- Run tests before every commit.
- Sign off commits with -s.

Use pnpm for all installs.

Prefer tabs over spaces.
`;
const STYLE_MDC = `---
description: Style rules
globs: "**/*.ts"
---
Never commit secrets | tokens.

Use pnpm for all installs.
`;

const artifact = (
  adapter: string,
  path: string,
  kind: string,
  extra: Partial<DoctorArtifact> = {},
): DoctorArtifact => ({ adapter, path, kind, scope: "project", ...extra });

/** Kitchen sink: six adapters, a symlink, a broken link, a manager, drift, every severity. */
const REPORT: DoctorReport = {
  artifacts: [
    artifact("codex", "AGENTS.md", "instructions", { content: AGENTS_MD }),
    artifact("claude-code", "CLAUDE.md", "instructions", { symlinkTarget: "AGENTS.md" }),
    artifact("claude-code", ".mcp.json", "mcp-config", {
      content: `{"mcpServers":{"github":{"env":{"GITHUB_TOKEN":"${SECRET}"}}}}`,
    }),
    artifact("claude-code", ".claude/settings.json", "settings"),
    artifact("claude-code", "~/.claude/CLAUDE.md", "instructions", { scope: "user" }),
    artifact("cursor", ".cursor/rules/style.mdc", "rule", { content: STYLE_MDC }),
    artifact("antigravity", "GEMINI.md", "instructions", { content: GEMINI_MD }),
    artifact("roo", ".roo/rules/old.md", "rule", { symlinkTarget: "../missing.md", broken: true }),
    artifact("third-party-managers", ".ruler/ruler.toml", "config", { manager: "ruler" }),
  ],
  drift: computeDriftReport([
    { path: "AGENTS.md", content: AGENTS_MD, logicalPath: "/repo/AGENTS.md" },
    { path: "CLAUDE.md", content: AGENTS_MD, logicalPath: "/repo/AGENTS.md" },
    { path: "GEMINI.md", content: GEMINI_MD },
    { path: ".cursor/rules/style.mdc", content: STYLE_MDC },
  ]),
  findings: [
    {
      ruleId: "GM001",
      severity: "error",
      message: "MCP server github sets GITHUB_TOKEN to a plaintext value (redacted)",
      path: ".mcp.json",
      adapter: "claude-code",
    },
    { ruleId: "GM002", severity: "warning", message: "No agent denies reads of .env files" },
    {
      ruleId: "GM008",
      severity: "info",
      message: "roo config present but no roo activity in history",
      adapter: "roo",
    },
    {
      ruleId: "GM010",
      severity: "warning",
      message: "CLAUDE.md is not bridged to AGENTS.md | add an @AGENTS.md shim",
      path: "CLAUDE.md",
    },
  ],
};

const EMPTY: DoctorReport = { artifacts: [], drift: computeDriftReport([]), findings: [] };

const RENDERERS = {
  tty: (report: DoctorReport) => renderDoctorTty(report, { color: true }),
  json: renderDoctorJson,
  md: renderDoctorMarkdown,
};

describe("doctor renderers - snapshots", () => {
  it("renders the TTY report (grouped, colored, scored)", async () => {
    await expect(RENDERERS.tty(REPORT)).toMatchFileSnapshot("./__snapshots__/doctor.tty.txt");
  });

  it("renders the --json report (schema v1)", async () => {
    await expect(RENDERERS.json(REPORT)).toMatchFileSnapshot("./__snapshots__/doctor.json");
  });

  it("renders the --md report", async () => {
    await expect(RENDERERS.md(REPORT)).toMatchFileSnapshot("./__snapshots__/doctor.md");
  });
});

describe("doctor renderers - guarantees", () => {
  it.each(Object.entries(RENDERERS))("%s never emits artifact content", (_name, render) => {
    expect(render(REPORT)).not.toContain(SECRET);
    expect(render(REPORT)).not.toContain("ghp_");
  });

  it("colors only decorate: plain output is the colored output without escapes", () => {
    const ESC = String.fromCharCode(27);
    const colored = renderDoctorTty(REPORT, { color: true });
    expect(colored).toContain(`${ESC}[31m`);
    expect(colored.replace(new RegExp(`${ESC}\\[\\d+m`, "g"), "")).toBe(renderDoctorTty(REPORT));
  });

  it("scores 100 minus 20/error, 5/warning, 5/divergent pair; info is free; clamped at 0", () => {
    expect(summarizeDoctorReport(REPORT)).toEqual({
      score: 100 - 20 - 10 - 15,
      artifacts: 9,
      adapters: 6,
      findings: { error: 1, warning: 2, info: 1 },
      driftingPairs: 3,
    });
    const errors: RiskFinding[] = Array.from({ length: 6 }, (_, i) => ({
      ruleId: "GM003",
      severity: "error",
      message: `bypass ${i}`,
    }));
    expect(summarizeDoctorReport({ ...EMPTY, findings: errors }).score).toBe(0);
    expect(summarizeDoctorReport(EMPTY).score).toBe(100);
  });

  it("renders an empty workspace in every mode", () => {
    expect(renderDoctorTty(EMPTY)).toContain("no agent artifacts found");
    expect(renderDoctorTty(EMPTY)).toContain("no findings");
    expect(renderDoctorMarkdown(EMPTY)).toContain("No findings.");
    expect(JSON.parse(renderDoctorJson(EMPTY))).toMatchObject({
      schemaVersion: 1,
      summary: { score: 100 },
    });
  });

  it("is deterministic and ends with a single newline in every mode", () => {
    for (const render of Object.values(RENDERERS)) {
      const output = render(REPORT);
      expect(render(REPORT)).toBe(output);
      expect(output.endsWith("\n")).toBe(true);
      expect(output.endsWith("\n\n")).toBe(false);
    }
  });
});
