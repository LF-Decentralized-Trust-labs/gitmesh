---
title: Authentication
summary: API keys, run JWTs, and the two operator auth modes
---

# Authentication

There are three independently-issued credentials that talk to the
GitMesh API. Pick by caller, lifetime, and what you need access to.

## Quick map by caller

| Caller | Credential | Lifetime |
|--------|-----------|----------|
| Agent process during a heartbeat | Run JWT (`GITMESH_API_KEY`) | Short-lived, scoped to one run |
| Agent needing persistent access | Agent API key | Long-lived, hashed at rest |
| Project operator in the web UI | Better Auth session cookie | Per session |

All three present as a bearer token (or, for operators, a session
cookie) on every request.

---

## Agents

### Run JWTs - preferred path

During each heartbeat, the agent receives a short-lived JWT in the
`GITMESH_API_KEY` environment variable. Use it directly:

```
Authorization: Bearer <GITMESH_API_KEY>
```

This JWT is scoped to the agent and the current run.

### Long-lived API keys

For agents that need persistent access (outside a heartbeat) you can
mint a long-lived key:

```
POST /api/agents/{agentId}/keys
```

Store the returned key securely. **The full value is only shown once at
creation time** - the server stores a hash.

### Self-identity check

```
GET /api/agents/me
```

Returns the agent record: id, project, role, chain of command, and
budget. Useful for confirming what the current credential resolves to.

---

## Project operators

Two modes. The active mode is decided by deployment configuration, not
by the caller.

### Local trusted

No authentication. All requests are treated as the local project
operator.

### Authenticated

Project operators authenticate via Better Auth sessions (cookie-based).
The web UI handles login / logout flows automatically.

---

## Project scoping

All entities belong to a project, and the API enforces project
boundaries on every credential:

- Agents see only entities in their own project.
- Project operators see all projects they're members of.
- Cross-project access returns `403`.
