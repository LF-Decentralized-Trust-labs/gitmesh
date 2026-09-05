## gitmesh doctor: 55/100

9 artifacts across 6 adapters. 1 error, 2 warnings, 1 info. 3 divergent instruction pairs.

### Findings

| Severity | Rule | Location | Message |
| --- | --- | --- | --- |
| error | GM001 | `.mcp.json` (claude-code) | MCP server github sets GITHUB_TOKEN to a plaintext value (redacted) |
| warning | GM002 |  | No agent denies reads of .env files |
| warning | GM010 | `CLAUDE.md` | CLAUDE.md is not bridged to AGENTS.md \| add an @AGENTS.md shim |
| info | GM008 | (roo) | roo config present but no roo activity in history |

### Drift

| Documents | Result |
| --- | --- |
| `AGENTS.md` = `CLAUDE.md` | symlink group, zero drift |
| `.cursor/rules/style.mdc` vs `AGENTS.md` | 1 block only in .cursor/rules/style.mdc, 2 blocks only in AGENTS.md, 1 shared |
| `.cursor/rules/style.mdc` vs `GEMINI.md` | 1 block only in .cursor/rules/style.mdc, 3 blocks only in GEMINI.md, 1 shared |
| `AGENTS.md` vs `GEMINI.md` | 1 block only in GEMINI.md, 1 reordered, 3 shared |

Divergent blocks:

- "Never commit secrets \| tokens." in `.cursor/rules/style.mdc`; missing from `AGENTS.md`, `GEMINI.md`
- "# Project rules" in `AGENTS.md`, `GEMINI.md`; missing from `.cursor/rules/style.mdc`
- "- Run tests before every commit...." in `AGENTS.md`, `GEMINI.md`; missing from `.cursor/rules/style.mdc`
- "Prefer tabs over spaces." in `GEMINI.md`; missing from `.cursor/rules/style.mdc`, `AGENTS.md`

<details>
<summary>Inventory (9 artifacts, 6 adapters)</summary>

| Adapter | Path | Kind | Notes |
| --- | --- | --- | --- |
| antigravity | `GEMINI.md` | instructions |  |
| claude-code | `.claude/settings.json` | settings |  |
| claude-code | `.mcp.json` | mcp-config |  |
| claude-code | `CLAUDE.md` | instructions | symlink -&gt; AGENTS.md |
| claude-code | `~/.claude/CLAUDE.md` | instructions | user |
| codex | `AGENTS.md` | instructions |  |
| cursor | `.cursor/rules/style.mdc` | rule |  |
| roo | `.roo/rules/old.md` | rule | symlink -&gt; ../missing.md, broken |
| third-party-managers | `.ruler/ruler.toml` | config | managed by ruler |

</details>
