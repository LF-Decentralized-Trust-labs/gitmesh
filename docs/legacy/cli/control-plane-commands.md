---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm gitmesh-agents issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm gitmesh-agents issue get <issue-id-or-identifier>

# Create issue
pnpm gitmesh-agents issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm gitmesh-agents issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm gitmesh-agents issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm gitmesh-agents issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm gitmesh-agents issue release <issue-id>
```

## Project Commands

```sh
pnpm gitmesh-agents project list
pnpm gitmesh-agents project get <project-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm gitmesh-agents project export <project-id> --out ./exports/acme --include project,agents

# Preview import (no writes)
pnpm gitmesh-agents project import \
  --from https://github.com/<owner>/<repo>/tree/main/<path> \
  --target existing \
  --project-id <project-id> \
  --collision rename \
  --dry-run

# Apply import
pnpm gitmesh-agents project import \
  --from ./exports/acme \
  --target new \
  --new-project-name "Acme Imported" \
  --include project,agents
```

## Agent Commands

```sh
pnpm gitmesh-agents agent list
pnpm gitmesh-agents agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm gitmesh-agents approval list [--status pending]

# Get approval
pnpm gitmesh-agents approval get <approval-id>

# Create approval
pnpm gitmesh-agents approval create --type enable_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm gitmesh-agents approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm gitmesh-agents approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm gitmesh-agents approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm gitmesh-agents approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm gitmesh-agents approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm gitmesh-agents activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm gitmesh-agents dashboard get
```

## Heartbeat

```sh
pnpm gitmesh-agents heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
