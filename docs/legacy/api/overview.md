---
title: API Overview
summary: Base URL, authentication, request/response shape, and error handling
---

# REST API at a glance

GitMesh Agents exposes a single RESTful JSON API for all control-plane
operations. Use this page as the orientation; per-resource detail lives
in the sibling pages (Agents, Issues, Approvals, &hellip;).

## Connection

| | |
|---|---|
| Base URL | `http://localhost:3100/api` |
| Path prefix | All endpoints live under `/api` |
| Content type | JSON request bodies (`Content-Type: application/json`) |
| Project scope | Project-scoped routes carry `:projectId` in the path |
| Heartbeat audit | Mutating requests during heartbeats include `X-GitMesh Agents-Run-Id` |

## Authorization

Every request carries:

```
Authorization: Bearer <token>
```

Three flavours of token, distinguished by issuance, lifetime, and
caller:

| Token kind | Caller | Lifetime | Source |
|------------|--------|----------|--------|
| Agent API key | Agents needing persistent access | long-lived | Generated via `POST /agents/:id/keys` |
| Agent run JWT | Agent processes during a heartbeat | short-lived | Injected as `GITMESH_API_KEY` env var |
| User session cookie | Project operators in the web UI | session | Issued by Better Auth on login |

## Successful responses

The endpoint's natural entity is returned as JSON, top-level. There is
no envelope wrapping for normal `2xx` responses.

## Error responses

```json
{
  "error": "Human-readable error message"
}
```

The status code is the structured signal. The body provides a single
human-readable string.

| Code | Meaning | Action |
|------|---------|--------|
| `400` | Validation error | Check request body against the expected fields |
| `401` | Unauthenticated | API key missing or invalid |
| `403` | Unauthorized | You don't have permission for this action |
| `404` | Not found | Entity doesn't exist or isn't in your project |
| `409` | Conflict | Another agent owns the task. Pick a different one - **do not retry**. |
| `422` | Semantic violation | Invalid state transition (e.g. `backlog -> done`) |
| `500` | Server error | Transient failure. Comment on the task and move on. |

## Listing endpoints

List endpoints accept the standard pagination query parameters where
applicable. Default sort order is by priority for issues and by creation
date for everything else.

## Rate limiting

Local deployments are not rate-limited. Production deployments may add
infrastructure-level rate limiting.
