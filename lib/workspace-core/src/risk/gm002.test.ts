import { describe, expect, it } from "vitest";

import { gm002 } from "./gm002.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (adapter: string, path: string, kind: string, content?: string): RiskArtifact => ({
  adapter,
  path,
  kind,
  scope: "project",
  ...(content === undefined ? {} : { content }),
});

const adaptersFlagged = (artifacts: RiskArtifact[]) =>
  runRiskRules({ artifacts }, [gm002]).map((finding) => finding.adapter);

const claude = (settings: string) => artifact("claude-code", ".claude/settings.json", "settings", settings);
const cursor = (hooks: string) => artifact("cursor", ".cursor/hooks.json", "hooks", hooks);
const opencode = (config: string) => artifact("opencode", "opencode.json", "config", config);

describe("GM002", () => {
  it("reports nothing when no supporting agent is present", () => {
    expect(adaptersFlagged([])).toEqual([]);
    expect(
      adaptersFlagged([
        artifact("copilot", ".vscode/settings.json", "settings", "{}"),
        artifact("codex", ".codex/config.toml", "config", 'sandbox_mode = "read-only"'),
      ]),
    ).toEqual([]);
  });

  it("emits one path-less finding per unprotected agent", () => {
    const findings = runRiskRules(
      {
        artifacts: [
          claude('{"permissions": {"deny": ["Bash(rm -rf *)"]}}'),
          cursor('{"hooks": {"preToolUse": [{"command": "x"}]}}'),
          opencode('{"permission": {"read": "allow"}}'),
        ],
      },
      [gm002],
    );
    expect(findings.map(({ adapter, path }) => [adapter, path])).toEqual([
      ["claude-code", undefined],
      ["cursor", undefined],
      ["opencode", undefined],
    ]);
  });

  it.each([
    '{"permissions": {"deny": ["Read(.env)"]}}',
    '{"permissions": {"deny": ["Read(./.env)"]}}',
    '{"permissions": {"deny": ["Read(**/.env.*)"]}}',
    '{"permissions": {"ask": ["Read(.env*)"]}}',
  ])("treats claude-code as protected by %s", (settings) => {
    expect(adaptersFlagged([claude(settings)])).toEqual([]);
  });

  it.each([
    '{"permissions": {"deny": ["Read(**/*.pem)"]}}',
    '{"permissions": {"allow": ["Read(.env)"]}}',
    "{}",
    "not json",
  ])("treats claude-code as unprotected by %s", (settings) => {
    expect(adaptersFlagged([claude(settings)])).toEqual(["claude-code"]);
  });

  it("counts protection from any settings file of the agent", () => {
    expect(
      adaptersFlagged([
        claude("{}"),
        artifact("claude-code", ".claude/settings.local.json", "settings", '{"permissions": {"deny": ["Read(.env)"]}}'),
      ]),
    ).toEqual([]);
  });

  it("fires for claude-code present only through a content-less managed probe", () => {
    expect(adaptersFlagged([artifact("claude-code", "managed-settings.json", "settings")])).toEqual([
      "claude-code",
    ]);
  });

  it("requires a non-empty beforeReadFile hook list for cursor", () => {
    expect(adaptersFlagged([cursor('{"hooks": {"beforeReadFile": [{"command": "./guard.sh"}]}}')])).toEqual([]);
    expect(adaptersFlagged([cursor('{"hooks": {"beforeReadFile": []}}')])).toEqual(["cursor"]);
    expect(adaptersFlagged([artifact("cursor", ".cursor/mcp.json", "mcp-config", "{}")])).toEqual(["cursor"]);
  });

  it("treats opencode as protected by default and unprotected only on an explicit allow", () => {
    expect(adaptersFlagged([artifact("opencode", "AGENTS.md", "instructions", "# x")])).toEqual([]);
    expect(adaptersFlagged([opencode('{"permission": {"edit": "ask"}}')])).toEqual([]);
    expect(adaptersFlagged([opencode('{"permission": {"read": {"*": "allow", "*.env.example": "allow"}}}')])).toEqual([]);
    expect(adaptersFlagged([opencode("not json")])).toEqual([]);
    expect(adaptersFlagged([opencode('{"permission": {"read": "allow"}}')])).toEqual(["opencode"]);
    expect(adaptersFlagged([opencode('{"permission": {"read": {"*.env": "allow"}}}')])).toEqual(["opencode"]);
  });
});
