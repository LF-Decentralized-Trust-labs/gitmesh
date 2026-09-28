---
title: "Scanners: where doctor stops"
sidebarTitle: Scanners
description: "gitmesh doctor checks the structure and hygiene of coding-agent configuration. It does not scan MCP servers, skills or instructions for prompt injection, tool poisoning or malicious content; that is Snyk Agent Scan's and Cisco's lane. Which tool answers which question."
---

Checked: 2026-09-17, against each scanner's repository.

`gitmesh doctor` and a content-security scanner read the same files and answer different questions. Doctor asks whether the configuration is **structurally sound and hygienic**: is a token committed, is a bypass mode committed, do the instruction copies different agents read agree, is an executable skill pinned, does an allow contradict a hook. A scanner asks whether the **content is hostile**: does a tool description carry a prompt injection, does a skill's script exfiltrate, did a server's tool definitions change since you reviewed them. Doctor never asks the second question. That is a standing non-goal, not a gap waiting for a release.

## Who does content security

| Tool | Scans | Detects | Notes |
|---|---|---|---|
| **Snyk Agent Scan** ([snyk/agent-scan](https://github.com/snyk/agent-scan)) | AI agents, MCP servers and agent skills | prompt injection, tool poisoning, tool shadowing and toxic flows in MCP servers; dangerous words, untrusted content, private data, destructive capabilities, suspicious downloads, malicious code, credential handling and secret detection in skills; tool pinning against changed definitions | Open source, about 3,100 GitHub stars. Grew out of Invariant Labs' `mcp-scan` after Snyk acquired Invariant in 2025 |
| **Cisco MCP Scanner** ([cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner)) | MCP servers: their tools, prompts, resources and server instructions | malicious MCP tools, combining YARA rules, LLM-based analysis and the Cisco AI Defense inspect API | Open source, about 1,100 GitHub stars |

Adjacent and narrower: **AgentLinter** (agentlinter.com) ships prompt-injection rules for instruction files, and **skillscheck** and **agent-skill-linter** check `SKILL.md` files for secret leaks. Doctor's only overlap with any of these is the plaintext-secret case, which [GM001](/findings/gm001) covers in configuration files, never in prose.

## What doctor does instead

- **Inventory**: every artifact each of the eleven registered adapters reads, third-party-manager surfaces included, in one read-only pass.
- **Cross-tool drift** between the instruction copies different agents read.
- **Structural risk findings** [GM001-GM011](/findings/overview): committed secrets and bypass modes, missing `.env` protection, unpinned executable skills, MCP definitions that disagree across tools, broken managed markers, oversized instruction files, orphan and mis-scoped config, the missing `AGENTS.md` bridge, and contradictions inside one tool's config.

[GM004](/findings/gm004) is the closest doctor comes to supply chain: it reports that a skill with executable content has no pin, and honors pins recorded in `skills-lock.json` and `.mcp.lock`. It does not look at what the skill does. Snyk Agent Scan's tool pinning and skill checks do.

## Use both

Run doctor for hygiene and a scanner for content, each with its own exit code, in the same CI job if you like. A clean doctor score says nothing about whether an MCP server or skill is safe, and doctor's findings are never a substitute for a scanner's.

## Related

- [Benchmark checklist](/comparisons): every check `/doctor`, cc-health-check, agents-lint and AgentLint publish, mapped to what doctor does with the same territory.
- [Coverage matrix](/doctor/coverage-matrix): which agents and surfaces doctor inventories today.
