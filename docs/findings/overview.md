---
title: "Findings"
sidebarTitle: "All findings"
description: "Every risk finding gitmesh doctor can report, GM001 to GM011: severity, what each rule checks, and where it applies."
---

Every finding `gitmesh doctor` reports carries a stable id in the ESLint style. Each page below states what the rule checks, why it matters, the exact message shape, how to clear it, and what the rule deliberately does not report.

| Id | Severity | Finding |
|---|---|---|
| [GM001](/findings/gm001) | error | Plaintext secret or token in an MCP config, settings, hooks or config file |
| [GM002](/findings/gm002) | warning | No deny/ask protection for `.env` files in an agent that can express one |
| [GM003](/findings/gm003) | error | Bypass-permissions, auto-approve or danger-full-access mode in shared config |
| [GM004](/findings/gm004) | warning | Skill with executable content and no recognized pin |
| [GM005](/findings/gm005) | warning | Same MCP server defined with different urls or credentials across tools |
| [GM006](/findings/gm006) | warning | Generated-looking file hand-edited: broken `gitmesh:managed` markers |
| [GM007](/findings/gm007) | warning | Instruction file exceeds the 40,000-character threshold |
| [GM008](/findings/gm008) | info | Orphan config for an agent unseen in repository history |
| [GM009](/findings/gm009) | warning | Inconsistent local-vs-shared hygiene: `.gitignore` vs committed status |
| [GM010](/findings/gm010) | warning | `CLAUDE.md` without an `AGENTS.md` bridge, or vice versa |
| [GM011](/findings/gm011) | warning | Semantic contradictions inside one tool's own config |

## Severities and the run

- **error**: a plaintext secret in agent config, or a shared setting that switches off an agent's own approvals. Costs 20 score points.
- **warning**: hygiene or drift with real consequences but no active bypass. Costs 5 points.
- **info**: worth a look, harms nothing at runtime. Costs nothing.

`--fail-on <severity>` (default `warning`) decides which severities make the run exit `1`. See the [quickstart](/doctor/quickstart) for exit codes and output modes.

## Rules that are silent today

Two rules are implemented and tested but produce no findings in this release, because the doctor pipeline does not yet supply the evidence they need:

- [GM008](/findings/gm008) needs repository-history evidence per agent.
- [GM009](/findings/gm009) needs per-file tracked and ignored status.

Both wait on a git reader that keeps doctor free of subprocesses; each page names the tool that covers the gap now. Doctor never guesses: absence of evidence is never reported as a finding.

## Guarantees shared by every rule

- **What the report can quote.** A GM001 finding names the file, the line and, when there is one, the key of a secret, never any part of the value, in every output mode (TTY, `--json`, `--md`). Other parts of the report quote configuration text: GM011 quotes permission entries, and the drift section quotes instruction-file blocks (in full in `--json`). Those quotes are redacted only where GM001's scanner recognizes a secret, so a value it does not recognize, such as a generic bearer token inside an allow entry or the body of a private key below its redacted `BEGIN` line, is printed as written. Review the output before posting it publicly.
- **Being managed is never itself a finding.** Artifacts owned by Ruler, rulesync, agents-json, agentsync-family tools, symlink managers, skills-lock or mcp-lock are labeled informationally (ADR-004). Their contents are still checked wherever a rule reads that kind of file: a token in `.ruler/mcp.json` or `ruler.toml` is still GM001. Source files such as `.agents/agents.json` are not scanned yet.
- **Scope, not git status.** Doctor reads the working tree and classifies each file by its path: project (shared, normally committed), local, user or managed. It does not read git status in this release, so a gitignored copy of a project-scope file is judged like a committed one, and a committed local-scope file is not flagged.
- **Deterministic.** The same inputs produce a byte-identical report; findings sort by id, path, adapter and message. The inputs include a few machine-level presence probes that run without `--user` (org-managed Claude settings, Codex's `requirements.toml`, the Antigravity CLI settings file, a set `CODEX_HOME`), so the same repository can list different artifacts, and through GM002 report different findings, on two machines.
- **Tolerant.** A file that fails to parse never crashes the run. Line-based checks still read it (GM001, and GM003's Codex check); rules that need the parsed structure treat it as empty, so a malformed Claude settings file gets no GM003 for a bypass mode, and its deny rules do not count as protection for GM002. A file doctor may not read aborts the run with exit `2`.
