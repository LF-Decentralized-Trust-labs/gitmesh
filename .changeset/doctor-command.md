---
"gitmesh-cli": minor
"gitmesh-agents": minor
---

Wire `gitmesh doctor` end to end (pivot §8.1 item 4, T1.17). Every registered detector runs over the enclosing git root of the current (or given) directory, artifact content is read once per file, root-anchored instruction documents feed the drift differ with symlink identity, the GM rule table runs over the inventory, and the report renders as TTY (colored per `picocolors`, so `NO_COLOR`/`FORCE_COLOR`/`--no-color` behave as they do in every other gitmesh command), `--json` (schema v1) or `--md`. Exit codes: 0 clean, 1 when a finding reaches `--fail-on <error|warning|info|none>` (default `warning`, so informational findings never fail a run), 2 when the run itself fails (bad flag, missing directory, a config file the auditor is not allowed to read). `--user` includes home-directory artifacts, resolving both the `~/` and `$VAR/` display paths detectors emit.

Only the one instruction document each agent reads at the repo root (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, …) is treated as a cross-tool copy. The per-topic trees — `.cursor/rules/`, `.claude/rules/`, `.github/instructions/` and friends — are scoped by their own globs, so they stay in the inventory but out of the pairwise differ, which is quadratic in the documents it is given.

The command stays read-only: the suite proves zero filesystem writes, zero network calls and zero subprocesses with module spies covering `--user` as well as the repo-only modes, and byte-exact `--json` goldens under `cli/fixtures/doctor/` — one repo with findings, one with none — pin determinism with the machine-scoped probes (`CODEX_HOME`, org-managed settings) held fixed. The published `gitmesh-cli` bundle now carries the workspace packages and declares `zod`.
