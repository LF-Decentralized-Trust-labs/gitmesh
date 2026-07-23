---
"@gitmesh/workspace-adapters": minor
---

Add the `claude-code` adapter's `detect()` (pivot T1.1): a pure, read-only, symlink-aware inventory of the Claude Code config surface — the CLAUDE.md/CLAUDE.local.md hierarchy (repo root + subdirectories, `~/.claude/CLAUDE.md` only under `--user`), `.claude/{rules,skills,commands,agents}`, `.claude/settings.json` + `.claude/settings.local.json` resolved from the git root, `.mcp.json`, plugin/marketplace manifests, and a managed-settings presence probe that reports presence only. The adapter registers lazily in the built-in registry and ships four golden fixtures, including a negative case.
