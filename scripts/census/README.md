# Agent configuration census

The census runs `gitmesh doctor` across the 500 most-starred open-source repositories that ship an `AGENTS.md`, and publishes how their coding-agent configuration is spread across tools, how instruction files relate to each other, and what doctor reports about them (pivot §12, task T2.4). Each edition lives in `doc/census/<YYYY-MM>/`:

| File | What it is | Committed |
|---|---|---|
| `manifest.json` | the 500 repositories, each pinned to the commit its default branch pointed at on discovery day | yes |
| `stats.json` | the statistics, counts only | yes |
| `stats.md` | the same statistics as tables | yes |
| `README.md` | the write-up of that edition | yes |
| per-repository results | doctor's `--json` report for each repository | **no**, see [Results stay local](#results-stay-local) |

The scripts are a maintainer tool, run by hand: no package ships them and no CI job runs them. They need the network (the GitHub API and `git fetch`); doctor itself, as everywhere, does not.

## Reproduce an edition

From a checkout of the commit that published the edition, after `pnpm install`:

```bash
pnpm census scan --manifest doc/census/2026-10/manifest.json --results ~/census/results --work ~/census/work
pnpm census aggregate --manifest doc/census/2026-10/manifest.json --results ~/census/results --out ~/census/check
diff ~/census/check/stats.json doc/census/2026-10/stats.json
```

`diff` prints nothing when the reproduction matches. Statistics depend on the doctor in the checkout, so run them from that commit, not from a later one. They come out byte-identical as long as every pinned commit can still be fetched; a repository deleted, made private or force-pushed since discovery is reported as unavailable and drops out of the counts, which `stats.md` states.

What a scan costs: the 2026-10 edition downloaded about 25 GB and took about 45 minutes at `--concurrency 6`, at around 10 MB/s. Checkouts are made in `--work` (default: the system temp directory) and deleted as the scan goes, so peak disk use is a few GB; the results come to about 20 MB. An interrupted scan resumes: results already in `--results` for the same commit and gitmesh version are kept. Run it on Linux or macOS.

## Start a new edition

```bash
GITHUB_TOKEN=<token> pnpm census discover --out doc/census/2027-01/manifest.json
```

Any token works, since only public data is read: `gh auth token` prints one with a recent `gh`. Discovery makes a few dozen GraphQL requests and clones nothing. Then scan and aggregate as above, with `--out doc/census/2027-01`, and write that edition's `README.md`.

To try the whole pipeline in a few minutes, discover with `--limit 10` into a scratch file and scan and aggregate that.

## Selection

`discover` walks GitHub repository search for

```text
is:public fork:false archived:false mirror:false sort:stars-desc stars:>=1000
```

in descending star order and keeps the first 500 repositories that

