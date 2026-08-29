import { parseJsonc } from "../jsonc.js";
import type { RiskArtifact, RiskRule } from "./risk.js";

/**
 * GM002 - no deny/ask protection for `.env` files in an agent that can
 * express one (pivot §8.1 item 3, §10.5 `deny_read` mapping). Absence rule:
 * fires once per agent present in the inventory whose readable config
 * leaves `.env` exposed.
 *
 * Protection means a deny/ask pattern that actually matches a secret path
 * (`SECRET_PATHS`, from the §10.5 `deny_read` set) under the agent's own
 * glob semantics - `Read(**)` protects, `Read(config/**)` does not.
 * - claude-code: a `Read(<glob>)` entry in `permissions.deny` or
 *   `permissions.ask` of any settings file.
 * - cursor: a non-empty `hooks.beforeReadFile` list (the hook body is not
 *   inspectable; presence is the best available proxy).
 * - opencode: denies `*.env` / `*.env.*` reads by default (last matching
 *   rule wins), so it is unprotected only when the config's `permission.read`
 *   makes a secret path resolve to `"allow"`. The docs do not state how a
 *   user value merges with the default (verified 2026-08-29); the user's
 *   object is assumed to override default keys in place and append new ones.
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

/** Paths a read deny must cover; any one covered counts as protection. */
const SECRET_PATHS = [".env", ".env.local"];

/** OpenCode's built-in `permission.read` rules (opencode.ai/docs/permissions). */
const OPENCODE_READ_DEFAULTS: Record<string, unknown> = {
  "*": "allow",
  "*.env": "deny",
  "*.env.*": "deny",
  "*.env.example": "allow",
};

function claudeDeniesEnvRead(config: unknown): boolean {
  const permissions = isRecord(config) ? config.permissions : undefined;
  if (!isRecord(permissions)) {
    return false;
  }
  return [permissions.deny, permissions.ask].some(
    (rules) =>
      Array.isArray(rules) &&
      rules.some((rule) => {
        const glob = typeof rule === "string" ? /^Read\((.*)\)$/.exec(rule)?.[1] : undefined;
        return glob !== undefined && SECRET_PATHS.some((path) => globMatches(glob, path));
      }),
  );
}

function cursorHasBeforeReadFile(config: unknown): boolean {
  const hooks = isRecord(config) ? config.hooks : undefined;
  return isRecord(hooks) && Array.isArray(hooks.beforeReadFile) && hooks.beforeReadFile.length > 0;
}

function opencodeAllowsEnvRead(config: unknown): boolean {
  const permission = isRecord(config) ? config.permission : undefined;
  const read = isRecord(permission) ? permission.read : undefined;
  if (!isRecord(read)) {
    return read === "allow";
  }
  const rules = Object.entries({ ...OPENCODE_READ_DEFAULTS, ...read });
  return SECRET_PATHS.some(
    (path) => rules.filter(([glob]) => globMatches(glob, path)).at(-1)?.[1] === "allow",
  );
}

/** Minimal glob match: `**` spans directories, `*`/`?` stay in a segment, a `./` prefix is dropped. */
function globMatches(glob: string, path: string): boolean {
  const source = glob
    .replace(/^\.\//, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${source}$`).test(path);
}
