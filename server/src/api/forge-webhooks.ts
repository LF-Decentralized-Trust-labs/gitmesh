/**
 * Forge Webhook Routes
 *
 * Handles incoming webhook events from forge providers (GitHub, GitLab, Forgejo)
 * and management of webhook registrations.
 */

import { Router, type Request } from "express";
import crypto from "node:crypto";
import type { Db } from "@gitmesh/data";
import { and, eq, forgeWebhooks, projects } from "@gitmesh/data";
import type { ForgeProvider } from "@gitmesh/core";
import { forgeSyncService, startPeriodicSync, type ForgeEvent, type ForgeEventType } from "../core/index.js";
import { assertBoard, assertProjectAccess, getActorInfo } from "./authz.js";
import { logActivity, secretService } from "../core/index.js";

export function forgeWebhookRoutes(db: Db) {
  const router = Router();
  const forgeSync = forgeSyncService(db);

  // ── Webhook Management ───────────────────────────────────────────────

  /**
   * GET /api/projects/:projectId/forge/webhooks
   * List registered webhooks for a project.
   */
  router.get("/:projectId/forge/webhooks", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const webhooks = await forgeSync.listWebhooks(projectId);
    res.json(webhooks);
  });

  /**
   * POST /api/projects/:projectId/forge/webhooks
   * Register a new forge webhook for a project.
   */
  router.post("/:projectId/forge/webhooks", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const { forgeProvider, forgeOwner, forgeRepo, events } = req.body;

    const result = await forgeSync.registerWebhook({
      projectId,
      forgeProvider,
      forgeOwner,
      forgeRepo,
      events: events ?? ["issue_opened", "issue_comment", "pr_opened", "pr_comment"],
    });

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "forge.webhook_registered",
      entityType: "forge_webhook",
      entityId: result.id,
      details: { forgeProvider, forgeOwner, forgeRepo },
    });

    res.status(201).json(result);
  });

  /**
   * DELETE /api/projects/:projectId/forge/webhooks/:webhookId
   * Deactivate a forge webhook.
   */
  router.delete("/:projectId/forge/webhooks/:webhookId", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    await forgeSync.deactivateWebhook(req.params.webhookId);

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "forge.webhook_deactivated",
      entityType: "forge_webhook",
      entityId: req.params.webhookId,
    });

    res.json({ ok: true });
  });

  /**
   * POST /api/projects/:projectId/forge/webhooks/:webhookId/rotate
   * Rotate the webhook secret for a registered forge webhook.
   */
  router.post("/:projectId/forge/webhooks/:webhookId/rotate", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    const webhookId = req.params.webhookId as string;
    assertProjectAccess(req, projectId);

    const actor = getActorInfo(req);

    const result = await forgeSync.rotateWebhookSecret(
      webhookId,
      projectId,
      actor.actorType,
      actor.actorId ?? "operator",
    );

    // Fetch the full updated webhook row to return
    const rows = await db
      .select()
      .from(forgeWebhooks)
      .where(and(eq(forgeWebhooks.id, webhookId), eq(forgeWebhooks.projectId, projectId)));

    res.json(rows[0] ?? result);
  });

  // ── GitHub Connection ─────────────────────────────────────────────────

  /**
   * PATCH /api/projects/:projectId/forge
   * Connect or update GitHub connection for a project.
   * Parses repo URL, updates project fields, and stores PAT as an encrypted secret.
   */
  router.patch("/:projectId/forge", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const { repoUrl, token } = req.body as { repoUrl?: string; token?: string };

    if (!repoUrl || typeof repoUrl !== "string") {
      res.status(400).json({ error: "repoUrl is required" });
      return;
    }
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token is required" });
      return;
    }

    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      res.status(400).json({ error: "Invalid GitHub repository URL" });
      return;
    }

    const { owner, repo } = parsed;
    const secrets = secretService(db);

    // Upsert the GitHub PAT as a secret
    const existingSecret = await secrets.getByName(projectId, "github_token");
    const actor = getActorInfo(req);
    let secretId: string;

    if (existingSecret) {
      await secrets.rotate(
        existingSecret.id,
        { value: token },
        { userId: actor.actorId ?? "operator", agentId: actor.agentId ?? null },
      );
      secretId = existingSecret.id;
    } else {
      const created = await secrets.create(
        projectId,
        {
          name: "github_token",
          provider: "local_encrypted",
          value: token,
          description: "GitHub Personal Access Token",
        },
        { userId: actor.actorId ?? "operator", agentId: actor.agentId ?? null },
      );
      secretId = created.id;
    }

    // Update project forge fields
    const updated = await db
      .update(projects)
      .set({
        repoUrl,
        forgeProvider: "github",
        forgeOwner: owner,
        forgeRepo: repo,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!updated) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "forge.connected",
      entityType: "project",
      entityId: projectId,
      details: { forgeProvider: "github", forgeOwner: owner, forgeRepo: repo },
    });

    // Start periodic pull-based sync when forge is connected
    await startPeriodicSync(db, projectId);

    res.json({ forgeOwner: owner, forgeRepo: repo, secretId });
  });

  /**
   * POST /api/projects/:projectId/forge/webhooks/:webhookId/test
   * Trigger a test event for a registered webhook by simulating delivery.
   */
  router.post("/:projectId/forge/webhooks/:webhookId/test", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const webhookId = req.params.webhookId as string;

    const webhookRows = await db
      .select()
      .from(forgeWebhooks)
      .where(and(eq(forgeWebhooks.id, webhookId), eq(forgeWebhooks.projectId, projectId)));

    if (webhookRows.length === 0) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }

    await db
      .update(forgeWebhooks)
      .set({
        deliveryStatus: "test_sent",
        lastDeliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(forgeWebhooks.id, webhookId));

    res.json({ ok: true });
  });

  // ── Incoming Webhook Endpoints ───────────────────────────────────────

  /**
   * POST /api/forge/webhook/github
   * Handle incoming GitHub webhook payloads.
   * This endpoint is unauthenticated (validated by webhook secret via HMAC-SHA256).
   */
  router.post("/forge/webhook/github", async (req, res) => {
    try {
      const githubEvent = req.headers["x-github-event"] as string;
      const payloadWithProject = await withResolvedProjectId(db, "github", req.body as Record<string, unknown>);
      const event = mapGitHubEvent(githubEvent, payloadWithProject);

      if (!event) {
        res.status(200).json({ ignored: true, reason: "Unhandled event type" });
        return;
      }

      // Verify HMAC signature against the raw bytes captured by app.ts.
      // Skipping verification only when GITMESH_WEBHOOK_DEV_INSECURE=true is
      // explicitly set, so a developer can simulate webhooks via curl in dev.
      const insecureDev = process.env.GITMESH_WEBHOOK_DEV_INSECURE === "true";
      if (!insecureDev) {
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        const signatureHeader = req.headers["x-hub-signature-256"];
        const signatureValue = Array.isArray(signatureHeader)
          ? signatureHeader[0]
          : signatureHeader;
        if (!rawBody) {
          res.status(400).json({ error: "Webhook raw body unavailable" });
          return;
        }
        const valid = await validateGitHubSignature(
          db,
          event.projectId,
          rawBody,
          signatureValue,
        );
        if (!valid) {
          res.status(401).json({ error: "Invalid webhook signature" });
          return;
        }
      }

      await storeWebhookDelivery(db, event.projectId, "github", req.body as Record<string, unknown>, "received");
      const result = await forgeSync.processEvent(event);
      await storeWebhookDelivery(db, event.projectId, "github", req.body as Record<string, unknown>, "processed");

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("Forge webhook processing error:", error);
      try {
        const payloadWithProject = await withResolvedProjectId(db, "github", req.body as Record<string, unknown>);
        const projectId = typeof payloadWithProject.__gitmesh_project_id === "string"
          ? payloadWithProject.__gitmesh_project_id
          : null;
        if (projectId) {
          await storeWebhookDelivery(db, projectId, "github", req.body as Record<string, unknown>, "failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } catch {
        // best-effort failure logging
      }
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  /**
   * POST /api/forge/webhook/gitlab
   * Handle incoming GitLab webhook payloads.
   */
  async function validateGitLabToken(
    db: Db,
    projectId: string,
    tokenHeader: string | undefined,
  ): Promise<boolean> {
    if (!tokenHeader) return false;

    const rows = await db
      .select({
        webhookSecret: forgeWebhooks.webhookSecret,
      })
      .from(forgeWebhooks)
      .where(
        and(
          eq(forgeWebhooks.projectId, projectId),
          eq(forgeWebhooks.active, true),
        ),
      );

    if (rows.length === 0) return false;

    for (const row of rows) {
      if (!row.webhookSecret) continue;

      const expected = Buffer.from(row.webhookSecret);
      const actual = Buffer.from(tokenHeader);

      if (
        expected.length === actual.length &&
        crypto.timingSafeEqual(expected, actual)
      ) {
        return true;
      }
    }

    return false;
  }
  router.post("/forge/webhook/gitlab", async (req, res) => {
    try {
      const gitlabEvent = req.headers["x-gitlab-event"] as string;
      const payloadWithProject = await withResolvedProjectId(db, "gitlab", req.body as Record<string, unknown>);
      const event = mapGitLabEvent(gitlabEvent, payloadWithProject);

      if (!event) {
        res.status(200).json({ ignored: true, reason: "Unhandled event type" });
        return;
      }
      const tokenHeader = req.headers["x-gitlab-token"] as string | undefined;
      const valid = await validateGitLabToken(db, event.projectId, tokenHeader);
      if (!valid) {
        res.status(401).json({ error: "Invalid webhook token" });
        return;
      }
      await storeWebhookDelivery(db, event.projectId, "gitlab", req.body as Record<string, unknown>, "received");
      const result = await forgeSync.processEvent(event);
      await storeWebhookDelivery(db, event.projectId, "gitlab", req.body as Record<string, unknown>, "processed");
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("Forge webhook processing error:", error);
      try {
        const payloadWithProject = await withResolvedProjectId(db, "gitlab", req.body as Record<string, unknown>);
        const projectId = typeof payloadWithProject.__gitmesh_project_id === "string"
          ? payloadWithProject.__gitmesh_project_id
          : null;
        if (projectId) {
          await storeWebhookDelivery(db, projectId, "gitlab", req.body as Record<string, unknown>, "failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } catch {
        // best-effort failure logging
      }
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  /**
   * POST /api/forge/webhook/forgejo
   * Handle incoming Forgejo webhook payloads.
   * Forgejo uses Gitea-compatible webhook format.
   */
  async function validateForgejoSignature(
    db: Db,
    projectId: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<boolean> {
    if (!signatureHeader) return false;

    const rows = await db
      .select({ webhookSecret: forgeWebhooks.webhookSecret })
      .from(forgeWebhooks)
      .where(
        and(
          eq(forgeWebhooks.projectId, projectId),
          eq(forgeWebhooks.active, true),
        ),
      );

    if (rows.length === 0 || !rows[0].webhookSecret) {
      return false;
    }

    const secret = rows[0].webhookSecret;

    const hexSig = signatureHeader.startsWith("sha256=")
      ? signatureHeader.substring(7)
      : signatureHeader;

    const expected = Buffer.from(hexSig, "hex");

    const actual = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest();

    if (expected.length !== actual.length) {
      return false;
    }

    return crypto.timingSafeEqual(expected, actual);
  }
  router.post("/forge/webhook/forgejo", async (req, res) => {
    try {
      const forgejoEvent = req.headers["x-forgejo-event"] ?? req.headers["x-gitea-event"];
      const payloadWithProject = await withResolvedProjectId(db, "forgejo", req.body as Record<string, unknown>);
      const event = mapForgejoEvent(forgejoEvent as string, payloadWithProject);

      if (!event) {
        res.status(200).json({ ignored: true, reason: "Unhandled event type" });
        return;
      }

      const rawBody = (
        req as Request & {
          rawBody?: Buffer;
        }
      ).rawBody;

      const signatureHeader = req.headers["x-gitea-signature"];

      const signatureValue = Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : signatureHeader;

      if (!rawBody) {
        res.status(400).json({
          error: "Webhook raw body unavailable",
        });
        return;
      }

      const valid = await validateForgejoSignature(
        db,
        event.projectId,
        rawBody,
        signatureValue,
      );

      if (!valid) {
        res.status(401).json({
          error: "Invalid webhook signature",
        });
        return;
      }

      await storeWebhookDelivery(db, event.projectId, "forgejo", req.body as Record<string, unknown>, "received");
      const result = await forgeSync.processEvent(event);
      await storeWebhookDelivery(db, event.projectId, "forgejo", req.body as Record<string, unknown>, "processed");
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("Forge webhook processing error:", error);
      try {
        const payloadWithProject = await withResolvedProjectId(db, "forgejo", req.body as Record<string, unknown>);
        const projectId = typeof payloadWithProject.__gitmesh_project_id === "string"
          ? payloadWithProject.__gitmesh_project_id
          : null;
        if (projectId) {
          await storeWebhookDelivery(db, projectId, "forgejo", req.body as Record<string, unknown>, "failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } catch {
        // best-effort failure logging
      }
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  return router;
}

// ─── Module-level Helpers ──────────────────────────────────────────────────────

async function withResolvedProjectId(
  db: Db,
  provider: ForgeProvider,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const explicitProjectId = typeof payload.__gitmesh_project_id === "string"
    ? payload.__gitmesh_project_id
    : null;

  if (explicitProjectId) {
    return payload;
  }

  const coordinates = extractRepoCoordinates(provider, payload);
  if (!coordinates) {
    return payload;
  }

  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.forgeProvider, provider),
        eq(projects.forgeOwner, coordinates.forgeOwner),
        eq(projects.forgeRepo, coordinates.forgeRepo),
      ),
    );

  if (rows.length === 0) {
    return payload;
  }

  return {
    ...payload,
    __gitmesh_project_id: rows[0].id,
  };
}

function extractRepoCoordinates(
  provider: ForgeProvider,
  payload: Record<string, unknown>,
): { forgeOwner: string; forgeRepo: string } | null {
  if (provider === "github" || provider === "forgejo") {
    const repository = payload.repository as Record<string, unknown> | undefined;
    if (!repository) return null;

    const forgeRepo = typeof repository.name === "string" ? repository.name : null;
    const ownerObj = repository.owner as Record<string, unknown> | undefined;
    const forgeOwner =
      typeof ownerObj?.login === "string"
        ? ownerObj.login
        : typeof ownerObj?.name === "string"
          ? ownerObj.name
          : null;

    if (!forgeOwner || !forgeRepo) return null;
    return { forgeOwner, forgeRepo };
  }

  if (provider === "gitlab") {
    const project = payload.project as Record<string, unknown> | undefined;
    if (!project) return null;
    const forgeRepo = typeof project.name === "string" ? project.name : null;
    const forgeOwner = typeof project.namespace === "string" ? project.namespace : null;

    if (!forgeOwner || !forgeRepo) return null;
    return { forgeOwner, forgeRepo };
  }

  return null;
}

async function storeWebhookDelivery(
  db: Db,
  projectId: string,
  provider: ForgeProvider,
  payload: Record<string, unknown>,
  status: "received" | "processed" | "failed",
  options?: { error?: string },
) {
  const rows = await db
    .select({ id: forgeWebhooks.id })
    .from(forgeWebhooks)
    .where(
      and(
        eq(forgeWebhooks.projectId, projectId),
        eq(forgeWebhooks.forgeProvider, provider),
        eq(forgeWebhooks.active, true),
      ),
    );

  if (rows.length === 0) {
    return;
  }

  await db
    .update(forgeWebhooks)
    .set({
      rawPayload: JSON.stringify(payload),
      deliveryStatus: status,
      lastError: options?.error ?? null,
      lastDeliveredAt: status === "processed" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(forgeWebhooks.id, rows[0].id));
}

/**
 * Map a GitHub webhook event to a ForgeEvent.
 */
function mapGitHubEvent(eventName: string, payload: Record<string, unknown>): ForgeEvent | null {
  const repo = payload.repository as Record<string, unknown> | undefined;
  if (!repo) return null;

  const owner = (repo.owner as Record<string, unknown>)?.login as string;
  const repoName = repo.name as string;
  const projectId = (payload as Record<string, unknown>).__gitmesh_project_id as string;

  if (!projectId) return null;

  const base = {
    provider: "github" as const,
    projectId,
    payload,
    forgeOwner: owner,
    forgeRepo: repoName,
  };

  switch (eventName) {
    case "issues": {
      const action = (payload as Record<string, unknown>).action as string;
      const issue = (payload as Record<string, unknown>).issue as Record<string, unknown>;
      const eventType = action === "opened" ? "issue_opened"
        : action === "closed" ? "issue_closed"
          : action === "reopened" ? "issue_reopened"
            : null;
      if (!eventType || !issue) return null;
      return {
        ...base,
        eventType: eventType as ForgeEventType,
        forgeNumber: issue.number as number,
        forgeUrl: issue.html_url as string,
        title: issue.title as string,
        body: issue.body as string,
        authorLogin: (issue.user as Record<string, unknown>)?.login as string,
      };
    }
    case "issue_comment": {
      const issue = (payload as Record<string, unknown>).issue as Record<string, unknown>;
      const comment = (payload as Record<string, unknown>).comment as Record<string, unknown>;
      if (!issue || !comment) return null;
      return {
        ...base,
        eventType: "issue_comment",
        forgeNumber: issue.number as number,
        forgeUrl: comment.html_url as string,
        body: comment.body as string,
        authorLogin: (comment.user as Record<string, unknown>)?.login as string,
      };
    }
    case "pull_request": {
      const action = (payload as Record<string, unknown>).action as string;
      const pr = (payload as Record<string, unknown>).pull_request as Record<string, unknown>;
      const eventType = action === "opened" ? "pr_opened"
        : action === "closed" && (pr as Record<string, unknown>)?.merged ? "pr_merged"
          : action === "closed" ? "pr_closed"
            : null;
      if (!eventType || !pr) return null;
      return {
        ...base,
        eventType: eventType as ForgeEventType,
        forgeNumber: pr.number as number,
        forgeUrl: pr.html_url as string,
        title: pr.title as string,
        body: pr.body as string,
        authorLogin: (pr.user as Record<string, unknown>)?.login as string,
      };
    }
    default:
      return null;
  }
}

/**
 * Map a GitLab webhook event to a ForgeEvent.
 */
function mapGitLabEvent(eventName: string, payload: Record<string, unknown>): ForgeEvent | null {
  const project = payload.project as Record<string, unknown> | undefined;
  if (!project) return null;

  const namespace = (project.namespace as string) ?? "";
  const repoName = project.name as string;
  const projectId = (payload as Record<string, unknown>).__gitmesh_project_id as string;

  if (!projectId) return null;

  const base = {
    provider: "gitlab" as const,
    projectId,
    payload,
    forgeOwner: namespace,
    forgeRepo: repoName,
  };

  switch (eventName) {
    case "Issue Hook": {
      const attrs = payload.object_attributes as Record<string, unknown>;
      if (!attrs) return null;
      const action = attrs.action as string;
      const eventType = action === "open" ? "issue_opened"
        : action === "close" ? "issue_closed"
          : action === "reopen" ? "issue_reopened"
            : null;
      if (!eventType) return null;
      return {
        ...base,
        eventType: eventType as ForgeEventType,
        forgeNumber: attrs.iid as number,
        forgeUrl: attrs.url as string,
        title: attrs.title as string,
        body: attrs.description as string,
      };
    }
    case "Note Hook": {
      const attrs = payload.object_attributes as Record<string, unknown>;
      const issue = payload.issue as Record<string, unknown>;
      if (!attrs || !issue) return null;
      return {
        ...base,
        eventType: "issue_comment",
        forgeNumber: issue.iid as number,
        forgeUrl: attrs.url as string,
        body: attrs.note as string,
      };
    }
    case "Merge Request Hook": {
      const attrs = payload.object_attributes as Record<string, unknown>;
      if (!attrs) return null;
      const action = attrs.action as string;
      const eventType = action === "open" ? "pr_opened"
        : action === "close" ? "pr_closed"
          : action === "merge" ? "pr_merged"
            : null;
      if (!eventType) return null;
      return {
        ...base,
        eventType: eventType as ForgeEventType,
        forgeNumber: attrs.iid as number,
        forgeUrl: attrs.url as string,
        title: attrs.title as string,
        body: attrs.description as string,
      };
    }
    default:
      return null;
  }
}

/**
 * Map a Forgejo/Gitea webhook event to a ForgeEvent.
 */
function mapForgejoEvent(eventName: string, payload: Record<string, unknown>): ForgeEvent | null {
  const repo = payload.repository as Record<string, unknown> | undefined;
  if (!repo) return null;

  const owner = (repo.owner as Record<string, unknown>)?.login as string;
  const repoName = repo.name as string;
  const projectId = (payload as Record<string, unknown>).__gitmesh_project_id as string;

  if (!projectId) return null;

  const base = {
    provider: "forgejo" as const,
    projectId,
    payload,
    forgeOwner: owner,
    forgeRepo: repoName,
  };

  switch (eventName) {
    case "issues": {
      const action = (payload as Record<string, unknown>).action as string;
      const issue = (payload as Record<string, unknown>).issue as Record<string, unknown>;
      const eventType = action === "opened" ? "issue_opened"
        : action === "closed" ? "issue_closed"
          : action === "reopened" ? "issue_reopened"
            : null;
      if (!eventType || !issue) return null;
      return {
        ...base,
        eventType: eventType as ForgeEventType,
        forgeNumber: issue.number as number,
        forgeUrl: issue.html_url as string,
        title: issue.title as string,
        body: issue.body as string,
        authorLogin: (issue.user as Record<string, unknown>)?.login as string,
      };
    }
    case "issue_comment": {
      const issue = (payload as Record<string, unknown>).issue as Record<string, unknown>;
      const comment = (payload as Record<string, unknown>).comment as Record<string, unknown>;
      if (!issue || !comment) return null;
      return {
        ...base,
        eventType: "issue_comment",
        forgeNumber: issue.number as number,
        forgeUrl: comment.html_url as string,
        body: comment.body as string,
        authorLogin: (comment.user as Record<string, unknown>)?.login as string,
      };
    }
    case "pull_request": {
      const action = (payload as Record<string, unknown>).action as string;
      const pr = (payload as Record<string, unknown>).pull_request as Record<string, unknown>;
      const eventType = action === "opened" ? "pr_opened"
        : action === "closed" && (pr as Record<string, unknown>)?.merged ? "pr_merged"
          : action === "closed" ? "pr_closed"
            : null;
      if (!eventType || !pr) return null;
      return {
        ...base,
        eventType: eventType as ForgeEventType,
        forgeNumber: pr.number as number,
        forgeUrl: pr.html_url as string,
        title: pr.title as string,
        body: pr.body as string,
        authorLogin: (pr.user as Record<string, unknown>)?.login as string,
      };
    }
    default:
      return null;
  }
}

/**
 * Validate GitHub webhook signature using HMAC-SHA256.
 * Compares X-Hub-Signature-256 header against the raw request body.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 */
async function validateGitHubSignature(
  db: Db,
  projectId: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const rows = await db
    .select({ webhookSecret: forgeWebhooks.webhookSecret })
    .from(forgeWebhooks)
    .where(and(eq(forgeWebhooks.projectId, projectId), eq(forgeWebhooks.active, true)));

  if (rows.length === 0 || !rows[0].webhookSecret) return false;

  const secret = rows[0].webhookSecret;

  // GitHub sends: sha256=<hex>
  const [algo, hexSig] = signatureHeader.split("=");
  if (algo !== "sha256" || !hexSig) return false;

  const expected = Buffer.from(hexSig, "hex");
  const actual = crypto.createHmac("sha256", secret).update(rawBody).digest();

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Parse owner/repo from a GitHub URL.
 * Supports:
 * - https://github.com/owner/repo
 * - https://github.com/org/owner/repo (enterprise)
 * - git@github.com:owner/repo.git
 */
function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim());

    // HTTPS URL: github.com/owner/repo
    if (u.hostname === "github.com") {
      const segments = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
      if (segments.length >= 2) {
        return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
      }
      return null;
    }

    // SSH URL: git@github.com:owner/repo.git
    if (url.startsWith("git@")) {
      const match = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
      if (match) {
        return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
      }
      return null;
    }

    // Generic HTTPS for enterprise (e.g., github.mycompany.com/owner/repo)
    const segments = u.pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Manual Sync Routes ─────────────────────────────────────────────────────────

export function forgeSyncRoutes(db: Db) {
  const router = Router();

  /**
   * POST /api/projects/:projectId/sync
   * Manually trigger a pull-based sync of all issues from the forge.
   * Actor middleware has already run, so req.actor is available.
   */
  router.post("/projects/:projectId/sync", async (req, res) => {
    const projectId = req.params.projectId as string;
    if (!req.actor || !req.actor.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!projectId) {
      res.status(400).json({ error: "Missing projectId" });
      return;
    }
    try {
      const mod = await import("../core/forge-sync.js");
      await mod.syncProjectIssues(db, projectId);
      res.json({ ok: true });
    } catch (err) {
      console.error("Manual sync error:", err);
      res.status(500).json({ error: "Sync failed" });
    }
  });

  return router;
}
