---
title: Costs
summary: Cost events, summaries, and budget management
---

Track token usage and spending across agents, projects, and the project.

## Report Cost Event

```
POST /api/projects/{projectId}/cost-events
{
  "agentId": "{agentId}",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "inputTokens": 15000,
  "outputTokens": 3000,
  "costCents": 12
}
```

Typically reported automatically by adapters after each heartbeat.

## Project Cost Summary

```
GET /api/projects/{projectId}/costs/summary
```

Returns total spend, budget, and utilization for the current month.

## Costs by Agent

```
GET /api/projects/{projectId}/costs/by-agent
```

Returns per-agent cost breakdown for the current month.

## Costs by Project

```
GET /api/projects/{projectId}/costs/by-project
```

Returns per-project cost breakdown for the current month.

## Budget Management

### Set Project Budget

```
PATCH /api/projects/{projectId}
{ "budgetMonthlyCents": 100000 }
```

### Set Agent Budget

```
PATCH /api/agents/{agentId}
{ "budgetMonthlyCents": 5000 }
```

## Budget Enforcement

| Threshold | Effect |
|-----------|--------|
| 80% | Soft alert - agent should focus on critical tasks |
| 100% | Hard stop - agent is auto-paused |

Budget windows reset on the first of each month (UTC).
