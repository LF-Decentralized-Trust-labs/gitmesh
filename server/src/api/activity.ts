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
      details: e.details,
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
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
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
