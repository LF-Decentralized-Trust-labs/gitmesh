import { isRecord, parseJsonc } from "../jsonc.js";
import { unfencedLines } from "../normalizer/grammar.js";
import { scanForSecrets } from "./gm001.js";
import type { RiskArtifact, RuleContext, RuleFinding, RiskRule } from "./risk.js";

/**
 * GM011 - semantic contradictions across a single tool's own config
 * (pivot §8.1 item 3): the claude-config-doctor pattern, adopted per §4.6
 * and required by T1.11–T1.15 to cover allow-vs-hook contradictions plus
 * dangling references. Warning tier: a contradiction breaks the config's
 * intent, it grants nothing by itself.
 *
 * Four checks, all on claude-code artifacts - deliberately: Claude Code is
 * the one §4.3 surface whose committed config carries permissions, hooks,
 * imports, commands and subagents together, so it is where these
 * contradictions can exist and where the pattern was proven. The rule is
 * table-shaped like GM003; §501's "cross-tool" generalization waits on
 * verified reference syntaxes for the other adapters (format-canary lane,
 * maintainer-flagged) - inventing them would violate the no-improvise
 * rule.
 *
 * 1. Dead allow: the same entry in `permissions.allow` and
 *    `permissions.deny` (deny wins) or `permissions.ask` (ask wins) of one
 *    settings file - exact string match; glob-cover analysis across
 *    different patterns would guess at tool-specific matching semantics.
 * 2. Allow-vs-hook: an allow entry whose command matches the §10.5
 *    `gate-destructive` set (`rm -rf`, `git push --force`, `curl … |`,
 *    in exact, prefix-`:*` and argument forms) while a PreToolUse hook in
 *    the same settings file matches that tool (an absent/empty/`*` matcher
 *    matches every tool) - the literal claude-config-doctor finding: the
 *    allow pre-approves what the hook exists to gate, and hooks run
 *    regardless of allows. Only destructive-pattern allows fire: any
 *    allow-plus-any-hook would flag every logging hook in existence.
 * 3. Dangling `@` import: an instruction/rule/command/subagent body
 *    importing an `@.claude/{rules,commands,agents}/**.md` path absent
 *    from the inventory. Only those trees are checked: the detector
 *    inventories their `*.md` files completely, so absence is decidable -
 *    an `@README.md` or `@.claude/skills/x/reference.md` import points
 *    outside the inventoried namespace and is not judged. The token match
 *    is `.md`-anchored, so sentence punctuation after a path never joins
 *    it.
 * 4. Dangling agent reference: a command/instruction body naming a
 *    `subagent_type` that is neither an inventoried `.claude/agents/`
 *    subagent (frontmatter `name:`, else file basename; CRLF tolerated)
 *    nor a long-stable built-in. Checked only when the repo inventories at
 *    least one subagent: a repo with none plausibly relies on user-scope
 *    or plugin agents the doctor cannot see.
 *
 * Both reference scans run on unfenced lines only (shared §10.4 fence
 * rules): a fenced example documenting the syntax never counts, the GM006
 * precedent. Project + local scopes; managed probes carry no content and
 * user scope is machine state. Quoted allow entries pass through GM001's
 * secret scanner first and are redacted to `Tool(…)` on any hit (hard
 * rule 5): a `curl -H "Authorization: Bearer …"` allow must not reproduce
 * its token in a finding.
 */
export const gm011: RiskRule = {
  id: "GM011",
  severity: "warning",
  appliesTo: {
    adapters: ["claude-code"],
    kinds: ["settings", "instructions", "rule", "command", "subagent"],
    scopes: ["project", "local"],
  },
  check: (context) => [
    ...permissionContradictions(context),
    ...danglingReferences(context),
  ],
};

function permissionContradictions({ matched }: RuleContext): RuleFinding[] {
  return matched.flatMap(({ kind, path, content }) => {
    if (kind !== "settings" || content === undefined) {
      return [];
    }
    const config = parseJsonc(content);
    if (!isRecord(config)) {
      return [];
    }
    const permissions = config["permissions"];
    if (!isRecord(permissions)) {
      return [];
    }
    const allow = stringList(permissions["allow"]);
    const findings: RuleFinding[] = [];

    for (const [side, verdict] of [
      ["deny", "deny wins, so the allow is dead"],
      ["ask", "ask wins, so the allow never auto-approves"],
    ] as const) {
      const entries = new Set(stringList(permissions[side]));
      for (const entry of allow) {
        if (entries.has(entry)) {
          findings.push({
            path,
            message: `"${displayEntry(entry)}" appears in both permissions.allow and permissions.${side} in ${path}; ${verdict} - remove one side.`,
          });
        }
      }
    }

    const matchers = preToolUseMatchers(config["hooks"]);
    for (const entry of allow) {
      const parsed = /^([A-Za-z]\w*)\((.*)\)$/.exec(entry);
      const tool = parsed?.[1];
      const spec = parsed?.[2] ?? "";
      if (
        tool !== undefined &&
        DESTRUCTIVE_RES.some((re) => re.test(spec.trim())) &&
        matchers.some((matcher) => matcherCovers(matcher, tool))
      ) {
        findings.push({
          path,
          message: `"${displayEntry(entry)}" in permissions.allow pre-approves a destructive command while a PreToolUse hook matches ${tool} in ${path}; hooks run regardless of allows - drop the allow or align it with the hook.`,
        });
      }
    }
    return findings;
  });
}

