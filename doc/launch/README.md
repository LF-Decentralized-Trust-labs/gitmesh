# Launch kit: gitmesh doctor

Drafts and a checklist for launching `gitmesh doctor` (pivot §12, task T2.4; launch choreography in §17.2(a)). Nothing here is published by merging it: each piece is posted by hand, by a maintainer, after both maintainers have reviewed it.

| File | What it is |
|---|---|
| [show-hn.md](show-hn.md) | Show HN title, text, first comment and prepared answers |
| [posts.md](posts.md) | Posts for r/ClaudeAI, r/ChatGPTCoding and lobste.rs, and what replaces the "#6235-adjacent" post |
| [outreach.md](outreach.md) | Issues to Ruler, rulesync and @agents-dev/cli about reading their files (task T2.5), opened before launch |
| [../census/2026-10/README.md](../census/2026-10/README.md) | The census data post |
| [../../scripts/census/README.md](../../scripts/census/README.md) | How the census is run and reproduced |

## Order of events

1. **A few days before day 0:** open the three issues in [outreach.md](outreach.md), so the projects the posts name hear about GitMesh from us first.
2. **Day 0, morning (US Eastern):** publish the census post, then submit Show HN linking the repository. The benchmark page (T2.6) is live before either. Unless the docs site is hosted by then, the census post's address is its page on GitHub (`doc/census/2026-10/README.md` on `main`), which renders its tables as written.
3. **Day 0, following hours:** both maintainers answer comments. Nobody else is asked to.
4. **Days 1-3:** one post per venue in [posts.md](posts.md), on different days, each written for that venue. Never the same text twice.
5. **Day 7:** read the G1 number (below) and write down what happened, good or bad.

The `apply`/`migrate` and `policy` launches (§17.2 (b) and (c)) are separate news moments and are not in this kit.

## Before launch: blocking

Each box is a precondition, not a nice-to-have. A launch that sends readers to a doctor that is wrong about their own repository costs more than a launch a week later.

