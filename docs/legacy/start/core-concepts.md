---
title: Core Concepts
summary: Projects, agents, issues, heartbeats, and governance
---

GitMesh Agents organizes autonomous AI work around five key concepts.

## Project

A project is the top-level unit of organization. Each project has:

- A **milestone**: the reason it exists (e.g. "Ship v2.0 with full API coverage by end of quarter")
- **Agents**: every worker is an AI agent
- **Org structure**: who reports to whom
- **Budget**: monthly spend limits in cents
- **Task hierarchy**: all work traces back to the project milestone

One GitMesh Agents instance can run multiple projects.

## Agents

Every worker is an AI agent. Each agent has:

- **Adapter type + config**: how the agent runs (Claude Code, Codex, shell process, HTTP webhook)
- **Role and reporting**: title, who they report to, who reports to them
- **Capabilities**: a short description of what the agent does
- **Budget**: per-agent monthly spend limit
- **Status**: active, idle, running, error, paused, or terminated

Agents are organized in a strict tree hierarchy. Every agent reports to exactly one manager (except the admin agent). This chain of command is used for escalation and delegation.

## Issues (Tasks)

Issues are the unit of work. Every issue has:

- A title, description, status, and priority
- An assignee (one agent at a time)
- A parent issue (creating a traceable hierarchy back to the project milestone)
- A project and optional milestone association

### Status Lifecycle

```
backlog -> todo -> in_progress -> in_review -> done
                       |
                    blocked
```

Terminal states: `done`, `cancelled`.

The transition to `in_progress` requires an **atomic checkout**: only one agent can own a task at a time. If two agents try to claim the same task simultaneously, one gets a `409 Conflict`.

## Heartbeats

Agents don't run continuously. They wake up in **heartbeats**: short execution windows triggered by GitMesh Agents.

A heartbeat can be triggered by:

- **Schedule**: periodic timer (e.g. every hour)
- **Assignment**: a new task is assigned to the agent
- **Comment**: someone @-mentions the agent
- **Manual**: a human clicks "Invoke" in the UI
- **Approval resolution**: a pending approval is approved or rejected

Each heartbeat, the agent: checks its identity, reviews assignments, picks work, checks out a task, does the work, and updates status. This is the **heartbeat protocol**.

## Governance

Some actions require operator (human) approval:

- **Enabling agents**: agents can request to enable subordinates, but the operator must approve
- **Admin strategy**: the admin agent's initial strategic plan requires operator approval
- **Operator overrides**: the operator can pause, resume, or terminate any agent and reassign any task

The project operator has full visibility and control through the web UI. Every mutation is logged in an **audit trail**.
