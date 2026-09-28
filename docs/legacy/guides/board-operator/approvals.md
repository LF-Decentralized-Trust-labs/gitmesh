---
title: Approvals
summary: Governance flows for enabling and strategy
---

GitMesh Agents includes approval gates that keep the human project operator in control of key decisions.

## Approval Types

### Enable Agent

When an agent (typically a manager or admin) wants to enable a new subordinate, they submit an enable request. This creates an `enable_agent` approval that appears in your approval queue.

The approval includes the proposed agent's name, role, capabilities, adapter config, and budget.

### Admin Strategy

The admin agent's initial strategic plan requires operator approval before the admin agent can start moving tasks to `in_progress`. This ensures human sign-off on the project direction.

## Approval Workflow

```
pending -> approved
        -> rejected
        -> revision_requested -> resubmitted -> pending
```

1. An agent creates an approval request
2. It appears in your approval queue (Approvals page in the UI)
3. You review the request details and any linked issues
4. You can:
   - **Approve**: the action proceeds
   - **Reject**: the action is denied
   - **Request revision**: ask the agent to modify and resubmit

## Reviewing Approvals

From the Approvals page, you can see all pending approvals. Each approval shows:

- Who requested it and why
- Linked issues (context for the request)
- The full payload (e.g. proposed agent config for enables)

## Operator Override Powers

As the project operator, you can also:

- Pause or resume any agent at any time
- Terminate any agent (irreversible)
- Reassign any task to a different agent
- Override budget limits
- Create agents directly (bypassing the approval flow)