- [ ] **npm `latest` serves doctor.** On 2026-10-16 the `gitmesh-cli` dist-tags are `latest` 0.2.7 (the July stub, every command "not implemented") and `next` 0.4.0. Either promote a doctor release to `latest` (and change the README and docs to `npx gitmesh-cli doctor`), or keep `@next` in every link and command. These drafts use `@next`.
- [x] **GM010 stops warning on AGENTS.md-only repositories** ([#484](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/484)). Claude Code has read `AGENTS.md` in projects without a `CLAUDE.md` since v2.1.277. GM010 is doctor's second most common finding in the census, and 243 of its 321 warnings there are this case: readers would get the same false warning on their own repositories.
- [ ] **GM002 stops counting agents by `AGENTS.md` alone** ([#493](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/493), [#488](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/488)). It fires on every repository in the census, because Cursor and Claude Code count as present without any configuration of their own.
- [ ] **Doctor stops reading through symlinks that leave the repository** ([#500](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/500)). The pitch is that doctor is safe to point at any checkout.
- [ ] **Drift stops charging pointers and imports** ([#501](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/501)), or the docs say plainly that it does.
- [ ] **Census re-run with the fixed doctor:** `pnpm census scan` and `aggregate` against the committed manifest, numbers in the census post and in these drafts updated, and the reproduction `diff` empty. See [scripts/census/README.md](../../scripts/census/README.md).
- [ ] **GM001 hits checked by hand.** For each repository the census flags with a plaintext secret, a maintainer looks at the local result: a real credential is reported privately to that repository's maintainers (through its security policy, or privately to a maintainer) before the census post goes out, and a false positive gets a doctor issue.
- [ ] **Benchmark page live** (T2.6), linked from the README. §17.2 wants it on day one.
- [ ] **Docs reachable.** The hosted docs site does not build from this repository, so `/doctor/quickstart` and the finding pages 404 there. Fix the hosting or link GitHub file views in every post.
- [ ] **README demo current:** re-run `scripts/render-doctor-demo.mjs` after the doctor fixes.
- [ ] **README links the census post** in its Documentation list, and the post's draft banner is gone.
- [ ] **Both maintainers signed off** in the table below.
- [ ] **Two maintainers free for the first six hours** after Show HN, and for triage within 48 hours through launch month (TX.4).

## Review

AC for T2.4: both maintainers review. Tick a box when you have read the piece and agree to it going out as written, or after your edits land.

| Piece | Parvm1102 | Ronit-Raj9 |
|---|---|---|
| Show HN | [ ] | [ ] |
| r/ClaudeAI | [ ] | [ ] |
| r/ChatGPTCoding | [ ] | [ ] |
| lobste.rs | [ ] | [ ] |
| Census post | [ ] | [ ] |
| Census method and reproduction | [ ] | [ ] |

## Rules for every post

- **Disclose.** Every post says it comes from a GitMesh maintainer.
- **No vote or comment requests**, from friends, colleagues, Slack or Discord, anywhere. HN treats it as abuse, and so does every subreddit worth posting to.
- **One post per venue**, written for that venue. Read the venue's current rules on posting day; they change.
- **Not in vendor trackers.** No posts or links in anthropics/claude-code issues, Codex, Cursor or Copilot trackers. Issue threads are for the vendor's users and the vendor, not for us.
- **Name no repository next to a finding.** The census reports how common a pattern is, not who has it.
- **The pivot's honesty rules (§7):** never claim uniform enforcement; never call an instruction a guardrail; never imply GitMesh blocks anything at runtime; state Claude Code's `AGENTS.md` support factually; name the neighbors; say what is shipped (doctor) and what is planned (everything else).
- **Answer criticism with facts or with an issue.** A false positive someone reports in a thread gets an issue and a thank-you, not a defense.

## Facts sheet

Every number and claim in the drafts comes from here. When a fact changes, change it here first, then in each draft.

| Fact | Value, as of 2026-10-16 | Source |
|---|---|---|
| Command | `npx gitmesh-cli@next doctor` (package `gitmesh-cli`, binary `gitmesh`; `npx gitmesh` runs someone else's package) | [ADR-005](../adr/ADR-005-npm-package-naming.md), npm dist-tags |
| What doctor reads | Claude Code, Codex, Cursor, Copilot, Antigravity, OpenCode, Devin, Cline, Roo, plus `AGENTS.md` and third-party managers: eleven adapters | [coverage matrix](../../docs/doctor/coverage-matrix.md) |
| Findings | GM001-GM011; GM008 and GM009 are silent in this release | [findings overview](../../docs/findings/overview.md) |
| Never | writes a file, opens a network connection, runs a subprocess; no telemetry, no opt-in | [ADR-006](../adr/ADR-006-no-telemetry.md); CI runs every command of the packed CLI under a network spy |
| Score | 100, minus 20 per error, 5 per warning, 5 per divergent instruction pair; info is free | `lib/workspace-core/src/report/report.ts` |
| Exit codes | `0` nothing at or above `--fail-on`, `1` findings, `2` the run failed | README |
| Claude Code and `AGENTS.md` | reads `AGENTS.md` in a project with no `CLAUDE.md` since v2.1.277 (2026-09-18); anthropics/claude-code#6235 closed as completed on 2026-08-17; with both files present it reads `CLAUDE.md` | [#484](https://github.com/LF-Decentralized-Trust-labs/gitmesh/issues/484) |
| Neighbors | Claude Code's `/doctor` (alias `/checkup`), cc-health-check, agents-lint, AgentLint audit one tool or file class; Snyk Agent Scan and Cisco's scanner own content security | [comparisons](../../docs/comparisons.md), [scanners](../../docs/doctor/scanners.md) |
| Sync tools | Ruler, rulesync and @agents-dev/cli generate each agent's files from one source; rulesync also compiles one permissions file into native permission settings for 47 tools, the first since v7.30.0 (2026-04-13) | [outreach facts](outreach.md#facts-as-of-2026-10-19), checked 2026-10-19 |
| License, home | Apache-2.0; a Linux Foundation Decentralized Trust lab (residence is community affiliation, not endorsement) | §17.1 |
| Census | the 500 most-starred licensed, public, non-fork repositories with a root `AGENTS.md`, discovered 2026-10-16; numbers in the census post | [doc/census/2026-10](../census/2026-10/README.md) |

## Measuring it

G1 (§15): at least 200 unique doctor runs in the first week, read through npm downloads of `gitmesh-cli` (ADR-006 rules out anything else). Record the baseline the day before launch and the total on day 7:

```bash
curl -s https://api.npmjs.org/downloads/range/<day-before>:<day-7>/gitmesh-cli
```

Downloads overcount (CI installs, mirrors) and undercount (`npx` cache hits), and the methodology is published with the number. If G1 is missed after two launch pushes with different messaging, K1 applies: one structured re-cut of the story (lead with GM001 secrets, with the `AGENTS.md` bridge, or with the census data) before anything about scope changes.
