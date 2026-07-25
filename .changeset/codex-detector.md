---
"@gitmesh/workspace-adapters": minor
---

Add the `codex` adapter's `detect()` (pivot T1.2): a pure, read-only, symlink-aware inventory of the Codex CLI config surface — AGENTS.md at any depth, `.codex/config.toml` (plus `~/.codex/config.toml` under `--user`, resolved via `CODEX_HOME`), `.agents/skills/`, `.codex/agents/*.toml` subagents, execpolicy `.rules` files under `.codex/`, a presence-only `CODEX_HOME` hint, and a presence-only probe for the org-managed `requirements.toml`. Registers lazily in the built-in registry and ships four golden fixtures including a negative case.
