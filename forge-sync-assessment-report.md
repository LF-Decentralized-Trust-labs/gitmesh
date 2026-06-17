# Forge Integration Service (forge-sync) — Assessment & Fix Approach

**Author:** Anurag Gupta  
**Mentor:** Parv Mittal  
**LFX Mentorship:** Policy-as-Code Engine for Open Source AI Agent Orchestration   
**Status:** Assessment + Proposed Implementation Plan  
**Date:** 17 Jun 2026

---

## Executive Summary

The Forge Integration Service (forge-sync) has a **partial, functional foundation** but contains a **critical P0 routing bug** that breaks real-time GitHub webhooks in production. Additionally, **inbound/outbound bidirectional sync is incomplete**, and **documentation is outdated**.

**Good news:** The core architecture—webhook signature verification, event mapping, agent wakeup, and outbound GitHub API integration—already exists. This is a **completion and hardening task**, not a ground-up rebuild.

**Recommendation:** Fix in **4 phases over 6 weeks**, starting with the routing bug (Phase 0), then completing inbound sync (Phase 1), outbound actions (Phase 2), and finally hardening + docs (Phases 3–4).

---

## 1. Existing Architecture

### Current State Map

```
GitHub
  ↓
[Webhook POST] ← MISMATCH: registered /api/forge/webhook/github
                            actual handler at /api/projects/forge/webhook/github
  ↓
express route: forge-webhooks.ts
  ↓
processEvent() → forge-sync.ts
  ↓
[upsert issue/PR locally]
  ↓
[wake agent] → skills execute
  ↓
[outbound: comment, label, close, etc.]
  ↓
GitHub (via Octokit)

Polling (fallback every 5 min)
  ↓
syncProjectIssues() → GitHub REST API
  ↓
[detects changes, updates local state]
```

### Tech Stack (Already in use)

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express 5 + TypeScript (ESM) |
| ORM | Drizzle ORM + PostgreSQL |
| GitHub API | Octokit (`@octokit/rest`) |
| Auth | HMAC-SHA256 (inbound), PAT/OAuth (outbound) |
| Queue | PostgreSQL task queue (heartbeat-driven) |
| Real-time | WebSocket via `ws` library |
| Testing | Vitest + Supertest |

### Relevant Codebase Locations

| File | Purpose |
|------|---------|
| `server/src/core/forge-sync.ts` | Core bidirectional sync logic, polling schedule, outbound actions |
| `server/src/api/forge-webhooks.ts` | Webhook route handlers, event mapping, HMAC verification |
| `lib/data/src/schema/forge_webhooks.ts` | Drizzle schema for forge_webhooks table |
| `server/src/app.ts` (lines 137, 161) | Express routing — **BUG HERE** |
| `docs/api/forge-webhooks.md` | Webhook documentation (outdated) |
| `docs/guides/connecting-to-github.md` | GitHub setup guide (empty stub) |

---

## 2. Current Capabilities (What Works)

### Inbound (GitHub → GitMesh)

✅ **Webhook HMAC-SHA256 verification**  
- `verifyGitHubSignature()` correctly validates `X-Hub-Signature-256` header
- Signature verification logic is sound; problem is routing (webhook never reaches handler)

✅ **Event mapping for core types**  
- `mapGitHubEvent()` handles `issues.opened`, `issues.closed`, `issues.labeled`, `issue_comment`
- Correctly identifies issue number and syncs to local `issues` table

✅ **Agent wakeup on webhook**  
- `processEvent()` → triggers heartbeat for Triage, Docs, or Security agents
- Inbound comment wakes the appropriate agent

✅ **GitHub project resolution**  
- Extracts `owner/repo` from webhook payload
- Resolves to local project via `projects` table

✅ **Polling fallback**  
- `syncProjectIssues()` runs every 5 minutes (during dev)
- Detects new/updated issues via GitHub REST API

### Outbound (GitMesh → GitHub)

✅ **Core action methods**  
- `postForgeComment(issue, body)` — comments via Octokit
- `updateForgeIssueState(issue, action)` — closes/reopens
- `addForgeLabel(issue, labels)` — adds labels
- `requestForgeReview(pr, reviewers)` — requests PR review

