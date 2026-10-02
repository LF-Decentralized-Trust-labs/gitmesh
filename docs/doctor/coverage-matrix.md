---
title: "Coverage matrix"
description: "What gitmesh doctor inventories for each coding agent today, plus the placeholder for the policy coverage matrix that gitmesh policy will generate."
---

Two matrices live on this page. The first is real today: which files doctor reads for each agent, kept in step by hand with the detectors and their golden fixtures (the byte-exact test cases every detector ships with). The second is a placeholder for the policy coverage matrix, which will be generated from adapter capability flags rather than written by hand.

## Detection coverage today

Every row is one agent adapter in doctor's registry. A cell names the files that adapter inventories; `-` means doctor does not read that surface for that agent yet, and "(nested)" means the file is found at any depth. Presence probes (org-managed settings, `requirements.toml`, the Antigravity CLI settings file) are inventoried without reading content, and they run even without `--user`.

Not read yet, although the agent supports them: Claude Code's `.claude/CLAUDE.md` and nested `<dir>/.claude/` trees (skills, rules, agents), and Codex skills in nested `.agents/skills/` directories. Claude Code v2.1.277 and later also reads `AGENTS.md` in a project that has no `CLAUDE.md`; doctor inventories that file under the other adapters, not under `claude-code`.

| Adapter | Instructions | Rules / scoped | MCP | Skills | Commands / subagents | Permissions / hooks / sandbox / org |
|---|---|---|---|---|---|---|
| `claude-code` | `CLAUDE.md` (nested), `CLAUDE.local.md`; `~/.claude/CLAUDE.md` with `--user` | `.claude/rules/**` | `.mcp.json` | `.claude/skills/*/SKILL.md` | `.claude/commands/**/*.md`, `.claude/agents/**/*.md` | `.claude/settings.json`, `.claude/settings.local.json`; `.claude-plugin/plugin.json` and `marketplace.json`; managed-settings probe |
| `codex` | `AGENTS.md` (nested) | nested `AGENTS.md` | `[mcp_servers]` in `.codex/config.toml` | `.agents/skills/*/SKILL.md` | `.codex/agents/*.toml` | `.codex/config.toml`; execpolicy `.rules` under `.codex/`; `config.toml` in `~/.codex` or `CODEX_HOME` with `--user`; `requirements.toml` probe |
| `cursor` | `AGENTS.md` (nested), legacy `.cursorrules` | `.cursor/rules/**/*.mdc` (nested) | `.cursor/mcp.json` | - | `.cursor/agents/**/*.md` | `.cursor/hooks.json` |
| `copilot` | `AGENTS.md` (nested), `.github/copilot-instructions.md` | `.github/instructions/**/*.instructions.md` | `.vscode/mcp.json` | - | `.github/agents/**/*.md` | `chat.tools.global.autoApprove`, `chat.tools.terminal.autoApprove` and `chat.tools.urls.autoApprove` in `.vscode/settings.json` |
| `antigravity` | `GEMINI.md` (nested) | `rules/` in bundles under `.gemini/` | `.gemini/settings.json`; `mcp_config.json` anywhere under `.gemini/`, bundles included | `.agent/skills/*/SKILL.md`, bundle `skills/` | bundle `agents/` | bundle `hooks.json` and `plugin.json`; Antigravity CLI settings probe |
| `opencode` | `AGENTS.md` (nested) | - | `mcp` in `opencode.json` or `opencode.jsonc` (nested) and `.opencode/opencode.json(c)` | `.opencode/skill/` and `.opencode/skills/` | `.opencode/command(s)/**/*.md`, `.opencode/agent(s)/**/*.md`, `.opencode/mode(s)/*.md` | `permission` in the same config files; plugins and themes inventoried |
| `agentsmd` | `AGENTS.md` (nested) | - | - | - | - | - |
| `devin` | `AGENTS.md` (nested) | `.devin/rules/`, `.windsurf/rules/`, legacy `.windsurfrules` | - | `.devin/skills/`, `.windsurf/skills/` | `.windsurf/workflows/` | `.windsurf/hooks.json`, `.devin/blueprint.yaml` |
| `cline` | `AGENTS.md` | `.clinerules/**`, legacy single-file `.clinerules` (and the `.cursorrules` and `.windsurfrules` it also reads) | - | - | `.clinerules/workflows/` | `.clinerules/hooks/*`, `.clineignore` |
| `roo` | `AGENTS.md`, `AGENT.md` | `.roo/rules/**`, `.roo/rules-<mode>/**`, root `.roorules` and `.roorules-<mode>` | `.roo/mcp.json` | - | `.roo/commands/` | `.roomodes`, `.rooignore` |

Formats churn. Every detector ships golden fixtures, and a weekly format-canary run against the latest agent releases is planned. This table is not generated from either yet; it is updated by hand when a detector changes.

### Third-party managers

The `third-party-managers` adapter inventories files that other sync tools own and labels each one `managed by <tool>`:

- **Ruler**: `.ruler/ruler.toml`, `.ruler/mcp.json`, and the Markdown sources under `.ruler/`
- **rulesync**: `rulesync.jsonc`, `rulesync.local.jsonc`, the `mcp`, `hooks` and `permissions` files in `.rulesync/` (`.json` or `.jsonc`), `.rulesync/.aiignore`, `.rulesyncignore`, and the Markdown sources under `.rulesync/`
- **agents-json** (`@agents-dev/cli`): `.agents/agents.json`, `.agents/local.json`
- **agentsync family**: `agentsync.json`, `agentsync.config.json`, `.agents/agentsync.toml`, `.agentsync/agentsync.toml`, `.agentsync-state.json`
- **agent_sync**: `.ai/agent_sync.yaml`, `.ai/.sync-manifest`; **agent-sync**: `.agent-sync.toml`; **agentlink**: `.agentlink.yaml`
- **skills-lock**: `skills-lock.json`; **mcp-lock**: `.mcp.lock`
- **symlinks**: known agent config paths that are symlinks, reported with their literal target

Being managed is never itself a finding, and doctor suggests nothing destructive in a manager's territory (ADR-004). The files are still checked: [GM001](/findings/gm001) scans the managers' config files (`ruler.toml`, `.ruler/mcp.json`, `rulesync.jsonc`, `.agents/local.json`, ...) for plaintext secrets, [GM005](/findings/gm005) compares `.ruler/mcp.json` and `.rulesync/mcp.json(c)` with the agents' own MCP configs, and [GM004](/findings/gm004) reads pins from `skills-lock.json` and `.mcp.lock`. Source files are not scanned yet, so a token in `.agents/agents.json` or in a Markdown source is not reported.

## Policy coverage matrix (placeholder)

`gitmesh policy` (planned) will compile one policy pack into each agent's native permission model where the agent has one. Because no two agents enforce alike, every compile will emit a coverage report, and this page will publish it: one row per policy rule, one column per agent and tier, each cell one of four statuses, with annotations for limits such as the Codex project-trust caveat and VS Code's lack of a hard deny.

| Status | Meaning |
|---|---|
| `enforced-native` | the agent's own permission or sandbox setting enforces the rule |
| `enforced-hook` | an emitted hook script enforces it |
| `advisory-instruction-only` | the rule can only be stated in instructions; nothing enforces it |
| `unsupported` | the agent has no mechanism for it; `gitmesh policy` reports the gap rather than dropping it silently |

The matrix will be generated from each adapter's declared capability flags and regenerated in CI, so it cannot drift from what the code does. Until the generator ships, the table below is a placeholder, not a claim: `pending` means not generated yet. Its columns are the planned policy back ends; Copilot / VS Code has none planned.

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
