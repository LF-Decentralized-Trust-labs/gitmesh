---
title: "Findings"
description: "Every risk finding gitmesh doctor can report, GM001 to GM011: severity, what each rule checks, and where it applies."
---

Every finding `gitmesh doctor` reports carries a stable id in the ESLint style. Each page below states what the rule checks, why it matters, the exact message shape, how to clear it, and what the rule deliberately does not report.

| Id | Severity | Finding |
|---|---|---|
| [GM001](/findings/gm001) | error | Plaintext secret or token in an MCP config, settings, hooks or config file |
| [GM002](/findings/gm002) | warning | No deny/ask protection for `.env` files in an agent that can express one |
| [GM003](/findings/gm003) | error | Bypass-permissions, auto-approve or danger-full-access mode in committed config |
| [GM004](/findings/gm004) | warning | Skill with executable content and no recognized pin |
| [GM005](/findings/gm005) | warning | Same MCP server defined with different urls or credentials across tools |
| [GM006](/findings/gm006) | warning | Generated-looking file hand-edited: broken `gitmesh:managed` markers |
| [GM007](/findings/gm007) | warning | Instruction file exceeds the effective-context threshold |
| [GM008](/findings/gm008) | info | Orphan config for an agent unseen in repository history |
| [GM009](/findings/gm009) | warning | Inconsistent local-vs-shared hygiene: `.gitignore` vs committed status |
| [GM010](/findings/gm010) | warning | `CLAUDE.md` without an `AGENTS.md` bridge, or vice versa |
| [GM011](/findings/gm011) | warning | Semantic contradictions inside one tool's own config |

## Severities and the run

- **error**: the config actively weakens something for everyone who clones the repository (a committed token, a disabled approval mode). Costs 20 score points.
- **warning**: hygiene or drift with real consequences but no active bypass. Costs 5 points.
- **info**: worth a look, harms nothing at runtime. Costs nothing.

`--fail-on <severity>` (default `warning`) decides which severities make the run exit `1`. See the [quickstart](/doctor/quickstart) for exit codes and output modes.

## Rules that are silent today

Two rules are implemented and tested but produce no findings in this release, because the doctor pipeline does not yet supply the evidence they need:

- [GM008](/findings/gm008) needs repository-history evidence per agent.
- [GM009](/findings/gm009) needs per-file tracked and ignored status.

Both wait on a git reader that keeps doctor free of subprocesses; each page names the tool that covers the gap now. Doctor never guesses: absence of evidence is never reported as a finding.

## Guarantees shared by every rule

- **Values are redacted.** A finding names the file, line and key of a secret, never any part of the value, in every output mode (TTY, `--json`, `--md`).
- **Managed-by-another-tool is never a finding.** Artifacts owned by Ruler, rulesync, `.agents/agents.json`, agentsync-family tools, symlink managers, skills-lock or mcp-lock are labeled informationally (ADR-004). A committed token inside one of them is still GM001: the finding is about the file, not about who generated it.
- **Deterministic.** The same repository produces a byte-identical report; findings sort by id, path, adapter and message.
- **Tolerant.** A file that fails to parse is skipped by the rule that needed it, never a crash. The honest consequence: an unparseable committed settings file produces no finding today.
