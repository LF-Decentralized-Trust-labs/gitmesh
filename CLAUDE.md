# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Required Reading

Before non-trivial changes, read these in order:

1. `doc/GOAL.md`
2. `doc/vision.md`
3. `doc/v1-spec.md` — concrete V1 build contract; controls when it conflicts with `architecture.md`
4. `doc/DEVELOPING.md`
5. `doc/DATABASE.md`

`AGENTS.md` is the human/AI contributor guide and overlaps heavily with this file. `CONTRIBUTING.md` contains the same dev commands plus PR/code-style policy.

## Common Commands

```sh
pnpm install
pnpm dev                # API + UI in watch mode (UI served by API in dev middleware mode)
pnpm dev:once           # one-shot dev run, no file watching
pnpm dev:server         # only @gitmesh/server
pnpm dev:ui             # only @gitmesh/agents-ui (Vite)
pnpm dev --tailscale-auth  # authenticated/private mode bound to 0.0.0.0

pnpm build              # pnpm -r build (recursive)
pnpm -r typecheck       # tsc --noEmit across workspace
pnpm test:run           # vitest run (full suite)
pnpm test               # vitest watch
pnpm check:tokens       # forbidden-token audit (CI runs this)

pnpm db:generate        # compiles lib/data first, then drizzle-kit generate
pnpm db:migrate         # apply migrations
pnpm db:backup          # one-off DB backup

pnpm gitmesh-agents <subcommand>   # operator CLI (issues, dashboard, configure, doctor, run, ...)
```

Single test file: `pnpm vitest run path/to/file.test.ts` (or `pnpm --filter @gitmesh/server test:run -- path`).

There is **no `pnpm lint`** script despite `CONTRIBUTING.md` mentioning one. CI verification = `check:tokens` + `pnpm -r typecheck` + `pnpm test:run` + `pnpm build` (see `.github/workflows/pr-verify.yml`). Run all four before claiming done.

## Dev Environment

- **Dev runs at `http://localhost:3100`** — API and UI share the same origin in dev (Vite middleware mode). The README's mention of port 3101 for the UI is stale.
- Leave `DATABASE_URL` unset to use embedded PostgreSQL at `~/.gitmesh-agents/instances/default/db/`. Reset by deleting that directory.
- `GITMESH_HOME` and `GITMESH_INSTANCE_ID` override the instance root.
- API base path is `/api`. Quick check: `curl http://localhost:3100/api/health`.

## Lockfile Policy

**Do not commit `pnpm-lock.yaml` in pull requests.** GitHub Actions owns the lockfile — pushes to `master` regenerate and commit it. Use `pnpm install --no-frozen-lockfile` locally; CI re-verifies with `--frozen-lockfile`.

## Monorepo Layout

pnpm workspace (`pnpm-workspace.yaml`): `lib/*`, `lib/adapters/*`, `server`, `ui`, `cli`, `skills/**`.

- `server/` (`@gitmesh/server`) — Express 5 REST API + orchestration runtime
- `ui/` (`@gitmesh/agents-ui`) — React 19 + Vite + Tailwind operator dashboard
- `cli/` — `gitmesh-agents` operator CLI (setup + client control-plane commands)
- `lib/core/` (`@gitmesh/core`) — shared types, constants, Zod validators, API path constants
- `lib/data/` (`@gitmesh/data`) — Drizzle schema, migrations, DB clients
- `lib/adapter-sdk/` (`@gitmesh/adapter-sdk`) — SDK for building agent adapters
- `lib/adapters/{claude,claude-gateway,codex,cursor,gateway,opencode,pi}` — adapter implementations
- `skills/*-skill/` — agent skill packages (triage, pr-review, docs, security, community, onboarding, release)
- `playbooks/` — markdown playbooks served via `/api/playbooks/...`

Imports use the workspace package scopes (`@gitmesh/core`, `@gitmesh/data`, `@gitmesh/adapter-sdk`, `@gitmesh/adapter-*`).

## Architecture: Control-Plane Loop

