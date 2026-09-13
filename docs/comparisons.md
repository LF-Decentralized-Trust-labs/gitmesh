# gitmesh doctor and its neighbors: the benchmark-parity checklist

Status: benchmark-parity checklist (pivot §4.5 item (c), task T1.19; published as the
benchmark honesty page by T2.6)
Checked: 2026-09-13, against each tool's live docs, source, or shipped binary
Scope: every check published by Claude Code's `/doctor` checkup, cc-health-check,
agents-lint, and AgentLint, mapped to what `gitmesh doctor` does with the same territory

These four tools are good at what they do, and three of them predate `gitmesh doctor`.
None of them is a competitor to hide from: each audits **one tool or one file class**,
while `gitmesh doctor` audits **the whole multi-vendor workspace in one pass** - eleven
adapters (Claude Code, Codex, Cursor, Copilot, Antigravity, OpenCode, Devin, Cline, Roo,
AGENTS.md, third-party managers), cross-tool drift between instruction copies, and risk
findings (GM001-GM011) - read-only, deterministic, CI-committable. Use the vendor's own
doctor for its runtime; use gitmesh doctor for the repo. The tables below map every
published check so the difference is inspectable, not asserted.

## How to read the mapping

| Verdict | Meaning |
|---|---|
| `GM0xx` | A gitmesh doctor risk rule covers the same territory |
| `Inventory` | Surfaced by doctor's artifact inventory |
| `Drift` | Covered by the cross-tool drift differ |
| `Partial` | Overlapping territory; the difference is named in the row |
| `Out of scope` | Deliberately not gitmesh's job; the row names who does it |
| `Not covered today` | Honest gap in gitmesh doctor; the row names who covers it now |

"Out of scope" clusters follow the pivot's standing fences (§8.6): gitmesh doctor never
audits runtime state, transcripts, or usage telemetry (a vendor's in-session doctor
owns its own runtime), never lints prose quality or code/dependency staleness
(agents-lint's and AgentLint's lane), and never scans content for malicious payloads
(Snyk Agent Scan and Cisco own that lane; see the scanners page, T2.1).

---

## 1. Claude Code `/doctor` (alias `/checkup`) - first-party, Claude-only, in-session

Identity, as of 2026-09-13: `/doctor` became a bundled agentic skill in Claude Code
v2.1.205 (2026-07-08); `/checkup` is an **alias, not a rename** (the July 2026 reporting
that it "became /checkup" was wrong in that detail). Current Claude Code: 2.1.270. It
runs inside a Claude session, reads local machine state and transcripts, and applies
fixes behind a confirmable plan. Not CI-oriented, no machine-readable output contract,
Claude-only by design. A separate read-only `claude doctor` terminal command prints
installation diagnostics, and `/skill-doctor` (v2.1.261) reports unused-skill context
cost.

The ten checks of the in-session checkup (names verbatim from the shipped skill):

