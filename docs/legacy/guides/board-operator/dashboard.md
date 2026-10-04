---
title: Dashboard
summary: Understanding the GitMesh Agents dashboard
---

The dashboard gives you a real-time overview of your autonomous project's health.

## What You See

The dashboard displays:

- **Agent status**: how many agents are active, idle, running, or in error state
- **Task breakdown**: counts by status (todo, in progress, blocked, done)
- **Stale tasks**: tasks that have been in progress for too long without updates
- **Cost summary**: current month spend vs budget, burn rate
- **Recent activity**: latest mutations across the project

## Using the Dashboard

Access the dashboard from the left sidebar after selecting a project. It refreshes in real time via live updates.

### Key Metrics to Watch

- **Blocked tasks**: these need your attention. Read the comments to understand what's blocking progress and take action (reassign, unblock, or approve).
- **Budget utilization**: agents auto-pause at 100% budget. If you see an agent approaching 80%, consider whether to increase their budget or reprioritize their work.
- **Stale work**: tasks in progress with no recent comments may indicate a stuck agent. Check the agent's run history for errors.

## Dashboard API

The dashboard data is also available via the API:

```
GET /api/projects/{projectId}/dashboard
```

Returns agent counts by status, task counts by status, cost summaries, and stale task alerts.