✅ **Policy checks**  
- Outbound actions blocked if policy says `require_approval`
- Action logged in activity (inbound only; outbound logging incomplete)

✅ **GitHub webhook management (UI + CLI)**  
- Register/deactivate webhooks from Project Settings
- CLI: `gitmesh-agents project connect`
- Rotate webhook secrets

### Management

✅ **Webhook secret storage**  
- Secrets stored in `forge_webhooks` table
- Can rotate via API

✅ **Delivery status tracking**  
- `deliveryStatus` column tracks "pending", "processed", "failed", etc.

---

## 3. Gap Analysis

### P0 — Critical: Webhook Routing Mismatch

**Severity:** 🔴 **BLOCKS PRODUCTION WEBHOOKS**

**The bug:**

```typescript
// forge-sync.ts:112 (registration)
const webhookCallbackUrl = `${baseUrl}/api/forge/webhook/${registration.forgeProvider}`;
// → GitHub is told to POST to: https://yourdomain.com/api/forge/webhook/github

// app.ts:137 (mounting)
api.use("/projects", forgeWebhookRoutes(db));
// → Express mounts routes under: /api/projects/...

// forge-webhooks.ts:254 (actual handler)
router.post("/forge/webhook/github", async (req, res) => { ... }
// → Combined path: /api/projects/forge/webhook/github (❌ MISMATCH)
```

**Result:** GitHub POSTs to `/api/forge/webhook/github` → Express returns **404** → webhook never processed.

**Comparison (correct routing):**

```typescript
// Tekton webhook routes (CORRECT)
app.use(tektonWebhookRoutes(db));  // Mounted at root /api
router.post("/forge/webhook/tekton", ...)  // → /api/forge/webhook/tekton ✓

// Forge webhook routes (BROKEN)
api.use("/projects", forgeWebhookRoutes(db));  // Mounted under /api/projects
router.post("/forge/webhook/github", ...)  // → /api/projects/forge/webhook/github ❌
```

**Secondary effect:**  
Raw body capture in `app.ts` only runs for `/api/forge/webhook/*` routes. Even if GitHub hit the wrong path, HMAC verification would fail because `req.rawBody` would be missing.

**Impact:** Real-time webhooks don't work in production. Users fall back to polling (5-minute latency).

---

### P1 — High: Incomplete Inbound → Outbound Bidirectional Sync

| Gap | Detail | Impact |
|-----|--------|--------|
| **PR comments not persisted** | `issue_comment` events wake agents but don't insert rows into `issue_comments` table | PR discussion history is incomplete locally |
| **PR lookup bug** | `issue_comment` event uses `forgeIssueNumber` to find the local issue, but PRs are stored with `forgePrNumber` | Comments on PRs can miss the local database row |
| **PR polling skipped** | `syncProjectIssues()` explicitly skips PRs with `if (item.pull_request) continue` | PRs only arrive via webhooks; no polling fallback for PRs |
| **Missing event mappings** | `pull_request_review`, `pull_request_review_comment`, `pull_request.synchronize` not handled in `mapGitHubEvent()` | PR review events don't wake agents |
| **Merge is local-only** | `PATCH /pull-requests/:id` with `action: "merge"` updates DB but never calls GitHub merge API | Agent can't actually merge PRs on GitHub |
| **Approval queue is a stub** | `require_approval` is logged but never surfaces in UI; actions are not queued for maintainer approval | Policy blocks are invisible to operators |
| **No outbound activity log** | Inbound webhooks log activity; posting comments/closing issues don't | Audit trail is incomplete |
| **Test webhook delivery is fake** | `POST /webhooks/:id/test` just sets `deliveryStatus: "test_sent"` without actually sending | Operators can't test if webhook registration works |
| **Deactivate is incomplete** | Deactivating webhook updates DB but doesn't call GitHub's `DELETE /repos/{owner}/{repo}/hooks/{hook_id}` | Webhooks persist on GitHub even after deactivation |

---

### P2 — Medium: Documentation & UX Drift

