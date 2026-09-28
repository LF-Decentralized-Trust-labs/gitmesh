---
title: "Coverage matrix"
description: "What gitmesh doctor inventories for each coding agent today, and the placeholder for the generated policy coverage matrix (rule x agent x tier: native, hook, advisory, unsupported) that gitmesh policy will publish."
---

Two matrices live on this page. The first is real today: which files doctor reads for each agent, taken from the adapters' golden fixtures (the byte-exact test cases every detector ships with). The second is a placeholder for the policy coverage matrix, which will be generated from adapter capability flags and never written by hand.

## Detection coverage today

Every row is one adapter in doctor's registry. A cell names the files that adapter inventories; `-` means doctor does not read that surface for that agent yet. Nested files (`packages/app/AGENTS.md`) are found wherever the agent itself would look. Presence probes (org-managed settings, `requirements.toml`, Antigravity CLI settings) are inventoried without reading content.

| Adapter | Instructions | Rules / scoped | MCP | Skills | Commands / subagents | Permissions / hooks / sandbox / org |
|---|---|---|---|---|---|---|
| `claude-code` | `CLAUDE.md` tree (nested), `CLAUDE.local.md`; `~/.claude/CLAUDE.md` with `--user` | `.claude/rules/**` | `.mcp.json` | `.claude/skills/*/SKILL.md` | `.claude/commands/**/*.md`, `.claude/agents/**/*.md` | `.claude/settings.json`, `.claude/settings.local.json`; `.claude-plugin/plugin.json` and `marketplace.json`; managed-settings probe |
| `codex` | `AGENTS.md` (nested) | nested `AGENTS.md` | `[mcp_servers]` in `.codex/config.toml` | `.agents/skills/*/SKILL.md` | `.codex/agents/*.toml` | `.codex/config.toml`; execpolicy `.rules`; `~/.codex` or `CODEX_HOME` with `--user`; `requirements.toml` probe |
| `cursor` | `AGENTS.md` (nested), legacy `.cursorrules` | `.cursor/rules/**/*.mdc` (nested) | `.cursor/mcp.json` | - | `.cursor/agents/**/*.md` | `.cursor/hooks.json` |
| `copilot` | `AGENTS.md` (nested), `.github/copilot-instructions.md` | `.github/instructions/**/*.instructions.md` | `.vscode/mcp.json` | - | `.github/agents/**/*.md` | `chat.tools.*.autoApprove` keys in `.vscode/settings.json` |
| `antigravity` | `GEMINI.md` (nested) | `rules/` in plugin and extension bundles | `.gemini/settings.json`, `mcp_config.json` (root and bundles) | `.agent/skills/*/SKILL.md`, bundle `skills/` | bundle `agents/` | bundle `hooks.json` and `plugin.json`; Antigravity CLI settings probe |
| `opencode` | `AGENTS.md` (nested) | - | `mcp` in `opencode.json` or `.opencode/opencode.jsonc` | `.opencode/skill/` and `.opencode/skills/` | `.opencode/command(s)/**/*.md`, `.opencode/agent(s)/**/*.md`, `.opencode/mode(s)/*.md` | `permission` in `opencode.json`; plugins and themes inventoried |
| `agentsmd` | `AGENTS.md` at any depth | - | - | - | - | - |
| `devin` | `AGENTS.md` (nested) | `.devin/rules/`, `.windsurf/rules/`, legacy `.windsurfrules` | - | `.devin/skills/`, `.windsurf/skills/` | `.windsurf/workflows/` | `.windsurf/hooks.json`, `.devin/blueprint.yaml` |
| `cline` | `AGENTS.md` | `.clinerules/**`, legacy single-file `.clinerules` (and the `.cursorrules` and `.windsurfrules` it also reads) | - | - | `.clinerules/workflows/` | `.clinerules/hooks/*`, `.clineignore` |
| `roo` | `AGENTS.md`, `AGENT.md` | `.roo/rules/**`, `.roo/rules-<mode>/**` | `.roo/mcp.json` | - | `.roo/commands/` | `.roomodes`, `.rooignore` |
| `third-party-managers` | `.ruler/` (`ruler.toml`, `AGENTS.md`, `mcp.json`, `skills/`, rule sources); `.rulesync/` and `rulesync.jsonc`; `.agents/agents.json`; agentsync-family files (`agentsync.json`, `.agentsync-state.json`, `.ai/agent_sync.yaml`); symlink topologies; `skills-lock.json`; `.mcp.lock` | | | | | |

Third-party-manager artifacts are labeled `managed by <tool>` and are never a finding. Doctor reads their MCP sources for [GM001](/findings/gm001) and [GM005](/findings/gm005) and their lockfiles for [GM004](/findings/gm004) pins, and suggests nothing destructive in their territory (ADR-004).

Formats churn. Every detector ships golden fixtures, and a weekly format-canary run against the latest agent releases is planned; when a vendor changes a shape, this table changes with it.

## Policy coverage matrix (placeholder)

`gitmesh policy` (planned) compiles one policy pack into each agent's native permission model. Because no two agents enforce alike, every compile will emit a coverage report, and this page will publish it: one row per policy rule, one column per agent and tier, each cell one of four statuses.

| Status | Meaning |
|---|---|
| `enforced-native` | the agent's own permission or sandbox setting enforces the rule |
| `enforced-hook` | an emitted hook script enforces it |
| `advisory-instruction-only` | the rule can only be stated in instructions; nothing enforces it |
| `unsupported` | the agent has no mechanism for it; `apply` reports the gap rather than dropping it silently |

The matrix is generated from each adapter's declared capability flags and regenerated in CI, so it cannot drift from what the code does. Until the generator ships, the table below is a placeholder, not a claim:

| Rule | Claude Code | Codex | OpenCode | Cursor | Antigravity | Org tier: managed settings | Org tier: requirements.toml |
|---|---|---|---|---|---|---|---|
| `deny_read` | pending | pending | pending | pending | pending | pending | pending |
| `deny_write` | pending | pending | pending | pending | pending | pending | pending |
| `deny_command` | pending | pending | pending | pending | pending | pending | pending |
| `require_approval_command` | pending | pending | pending | pending | pending | pending | pending |
| `mcp_allow` | pending | pending | pending | pending | pending | pending | pending |
| `skill_pin_required` | pending | pending | pending | pending | pending | pending | pending |
| `forbid_bypass_modes` | pending | pending | pending | pending | pending | pending | pending |

GitMesh never claims uniform enforcement, never calls an instruction a guardrail, and never implies it blocks anything at runtime. The generated matrix is how those claims stay falsifiable.
