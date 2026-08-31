import { isRecord, parseJsonc } from "../jsonc.js";
import type { RiskRule, RuleFinding } from "./risk.js";

/**
 * GM003 - bypass-permissions / auto-approve / danger-full-access modes in
 * committed config (pivot §8.1 item 3; the detection half of §10.5
 * `forbid_bypass_modes`). Unlike GM002's missing-protection warning, a hit
 * here is an exact key/value match that actively disables an agent's own
 * approval guardrails for everyone who clones the repo - hence `error`,
 * GM001's tier.
 *
 * Committed config only (`scopes: ["project"]`): `settings.local.json` is
 * gitignored by convention (local-vs-shared hygiene is GM009's lane), user
 * scope is personal machine state, and a managed probe carries no content
 * and is the org's deliberate channel.
 *
 * Surfaces (§4.3):
 * - claude-code: `permissions.defaultMode` set to `"bypassPermissions"` in
 *   a committed settings file.
 * - codex: `sandbox_mode = "danger-full-access"` or
 *   `approval_policy = "never"` in `.codex/config.toml`, root-table lines
 *   only - a mode inside `[profiles.x]` is inert until that profile is
 *   selected. Line scan over the TOML, GM001 precedent (core carries no
 *   TOML parser).
 * - copilot / VS Code: any of the three `chat.tools.*.autoApprove` keys the
 *   T1.4 detector recognizes (flat dotted keys, matching VS Code and the
 *   detector) set to `true` or to an object containing a `true` value.
 *   Explicit `false` and all-false objects are protective; findings name
 *   the file and key, never pattern values (T1.4 rule).
 *
 * Excluded, with reasons: cursor (no committed yolo/auto-run config file -
 * its committed surface, hooks and rules, only adds guardrails); opencode
 * (`opencode.json` `permission` entries are granular per-pattern grants,
 * not a mode switch, and a blanket read allow is GM002's finding -
 * maintainer decision, 2026-08-31); antigravity (its enforcement surface is
 * the user-scope antigravity-cli settings, inventoried as a content-less
 * managed probe); devin/windsurf and kin (no approval-mode surface, §4.3).
 */
export const gm003: RiskRule = {
  id: "GM003",
  severity: "error",
  appliesTo: {
    adapters: ["claude-code", "codex", "copilot"],
    kinds: ["settings", "config"],
    scopes: ["project"],
  },
  check: ({ matched }) =>
    matched.flatMap(({ adapter, path, content }) =>
      content === undefined ? [] : (CHECKS[adapter]?.(path, content) ?? []),
    ),
};

const CHECKS: Record<string, (path: string, content: string) => RuleFinding[]> = {
  "claude-code": (path, content) => {
    const config = parseJsonc(content);
    const permissions = isRecord(config) ? config.permissions : undefined;
    return isRecord(permissions) && permissions.defaultMode === "bypassPermissions"
      ? [
          {
            path,
            message: `permissions.defaultMode is "bypassPermissions" in ${path}, disabling permission prompts for everyone using this repo; remove it or use "acceptEdits".`,
          },
        ]
      : [];
  },
  codex: (path, content) => {
    const lines = codexRootLines(content);
    return CODEX_MODES.flatMap(({ pattern, message }) =>
      lines.some((line) => pattern.test(line)) ? [{ path, message: message(path) }] : [],
    );
  },
  copilot: (path, content) => {
    const config = parseJsonc(content);
    if (!isRecord(config)) {
      return [];
    }
    return AUTO_APPROVE_KEYS.flatMap((key) => {
      const value = config[key];
      const enabled = value === true || (isRecord(value) && Object.values(value).some((v) => v === true));
      return enabled
        ? [
            {
              path,
              message: `${key} is enabled in ${path}, auto-approving Copilot tool use; remove the key or set it to false.`,
            },
          ]
        : [];
    });
  },
};

/** The two Codex committed modes that drop its approval/sandbox floor. */
const CODEX_MODES: readonly { pattern: RegExp; message: (path: string) => string }[] = [
  {
    pattern: /^sandbox_mode\s*=\s*(?:"danger-full-access"|'danger-full-access')\s*(?:#.*)?$/,
    message: (path) =>
      `sandbox_mode = "danger-full-access" in ${path} removes the Codex kernel sandbox once the project is trusted; use "workspace-write" or "read-only".`,
  },
  {
    pattern: /^approval_policy\s*=\s*(?:"never"|'never')\s*(?:#.*)?$/,
    message: (path) =>
      `approval_policy = "never" in ${path} auto-approves every Codex action; use "on-request" or "untrusted".`,
  },
];

/**
 * The trimmed root-table lines of a TOML document: everything before the
 * first `[table]` header, comment lines dropped.
 */
function codexRootLines(content: string): string[] {
  const lines: string[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      break;
    }
    if (!line.startsWith("#")) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * The VS Code blanket-approval keys, mirroring the copilot detector's
 * `AUTO_APPROVE_KEYS` (T1.4; flat dotted keys, the form VS Code writes).
 */
const AUTO_APPROVE_KEYS = [
  "chat.tools.global.autoApprove",
  "chat.tools.terminal.autoApprove",
  "chat.tools.urls.autoApprove",
] as const;