| Issue | Detail |
|-------|--------|
| **Wrong API paths in docs** | `docs/api/forge-webhooks.md` documents `POST /api/projects/{projectId}/webhooks/github` — this route doesn't exist | Operators follow wrong steps, get confused |
| **Empty setup guide** | `docs/guides/connecting-to-github.md` is a placeholder ("Coming Soon") | New users have no onboarding |
| **OAuth → webhook flow unclear** | `POST /api/github/connect-project` starts polling but doesn't auto-register webhooks | Operators must manually click "Register Webhook" in Settings (CLI does register unless loopback) |
| **No webhook status visibility** | No UI showing "Webhooks: registered vs. polling" | Operators don't know if real-time is working |
| **No automated tests** | Zero tests for forge-sync routes or webhook handlers | Regressions are silent |

---

## 4. Root Causes

### Why the routing bug exists

The `forgeWebhookRoutes` router was mounted under `/projects` to keep webhook management routes (`GET /projects/{id}/webhooks`, `POST /projects/{id}/webhooks/register`) grouped with project resources. However, **inbound webhook handlers should not be under a resource path** — they are stateless entry points that GitHub calls, not project-scoped management APIs.

Solution: **Split the router** into:
1. **Management routes** (project-scoped) — stay under `/api/projects/:id/webhooks/...`
2. **Inbound handlers** (stateless) — mount at `/api/forge/webhook/{provider}`

### Why sync is incomplete

The codebase was built to handle **issues** first (simpler, uni-directional for triage). PRs are more complex (bidirectional reviews, merges, require approval). The incomplete PR support reflects a pragmatic "get issues working first" approach, but it's left half-done.

### Why docs are stale

The API routes changed but docs weren't updated. GitHub setup guide was never written. Webhook status isn't exposed in the UI, so operators can't troubleshoot.

---

## 5. Proposed Architecture (Target State)

### Inbound Flow (GitHub → GitMesh)

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub (any event: issue, PR, comment, review, push)        │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ POST /api/forge/webhook/github
                      ↓
        ┌─────────────────────────────────────┐
        │ Signature Verification              │
        │ (HMAC-SHA256 X-Hub-Signature-256)   │
        └─────────────┬───────────────────────┘
                      │ ✓ valid
                      ↓
        ┌─────────────────────────────────────┐
        │ mapGitHubEvent()                    │
        │ (issues, PRs, comments, reviews)    │
        └─────────────┬───────────────────────┘
                      │
                      ↓
        ┌─────────────────────────────────────┐
        │ syncForgeIssue() / syncForgePR()    │
        │ (upsert local row)                  │
        │ (idempotent: X-GitHub-Delivery)     │
        └─────────────┬───────────────────────┘
                      │
                      ↓
        ┌─────────────────────────────────────┐
        │ Agent Wakeup (heartbeat)            │
        │ - Triage (issues, labels)           │
        │ - PR Review (pull_request)          │
        │ - Security (security_advisory)      │
        └─────────────┬───────────────────────┘
                      │
                      ↓
        ┌─────────────────────────────────────┐
        │ Skills Execute (read-heavy)         │
        │ (analyze, triage, comment)          │
        └─────────────┬───────────────────────┘
                      │
                      ↓
        ┌─────────────────────────────────────┐
        │ Policy Check (OPA middleware)       │
        │ - Allow / Require Approval / Block  │
        └─────────────────────────────────────┘
```

### Outbound Flow (GitMesh → GitHub)

```
┌──────────────────────────────────────────────┐
│ Agent Skill Wants to Act                     │
│ (postComment, closeIssue, mergePR)           │
└──────────────┬───────────────────────────────┘
               │
               ↓
┌──────────────────────────────────────────────┐
│ Policy Check (require_approval?)             │
└──────────┬───────────────────────┬───────────┘
           │ allow                  │ require_approval
           ↓                        ↓
   ┌───────────────┐       ┌──────────────────┐
   │ Execute Now   │       │ Queue for        │
   │ (GitHub API)  │       │ Maintainer       │
   │ via Octokit   │       │ Approval (UI)    │
   └───────┬───────┘       └──────────────────┘
           │
           ↓
┌──────────────────────────────────────────────┐
│ Activity Log Entry                           │
│ - agentId, action, targetId                  │
│ - policyVersion, policyOutcome               │
│ - timestamp, result (success/failure)        │
└──────────┬───────────────────────────────────┘
           │
           ↓
