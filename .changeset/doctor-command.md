---
"gitmesh-cli": minor
"gitmesh-agents": minor
---

Wire `gitmesh doctor` end to end (pivot §8.1 item 4, T1.17). Every registered detector runs over the enclosing git root of the current (or given) directory, artifact content is read once per file, root-anchored instruction documents feed the drift differ with symlink identity, the GM rule table runs over the inventory, and the report renders as TTY (colored on a terminal, `NO_COLOR` honored), `--json` (schema v1) or `--md`. Exit codes: 0 clean, 1 when a finding reaches `--fail-on <error|warning|info|none>` (default `warning`, so informational findings never fail a run), 2 when the run itself fails (bad flag, missing directory). `--user` includes home-directory artifacts. The command stays read-only: the suite proves zero filesystem writes, zero network calls and zero subprocesses with module spies, and a byte-exact `--json` golden under `cli/fixtures/doctor/` pins determinism. The published `gitmesh-cli` bundle now carries the workspace packages and declares `zod`.
