# GitMesh — Instructions for Coding Agents

## Status: repository pivot in progress

GitMesh is pivoting from a multi-agent orchestration runtime to the **Agent
Workspace Compiler** — a single CLI + GitHub Action that audits (`doctor`),
compiles (`apply`), drift-checks (`check`), and enforces (`policy`)
coding-agent configuration from the repo. No server, no database, no daemon
in the new product.

**Before any work, read `docs/pivot.md` (the canonical plan) and
`docs/research_results.md` (the evidence).** If anything in this repository —
including this file — contradicts `docs/pivot.md`, the pivot doc wins.

## How to work

- Implement the task backlog in `docs/pivot.md` §12 **strictly in order**,
  starting from the first unfinished task. One task = one branch/PR.
- Meet the task's acceptance criteria and add its tests before moving on.
  Never batch tasks, never skip ahead, never start a task the previous one
  hasn't unblocked.
- If the plan is ambiguous, or reality contradicts it (an agent vendor
  changed a config format since 2026-07-19), stop and ask the maintainer,
  citing the pivot section number. Never improvise silently on plan-level
  decisions.

## Repository map

| Area | Status | Notes |
|---|---|---|
| `cli/` | ACTIVE | becomes the `gitmesh` CLI (`doctor`, `init`, `migrate`, `apply`, `check`, `policy`); legacy commands move under `gitmesh legacy` (task T0.3) |
| `lib/workspace-core/` | ACTIVE (new) | IR, normalizer, GM risk rules, lockfile, marker/merge engine |
| `lib/workspace-adapters/` | ACTIVE (new) | per-agent adapters: detect / import / plan / emit + golden fixtures. (Planned as `lib/adapters/` in `docs/pivot.md` §10.8/T0.2; renamed because that directory already holds the frozen legacy runtime adapters — maintainer decision, 2026-07-19) |
| existing `lib/` code (OPA policy compiler, MCP/ACP parsers, Ed25519 attestation, forge clients) | REUSE | repurpose per `docs/pivot.md` §9.1 — do not rewrite wholesale, do not delete |
| `server/`, `ui/`, `docker/`, `playbooks/`, `agents/`, heartbeat / Postgres / webhook code | FROZEN | do not modify, refactor, "clean up", or delete anything here |
| `doc/`, `docs/` | docs | `docs/pivot.md` is canonical; server-era docs (`SETUP.md`, `doc/DEVELOPING.md`, docker-compose files) are legacy — do not follow them for pivot work |

## Hard rules

1. Nothing in `lib/workspace-core` or `lib/workspace-adapters` may import from
   `server/**`, `drizzle*`, or `pg*`. Task T0.4 turns this into a lint rule —
   honor it even before that lands.
2. No servers, databases, network calls, or telemetry in any new code path.
   `doctor` / `apply` / `check` are pure file operations. `doctor` never
   writes files; tests enforce no-write and no-network with spies.
3. Determinism: same inputs → byte-identical outputs. No timestamps,
   wallclock values, or nondeterministic ordering in emitted files.
4. Every detector and emitter ships golden fixtures
   (`fixtures/<adapter>/<case>/{input-repo/, expected/}`), including at least
   one negative case.
5. Secret values must never appear in any output mode (TTY, `--json`,
   `--md`) — findings redact values, always.
6. Pivot work needs no database and no dev server. Never run `pnpm dev`,
   `setup.sh`, `docker-compose`, or start Postgres for new-code tasks.

## Dev loop

- `pnpm install` — bootstrap the workspace (`--no-frozen-lockfile` on first
  clone; CI uses the frozen lockfile).
- `pnpm test` — Vitest suite. (Verify the exact script names in the root
  `package.json` before assuming others exist.)
- Releases go through Changesets: include one changeset in every PR.

## Conventions

- **Every commit must be DCO signed off: `git commit -s`.** This is a Linux
  Foundation requirement for this repo; unsigned commits will be rejected.
- Branch naming: `type/branch-name` (e.g. `feat/doctor-claude-detector`).
- Keep PRs single-task and small; the backlog is sized so each task is
  0.5–2 days.

## Scope guardrails (from `docs/pivot.md` §8.6)

The product is never: a server, an agent runtime or wrapper, an MCP/model
gateway, a marketplace, a content-security scanner, or a telemetry system.
If a task seems to require one of these, the task is being misread — stop
and ask.