┌──────────────────────────────────────────────┐
│ Return to Agent Heartbeat                    │
└──────────────────────────────────────────────┘
```

---

## 6. Implementation Phases

### Phase 0: Unblock Webhooks (1 week, highest priority)

**Goal:** Fix routing so real-time GitHub webhooks work in production.

**Tasks:**

1. **Split forge-webhooks router** (1 day)
   - Create `forgeWebhookManagementRoutes()` for `GET /projects/:id/webhooks`, `POST /projects/:id/webhooks/register`, etc.
   - Create `forgeWebhookInboundRoutes()` for `POST /forge/webhook/github`, `POST /forge/webhook/gitlab`, etc.
   - Keep management routes under `/api/projects/:id/...`
   - Mount inbound routes at `/api` (like Tekton)

   **Code change in `app.ts`:**
   ```typescript
   // BEFORE (broken)
   api.use("/projects", forgeWebhookRoutes(db));

   // AFTER (fixed)
   api.use("/projects", forgeWebhookManagementRoutes(db));  // /api/projects/{id}/webhooks/*
   api.use(forgeWebhookInboundRoutes(db));                  // /api/forge/webhook/*
   ```

2. **Verify rawBody capture** (1 day)
   - Confirm `req.rawBody` is set before inbound handler runs (for HMAC verification)
   - Current code in `app.ts` should work if routing is fixed:
   ```typescript
   app.use("/api/forge/webhook/*", express.raw({ type: "*/*" }));
   ```

3. **Update webhook registration** (1 day)
   - Change `forge-sync.ts:112` to register at `/api/forge/webhook/github` (not `/api/projects/forge/...`)
   - Verify GitHub webhook settings show correct callback URL

4. **Local dev testing** (2 days)
   - Test with `curl`:
     ```bash
     WEBHOOK_SECRET="test-secret"
     BODY='{"action":"opened"}'
     SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* /sha256=/')
     curl -X POST http://localhost:8080/api/forge/webhook/github \
       -H "X-Hub-Signature-256: $SIGNATURE" \
       -d "$BODY"
     # Should return 200, not 404
     ```
   - Test with `GITMESH_WEBHOOK_DEV_INSECURE=true` (skip HMAC in dev)
   - Verify `deliveryStatus` becomes "processed" in DB

5. **Update docs**
   - Fix `docs/api/forge-webhooks.md` to document correct callback URL
   - Add troubleshooting: "If webhook returns 404, verify callback URL in GitHub settings"

**Definition of Done:**
- GitHub "Recent Deliveries" shows `200 OK` for `/api/forge/webhook/github`
- `forge_webhooks.deliveryStatus` transitions from "pending" to "processed"
- Polling fallback still works (backward compatible)

**Estimated effort:** 1 week (3 eng days + review)

---

### Phase 1: Complete Inbound GitHub → GitMesh (2 weeks)

**Goal:** Handle all GitHub event types; persist all inbound data locally.

**Tasks:**

1. **Expand event mapping** (3 days)
   - Add handlers for `pull_request.opened`, `pull_request.synchronize`, `pull_request.ready_for_review`
   - Add `pull_request_review` → `pr_review_submitted` event
   - Add `pull_request_review_comment` → `pr_comment` event
   - Add `issue_comment` on PRs (detect `issue.pull_request` in payload)

   **Code location:** `forge-webhooks.ts:mapGitHubEvent()`

2. **Fix entity lookup** (2 days)
   - Current: `issue_comment` uses `forgeIssueNumber` to find local issue
   - Problem: PRs are stored with `forgePrNumber`
   - Fix: Given a `forgeNumber` from payload, search both columns:
     ```typescript
     let localEntity = await db.select()
       .from(issues)
       .where(
         or(
           eq(issues.forgeIssueNumber, forgeNumber),
           eq(issues.forgePrNumber, forgeNumber)
         )
       );
     ```

3. **Persist inbound comments** (2 days)
   - Create/update `issue_comments` table with new fields:
     ```typescript
     forgeCommentId: text('forge_comment_id').unique(),  // GitHub comment ID
     syncDirection: text('sync_direction'),  // 'inbound' | 'outbound'
     ```
   - On inbound `issue_comment` event, insert/upsert row instead of just waking agent

4. **Add PR polling** (2 days)
   - Create `syncProjectPullRequests()` mirroring `syncProjectIssues()`
   - Call from the same 5-minute heartbeat
   - Include PR review comments, reviewers, merge status

5. **Deduplicate agent wakeups** (1 day)
   - Track which issue was last processed in `forge_webhooks.lastEventProcessedAt`
   - If same issue comment is posted again within 1 second, skip wakeup (idempotency)

**Definition of Done:**
- Open GitHub issue → local issue appears (existing)
- Add comment to GitHub issue → local `issue_comments` row created
- Open GitHub PR → local PR appears
- Request PR review on GitHub → local agent wakes once
- GitHub PR review submitted → event logged, agent can access review

**Estimated effort:** 2 weeks (8 eng days + review)

---

### Phase 2: Complete Outbound GitMesh → GitHub (2 weeks)

**Goal:** Wire up approval gates and make all agent actions actually work on GitHub.

**Tasks:**

1. **Wire approval queue** (3 days)
   - When `policyOutcome: "require_approval"`, insert row into `pending_approvals` table
   - Expose in dashboard UI: "Pending Approvals" view (3-view dashboard from main timeline)
   - Operator can view action context and click "Approve" → action executes

   **Code location:** `forge-sync.ts:executeOutboundAction()` + new `POST /api/approvals/:id/approve` route

2. **Activity log for outbound actions** (2 days)
   - Add `fork_comment_posted`, `fork_issue_closed`, `fork_pr_merged`, etc. to activity log
   - Include result (success/error) and GitHub response code
   - Link to audit log from dashboard

3. **Real GitHub merge** (2 days)
   - Implement `mergeGitHubPullRequest()` in `github-client.ts`:
     ```typescript
     async mergeGitHubPullRequest(repo: string, prNumber: number, strategy: 'merge' | 'squash' | 'rebase') {
       const [owner, repo] = repo.split('/');
       return this.octokit.pulls.merge({
         owner, repo, pull_number: prNumber, merge_method: strategy
       });
     }
     ```
   - Call from `pull-requests.ts` when agent or operator approves merge

4. **PR review comments (optional, lower priority)** (1 day)
   - Use Octokit's `pulls.createReviewComment()` for inline PR code comments
   - Use `pulls.createReview()` for full PR reviews with approve/request-changes

5. **Delete webhook on deactivate** (1 day)
   - When operator clicks "Deactivate", call GitHub API:
     ```typescript
     async deleteGitHubWebhook(repo: string, hookId: number) {
       const [owner, repo] = repo.split('/');
       return this.octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
     }
     ```

6. **Real test delivery** (1 day)
   - Replace stub with real webhook test:
     ```typescript
     POST /api/projects/:id/webhooks/github/test
     → Call GitHub's test delivery API or re-deliver last event
     → Poll for result
     ```

**Definition of Done:**
- Agent skill executes → creates GitHub comment (visible on GitHub immediately)
- Operator approves pending action → agent's blocked action executes
- Agent merges PR → PR actually merges on GitHub
- Operator deactivates webhook → webhook disappears from GitHub settings
- Test webhook → real payload delivered and logged

**Estimated effort:** 2 weeks (8 eng days + review)

---

### Phase 3: Hardening (1.5 weeks)

**Goal:** Make forge-sync production-grade: idempotent, tested, resilient.

**Tasks:**

1. **Vitest test suite** (4 days)
   - Unit tests: `verifyGitHubSignature()`, `mapGitHubEvent()`, `syncForgeIssue()` lookup
   - Integration tests: mock GitHub webhooks, verify routing, trace event → agent wakeup
   - Snapshot tests: GitHub payload examples (issues, PRs, reviews, comments)
   - Coverage target: >85% for forge-sync, >75% for routes

2. **Idempotency via GitHub delivery ID** (2 days)
   - GitHub sends `X-GitHub-Delivery: <UUID>` header on every webhook
   - Store in `forge_webhooks.githubDeliveryId` (unique constraint)
   - On duplicate delivery, return 200 without re-processing

3. **Handle multi-project same repo** (1 day)
   - Document: "One project per GitHub repo (constraint)"
   - Or: Enforce at DB level with unique constraint on `(forgeProvider, repoFullName)`

4. **Auto-register on connect** (1 day)
   - When `POST /api/github/connect-project`, check `GITMESH_PUBLIC_BASE_URL`
   - If set, auto-call GitHub webhook register endpoint
   - If not set, show "Webhooks require public URL" (polling only for now)
   - CLI `gitmesh-agents project connect` should also auto-register if not loopback

5. **Error handling & logging** (1 day)
   - GitHub API timeouts → log warning, don't crash agent heartbeat
   - Redis queue backpressure → notify operator in dashboard
   - Logging: structured JSON logs with traceId (link inbound → outbound)

**Definition of Done:**
- Vitest coverage >85% for forge-sync
- Duplicate GitHub deliveries handled gracefully
- Webhook auto-registers on project connect (if `GITMESH_PUBLIC_BASE_URL` set)
- All edge cases logged and traceable

**Estimated effort:** 1.5 weeks (6 eng days + review)

---

### Phase 4: Docs & Operator Experience (1 week)

**Goal:** Leave comprehensive docs and clear operator experience.

**Tasks:**

1. **Complete `docs/guides/connecting-to-github.md`** (2 days)
   - Step-by-step: Create GitHub App or use PAT
   - Set `GITMESH_PUBLIC_BASE_URL` (or use ngrok/cloudflare tunnel for dev)
   - Register webhook via UI or CLI
   - Troubleshoot: "Webhook returns 404? Check callback URL in GitHub settings"
   - Show webhook status: "✓ Registered" vs "⚠ Polling fallback"

2. **Fix `docs/api/forge-webhooks.md`** (1 day)
   - Document correct endpoint paths:
     - Inbound: `POST /api/forge/webhook/github`
     - Management: `POST /api/projects/:id/webhooks/register`
   - Add curl examples with HMAC signatures

3. **Add webhook status to UI** (1 day)
   - Project Settings → "Forge Integration" card
   - Show: "Webhooks: ✓ Registered" or "⚠ Polling (set GITMESH_PUBLIC_BASE_URL for real-time)"
   - Last delivery: "5 minutes ago" or "error" with error message

4. **CLI improvements** (1 day)
   - `gitmesh-agents project connect --help` → show webhook status after registration
   - Example: `gitmesh-agents project status` → "GitHub: webhook registered, last delivery 2m ago"

5. **Operator runbook** (1 day)
   - "Why is my agent not responding to GitHub events?" → decision tree
   - "How do I test if webhooks are working?" → test delivery + logs
   - "What if I'm behind a firewall?" → polling mode explanation

**Definition of Done:**
- New operator can connect GitHub repo in <5 minutes
- All API endpoints documented with examples
- Operator can see webhook status in UI
- Troubleshooting guide covers common issues

**Estimated effort:** 1 week (4 eng days + review)

---

## 7. Risk Areas

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| **Webhook routing change breaks existing deployments** | High | 🔴 Production downtime | Test against real GitHub; gradually roll out; update webhook URLs in GitHub settings after deploy |
| **Race condition: same issue processed twice simultaneously** | Medium | 🟡 Duplicate comments, missed updates | Use idempotency token (`X-GitHub-Delivery`), database unique constraints, test with concurrent webhook events |
| **GitHub API rate limits during sync** | Medium | 🟡 Polling blocked, outbound actions queue | Implement exponential backoff, respect `X-RateLimit-Reset`, batch operations, fallback to polling interval |
| **Policy evaluation blocks legitimate agent action** | Medium | 🟡 Agents unable to help | Audit log captures all blocks with reason; maintainer can view and override in UI; conservative default ("block by default") during testing |
| **Incomplete PR data loss on polling → webhook transition** | Low | 🟠 Missing PR review history | Migrate before Phase 1; re-sync all PRs on startup if schema changes |

---

## 8. Testing Strategy

### Unit Tests

- **Signature verification:** Valid/invalid/missing HMAC signatures
- **Event mapping:** All GitHub event types → correct local action
- **Entity lookup:** Resolve issue/PR from payload correctly
- **Policy evaluation:** Allow/block/approval-required decision

### Integration Tests

- **Webhook flow:** Real Express server + mock GitHub payload + verify DB updates
- **Polling sync:** Verify issues/PRs created, deduplicated on second poll
- **Outbound:** Agent calls GitHub API → verify Octokit calls are correct

### Manual Testing (Local Dev)

```bash
# Terminal 1: Start GitMesh
./cli clean-dev

