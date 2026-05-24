import { Router } from "express";
import type { Db } from "@gitmesh/data";
import {
  projectPortabilityExportSchema,
  projectPortabilityImportSchema,
  projectPortabilityPreviewSchema,
  createProjectSchema,
  updateProjectSchema,
} from "@gitmesh/core";
import { forbidden } from "../errors.js";
import { validate } from "../infra/middleware/validate.js";
import { accessService, projectPortabilityService, projectService, logActivity } from "../core/index.js";
import { policyEngineService } from "../core/policy-engine.js";
import { assertBoard, assertProjectAccess, getActorInfo } from "./authz.js";

export function projectRoutes(db: Db) {
  const router = Router();
  const svc = projectService(db);
  const portability = projectPortabilityService(db);
  const access = accessService(db);
  const policyEngine = policyEngineService(db);

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || (req.actor.type === "operator" && req.actor.isInstanceAdmin)) {
      res.json(result);
      return;
    }
    const allowed = req.actor.type === "operator" ? new Set(req.actor.projectIds ?? []) : new Set(req.actor.projectId ? [req.actor.projectId] : []);
    res.json(result.filter((project) => allowed.has(project.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || (req.actor.type === "operator" && req.actor.isInstanceAdmin)
      ? null
      : req.actor.type === "operator"
        ? new Set(req.actor.projectIds ?? [])
        : new Set(req.actor.projectId ? [req.actor.projectId] : []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([projectId]) => allowed.has(projectId)));
    res.json(filtered);
  });

  // Common malformed path when projectId is empty in "/api/projects/{projectId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing projectId in path. Use /api/projects/{projectId}/issues.",
    });
  });

  router.get("/:projectId", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const project = await svc.getById(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(project);
  });

  router.post("/:projectId/export", validate(projectPortabilityExportSchema), async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const result = await portability.exportBundle(projectId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(projectPortabilityPreviewSchema), async (req, res) => {
    if (req.body.target.mode === "existing_project") {
      assertProjectAccess(req, req.body.target.projectId);
    } else {
      assertBoard(req);
    }
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(projectPortabilityImportSchema), async (req, res) => {
    if (req.body.target.mode === "existing_project") {
      assertProjectAccess(req, req.body.target.projectId);
    } else {
      assertBoard(req);
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "operator" ? req.actor.userId : null);
    await logActivity(db, {
      projectId: result.project.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "project.imported",
      entityType: "project",
      entityId: result.project.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        projectAction: result.project.action,
      },
    });
    res.json(result);
  });

  router.post("/", validate(createProjectSchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || (req.actor.type === "operator" && req.actor.isInstanceAdmin))) {
      throw forbidden("Instance admin required");
    }
    const project = await svc.create(req.body);
    await access.ensureMembership(project.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    await policyEngine.initializeDefaults(project.id, req.actor.userId ?? "local-board");
    await logActivity(db, {
      projectId: project.id,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      details: { name: project.name },
    });
    res.status(201).json(project);
  });

  router.patch("/:projectId", validate(updateProjectSchema), async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const project = await svc.update(projectId, req.body);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    await logActivity(db, {
      projectId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "project.updated",
      entityType: "project",
      entityId: projectId,
      details: req.body,
    });
    res.json(project);
  });

  router.post("/:projectId/archive", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const project = await svc.archive(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    await logActivity(db, {
      projectId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "project.archived",
      entityType: "project",
      entityId: projectId,
    });
    res.json(project);
  });

  router.delete("/:projectId", async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const project = await svc.remove(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
