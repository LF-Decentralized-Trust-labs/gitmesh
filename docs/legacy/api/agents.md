---
title: Agents
summary: Agent lifecycle, configuration, keys, heartbeats, and org chart
---

# Agents

This page covers everything you can do with an agent record.
Endpoints are grouped by intent, not by HTTP verb.

---

## Inspect

| Action | Endpoint |
|--------|----------|
| List all agents in a project | `GET /api/projects/{projectId}/agents` |
| Get one agent | `GET /api/agents/{agentId}` |
| Get the currently authenticated agent | `GET /api/agents/me` |
| Org chart for a project | `GET /api/projects/{projectId}/org` |
| List adapter models | `GET /api/projects/{projectId}/adapters/{adapterType}/models` |
| List config revisions | `GET /api/agents/{agentId}/config-revisions` |

`GET /api/agents/me` returns the agent's chain of command alongside the
core fields:

```json
{
  "id": "agent-42",
  "name": "BackendEngineer",
  "role": "engineer",
  "title": "Senior Backend Engineer",
  "projectId": "project-1",
  "reportsTo": "mgr-1",
  "capabilities": "Node.js, PostgreSQL, API design",
  "status": "running",
  "budgetMonthlyCents": 5000,
  "spentMonthlyCents": 1200,
  "chainOfCommand": [
    { "id": "mgr-1", "name": "EngineeringLead", "role": "manager" },
    { "id": "admin-1", "name": "Triage", "role": "admin" }
  ]
}
```

`GET /api/projects/{projectId}/adapters/{adapterType}/models` returns
selectable models for the named adapter:

- `codex_local`: merged with OpenAI discovery when available.
- `opencode_local`: discovered from `opencode models`, returned in `provider/model` format. There are no static fallbacks; if discovery is unavailable, this list can be empty.

---

## Mutate (create, edit, lifecycle)

### Create

```
POST /api/projects/{projectId}/agents
{
  "name": "Engineer",
  "role": "engineer",
  "title": "Software Engineer",
  "reportsTo": "{managerAgentId}",
  "capabilities": "Full-stack development",
  "adapterType": "claude_local",
  "adapterConfig": { ... }
}
```

### Update

```
PATCH /api/agents/{agentId}
{
  "adapterConfig": { ... },
  "budgetMonthlyCents": 10000
}
```

### Lifecycle

| Effect | Endpoint | Notes |
|--------|----------|-------|
| Pause heartbeats | `POST /api/agents/{agentId}/pause` | Temporary; resumable |
| Resume heartbeats | `POST /api/agents/{agentId}/resume` | |
| Permanently deactivate | `POST /api/agents/{agentId}/terminate` | **Irreversible** |
| Roll back a config change | `POST /api/agents/{agentId}/config-revisions/{revisionId}/rollback` | |

---

## Credentials

```
POST /api/agents/{agentId}/keys
```

Mints a long-lived API key. Store it securely - the plaintext key
is shown exactly once at creation.

---

## Trigger work

```
POST /api/agents/{agentId}/heartbeat/invoke
```

Manually triggers a heartbeat for the agent. Used for on-demand wakes
from the operator UI or scripts.
