---
title: Forge Webhooks
summary: GitHub, GitLab, and Forgejo webhook endpoints for real-time issue/PR sync
---

## Inbound Webhook Endpoints

Forge providers (GitHub, GitLab, Forgejo) POST events to these stateless endpoints.
Configure the matching URL in your forge's webhook settings.

### GitHub

```
POST /api/forge/webhook/github
```

**Headers:** `X-Hub-Signature-256` (HMAC-SHA256), `X-GitHub-Event`, `X-GitHub-Delivery`

Supported events:

| `X-GitHub-Event` | Actions            | Mapped internal type                       |
|------------------|--------------------|-------------------------------------------|
| `issues`         | opened/closed/reopened | `issue_opened`, `issue_closed`, `issue_reopened` |
| `issue_comment`  | created            | `issue_comment`                            |
| `pull_request`   | opened/closed      | `pr_opened`, `pr_closed`, `pr_merged`      |

### GitLab

```
POST /api/forge/webhook/gitlab
```

**Headers:** `X-Gitlab-Event`, `X-Gitlab-Token`

Supported events: `Issue Hook`, `Note Hook`, `Merge Request Hook`

### Forgejo / Gitea

```
POST /api/forge/webhook/forgejo
```

**Headers:** `X-Forgejo-Event` or `X-Gitea-Event`

Supported events: `issues`, `issue_comment`, `pull_request`

---

## Management Endpoints (project-scoped)

### List webhooks

```
GET /api/projects/{projectId}/forge/webhooks
```

### Register a webhook

```
POST /api/projects/{projectId}/forge/webhooks
```

Body: `{ "forgeProvider": "github", "forgeOwner": "owner", "forgeRepo": "repo", "events": [...] }`

### Deactivate a webhook

```
DELETE /api/projects/{projectId}/forge/webhooks/{webhookId}
```

### Rotate webhook secret

```
POST /api/projects/{projectId}/forge/webhooks/{webhookId}/rotate
```

### Test webhook delivery

```
POST /api/projects/{projectId}/forge/webhooks/{webhookId}/test
```

### Connect/update forge

```
PATCH /api/projects/{projectId}/forge
```

Body: `{ "repoUrl": "https://github.com/owner/repo", "token": "ghp_..." }`

---

## Setup (GitHub)

1. Go to your GitHub repository **Settings → Webhooks → Add webhook**
2. **Payload URL**: `https://<your-domain>/api/forge/webhook/github`
3. **Content type**: `application/json`
4. **Secret**: use the webhook secret shown in Project Settings → Forge Integration
5. **Events**: Issues, Issue comments, Pull requests
6. Save — GitHub will send a ping event; check **Recent Deliveries** for `200 OK`

> **Dev / localhost**: set `GITMESH_WEBHOOK_DEV_INSECURE=true` to skip HMAC verification.
> Use a tunnel (e.g. cloudflared, smee.io) and set `GITMESH_PUBLIC_BASE_URL` so GitMesh
> registers the correct callback URL with GitHub.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| GitHub Recent Deliveries shows **404** | Callback URL is wrong. Verify it ends with `/api/forge/webhook/github` (not `/api/projects/forge/...`). Re-register the webhook. |
| **401 Invalid webhook signature** | Secret mismatch. Rotate the secret in Project Settings and update GitHub webhook settings. |
| Webhook works but agent doesn't wake | Check that an agent with a matching trigger (e.g. `on:issue_opened`) exists for the project. |
| No webhook registered | Set `GITMESH_PUBLIC_BASE_URL` to a public URL; localhost callbacks are skipped automatically. |
