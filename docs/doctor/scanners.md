---
title: "Scanners: where doctor stops"
sidebarTitle: Scanners
description: "gitmesh doctor checks agent-config structure and hygiene. Prompt injection, tool poisoning and malicious skills are Snyk Agent Scan and Cisco territory."
---

Checked: 2026-10-02, against each project's repository and README.

`gitmesh doctor` and a content-security scanner read the same files and answer different questions. Doctor asks whether the configuration is **structurally sound and hygienic**: is a token sitting in a config file, is a bypass mode switched on in shared config, do the instruction copies different agents read agree, is an executable skill pinned, does an allow contradict a hook. A scanner asks whether the **content is hostile**: does a tool description carry a prompt injection, does a skill's script exfiltrate data. Doctor never asks the second question. That is a standing non-goal, not a gap waiting for a release.

## Who does content security

| Tool | Scans | Detects | Notes |
|---|---|---|---|
| **Snyk Agent Scan** ([snyk/agent-scan](https://github.com/snyk/agent-scan)) | AI agents, MCP servers and agent skills | in MCP servers: prompt injection, untrusted content, private data and destructive capabilities; in skills: prompt injection, suspicious downloads, malicious code, credential handling and secret detection (the v0.6 risk list) | Open source, about 3,100 GitHub stars. Grew out of Invariant Labs' `mcp-scan` after Snyk acquired Invariant in 2025 |
| **Cisco MCP Scanner** ([cisco-ai-defense/mcp-scanner](https://github.com/cisco-ai-defense/mcp-scanner)) | MCP servers: their tools, prompts, resources and server instructions | malicious MCP tools, combining YARA rules, LLM-based analysis and the Cisco AI Defense inspect API | Open source, about 1,100 GitHub stars |

Adjacent and narrower: **AgentLinter** (agentlinter.com) ships prompt-injection rules for instruction files, and **skillscheck** flags leaked secrets in skills. Doctor's only overlap with any of these is the plaintext-secret case, which [GM001](/findings/gm001) covers in configuration files, never in prose.

## What doctor does instead

- **Inventory**: every artifact each registered adapter reads, third-party-manager surfaces included, in one read-only pass.
- **Cross-tool drift** between the instruction copies different agents read.
- **Structural risk findings** [GM001-GM011](/findings/overview): plaintext secrets and bypass modes in agent config, missing `.env` protection, unpinned executable skills, MCP definitions that disagree across tools, broken managed markers, oversized instruction files, orphan and mis-scoped config, the missing `AGENTS.md` bridge, and contradictions inside one tool's config.

[GM004](/findings/gm004) is the closest doctor comes to supply chain: it reports that a skill with executable content has no pin, and honors pins recorded in `skills-lock.json` and `.mcp.lock`. It does not look at what the skill does; Snyk Agent Scan's skill checks do.

## Use both

Run doctor for hygiene and a scanner for content, each with its own exit code, in the same CI job if you like. A clean doctor score says nothing about whether an MCP server or skill is safe, and doctor's findings are never a substitute for a scanner's.

## Related

- [Coverage matrix](/doctor/coverage-matrix): which agents and surfaces doctor inventories today.
- [Findings](/findings/overview): every rule doctor runs, with what it checks and what it deliberately leaves out.
