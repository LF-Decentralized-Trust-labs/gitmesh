# Developing GitMesh Agents

This is the operator's local-dev playbook. For the GitMesh Agents UI walkthrough (sidebar, routes, onboarding, operator flows), see `doc/OPERATOR-UI-GUIDE.md`. For deployment-mode definitions, see `doc/DEPLOYMENT-MODES.md`.

## TL;DR

```sh
pnpm install
pnpm dev
# → API + UI at http://localhost:3100
```

GitMesh Agents runs without setting up PostgreSQL manually — the dev server boots an embedded PostgreSQL into `~/.gitmesh-agents/instances/default/db`. The default mode is `local_trusted`.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node | 20+ | |
| pnpm | 9+ | |
| Docker | optional | only for the no-local-Node path and Gateway smoke harnesses |

The repo follows a **lockfile-not-in-PRs** policy: don't commit `pnpm-lock.yaml`. GitHub Actions owns it — pushes to `master` regenerate it with `pnpm install --lockfile-only --no-frozen-lockfile` and commit back, and PR CI runs `--frozen-lockfile` after that. Pull-request CI validates dependency resolution whenever a manifest changes.

## Running locally

### Default (local_trusted)

`pnpm dev` runs the API in watch mode and serves the UI through the API at port 3100. `pnpm dev:once` runs without file watching for one-shot flows.

### Authenticated + private bind

```sh
pnpm dev --tailscale-auth
```

This switches the deployment mode to `authenticated/private` and binds the server on `0.0.0.0` so other devices on the same network (typically a Tailscale tailnet) can reach it. Custom hostnames (e.g. a private Tailscale name) need to be allow-listed:

```sh
pnpm gitmesh-agents allowed-hostname dotta-macbook-pro
```

### One-command bootstrap

For first-time installs:

```sh
pnpm gitmesh-agents run
```

This auto-onboards (writes default config), runs `gitmesh-agents doctor --repair`, and only starts the server if checks pass.

### Docker (no local Node required)

```sh
docker build -t gitmesh-agents-local .
docker run --name gitmesh-agents \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e GITMESH_HOME=/gitmesh-agents \
  -v "$(pwd)/data/docker-gitmesh-agents:/gitmesh-agents" \
  gitmesh-agents-local
```

Or via Compose: `docker compose -f docker-compose.quickstart.yml up --build`. See `doc/DOCKER.md` for API-key wiring (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) and persistence details.

## Instance layout

GitMesh state for a running instance is **outside the repo** under the home directory:

| Path | Purpose | Override |
| --- | --- | --- |
| `~/.gitmesh-agents/instances/default/db` | embedded PostgreSQL | `GITMESH_HOME`, `GITMESH_INSTANCE_ID` |
| `~/.gitmesh-agents/instances/default/data/storage` | uploaded images/attachments (local_disk provider) | configure via CLI |
| `~/.gitmesh-agents/instances/default/data/backups` | DB backup archives | `GITMESH_DB_BACKUP_DIR` |
| `~/.gitmesh-agents/instances/default/secrets/master.key` | local secrets master key | `GITMESH_SECRETS_MASTER_KEY_FILE`, `GITMESH_SECRETS_MASTER_KEY` |
| `~/.gitmesh-agents/instances/default/workspaces/<agent-id>` | per-agent fallback workspace when no project workspace is resolved | inherits from `GITMESH_HOME` / `GITMESH_INSTANCE_ID` |

To reset state in a hurry: `rm -rf ~/.gitmesh-agents/instances/default/db && pnpm dev`. To use external Postgres instead, set `DATABASE_URL`.

## Configuration reference

Most knobs live in the CLI — `pnpm gitmesh-agents configure --section <name>` walks through interactive setup for `database`, `storage`, `secrets`, etc. Environment overrides are useful in CI/Docker.

