# GitMesh Pivot v2.1: The Agent Workspace Compiler

**Decision date:** 2026-07-19
**Research basis:** three cycles - 2026-07-18 extended review (fact-check of the Change Control plan), 2026-07-19 manual implementation-level sweep, 2026-07-19 extended long-tail landscape sweep (100+ sources; sync tools, linters, doctors, MCP/skills tooling, hooks/policy tooling, provenance, vendor signals). All load-bearing claims labeled per §3.
**Status:** Canonical pivot strategy + build plan. Supersedes v2.0 (same direction, adjusted where cycle-3 evidence demanded - the delta is itemized in §5) and retires "GitMesh Pivot: Change Control for Coding Agents" (2026-07-14).
**Verdict up front:** the pivot direction **survives** the long-tail sweep. Three findings force honest adjustments: the doctor wedge is now *contested single-tool territory* (not open), the policy layer's enforcement targets are *larger* than previously mapped (org-managed surfaces), and the lockfile must *interoperate* with two incumbent lockfiles rather than claim novelty. Nothing in the research argues for abandoning or re-aiming the pivot.

---

## How To Use This Document

| Reader or need | Read these sections |
|---|---|
| Understand the pivot in five minutes | 1, 2, 7, 8, 20 |
| Understand what changed since v2.0 and why | 5 |
| Explain the market decision | 3, 4, 6 |
| Understand competitor internals (incl. the long tail) | 4.4–4.9 + `research_results.md` |
| Understand GitMesh's current code and what survives | 9, 10 |
| Plan implementation | 11, 12, 13 |
| Evaluate risk and kill criteria | 14, 15, 16 |
| Audit the research | 3, 19, and inline verdict labels |

**Current stage:** Ship-to-validate. Validation happens by shipping a zero-risk wedge in weeks and measuring retained usage publicly - not by interview quotas (rationale: §2.4). The cycle-3 sweep sharpened the urgency: vendors have started shipping *single-tool* audit features (§4.5), which means the cross-tool window is open but visibly narrowing.

---

## 1. The Decision

GitMesh stops positioning itself as (a) an operating system for autonomous AI companies, (b) a multi-agent orchestration runtime with its own agent roles, and (c) a change-governance/evidence plane aimed at 50–1,000-engineer organizations. All three require adopting a new operating model or a new server before delivering value, and all three run into better-resourced occupants (§4, §5).

The pivot is:

> **GitMesh is the agent workspace compiler.** One governed, git-versioned source of truth - `AGENTS.md` plus `.gitmesh/`: **audited, compiled, and enforced across every coding agent a team uses** (Claude Code, Codex, Cursor, Copilot, Gemini/Antigravity, OpenCode, and the long tail). GitMesh audits what's already in the repo (`gitmesh doctor`: inventory, cross-tool drift, risk findings), compiles the source of truth into each agent's *native* config files (`gitmesh apply`), keeps everything from drifting in CI (`gitmesh check` + a unified lockfile), and compiles team guardrails into each agent's *own* enforcement mechanism - permission rules, hooks, sandbox and approval settings, org-managed policy files - instead of running a new runtime (`gitmesh policy`). Optionally, it emits a portable, offline-verifiable receipt of agent workspace state (`gitmesh receipt`), consuming Git AI / Agent Trace attribution rather than competing with it.

The product is a **single CLI + a GitHub Action**. No server, no login, no database, no daemon, no new operating model. The first command (`npx gitmesh doctor`) writes nothing and delivers value in under two minutes.

The strategy in one sentence (updated per §5-Δ1):

> **Cross-tool audit-and-govern is the headline. Doctor is the zero-risk entry. Compile-and-check is the recurring workflow - table stakes done honestly, not the pitch. Native-enforcement policy packs (including org-managed surfaces) are the differentiator and moat. Portable receipts are the long-term layer.**

Mental model for positioning: **Terraform/ESLint for your coding agents' configuration.** Declarative source of truth → plan/apply → drift check in CI → policy as code compiled to native enforcement points - with the audit, not the generator, as the front door, because generation is commoditized (§4.4) and audit-with-breadth is not (§4.5).

### 1.1 Why this satisfies every stated constraint

