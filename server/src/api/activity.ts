import { Router } from "express";
import { z } from "zod";
import type { Db } from "@gitmesh/data";
import { validate } from "../infra/middleware/validate.js";
import { activityService } from "../core/activity.js";
import { assertBoard, assertProjectAccess } from "./authz.js";
import { issueService } from "../core/index.js";
import { sanitizeRecord } from "../redaction.js";

const createActivitySchema = z.object({
  actorType: z.enum(["agent", "user", "system"]).optional().default("system"),
  actorId: z.string().min(1),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  agentId: z.string().uuid().optional().nullable(),
  details: z.record(z.unknown()).optional().nullable(),
});

export function activityRoutes(db: Db) {
  const router = Router();
  const svc = activityService(db);
  const issueSvc = issueService(db);

  router.get("/projects/:projectId/activity", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const filters = {
      projectId,
      agentId: req.query.agentId as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
    };
    const result = await svc.list(filters);
    res.json(result);
  });

  router.get("/projects/:projectId/audit-log", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const filters = {
      projectId,
      agentId: req.query.agentId as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
    };
    const result = await svc.list(filters);
    res.json(result);
  });

  /**
   * Export audit log with policy metadata for compliance / offline analysis.
   * GET /projects/:projectId/audit-log/export?format=json|csv
   * Addresses the exportable format slice of #436.
   *
   * Intentional legacy placement: #436 asks for exportable audit formats on the
   * current runtime. The pivot plan (doc/pivot/pivot.md §10.8) keeps server/
   * untouched for the *new* install path; this route hardens the existing
   * activity API used by operators today rather than moving export into the
   * CLI workspace packages (separate follow-up).
   */
  router.get("/projects/:projectId/audit-log/export", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const format = String(req.query.format ?? "json").toLowerCase();
    if (format !== "json" && format !== "csv") {
      res.status(400).json({ error: "format must be 'json' or 'csv'" });
      return;
    }

    const filters = {
      projectId,
      agentId: req.query.agentId as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
    };
    const result = await svc.list(filters);

    const sanitizeDetails = (details: unknown) => {
      if (details == null) return null;
      if (typeof details === "object" && !Array.isArray(details)) {
        return sanitizeRecord(details as Record<string, unknown>);
      }
      return details;
    };

    const rows = result.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      createdAt: e.createdAt,
      actorType: e.actorType,
      actorId: e.actorId,
      agentId: e.agentId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      runId: e.runId,
      policyVersion: e.policyVersion,
      policyOutcome: e.policyOutcome,
      details: sanitizeDetails(e.details),
    }));

    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="gitmesh-audit-${projectId}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        projectId,
        count: rows.length,
        events: rows,
      });
      return;
    }

    const header = [
      "id",
      "projectId",
      "createdAt",
      "actorType",
      "actorId",
      "agentId",
      "action",
      "entityType",
      "entityId",
      "runId",
      "policyVersion",
      "policyOutcome",
    ];
    /** Escape CSV cells and neutralize spreadsheet formula injection. */
    const escape = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@]/.test(s)) {
        s = `'${s}`;
      }
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.id,
          r.projectId,
          r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
          r.actorType,
          r.actorId,
          r.agentId,
          r.action,
          r.entityType,
          r.entityId,
          r.runId,
          r.policyVersion,
          r.policyOutcome,
        ]
          .map(escape)
          .join(",")
      ),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gitmesh-audit-${projectId}.csv"`
    );
    res.send(lines.join("\n"));
  });

  router.post("/projects/:projectId/activity", validate(createActivitySchema), async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    const event = await svc.create({
      projectId,
      ...req.body,
      details: req.body.details ? sanitizeRecord(req.body.details) : null,
    });
    res.status(201).json(event);
  });

  // Resolve issue identifiers (e.g. "PAP-39") to UUIDs
  router.param("id", async (req, res, next, rawId) => {
    try {
      if (/^[A-Z]+-\d+$/i.test(rawId)) {
        const issue = await issueSvc.getByIdentifier(rawId);
        if (issue) {
          req.params.id = issue.id;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/issues/:id/activity", async (req, res) => {
    const id = req.params.id as string;
    const issue = await issueSvc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const result = await svc.forIssue(id);
    res.json(result);
  });

  router.get("/issues/:id/audit-log", async (req, res) => {
    const id = req.params.id as string;
    const issue = await issueSvc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const result = await svc.forIssue(id);
    res.json(result);
  });

  router.get("/issues/:id/runs", async (req, res) => {
    const id = req.params.id as string;
    const issue = await issueSvc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertProjectAccess(req, issue.projectId);
    const result = await svc.runsForIssue(issue.projectId, id);
    res.json(result);
  });

  router.get("/heartbeat-runs/:runId/issues", async (req, res) => {
    const runId = req.params.runId as string;
    const result = await svc.issuesForRun(runId);
    res.json(result);
  });

  return router;
}
