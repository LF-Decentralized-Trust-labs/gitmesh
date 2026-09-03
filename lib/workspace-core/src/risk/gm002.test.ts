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
    '{"permissions": {"deny": ["Read(*.env)"]}}',
    '{"permissions": {"deny": ["Read(**)"]}}',
    '{"permissions": {"ask": ["Read(.env*)"]}}',
  ])("treats claude-code as protected by %s", (settings) => {
    expect(adaptersFlagged([claude(settings)])).toEqual([]);
  });

  it.each([
    '{"permissions": {"deny": ["Read(**/*.pem)"]}}',
    '{"permissions": {"deny": ["Read(config/**)"]}}',
    '{"permissions": {"deny": ["Read(.env.example)"]}}',
    '{"permissions": {"deny": ["Read(.environment)"]}}',
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

  it("treats opencode as protected by default and unprotected when a secret path resolves to allow", () => {
    for (const config of [
      '{"permission": {"edit": "ask"}}',
      '{"permission": {"read": "deny"}}',
      '{"permission": {"read": {"*": "allow", "*.env.example": "allow"}}}',
      '{"permission": {"read": {"*": "deny"}}}',
      "not json",
    ]) {
      expect(adaptersFlagged([opencode(config)])).toEqual([]);
    }
    expect(adaptersFlagged([artifact("opencode", "AGENTS.md", "instructions", "# x")])).toEqual([]);
    for (const config of [
      '{"permission": {"read": "allow"}}',
      '{"permission": {"read": {"*.env": "allow"}}}',
      '{"permission": {"read": {"**/.env": "allow"}}}',
      '{"permission": {"read": {"*.env.*": "allow"}}}',
    ]) {
      expect(adaptersFlagged([opencode(config)])).toEqual(["opencode"]);
    }
  });
});

describe("GM002 - protection must be committed project scope", () => {
  it("a user-scope deny does not protect the repo's other clones", () => {
    expect(
      adaptersFlagged([
        claude("{}"),
        {
          adapter: "claude-code",
          path: "~/.claude/settings.json",
          kind: "settings",
          scope: "user",
          content: '{"permissions": {"deny": ["Read(**/.env)"]}}',
        },
      ]),
    ).toEqual(["claude-code"]);
  });
});