/**
 * The §10.5 `gate-destructive` command shapes; each accepts whitespace, a
 * Claude prefix-form `:` or end-of-spec after the anchor (`rm -rf:*` and
 * exact `rm -rf` are the documented allow spellings).
 */
const DESTRUCTIVE_RES: readonly RegExp[] = [
  /^rm\s+-[a-z]*f[a-z]*(?:[\s:]|$)/i,
  /^git\s+push\s+.*--force/i,
  /^curl\b.*\|/i,
];

/** A quoted entry for a finding message, redacted on any GM001 secret hit. */
function displayEntry(entry: string): string {
  if (scanForSecrets(entry).length === 0) {
    return entry;
  }
  const tool = /^([A-Za-z]\w*)\(/.exec(entry)?.[1];
  return tool === undefined ? "[redacted]" : `${tool}(…)`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** The `matcher` of every PreToolUse hook entry; absent matchers included as "". */
function preToolUseMatchers(hooks: unknown): string[] {
  const entries = isRecord(hooks) ? hooks["PreToolUse"] : undefined;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) =>
    isRecord(entry) ? [typeof entry["matcher"] === "string" ? entry["matcher"] : ""] : [],
  );
}

/** True when a PreToolUse matcher covers `tool` (regex, else literal; ""/"*" cover all). */
function matcherCovers(matcher: string, tool: string): boolean {
  if (matcher === "" || matcher === "*") {
    return true;
  }
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool);
  } catch {
    return matcher === tool;
  }
}

/**
 * `@.claude/{rules,commands,agents}/**.md` import tokens - the trees the
 * claude-code detector inventories completely. `.md`-anchored so trailing
 * punctuation never joins the path.
 */
const CLAUDE_IMPORT_RE =
  /(?:^|[\s(])@(?:\.\/)?(\.claude\/(?:rules|commands|agents)\/[\w./-]*\.md)(?![\w-])/g;

/** `subagent_type: name` references, quoted or bare. */
const SUBAGENT_REF_RE = /subagent_type\s*[:=]\s*["']?([\w-]+)/g;

/**
 * Built-in agent names as of the research window (§3 fast-churn caveat;
 * format-canary TX.1 guards the list).
 */
const BUILTIN_AGENTS: ReadonlySet<string> = new Set([
  "general-purpose",
  "statusline-setup",
  "output-style-setup",
  "Explore",
  "Plan",
]);

function danglingReferences({ matched, input }: RuleContext): RuleFinding[] {
  const paths = new Set(input.artifacts.map((artifact) => artifact.path));
  const agents = matched.filter((artifact) => artifact.kind === "subagent");
  const agentNames = new Set(agents.map(agentName));
  const findings: RuleFinding[] = [];
  for (const { kind, path, content } of matched) {
    if (kind === "settings" || content === undefined) {
      continue;
    }
    for (const { line } of unfencedLines(content)) {
      for (const match of line.matchAll(CLAUDE_IMPORT_RE)) {
        const target = match[1]!;
        if (!paths.has(target)) {
          findings.push({
            path,
            message: `${path} imports @${target}, which is not in the workspace inventory; fix the path or create the file (dangling reference).`,
          });
        }
      }
      if (kind === "subagent" || agents.length === 0) {
        continue;
      }
      for (const match of line.matchAll(SUBAGENT_REF_RE)) {
        const name = match[1]!;
        if (!agentNames.has(name) && !BUILTIN_AGENTS.has(name)) {
          findings.push({
            path,
            message: `${path} references subagent_type "${name}", but no such agent exists under .claude/agents/ (dangling reference); fix the name or add the agent.`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * A subagent's identity: frontmatter `name:`, else the file basename.
 * Line-based and CRLF-tolerant, the `parseScopeFrontmatter` split
 * semantics (an unterminated opener is content, not frontmatter).
 */
function agentName(artifact: RiskArtifact): string {
  const basename = artifact.path.replace(/\.md$/, "").replace(/^.*\//, "");
  if (artifact.content === undefined) {
    return basename;
  }
  const lines = artifact.content.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    return basename;
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      return basename;
    }
    const name = /^name:\s*["']?([\w-]+)/.exec(lines[i]!);
    if (name) {
      return name[1]!;
    }
  }
  return basename;
}
