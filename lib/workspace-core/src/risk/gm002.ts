import { isRecord, parseJsonc } from "../jsonc.js";
import type { RiskArtifact, RiskRule } from "./risk.js";

/**
 * GM002 - no deny/ask protection for `.env` files in an agent that can
 * express one (pivot §8.1 item 3, §10.5 `deny_read` mapping). Absence rule:
 * fires once per agent present in the repository whose readable config
 * leaves `.env` exposed. Present means a project- or local-scope artifact:
 * a user file or a managed probe says what one machine has installed, so
 * counting it would make the verdict differ between a laptop and CI on the
 * same commit (#493).
 *
 * Protection means a deny/ask rule that actually covers a secret path
 * (`SECRET_PATHS`, from the §10.5 `deny_read` set) under the agent's own
 * matching rules - `Read(**)` protects, `Read(config/**)` does not.
 * - claude-code: an entry in `permissions.deny` or `permissions.ask` of any
 *   settings file that covers the path: a `Read(<pattern>)` rule whose
 *   gitignore-style pattern matches it under Claude's anchors, or a bare
 *   tool name / tool-name glob (`Read`, `*`) that removes the Read tool
 *   altogether (#488).
 * - cursor: a non-empty `hooks.beforeReadFile` list (the hook body is not
 *   inspectable; presence is the best available proxy).
 * - opencode: asks before reading `*.env` / `*.env.*` by default, evaluates
 *   its rules in order with the last match winning and `ask` as the
 *   fallback, and the rules built from `opencode.json` follow those defaults
 *   (anomalyco/opencode `packages/core/src/permission.ts`,
 *   `packages/schema/src/agent.ts`, `packages/core/src/v1/config/migrate.ts`,
 *   read 2026-11-04). Exposed when the last rule matching a secret path is
 *   `allow`, whether it comes from `"permission": "allow"`, a `*` action key
 *   or `permission.read` (#488).
 *
 * Excluded, with reasons: Copilot / VS Code has no hard deny (§10.5
 * coverage annotation); Codex `sandbox_mode` and Antigravity denied-commands
 * are command/sandbox controls, not path-level read denies. A managed
 * settings probe carries no content and never counts as protection, and
 * neither does a user- or local-scope file (`scopes: ["project"]`): a deny
 * on one developer's machine protects no other clone - the repo itself
 * carries no portable rule.
 */
export const gm002: RiskRule = {
  id: "GM002",
  severity: "warning",
  appliesTo: {
    adapters: ["claude-code", "cursor", "opencode"],
    kinds: ["settings", "hooks", "config"],
    scopes: ["project"],
  },
  check: ({ matched, input }) =>
    PROTECTORS.flatMap(({ adapter, kind, message, unprotected }) => {
      if (!input.artifacts.some((artifact) => artifact.adapter === adapter && REPO_SCOPES.has(artifact.scope))) {
        return [];
      }
      const configs = matched.flatMap((artifact) =>
        artifact.adapter === adapter && artifact.kind === kind ? parsed(artifact) : [],
      );
      return unprotected(configs) ? [{ adapter, message }] : [];
    }),
};

/** Scopes that make an agent present: files in the repository working tree, not on the machine. */
const REPO_SCOPES: ReadonlySet<string> = new Set(["project", "local"]);

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
      'permission allows .env reads, overriding OpenCode\'s default ask; remove the allow or add "*.env": "deny" and "*.env.*": "deny" after it under permission.read in opencode.json.',
    unprotected: (configs) => configs.some(opencodeAllowsEnvRead),
  },
];

function parsed(artifact: RiskArtifact): unknown[] {
  return artifact.content === undefined ? [] : [parseJsonc(artifact.content)];
}

/** Paths a read deny must cover; any one covered counts as protection. */
const SECRET_PATHS = [".env", ".env.local"];

/**
 * OpenCode's built-in read rules as [resource pattern, effect], in
 * evaluation order (`Info.default` in anomalyco/opencode `schema/agent.ts`).
 */
const OPENCODE_READ_DEFAULTS: readonly [string, string][] = [
  ["*", "allow"],
  ["*.env", "ask"],
  ["*.env.*", "ask"],
  ["*.env.example", "allow"],
];

function claudeDeniesEnvRead(config: unknown): boolean {
  const permissions = isRecord(config) ? config.permissions : undefined;
  if (!isRecord(permissions)) {
    return false;
  }
  return [permissions.deny, permissions.ask].some(
    (rules) =>
      Array.isArray(rules) &&
      rules.some((rule) => typeof rule === "string" && claudeRuleCoversSecret(rule)),
  );
}

