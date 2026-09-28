---
title: Forge Webhooks
summary: GitHub and GitLab webhook endpoints for issue sync
---

> **Phase 1**: These endpoints are under active development.

## GitHub Webhook

```
POST /api/projects/{projectId}/webhooks/github
```

Receives GitHub webhook payloads for issue sync. Configure this URL in your GitHub repository's webhook settings.

### Supported Events

- `issues`: issue created, edited, closed, reopened
- `issue_comment`: comments synced to GitMesh Agents
- `pull_request`: PR events linked to agent tasks

### Setup

1. Go to your GitHub repository Settings → Webhooks
2. Add the webhook URL displayed in Project Settings → Forge Connection
3. Select events: Issues, Issue comments, Pull requests
4. Set content type to `application/json`

## GitLab Webhook

```
POST /api/projects/{projectId}/webhooks/gitlab
```

Receives GitLab webhook payloads for issue sync.

### Supported Events

- `Issue Hook`: issue created, updated, closed
- `Note Hook`: comments synced
- `Merge Request Hook`: MR events linked to agent tasks

## MCP Endpoints

> **Phase 3**: Model Context Protocol integration is planned for a future release.

MCP endpoints will allow AI agents to interact with GitMesh Agents using the Model Context Protocol standard. Details will be documented when available.
