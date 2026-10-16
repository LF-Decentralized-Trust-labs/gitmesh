# Posts where the pain lives

One post per venue, on different days after Show HN, each written for its readers (pivot §12 T2.4). Read [the rules for every post](README.md#rules-for-every-post) first, and each venue's own rules on the day: none of the subreddit rules below could be checked from the tools that wrote this kit, so they are what to look for, not what was verified.

Census numbers come from [the census post](../census/2026-10/README.md) and change when the census is re-run before launch; update them here when it is.

## r/ClaudeAI

**Before posting:** read the sidebar for self-promotion limits and the flair project posts need. Post from a maintainer's own account, and say so in the first line.

**Title**

```text
Claude Code reads AGENTS.md now. Here's how 500 popular repos connect it to CLAUDE.md
```

**Body**

> I maintain GitMesh, an open-source tool that audits coding-agent configuration, so take the framing with that in mind.
>
> Since v2.1.277 Claude Code reads AGENTS.md in a project that has no CLAUDE.md, which closed the old "support AGENTS.md" request. Plenty of repositories still keep both files, so we looked at how the 500 most-starred open-source repositories with an AGENTS.md handle it: 257 of them (51%) still keep a CLAUDE.md. 72% of those link it to AGENTS.md, 94 with a symlink and 92 with an `@AGENTS.md` import; the rest are copies that have drifted (26), separate documents (24), one-line pointers (19) and identical copies (2).
>
> With both files present Claude Code reads CLAUDE.md, so a CLAUDE.md that has drifted from AGENTS.md means Claude follows different instructions from every other agent in the repo. A symlink or a one-line `@AGENTS.md` import avoids that.
>
> The audit tool is a read-only CLI: `npx gitmesh-cli@next doctor`. It checks the CLAUDE.md/AGENTS.md bridge, `.claude/settings.json` and `.mcp.json` (including tokens pasted into MCP env blocks), Claude skills, commands and subagents, and the same surfaces for Codex, Cursor, Copilot and the others in the same pass. It writes nothing and makes no network calls. Claude Code's own /doctor is the better tool for your local setup; this one is for what's committed to the repo.
>
> Method, scripts and the full numbers: https://github.com/LF-Decentralized-Trust-labs/gitmesh/blob/main/doc/census/2026-10/README.md. Happy to answer questions, and false positives are the most useful thing you could report.

## r/ChatGPTCoding

**Before posting:** check whether self-promotion has to go in a pinned thread. In 2024 the subreddit routed project posts to a pinned "Self-promotion thread"; if one exists, post this there as a comment instead.

**Title**

```text
We audited agent config in the 500 most-starred repos with AGENTS.md: 76% also carry per-agent files
```

**Body**

> Disclosure: I maintain GitMesh, the open-source audit tool used here.
>
> A repository that uses Codex, Cursor, Copilot and Claude ends up with AGENTS.md plus each tool's own files: `.cursor/rules`, `.github/copilot-instructions.md`, `CLAUDE.md`, an MCP config per tool, and skills in `.claude/skills`, `.agents/skills` or `.agent/skills` depending on the tool. We ran the audit over the 500 most-starred open-source repositories that have an AGENTS.md:
>
> - 76% commit configuration that only one specific agent reads, and 37% do so for two or more (Claude Code 66%, Codex 27%, Copilot 20%, Antigravity and Cursor 7% each)
> - 59% keep a second instruction file at the root next to AGENTS.md. Of those files, 56% are symlinks or `@AGENTS.md` imports, 22% separate documents, 10% copies that have drifted, 9% one-line pointers and 2% identical copies
> - 38% ship skills, and 78 repos keep the same skill in more than one agent's skills directory (11 as separate copies); only 6% commit an MCP config file
>
> The tool is `npx gitmesh-cli@next doctor`: it reads the configuration for Claude Code, Codex, Cursor, Copilot, Antigravity, OpenCode, Devin, Cline and Roo in one pass, shows where the instruction files disagree, and reports findings like plaintext tokens in MCP configs or auto-approve modes committed for everyone who clones. Read-only, no network, no telemetry, Apache-2.0.
>
> Full write-up and how to reproduce it: https://github.com/LF-Decentralized-Trust-labs/gitmesh/blob/main/doc/census/2026-10/README.md

## lobste.rs

**Before posting:** submitting needs an account in good standing, and accounts come by invitation. In their first 70 days new users cannot use the `show` or `vibecoding` tags. Self-promotion should stay under a quarter of one's stories and comments, so only post if the maintainer posting is already an active member. Do not ask someone else to post it for us.

Submit the census post, not the tool: it is data with a method behind it, which suits the site better than a product link.

**Title**

```text
How 500 popular repositories configure their coding agents
```

**URL:** the census post. **Tags:** `vibecoding` ("Using AI/LLM, coding tools"; the tag list says not to add `ai` as well). Tick "I am the author of the story at this URL".

**First comment**

> Author here. The census runs a read-only audit (gitmesh doctor, which we maintain) over the 500 most-starred open-source repositories with a root AGENTS.md, each pinned to a commit, and reports only aggregates; the scripts and the manifest are in the repository, so the numbers can be reproduced. The part I found most interesting is how rarely anyone copies instruction files: of the 372 files repositories keep next to AGENTS.md, only six are identical copies, while more than half are symlinks or imports and about half of the rest are documents written for a single agent. The audit has known false positives in a few rules, which the post names; I'd rather hear about more than defend the numbers.

## Instead of a "#6235-adjacent" post

The plan put a post next to anthropics/claude-code#6235, then the tracker's most-upvoted request ("support AGENTS.md"), unanswered. That changed: the issue was closed as completed on 2026-08-17, and Claude Code v2.1.277 (2026-09-18) reads AGENTS.md in projects without a CLAUDE.md. §17.4 calls this a good news day: one shim fewer, and the fragmentation that remains is the story.

So there is no post in or next to that issue, or in any other vendor tracker. Its readers are reached through the r/ClaudeAI post above, and the census post's section on CLAUDE.md tells the story the plan wanted told. The AGENTS.md project itself (agentsmd/agents.md) has no discussion forum, and its issues are not a place to promote a tool.
