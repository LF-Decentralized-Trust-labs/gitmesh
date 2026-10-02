# gitmesh-agents

## 0.4.0

### Minor Changes

- ecd01c0: Wire `gitmesh doctor` end to end (pivot §8.1 item 4, T1.17). Every registered detector runs over the enclosing git root of the current (or given) directory, artifact content is read once per file, root-anchored instruction documents feed the drift differ with symlink identity, the GM rule table runs over the inventory, and the report renders as TTY (colored per `picocolors`, so `NO_COLOR`/`FORCE_COLOR`/`--no-color` behave as they do in every other gitmesh command), `--json` (schema v1) or `--md`. Exit codes: 0 clean, 1 when a finding reaches `--fail-on <error|warning|info|none>` (default `warning`, so informational findings never fail a run), 2 when the run itself fails (bad flag, missing directory, a config file the auditor is not allowed to read). `--user` includes home-directory artifacts, resolving both the `~/` and `$VAR/` display paths detectors emit.

  Only the one instruction document each agent reads at the repo root (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, …) is treated as a cross-tool copy. The per-topic trees — `.cursor/rules/`, `.claude/rules/`, `.github/instructions/` and friends — are scoped by their own globs, so they stay in the inventory but out of the pairwise differ, which is quadratic in the documents it is given.

  The command stays read-only: the suite proves zero filesystem writes, zero network calls and zero subprocesses with module spies covering `--user` as well as the repo-only modes, and byte-exact `--json` goldens under `cli/fixtures/doctor/` — one repo with findings, one with none — pin determinism with the machine-scoped probes (`CODEX_HOME`, org-managed settings) held fixed. The published `gitmesh-cli` bundle now carries the workspace packages and declares `zod`.

### Patch Changes

- 37aaece: Fix the published `gitmesh-agents` manifest dropping its `@gitmesh/server`
  dependency. `scripts/generate-npm-package-json.mjs` kept its own copy of the
  bundled/external package lists from `cli/esbuild.config.mjs`, and that copy
  still named the server package `@gitmesh/agents-server`. Because esbuild
  leaves `@gitmesh/server` external and `cli/src/commands/run.ts` imports it
  dynamically, the published package declared no way to resolve it. The lists
  now live in `cli/esbuild.config.mjs` and are imported by the generator, so
  the manifest always describes the bundle that was actually built.
- 4e57c58: Benchmark-parity checklist plus two doctor fixes from a functional review pass (pivot §12 T1.19).

  `docs/comparisons.md` now enumerates every check published by Claude Code's `/doctor` checkup (the `/checkup` alias never was a rename), cc-health-check (20 checks), agents-lint (56 rules + 2 dynamic families) and AgentLint (51 core + 7 extended checks today - the circulating "33" is stale), and maps each one to a GM rule, an inventory item, the drift differ, or a documented out-of-scope with the tool that owns it. The page also names where gitmesh doctor honestly falls short today. Sources checked 2026-09-13.

  Doctor fixes found while building the checklist: the drift differ no longer charges a divergent pair for a CLAUDE.md that carries the `@AGENTS.md` import token - the exact shim GM010 recommends is a pointer to AGENTS.md, not an independent copy, so adopting doctor's own remediation no longer costs score (workspace-core exports `importsAgentsMd` so GM010 and the drift input share one definition of "bridged"); and GM011 no longer judges references in nested artifacts (a vendored repo's or monorepo subtree's CLAUDE.md resolves imports against its own directory, which the inventory does not cover, so "absent from the inventory" proved nothing and produced false dangling-reference findings).

- 0a516aa: Guard `gitmesh doctor` performance (pivot §12 E1, T1.18). A dedicated CI step (`pnpm test:perf`) generates a deterministic 5,000-file repository into a temp directory - 500 modules, nested `AGENTS.md` files, stray `.mdc` files the cursor detector content-reads, a divergent root `AGENTS.md`/`CLAUDE.md` pair, and a `node_modules` decoy that must stay out of the inventory - and asserts a full doctor run (detectors, drift, rules, render) finishes in under 2 seconds, taking the best of three timed runs after one untimed warm-up. Sanity assertions pin the scan to the fixture so the guard cannot pass against an empty or mis-rooted walk. The suite is gated behind `GITMESH_DOCTOR_PERF=1` and skips in the regular parallel test run, where wall-clock timing would measure worker contention instead of doctor.
- Updated dependencies [6c371d7]
- Updated dependencies [edc99ec]
- Updated dependencies [ca751f6]
- Updated dependencies [6175bd2]
- Updated dependencies [9e882b7]
- Updated dependencies [c69eb76]
- Updated dependencies [4e57c58]
- Updated dependencies [eddeeea]
- Updated dependencies [3263813]
- Updated dependencies [2b951b0]
- Updated dependencies [408a125]
- Updated dependencies [41a1f9b]
- Updated dependencies [ef6161c]
- Updated dependencies [3b32295]
- Updated dependencies [a84df32]
- Updated dependencies [7d777ce]
- Updated dependencies [afc2ec5]
- Updated dependencies [b3e7b1e]
- Updated dependencies [80c4ea1]
- Updated dependencies [464bfe8]
  - @gitmesh/workspace-adapters@0.4.0
  - @gitmesh/workspace-core@0.4.0
  - @gitmesh/adapter-claude-local@0.4.0
  - @gitmesh/adapter-codex-local@0.4.0
  - @gitmesh/adapter-cursor-local@0.4.0
  - @gitmesh/adapter-opencode-local@0.4.0
  - @gitmesh/adapter-pi-local@0.4.0
  - @gitmesh/server@0.4.0
  - @gitmesh/adapter-sdk@0.4.0
  - @gitmesh/adapter-gateway@0.4.0
  - @gitmesh/core@0.4.0
  - @gitmesh/data@0.4.0

