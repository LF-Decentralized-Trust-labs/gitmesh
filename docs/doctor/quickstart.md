---
title: "Quickstart: gitmesh doctor"
sidebarTitle: Quickstart
description: "Audit every coding agent's configuration in your repository in 90 seconds - Claude Code, Codex, Cursor, Copilot, Antigravity, OpenCode and more - with one read-only command."
---

`gitmesh doctor` reads the agent configuration committed in a repository (instruction files, rules, MCP configs, skills, commands, subagents, permission and hook settings) across eleven registered adapters (ten agent and format families plus the third-party-manager detector) in one pass, diffs the instruction copies different agents read, and reports risk findings with stable ids (GM001-GM011). It never writes a file, never opens a network connection, and never runs a subprocess.

## 1. Run it (10 seconds)

From any directory inside a git repository:

```console
$ npx gitmesh-cli@next doctor
```

Node.js 20 or newer is the only prerequisite. The npm package is `gitmesh-cli` and the installed binary is `gitmesh`; the unscoped npm name `gitmesh` belongs to an unrelated project, so `npx gitmesh` runs something else.

Pass a path to audit another checkout: `npx gitmesh-cli@next doctor ../other-repo`. Doctor always scans the enclosing git root of the directory it is given.

## 2. Read the report (60 seconds)

The report has four parts. This is the output for a small repository with an `AGENTS.md`, a `CLAUDE.md` shim, a Cursor rule, a Claude settings file and an `.mcp.json` that carries a token:

```text
gitmesh doctor

Inventory (12 artifacts, 9 adapters)
  agentsmd
    AGENTS.md  instructions
  claude-code
    .claude/settings.json  settings
    .mcp.json              mcp-config
    CLAUDE.md              instructions
  cline
    AGENTS.md  instructions
  codex
    AGENTS.md  instructions
  copilot
    AGENTS.md  instructions
  cursor
    .cursor/rules/style.mdc  rule
    AGENTS.md                instructions
  devin
    AGENTS.md  instructions
  opencode
    AGENTS.md  instructions
  roo
    AGENTS.md  instructions

Drift (1 instruction document, 0 divergent pairs)
  fewer than two instruction documents, nothing to compare

Findings (1 error, 1 warning, 0 info)
  error
    GM001  .mcp.json  Plaintext GitHub token in "GITHUB_TOKEN" (line 6); move it out of the file and reference it from the environment.
  warning
    GM002  (cursor)  No beforeReadFile hook guards secret files; add one to .cursor/hooks.json that blocks .env reads.

Score 75/100
```

- **Inventory** lists every artifact each adapter would read, grouped by adapter. One file can appear under several adapters: eight adapters claim a root `AGENTS.md`. Artifacts owned by a third-party manager (Ruler, rulesync, symlink managers, skills-lock, mcp-lock) are labeled `managed by X` and are never a finding.
- **Drift** compares the one instruction document each agent reads at the repository root (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.github/copilot-instructions.md`, ...) block by block after normalization. A symlinked copy, or a `CLAUDE.md` that imports `@AGENTS.md`, is one source rather than a divergent pair. Here the shim is recognized, so there is nothing to compare.
- **Findings** are risk rules with stable ids; each id has its own page under [findings](/findings/overview). Secret values are always redacted: a finding names the file, line and key, never the value.
- **Score** starts at 100 and subtracts 20 per error, 5 per warning and 5 per divergent instruction pair. Informational findings cost nothing.

## 3. Fix, re-run, gate CI (20 seconds)

Move the token into the environment (`"GITHUB_TOKEN": "${GITHUB_TOKEN}"`), add the Cursor hook or accept the warning, and run doctor again.

The exit code is the CI contract:

| Exit code | Meaning |
|---|---|
| `0` | no finding at or above `--fail-on` |
| `1` | at least one finding at or above `--fail-on` (default `warning`) |
| `2` | the run itself failed: a missing directory, a config file the auditor may not read, an invalid `--fail-on` value |

`--fail-on error`, `warning`, `info` or `none` picks the threshold; `none` reports and never fails. A minimal GitHub Actions step:

```yaml
- run: npx gitmesh-cli@next doctor --fail-on error
```

`--md` prints the same report as Markdown for a PR comment or job summary. `--json` prints a versioned machine-readable report (`schemaVersion: 1`). `--user` adds the user-scope artifacts in your home directory (`~/.claude/CLAUDE.md`, `~/.codex/config.toml`, ...) to the inventory; rules about repository hygiene ([GM002](/findings/gm002), [GM003](/findings/gm003), [GM008](/findings/gm008), [GM009](/findings/gm009), [GM010](/findings/gm010)) look only at repository files, while [GM001](/findings/gm001), [GM006](/findings/gm006) and [GM007](/findings/gm007) apply to user-scope files too.

## What doctor will never do

- Write or modify any file, not even a cache. `gitmesh apply` is a separate, explicit command.
- Make a network call or send telemetry. The test suite holds every release to zero writes, zero network and zero subprocesses.
- Scan content for prompt injection or malicious payloads. That is a different job; see [scanners](/doctor/scanners).
- Claim to block anything at runtime. Doctor reports; each agent's own permission model enforces.

## Next

- [Findings GM001-GM011](/findings/overview): what each rule checks and how to clear it.
- [Coverage matrix](/doctor/coverage-matrix): which agents and surfaces doctor inventories today.
- [Scanners](/doctor/scanners): where doctor stops and content-security scanners begin.
