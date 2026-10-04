---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `gitmesh-agents run`

One-command bootstrap and start:

```sh
pnpm gitmesh-agents run
```

Does:

1. Auto-onboards if config is missing
2. Runs `gitmesh-agents doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm gitmesh-agents run --instance dev
```

## `gitmesh-agents onboard`

Interactive first-time setup:

```sh
pnpm gitmesh-agents onboard
```

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm gitmesh-agents onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm gitmesh-agents onboard --yes
```

## `gitmesh-agents doctor`

Health checks with optional auto-repair:

```sh
pnpm gitmesh-agents doctor
pnpm gitmesh-agents doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `gitmesh-agents configure`

Update configuration sections:

```sh
pnpm gitmesh-agents configure --section server
pnpm gitmesh-agents configure --section secrets
pnpm gitmesh-agents configure --section storage
```

## `gitmesh-agents env`

Show resolved environment configuration:

```sh
pnpm gitmesh-agents env
```

## `gitmesh-agents allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm gitmesh-agents allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.gitmesh-agents/instances/default/config.json` |
| Database | `~/.gitmesh-agents/instances/default/db` |
| Logs | `~/.gitmesh-agents/instances/default/logs` |
| Storage | `~/.gitmesh-agents/instances/default/data/storage` |
| Secrets key | `~/.gitmesh-agents/instances/default/secrets/master.key` |

Override with:

```sh
GITMESH_HOME=/custom/home GITMESH_INSTANCE_ID=dev pnpm gitmesh-agents run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm gitmesh-agents run --data-dir ./tmp/gitmesh-agents-dev
pnpm gitmesh-agents doctor --data-dir ./tmp/gitmesh-agents-dev
```