/**
 * True when one Claude Code deny/ask rule covers a secret path. A rule
 * without parentheses names a tool or, in deny/ask, a tool-name glob: `Read`,
 * `*` and `Re*` all remove the Read tool, as `Read(*)` does. A
 * `Read(<pattern>)` rule uses gitignore syntax with four anchors
 * (code.claude.com/docs/en/permissions, "How path patterns match"): `//` the
 * filesystem root, `~/` the home directory, `/` the settings source - the
 * repository root for a project settings file - and no prefix or `./` the
 * current directory. The secret paths are repository-root files, so a
 * `/`-anchored or relative pattern is matched against them directly (a bare
 * filename matches at any depth in gitignore, so `Read(.env)` covers the
 * root file as its `**`-prefixed spelling does), and a pattern anchored
 * outside the repository counts only when it starts with `**` and so covers
 * the file wherever the clone sits: `Read(//**)` followed by `/.env`
 * protects every clone, `Read(//home/alice/repo/.env)` protects one machine
 * - the reasoning that keeps user-scope denies from counting. A `!` carve-out never matches a secret path and is ignored.
 */
function claudeRuleCoversSecret(rule: string): boolean {
  const scoped = /^Read\((.*)\)$/.exec(rule);
  if (scoped === null) {
    return !rule.includes("(") && wildcardMatches(rule, "Read");
  }
  const pattern = scoped[1] ?? "";
  if (pattern.startsWith("//") || pattern.startsWith("~/")) {
    const rest = pattern.slice(2);
    return /^\*\*(\/|$)/.test(rest) && claudePatternCoversSecret(rest);
  }
  return claudePatternCoversSecret(pattern.startsWith("/") ? pattern.slice(1) : pattern);
}

function claudePatternCoversSecret(pattern: string): boolean {
  return SECRET_PATHS.some((path) => globMatches(pattern, path));
}

function cursorHasBeforeReadFile(config: unknown): boolean {
  const hooks = isRecord(config) ? config.hooks : undefined;
  return isRecord(hooks) && Array.isArray(hooks.beforeReadFile) && hooks.beforeReadFile.length > 0;
}

/**
 * True when OpenCode's effective read rules leave a secret path on `allow`.
 * OpenCode matches a read by its project-relative path (`.env` for the root
 * file) against the rules in order, last match wins, `ask` when none
 * matches, and the rules from `permission` follow the defaults. A plain
 * string is `{"*": <effect>}`; each key is an action glob (`*`, `read`)
 * whose value is one effect for every resource or an object of resource
 * pattern -> effect in writing order. So `{"read": {"*.env": "deny"}, "*":
 * "allow"}` ends on allow and `{"read": {"**": "allow", "*.env": "deny"}}`
 * ends on deny.
 */
function opencodeAllowsEnvRead(config: unknown): boolean {
  const permission = isRecord(config) ? config.permission : undefined;
  const rules: [string, unknown][] = [...OPENCODE_READ_DEFAULTS, ...opencodeReadRules(permission)];
  return SECRET_PATHS.some(
    (path) => rules.filter(([pattern]) => wildcardMatches(pattern, path)).at(-1)?.[1] === "allow",
  );
}

/** The read rules `permission` adds, as [resource pattern, effect] in evaluation order. */
function opencodeReadRules(permission: unknown): [string, unknown][] {
  const actions: [string, unknown][] =
    typeof permission === "string" ? [["*", permission]] : isRecord(permission) ? Object.entries(permission) : [];
  return actions.flatMap(([action, rule]): [string, unknown][] => {
    if (!wildcardMatches(action, "read")) {
      return [];
    }
    if (typeof rule === "string") {
      return [["*", rule]];
    }
    return isRecord(rule) ? Object.entries(rule) : [];
  });
}

/**
 * Claude Code path-pattern match: `**` spans directories, `*` and `?` stay
 * within one segment (gitignore), a `./` prefix is dropped. The caller has
 * already resolved the anchor.
 */
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

/**
 * Plain wildcard match: `*` matches any run of characters, `/` included, and
 * `?` one character. Claude Code's tool-name globs and OpenCode's permission
 * patterns (anomalyco/opencode `packages/core/src/util/wildcard.ts`) both
 * work this way.
 */
function wildcardMatches(pattern: string, text: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(text);
}