| Constraint (maintainer-stated) | How this pivot satisfies it - cycle-3-updated |
|---|---|
| Not chosen by any big project (company, OSS, research) | No vendor or large project ships **cross-tool** workspace audit, drift CI, policy-to-native-enforcement compilation, or a unified lockfile. What big players *do* ship is strictly single-vendor: Anthropic's in-session `/checkup` (Claude-only, v2.1.205, ~2026-07-08), Claude plugins/marketplaces (Claude-only distribution), Codex `requirements.toml` (Codex-only org ceiling). The cross-tool slot's only occupants are solo-maintainer OSS at the rules/sync layer and one ~3-star two-tool permission translator (§4.4, §4.6). Vendors remain structurally disincentivized from cross-vendor portability - issue #6235 (~3,020+ upvotes, 220+ comments, zero Anthropic response, duplicates bot-closed) is the standing proof. |
| Not an agent harness | GitMesh runs no agent, wraps no agent, proxies no traffic. It compiles files agents already read. Meta-harnesses (Omnigent-class, Composio's layer) are explicitly *not* this architecture. |
| Not security, not memory | Policy packs compile *hygiene and team convention* into each tool's own permission model; GitMesh never claims to block anything itself. Explicit non-goal (§8.6): no prompt-injection or tool-poisoning *content* scanning - that lane is occupied by Snyk Agent Scan (ex-mcp-scan) and Cisco's scanner, and GitMesh stays out of it. Memory untouched. |
| Plug-and-play with what users already use | `npx gitmesh doctor` on any repo, zero writes. `gitmesh apply` emits the exact files each tool already reads. Existing hand-written configs and *all* incumbent managers - Ruler, rulesync, `.agents/agents.json`, symlink managers, skills-lock.json, mcp-lock - are imported or respected, never clobbered (§8.2). |
| Adoption and meaningfulness over gap purity | Individual-developer wedge, sub-15-minute value, no org buy-in. Demand is documented weekly (#6235 cluster; a 15+-tool sync ecosystem spawning to scratch the itch; ETH Zurich ICSE 2026 evidence that bad context files measurably hurt agents - §4.10). |
| Real users/downloads; relevance for many months | Rides three Linux Foundation–governed standards (AGENTS.md, MCP, Agent Skills) plus the emerging Agent Trace spec, while path/permission/MCP fragmentation persists. Kill criteria (§15) name the exact convergence events that would end relevance, and two of the watch-triggers now have named parties (§14 R1/R2). |
| Willing to change the entire codebase | §9–§10 keep ~30–40% of current code (policy compiler, forge/MCP/ACP plumbing, attestations, CLI shell) and retire the rest from the default path. |

---

## 2. Why GitMesh Must Change (Again)

### 2.1 The current product has zero retained users, and the reason is structural

The live repository (verified 2026-07-19: `LF-Decentralized-Trust-labs/gitmesh`, 142 stars, 47 forks, 597 commits, latest release v0.4.0-alpha on 2026-01-19) is a TypeScript pnpm monorepo shipping: a multi-agent orchestration runtime with pre-defined OSS agent roles (Triage, PR Review, Docs, Security, Community, Onboarding, Release), heartbeat scheduling, a governed MCP server, an ACP (JSON-RPC 2.0) orchestrator, YAML→Rego policy compilation via OPA, GitHub/GitLab webhook sync, budgets, an immutable audit log, an embedded PostgreSQL, and a three-view dashboard.

Every one of those is *server-shaped*. To get any value, a maintainer must: run a server (or Docker), provision a database, register webhooks, define agents in `.gitmesh/agents.yaml`, and route their tools through GitMesh's MCP endpoint. That is five adoption cliffs before the first minute of value. 142 stars and ~0 retained users after a long lifetime is the empirical verdict: **the operating-model tax is fatal**, independent of feature quality.

### 2.2 The 2026-07-14 "Change Control" plan fixed the *claims* but not the *motion*

The previous pivot document was intellectually honest and architecturally sophisticated, but the 2026-07-18 review's strategic verdict stands and remains confirmed: (1) head-on collision with GitHub (Agent HQ's multi-agent assignment went live Feb 2026 - public-preview and enterprise-GA dates both fall that month across sources - connecting agent sessions → PRs → checks → merge on GitHub's own surface); (2) wrong adoption motion (top-down enterprise interviews executed by a zero-user OSS team); (3) wedge value too thin for an individual; (4) line-level provenance occupied by a shipping product (Git AI, §4.8).

### 2.3 What survives from Change Control

Three ideas from the previous plan are correct and carried forward, restructured: **enforce only at boundaries that can actually enforce** (now primarily each agent's own native permission/hook/sandbox system, plus org-managed policy files - boundaries that exist on every laptop with zero infrastructure); **report capability gaps honestly** (now a generated per-tool coverage matrix, §10.6); **portable, offline-verifiable, DSSE-signed artifacts** (now an optional late layer that consumes Git AI / Agent Trace, §8.5).

### 2.4 Why "ship-to-validate" replaces "interview-gate"

An OSS project with zero users has no interview pipeline and no visible momentum - the currency that attracts contributors and stars. For bottom-up devtools the cheap, honest validation instrument is a shipped wedge plus public retention metrics. This plan's kill criteria (§15) are wired to weekly-active-repo counts, and - new in v2.1 - to named competitor/vendor change-triggers with pre-committed responses, so a fired trigger produces a plan change instead of denial.

---

## 3. Evidence Standard Used In This Research

Every load-bearing claim carries one of four labels:

- **[V]** Verified in the 2026-07-18/19 research program against a primary or near-primary source (vendor docs, repo, foundation press, spec site), including the cycle-3 extended sweep. Source index in §19.
- **[V-1]** Verified in an earlier cycle of the same program and not re-checked in cycle 3; reliable but may lag by days.
- **[I]** Inference from verified facts, or a figure available only from secondary/SEO sources; uncertainty stated.
- **[H]** Hypothesis; must be validated by shipping and measuring, not by more reading.

Standing limits (unchanged): vendor docs prove publication, not efficacy; stars/downloads are not retained users; absence of a competitor in this review is not proof of absence (§14 carries a standing response protocol); feasibility ≠ willingness to install.

**New in v2.1 - conflicting-figure rule:** where two cycles produced different numbers for the same fact, this document states both with labels and adopts the conservative one for decisions. Two known conflicts: the skills.sh catalog size (cycle-2 secondary sources: "89k+ skills"; cycle-3 direct check of the vercel-labs/skills ecosystem: ~4,257 directory skills growing ~147/day - the 89k figure likely conflated installs or a scraped superset; **adopt ~4.3k**), and the Agent HQ go-live date (Feb 4 public-preview reporting vs Feb 26 enterprise-GA reporting; **adopt "Feb 2026"**). Fast-churn caveat: Claude Code, Codex (300+ releases Jan–Jun 2026), and Antigravity ship weekly; every per-tool config fact in §4.3 carries an implicit "as of mid-July 2026" and the format-canary CI (§12 TX.1) exists precisely because these facts rot.

---

## 4. Market Research (as of 2026-07-19, three cycles)

### 4.1 The standards layer has converged; the tooling layer has not

Three standards sit under neutral Linux Foundation governance via the **Agentic AI Foundation (AAIF)**, formed 2025-12-09 with Platinum members Amazon, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, and OpenAI, and founding project donations MCP (Anthropic), AGENTS.md (OpenAI), and goose (Block) [V]:

| Standard | Steward | Status [V unless noted] |
|---|---|---|
| **AGENTS.md** | AAIF / Linux Foundation | Adopted by 60,000+ open-source projects and natively read by Amp, Codex, Cursor, Devin, Factory, Gemini CLI, GitHub Copilot, Jules, VS Code, and more (per the AAIF announcement). **Instruction-only by design - the standard deliberately does not cover permissions, hooks, or sandboxing**, and no AAIF cross-agent *enforcement* standard exists. No official AAIF/LF validation CLI was found in a dedicated cycle-3 search. |
| **MCP** | AAIF / Linux Foundation | 10,000+ servers; ~100M+ monthly SDK downloads [V-1]; Enterprise-Managed Authorization stable Jul 2026 [V-1]. Spec proposal **SEP-1766** would add digest-pinned tool versioning (proposed, not adopted). |
| **Agent Skills** (`SKILL.md`) | Open standard published by Anthropic (agentskills.io, 2025-12-18) | ~30–40 compatible products by mid-2026 [V-1]. Distribution owned by Vercel's `skills` CLI + skills.sh directory (~4,257 skills, ~147/day growth - see §3 conflict rule); OpenAI maintains github.com/openai/skills. |
| **ACP** (Agent Client Protocol) | Zed | Editor↔agent JSON-RPC transport, **not a config standard**: external agents keep their own native config; the ACP Registry (with JetBrains) distributes *agents*, not policies [V]. Confirms no cross-agent permission registry exists. |
| **Agent Trace** (emerging) | community (Git AI-led) | Attribution spec implemented by Git AI, Cline, and OpenCode [V]. GitMesh receipts consume it (§8.5). |

**Strategic reading [I]:** the specification war is settled at the Linux Foundation - the foundation family GitMesh already lives in (LFDT Labs). What was *not* standardized is everything below the spec line: file locations, permission models, hook systems, MCP config placement, and operational tooling (audit, compile, diff, enforce). That layer is this pivot, and the LF affiliation becomes the story: **LF-neighborhood tooling for LF-governed agent standards.**

### 4.2 The instructions-file war: one standard, two holdouts, one 3,000-vote proof of pain

AGENTS.md is the cross-tool default [V]. **Claude Code still does not read it natively**: official docs describe CLAUDE.md (+ auto memory) only; issue anthropics/claude-code#6235 carries ~3,020+ upvotes and 220+ comments - the tracker's largest unmet request by roughly 4× the runner-up - with **zero Anthropic response**, and the related cluster (#31005, #34235, #25882, #14474) is bot-closed as duplicates [V]. Documented workarounds: an `@AGENTS.md` import line inside CLAUDE.md, or a symlink; circulating "reads it as a fallback" claims are false [V]. Gemini's surface is now **Antigravity 2.0** (Gemini CLI folded in), still GEMINI.md-based [V]. **Why it matters [I]:** the most-upvoted request on the most popular agent's tracker is literally "make my config portable," ignored for 8+ months because portability erodes lock-in - the clearest evidence that only a neutral third party will own the mapping.

### 4.3 Per-tool configuration surface - the compiler's target matrix

Launch-scope rows, verified across cycles 2–3; long tail ships via the community adapter registry (§10.6). Every row is churn-prone (§3 caveat).

| Tool | Instructions | Rules / scoped | MCP config | Skills | Commands / subagents | Permissions / hooks / sandbox / org policy |
|---|---|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md` hierarchy (managed → `~/.claude/CLAUDE.md` → project → subdirs, additive), `CLAUDE.local.md`, `@` imports; **no native AGENTS.md** | `.claude/rules/` | `.mcp.json` + `allowedMcpServers`/`deniedMcpServers`/`allowManagedMcpServersOnly` | `.claude/skills/` | `.claude/commands/`, `.claude/agents/` | `.claude/settings.json` permissions allow/deny/ask patterns; `disableBypassPermissionsMode`; hooks (JSON stdin, exit 2 blocks); `settings.local.json` from git root (v2.1.211+); **managed-settings.json** via MDM (Jamf/Kandji/Intune/GPO) or claude.ai console, with `allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`, `strictKnownMarketplaces`, a `managed-settings.d/` drop-in dir, dynamic `policyHelper` (v2.1.136+), resolution order Managed > Local > Project > Plugin > User; **plugins + marketplaces** (`.claude-plugin/marketplace.json`, `extraKnownMarketplaces`, `CLAUDE_CODE_PLUGIN_SEED_DIR`, org auto-install controls) as the Claude-only distribution channel; first-party **`/doctor`→`/checkup`** in-session audit (v2.1.205, ~2026-07-08) |
| **Codex CLI** | `AGENTS.md` (primary; nested) | nested AGENTS.md | `~/.codex/config.toml`; project `.codex/config.toml`; `CODEX_HOME` | `.agents/skills/` + `$skill-installer` + openai/skills | `.codex/agents/*.toml` | `approval_policy`; `sandbox_mode` (read-only / workspace-write / danger-full-access, **kernel-enforced** via Seatbelt on macOS, Landlock+seccomp on Linux); permission profiles (beta); **project trust**: an *untrusted* project's `.codex/config.toml` is ignored (critical emitter caveat); **managed `requirements.toml`**: admin ceiling on `allowed_approval_policies`/`sandbox_modes` + MCP allowlists; `codex execpolicy check` + `.rules` files; experimental hooks behind a flag |
| **Cursor** | AGENTS.md | `.cursor/rules/*.mdc` (frontmatter `description`/`globs`/`alwaysApply`); legacy `.cursorrules` | `.cursor/mcp.json` | supported | `.cursor/agents/` | hooks since v1.7 (`preToolUse`, `beforeReadFile`, Claude-compatible exit codes; loads existing Claude hook configs; prompt-evaluated "semantic" hooks) |
| **GitHub Copilot** | AGENTS.md (nested) + `.github/copilot-instructions.md` | `.github/instructions/**/*.instructions.md` (`applyTo`; searched recursively) | `.vscode/mcp.json` | announced | `.github/agents/*.md` | Copilot CLI hooks; coding-agent org policy is server-side; VS Code auto-approve booleans in `settings.json` (`chat.tools.global.autoApprove`, `chat.tools.terminal.autoApprove`, `chat.tools.urls.autoApprove`; no hard deny - see ZacheryGlass finding §4.6) |
| **Antigravity 2.0 (Gemini)** | GEMINI.md | nested | `.gemini/settings.json` + plugin `mcp_config.json` | `.agent/skills/` + `~/.gemini/antigravity/skills/` | plugin bundles (`plugin.json`, hooks.json, skills/agents/rules) | `~/.gemini/antigravity-cli/settings.json`: **allowed/denied commands**, `enableTerminalSandbox`, tool-permission modes - a real enforcement surface only one tool in the ecosystem targets today |
| **OpenCode** | AGENTS.md | - | `opencode.json` | supported | commands | per-pattern read/edit/bash/web permission JSON; implements Agent Trace |
| **Devin Desktop (ex-Windsurf, renamed 2026-06-02)** | AGENTS.md; legacy `.windsurf/rules` | - | supported | - | - | ACP |
| **Long tail** | Ruler's registry enumerates 30+ targets (aider, amazonqcli, amp, augmentcode, cline, crush, factory, firebase, firebender, goose, jetbrains, jules, junie, kilocode, kiro, openhands, qwen, roo, trae, warp, zed, …) [V] | | | | | |

**Structural facts [I from V rows]:** (1) even standardized layers fragment by *path* (`.claude/skills` vs `.agents/skills` vs `.agent/skills`); (2) the permissions/hooks/sandbox/org-policy layer is the least standardized and most consequential - it *enforces* rather than suggests, every tool has one, no two are alike, org-managed variants now exist on at least three tools (managed-settings.json, requirements.toml, Antigravity settings), and **no tool compiles one policy into all of them**; (3) Claude's hook idiom (JSON stdin, exit-2 blocks) is becoming the convention others copy - a converging enforcement idiom a compiler can target.

### 4.4 Config-sync tools: a saturated, commoditizing category (15+ entrants; do not compete here)

Cycle 3's long-tail sweep found the generation/sync layer far more crowded than cycle 2 knew - including **five unrelated projects named "agentsync"**. Census (details, stars, and flanks per project in `research_results.md` §5):

| Tier | Projects [V] | Model | Common flanks (none does) |
|---|---|---|---|
| Leaders | **Ruler** (intellectronica; ~2.6k★/137 forks; npm v0.3.44; 30+ agents; rules+MCP+skills+subagents; copy-based; revert; documented CI-diff pattern) · **rulesync** (dyoshikawa; generate/import/direct `convert`; per-tool support matrix with explicit lossy-projection notes) | one source dir → generated native files | risk audit; cross-tool drift semantics beyond own outputs; permissions/hooks/sandbox policy; unified lockfile; org-managed surfaces; receipts |
| Closest architecture to GitMesh | **amtiYo/agents** (`@agents-dev/cli`): `.agents/agents.json` → `.codex/config.toml`, `.gemini/settings.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `opencode.json`, Claude wrapper; MCP+skills+instructions; secrets split committed-placeholder vs local; **explicitly excludes permissions/hooks/sandbox** | compile one JSON source → many native formats | ditto - and the one to watch for adding enforcement (§14 R1) |
| The "agentsync" cluster + kin | spxrogers (31 agents, 9 deep adapters, detailed lossy-projection reporting) · baranovxyz (TOML source, `github:` presets, profiles, doctor) · dallay (Rust, **symlinks**, doctor, skills mgmt) · yelmuratoff agent_sync (`check`/`doctor` catching forgotten manifest commits pre-merge, manual-edit detection) · claaslange (Liquid templates) · GowayLee (OCaml symlinker) · PanisHandsome ai-rules-sync · snapsynapse **agentlink** (Go, pure symlinks, detect/scan/doctor, refuses to overwrite real files) · dot-agents (`~/.agents/` "AGENTS.md v2") · vibe-rules (npm rule store + convert + npm-package rule installs) · airul (generates AGENTS.md *from* docs) · agent-kit (mirrors `node_modules` skills into agent dirs) · anywhere-agents (opinionated published config with hook guards) · ai-config-sync-manager (`~/.claude`↔`~/.codex` incl. permissions, user-scope) | generation OR symlink OR template | as above; several ship a `doctor`, but it checks only *their own* generated drift, not the whole workspace |

**Conclusions [I]:** generation is table stakes and a red ocean - GitMesh must never market itself as "the 16th sync tool." The correct posture is **interoperate to win migrations**: import `.ruler/`, `.rulesync/`, and `.agents/agents.json` sources; *detect and respect* the rest (incl. symlink-based managers) in doctor; and move the headline up-stack to what the entire category lacks: cross-tool audit, drift semantics, policy enforcement, unified integrity, receipts.

### 4.5 The audit/doctor layer: contested single-tool, open cross-tool (v2.1's most important correction)

Cycle 3 found a 2026 wave of audit/lint tools - and one first-party feature - that v2.0 did not know about:

| Tool [V] | Scope | What it proves / lacks |
|---|---|---|
| **Claude Code `/doctor` → `/checkup`** (first-party, v2.1.205, ~2026-07-08) | Claude-only, in-session: audits CLAUDE.md, skills, MCP servers, plugins, hooks, permission-denial history; proposes a confirmable fix plan | Vendors are moving into audit - but single-vendor, in-session, not CI, not repo-committable, not cross-tool |
| **cc-health-check** (yurukusa) + `cc-safe-setup` | Claude-only CLI: 20 checks / 6 dimensions / 0–100 score (missing PreToolUse dangerous-command block, secrets not isolated, unguarded push-to-main) | The independent demand signal for scored config audits; Claude-only |
| **claude-config-doctor** (tyabu12) | Claude-only skill detecting **semantic contradictions** (command references a non-existent agent; `rm -rf` allowed in permissions but blocked by a hook) | Contradiction detection is valuable and shippable - adopted as finding GM011 (§8.1) |
| **agents-lint** (giacomo) | AGENTS.md-only: verifies referenced paths/scripts exist, stale deps, cross-file consistency, 0–100 score, `--fix`, JSON, CI `--max-warnings`; cites ETH Zurich (ICSE 2026): LLM-generated context files cut task success 2–3% while raising cost 20%+ | "Context rot is measurable" - a citable justification for doctor; single-file scope |
| **AgentLint** (agentlint.app) | 33 checks across AGENTS.md/CLAUDE.md/.cursor/rules/copilot-instructions/CI/hooks/.gitignore; every check cites a primary source | The nearest conceptual neighbor to a cross-file doctor; marketing-led, not a repo-committable OSS CLI with drift/lock/policy semantics |
| **AgentLinter** (agentlinter.com; seojoonkim) | "ESLint for AI agents": scoring, secret redaction, prompt-injection rules, exports to Cursor/Copilot/Gemini | Single-concern linting |
| **skillscheck** (Swival) · **agent-skill-linter** (William-Yeh) | SKILL.md linters (frontmatter, secret leaks, token budgets) | Skill-file scope only |
| sync-tool doctors (agent_sync, baranovxyz, dallay, agentlink, webdevtodayjason claude-hooks `doctor`) | Own-artifacts drift/health only | Confirms `doctor` UX is expected - none audits the whole multi-tool workspace |

**Corrected verdict:** v2.0 called this slot "open." It is **contested at single-tool/single-concern granularity and open at cross-tool granularity**. GitMesh's doctor must therefore (a) win on breadth - Claude + Codex + Cursor + Copilot + Antigravity + OpenCode in one pass, plus cross-tool *drift*, which no linter attempts; (b) match the proven UX patterns (scored output, fix suggestions, CI modes); (c) publish an honest benchmark page positioning itself against `/checkup`, cc-health-check, agents-lint, and AgentLint rather than pretending they don't exist (§17.2, task T2.6); and (d) treat a *vendor cross-tool doctor* as a pre-committed change-trigger (§14 R2b, §15 CT1).

### 4.6 The policy/enforcement slot: still open - with named nearest neighbors and bigger targets

Direct cycle-3 findings:

- **ZacheryGlass/agent-sync** is the only tool found that translates *permissions* across tools: Claude `settings.json` allow/ask/deny ↔ VS Code Copilot boolean auto-approve flags - bidirectional, stateful, lossy (VS Code has no hard deny → downgraded to "require approval" with a warning), ~3 stars, 2 tools, Codex/Gemini unimplemented. It is a *translator between two tools*, not a compile-from-canonical-policy system - but it is the single most important project to monitor for this wedge [V].
- **PromptArmor** designs hardened Claude *and* Codex policies as a **consulting service** with one-click downloads - commercial proof of willingness-to-pay, not an OSS compiler with a coverage matrix [V].
- **managed-settings.com**: a web toggle generating Claude-only managed-settings JSON [V].
- The **hooks ecosystem** is rich but Claude-centric and enforcement-adjacent, not policy compilation: SDK/frameworks (cchooks 123★, cc-hooks-ts, PHP/Ruby SDKs, cchook YAML), managers (claude-hooks CLI 73★ with doctor/enable/disable, Hookify), curated collections (karanb192 marketplace - including a `pr-provenance-stamp` hook, a tiny receipts-adjacent signal; disler mastery repo; JalelTounsi 30-hook security set with secret scanning + destructive-command blocking), and **weykon/agent-hooks** (Rust; registers one bridge command into each tool's hooks for event *capture*, not policy) [V].
- Enterprise-grade *native* policy surfaces now exist on at least three tools - Claude managed-settings.json (+ `.d` drop-ins + policyHelper + MDM distribution), Codex `requirements.toml` (+ execpolicy `.rules`), Antigravity allowed/denied commands - and **every one is hand-written today; no OSS cross-agent compiler targets them** [V].

**Verdict:** the differentiator holds, and cycle 3 *expanded* it: Layer 4 compiles one policy not only to per-repo enforcement (settings.json permissions/hooks, config.toml approval/sandbox, opencode permissions, Cursor hooks) but also to **org-managed artifacts** (managed-settings bundle for MDM/console, requirements.toml, Antigravity settings) - the enterprise on-ramp the funded "runtime agent governance" startups (Microsoft Agent 365, TrueFoundry, OneTrust, Bifrost, Snyk - all runtime-focused [V]) do not touch.

### 4.7 MCP & skills operational tooling: pinning exists piecemeal; the unified lockfile is the open part

- **Snyk Agent Scan** (the rebranded Invariant **mcp-scan**, 2,000+★, v0.4.13 Apr 2026 after Snyk's Jun 2025 acquisition): scans MCP servers/skills for prompt injection, tool poisoning, shadowing, rug-pulls; **Tool Pinning** hashes tool descriptions over time; claims 90–100% recall on confirmed-malicious skills with 0% false positives on the top-100 legitimate skills.sh skills. **Cisco mcp-scanner** (YARA-based) [V]. These are *content* scanners - GitMesh's static config-hygiene findings are adjacent, complementary, and must never be marketed as a substitute (§8.6).
- **@mcpguards/mcp-lock**: init/verify/update/list; records exact version + tarball integrity hash + attestation; GitHub Action with SARIF; exits 1 on drift; motivated by the March 2026 axios supply-chain attack [V]. **Vercel `skills` CLI**: `skills-lock.json` (v3, keyed on GitHub tree-SHA `skillFolderHash`), `check`/`update`, npm-ci-style `experimental_install`, node_modules crawl [V]. **MCP SEP-1766** would move digest pinning into the spec (proposed) [V].
- Registries/managers (context, not competition): official MCP Registry, Smithery, mcpm.sh, mcp.so, Glama, PulseMCP, LobeHub, Docker MCP Catalog/Toolkit/Gateway (200+ curated servers, `--verify-signatures`, OCI profiles, enterprise allowlist catalogs) [V].

**Corrected verdict:** v2.0 implied the lockfile was novel. It is **partially occupied per-surface**: mcp-lock owns MCP pinning, skills-lock.json owns skill pinning. GitMesh's lockfile is differentiated as the *unified* integrity record across emitted configs + MCP + skills + generated hook scripts + policy-compilation state, and it **interoperates**: an existing `skills-lock.json` or mcp-lock record is honored as a valid pin (finding GM004 recognizes them; the lock references rather than duplicates them where present) - §10.3, tasks T5.3/T5.4.

### 4.8 Provenance: occupied at line level, standardizing via Agent Trace; open at workspace-state level

**Git AI** (usegitai.com; git-ai-project/git-ai): 2,049★, 179 releases to v1.5.6 in ~11 months; Thoughtworks Technology Radar "Assess" tier; line-level attribution (agent/model/prompt/session) in `refs/notes/ai` git notes surviving rebase/squash/merge/cherry-pick; agent hooks call `git ai checkpoint`; 10+ agents; implements the emerging **Agent Trace** spec (also in Cline and OpenCode); Teams tier adds SDLC telemetry [V]. **Conclusion unchanged and strengthened:** never rebuild attribution; `gitmesh receipt` covers the complementary artifact nobody signs today - *workspace state* (which MCP servers, skills, permissions, and policies were in force) - DSSE-signed with an in-toto/SLSA-aligned predicate so existing verifiers slot in, consuming Agent Trace/`refs/notes/ai` when present (§8.5).

### 4.9 Big-player adjacency scan (updated)

| Player | Shipped | Verdict |
|---|---|---|
| Anthropic | `/checkup` (Claude-only audit); plugins/marketplaces + managed settings (Claude-only distribution/policy); #6235 unanswered | Deepens its own surface; will not go cross-vendor. Single-tool doctor partially fires R2b - response pre-committed (§14) |
| OpenAI/Codex | requirements.toml, execpolicy, kernel sandboxing; 300+ releases H1-2026 | Same pattern: own-surface depth, no portability |
| GitHub | Agent HQ multi-agent assignment live Feb 2026 (Claude+Codex+Copilot on issues/PRs; Google/Cognition/xAI announced) | Governs GitHub's surface; strengthens the multi-agent-per-repo premise; strongest absorb-risk for `check`-on-GitHub only |
| Google | Antigravity 2.0 absorbs Gemini CLI; real enforcement surface, nearly untargeted by tooling | Early-support opportunity (only amtiYo targets it, MCP/skills only) |
| Zed/JetBrains | ACP Registry distributes agents, not config/policy | Complementary |
| Vercel | skills CLI + skills.sh | Owns skill distribution; GitMesh consumes/pins |
| Databricks / Composio | Omnigent meta-harness (reported 2026-06-17) / unified agent CLI [I - secondary] | Excluded category (runtime wrappers); watch items |
| Governance startups (Microsoft Agent 365 SDK, TrueFoundry, OneTrust, Bifrost/Maxim, Snyk) | Runtime governance of production agents (identity, traffic, RBAC, SIEM) | Different market; validates the "governance" narrative while leaving build-time, repo-committable, no-server config governance unoccupied [V] |

### 4.10 Demand evidence (ground truth)

#6235 cluster (~3,020+ upvotes, 220+ comments, 4× the next request, zero vendor response) [V]; a 15+-tool sync ecosystem - five sharing one name - spawning in 12 months to scratch the same itch [V]; **ETH Zurich ICSE 2026**: LLM-generated context files reduced task success 2–3% while raising cost 20%+ (context quality is measurable and bad by default) [V]; the March 2026 axios supply-chain attack driving pinning tools into existence [V]; Snyk's skill-scanning stats and the earlier 36%-injection audit quantifying skills-supply-chain anxiety [V/V-1]; carried context: >40% agentic-project cancellation prediction (Gartner), multi-agent normalization via Agent HQ [V-1]. Regulatory timing ([I], directional only given the shifting EU Omnibus schedule): compliance attention through 2026–2028 rewards build-time, evidence-producing tooling.

### 4.11 Occupied vs. open - the corrected one-table summary

| Layer | v2.0 said | v2.1 corrected state | GitMesh decision |
|---|---|---|---|
| Harnesses / meta-harnesses | Occupied | Occupied | Excluded by constraint |
| Fleet orchestration | Occupied (+2 deaths) | Occupied | Exited (legacy retired) |
| Rules/config **sync** | Occupied (2 tools) | **Saturated (15+ tools)** | Table stakes, not headline; interoperate + import |
| Workspace **audit/doctor** | Open - wedge | **Contested single-tool (incl. first-party `/checkup`); open cross-tool** | Wedge, differentiated on breadth + drift + benchmark honesty |
| **CI drift gate** as a product | Open | Open (only `--check` subcommands + mcp-lock's MCP-only Action exist) | Core layer |
| **Policy → native enforcement** (incl. org-managed files) | Open | **Open; nearest neighbors named** (ZacheryGlass 2-tool translator; PromptArmor service; managed-settings.com Claude web) | **Differentiator & moat** |
| Lockfile / integrity | Open | **Partially occupied per-surface** (mcp-lock; skills-lock.json) | Unified + interoperating lockfile |
| Skills distribution | Occupied (Vercel) | Occupied | Consume & pin |
| MCP/skill **content** security scanning | (unmapped) | Occupied (Snyk Agent Scan, Cisco) | Explicit non-goal; complementary |
| Line-level attribution | Occupied (Git AI) | Occupied + standardizing (Agent Trace) | Consume into receipts |
| Portable signed **workspace-state** receipts | Open | Open | Late layer, retention-gated |
| Enterprise runtime agent governance | (unmapped) | Occupied (funded startups) | Different market; adjacent narrative only |

---

## 5. Corrected Claims Ledger (including v2.0 → v2.1 deltas)

Corrections to earlier documents *and to v2.0 itself*, so the record stays clean. The v2.1 deltas (Δ) are the "did the research change the plan?" answer: **direction retained; five substantive adjustments; nothing reversed.**

| Earlier claim | Correct conclusion |
|---|---|
| **Δ1 (v2.0):** "Workspace audit/doctor + CI drift gate: Open - Wedge" | **Contested at single-tool granularity** (Claude first-party `/checkup` ~2026-07-08; cc-health-check; claude-config-doctor; agents-lint; AgentLint; AgentLinter; skill linters; sync-tool doctors). Open at *cross-tool* granularity. Doctor stays the wedge; differentiation = breadth + cross-tool drift + repo/CI-committable + benchmark honesty; headline shifts from "compile" to "audit + govern," compiler demoted to mechanism. |
| **Δ2 (v2.0):** "No tool exists that compiles one team policy into agents' native enforcement" | Essentially true, with one nearest neighbor now named: ZacheryGlass/agent-sync bidirectionally *translates* permissions between exactly two tools (Claude↔VS Code), lossily, ~3★. PromptArmor sells the outcome as a service. The compile-from-canonical-policy-with-coverage-matrix slot remains empty - and *larger*: org-managed surfaces (managed-settings.json, requirements.toml, Antigravity settings) are additional targets v2.0 missed. |
| **Δ3 (v2.0):** lockfile framed as novel | Partially occupied per-surface: mcp-lock (MCP pinning + attestation + SARIF Action), Vercel skills-lock.json (skill pinning). GitMesh's lockfile is the *unified* record and must interoperate with both (honor existing pins; reference, don't duplicate). |
| **Δ4 (v2.0):** sync category = "two active incumbents" | Fifteen-plus entrants including five distinct projects named "agentsync," symlink-based managers (agentlink, dallay, GowayLee), template engines (claaslange), and the architecturally-closest amtiYo/agents. Category is saturated/commoditizing; import-and-respect posture extended to the whole set. |
| **Δ5 (v2.0):** receipts sketch referenced DSSE only | Align the receipt predicate with in-toto/SLSA and consume the emerging **Agent Trace** spec (Git AI, Cline, OpenCode) - plugging into existing verifier ecosystems instead of a bespoke format. |
| skills.sh "89k+ skills" (cycle 2) | Conflicts with cycle-3 direct check (~4,257 skills, ~147/day). Adopt ~4.3k; treat 89k as a probable install/scrape conflation (§3 rule). |
| "Ruler v0.3.44, 31 agent targets" (cycle 2, no stars stated) | ~2.6k★ / 137 forks; "30+ agents" is the safe phrasing. |
| Agent HQ "GA 2026-02-26" (cycle 2) | Sources split Feb 4 (public preview live) vs Feb 26 (enterprise GA). Adopt "live Feb 2026." |
| Change Control plan's Gate-0 interviews; "70–90% ready"; hallucinated entities (TrustWarden AgentLedger, ToolWarden, Keel, NOA, Aevum) + five unconfirmable arXiv IDs (07-14) | All previously retracted; still retracted; never cite publicly. |
| "Claude Code added AGENTS.md support in spring 2026" (third-party) | Still false as of 2026-07-19 per official docs + tracker. |
| "Recommended wedge: `gitmesh sync`" (07-18 review) | Corrected in v2.0 (sync occupied) and re-confirmed harder in v2.1 (sync saturated). |

---

## 6. The User And Jobs To Be Done

### 6.1 Personas (adoption order)

1. **The multi-agent individual developer** (wedge persona). Runs 2–4 of Claude Code / Codex / Cursor / Copilot / Antigravity. Duplicate instruction files drift; MCP entries hand-copied; has never audited what their agents may do; may already use Ruler or a symlink manager. Zero budget, `npx`-native. *What `/checkup` gives them for Claude, GitMesh gives them for everything at once - plus the cross-tool drift no single-vendor feature can see.*
2. **The team lead / staff engineer standardizing a repo** (retention persona). Wants one reviewed source of truth; CI that fails when a generated file is hand-edited; a baseline policy (".env unreadable, destructive commands gated, MCP allowlist, skills pinned") holding for every teammate's agent of any brand - and, in orgs, wants that same policy expressed as the vendor-native *managed* artifacts (managed-settings bundle, requirements.toml) without hand-writing three formats.
3. **The OSS maintainer with an AI-contribution policy** (distribution persona). Wants contributors' agents to inherit conventions and guardrails from the repo; later, verifiable receipts for agent-assisted PRs. Adopts publicly; no procurement cycle.

### 6.2 Primary jobs

> **J1 (doctor):** "Show me every agent artifact in this repo - all vendors - where they disagree, and what's risky, without changing anything." *(Cross-tool: the job `/checkup`, cc-health-check, and agents-lint each do a fraction of.)*
> **J2 (compile):** "Define instructions, MCP servers, skills, commands, and permissions once; emit each tool's native files correctly - including the CLAUDE.md↔AGENTS.md shim - respecting anything my existing manager (Ruler/rulesync/.agents/symlinks) already owns."
> **J3 (check):** "Fail CI when generated files drift from source and tell the editor exactly which source file to change."
> **J4 (policy):** "Compile our baseline into each agent's own enforcement - per-repo *and* org-managed artifacts - and tell me honestly which agent can't enforce which rule."
> **J5 (receipt, later):** "Hand a third party one signed, offline-verifiable bundle showing which agents, versions, configs, and policies were in force for this change - linking to Agent Trace attribution where it exists."

### 6.3 Why the repo (not the org, not the runtime) is the right boundary

Every agent, of every vendor, reads configuration from the working tree - the one surface they all share. Git is the distribution mechanism (config reaches every teammate on `git pull`, zero infrastructure). CI on the repo is a real enforcement point without touching anyone's machine. The repo is where OSS distribution happens - a visible `.gitmesh/` in popular projects is self-propagating. And it is the boundary at which GitMesh's surviving assets (policy compiler, MCP/ACP code, forge sync, attestations) all still make sense. The org-managed artifacts of Layer 4 are *emitted from* the repo source of truth and handed to the org's existing distribution channel (MDM/console/fleet config) - GitMesh compiles them, it does not deliver them.

---

## 7. Positioning, Naming, Messaging

- **One-liner (updated per Δ1):** *GitMesh - audit and govern every coding agent from your repo. One source of truth for instructions, tools, and guardrails: doctored, compiled to each agent's native config, drift-checked in CI, enforced through each agent's own mechanisms.*
- **Category framing:** "Terraform/ESLint for coding-agent configuration." Lead with **audit + govern**; the compiler is the mechanism, never the pitch (Δ1). Never "control plane," "orchestration," or "governance platform" - those words rebuild the old adoption cliff.
- **Name:** keep **GitMesh** and the current repository (stars, LFDT residence, OpenSSF badge, contributor history). npm binary becomes **`gitmesh`** (new package); `gitmesh-agents` stays as the legacy alias. A side benefit surfaced by cycle 3: with five competing tools named "agentsync," a distinct, established name is an actual asset.
- **Honesty rules (standing, extended):** never claim uniform enforcement (always link the generated coverage matrix); never call an instruction a guardrail; never imply GitMesh blocks anything at runtime; state the Claude Code AGENTS.md status factually; disclose that `apply` rewrites only inside managed markers; **name the neighbors**: the docs maintain a benchmark page comparing gitmesh doctor with `/checkup`, cc-health-check, agents-lint, and AgentLint (T2.6), and a scanners page stating plainly that content-security scanning is Snyk Agent Scan's lane, not ours.

---

## 8. Product Scope

Five layers. Each ships independently, is useful alone, and is gated on the previous layer's retention metric (§16). Everything is a CLI subcommand + files; no server in any layer.

### 8.1 Layer 1 - `gitmesh doctor` (the wedge; zero writes)

`npx gitmesh doctor` on any repo:

1. **Inventory:** detect every known agent artifact (matrix §4.3) in repo + (with `--user`) user scopes - instruction files, rules dirs, MCP configs, skills dirs, commands/subagents, permission/hook/sandbox settings, org-managed artifacts if present - **and every recognized third-party manager**: `.ruler/`, `.rulesync/`, `.agents/agents.json`, agentsync-family state files, symlink topologies (agentlink/dallay/GowayLee-style), `skills-lock.json`, mcp-lock records, Claude plugin/marketplace configs. Managed-by-X artifacts are labeled informationally, never flagged as problems.
2. **Cross-tool drift report** (the capability no incumbent has): normalize instruction content (§10.4) and diff across tools - "CLAUDE.md and AGENTS.md diverged 14 lines; `.cursor/rules/style.mdc` holds 2 rules absent everywhere else; Codex has MCP server `github` that Claude lacks; skills `foo` pinned in skills-lock but absent from `.agent/skills/`."
3. **Risk findings** (versioned, ESLint-style IDs; each with a docs page - the SEO surface):
   - `GM001` plaintext secret/token in MCP env/args or agent settings (regex + entropy; values always redacted);
   - `GM002` no deny/ask protection for `.env`/secret paths in any agent that supports it;
   - `GM003` bypass-permissions / auto-approve / danger-full-access modes in committed config;
   - `GM004` skill present with executable content and **no recognized pin** (gitmesh lock, skills-lock.json, or mcp-lock all count as pins);
   - `GM005` same MCP server defined with different credentials/urls across tools;
   - `GM006` generated-looking file hand-edited (marker violation; pre-lockfile heuristic);
   - `GM007` instruction file exceeds effective-context threshold (configurable; cites the ICSE-2026 context-rot finding);
   - `GM008` orphan config for an agent unseen in repo history (informational);
   - `GM009` inconsistent local-vs-shared hygiene (`.gitignore` vs committed status);
   - `GM010` CLAUDE.md without an AGENTS.md bridge, or vice-versa (the #6235 finding; fix = the shim);
   - `GM011` **semantic contradictions** across a single tool's own config - permission-allow contradicted by a blocking hook; command/subagent referencing a nonexistent agent or skill (pattern proven by claude-config-doctor, generalized cross-tool).
4. **Output:** human TTY report (grouped, scored 0–100 - the UX pattern users already expect from cc-health-check/agents-lint), `--json` (stable versioned schema), `--md` (for PR comments), exit codes (0 clean / 1 findings / 2 errors), `--fail-on <severity>`. No network calls, no telemetry, nothing written, symlink-aware (reports through symlinks without dereferencing surprises).

### 8.2 Layer 2 - `gitmesh init` / `gitmesh apply` (compile and sync - table stakes, done honestly)

- **Canonical source = the standards, not a new format:** instructions live in **`AGENTS.md`** (GitMesh adds no proprietary instruction format); everything AGENTS.md doesn't cover lives in **`.gitmesh/workspace.yaml`** (MCP servers, skills with pins, commands, subagents, permission-policy refs, per-agent overrides).
- `gitmesh init` builds that source by **importing what exists**: full importers for `.ruler/`, `.rulesync/`, and `.agents/agents.json` (amtiYo), plus native-file import for everything else - never from a blank template when artifacts are present. `gitmesh migrate` is the same path with a friendlier name for users of those tools.
- `gitmesh apply` compiles source → native files per adapter; `--dry-run` prints a Terraform-style plan; only content inside `<!-- gitmesh:managed -->` markers (or whole-file where the adapter contract says so) is rewritten; **lossy projections are always reported, never silent**: the UX rule rulesync and spxrogers proved out, generalized. Claude adapter's signature move: a minimal CLAUDE.md that `@AGENTS.md`-imports the shared source plus Claude-only extras - the #6235 workaround as a product.
- `.gitmesh/lock.json` records emitted-file hashes + skill/MCP pins (referencing skills-lock.json / mcp-lock entries where present rather than duplicating them) + adapter versions.

### 8.3 Layer 3 - `gitmesh check` (drift gate in CI)

Recompute plan against lock + sources; exit non-zero on drift with a which-source-file-to-edit message. Ship a composite **GitHub Action** (`gitmesh/check-action`: doctor + check, `--md` report as PR comment/summary, no secrets required), pre-commit config, README badge; GitLab/Forgejo templates follow (forge-sync heritage). This remains genuinely unoccupied as a cross-tool product - the only shipping CI gates are sync tools' own `--check` flags and mcp-lock's MCP-only SARIF Action (§4.7).

### 8.4 Layer 4 - `gitmesh policy` (the differentiator and moat)

- Policy packs are YAML (`.gitmesh/policies/*.yaml`) with a small vocabulary: `deny_read`, `deny_write`, `require_approval_command`, `deny_command`, `mcp_allow`, `skill_pin_required`, `forbid_bypass_modes`, plus raw per-agent passthrough; `extends:` composition.
- The compiler (evolved from GitMesh's YAML→OPA path) targets **two tiers per agent**:
  - *Repo tier:* Claude `settings.json` permissions + hooks + MCP allow/deny keys; Codex `.codex/config.toml` approval/sandbox (with the **project-trust caveat surfaced in output**: an untrusted project's config.toml is ignored, so the plan says so); Codex `execpolicy` `.rules` where the rule maps; OpenCode permission JSON; Cursor emitted hook scripts; Antigravity allowed/denied commands + `enableTerminalSandbox`.
  - *Org tier (new in v2.1, Δ2):* a **managed-settings bundle** (managed-settings.json + `.d` fragments, ready for Jamf/Kandji/Intune/GPO or the claude.ai console) and a **`requirements.toml`**: emitted artifacts the org distributes through channels it already has. GitMesh compiles; the org delivers.
- Every compile emits a **coverage report**: rule × agent × tier → `enforced-native` / `enforced-hook` / `advisory-instruction-only` / `unsupported`, generated from adapter capability flags so the matrix can never drift from reality (§10.6). Advisory fallback only behind an explicit flag, always labeled.
- Ship 3 built-in packs at launch (`baseline-hygiene`, `oss-contributor`, `secrets-strict`) + `gitmesh policy test` (a clearly-labeled simulation replaying hypothetical tool calls against compiled rules per agent semantics).

### 8.5 Layer 5 - `gitmesh receipt` (retention-gated; do not start before §15 G3+G4)

DSSE/Ed25519-signed deterministic bundle of **workspace state**: sources snapshot + lock + coverage + doctor findings + tool-version census + (when present) Agent Trace / `refs/notes/ai` extracts and trailer census for a commit range. Predicate aligned with **in-toto Statement / SLSA** conventions so existing verifiers slot in (Δ5). `gitmesh receipt verify` runs offline, separates signature-validity from signer-trust, and lists what is *not* proven. Non-goals: no attribution engine, no runtime capture, no compliance claims.

### 8.6 Explicit non-goals (standing, extended)

No server or daemon in the default path; no agent runtime or wrapper; no MCP/model gateway; no marketplace; no trace backend; no heuristic AI-code detection; **no prompt-injection / tool-poisoning / malicious-content scanning** (Snyk Agent Scan's and Cisco's lane - GitMesh checks *hygiene and structure*, and the docs say so plainly); no blocking anything GitMesh itself executes; no new instruction-file format; no hosted service before sustained retention (then convenience-only).

---

## 9. Honest Audit Of The Current Repository (what exists vs. what this pivot needs)

Ground truth [V]: pnpm workspaces `cli/`, `lib/`, `server/`, `ui/`, `skills/`, `playbooks/`, `agents/triage/`, `docker/`, `governance/`; TypeScript 97.6%; Vitest; Changesets; Drizzle→PostgreSQL (embedded under `~/.gitmesh-agents/`); Docker images; npm `gitmesh-agents`; OpenSSF Silver; DCO; weekly dev call; two maintainers.

### 9.1 Keep and repurpose (~30–40% transfers)

| Asset | Today | In the pivot |
|---|---|---|
| YAML→Rego/OPA policy compiler + evaluator | Gates server-side agent actions | Core of `gitmesh policy`: same front-end vocabulary, new back-ends emitting native + org-managed agent configs; OPA/Wasm optional for custom rules |
| CLI package (`cli/`) | Onboarding/`doctor --repair`/server start | Becomes the product; its `doctor` concept reborn as the wedge |
| Ed25519 attestation code + retrying queue | Per-activity signing | `gitmesh receipt` signing core (DSSE envelope; offline verifier; in-toto-aligned predicate) |
| MCP server + ACP client/orchestrator code | Governed-MCP runtime | Parsers/serializers + protocol knowledge for MCP-config adapters; optional `gitmesh mcp serve` companion kept non-default |
| Forge sync (GitHub/GitLab/Forgejo) | Webhook bidirectional sync | Only API-client + CI-integration knowledge survives (Action, GitLab/Forgejo templates); webhook runtime retired |
| Schema/validation discipline, Vitest + Changesets + monorepo CI | - | Reused for the IR schema and adapter contract tests |
| Governance/community assets: LFDT residence, OpenSSF badge, contributor ladder, weekly call | - | Retained - they are the neutrality story, now sharpened by contrast with a category of solo side-projects (§4.4) |

### 9.2 Retire from the default path (kept in-tree behind `gitmesh legacy` until v2, then extracted)

Heartbeat scheduler and agent runtime; pre-defined agent roles; tasks/goals/comments; budgets/cost events; dashboard UI; embedded PostgreSQL; webhook server; Docker-first story. **Nothing in Layers 1–4 may import from `server/` or touch a database**: enforced by lint from day one (T0.4).

### 9.3 Does not exist yet (the build)

Artifact detectors (incl. third-party-manager and symlink awareness); normalization + cross-tool drift; risk-rule engine (GM001–GM011); the IR; importers (native + Ruler/rulesync/.agents) and emitters per agent; managed-marker merge engine; unified lockfile with skills-lock/mcp-lock interop; plan renderer; policy back-ends (repo tier + org tier) + generated coverage matrix; GitHub Action; receipt bundler/verifier; golden-file corpus; format-canary CI; benchmark page.

---

## 10. Architecture

### 10.1 Principles

1. **Files in, files out.** No network in `doctor`/`apply`/`check` except explicit `skill add` fetches. Deterministic: same inputs → byte-identical outputs (stable ordering, no wallclock in emitted files).
2. **Standards are the source format.** AGENTS.md as-is; SKILL.md as-is; Agent Trace consumed as-is; `workspace.yaml` only for what no standard covers. If AAIF (or anyone credible) standardizes something GitMesh invented, migrate to the standard and deprecate ours - a written commitment.
3. **Never own what you can reference.** Skills pinned by source+version+sha256, honoring existing skills-lock/mcp-lock records; attribution read from Agent Trace/`refs/notes/ai`, never reimplemented; content-security verdicts left to the scanners that own that lane.
4. **Adapters are contracts.** One interface, one conformance suite, one doc page per agent; capability flags declare what each adapter can and cannot express - per rule, per tier - and the coverage matrix is *generated from those flags*, never hand-written.
5. **Honest merge semantics.** GitMesh owns managed regions; humans own everything else; hand edits inside managed regions are drift, reported with the source file to edit; **lossy projections are always reported** in plan/apply output.
6. **Coexistence semantics.** A third-party manager's territory (Ruler outputs, symlinked files, skills-lock-pinned skills) is detected, labeled, and left alone unless the user explicitly migrates. GitMesh must never fight another manager for a file.
7. **Local trust boundaries.** User-scope reads only with `--user`; reports never print secret values; receipts redact by default.

### 10.2 System view

```
            ┌──────────────────────────────────────────────────────┐
            │                      sources                         │
            │   AGENTS.md    .gitmesh/workspace.yaml    policies/  │
            └───────┬───────────────┬───────────────┬──────────────┘
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────────┐  ┌────────────────┐
detectors ───▶│ importers│──▶│  Workspace IR │◀─│ policy compiler│
(native files,└──────────┘   │  (zod-typed)  │  └──────┬─────────┘
 .ruler/ .rulesync/          └──────┬────────┘         │  capability
 .agents/agents.json                │                  ▼  flags
 symlink topologies                 ▼            coverage.json
 skills-lock / mcp-lock)     ┌────────────┐
                             │  emitters  │  repo tier + org tier
                             └──────┬─────┘
                                    ▼
   native files (CLAUDE.md shim, .claude/settings.json, .codex/config.toml,
   execpolicy .rules, .cursor/rules/*.mdc + hooks, .mcp.json, opencode.json,
   antigravity settings, .github/instructions/*, skills dirs, …)
   org artifacts (managed-settings bundle, requirements.toml)
                                    │
                                    ▼
                       .gitmesh/lock.json ──▶ gitmesh check (CI)
                                    │
                                    ▼ (optional, gated)
                       gitmesh receipt → DSSE bundle (in-toto/SLSA-aligned)
                                          + Agent Trace ingestion + verifier
```

`doctor` = detectors + normalizer + GM rules over *whatever exists*, IR-optional. `apply` = importers → IR → emitters → lock. `check` = recompute vs lock. `policy` = policy docs → permission IR → capability flags → native + org output + coverage.

### 10.3 Core model (files, not databases)

- **`WorkspaceIR`** (in-memory, zod-typed): `instructions` (ordered blocks with scope globs + provenance), `mcpServers[]` (env *references*, never values), `skills[]` (name, source, version, sha256, pin-source ∈ {gitmesh, skills-lock, mcp-lock}, target agents), `commands[]`, `subagents[]`, `permissionModel` (§10.5), `agentOverrides{}`.
- **`.gitmesh/workspace.yaml`**: the only new user-facing file; `$schema` published; `x-agent:<name>` override blocks.
- **`.gitmesh/lock.json`**: `{ gitmeshVersion, adapters:{name→version}, outputs:{path→{sha256, adapter, managedRegions}}, skills:{name→{resolved, sha256, pinSource}}, orgArtifacts:{…}, generatedAt:<commit-ish only> }`. Where skills-lock.json or an mcp-lock record already pins something, lock.json stores a *reference + verified hash*, not a competing pin (Δ3).
- **`.gitmesh/policies/*.yaml`** - packs; three built-ins vendored read-only.

### 10.4 Instruction normalization (what "drift" means, precisely)

Markdown → block list (headings, paragraphs, fences, lists) → strip adapter wrappers/markers → normalize whitespace → stable hash per block and document. Cross-tool drift = set/sequence diff of block hashes with provenance. Cursor `.mdc` frontmatter and Copilot `applyTo` map scoped rules ↔ IR scope globs. Content inside managed markers compares against expected emitter output; content outside is user-owned and participates only in cross-tool divergence reporting. Symlinks resolve to a single logical document (a symlinked CLAUDE.md→AGENTS.md is *zero* drift and reported as the healthy pattern it is).

### 10.5 Permission model (the policy IR)

Only concepts at least two agents can natively express; everything else is passthrough or advisory-by-flag:

```yaml
version: 1
rules:
  - id: protect-secrets
    deny_read: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "secrets/**"]
  - id: gate-destructive
    require_approval_command: ["rm -rf *", "git push --force*", "curl * | sh"]
  - id: mcp-allowlist
    mcp_allow: ["github", "postgres-dev"]
  - id: no-bypass
    forbid_bypass_modes: true
  - id: pin-skills
    skill_pin_required: true
scopes:            # v2.1: which tier(s) a pack compiles to
  repo: true
  org: false       # org tier emits managed-settings bundle + requirements.toml
```

Backend mapping highlights (full matrix generated, §10.6): `deny_read` → Claude `permissions.deny Read(...)` / OpenCode read-pattern denies / Cursor `beforeReadFile` hook / Codex sandbox note (advisory unless the pinned Codex version maps it) / Antigravity denied-commands where expressible. `require_approval_command` → Claude ask-patterns or PreToolUse hook / Codex `approval_policy` / Cursor `preToolUse` / Antigravity command lists. `forbid_bypass_modes` → Claude `disableBypassPermissionsMode` (org tier: managed-settings) / Codex approval floor (org tier: `requirements.toml` `allowed_approval_policies`) / GM003 elsewhere. `mcp_allow` → Claude `allowedMcpServers` (org tier: `allowManagedMcpServersOnly`) / requirements.toml MCP allowlist / structural emit-only-allowlisted elsewhere + coverage note. Unmappable → `unsupported`, loudly. The Codex project-trust caveat and VS Code's no-hard-deny limitation are first-class coverage annotations, not footnotes.

### 10.6 Adapter contract

```ts
interface AgentAdapter {
  name: string; version: string;                 // adapter semver, in lock
  detect(repo): DetectedArtifact[];              // doctor (symlink- & manager-aware)
  importArtifacts(repo): Partial<WorkspaceIR>;   // init/migrate
  capabilities(): CapabilityFlags;               // per rule × {repo, org} tier →
                                                 // native | hook | advisory | unsupported
  plan(ir): PlannedWrite[];                      // pure; lossy projections listed
  emit(ir): FileEdit[];                          // managed-marker aware
  fixtures: GoldenFixture[];                     // conformance suite (§18)
}
```

Launch adapters: `claude-code`, `codex`, `cursor`, `copilot`, `antigravity`, `agentsmd` (pure), `opencode`. Source-importers: `ruler`, `rulesync`, `agents-json` (amtiYo). Community tier thereafter - each requires fixtures + capability flags to merge; this is the contributor on-ramp (§17.3), and cycle 3's census doubles as the "adapter wanted" issue list.

### 10.7 Receipt format (Layer 5 sketch; final design deferred)

Deterministic bundle `gitmesh-receipt-v1/`: DSSE-signed in-toto Statement (`manifest.dsse.json`, Ed25519; predicate type published) over: `workspace/` sources snapshot, `lock.json`, `coverage.json`, `doctor.json`, `attribution/` (Agent Trace / `refs/notes/ai` extracts + trailer census, when present - absence is "attribution: none available," never an error), `tools.json` version census, `README.txt`. Verifier checks archive safety, DSSE, digests, schema; reports signature-valid vs signer-trusted separately; lists what is not proven (truth, completeness, causality).

### 10.8 Repository restructure and migration

1. New packages `lib/workspace-core` (IR, normalizer, GM rules, lock, merge engine) + `lib/adapters/*`; CLI gains `doctor|init|migrate|apply|check|policy|skill|receipt`; legacy server commands under `gitmesh legacy`.
2. Import-boundary lint (T0.4): `workspace-core`/`adapters` may not import `server/**`, Drizzle, or `pg*`.
3. npm: publish **`gitmesh`** (CLI-only, small, provenance-signed); `gitmesh-agents` continues for legacy, README-marked maintenance-mode; deprecation decision at v1.0.
4. `server/`, `ui/`, heartbeat, Postgres: untouched, excluded from the new install path and required CI; extraction to `gitmesh-legacy` after two silent releases.
5. README/docs rewritten around the wedge at launch; old positioning → `docs/legacy/`.

---

## 11. Implementation Roadmap - Overview

Backlog rules: every task is **one PR**, sized 0.5–2 maintainer-days, independently mergeable behind the previous task, with acceptance criteria (AC) testable in CI. Two maintainers ⇒ ~6 productive PR-days/week combined. Change-triggers (CT, §15) can reorder phases; nothing else does.

| Phase | Epics | Calendar (target) | Exit gate |
|---|---|---|---|
| P0 Foundation | E0 | Week 1 | `pnpm i && pnpm test` green with new packages; legacy quarantined |
| P1 Wedge | E1 doctor, E2 release/launch | Weeks 1–4 | **G1:** doctor launched; ≥200 unique runs wk-1 |
| P2 Compiler | E3 IR+init/migrate, E4 emitters, E5 apply/lock | Weeks 4–8 | **G2:** apply GA for 7 adapters; ≥75 repos with committed `.gitmesh/` |
| P3 CI | E6 check+Action | Weeks 8–10 | **G3:** ≥40 weekly-active check repos, 3 consecutive weeks |
| P4 Policy | E7 policy packs (repo + org tier) | Weeks 10–14 | **G4:** ≥15 repos with a policy pack; coverage matrix cited externally ≥1× |
| P5 Receipts | E8 | Only after G3+G4 | per §15 |

## 12. Task Backlog (micro-tasks)

### E0 - Foundation (P0)

- **T0.1** `lib/workspace-core` package skeleton (tsconfig, vitest, exports); empty `WorkspaceIR` zod schema compiling. *AC: unit test imports schema; CI green.*
- **T0.2** `lib/adapters` package + `AgentAdapter` interface + lazy registry. *AC: registry lists 0 adapters; type-checked.*
- **T0.3** `gitmesh` CLI entry; scaffolds `doctor|init|migrate|apply|check|policy` printing "not implemented"; legacy under `gitmesh legacy`. *AC: `--help` shows new tree; legacy still runs.*
- **T0.4** ESLint boundary rule: core/adapters cannot import `server/**`, `drizzle*`, `pg*`. *AC: violating import fails CI.*
- **T0.5** Golden-fixture harness: `fixtures/<adapter>/<case>/{input-repo/, expected/}` byte-exact runner. *AC: dummy fixture passes.*
- **T0.6** npm `gitmesh` publish pipeline (changesets, `--provenance`, clean-container `npx` smoke test). *AC: `npx gitmesh@next --version` works.*
- **T0.7** ADR-001 canonical source = AGENTS.md + workspace.yaml; ADR-002 no-server rule; ADR-003 managed-marker merge semantics; **ADR-004 coexistence semantics** (third-party managers detected-and-respected; migrate only on explicit command). *AC: four ADRs merged.*

### E1 - `gitmesh doctor` (P1)

Detector tasks (one per adapter: `detect()` from §4.3 + ≥3 fixtures incl. a negative; all symlink-aware):
- **T1.1** `claude-code` detector (CLAUDE.md tree incl. subdirs + `~` with `--user`, CLAUDE.local.md, `.claude/{rules,skills,commands,agents,settings.json,settings.local.json}` with git-root rule, `.mcp.json`, plugin/marketplace configs, managed-settings presence probe).
- **T1.2** `codex` detector (AGENTS.md nested, `.codex/config.toml`, `.agents/skills/`, `.codex/agents/*.toml`, execpolicy `.rules`, `CODEX_HOME` hint, requirements.toml presence probe).
- **T1.3** `cursor` detector (`.cursor/rules/*.mdc` frontmatter parse, legacy `.cursorrules`, `.cursor/mcp.json`, `.cursor/agents/`, hooks config).
- **T1.4** `copilot` detector (`.github/copilot-instructions.md`, `.github/instructions/**` recursive + `applyTo`, `.github/agents/`, `.vscode/mcp.json`, auto-approve booleans in `.vscode/settings.json` - report which `chat.tools.*.autoApprove` keys are set, never arbitrary settings values, AGENTS.md at any depth).
  *(Wording clarified 2026-08-06 during the PR #459 review: "AGENTS.md flag" meant the AGENTS.md instruction surface - detect at any depth like T1.2/T1.3, matching the coding agent's nested-AGENTS.md support; VS Code gates nesting behind the experimental `chat.useNestedAgentsMdFiles` setting. `.github/instructions/` is searched recursively per VS Code docs, so the old flat `*` glob understated the surface. The real auto-approve keys are `chat.tools.global.autoApprove`, `chat.tools.terminal.autoApprove`, and `chat.tools.urls.autoApprove` - the "`settings.perm.json`-style" shape named in §4.3 does not exist.)*
- **T1.5** `antigravity` detector (GEMINI.md, `.gemini/settings.json`, `.agent/skills/`, antigravity-cli settings probe, plugin bundles).
- **T1.6** `opencode` + `agentsmd` + `devin/windsurf` + `cline/roo` detectors (grouped; per-tool fixtures).
- **T1.7** Third-party-manager detectors: `.ruler/` + ruler.toml, `.rulesync/`, `.agents/agents.json`, agentsync-family state files (`.agentsync-state.json` etc.), symlink-topology mapper (agentlink/dallay/GowayLee patterns), `skills-lock.json`, mcp-lock records - all reported as "managed by X," informational, with coexistence note. *AC: doctor on a Ruler repo and on a symlink-managed repo says so and suggests nothing destructive.*
- **T1.8** Markdown normalizer + block hasher (§10.4), 15+ unit cases (whitespace, fences, frontmatter, markers, symlink resolution).
- **T1.9** Cross-tool drift differ (block set/sequence diff; per-pair summary; "present in A missing in B/C"; symlink = zero-drift healthy pattern). *AC: seeded 3-way-drift fixture reports exactly the seeded lines.*
- **T1.10** Risk-rule engine (rule interface: id, severity, appliesTo, check→findings; table-driven).
- **T1.11–T1.15** Rules **GM001–GM011** in five PRs of 2–3 rules each; every rule with triggering + non-triggering fixtures; GM001 with the redaction-guarantee test (secret value absent from every output mode); GM004 recognizes gitmesh/skills-lock/mcp-lock pins; GM011 covers allow-vs-hook contradictions + dangling references, cross-tool.
- **T1.16** Renderers: TTY (grouped, colored, 0–100 score), `--json` (versioned schema), `--md`. *AC: snapshot tests ×3.*
- **T1.17** Exit codes + `--fail-on`; fs-write spy proves doctor never writes; network spy proves zero calls.
- **T1.18** Performance guard: 5k-file repo < 2s (CI benchmark fixture).
- **T1.19** **Benchmark-parity checklist:** enumerate every check `/checkup`, cc-health-check, agents-lint, and AgentLint publish; map each to a GM rule, an inventory item, or a documented "out of scope (here's who does it)". *AC: `docs/comparisons.md` table complete; no unmapped check.*

### E2 - Release & launch (P1)

- **T2.1** Docs site v1: 90-second quickstart, one page per GM finding (SEO surface), coverage-matrix placeholder, scanners page ("content security = Snyk Agent Scan/Cisco; we do structure & hygiene").
- **T2.2** README rewrite around audit+govern; legacy → `docs/legacy/`; terminal GIF of `npx gitmesh doctor`.
- **T2.3** ADR-005 **no telemetry**; measurement via npm downloads + Action adoption + opt-in `.gitmesh/metrics-optin` ping only. *AC: network-spy test in CI.*
- **T2.4** Launch kit: Show HN ("Show HN: GitMesh – audit every AI coding agent's config in your repo - all vendors at once"); posts where the pain lives (#6235 thread-adjacent, r/ClaudeAI, r/ChatGPTCoding, lobste.rs); the **fragmentation-census data post** (script runs doctor across top-500 OSS repos containing AGENTS.md; publishes drift/risk stats; reproducible from `scripts/`). *AC: both maintainers review; census reproducible.*
- **T2.5** Coexistence outreach: friendly issues to Ruler/rulesync/amtiYo offering importer compatibility + link exchange. *AC: issues opened; tone reviewed.*
- **T2.6** **Benchmark honesty page** (from T1.19) published and linked from README: gitmesh doctor vs `/checkup`, cc-health-check, agents-lint, AgentLint - what each does, when to use which. *AC: factual, respectful, dated.*
- **T2.7** **Competitor-watch ritual:** a `WATCHLIST.md` + weekly 30-minute changelog review (amtiYo/agents, ZacheryGlass/agent-sync, PromptArmor, Ruler, rulesync, Claude Code release notes, Codex release notes, Agent HQ, AAIF announcements) with the CT triggers (§15) pasted at the top. *AC: file merged; first review logged.*

### E3 - IR + `gitmesh init` / `migrate` (P2)

- **T3.1** Full `WorkspaceIR` schema (instructions blocks w/ provenance+scopes; mcpServers env-ref-only invariant; skills w/ pinSource; commands; subagents; permissionModel stub; agentOverrides). *AC: JSON Schema artifact published.*
- **T3.2** `workspace.yaml` reader/writer (comment-preserving; `$schema` header).
- **T3.3–T3.9** Native importers per adapter (claude-code → codex → cursor → copilot → antigravity → opencode → agentsmd), each `importArtifacts()` + round-trip fixture.
- **T3.10** Source importers: `.ruler/` and `.rulesync/` → IR. **T3.11** `agents-json` importer (`.agents/agents.json`, amtiYo) → IR. *AC: `gitmesh migrate` on each tool's demo repo yields a reviewed golden workspace.*
- **T3.12** `gitmesh init`: detectors → importers → propose AGENTS.md (prefer existing; else synthesize from richest source with provenance comments) → write workspace.yaml → print what came from where; `--dry-run` default-on in first release; conflict prompter (keep-A/keep-B/keep-both-scoped) + non-interactive `--strategy`. *AC: init on 6 archetype fixtures (adds "symlink-managed" archetype) produces reviewed goldens.*

### E4 - Emitters (P2)

Shared ACs: managed-marker correctness (edits outside markers survive), byte-determinism, fresh + brownfield goldens, capability flags declared, **lossy projections listed in plan output**:
- **T4.1** `agentsmd` emitter (identity + nested files by scope).
- **T4.2** `claude-code` emitter (CLAUDE.md shim `@AGENTS.md` + claude-only extras; managed-key deep-merge of `.claude/settings.json`; `.mcp.json`; skills copy w/ hash check; commands/subagents).
- **T4.3** `codex` emitter (`.codex/config.toml` managed table; `.agents/skills/`; subagent TOML; **project-trust caveat surfaced in plan output**).
- **T4.4** `cursor` emitter (scoped blocks → `.cursor/rules/*.mdc`; `.cursor/mcp.json`; agents).
- **T4.5** `copilot` emitter (instructions + `applyTo`; `.vscode/mcp.json`; `.github/agents`).
- **T4.6** `antigravity` emitter (GEMINI.md shim mirroring T4.2; settings.json MCP block; skills dir).
- **T4.7** `opencode` emitter.
- **T4.8** Marker/merge engine hardening: three-way cases (edited managed region → drift path; edited outside → preserved; deleted file → recreated with notice; **symlinked target → respected, not replaced**) as a dedicated test PR.

### E5 - `gitmesh apply` + lock (P2)

- **T5.1** Planner: IR + adapters → `PlannedWrite[]`; Terraform-style `--dry-run` (create/update/no-op/blocked/lossy counts per adapter).
- **T5.2** Writer: atomic tmp+rename; centralized first-touch backup (`.gitmesh/backup/`); `apply --revert`.
- **T5.3** `lock.json` writer/reader (versioned; hashes; adapter versions; skill/MCP pins **with pinSource references to skills-lock.json / mcp-lock where present**). *AC: repo with an existing skills-lock.json locks by reference; no duplicate pin.*
- **T5.4** `gitmesh skill add <source>[@version]`: resolve (GitHub URL or skills.sh slug), download, sha256-pin, place per target-agent dirs; if `skills` CLI manages the repo, defer install to it and record the verified hash. *AC: tampered-content fixture fails loudly; skills-lock interop fixture passes.*
- **T5.5** `.gitignore` management behind `--manage-gitignore` (CI-safe default off).
- **T5.6** Dogfood: GitMesh's own CLAUDE.md/AGENTS.md/skills become gitmesh-managed. *AC: repo's agent config generated by the tool.*

### E6 - `gitmesh check` + Action (P3)

- **T6.1** `check`: recompute vs lock + sources; drift names the *source* file to edit; exit codes; `--md`.
- **T6.2** Composite Action `gitmesh/check-action@v1` (doctor+check, PR comment, job summary, pinned node, no secrets). *AC: demo-repo PR shows comment.*
- **T6.3** pre-commit config + docs. **T6.4** README badge (static shields recipe). **T6.5** GitLab + Forgejo/Woodpecker templates. **T6.6** weekly-active-repos measurement script from Action adoption (public methodology page - the §16 metric).

### E7 - `gitmesh policy` (P4)

- **T7.1** Policy YAML schema + `extends` + tier `scopes` + validation errors with rule ids.
- **T7.2** Permission IR + capability-flag extension (per rule × {repo, org} tier → native|hook|advisory|unsupported).
- **T7.3** Coverage-matrix generator (flags → `coverage.json` + docs table; CI regenerates; diff fails - the matrix can never lie).
- **T7.4** claude-code repo-tier backend (permissions allow/deny/ask; hook emission for command gating; `disableBypassPermissionsMode`; MCP allow/deny keys). *AC: golden settings.json for the three built-in packs.*
- **T7.5** codex repo-tier backend (approval_policy/sandbox_mode; execpolicy `.rules` where a rule maps; advisory labeling for unmappables; trust caveat in output).
- **T7.6** opencode backend (permission JSON patterns). **T7.7** cursor backend (emitted hook scripts w/ provenance header + hash in lock). **T7.8** antigravity backend (allowed/denied commands, `enableTerminalSandbox`).
- **T7.9** **Org-tier: managed-settings bundle emitter** (managed-settings.json + `.d` fragments + MDM/console deployment README). *AC: goldens for the three packs; docs page.*
- **T7.10** **Org-tier: `requirements.toml` emitter** (`allowed_approval_policies`, `sandbox_modes` ceiling, MCP allowlist). *AC: goldens; docs page.*
- **T7.11** Built-in packs `baseline-hygiene`, `secrets-strict`, `oss-contributor` (pack + per-backend goldens + one doc page each).
- **T7.12** `gitmesh policy test` (clearly-labeled simulation: hypothetical tool calls → expected allow/ask/deny per agent semantics).
- **T7.13** Doctor integration: `GM012 policy pack present but compiled output stale`.

### E8 - `gitmesh receipt` (P5; gated on G3+G4)

- **T8.1** DSSE envelope + Ed25519 signer extracted from existing attestation code; in-toto Statement predicate type published.
- **T8.2** Deterministic bundle builder (§10.7 layout; redaction pass with seeded-canary test).
- **T8.3** Agent Trace / `refs/notes/ai` ingestion + trailer census (absence = "none available," never an error).
- **T8.4** `receipt verify` (archive-safety, digest walk, signature-vs-trust separation, not-proven list). **T8.5** Docs + one persona-3 OSS pilot.

### Cross-cutting standing tasks

- **TX.1 Format-canary CI** (weekly): detectors + emitters against latest released Claude Code/Codex/Cursor/Copilot/Antigravity in a container matrix; any shape change auto-files an issue. *Adapter rot is the #1 technical risk (R6) - this is the moat-maintenance task.*
- **TX.2** Every user-visible string change ships docs in the same PR. **TX.3** Changeset per PR; weekly releases. **TX.4** 48h triage SLA during launch months. **TX.5** The T2.7 watch ritual runs weekly forever; CT triggers reviewed against it.

## 13. Roadmap view (Now / Next / Later)

- **Now (Weeks 1–4):** E0, E1, E2 → public doctor with the benchmark page. The deadline logic sharpened in v2.1: Anthropic shipped a single-tool doctor **eleven days before this document**: every week of delay is a week in which "audit" becomes a vendor-feature word instead of a cross-tool category GitMesh named first.
- **Next (Weeks 4–10):** E3–E6 → init/migrate/apply/lock/check + Action; dogfood; hands-on recruit 3 persona-3 OSS repos.
- **Later (Weeks 10–16+):** E7 policy (repo tier, then org tier - the moat becomes visible); E8 only after G3+G4; then community adapters (census-seeded), GitLab/Forgejo parity, `gitmesh mcp serve` companion revival only if users ask.

---

## 14. Risk Register

Probability × impact H/M/L; every risk has a response *and* a detection signal wired to §15/§16. Changes from v2.0 marked.

| # | Risk | P | I | Response | Detection / kill signal |
|---|---|---|---|---|---|
| R1 | **A sync incumbent moves up-stack**: Ruler/rulesync add cross-tool doctor+CI-gate, or **amtiYo/agents adds enforcement compilation** (v2.1: amtiYo named - architecturally closest) | M | H | Ship the wedge fast; import-first coexistence makes switching *toward* GitMesh free; differentiate where solo projects structurally lag (org-tier backends, generated coverage matrix, unified lockfile, LF-neutral governance, conformance suites); offer adapter-sharing upstream | Weekly watch ritual (T2.7). Either ships an equivalent cross-tool doctor+gate before G1 → accelerate policy layer and evaluate collaboration before competing. amtiYo ships enforcement → CT2 fires (§15) |
| R2a | **A vendor ships cross-vendor config portability** (e.g., Claude Code reads AGENTS.md natively + imports others' configs) | M | M→H | Native AGENTS.md support *helps* (one shim deleted; doctor/policy untouched); full cross-vendor portability by one vendor remains lock-in-incoherent - #6235's 8-month silence and Cursor's copy-Claude-hooks pattern say convergence happens by imitation, not by portability features | ≥2 major vendors reading *each other's* full config → K3 |
| R2b | **Vendor first-party doctor**: *partially fired*: Anthropic shipped Claude-only `/checkup` 2026-07-08 (v2.1: new) | **H (occurred, single-tool)** | M | Pre-committed response executed in this plan: cross-tool breadth is the axis; benchmark page (T2.6) frames `/checkup` as complementary; GM011-class semantic checks and cross-tool drift stay beyond a single vendor's reach | A vendor or GitHub ships a **cross-tool** doctor → CT1 fires: demote doctor to loss-leader, accelerate E7, re-run §4 |
| R3 | **AGENTS.md convergence makes instruction drift trivial** | M | M | Drift value shifts to MCP/skills-paths/permissions - which are *not* converging (three skills dirs; zero permission standards; org-managed formats multiplying) | Instructions-drift findings <20% of doctor findings by G3 → reweight marketing to policy |
| R4 | **AAIF ships official AGENTS.md validation tooling** | M | M | Opportunity: GitMesh is LF-family; propose our validator + fixtures upstream; official tooling would validate AGENTS.md files, not compile N-agent workspaces (and cycle 3 found no such CLI exists yet) | AAIF announcements in watch ritual |
| R5 | **Cold start repeats: launch lands flat** | M | H | npx-zero-risk wedge; data-story launch (census, T2.4) not just a tool; three staged news moments (doctor → apply → policy); persona-3 hands-on recruiting; benchmark page captures comparison-shopping search traffic | K1/K2 discipline (§15) |
| R6 | **Adapter rot**: vendors change formats weekly (Codex: 300+ releases in H1) | H | M | TX.1 format-canary; adapter versions pinned in lock; capability flags make gaps explicit; small IR = small blast radius; community adapter ownership | Canary failure >2/month sustained → K5 (freeze to core-7) |
| R7 | **Maintainer bandwidth (2 people)** | H | H | Serial micro-task backlog; scope fences §8.6; policy reuses existing compiler; org-tier backends are emitters, not services; weekly release rhythm | Two consecutive zero-merge weeks → cut P4 to claude+codex backends only |
| R8 | **Policy layer misread as a security product** (excluded domain; invites unfair scrutiny) | M | M | Positioning discipline (§7): configuration management for vendors' own enforcement; scanners page names who does content security; coverage matrix + `policy test` keep claims falsifiable; no CVE/injection features ever | Press/user labeling → messaging fix + FAQ, not feature retreat |
| R9 | **GitMesh becomes a supply-chain vector** (emits files agents obey; hook scripts) | L | H | Deterministic outputs; provenance headers + lock hashes on every emitted script; npm `--provenance`; no postinstall; skills pinned; SECURITY.md + OpenSSF practices already held | Any injected-content report → public incident + postmortem |
| R10 | **Legacy users (if any) broken by repositioning** | L | L | `gitmesh legacy` + `gitmesh-agents` alias through v1.x; migration doc | Issue tracker |
| R11 | **Fact rot in this document** | H | L | Verdict labels; §19 index; §3 conflicting-figure rule; quarterly re-verification task; T2.7 ritual | - |
| R12 | **Lockfile overlap friction** with mcp-lock / skills-lock (v2.1: new) | L→M | L | Interop by design (pinSource references, Δ3); never ask users to abandon an existing pin; document the layering | User reports of double-pinning confusion → tighten docs + defer harder to incumbent locks |

## 15. Validation Plan, Change Triggers & Kill Criteria

**Method:** ship → measure public, non-gameable numbers → gate the next layer. Hands-on onboarding of persona-3 repos is outreach, not a gate.

**Gates:** **G1** ≥200 unique doctor runs in week 1 post-launch (npm-download proxy; methodology published). **G2** ≥75 public repos with committed `.gitmesh/` (GitHub code search; script in repo). **G3** ≥40 weekly-active check repos for 3 consecutive weeks. **G4** ≥15 repos with a policy pack; ≥1 external write-up citing the coverage matrix.

**Change triggers (pre-committed responses - new in v2.1):**
- **CT1** A vendor or GitHub ships a *cross-tool* doctor/audit → doctor becomes the loss-leader; E7 accelerates to the front; §4 re-run within a week; messaging shifts fully to policy+coverage+receipts.
- **CT2** amtiYo/agents (or any sync tool with real usage) ships policy/enforcement compilation → treat as direct competitor: publish the coverage-matrix comparison, accelerate org-tier backends (T7.9/T7.10 - hardest to fast-follow), open a collaboration conversation before a marketing fight.
- **CT3** MCP SEP-1766 (digest pinning) is adopted into the spec → migrate lock MCP entries to the spec's format per architecture principle 2; announce as a win.

**Kill / re-cut criteria:**
- **K1** G1 missed after two distinct launch pushes with distinct messaging → the wedge *framing* is wrong; one structured re-cut (same code, new story: lead with GM001 secrets, or the #6235 shim, or the census data) before touching scope.
- **K2** The K1 re-cut also misses → fragmentation pain is not install-motivating at individual level; fall back to persona-3-only distribution for one cycle; if still flat: **stop the pivot**, publish findings, re-plan. No feature-adding drift.
- **K3** ≥2 major vendors ship cross-vendor config reading → sunset sync marketing; doctor+policy+receipts become the whole product; re-run §4.
- **K4** G3 achieved but G4 flat after 8 weeks → policy is a nice-to-have; doctor/apply/check remain the whole (healthy) product; shelve receipts.
- **K5** Sustained canary failure per R6 → shrink permanently to core-7 adapters.
- **Standing:** if any layer requires a server, a login, or an org sales motion to be useful, that layer is mis-designed - redesign or drop, never ship.

## 16. Success Metrics (public, gameproof-biased)

Primary: **weekly-active repos** (check runs in CI, 7-day window; public dashboard page with methodology). Secondary: committed-`.gitmesh/` repo count; npm weekly downloads (directional); Action installs; doctor-clean transitions in tracked public repos; adapter contributors (unique, merged); benchmark-page organic traffic (directional demand signal). Explicitly *not* KPIs: stars, skill counts, anything requiring telemetry.

## 17. Open Source & Distribution Strategy

1. **License/governance:** Apache-2.0 unchanged; stay in the current repo (597 commits of history, OpenSSF Silver, LFDT residence); DCO stays. LFDT residence framed accurately as neutral community affiliation, not endorsement - and now as a concrete differentiator against a category of solo side-projects with five name-colliding "agentsyncs."
2. **Launch choreography:** (a) census data post + Show HN for doctor, with the benchmark page live day one; (b) "one config, every agent - and it respects the manager you already use" post for apply/migrate, cross-posted where #6235 participants live; (c) coverage-matrix post for policy, including the org-tier story ("compile your managed-settings and requirements.toml from the same source"). Three separate news cycles.
3. **Contributor funnel:** adapters are the on-ramp (contract + fixtures = fenced first PR); "adapter wanted: <tool>" issues seeded directly from the cycle-3 census; monthly adapter-day on the existing weekly-call slot.
4. **Standards posture:** consume AGENTS.md/SKILL.md/MCP/Agent Trace verbatim; publish workspace.yaml JSON Schema and the receipt predicate openly; offer the validator upstream to AAIF if its v1.0 tooling effort surfaces; adopt SEP-1766 on arrival (CT3); document Claude Code's AGENTS.md status neutrally and update within 48h if #6235 resolves - a *good* news day (one shim deleted; the fragmentation that remains is the story).
5. **Coexistence, not conquest:** import Ruler/rulesync/agents-json forever; detect-and-respect the rest; upstream shared fixes where licenses allow; never a takedown post. The benchmark and scanners pages name every neighbor accurately.
6. **Monetization:** none until sustained G3+; then convenience only (hosted org-wide doctor dashboard, private policy-pack registry). The evidence path stays free.

## 18. Test Plan

- **Unit:** IR schema; normalizer (15+ cases incl. symlinks); each GM rule ± fixtures; redaction guarantee (secret values absent from every output mode); lock hash stability; YAML comment preservation; pinSource resolution (gitmesh vs skills-lock vs mcp-lock).
- **Golden/conformance (backbone):** per-adapter suites - fresh emit, brownfield merge, round-trip (native→IR→native byte-stable or explained), managed-marker three-way + symlink cases (T4.8); three built-in packs → goldens per backend including org-tier artifacts (managed-settings bundle, requirements.toml).
- **Property tests:** determinism (same IR twice → identical bytes); idempotence (apply∘apply = apply); revert∘apply = identity on tracked files.
- **Integration:** init/migrate on 7 archetypes (claude-only, codex-only, cursor+claude, ruler-managed, agents-json-managed, symlink-managed, kitchen-sink); check drift matrix (edit source / edit managed region / edit outside / delete output → four behaviors); Action e2e; `skill add` tamper + skills-lock-interop cases.
- **Format-canary (TX.1):** weekly container matrix vs latest agent releases; failures auto-file with parsed-vs-expected diffs.
- **Fault scenarios:** (1) invalid workspace.yaml; (2) lockfile from a newer gitmesh; (3) two adapters claim one output path; (4) skill hash mismatch; (5) symlinked CLAUDE.md (healthy-pattern path); (6) CRLF repos; (7) rule unmappable on every enabled agent (coverage says so; apply never silently drops); (8) apply mid-rebase (dirty-tree guard); (9) >1MB instruction file (refuse with guidance); (10) nested AGENTS.md scoping conflicts; (11) skills-lock.json present but skill dir tampered; (12) Codex untrusted-project (plan surfaces the trust caveat).

## 19. Primary Source Index

**Standards & foundations [V]:** AAIF formation (2025-12-09; Platinum: Amazon, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI; projects MCP/AGENTS.md/goose; 60k+ AGENTS.md adopters per announcement); agents.md; agentskills.io; MCP SEP-1766 proposal; Agent Trace spec adoption (Git AI, Cline, OpenCode); Zed ACP Registry blog (agents-not-policies); LF newsletter Jul 2026 (Momentum Report; MCP Enterprise-Managed Auth) [V-1].
**Vendor docs & signals [V]:** code.claude.com docs (memory; permissions; plugin-marketplaces; managed settings incl. `.d`/policyHelper/resolution order; org plugin admin via support.claude.com); Claude Code `/checkup` reporting (v2.1.205, ~2026-07-08 - re-verify exact version/date before public citation); anthropics/claude-code #6235 (+#31005, #34235, #25882, #14474); Codex config/sandbox/approvals, execpolicy, requirements.toml, project trust; Cursor rules/hooks (v1.7); Copilot instructions + auto-approve booleans; antigravity.google docs (CLI features, settings, plugin bundles); Agent HQ live Feb 2026 (preview/GA date split per §3); Devin Desktop rename 2026-06-02 [V-1].
**Sync/converter census [V]:** intellectronica/ruler (+npm); dyoshikawa/rulesync (+docs); amtiYo/agents (@agents-dev/cli); spxrogers/agentsync; baranovxyz/agentsync; dallay/agentsync; yelmuratoff/agent_sync; ZacheryGlass/agent-sync; claaslange/agentsync; GowayLee/agent-sync; PanisHandsome/ai-rules-sync; snapsynapse/agentlink (agentlink.run); dot-agents.com; vibe-rules (npm); mitkury/airul; agent-kit; yzhao062/anywhere-agents; ai-config-sync-manager (OpenAI forum, May 2026).
**Audit/lint census [V]:** giacomo/agents-lint (+ETH Zurich ICSE 2026 citation); agentlint.app; agentlinter.com + seojoonkim/agentlinter; agent-ready.dev validator; Swival/skillscheck; William-Yeh/agent-skill-linter; tyabu12/claude-config-doctor; yurukusa/cc-health-check + cc-safe-setup; hiclaude/health; tw93/Waza `/health`.
**MCP/skills tooling [V]:** registry.modelcontextprotocol.io; Smithery; mcpm.sh; mcp.so; Glama; PulseMCP; LobeHub; Docker MCP Catalog/Toolkit/Gateway; Snyk Agent Scan / Invariant mcp-scan (2k+★; v0.4.13 Apr 2026; Tool Pinning; skill-scan recall claims); Cisco mcp-scanner; @mcpguards/mcp-lock; vercel-labs/skills + skills.sh (lock v3, tree-SHA hashing; ~4,257 skills per §3 rule); openai/skills.
**Hooks/policy tooling [V]:** cchooks; cc-hooks-ts; claude-hooks-sdk (PHP); claude_hooks (Ruby); syou6162/cchook; webdevtodayjason/claude-hooks; Hookify; karanb192/claude-code-hooks (incl. pr-provenance-stamp); disler/claude-code-hooks-mastery; JalelTounsi awesome set; weykon/agent-hooks; managed-settings.com; PromptArmor.
**Provenance [V]:** usegitai.com + git-ai-project/git-ai (2,049★; 179 releases; v1.5.6; Thoughtworks Radar Assess); Agent Note [V-1]; in-toto/DSSE/SLSA specs.
**GitMesh ground truth [V]:** github.com/LF-Decentralized-Trust-labs/gitmesh (README, tree, releases, languages, maintainers), 2026-07-19.
**Carried [V-1] (2026-07-18 review):** Agent HQ enterprise reporting; Ona–OpenAI (2026-06-11); Vibe Kanban shutdown (2026-04-10); Terragon shutdown (2026-02-09); Tembo pivot; security M&A set; EU AI Omnibus dates; Gartner >40% cancellation; McKinsey Nov-2025; SCITT RFC 9943 / COSE Receipts RFC 9942; receipts-field census; trailer-convention flux; Gartner AI-Governance MQ (2026-06-16).
**Flagged [I] - re-verify before any public citation:** Cursor ~$2B ARR; Databricks Omnigent; AAIF AGENTS.md-v1.0 tooling timing; Claude `/checkup` exact version/date; Antigravity MCP config path (reported inconsistently); several long-tail star counts (agent-sync ~3★ etc.); skills.sh growth rate; cursor.directory / awesome-cursorrules specifics (cycle-3 search budget exhausted before completion).

## 20. Go / No-Go

**Go - direction re-confirmed by the widest sweep yet; plan adjusted, not changed.** Begin E0 immediately; the only pre-work is merging this document as `docs/PIVOT.md` with ADRs 001–005 and `WATCHLIST.md`.

The immediate work, in order: (1) T0.1–T0.7 foundation week; (2) E1 doctor - seven detectors, third-party-manager awareness, GM001–GM011, the benchmark-parity checklist; (3) launch with the fragmentation census and the benchmark honesty page; (4) hold G1 honestly, including the K1/K2 discipline and the CT triggers with their pre-committed responses.

What cycle 3 changed is the *shape of honesty this plan owes*: the doctor is no longer a claim of novelty but a claim of **breadth**: every incumbent audits one tool or one file; GitMesh audits the workspace. The policy moat got *bigger* (org-managed surfaces nobody compiles). The lockfile got *humbler* (interoperate with two incumbents). And the clock got *louder*: a vendor shipped a single-tool doctor eleven days ago. **The Agent Workspace Compiler remains an implementable plan with explicit tripwires - proceed until a tripwire fires, and honor it when it does.**
