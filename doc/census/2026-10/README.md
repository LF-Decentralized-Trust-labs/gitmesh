# How 500 popular repositories configure their coding agents

The GitMesh agent configuration census, October 2026.

> **Draft for launch review.** These numbers come from gitmesh-cli 0.4.0. Before this post is published, the census is re-run with the doctor fixes the [launch checklist](../../launch/README.md#before-launch-blocking) lists, and the numbers here are updated from the new `stats.json`.

`AGENTS.md` has become the place to tell a coding agent how a repository works: Codex, Cursor, Copilot, OpenCode, Devin and others read it, and since September 2026 Claude Code reads it too, in projects without a `CLAUDE.md`. By design, it covers instructions only. We wanted to know what else repositories commit for their agents, and whether the instruction files they keep next to `AGENTS.md` agree with it.

So we took the 500 most-starred open-source repositories on GitHub that have an `AGENTS.md` at their root and ran `gitmesh doctor`, a read-only configuration auditor we maintain, over each one at a pinned commit. In short:

- **76%** commit configuration that only one specific agent reads, besides `AGENTS.md`, and **37%** do so for two or more agents.
- **59%** keep at least one more instruction file at the root next to `AGENTS.md`. Of those 372 files, **56%** are symlinks or `@AGENTS.md` imports, 22% are separate documents, 10% are copies that have diverged, 9% are pointers such as "See AGENTS.md", and only six files, 2%, are identical copies.
- **38%** ship agent skills. 78 of those keep a skill of the same name in more than one agent's skills directory, 11 of them as separate copies that can drift apart.
- Only **6%** commit an MCP config file, and doctor found no plaintext secret in the agent configuration of any of the 500.

The full tables are in [stats.md](stats.md). The rest of this post walks through them.

## How we counted

The selection: walking GitHub's repository search in star order, the first 500 public, non-fork, non-archived repositories with a license GitHub can name and an `AGENTS.md` at the root of their default branch, discovered on 2026-10-16. Their stars ranged from 392,000 down to 19,000. Each was pinned to that day's default-branch commit; the list is [manifest.json](manifest.json).

Doctor ran on each commit with its machine-level checks turned off, so what it reports depends on the repository alone, and with any symlink that points outside the repository disabled, so it never read a file of the scanning machine. All 500 could be fetched and scanned. We publish counts only: no repository is named next to anything doctor found. [scripts/census/README.md](../../../scripts/census/README.md) describes the method and every definition used here, and the commands that reproduce these numbers from the manifest.

## Beyond AGENTS.md

`AGENTS.md` is a shared standard, so it says nothing about which agents a repository's maintainers use. What does is configuration that only one agent reads: a `CLAUDE.md`, `.cursor/rules`, `.github/copilot-instructions.md`, a `GEMINI.md`, a skills directory, a settings file. 382 of the 500 repositories (76%) commit at least one such file:

| Agents with configuration of their own | Repositories |
|---|---|
| 0 | 119 (24%) |
| 1 | 195 (39%) |
| 2 | 113 (23%) |
| 3 | 49 (10%) |
| 4 or more | 24 (5%) |

Claude Code leads by far: 330 repositories (66%) commit configuration that only Claude Code reads, most often instruction files (283), then skills (127) and settings, hooks or plugins (104). Codex follows with 136 (27%), almost all of it skills in `.agents/skills`. Then come Copilot with 102 (20%), mostly `.github/copilot-instructions.md` and `.github/instructions/`, Antigravity with 36 (7%), Cursor with 35 (7%) and OpenCode with 26 (5%). Cline, Roo and Devin have files of their own in fewer than five repositories each. Another 10 repositories carry a legacy `.cursorrules` and 2 a `.windsurfrules`, files that more than one agent reads.

## The second instruction file

295 repositories (59%) keep at least one more instruction file at their root next to `AGENTS.md`, 372 files in all. The census sorts each one by how it relates to `AGENTS.md`, comparing doctor's normalized Markdown blocks, so whitespace and formatting do not count:

| How it relates to `AGENTS.md` | Files | Share |
|---|---|---|
| Symlink, one file to the other | 113 | 30% |
| `@AGENTS.md` import line | 94 | 25% |
| Separate document, sharing no block | 82 | 22% |
| Diverged copy, sharing some blocks | 39 | 10% |
| Pointer, such as "See AGENTS.md" | 35 | 9% |
| Identical copy | 6 | 2% |
| Unreadable (a broken symlink) | 3 | 1% |

Two things stand out. First, copying is rare and linking is common: 56% of the files are symlinks or imports, which keep one source of instructions by construction, and only six are identical copies. Second, most of the rest are not copies at all. They share no block of text with `AGENTS.md`: separate documents written for one agent, or pointers in prose. Copies that have drifted apart, sharing some blocks with `AGENTS.md` and differing in others, are 39 files in 34 repositories (7%).

`.github/copilot-instructions.md` is where separate documents concentrate: 48 of its 82 files (59%) share nothing with `AGENTS.md`. A pointer works only as well as the agent follows it, and a separate document means that agent works from different instructions than the rest. Either can be deliberate; neither shows unless someone opens both files.

## CLAUDE.md, after Claude Code learned AGENTS.md

For a year, Claude Code was the main agent that did not read `AGENTS.md`, and anthropics/claude-code#6235, the request to change that, became the most-upvoted open request in its tracker. It was closed as completed in August 2026, and Claude Code v2.1.277 reads `AGENTS.md` in a project that has no `CLAUDE.md`. With both files present, it still reads `CLAUDE.md`.

257 repositories (51%) keep a `CLAUDE.md` next to `AGENTS.md`, and 72% of them link the two: 94 with a symlink and 92 with an `@AGENTS.md` import, the two workarounds documented while #6235 was open. Of the other 71, 26 are copies that have diverged, 24 are separate documents, 19 are pointers and 2 are identical copies. In those repositories Claude Code reads its own file, so a diverged or separate `CLAUDE.md` means Claude works from different instructions than every agent that reads `AGENTS.md`. Since v2.1.277, a `CLAUDE.md` that only imports `AGENTS.md` can also simply be deleted.

## Skills: one format, several directories

Agent skills share one format (`SKILL.md`) but not one location: Claude Code reads `.claude/skills`, Codex `.agents/skills`, Antigravity `.agent/skills`, OpenCode `.opencode/skills`. 189 repositories (38%) ship skills, 81 of them for more than one agent. 78 keep a skill of the same name in more than one agent's directory. Most of them link the directories: in 67, every extra copy is a symlink, and in the other 11 at least two of the copies are separate files, the same instructions maintained twice.

## MCP servers

Only 28 repositories (6%) commit a dedicated MCP config file (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and the like), 4 of them for more than one agent. MCP servers a project uses mostly live in each developer's own configuration rather than in the repository. Servers declared inside `.codex/config.toml`, `opencode.json` or `.gemini/settings.json` are not in that count.

## Who manages these files

Configuration-sync tools generate or link agent files from one source, and doctor labels the files they own. 145 repositories (29%) have at least one agent configuration path that is a symlink, 21 (4%) pin skills with the `skills-lock.json` of Vercel's skills CLI, and one uses Ruler. No other sync tool's files appear: the linking is done by hand, or by tools that leave no configuration file behind.

## What doctor flagged

Doctor's findings are risk checks with stable ids, from GM001 (a plaintext secret in a config file) to GM011 (a configuration that contradicts itself); the [findings table](stats.md#doctor-findings) lists every rule's count. Doctor found no plaintext secret in any of the 500 (GM001), one repository commits a setting that auto-approves an agent's terminal commands for everyone who clones it (GM003), and 34 (7%) have an instruction file longer than 40,000 characters (GM007). GM005, GM006 and GM011 found nothing, and GM008 and GM009 are silent in this release.

Three counts are known to be wrong in this release, and we would rather say so than quote them:

- **GM002** (no `.env` read protection) fires in 100% of repositories, mostly because it counts Cursor and Claude Code as present in any repository with an `AGENTS.md`, even without configuration of their own ([#493](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/493), [#488](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/488)).
- **GM010** (`CLAUDE.md` not bridged to `AGENTS.md`) fires in 64%, mostly on repositories with no `CLAUDE.md` at all, a case Claude Code v2.1.277 made harmless ([#484](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/484)).
- **GM004** (a skill with scripts and no pin) fires in 33%, and counts prose as scripts ([#489](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/489)).

Doctor's drift check has the same blind spot as a quick skim: it diffs pointers and separate documents as if they were copies, so it reports drift in 140 repositories (28%), where the census finds diverged copies in 34 ([#501](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/501)).

## What it adds up to

`AGENTS.md` settled where instructions go. It was never meant to settle the rest, and the census shows the rest is where repositories differ: which agents get configuration of their own, where skills live, how a second instruction file is kept in line. Where repositories keep things consistent, they mostly do it with symlinks and imports, the patterns doctor treats as healthy. What no single file shows is whether the copies, pointers and per-agent documents still agree, and that is what doctor reports, for every agent at once:

```bash
npx gitmesh-cli@next doctor
```

It writes nothing and makes no network calls. If it reports something on your repository that it shouldn't, [open an issue](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues).

## Reproduce it

From a checkout of the commit that published this edition, after `pnpm install`:

```bash
pnpm census scan --manifest doc/census/2026-10/manifest.json --results ~/census/results --work ~/census/work
pnpm census aggregate --manifest doc/census/2026-10/manifest.json --results ~/census/results --out ~/census/check
diff ~/census/check/stats.json doc/census/2026-10/stats.json
```

The scan downloads about 25 GB and takes about 45 minutes at `--concurrency 6` on a fast connection.
