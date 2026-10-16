# Show HN

Posted by one maintainer, from their own account, with the other one around to answer. Two blanks are filled on the day: `{name}`, whoever posts, and `{benchmark page link}`, the T2.6 page. Read [the rules for every post](README.md#rules-for-every-post) and the [Show HN guidelines](https://news.ycombinator.com/showhn.html) first: Show HN is for something people can run, ideally without signing up, and asking anyone for votes or comments is not okay there.

## Title

```text
Show HN: GitMesh – audit every AI coding agent's config in your repo at once
```

76 characters; HN cuts titles at 80. The plan's title ("... in your repo - all vendors at once") is 90.

## URL

```text
https://github.com/LF-Decentralized-Trust-labs/gitmesh
```

The repository, not the docs site or the census post: Show HN links to the thing itself. The census post is linked from the text.

## Text

HN shows the text above the thread when the submission has a URL. If it does not show, post it as the first comment.

> I'm {name}, one of GitMesh's two maintainers.
>
> A repository that uses more than one coding agent ends up with configuration for each: an AGENTS.md, a CLAUDE.md, .cursor/rules, .github/copilot-instructions.md, an .mcp.json, two or three skills directories, permission and hook settings. Every agent reads its own files and nothing reads them together. gitmesh doctor does, in one read-only pass:
>
>     npx gitmesh-cli@next doctor
>
> It inventories the agent configuration for Claude Code, Codex, Cursor, Copilot, Antigravity, OpenCode, Devin, Cline and Roo; diffs the instruction files the agents read against each other; and reports findings with stable ids, such as a token pasted into an MCP config, a bypass or auto-approve mode committed for everyone who clones, a skill that ships scripts with no pin, or one MCP server defined differently for two agents. It prints a 0-100 score and exits non-zero for CI. It writes no files, makes no network calls and runs no subprocesses, and CI holds every release to that by running each command under a network spy. There is no telemetry.
>
> To see what is out there, we ran it over the 500 most-starred open-source repositories with an AGENTS.md: three in four commit configuration that only one specific agent reads, and 37% do so for two or more. Of the 372 instruction files they keep next to AGENTS.md, more than half are symlinks or @AGENTS.md imports and only six are identical copies; the rest are separate documents, one-line pointers or copies that have drifted. The post, the method and the scripts are in the repo, so the numbers can be reproduced: https://github.com/LF-Decentralized-Trust-labs/gitmesh/blob/main/doc/census/2026-10/README.md
>
> What it doesn't do: it enforces nothing (each agent's own permission model does that), and it doesn't scan for prompt injection or malicious skills (Snyk Agent Scan and Cisco's scanner do). Claude Code's /doctor, cc-health-check, agents-lint and AgentLint each audit one tool or one file type well; doctor looks across all of them, and the comparison page says where each one is the better choice: {benchmark page link}
>
> It's Apache-2.0, a Linux Foundation Decentralized Trust lab. The most useful thing you could send us is a false positive from your own repository.

## First comment: how it works

Post this one as a reply a few minutes after submitting, whether or not the text showed.

> Some detail for anyone curious about the internals:
>
> - One detector per agent, each with golden fixtures (an input repository and the exact expected output, compared byte for byte), negative cases included. Symlinks are reported with their targets, so a CLAUDE.md that links to AGENTS.md counts as one document and zero drift.
> - Drift: instruction files are normalized into Markdown blocks (headings, paragraphs, lists, code fences) and each block is hashed, so whitespace and formatting don't count, and doctor reports which blocks are in which file.
> - Rules are a table: an id, a severity, which artifacts it applies to, and a pure check. A GM001 finding names the file, the line and the key of a secret, never its value, and recognized credentials are masked wherever the report quotes configuration text.
> - Files that Ruler, rulesync, @agents-dev/cli or a symlink manager own are labeled "managed by X" and never flagged for being managed.
> - Same input, byte-identical output: no timestamps, sorted everything. That's what makes it usable as a CI gate.
>
> What's next is a source of truth you compile from (AGENTS.md plus a small .gitmesh/workspace.yaml) into each agent's native files, a drift check for CI, and one policy compiled into each agent's own permission settings, with a generated matrix of what each agent can actually enforce. None of that ships yet; doctor is the only command that does anything today.

## Prepared answers

Short, factual, and only when asked. Each answer links its source.

**Why not just symlink CLAUDE.md to AGENTS.md?**
That's the healthy pattern, and doctor reports it as zero drift. Claude Code also reads AGENTS.md on its own now in projects without a CLAUDE.md (v2.1.277). Symlinks don't cover the rest: MCP configs, skills directories and permission settings have different paths and formats per agent. In the census, 38% of repositories ship skills, and 78 keep the same skill in more than one agent's skills directory.

**Isn't this what Ruler or rulesync do?**
They generate each agent's files from one source, and they do it well. Doctor audits whatever is in the repository, including repositories they manage, which it labels "managed by ruler" and leaves alone. When GitMesh gets an import command, it will import from them, not compete with them.

**Does it send anything anywhere?**
No. No network calls, no telemetry, no opt-in ping: [ADR-006](../adr/ADR-006-no-telemetry.md). CI installs the packed tarball and runs every command under a preload that kills the process on the first socket, DNS query or subprocess.

**Why `npx gitmesh-cli` and not `npx gitmesh`?**
The `gitmesh` name on npm belongs to an unrelated project, so `npx gitmesh` runs someone else's code. The package is `gitmesh-cli`, the binary is `gitmesh` ([ADR-005](../adr/ADR-005-npm-package-naming.md)).

**What does the score mean?**
100, minus 20 per error, 5 per warning and 5 per pair of instruction files that differ; informational findings are free. It's coarse on purpose; the findings are the point.

**It flagged something wrong on my repository.**
Thank you; please open an issue with the finding id and the file (redact anything secret). Known false positives are tracked as issues, and the census post names the rules whose numbers they affect.

**Is this an AI tool?**
No model is involved. It's a static reader of configuration files, written in TypeScript.

**Does the Linux Foundation endorse it?**
No. It's hosted as a Linux Foundation Decentralized Trust lab, which is a community home, not an endorsement.

**How is this different from Claude Code's /doctor?**
/doctor audits Claude Code's own setup from inside a session, including runtime state no file shows. gitmesh doctor reads the repository for every agent at once, runs in CI and changes nothing. Use both: [comparisons](../../docs/comparisons.md).