# Terminal 2: Send fake webhook
WEBHOOK_SECRET="your-dev-secret"
BODY='{"action":"opened","issue":{"number":42,"title":"Test"}}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* /sha256=/')
curl -X POST http://localhost:8080/api/forge/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: $(uuidgen)" \
  -d "$BODY"

# Terminal 3: Check DB
psql -U user gitmesh
SELECT * FROM forge_webhooks ORDER BY received_at DESC LIMIT 1;
SELECT * FROM issues WHERE forge_issue_number = 42;
```

### Production Readiness Checklist

- [ ] Phase 0: Webhook routing fixed, manual test passes
- [ ] Phase 1: All GitHub event types mapped, integration tests >85%
- [ ] Phase 2: Outbound actions tested, approval queue functional
- [ ] Phase 3: Vitest suite complete, idempotency proven
- [ ] Phase 4: Docs complete, operator can set up in <5 minutes
- [ ] Load test: 100+ concurrent webhooks without dropping
- [ ] Error handling: All failure paths logged and actionable
- [ ] Deployment: Webhook URL routing tested in staging before production

---

## 9. Expected Deliverables

### By End of Phase 0 (Week 1)

- PR: Fix routing (`forgeWebhookInboundRoutes` at `/api`)
- PR: Update webhook registration callback URL
- Updated docs: `forge-webhooks.md` with correct paths
- Manual test: curl → 200, event processed in DB

### By End of Phase 1 (Week 3)

- PR: Event mapping expansion (all GitHub types)
- PR: Fix entity lookup (issue/PR duality)
- PR: Inbound comment persistence
- PR: PR polling (`syncProjectPullRequests()`)
- Vitest: Integration test suite for inbound flow
- Manual test: Create GitHub issue/PR/comment → appears locally

### By End of Phase 2 (Week 5)

- PR: Approval queue + UI integration
- PR: Activity log for outbound actions
- PR: GitHub merge API integration
- PR: Webhook deletion on deactivate
- Vitest: Integration tests for full flow (inbound → agent → outbound)
- Manual test: Agent action blocked by policy → appears in Approvals UI → operator approves → GitHub action executed

### By End of Phase 3 (Week 6.5)

- PR: Vitest suite with >85% coverage
- PR: Idempotency via `X-GitHub-Delivery`
- PR: Auto-register webhook on project connect
- PR: Error handling & structured logging

### By End of Phase 4 (Week 7.5)

- Docs: Complete `docs/guides/connecting-to-github.md`
- Docs: Updated `docs/api/forge-webhooks.md`
- Feature: Webhook status indicator in Project Settings UI
- Runbook: Operator troubleshooting guide
- Demo: 5-minute video (issue → webhook → agent → approval → GitHub action)

---

## 11. Recommended Start Point

**If you have <2 weeks before review:** Start with **Phase 0 only**. Fix the routing bug, prove webhooks work with curl, merge it. This is high-impact, low-risk, and unblocks everything else.

**If you have 6 weeks:** Follow the full 4-phase plan (Phase 0 → 1 → 2 → 3 → 4), shipping to production after Phase 3.

**Optimal pace:**  
- **Weeks 1:** Phase 0 (routing fix)
- **Weeks 2–3:** Phase 1 (inbound sync)
- **Weeks 4–5:** Phase 2 (outbound + approval)
- **Weeks 6–6.5:** Phase 3 (hardening)
- **Week 7.5:** Phase 4 (docs) + final demo

This aligns with your LFX mentorship timeline and ships a production-ready forge-sync by end of September.

---

## Appendix A: Code Pointers for Phase 0

### File: `app.ts` (Express router mounting)

**Current (broken):**
```typescript
// Line 137
api.use("/projects", forgeWebhookRoutes(db));

