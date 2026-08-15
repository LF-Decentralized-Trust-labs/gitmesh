---
"@gitmesh/workspace-adapters": minor
---

Add the `copilot` adapter's `detect()` (pivot T1.4): a pure, read-only, symlink-aware inventory of the GitHub Copilot config surface - AGENTS.md at any depth, `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md` (with parsed YAML frontmatter for `applyTo`), `.vscode/mcp.json`, `.github/agents/**/*.md` subagent definitions, and `.vscode/settings.json`, which reports which `chat.tools.*.autoApprove` keys are set and never any settings value. Settings are read as JSONC, the dialect VS Code writes them in. Registers lazily in the built-in registry and ships three golden fixtures including a negative case.
