import { describe, expect, it } from "vitest";

import { gm003 } from "./gm003.js";
import { runRiskRules, type RiskArtifact } from "./risk.js";

const artifact = (
  adapter: string,
  path: string,
  kind: string,
  content?: string,
  scope: RiskArtifact["scope"] = "project",
): RiskArtifact => ({
  adapter,
  path,
  kind,
  scope,
  ...(content === undefined ? {} : { content }),
});

const run = (artifacts: RiskArtifact[]) => runRiskRules({ artifacts }, [gm003]);

const claude = (settings: string) => artifact("claude-code", ".claude/settings.json", "settings", settings);
const codex = (toml: string) => artifact("codex", ".codex/config.toml", "config", toml);
const copilot = (settings: string) => artifact("copilot", ".vscode/settings.json", "settings", settings);

describe("GM003", () => {
  it("flags a committed bypassPermissions default mode with the file path", () => {
    expect(run([claude('{"permissions": {"defaultMode": "bypassPermissions"}}')])).toEqual([
      expect.objectContaining({
        ruleId: "GM003",
        severity: "error",
        path: ".claude/settings.json",
        message: expect.stringContaining('permissions.defaultMode is "bypassPermissions"'),
      }),
    ]);
  });

  it.each([
    ["acceptEdits", '{"permissions": {"defaultMode": "acceptEdits"}}'],
    ["default", '{"permissions": {"defaultMode": "default"}}'],
    ["plan", '{"permissions": {"defaultMode": "plan"}}'],
    ["no defaultMode", '{"permissions": {"deny": ["Read(**/.env)"]}}'],
    ["non-object permissions", '{"permissions": "bypassPermissions"}'],
    ["top-level key only", '{"defaultMode": "bypassPermissions"}'],
    ["malformed JSON", "not json"],
  ])("stays silent on claude settings with %s", (_name, settings) => {
    expect(run([claude(settings)])).toEqual([]);
  });

  it.each([
    ['sandbox_mode = "danger-full-access"', "kernel sandbox"],
    ["sandbox_mode = 'danger-full-access'", "kernel sandbox"],
    ['sandbox_mode   =   "danger-full-access"  # yolo', "kernel sandbox"],
    ['approval_policy = "never"', "auto-approves every Codex action"],
    ["approval_policy = 'never'  # ship it", "auto-approves every Codex action"],
  ])("flags codex root-table %s", (line, phrase) => {
    expect(run([codex(`model = "o4"\n${line}\n`)])).toEqual([
      expect.objectContaining({ path: ".codex/config.toml", message: expect.stringContaining(phrase) }),
    ]);
  });

  it("reports each codex mode separately", () => {
    const findings = run([codex('approval_policy = "never"\nsandbox_mode = "danger-full-access"\n')]);
    expect(findings.map(({ message }) => message.split(" ")[0])).toEqual([
      "approval_policy",
      "sandbox_mode",
    ]);
  });

  it.each([
    ["safe values", 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n'],
    ["a commented-out mode", '# sandbox_mode = "danger-full-access"\napproval_policy = "untrusted"\n'],
    [
      "modes scoped to a profile",
      'model = "o4"\n\n[profiles.yolo]\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n',
    ],
    ["a mode named in a value", 'notes = "never use danger-full-access"\n'],
  ])("stays silent on codex config with %s", (_name, toml) => {
    expect(run([codex(toml)])).toEqual([]);
  });

  it.each([
    ["chat.tools.global.autoApprove", "true", '{"chat.tools.global.autoApprove": true}'],
    [
      "chat.tools.terminal.autoApprove",
      "an object containing a true",
      '{"chat.tools.terminal.autoApprove": {"npm test": true, "rm -rf *": false}}',
    ],
    ["chat.tools.urls.autoApprove", "true", '{"chat.tools.urls.autoApprove": true}'],
  ])("flags %s set to %s", (key, _shape, settings) => {
    const findings = run([copilot(settings)]);
    expect(findings).toEqual([
      expect.objectContaining({
        path: ".vscode/settings.json",
        message: expect.stringContaining(`${key} is enabled`),
      }),
    ]);
  });

  it("names the key but never a pattern value", () => {
    const [finding] = run([copilot('{"chat.tools.terminal.autoApprove": {"npm test": true}}')]);
    expect(finding?.message).not.toContain("npm test");
  });

  it.each([
    ["explicit false", '{"chat.tools.global.autoApprove": false}'],
    ["an all-false object", '{"chat.tools.terminal.autoApprove": {"rm -rf *": false}}'],
    ["an empty object", '{"chat.tools.urls.autoApprove": {}}'],
    ["no auto-approve key", '{"editor.formatOnSave": true}'],
    ["malformed JSON", "not json"],
  ])("stays silent on vscode settings with %s", (_name, settings) => {
    expect(run([copilot(settings)])).toEqual([]);
  });

  it("reports one finding per enabled key", () => {
    const findings = run([
      copilot(
        '{"chat.tools.global.autoApprove": true, "chat.tools.terminal.autoApprove": {"x": true}, "chat.tools.urls.autoApprove": true}',
      ),
    ]);
    expect(findings).toHaveLength(3);
  });

  it("only inspects committed project scope", () => {
    const bypass = '{"permissions": {"defaultMode": "bypassPermissions"}}';
    expect(
      run([
        artifact("claude-code", ".claude/settings.local.json", "settings", bypass, "local"),
        artifact("codex", "~/.codex/config.toml", "config", 'approval_policy = "never"', "user"),
        artifact("claude-code", "managed-settings.json", "settings", undefined, "managed"),
      ]),
    ).toEqual([]);
  });

  it("ignores adapters without a committed bypass surface", () => {
    expect(
      run([
        artifact("cursor", ".cursor/hooks.json", "hooks", '{"hooks": {}}'),
        artifact("opencode", "opencode.json", "config", '{"permission": {"read": "allow", "bash": "allow"}}'),
        artifact("antigravity", ".gemini/settings.json", "settings", '{"mcpServers": {}}'),
      ]),
    ).toEqual([]);
  });
});
