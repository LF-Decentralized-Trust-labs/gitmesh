import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Db } from "@gitmesh/data";
import {
  addIssueCommentSchema,
  createIssueAttachmentMetadataSchema,
  createIssueLabelSchema,
  checkoutIssueSchema,
  createIssueSchema,
  linkIssueApprovalSchema,
  updateIssueSchema,
} from "@gitmesh/core";
import type { StorageService } from "../infra/storage/types.js";
import { validate } from "../infra/middleware/validate.js";
import {
  accessService,
  agentService,
  goalService,
  heartbeatService,
  issueApprovalService,
  issueService,
  logActivity,
  projectService,
} from "../core/index.js";
import { logger } from "../infra/middleware/logger.js";
import { forbidden, HttpError, unauthorized } from "../errors.js";
import { assertBoard, assertProjectAccess, getActorInfo } from "./authz.js";
import { shouldWakeAssigneeOnCheckout } from "./issues-checkout-wakeup.js";

const MAX_ATTACHMENT_BYTES = Number(process.env.GITMESH_ATTACHMENT_MAX_BYTES) || 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export function issueRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const svc = issueService(db);
  const access = accessService(db);
  const heartbeat = heartbeatService(db);
  const agentsSvc = agentService(db);
  const projectsSvc = projectService(db);
  const goalsSvc = goalService(db);
  const issueApprovalsSvc = issueApprovalService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  });

  function withContentPath<T extends { id: string }>(attachment: T) {
    return {
      ...attachment,
      contentPath: `/api/attachments/${attachment.id}/content`,
    };
  }

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async function assertCanManageIssueApprovalLinks(req: Request, res: Response, projectId: string) {
    assertProjectAccess(req, projectId);
    if (req.actor.type === "operator") return true;
    if (!req.actor.agentId) {
      res.status(403).json({ error: "Agent authentication required" });
      return false;
    }
    const actorAgent = await agentsSvc.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.projectId !== projectId) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    if (actorAgent.role === "admin" || Boolean(actorAgent.permissions?.canCreateAgents)) return true;
    res.status(403).json({ error: "Missing permission to link approvals" });
    return false;
  }

  function canCreateAgentsLegacy(agent: { permissions: Record<string, unknown> | null | undefined; role: string }) {
    if (agent.role === "admin") return true;
    if (!agent.permissions || typeof agent.permissions !== "object") return false;
    return Boolean((agent.permissions as Record<string, unknown>).canCreateAgents);
  }

  async function assertCanAssignTasks(req: Request, projectId: string) {
    assertProjectAccess(req, projectId);
    if (req.actor.type === "operator") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(projectId, req.actor.userId, "tasks:assign");
      if (!allowed) throw forbidden("Missing permission: tasks:assign");
      return;
    }
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden("Agent authentication required");
      const allowedByGrant = await access.hasPermission(projectId, "agent", req.actor.agentId, "tasks:assign");
      if (allowedByGrant) return;
      const actorAgent = await agentsSvc.getById(req.actor.agentId);
      if (actorAgent && actorAgent.projectId === projectId && canCreateAgentsLegacy(actorAgent)) return;
      throw forbidden("Missing permission: tasks:assign");
    }
    throw unauthorized();
  }

  function requireAgentRunId(req: Request, res: Response) {
    if (req.actor.type !== "agent") return null;
    const runId = req.actor.runId?.trim();
    if (runId) return runId;
    res.status(401).json({ error: "Agent run id required" });
    return null;
  }

  async function assertAgentRunCheckoutOwnership(
    req: Request,
    res: Response,
    issue: { id: string; projectId: string; status: string; assigneeAgentId: string | null },
  ) {
    if (req.actor.type !== "agent") return true;
    const actorAgentId = req.actor.agentId;
    if (!actorAgentId) {
      res.status(403).json({ error: "Agent authentication required" });
      return false;
    }
    if (issue.status !== "in_progress" || issue.assigneeAgentId !== actorAgentId) {
      return true;
    }
    const runId = requireAgentRunId(req, res);
    if (!runId) return false;
    const ownership = await svc.assertCheckoutOwner(issue.id, actorAgentId, runId);
    if (ownership.adoptedFromRunId) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        projectId: issue.projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.checkout_lock_adopted",
        entityType: "issue",
        entityId: issue.id,
        details: {
          previousCheckoutRunId: ownership.adoptedFromRunId,
          checkoutRunId: runId,
          reason: "stale_checkout_run",
        },
      });
    }
    return true;
  }

  async function normalizeIssueIdentifier(rawId: string): Promise<string> {
    if (/^[A-Z]+-\d+$/i.test(rawId)) {
      const issue = await svc.getByIdentifier(rawId);
      if (issue) {
        return issue.id;
      }
    }
    return rawId;
  }

  // Resolve issue identifiers (e.g. "PAP-39") to UUIDs for all /issues/:id routes
  router.param("id", async (req, res, next, rawId) => {
    try {
      req.params.id = await normalizeIssueIdentifier(rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  // Resolve issue identifiers (e.g. "PAP-39") to UUIDs for project-scoped attachment routes.
  router.param("issueId", async (req, res, next, rawId) => {
    try {
      req.params.issueId = await normalizeIssueIdentifier(rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  // Common malformed path when projectId is empty in "/api/projects/{projectId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing projectId in path. Use /api/projects/{projectId}/issues.",
    });
  });

  router.get("/projects/:projectId/issues", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const assigneeUserFilterRaw = req.query.assigneeUserId as string | undefined;
    const touchedByUserFilterRaw = req.query.touchedByUserId as string | undefined;
    const unreadForUserFilterRaw = req.query.unreadForUserId as string | undefined;
    const assigneeUserId =
      assigneeUserFilterRaw === "me" && req.actor.type === "operator"
        ? req.actor.userId
        : assigneeUserFilterRaw;
    const touchedByUserId =
      touchedByUserFilterRaw === "me" && req.actor.type === "operator"
        ? req.actor.userId
        : touchedByUserFilterRaw;
    const unreadForUserId =
      unreadForUserFilterRaw === "me" && req.actor.type === "operator"
        ? req.actor.userId
        : unreadForUserFilterRaw;

    if (assigneeUserFilterRaw === "me" && (!assigneeUserId || req.actor.type !== "operator")) {
      res.status(403).json({ error: "assigneeUserId=me requires maintainer authentication" });
      return;
    }
    if (touchedByUserFilterRaw === "me" && (!touchedByUserId || req.actor.type !== "operator")) {
      res.status(403).json({ error: "touchedByUserId=me requires maintainer authentication" });
      return;
    }
    if (unreadForUserFilterRaw === "me" && (!unreadForUserId || req.actor.type !== "operator")) {
      res.status(403).json({ error: "unreadForUserId=me requires maintainer authentication" });
      return;
    }

    const result = await svc.list(projectId, {
      status: req.query.status as string | undefined,
      assigneeAgentId: req.query.assigneeAgentId as string | undefined,
      assigneeUserId,
      touchedByUserId,
      unreadForUserId,
      projectId: req.query.projectId as string | undefined,
      labelId: req.query.labelId as string | undefined,
      q: req.query.q as string | undefined,
    });
    res.json(result);
  });

  router.get("/projects/:projectId/labels", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const result = await svc.listLabels(projectId);
    res.json(result);
  });

  router.post("/projects/:projectId/labels", validate(createIssueLabelSchema), async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const label = await svc.createLabel(projectId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "label.created",
      entityType: "label",
      entityId: label.id,
      details: { name: label.name, color: label.color },
    });
    res.status(201).json(label);
  });

  router.delete("/labels/:labelId", async (req, res) => {
    const labelId = req.params.labelId as string;
    const existing = await svc.getLabelById(labelId);
    if (!existing) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    assertBoard(req);
    assertProjectAccess(req, existing.projectId);
    const removed = await svc.deleteLabel(labelId);
    if (!removed) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: removed.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "label.deleted",
      entityType: "label",
      entityId: removed.id,
      details: { name: removed.name, color: removed.color },
    });
    res.json(removed);
  });

  router.get("/issues/:id", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const [ancestors, project, goal, mentionedProjectIds] = await Promise.all([
      svc.getAncestors(issue.id),
      issue.projectId ? projectsSvc.getById(issue.projectId) : null,
      issue.goalId ? goalsSvc.getById(issue.goalId) : null,
      svc.findMentionedProjectIds(issue.id),
    ]);
    const mentionedProjects = mentionedProjectIds.length > 0
      ? await projectsSvc.listByIds(issue.projectId, mentionedProjectIds)
      : [];
    res.json({ ...issue, ancestors, project: project ?? null, goal: goal ?? null, mentionedProjects });
  });

  router.post("/issues/:id/read", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    if (req.actor.type !== "operator") {
      res.status(403).json({ error: "Maintainer authentication required" });
      return;
    }
    if (!req.actor.userId) {
      res.status(403).json({ error: "Maintainer user context required" });
      return;
    }
    const readState = await svc.markRead(issue.projectId, issue.id, req.actor.userId, new Date());
    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: issue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.read_marked",
      entityType: "issue",
      entityId: issue.id,
      details: { userId: req.actor.userId, lastReadAt: readState.lastReadAt },
    });
    res.json(readState);
  });

  router.get("/issues/:id/approvals", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const approvals = await issueApprovalsSvc.listApprovalsForIssue(id);
    res.json(approvals);
  });

  router.post("/issues/:id/approvals", validate(linkIssueApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (!(await assertCanManageIssueApprovalLinks(req, res, issue.projectId))) return;

    const actor = getActorInfo(req);
    await issueApprovalsSvc.link(id, req.body.approvalId, {
      agentId: actor.agentId,
      userId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      projectId: issue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.approval_linked",
      entityType: "issue",
      entityId: issue.id,
      details: { approvalId: req.body.approvalId },
    });

    const approvals = await issueApprovalsSvc.listApprovalsForIssue(id);
    res.status(201).json(approvals);
  });

  router.delete("/issues/:id/approvals/:approvalId", async (req, res) => {
    const id = req.params.id as string;
    const approvalId = req.params.approvalId as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (!(await assertCanManageIssueApprovalLinks(req, res, issue.projectId))) return;

    await issueApprovalsSvc.unlink(id, approvalId);

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: issue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.approval_unlinked",
      entityType: "issue",
      entityId: issue.id,
      details: { approvalId },
    });

    res.json({ ok: true });
  });

  router.post("/projects/:projectId/issues", validate(createIssueSchema), async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    if (req.body.assigneeAgentId || req.body.assigneeUserId) {
      await assertCanAssignTasks(req, projectId);
    }

    const actor = getActorInfo(req);
    const issue = await svc.create(projectId, {
      ...req.body,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.created",
      entityType: "issue",
      entityId: issue.id,
      details: { title: issue.title, identifier: issue.identifier },
    });

    if (issue.assigneeAgentId && issue.status !== "backlog") {
      void heartbeat
        .wakeup(issue.assigneeAgentId, {
          source: "assignment",
          triggerDetail: "system",
          reason: "issue_assigned",
          payload: { issueId: issue.id, mutation: "create" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId: issue.id, source: "issue.create" },
        })
        .catch((err) => logger.warn({ err, issueId: issue.id }, "failed to wake assignee on issue create"));
    }

    res.status(201).json(issue);
  });

  router.patch("/issues/:id", validate(updateIssueSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, existing.projectId);
    const assigneeWillChange =
      (req.body.assigneeAgentId !== undefined && req.body.assigneeAgentId !== existing.assigneeAgentId) ||
      (req.body.assigneeUserId !== undefined && req.body.assigneeUserId !== existing.assigneeUserId);

    const isAgentReturningIssueToCreator =
      req.actor.type === "agent" &&
      !!req.actor.agentId &&
      existing.assigneeAgentId === req.actor.agentId &&
      req.body.assigneeAgentId === null &&
      typeof req.body.assigneeUserId === "string" &&
      !!existing.createdByUserId &&
      req.body.assigneeUserId === existing.createdByUserId;

    if (assigneeWillChange) {
      if (!isAgentReturningIssueToCreator) {
        await assertCanAssignTasks(req, existing.projectId);
      }
    }
    if (!(await assertAgentRunCheckoutOwnership(req, res, existing))) return;

    const { comment: commentBody, hiddenAt: hiddenAtRaw, ...updateFields } = req.body;
    if (hiddenAtRaw !== undefined) {
      updateFields.hiddenAt = hiddenAtRaw ? new Date(hiddenAtRaw) : null;
    }
    let issue;
    try {
      issue = await svc.update(id, updateFields);
    } catch (err) {
      if (err instanceof HttpError && err.status === 422) {
        logger.warn(
          {
            issueId: id,
            projectId: existing.projectId,
            assigneePatch: {
              assigneeAgentId:
                req.body.assigneeAgentId === undefined ? "__omitted__" : req.body.assigneeAgentId,
              assigneeUserId:
                req.body.assigneeUserId === undefined ? "__omitted__" : req.body.assigneeUserId,
            },
            currentAssignee: {
              assigneeAgentId: existing.assigneeAgentId,
              assigneeUserId: existing.assigneeUserId,
            },
            error: err.message,
            details: err.details,
          },
          "issue update rejected with 422",
        );
      }
      throw err;
    }
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    // Build activity details with previous values for changed fields
    const previous: Record<string, unknown> = {};
    for (const key of Object.keys(updateFields)) {
      if (key in existing && (existing as Record<string, unknown>)[key] !== (updateFields as Record<string, unknown>)[key]) {
        previous[key] = (existing as Record<string, unknown>)[key];
      }
    }

    const actor = getActorInfo(req);
    const hasFieldChanges = Object.keys(previous).length > 0;
    await logActivity(db, {
      projectId: issue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      details: {
        ...updateFields,
        identifier: issue.identifier,
        ...(commentBody ? { source: "comment" } : {}),
        _previous: hasFieldChanges ? previous : undefined,
      },
    });

    let comment = null;
    if (commentBody) {
      comment = await svc.addComment(id, commentBody, {
        agentId: actor.agentId ?? undefined,
        userId: actor.actorType === "user" ? actor.actorId : undefined,
      });

      await logActivity(db, {
        projectId: issue.projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.comment_added",
        entityType: "issue",
        entityId: issue.id,
        details: {
          commentId: comment.id,
          bodySnippet: comment.body.slice(0, 120),
          identifier: issue.identifier,
          issueTitle: issue.title,
          ...(hasFieldChanges ? { updated: true } : {}),
        },
      });

    }

    const assigneeChanged = assigneeWillChange;
    const statusChangedFromBacklog =
      existing.status === "backlog" &&
      issue.status !== "backlog" &&
      req.body.status !== undefined;

    // Merge all wakeups from this update into one enqueue per agent to avoid duplicate runs.
    void (async () => {
      const wakeups = new Map<string, Parameters<typeof heartbeat.wakeup>[1]>();

      if (assigneeChanged && issue.assigneeAgentId && issue.status !== "backlog") {
        wakeups.set(issue.assigneeAgentId, {
          source: "assignment",
          triggerDetail: "system",
          reason: "issue_assigned",
          payload: { issueId: issue.id, mutation: "update" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId: issue.id, source: "issue.update" },
        });
      }

      if (!assigneeChanged && statusChangedFromBacklog && issue.assigneeAgentId) {
        wakeups.set(issue.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_status_changed",
          payload: { issueId: issue.id, mutation: "update" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId: issue.id, source: "issue.status_change" },
        });
      }

      if (commentBody && comment) {
        let mentionedIds: string[] = [];
        try {
          mentionedIds = await svc.findMentionedAgents(issue.projectId, commentBody);
        } catch (err) {
          logger.warn({ err, issueId: id }, "failed to resolve @-mentions");
        }

        for (const mentionedId of mentionedIds) {
          if (wakeups.has(mentionedId)) continue;
          if (actor.actorType === "agent" && actor.actorId === mentionedId) continue;
          wakeups.set(mentionedId, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_comment_mentioned",
            payload: { issueId: id, commentId: comment.id },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId: id,
              taskId: id,
              commentId: comment.id,
              wakeCommentId: comment.id,
              wakeReason: "issue_comment_mentioned",
              source: "comment.mention",
            },
          });
        }
      }

      for (const [agentId, wakeup] of wakeups.entries()) {
        heartbeat
          .wakeup(agentId, wakeup)
          .catch((err) => logger.warn({ err, issueId: issue.id, agentId }, "failed to wake agent on issue update"));
      }
    })();

    res.json({ ...issue, comment });
  });

  router.delete("/issues/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertBoard(req);
    assertProjectAccess(req, existing.projectId);
    const attachments = await svc.listAttachments(id);

    const issue = await svc.remove(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    for (const attachment of attachments) {
      try {
        await storage.deleteObject(attachment.projectId, attachment.objectKey);
      } catch (err) {
        logger.warn({ err, issueId: id, attachmentId: attachment.id }, "failed to delete attachment object during issue delete");
      }
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: issue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.deleted",
      entityType: "issue",
      entityId: issue.id,
    });

    res.json(issue);
  });

  router.post("/issues/:id/checkout", validate(checkoutIssueSchema), async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only checkout as itself" });
      return;
    }

    const checkoutRunId = requireAgentRunId(req, res);
    if (req.actor.type === "agent" && !checkoutRunId) return;
    const updated = await svc.checkout(id, req.body.agentId, req.body.expectedStatuses, checkoutRunId);
    const actor = getActorInfo(req);

    await logActivity(db, {
      projectId: issue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.checked_out",
      entityType: "issue",
      entityId: issue.id,
      details: { agentId: req.body.agentId },
    });

    if (
      shouldWakeAssigneeOnCheckout({
        actorType: req.actor.type,
        actorAgentId: req.actor.type === "agent" ? req.actor.agentId ?? null : null,
        checkoutAgentId: req.body.agentId,
        checkoutRunId,
      })
    ) {
      void heartbeat
        .wakeup(req.body.agentId, {
          source: "assignment",
          triggerDetail: "system",
          reason: "issue_checked_out",
          payload: { issueId: issue.id, mutation: "checkout" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId: issue.id, source: "issue.checkout" },
        })
        .catch((err) => logger.warn({ err, issueId: issue.id }, "failed to wake assignee on issue checkout"));
    }

    res.json(updated);
  });

  router.post("/issues/:id/release", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, existing.projectId);
    if (!(await assertAgentRunCheckoutOwnership(req, res, existing))) return;
    const actorRunId = requireAgentRunId(req, res);
    if (req.actor.type === "agent" && !actorRunId) return;

    const released = await svc.release(
      id,
      req.actor.type === "agent" ? req.actor.agentId : undefined,
      actorRunId,
    );
    if (!released) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: released.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.released",
      entityType: "issue",
      entityId: released.id,
    });

    res.json(released);
  });

  router.get("/issues/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.get("/issues/:id/comments/:commentId", async (req, res) => {
    const id = req.params.id as string;
    const commentId = req.params.commentId as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const comment = await svc.getComment(commentId);
    if (!comment || comment.issueId !== id) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    res.json(comment);
  });

  router.post("/issues/:id/comments", validate(addIssueCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    if (!(await assertAgentRunCheckoutOwnership(req, res, issue))) return;

    const actor = getActorInfo(req);
    const reopenRequested = req.body.reopen === true;
    const interruptRequested = req.body.interrupt === true;
    const isClosed = issue.status === "done" || issue.status === "cancelled";
    let reopened = false;
    let reopenFromStatus: string | null = null;
    let interruptedRunId: string | null = null;
    let currentIssue = issue;

    if (reopenRequested && isClosed) {
      const reopenedIssue = await svc.update(id, { status: "todo" });
      if (!reopenedIssue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      reopened = true;
      reopenFromStatus = issue.status;
      currentIssue = reopenedIssue;

      await logActivity(db, {
        projectId: currentIssue.projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.updated",
        entityType: "issue",
        entityId: currentIssue.id,
        details: {
          status: "todo",
          reopened: true,
          reopenedFrom: reopenFromStatus,
          source: "comment",
          identifier: currentIssue.identifier,
        },
      });
    }

    if (interruptRequested) {
      if (req.actor.type !== "operator") {
        res.status(403).json({ error: "Only maintainers can interrupt active runs from issue comments" });
        return;
      }

      let runToInterrupt = currentIssue.executionRunId
        ? await heartbeat.getRun(currentIssue.executionRunId)
        : null;

      if (
        (!runToInterrupt || runToInterrupt.status !== "running") &&
        currentIssue.assigneeAgentId
      ) {
        const activeRun = await heartbeat.getActiveRunForAgent(currentIssue.assigneeAgentId);
        const activeIssueId =
          activeRun &&
            activeRun.contextSnapshot &&
            typeof activeRun.contextSnapshot === "object" &&
            typeof (activeRun.contextSnapshot as Record<string, unknown>).issueId === "string"
            ? ((activeRun.contextSnapshot as Record<string, unknown>).issueId as string)
            : null;
        if (activeRun && activeRun.status === "running" && activeIssueId === currentIssue.id) {
          runToInterrupt = activeRun;
        }
      }

      if (runToInterrupt && runToInterrupt.status === "running") {
        const cancelled = await heartbeat.cancelRun(runToInterrupt.id);
        if (cancelled) {
          interruptedRunId = cancelled.id;
          await logActivity(db, {
            projectId: cancelled.projectId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "heartbeat.cancelled",
            entityType: "heartbeat_run",
            entityId: cancelled.id,
            details: { agentId: cancelled.agentId, source: "issue_comment_interrupt", issueId: currentIssue.id },
          });
        }
      }
    }

    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      projectId: currentIssue.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.comment_added",
      entityType: "issue",
      entityId: currentIssue.id,
      details: {
        commentId: comment.id,
        bodySnippet: comment.body.slice(0, 120),
        identifier: currentIssue.identifier,
        issueTitle: currentIssue.title,
        ...(reopened ? { reopened: true, reopenedFrom: reopenFromStatus, source: "comment" } : {}),
        ...(interruptedRunId ? { interruptedRunId } : {}),
      },
    });

    // Merge all wakeups from this comment into one enqueue per agent to avoid duplicate runs.
    void (async () => {
      const wakeups = new Map<string, Parameters<typeof heartbeat.wakeup>[1]>();
      const assigneeId = currentIssue.assigneeAgentId;
      const actorIsAgent = actor.actorType === "agent";
      const selfComment = actorIsAgent && actor.actorId === assigneeId;
      const skipWake = selfComment || isClosed;
      if (assigneeId && (reopened || !skipWake)) {
        if (reopened) {
          wakeups.set(assigneeId, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_reopened_via_comment",
            payload: {
              issueId: currentIssue.id,
              commentId: comment.id,
              reopenedFrom: reopenFromStatus,
              mutation: "comment",
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId: currentIssue.id,
              taskId: currentIssue.id,
              commentId: comment.id,
              source: "issue.comment.reopen",
              wakeReason: "issue_reopened_via_comment",
              reopenedFrom: reopenFromStatus,
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
          });
        } else {
          wakeups.set(assigneeId, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_commented",
            payload: {
              issueId: currentIssue.id,
              commentId: comment.id,
              mutation: "comment",
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId: currentIssue.id,
              taskId: currentIssue.id,
              commentId: comment.id,
              source: "issue.comment",
              wakeReason: "issue_commented",
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
          });
        }
      }

      let mentionedIds: string[] = [];
      try {
        mentionedIds = await svc.findMentionedAgents(issue.projectId, req.body.body);
      } catch (err) {
        logger.warn({ err, issueId: id }, "failed to resolve @-mentions");
      }

      for (const mentionedId of mentionedIds) {
        if (wakeups.has(mentionedId)) continue;
        if (actorIsAgent && actor.actorId === mentionedId) continue;
        wakeups.set(mentionedId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_comment_mentioned",
          payload: { issueId: id, commentId: comment.id },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            issueId: id,
            taskId: id,
            commentId: comment.id,
            wakeCommentId: comment.id,
            wakeReason: "issue_comment_mentioned",
            source: "comment.mention",
          },
        });
      }

      for (const [agentId, wakeup] of wakeups.entries()) {
        heartbeat
          .wakeup(agentId, wakeup)
          .catch((err) => logger.warn({ err, issueId: currentIssue.id, agentId }, "failed to wake agent on issue comment"));
      }
    })();

    res.status(201).json(comment);
  });

  router.get("/issues/:id/attachments", async (req, res) => {
    const issueId = req.params.id as string;
    const issue = await svc.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const attachments = await svc.listAttachments(issueId);
    res.json(attachments.map(withContentPath));
  });

  router.post("/projects/:projectId/issues/:issueId/attachments", async (req, res) => {
    const projectId = req.params.projectId as string;
    const issueId = req.params.issueId as string;
    assertProjectAccess(req, projectId);
    const issue = await svc.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (issue.projectId !== projectId) {
      res.status(422).json({ error: "Issue does not belong to project" });
      return;
    }

    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }
    const contentType = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
      res.status(422).json({ error: `Unsupported attachment type: ${contentType || "unknown"}` });
      return;
    }
    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "Attachment is empty" });
      return;
    }

    const parsedMeta = createIssueAttachmentMetadataSchema.safeParse(req.body ?? {});
    if (!parsedMeta.success) {
      res.status(400).json({ error: "Invalid attachment metadata", details: parsedMeta.error.issues });
      return;
    }

    const actor = getActorInfo(req);
    const stored = await storage.putFile({
      projectId,
      namespace: `issues/${issueId}`,
      originalFilename: file.originalname || null,
      contentType,
      body: file.buffer,
    });

    const attachment = await svc.createAttachment({
      issueId,
      issueCommentId: parsedMeta.data.issueCommentId ?? null,
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.attachment_added",
      entityType: "issue",
      entityId: issueId,
      details: {
        attachmentId: attachment.id,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
      },
    });

    res.status(201).json(withContentPath(attachment));
  });

  router.get("/attachments/:attachmentId/content", async (req, res, next) => {
    const attachmentId = req.params.attachmentId as string;
    const attachment = await svc.getAttachmentById(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    assertProjectAccess(req, attachment.projectId);

    const object = await storage.getObject(attachment.projectId, attachment.objectKey);
    res.setHeader("Content-Type", attachment.contentType || object.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(attachment.byteSize || object.contentLength || 0));
    res.setHeader("Cache-Control", "private, max-age=60");
    const filename = attachment.originalFilename ?? "attachment";
    res.setHeader("Content-Disposition", `inline; filename=\"${filename.replaceAll("\"", "")}\"`);

    object.stream.on("error", (err) => {
      next(err);
    });
    object.stream.pipe(res);
  });

  router.delete("/attachments/:attachmentId", async (req, res) => {
    const attachmentId = req.params.attachmentId as string;
    const attachment = await svc.getAttachmentById(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    assertProjectAccess(req, attachment.projectId);

    try {
      await storage.deleteObject(attachment.projectId, attachment.objectKey);
    } catch (err) {
      logger.warn({ err, attachmentId }, "storage delete failed while removing attachment");
    }

    const removed = await svc.removeAttachment(attachmentId);
    if (!removed) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: removed.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.attachment_removed",
      entityType: "issue",
      entityId: removed.issueId,
      details: {
        attachmentId: removed.id,
      },
    });

    res.json({ ok: true });
  });

  return router;
}
