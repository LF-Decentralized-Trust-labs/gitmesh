---
"@gitmesh/workspace-adapters": minor
---

Add the `cursor` adapter's `detect()` (pivot T1.3): a pure, read-only, symlink-aware inventory of the Cursor config surface - AGENTS.md at any depth, legacy `.cursorrules`, `.cursor/rules/*.mdc` at the root and in nested `.cursor` directories (Cursor v0.50+ monorepo rules) with parsed YAML frontmatter (description, globs - block and flow lists normalized to Cursor's comma-separated form - and alwaysApply), `.cursor/mcp.json`, `.cursor/agents/` subagent definitions, and `.cursor/hooks.json` (v1.7+ hooks). Registers lazily in the built-in registry and ships four golden fixtures including a negative case.