| # | /doctor check | gitmesh doctor | Notes |
|---|---|---|---|
| 0 | Setup health (installation, settings, agent definitions) | Partial | Broken/colliding agent definitions: GM011 covers dangling agent references in repo config. Installs, PATH, unparseable machine settings: out of scope - machine state, `claude doctor`'s job |
| 1 | Unused skills, MCP servers, and plugins vs context cost | Out of scope | Usage counters live in Claude's local transcripts. GM008 (orphan config for an agent unseen in repo history) is the repo-side analog; GM008 is defined but its repo-history evidence is not wired into `doctor` yet |
| 2 | Local CLAUDE.md dedup and contradictions | Partial | Cross-copy divergence between committed root documents: Drift. Untracked-vs-committed dedup: out of scope - local files are personal by design (GM009's territory once tracking evidence is wired) |
| 3 | Trim derivable content from checked-in CLAUDE.md | Out of scope | Content-quality judgment; /doctor and agents-lint own it. GM007 covers the measurable edge (oversized instruction file, same ICSE 2026 basis) |
| 4 | Migrate always-loaded content to lazy loading | Out of scope | Claude-specific refactor; /doctor's job. GM007 flags the context-budget symptom |
| 5 | Slow hooks | Out of scope | Runtime timing from transcripts; only the vendor can see it |
| 6 | Context-heavy extensions | Out of scope | Runtime context accounting; only the vendor can see it |
| 7 | Claude Code version currency | Out of scope | Machine state; `claude doctor` and the updater own it |
| 8 | Auto mode as the default permission mode | Partial | /doctor offers the convenience direction on one machine; GM003 flags the risk direction - bypass/auto-approve modes committed to the repo, where they bind every clone |
| 9 | Pre-approve frequently denied read-only commands | Out of scope | Transcript mining; /doctor's job. Repo-side permission hygiene is GM002/GM003/GM011's lane, and compiling permission sets is `gitmesh policy` (E7, planned) |

The read-only `claude doctor` terminal diagnostics (accreted per-version; grouped by
area, changelog-sourced):

| Area | gitmesh doctor | Notes |
|---|---|---|
| Install type, PATH, updater channel, keychain, daemon pipes | Out of scope | Machine state, Claude-only |
| Unparseable settings files | Not covered today | gitmesh doctor silently skips a committed settings file that fails to parse; `claude doctor` reports it for Claude's own files |
| Permission-rule syntax validation, unreachable rules | Partial | GM011 flags semantic contradictions (dead allows, allow-vs-hook); rule-syntax validation itself is not covered today |
| MCP config schema errors, multi-scope overrides | Partial | GM005 flags the cross-tool case (same server, different url/credentials across tools); within-one-tool scope layering is deliberately left to that tool |
| Plugin load errors, stale enabledPlugins | Partial | Plugin/marketplace configs are inventoried (Inventory); load state is runtime, vendor's job |
| Hook config field validation (missing `command`) | Not covered today | GM011 checks hook semantics, not schema; `claude doctor` and AgentLint (H1/H2) cover syntax |
| Sandbox and org-managed settings load state | Partial | Managed-settings presence is inventoried (Inventory, labeled informational); load state is runtime |

## 2. cc-health-check (yurukusa) - Claude-only ops-practice audit

Identity, as of 2026-09-13: npm `cc-health-check` v1.2.1 (2026-04-05), check logic
stable since March 2026; 20 checks / 6 dimensions / 0-100 score, exit 1 under 60 in CI;
read-only, zero-dependency, keyword-heuristic detection over `~/.claude` hooks and
CLAUDE.md. Its job is different from gitmesh doctor's: it scores a **solo-operator
hardening practice** around one tool (watchdogs, task queues, proof logs), not the
portability and hygiene of a repo's multi-agent configuration. Most rows are honestly
out of scope for a workspace auditor - and the reverse is equally true.

| # | cc-health-check check (verbatim) | gitmesh doctor | Notes |
|---|---|---|---|
| 1 | PreToolUse hook blocks dangerous commands (rm -rf, git reset --hard) | Partial | GM011 flags allows that contradict such hooks; GM002 requires read-protection for secret paths. Authoring the hook itself is `gitmesh policy`'s lane (E7, planned) |
| 2 | API keys stored in dedicated files (not hardcoded in CLAUDE.md) | Partial | GM001 scans MCP configs, settings, hooks and agent config with regex + entropy, always redacting values. Instruction-file prose is not scanned today (deliberate false-positive tradeoff; cc-health-check and gitleaks cover it) |
| 3 | Setup prevents pushing to main/master without review | Out of scope | Workflow convention detection; cc-safe-setup owns the hook, `gitmesh policy` (E7) compiles approval gates like `git push --force` |
| 4 | Error-aware gate blocks external calls when errors exist | Out of scope | Bespoke ops convention; cc-safe-setup |
| 5 | Syntax checks run after every file edit (PostToolUse hook) | Out of scope | Workflow convention; cc-safe-setup, `gitmesh policy` for compiled hooks |
| 6 | Error detection and tracking from command output | Out of scope | Ops convention; cc-safe-setup |
| 7 | Definition of Done checklist exists | Out of scope | Content convention; agents-lint's structure checks are the nearest linter |
| 8 | AI verifies its own output | Out of scope | Content convention |
| 9 | Context window usage monitored with alerts | Out of scope | Runtime; /doctor's context accounting |
| 10 | Activity logging (commands, when, what changed) | Out of scope | Ops telemetry; Git AI / Agent Trace own attribution, `gitmesh receipt` (gated, later) signs workspace state, never activity capture |
| 11 | Daily summaries of AI work | Out of scope | Ops practice |
| 12 | Git backup branches before major changes | Out of scope | Workflow convention |
| 13 | Watchdog detects and recovers from hangs | Out of scope | Runtime ops |
| 14 | Fallback plan for AI loops | Out of scope | Content convention |
| 15 | AI can run tasks from a queue | Out of scope | Orchestration - the lane GitMesh exited (§8.6) |
| 16 | Setup blocks unnecessary questions | Out of scope | Content convention |
| 17 | AI continues across session restarts (persistent state) | Out of scope | Personal machine state (`~/.claude` memory); surfaced only under `--user`, never judged |
| 18 | Decision audit trail | Out of scope | Ops practice |
| 19 | AI coordinates with other AI instances | Out of scope | Orchestration, exited lane |
| 20 | Structured lessons-learned capture | Out of scope | Content convention |

## 3. agents-lint (giacomo) - AGENTS.md-family content linter

Identity, as of 2026-09-13: npm `agents-lint` v0.5.0 (2026-03-26, dormant since);
lints AGENTS.md/CLAUDE.md/GEMINI.md/`.cursorrules`/copilot-instructions plus Claude
memory files; 56 static rules in 7 checkers plus 2 dynamic rule families; 0-100 score,
`--fix`, `--format json`, `--max-warnings` for CI. It cites the same ETH Zurich ICSE
2026 context-rot study GM007 cites. Its center of gravity is **whether the prose tells
the truth about the repo** - paths, scripts, dependency and framework claims - which is
content linting gitmesh doctor deliberately leaves to it.

| Rules | agents-lint territory | gitmesh doctor | Notes |
|---|---|---|---|
| `no-missing-path`, `no-missing-directory` | Paths mentioned in prose must exist | Partial | GM011 verifies `@.claude/{rules,commands,agents}` imports and subagent references against the inventory; arbitrary path mentions in prose are agents-lint's lane |
| `no-missing-script`, `missing-test-script` | npm scripts mentioned must exist | Out of scope | Repo-content linting; agents-lint |
| `no-missing-dependency`, `deprecated-dependency` | Dependency claims vs package.json | Out of scope | Dependency linting; agents-lint, npm audit family |
| 34 framework-staleness rules (`angular-*` x8, `react-*` x3, `nextjs-*` x2, `node-commonjs-in-esm-project`, `symfony-*` x5, `django-*` x5, `zend-*` x2, `laravel-*` x5, `old-node-version`, `old-npm-version`, `php-mailhog-deprecated`) | Stale framework advice in context files | Out of scope | Code/framework staleness is agents-lint's defining feature and entirely its lane |
| `missing-setup-section`, `missing-test-section`, `missing-build-section`, `missing-custom-section-*` | Required prose sections | Out of scope | Content structure; agents-lint |
| `too-short`, `too-long` | Context file size bounds | Partial | GM007 flags oversized instruction files (configurable threshold, same ICSE 2026 basis); "too short" is a content judgment gitmesh does not make |
| `too-many-todos`, `old-year-reference` | Stale prose markers | Out of scope | Content freshness; agents-lint |
| `cross-pm-conflict`, `cross-script-conflict-*`, `cross-path-asymmetry` | Cross-file consistency between context files | Partial | This is the one shared lane: gitmesh's Drift diffs root instruction copies block-by-block across all eleven adapters with symlink identity; agents-lint additionally interprets command semantics (package-manager conflicts) inside the files it knows |
| `memory-broken-link`, `memory-index-empty`, `memory-missing-frontmatter`, `memory-missing-name`, `memory-missing-description`, `memory-missing-type`, `memory-invalid-type` | Claude auto-memory hygiene | Out of scope | Per-user machine state under `~/.claude/projects`; agents-lint owns it |

## 4. AgentLint (agentlint.app, 0xmariowu) - evidence-cited repo readiness audit

Identity, as of 2026-09-13: npm `agentlint-ai` v1.1.13 (2026-04-26; site live, no
release since); CLI + Claude Code plugin + GitHub Action. **The widely quoted "33
checks" is stale**: the shipped catalog is 51 deterministic core checks across 6
dimensions plus 7 opt-in extended checks (AI "Deep" analysis and Claude-transcript
"Session" analysis) - the marketing site, the Action listing and the docs still publish
three different counts (33 / 42 / 58) side by side. The mapping below follows the
canonical shipped catalog (docs.agentlint.app/checks, IDs F1-SS4). It is the nearest
conceptual neighbor to a cross-file doctor, Claude-and-AGENTS.md-centered, with strong
generic repo-engineering checks gitmesh deliberately does not duplicate.

| ID | AgentLint check | gitmesh doctor | Notes |
|---|---|---|---|
| F1 | Entry file exists | Inventory | Plus GM010 for the CLAUDE.md/AGENTS.md bridge specifically |
| F2 | Entry file describes the project | Out of scope | Prose quality; AgentLint, agents-lint |
| F3 | Conditional loading guidance | Out of scope | Prose quality |
| F4 | Large directories have index | Out of scope | Content organization |
| F5 | All references resolve | Partial | GM011 for `@.claude` imports and agent references; arbitrary references are AgentLint's and agents-lint's lane |
| F6 | Predictable file naming | Out of scope | Repo docs convention |
| F7 | Include directives resolve | GM011 | Dangling `@` imports into the inventoried namespace |
| F8 | Rule file frontmatter uses globs, not paths | Not covered today | Config-key validation; AgentLint covers it (format-canary territory for gitmesh) |
| F9 | No unfilled template placeholders | Out of scope | Content quality |
| I1-I5 | Emphasis keywords, density, specificity, organization, identity language | Out of scope | Prose quality; AgentLint's evidence-cited specialty |
| I6 | Entry file length in concise range | Partial | GM007 flags the oversized end; a "too terse" judgment is not gitmesh's |
| I7 | Entry file under 40,000 chars | GM007 | Same threshold, same Claude truncation basis |
| I8 | Total injected content within budget | Partial | GM007 is per-file; a cross-file token budget is AgentLint's |
| W1-W11 | Build/test docs, CI exists, tests exist, linter, file sizes, hook speed, fast tests, npm test, release versioning, test tiers, feat/fix-test pairing | Out of scope | Generic repository engineering health; AgentLint's Workability dimension owns it |
| C1-C4, C6 | Doc freshness, handoff files, changelog-why, plans, verify conditions | Out of scope | Team-process conventions; AgentLint |
| C5 | CLAUDE.local.md not tracked | Partial | GM009's exact territory (local-vs-shared hygiene, `.gitignore` vs committed); GM009 is defined but its tracking evidence is not wired into `doctor` yet, so AgentLint covers it today |
| S1 | Env files gitignored | Partial | GM002 guards the agent-side (deny/ask read-protection per agent); whether `.env` is committed is generic repo hygiene (gitleaks, AgentLint) |
| S2 | Actions SHA pinned | Out of scope | CI supply-chain; AgentLint, zizmor-class CI linters |
| S3 | Secret scanning configured | Out of scope | Repo tooling presence; AgentLint, gitleaks |
| S4 | SECURITY.md exists | Out of scope | Repo governance; AgentLint, OpenSSF scorecard |
| S5 | Workflow permissions minimized | Out of scope | CI security; AgentLint, zizmor |
| S6 | No hardcoded secrets (`sk-`, `ghp_`, `AKIA`, keys) | GM001 | Same territory in agent config surfaces, plus entropy scanning, values always redacted in every output mode |
| S7 | No personal paths in source | Out of scope | Content hygiene |
| S8 | No `pull_request_target` trigger | Out of scope | CI security |
| S9 | No personal email in git history | Out of scope | Repo history hygiene |
| H1 | Hook event names valid | Not covered today | Config-schema validation; AgentLint covers it |
| H2 | PreToolUse hooks have matcher | Partial | GM011 reasons about matchers when checking allow-vs-hook contradictions; presence/shape validation itself is AgentLint's |
| H3 | Stop hook has circuit breaker | Out of scope | Hook design practice |
| H4 | No dangerous auto-approve (`Bash(*)`, `*`, `mcp__*`) | Partial | GM003 flags committed bypass/auto-approve modes; blanket allow patterns are not flagged today (AgentLint covers them) |
| H5 | Env deny coverage complete (`.env.*` variants) | GM002 | Same territory: glob-verified deny/ask coverage for secret paths |
| H6 | Hook scripts network access | Out of scope | Script-content scanning; AgentLint here, Snyk Agent Scan for the malicious case |
| H7 | Gate workflows are blocking | Out of scope | CI design |
| H8 | Hook errors use structured format | Out of scope | Hook UX convention |
| D1 | Contradictory rules (AI analysis) | Partial | GM011 finds the deterministic subset (dead allows, allow-vs-hook, dangling references) without AI and without sending content anywhere; D1's prose-level contradictions are AgentLint's opt-in Deep mode |
| D2, D3 | Dead-weight rules, vague rules (AI analysis) | Out of scope | AI content analysis; AgentLint Deep, /doctor check 3 |
| SS1-SS4 | Repeated instructions, ignored rules, friction hotspots, missing-rule suggestions (transcript analysis) | Out of scope | Claude transcript analytics; AgentLint Session mode and /doctor own it |

---

## What only the cross-tool pass sees

Every check above audits one tool or one file class. The following exist only at
workspace granularity, and none of the four tools attempts them:

- **Inventory across vendors:** one pass over eleven adapters' artifacts - instruction
  files, rules, MCP configs, skills, commands, subagents, permission/hook/sandbox
  settings, org-managed probes - plus third-party managers (Ruler, rulesync,
  `.agents/agents.json`, agentsync-family, symlink managers, skills-lock, mcp-lock),
  labeled informationally, never fought (ADR-004).
- **Cross-tool drift:** block-hash diffs between the instruction copies different
  agents read, with symlink identity (a symlinked CLAUDE.md is zero drift) and the
  `@AGENTS.md` shim recognized as a bridge, not a divergent copy.
- **Cross-tool config divergence:** GM005 - the same MCP server defined with different
  urls or credentials in different tools' configs, values never printed.
- **One CI contract for all of it:** exit 0/1/2, `--fail-on`, `--json` (versioned
  schema), `--md`, byte-deterministic, zero writes and zero network enforced by tests.

## Where gitmesh doctor honestly falls short today

Found while building this checklist; each names who covers it now:

1. A committed settings file that fails to parse produces no finding (rules skip
   unreadable JSON silently). `claude doctor` reports this for Claude's files; AgentLint
   partially via schema checks.
2. Config-schema validation (hook event names, missing `command` fields, `globs:` vs
   `paths:` frontmatter) is absent; GM011 checks semantics, not syntax. AgentLint H1/H2
   and `claude doctor` cover it.
3. Blanket allow patterns (`Bash(*)`, `mcp__*`) are not flagged; GM003 covers bypass
   *modes* only. AgentLint H4 covers it.
4. GM001 does not scan instruction-file prose for secrets (false-positive tradeoff,
   documented in the rule); cc-health-check and gitleaks do.
5. GM008 (orphan configs) and GM009 (local-vs-shared hygiene) are defined and tested
   but the doctor pipeline does not yet supply their repo-history and tracking
   evidence, so they stay silent; /doctor check 1 and AgentLint C5 are the working
   alternatives in their niches.

## Adjacent tools, deliberately not mapped here

Named for completeness, outside this checklist's four-tool scope (pivot T1.19):
**AgentLinter** (agentlinter.com - a different product than AgentLint, "ESLint for AI
agents", ~30 rules), **agnix** (Rust linter/LSP for CLAUDE.md/AGENTS.md/SKILL.md/hooks),
**skillscheck** and **agent-skill-linter** (SKILL.md linters), the sync-tool doctors
(each checks only its own generated artifacts), and the content-security scanners
(Snyk Agent Scan, Cisco) whose lane the scanners page describes.

## Sources

Checked 2026-09-13. `/doctor`: code.claude.com/docs/en/commands, the
anthropics/claude-code CHANGELOG (v2.1.205, v2.1.270), and the shipped v2.1.220 binary's
embedded skill (check names verbatim). cc-health-check: github.com/yurukusa/cc-health-check
`cli.mjs` at bc170ac (check names verbatim from source), npm registry. agents-lint:
github.com/giacomo/agents-lint v0.5.0 source (`src/checkers/*.ts`), npm registry.
AgentLint: docs.agentlint.app/checks and /scoring and /changelog,
github.com/0xmariowu/AgentLint, npm `agentlint-ai`, GitHub Marketplace listing. Counts
and dates in this page are point-in-time; the weekly watch ritual (T2.7) owns keeping
them honest.
