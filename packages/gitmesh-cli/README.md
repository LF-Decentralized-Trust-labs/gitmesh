# gitmesh-cli

> **Status: pre-release.** Published under the `next` dist-tag. `gitmesh doctor`
> works today; `init`, `migrate`, `apply`, `check` and `policy` are planned and
> print "not implemented yet".

GitMesh audits and governs every coding agent from your repo - Claude Code,
Codex, Cursor, Copilot, Gemini/Antigravity, OpenCode, and more. One
git-versioned source of truth for instructions, tools, and guardrails:
audited (`doctor`), compiled to each agent's native config files (`apply`),
drift-checked in CI (`check`), and enforced through each agent's own
mechanisms (`policy`). No server, no login, no telemetry - pure file
operations.

```bash
npx gitmesh-cli@next doctor
```

`gitmesh doctor` reads the agent configuration in the repository around the
current directory (instruction files, rules, MCP configs, skills, commands,
subagents, permission and hook settings), compares the instruction copies
different agents read, and reports risk findings GM001-GM011. It never writes
a file, opens a network connection or runs a subprocess. Exit code `0` means
no finding at or above `--fail-on` (default `warning`), `1` means at least
one, and `2` means the run itself failed; `--json` and `--md` print
machine-readable and Markdown reports.

Installs a `gitmesh` binary:

| Command | Status | Does |
|---|---|---|
| `gitmesh doctor` | available | Audit agent configuration across coding agents |
| `gitmesh init` | planned | Create `.gitmesh/` workspace config from existing agent files |
| `gitmesh migrate` | planned | Migrate existing per-tool configs into the canonical source |
| `gitmesh apply` | planned | Compile canonical config to each agent's native files |
| `gitmesh check` | planned | Verify generated configs are in sync (CI drift gate) |
| `gitmesh policy` | planned | Manage policy packs and permission rules |
| `gitmesh legacy …` | - | Points to the legacy GitMesh Agents CLI - not bundled here, so this package stays dependency-light (run legacy commands from a GitMesh repo checkout) |

The npm package name is `gitmesh-cli` (the unscoped name `gitmesh` belongs to
an unrelated project); the installed binary is `gitmesh`.

Apache-2.0 · [repository](https://github.com/LF-Decentralized-Trust-labs/gitmesh) · a Linux Foundation Decentralized Trust lab
