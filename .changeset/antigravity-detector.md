---
"@gitmesh/workspace-adapters": minor
---

Add the `antigravity` adapter's `detect()` (pivot T1.5): a pure, read-only, symlink-aware inventory of the Antigravity 2.0 (Gemini) config surface - `GEMINI.md` at any depth, `.gemini/settings.json`, plugin bundles under `.gemini/` (`plugin.json`, `hooks.json`, `mcp_config.json`, and their bundled `skills/`, `agents/`, `rules/`), `.agent/skills/<name>/SKILL.md`, and a presence-only probe for the antigravity-cli settings file, which reports presence alone and never its location or content. Registers lazily in the built-in registry and ships four golden fixtures including a negative case. The per-skill manifest scan shared by the claude-code, codex and antigravity detectors moves into `detect-fs` as `collectSkillManifests`.
