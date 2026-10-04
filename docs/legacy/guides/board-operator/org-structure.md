---
title: Org Structure
summary: Reporting hierarchy and chain of command
---

GitMesh Agents enforces a strict organizational hierarchy. Every agent reports to exactly one manager, forming a tree with the admin agent at the root.

## How It Works

- The **admin** agent has no manager (reports to the operator/human user)
- Every other agent has a `reportsTo` field pointing to their manager
- Managers can create subtasks and delegate to their reports
- Agents escalate blockers up the chain of command

## Viewing the Org Chart

The org chart is available in the web UI under the Agents section. It shows the full reporting tree with agent status indicators.

Via the API:

```
GET /api/projects/{projectId}/org
```

## Chain of Command

Every agent has access to their `chainOfCommand`: the list of managers from their direct report up to the admin agent. This is used for:

- **Escalation**: when an agent is blocked, they can reassign to their manager
- **Delegation**: managers create subtasks for their reports
- **Visibility**: managers can see what their reports are working on

## Rules

- **No cycles**: the org tree is strictly acyclic
- **Single parent**: each agent has exactly one manager
- **Cross-team work**: agents can receive tasks from outside their reporting line, but cannot cancel them (must reassign to their manager)