```
Webhook / Schedule trigger
        │
        ▼
   Forge Sync           server/src/core/forge-sync.ts
        │               (validates + enriches event data)
        ▼
   Policy Engine        server/src/core/policy-engine.ts
        │               (YAML compiled by policy-compiler.ts; OPA/wasm)
        │  allow │ block │ require_approval
        ▼
   Heartbeat            server/src/core/heartbeat.ts
        │               (runs the agent adapter)
        ▼
   Activity Log         server/src/core/activity-log.ts
                        (full audit trail)
```

Key server modules live in `server/src/core/` (services) and `server/src/api/` (Express routers). Adapters are loaded via `server/src/adapters/`.

## Core Engineering Invariants

These are non-negotiable — preserve them when changing behavior:

1. **Project-scoped data.** Every domain entity is scoped to a project; routes/services must enforce project boundaries. Agent API keys must not access other projects.
2. **Single-assignee task model with atomic checkout.** Required for any `in_progress` transition. No automatic reassignment — stale work is surfaced, not silently fixed.
3. **Approval gates for governed actions.** Sensitive actions require operator approval; do not bypass.
4. **Budget hard-stop auto-pause.** Cost events drive monthly UTC rollups; hitting the cap pauses agents.
5. **Activity log entries for every mutating action.** Mutations without activity log entries are bugs.
6. **Consistent HTTP errors:** `400 / 401 / 403 / 404 / 409 / 422 / 500`. Maintainer = full-control operator context; agents authenticate via bearer API keys (`agent_api_keys`, hashed at rest).

## Contract Synchronization

Schema/API changes must be propagated through **all** layers in the same change:

- `lib/data/src/schema/*.ts` (and re-export in `lib/data/src/schema/index.ts`)
- `lib/core/src/{types,validators,constants,api}` (types, Zod validators, API paths)
- `server/src/api/*` and `server/src/core/*` (routes + services)
- `ui/src/api/*` and consuming pages/features

Skipping a layer breaks the build or silently drifts the contract.

## Database Change Workflow

1. Edit `lib/data/src/schema/*.ts`.
2. Export new tables from `lib/data/src/schema/index.ts`.
3. `pnpm db:generate` — this **compiles `lib/data` first**, because `drizzle.config.ts` reads compiled schema from `dist/schema/*.js`. Forgetting to rebuild is the usual reason generation produces stale output.
4. `pnpm -r typecheck`.

## Conventions

- **Services:** factory pattern — `export function fooService(db: Db) { return { ... } }`.
- **Routes:** factory pattern — `export function fooRoutes(db: Db) { ... }` returning an Express `Router`. Mount in `server/src/app.ts`.
- **Validators:** Zod, in `lib/core/src/validators/`.
- **Tests:** Vitest, co-located under `__tests__/` directories.
- **Policies:** YAML-first, compiled via `server/src/core/policy-compiler.ts` (uses `@open-policy-agent/opa-wasm`).
- **Skills:** implement the `SkillDefinition` interface (`{ name, description, execute }`); register in `server/src/core/skill-registry.ts`.
- **TypeScript strict mode**; avoid `any`. ESM (`"type": "module"`); imports use `.js` extensions for local files (NodeNext resolution).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

## UI Notes

`ui/src/` layout:
- `views/` — page-level components grouped by domain
- `features/` — complex domain-specific feature components
- `components/` — shared primitive UI components
- `adapters/` — per-adapter UI modules (gateway, claude, codex, ...)

Use the project-selection context for project-scoped pages; surface API failures rather than swallowing them. Keep navigation aligned with the available API surface.

There is a `design-guide` skill (under `.claude/skills/design-guide/`) for UI work — use it alongside frontend-design and web-design-guidelines skills when building components.

## Things That Will Bite You

- `pnpm db:generate` requires `lib/data` to be compiled — it does this for you, but custom drizzle-kit invocations against `dist/schema` will read stale output if you skip the build.
- Embedded Postgres state lives at `~/.gitmesh-agents/instances/default/db/`, **not** in the repo. The older `data/pglite` path mentioned in `AGENTS.md` is stale.
- The README's port 3101 for the UI is stale — dev serves UI through the API at 3100.
- Project deletion defaults: enabled in `local_trusted`, disabled in `authenticated`. Toggle with `GITMESH_ENABLE_PROJECT_DELETION`.
- `GITMESH_SECRETS_STRICT_MODE=true` forces `*_API_KEY` / `*_TOKEN` / `*_SECRET` env keys to use secret refs instead of inline values.