| Variable | Effect |
| --- | --- |
| `DATABASE_URL` | Bypass embedded PG; use external Postgres |
| `GITMESH_HOME` | Override instance root |
| `GITMESH_INSTANCE_ID` | Use a non-default instance name |
| `GITMESH_DB_BACKUP_ENABLED` | `true`/`false` (default: enabled) |
| `GITMESH_DB_BACKUP_INTERVAL_MINUTES` | Default 60 |
| `GITMESH_DB_BACKUP_RETENTION_DAYS` | Default 30 |
| `GITMESH_DB_BACKUP_DIR` | Override backup dir |
| `GITMESH_SECRETS_MASTER_KEY` | Inline master key material |
| `GITMESH_SECRETS_MASTER_KEY_FILE` | Path to master key file |
| `GITMESH_SECRETS_STRICT_MODE` | `true` to forbid inline `*_API_KEY` / `*_TOKEN` / `*_SECRET` env values |
| `GITMESH_ENABLE_PROJECT_DELETION` | `false` to disable project deletion (default: enabled in `local_trusted`, disabled in `authenticated`) |

## Operational tasks

### Health check

```sh
curl http://localhost:3100/api/health     # → {"status":"ok"}
curl http://localhost:3100/api/projects   # → JSON array
```

### One-off DB backup

```sh
pnpm gitmesh-agents db:backup
# or:
pnpm db:backup
```

Recurring backups are timer-driven and on by default; tune via `pnpm gitmesh-agents configure --section database` or the env vars above.

### Migrate inline-env secrets to refs

```sh
pnpm secrets:migrate-inline-env           # dry run
pnpm secrets:migrate-inline-env --apply   # apply
```

Strict mode makes inline secret env values an error rather than a warning — recommended for any non-local-trusted host.

### Claude proxy (dual-mode)

To run original Claude alongside provider-routed Anthropic-compatible APIs (e.g. MiniMax) via the local proxy, see `doc/CLAUDE-PROXY.md`.

## CLI client commands (control plane)

```sh
# Set context once:
pnpm gitmesh-agents context set --api-base http://localhost:3100 --project-id <project-id>

# Then operate without flags:
pnpm gitmesh-agents issue list
pnpm gitmesh-agents issue create --title "Investigate checkout conflict"
pnpm gitmesh-agents issue update <issue-id> --status in_progress --comment "Started triage"
pnpm gitmesh-agents dashboard get
```

Full reference: `doc/CLI.md`.

## Smoke tests

### Gateway join (operator-governed end-to-end)

```sh
pnpm smoke:gateway-join
```

Validates: invite creation for agent-only join → agent join with `adapterType=gateway` → operator approval and one-time API-key claim → callback delivery on wakeup against a Dockerized Gateway-style webhook receiver.

This script performs operator-governed actions (invite create, join approve, agent wakeup). In `authenticated` mode, supply auth via `GITMESH_AUTH_HEADER` (e.g. `Bearer …`) or `GITMESH_COOKIE`.

### Gateway Docker UI

```sh
pnpm smoke:gateway-docker-ui
```

Lives at `scripts/smoke/gateway-docker-ui.sh`. Boots Gateway in Docker, prints a host-browser dashboard URL, and configures sane defaults for local-only smoke runs:

- **Pairing:** `GATEWAY_DISABLE_DEVICE_AUTH=1` by default (set to `0` to require device pairing).
- **Models:** OpenAI defaults (`openai/gpt-5.2` + OpenAI fallback) so the script doesn't need Anthropic auth.
- **State:** isolated config dir `~/.gateway-gitmesh-agents-smoke`, reset on each run (`GATEWAY_RESET_STATE=1`).
- **Networking:** auto-detects a host URL reachable from inside Gateway Docker. Default container alias is `host.docker.internal` (override with `GITMESH_HOST_FROM_CONTAINER` / `GITMESH_HOST_PORT`). If GitMesh rejects the container hostname in `authenticated/private` mode, allow it and restart: `pnpm gitmesh-agents allowed-hostname host.docker.internal`.

## Invite onboarding endpoints

These power agent-oriented invite flows and are useful when wiring third-party tooling:

| Endpoint | Returns |
| --- | --- |
| `GET /api/invites/:token` | invite summary + onboarding/skills index links |
| `GET /api/invites/:token/onboarding` | onboarding manifest (registration endpoint, claim-endpoint template, skill install hints) |
| `GET /api/invites/:token/onboarding.txt` | plain-text llm.txt-style handoff for human or agent operators (includes optional inviter message and suggested network hosts) |
| `GET /api/playbooks/index` | available playbook documents |
| `GET /api/playbooks/gitmesh-agents` | the GitMesh Agents heartbeat playbook markdown |