// This means: /api/projects/forge/webhook/github (wrong!)
// GitHub expects: /api/forge/webhook/github
```

**Fixed:**
```typescript
// Split into two routers
api.use("/projects", forgeWebhookManagementRoutes(db));  // /api/projects/:id/webhooks/register, etc.
api.use(forgeWebhookInboundRoutes(db));                  // /api/forge/webhook/github
```

### File: `server/src/api/forge-webhooks.ts` (refactor)

**New structure:**
```typescript
// Management routes (project-scoped)
export function forgeWebhookManagementRoutes(db: Database) {
  const router = express.Router({ mergeParams: true });
  
  // GET /api/projects/:projectId/webhooks
  router.get("/:projectId/webhooks", async (req, res) => { ... });
  
  // POST /api/projects/:projectId/webhooks/register
  router.post("/:projectId/webhooks/register", async (req, res) => { ... });
  
  // DELETE /api/projects/:projectId/webhooks/:webhookId
  router.delete("/:projectId/webhooks/:webhookId", async (req, res) => { ... });
  
  return router;
}

// Inbound routes (stateless)
export function forgeWebhookInboundRoutes(db: Database) {
  const router = express.Router();
  
  // POST /api/forge/webhook/github
  router.post("/forge/webhook/github", async (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string;
    const body = req.rawBody; // Must be set by middleware in app.ts
    
    if (!verifyGitHubSignature(signature, body, secret)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    
    const event = JSON.parse(body.toString());
    await processEvent("github", event);
    res.status(200).json({ processed: true });
  });
  
  return router;
}
```

### File: `server/src/app.ts` (middleware order)

**Ensure rawBody capture comes before routing:**
```typescript
// CRITICAL: Capture raw body BEFORE routing
app.use("/api/forge/webhook/*", express.raw({ type: "*/*" }));

// Then mount routers
const api = express.Router();
api.use("/projects", forgeWebhookManagementRoutes(db));
api.use(forgeWebhookInboundRoutes(db));

app.use("/api", api);
```

---

## Appendix B: Example GitHub Webhook Payloads for Testing

### Issues Opened

```json
{
  "action": "opened",
  "issue": {
    "number": 42,
    "title": "Bug: auth broken",
    "body": "Login fails with 500",
    "html_url": "https://github.com/owner/repo/issues/42"
  },
  "repository": {
    "full_name": "owner/repo",
    "name": "repo",
    "owner": { "login": "owner" }
  }
}
```

### Pull Request Opened

```json
{
  "action": "opened",
  "pull_request": {
    "number": 99,
    "title": "Fix auth flow",
    "body": "Closes #42",
    "head": { "ref": "fix/auth", "sha": "abc123" },
    "html_url": "https://github.com/owner/repo/pull/99"
  },
  "repository": {
    "full_name": "owner/repo"
  }
}
```

### Pull Request Review Requested

```json
{
  "action": "review_requested",
  "pull_request": {
    "number": 99,
    "requested_reviewer": {
      "login": "reviewer"
    }
  },
  "repository": {
    "full_name": "owner/repo"
  }
}
```

### Issue Comment

```json
{
  "action": "created",
  "issue": {
    "number": 42,
    "pull_request": null  // null = issue, not PR
  },
  "comment": {
    "id": 1234567,
    "body": "This looks good to me",
    "user": { "login": "reviewer" },
    "created_at": "2026-01-15T10:00:00Z",
    "html_url": "https://github.com/owner/repo/issues/42#issuecomment-1234567"
  },
  "repository": {
    "full_name": "owner/repo"
  }
}
```

---

## Conclusion

The Forge Integration Service is **70% built**. The remaining work is **finishing and hardening**, not redesigning. The critical path is **Phase 0 (routing fix) → Phase 1 (inbound sync) → Phase 2 (outbound/approval)**, then stabilize with Phase 3 & 4.

**Start with Phase 0 this week.** It's a 1-week fix with high ROI. Once merged, the rest flows naturally.

Good luck! 🚀