- carry a license GitHub can name (an SPDX id; GitHub's "Other" does not count): "open source" means licensed, and
- have an `AGENTS.md` at the root of the default branch, a file or a symlink, which is where the standard puts it.

Each one is pinned to its default-branch commit on discovery day; its star count that day is recorded. The star floor only keeps GitHub's search fast and correctly sorted: an unbounded search over every public repository times out and comes back partial and out of order. The 500th repository of the 2026-10 edition has over 19,000 stars, far above it.

## What a scan does

For each repository in the manifest:

1. **Fetch exactly the pinned commit**, shallowly, into a fresh directory. git runs without the user's or the system's git config, so no autocrlf, filter or credential setting of the scanning machine changes the checkout. Git LFS content and submodules are not fetched: LFS files stay pointer files, and submodules are other repositories with configuration of their own.
2. **Re-point symlinks that leave the checkout.** Doctor follows symlinks ([#500](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/500)), and a census must never read files of the machine running it. A symlink that resolves outside the checkout is re-pointed at a path that does not exist, so doctor reports it as broken, which is what it is on any machine without that path. The result records each one.
3. **Run doctor** in process, as `gitmesh doctor --json --fail-on none`, with its machine-level probes pinned off (org-managed settings, `requirements.toml`, the Antigravity CLI settings file, `CODEX_HOME`) and without `--user`: the way doctor's own golden tests run it. What doctor reports depends on the repository alone.
4. **Write the result and delete the checkout.**

### Results stay local

A result holds doctor's full `--json` report. It quotes the repository's instruction files (the drift report does) and its findings name files, so results stay on the machine that ran the scan, and only aggregate statistics are published. No edition names a repository next to a finding: the census reports how common a pattern is, not who has it. If you come across a credential while looking at results, tell that repository's maintainers privately rather than publishing it.

## Definitions

These are the definitions `aggregate.ts` implements; `stats.md` repeats the ones its tables need.

- **Repository files only.** Only project- and local-scope artifacts count. User and managed artifacts are machine state, and the scan pins those probes off anyway.
- **The shared standard.** `AGENTS.md`, at any depth, is read by many agents, so it is no one agent's own configuration. Nested `AGENTS.md` files are counted separately.
- **Configuration of an agent's own.** An agent has configuration of its own in a repository when doctor inventoried a file for it that no other agent claims. That is GM008's notion of a distinctive artifact; the third-party-managers adapter is not an agent, and `agentsmd` sees `AGENTS.md` alone, so neither gets a row. Files that several agents claim, such as `.cursorrules` (Cursor and Cline), are counted as shared files and credited to none of them.
- **Surfaces.** An agent's files are grouped by artifact kind into instructions and rules, MCP, skills, commands and subagents, and settings, hooks and plugins: the columns of the [coverage matrix](../../docs/doctor/coverage-matrix.md). A kind the census does not know stops `aggregate` with an error rather than being miscounted.
- **Root instruction files** are the documents doctor diffs: one per agent at the repository root, plus `.github/copilot-instructions.md`. Each one besides `AGENTS.md` is classified by how it relates to `AGENTS.md`:
  - **symlink**: one file links to the other, or both to one file;
  - **`@AGENTS.md` import**: the file pulls `AGENTS.md` in with an `@AGENTS.md` line, in `CLAUDE.md` or `GEMINI.md`, whose agents expand `@` imports (doctor leaves such a `CLAUDE.md` out of its diff; the census recognizes the line in `GEMINI.md` too). In other files the line is text the model may or may not follow, so it counts as a pointer;
  - **identical copy**: a separate file with the same content, block for block;
  - **diverged copy**: shares at least one block with `AGENTS.md` and differs in others;
  - **pointer**: shares no block, and the shorter of the two files has at most three blocks and names the other, as in "See AGENTS.md";
  - **separate document**: shares no block otherwise;
  - **unreadable**: a broken symlink, or content doctor could not read.

  Blocks are doctor's normalized Markdown blocks (headings, paragraphs, lists, code fences), so whitespace and formatting differences do not count.
- **Doctor's drift** is reported as doctor computes it: repositories where it compared two or more root documents, and repositories with at least one pair that is not identical. It diffs pointers and separate documents as if they were copies.
- **MCP** counts repositories with a dedicated MCP config file (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.roo/mcp.json`, Antigravity `mcp_config.json`). MCP servers declared inside `.codex/config.toml`, `opencode.json` or `.gemini/settings.json` are not visible as a separate artifact in doctor's report; GM005 compares them all.
- **Skills** counts repositories with a `SKILL.md` for any agent, those with skills for more than one agent, and those with a skill of the same name (its directory) in more than one agent's skills directory.
- **Managers** counts repositories with files doctor labels "managed by" each third-party tool; `symlinks` means a known agent config path is a symlink.
- **Findings and scores** are doctor's, as released, per repository: a rule counts once per repository however often it fires there.

## Limitations

- **Stars select popular repositories**, and in 2026 the most-starred list leans toward AI tooling. The census describes the most visible repositories that have adopted `AGENTS.md`, not GitHub as a whole.
- **Requiring a root `AGENTS.md`** means every repository counted has already adopted the standard; how many repositories have agent configuration without it is a different question.
- **Doctor's coverage is the census's coverage.** What doctor does not read for an agent is invisible here; the [coverage matrix](../../docs/doctor/coverage-matrix.md) lists it.
- **Findings inherit doctor's known false positives.** Check the open issues for a rule before quoting its count. The 2026-10 edition's write-up names the rules whose counts are distorted.
- **Pointer is a heuristic.** A short document that names `AGENTS.md` in passing is counted as a pointer.
