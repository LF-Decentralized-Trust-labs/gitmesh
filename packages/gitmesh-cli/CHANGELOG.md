# gitmesh-cli

## 0.4.0

### Minor Changes

- ecd01c0: Wire `gitmesh doctor` end to end (pivot §8.1 item 4, T1.17). Every registered detector runs over the enclosing git root of the current (or given) directory, artifact content is read once per file, root-anchored instruction documents feed the drift differ with symlink identity, the GM rule table runs over the inventory, and the report renders as TTY (colored per `picocolors`, so `NO_COLOR`/`FORCE_COLOR`/`--no-color` behave as they do in every other gitmesh command), `--json` (schema v1) or `--md`. Exit codes: 0 clean, 1 when a finding reaches `--fail-on <error|warning|info|none>` (default `warning`, so informational findings never fail a run), 2 when the run itself fails (bad flag, missing directory, a config file the auditor is not allowed to read). `--user` includes home-directory artifacts, resolving both the `~/` and `$VAR/` display paths detectors emit.

  Only the one instruction document each agent reads at the repo root (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`, …) is treated as a cross-tool copy. The per-topic trees — `.cursor/rules/`, `.claude/rules/`, `.github/instructions/` and friends — are scoped by their own globs, so they stay in the inventory but out of the pairwise differ, which is quadratic in the documents it is given.

  The command stays read-only: the suite proves zero filesystem writes, zero network calls and zero subprocesses with module spies covering `--user` as well as the repo-only modes, and byte-exact `--json` goldens under `cli/fixtures/doctor/` — one repo with findings, one with none — pin determinism with the machine-scoped probes (`CODEX_HOME`, org-managed settings) held fixed. The published `gitmesh-cli` bundle now carries the workspace packages and declares `zod`.

### Patch Changes

- 4e57c58: Benchmark-parity checklist plus two doctor fixes from a functional review pass (pivot §12 T1.19).

  `docs/comparisons.md` now enumerates every check published by Claude Code's `/doctor` checkup (the `/checkup` alias never was a rename), cc-health-check (20 checks), agents-lint (56 rules + 2 dynamic families) and AgentLint (51 core + 7 extended checks today - the circulating "33" is stale), and maps each one to a GM rule, an inventory item, the drift differ, or a documented out-of-scope with the tool that owns it. The page also names where gitmesh doctor honestly falls short today. Sources checked 2026-09-13.

  Doctor fixes found while building the checklist: the drift differ no longer charges a divergent pair for a CLAUDE.md that carries the `@AGENTS.md` import token - the exact shim GM010 recommends is a pointer to AGENTS.md, not an independent copy, so adopting doctor's own remediation no longer costs score (workspace-core exports `importsAgentsMd` so GM010 and the drift input share one definition of "bridged"); and GM011 no longer judges references in nested artifacts (a vendored repo's or monorepo subtree's CLAUDE.md resolves imports against its own directory, which the inventory does not cover, so "absent from the inventory" proved nothing and produced false dangling-reference findings).

- eddeeea: Pre-release hardening for `gitmesh doctor`. Hard rule 5: GM011 now quotes a permission entry only when nothing in it may be a credential (a GM001 hit, a credential-named word, a `user:password` argument or a random-looking word) and shows `Tool(…)` otherwise, and drift blocks collapse whole private-key blocks and mask values behind a credential name (`password: …`, `Authorization: Bearer …`, `-u user:…`) in every output mode, through the new `mayHoldSecret` and `redactSecrets` helpers next to `scanForSecrets`. The GM003 Codex message no longer suggests `approval_policy = "untrusted"`, which Codex retired in August 2026 and now refuses to load. The npm README describes the working `doctor` command.

## 0.3.0

### Minor Changes

- 5c6dedb: Add the publishable `gitmesh-cli` npm package (pivot T0.6): a small self-contained bundle of the `gitmesh` CLI entry (single runtime dependency, no server/database code - `gitmesh legacy` prints install guidance instead of bundling the legacy tree), with a manifest-drift guard in the build, npm provenance publishing under the `next` dist-tag via the new release workflow, and a clean-install smoke test in CI. The `gitmesh` bin moves out of `gitmesh-agents` (which keeps the legacy bin and full legacy commands), and `--version` now reports the installed package's manifest version. The unscoped npm name `gitmesh` is owned by an unrelated project, so the package name is `gitmesh-cli`; the installed binary remains `gitmesh` (see ADR-005).