## 0.3.0

### Minor Changes

- d7e6275: Add the new `gitmesh` CLI entry with scaffold subcommands (doctor, init, migrate, apply, check, policy) and the full legacy command surface under `gitmesh legacy`; `gitmesh-agents` keeps its existing behavior unchanged (pivot T0.3).

### Patch Changes

- 5c6dedb: Add the publishable `gitmesh-cli` npm package (pivot T0.6): a small self-contained bundle of the `gitmesh` CLI entry (single runtime dependency, no server/database code - `gitmesh legacy` prints install guidance instead of bundling the legacy tree), with a manifest-drift guard in the build, npm provenance publishing under the `next` dist-tag via the new release workflow, and a clean-install smoke test in CI. The `gitmesh` bin moves out of `gitmesh-agents` (which keeps the legacy bin and full legacy commands), and `--version` now reports the installed package's manifest version. The unscoped npm name `gitmesh` is owned by an unrelated project, so the package name is `gitmesh-cli`; the installed binary remains `gitmesh` (see ADR-005).
  - @gitmesh/adapter-sdk@0.3.0
  - @gitmesh/adapter-claude-local@0.3.0
  - @gitmesh/adapter-codex-local@0.3.0
  - @gitmesh/adapter-cursor-local@0.3.0
  - @gitmesh/adapter-gateway@0.3.0
  - @gitmesh/adapter-opencode-local@0.3.0
  - @gitmesh/adapter-pi-local@0.3.0
  - @gitmesh/core@0.3.0
  - @gitmesh/data@0.3.0
  - @gitmesh/server@0.3.0

## 0.2.7

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.7
  - @gitmesh/adapter-sdk@0.2.7
  - @gitmesh/data@0.2.7
  - @gitmesh/adapter-claude-local@0.2.7
  - @gitmesh/adapter-codex-local@0.2.7
  - @gitmesh/adapter-gateway@0.2.7
  - @gitmesh/server@0.2.7

## 0.2.6

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.6
  - @gitmesh/adapter-sdk@0.2.6
  - @gitmesh/data@0.2.6
  - @gitmesh/adapter-claude-local@0.2.6
  - @gitmesh/adapter-codex-local@0.2.6
  - @gitmesh/adapter-gateway@0.2.6
  - @gitmesh/server@0.2.6

## 0.2.5

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.5
  - @gitmesh/adapter-sdk@0.2.5
  - @gitmesh/data@0.2.5
  - @gitmesh/adapter-claude-local@0.2.5
  - @gitmesh/adapter-codex-local@0.2.5
  - @gitmesh/adapter-gateway@0.2.5
  - @gitmesh/server@0.2.5

## 0.2.4

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.4
  - @gitmesh/adapter-sdk@0.2.4
  - @gitmesh/data@0.2.4
  - @gitmesh/adapter-claude-local@0.2.4
  - @gitmesh/adapter-codex-local@0.2.4
  - @gitmesh/adapter-gateway@0.2.4
  - @gitmesh/server@0.2.4

## 0.2.3

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.3
  - @gitmesh/adapter-sdk@0.2.3
  - @gitmesh/data@0.2.3
  - @gitmesh/adapter-claude-local@0.2.3
  - @gitmesh/adapter-codex-local@0.2.3
  - @gitmesh/adapter-gateway@0.2.3
  - @gitmesh/server@0.2.3

## 0.2.2

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.2
  - @gitmesh/adapter-sdk@0.2.2
  - @gitmesh/data@0.2.2
  - @gitmesh/adapter-claude-local@0.2.2
  - @gitmesh/adapter-codex-local@0.2.2
  - @gitmesh/adapter-gateway@0.2.2
  - @gitmesh/server@0.2.2

## 0.2.1

### Patch Changes

- Version bump (patch)
- Updated dependencies
  - @gitmesh/core@0.2.1
  - @gitmesh/adapter-sdk@0.2.1
  - @gitmesh/data@0.2.1
  - @gitmesh/adapter-claude-local@0.2.1
  - @gitmesh/adapter-codex-local@0.2.1
  - @gitmesh/adapter-gateway@0.2.1
  - @gitmesh/server@0.2.1
