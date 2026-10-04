---
title: CLI Overview
summary: CLI installation and setup
---

The GitMesh Agents CLI handles instance setup, diagnostics, and control-plane operations.

## Usage

```sh
pnpm gitmesh-agents --help
```

## Global Options

All commands support:

| Flag | Description |
|------|-------------|
| `--data-dir <path>` | Local GitMesh Agents data root (isolates from `~/.gitmesh-agents`) |
| `--api-base <url>` | API base URL |
| `--api-key <token>` | API authentication token |
| `--context <path>` | Context file path |
| `--profile <name>` | Context profile name |
| `--json` | Output as JSON |

Project-scoped commands also accept `--project-id <id>`.

For clean local instances, pass `--data-dir` on the command you run:

```sh
pnpm gitmesh-agents run --data-dir ./tmp/gitmesh-agents-dev
```

## Context Profiles

Store defaults to avoid repeating flags:

```sh
# Set defaults
pnpm gitmesh-agents context set --api-base http://localhost:3100 --project-id <id>

# View current context
pnpm gitmesh-agents context show

# List profiles
pnpm gitmesh-agents context list

# Switch profile
pnpm gitmesh-agents context use default
```

To avoid storing secrets in context, use an env var:

```sh
pnpm gitmesh-agents context set --api-key-env-var-name GITMESH_API_KEY
export GITMESH_API_KEY=...
```

Context is stored at `~/.gitmesh-agents/context.json`.

## Command Categories

The CLI has two categories:

1. **[Setup commands](/legacy/cli/setup-commands)**: instance bootstrap, diagnostics, configuration
2. **[Control-plane commands](/legacy/cli/control-plane-commands)**: issues, agents, approvals, activity
