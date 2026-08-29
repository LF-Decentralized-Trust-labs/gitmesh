import { parseJsonc } from "../jsonc.js";
import type { RiskArtifact, RiskRule } from "./risk.js";

/**
 * GM002 - no deny/ask protection for `.env` files in an agent that can
 * express one (pivot §8.1 item 3, §10.5 `deny_read` mapping). Absence rule:
 * fires once per agent present in the inventory whose readable config
 * leaves `.env` exposed.
 *
 * Agents that can express a read deny, and what counts as protection:
 * - claude-code: a `Read(<glob>)` entry naming `.env` in `permissions.deny`
 *   or `permissions.ask` of any settings file.
 * - cursor: a non-empty `hooks.beforeReadFile` list (the hook body is not
 *   inspectable; presence is the best available proxy).
 * - opencode: denies `*.env` / `*.env.*` reads by default, so only a config
 *   that sets `permission.read` to `"allow"` or maps a `.env` pattern to
 *   `"allow"` is unprotected. The docs do not state how a user value merges
 *   with that default (verified 2026-08-29), so only explicit allows count.
 *
 * Excluded, with reasons: Copilot / VS Code has no hard deny (§10.5
 * coverage annotation); Codex `sandbox_mode` and Antigravity denied-commands
 * are command/sandbox controls, not path-level read denies. A managed
 * settings probe carries no content and never counts as protection: the
 * repo itself carries no portable rule.
 */
export const gm002: RiskRule = {
  id: "GM002",
  severity: "warning",
  appliesTo: { adapters: ["claude-code", "cursor", "opencode"], kinds: ["settings", "hooks", "config"] },
  check: ({ matched, input }) =>
    PROTECTORS.flatMap(({ adapter, kind, message, unprotected }) => {
      if (!input.artifacts.some((artifact) => artifact.adapter === adapter)) {
        return [];
      }
      const configs = matched.flatMap((artifact) =>
        artifact.adapter === adapter && artifact.kind === kind ? parsed(artifact) : [],
      );
      return unprotected(configs) ? [{ adapter, message }] : [];
    }),
};

interface Protector {
  adapter: string;
  kind: string;
  message: string;
  /** True when the parsed configs of this adapter leave `.env` readable. */
  unprotected(configs: readonly unknown[]): boolean;
}

const PROTECTORS: readonly Protector[] = [
  {
    adapter: "claude-code",
    kind: "settings",
    message:
      'No deny/ask rule protects .env files; add "Read(**/.env)" and "Read(**/.env.*)" to permissions.deny in .claude/settings.json.',
    unprotected: (configs) => !configs.some(claudeDeniesEnvRead),
  },
  {
    adapter: "cursor",
    kind: "hooks",
    message:
      "No beforeReadFile hook guards secret files; add one to .cursor/hooks.json that blocks .env reads.",
    unprotected: (configs) => !configs.some(cursorHasBeforeReadFile),
  },
  {
    adapter: "opencode",
    kind: "config",
    message:
      'permission.read allows .env files, overriding OpenCode\'s default deny; remove the allow or set "*.env" and "*.env.*" back to "deny" in opencode.json.',
    unprotected: (configs) => configs.some(opencodeAllowsEnvRead),
  },
];

function parsed(artifact: RiskArtifact): unknown[] {
  return artifact.content === undefined ? [] : [parseJsonc(artifact.content)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function claudeDeniesEnvRead(config: unknown): boolean {
  const permissions = isRecord(config) ? config.permissions : undefined;
  if (!isRecord(permissions)) {
    return false;
  }
  return [permissions.deny, permissions.ask].some(
    (rules) =>
      Array.isArray(rules) &&
      rules.some((rule) => typeof rule === "string" && /^Read\(.*\.env.*\)$/.test(rule)),
  );
}

function cursorHasBeforeReadFile(config: unknown): boolean {
  const hooks = isRecord(config) ? config.hooks : undefined;
  return isRecord(hooks) && Array.isArray(hooks.beforeReadFile) && hooks.beforeReadFile.length > 0;
}

function opencodeAllowsEnvRead(config: unknown): boolean {
  const permission = isRecord(config) ? config.permission : undefined;
  const read = isRecord(permission) ? permission.read : undefined;
  return (
    read === "allow" ||
    (isRecord(read) &&
      Object.entries(read).some(
        ([pattern, action]) =>
          pattern.includes(".env") && !pattern.includes(".env.example") && action === "allow",
      ))
  );
}
