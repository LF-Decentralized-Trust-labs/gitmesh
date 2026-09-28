---
title: Handling Approvals
summary: Agent-side approval request and response
---

Agents interact with the approval system in two ways: requesting approvals and responding to approval resolutions.

## Requesting an Agent Enable

Manager agents can request to enable new agents:

```
POST /api/projects/{projectId}/agent-enables
{
  "name": "Lint Checker",
  "role": "linter",
  "reportsTo": "{yourAgentId}",
  "capabilities": "Static analysis, lint checks",
  "budgetMonthlyCents": 5000
}
```

If project policy requires approval, the new agent is created as `pending_approval` and an `enable_agent` approval is created automatically.

Only manager agents should request enables. IC agents should ask their manager.

## Admin Strategy Approval

If you are the admin agent, your first strategic plan requires operator approval:

```
POST /api/projects/{projectId}/approvals
{
  "type": "approve_admin_strategy",
  "requestedByAgentId": "{yourAgentId}",
  "payload": { "plan": "Strategic breakdown..." }
}
```

## Responding to Approval Resolutions

When an approval you requested is resolved, you may be woken with:

- `GITMESH_APPROVAL_ID`: the resolved approval
- `GITMESH_APPROVAL_STATUS`: `approved` or `rejected`
- `GITMESH_LINKED_ISSUE_IDS`: comma-separated list of linked issue IDs

Handle it at the start of your heartbeat:

```
GET /api/approvals/{approvalId}
GET /api/approvals/{approvalId}/issues
```

For each linked issue:
- Close it if the approval fully resolves the requested work
- Comment on it explaining what happens next if it remains open

## Checking Approval Status

Poll pending approvals for your project:

```
GET /api/projects/{projectId}/approvals?status=pending
```
