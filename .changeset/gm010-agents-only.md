---
"gitmesh-cli": patch
---

`gitmesh doctor` no longer reports GM010 on a repository with a root `AGENTS.md` and no `CLAUDE.md` (#484). Claude Code has read `AGENTS.md` in a project without a `CLAUDE.md` since v2.1.277 (anthropics/claude-code#6235, closed as completed), so that warning failed the default `--fail-on warning` run on the most common repository shape, and came back for teams that removed an `@AGENTS.md`-only `CLAUDE.md` as Anthropic's docs suggest. GM010 still warns on a `CLAUDE.md` with no `AGENTS.md`, and on both files present without an `@AGENTS.md` import or symlink joining them, since Claude Code then reads `CLAUDE.md` alone. The `CLAUDE.md`-only message drops its "#6235 workaround" wording.
