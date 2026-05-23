import { Router } from "express";
import type { Db } from "@gitmesh/data";
import { and, eq, inArray, isNull, desc, sql, subprojects, projectWorkspaces, projectGoals, goals } from "@gitmesh/data";
import { normalizeProjectUrlKey } from "@gitmesh/core";
import { assertProjectAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../core/index.js";

type SubprojectRow = typeof subprojects.$inferSelect;
type WorkspaceRow = typeof projectWorkspaces.$inferSelect;

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

function enrichSubproject(
  row: SubprojectRow,
  workspaces: WorkspaceRow[] = [],
  goalRows: Array<{ goalId: string; title: string }> = [],
) {
  const linkedGoalIds = goalRows.map((goal) => goal.goalId);
  return {
    ...row,
    targetDate: row.targetDate ? String(row.targetDate) : null,
    archivedAt: toIsoOrNull(row.archivedAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    goalId: row.goalId,
    milestoneId: row.goalId,
    goalIds: linkedGoalIds,
    milestoneIds: linkedGoalIds,
    goals: goalRows.map((goal) => ({ id: goal.goalId, title: goal.title })),
    workspaces,
  };
}

function matchesSubprojectRouteRef(row: SubprojectRow, ref: string): boolean {
  if (row.id === ref) return true;
  const normalizedRef = normalizeProjectUrlKey(ref);
  const normalizedName = normalizeProjectUrlKey(row.name);
  return Boolean(normalizedRef && normalizedName && normalizedRef === normalizedName);
}

async function findSubprojectByRouteRef(db: Db, ref: string, scopeProjectId?: string | null) {
  const rows = scopeProjectId
    ? await db.select().from(subprojects).where(eq(subprojects.projectId, scopeProjectId))
    : await db.select().from(subprojects);
  return rows.find((row) => matchesSubprojectRouteRef(row, ref)) ?? null;
}

async function loadSubprojectBundle(db: Db, projectId: string, ids?: string[]) {
  const baseRows = ids
    ? await db.select().from(subprojects).where(and(eq(subprojects.projectId, projectId), inArray(subprojects.id, ids)))
    : await db.select().from(subprojects).where(eq(subprojects.projectId, projectId));
  if (baseRows.length === 0) return [];

  const subprojectIds = baseRows.map((row) => row.id);
  const [workspaceRows, goalRows] = await Promise.all([
    db.select().from(projectWorkspaces).where(inArray(projectWorkspaces.subprojectId, subprojectIds)),
    db
      .select({ subprojectId: projectGoals.subprojectId, goalId: projectGoals.goalId, title: goals.title })
      .from(projectGoals)
      .innerJoin(goals, eq(projectGoals.goalId, goals.id))
      .where(and(eq(projectGoals.projectId, projectId), inArray(projectGoals.subprojectId, subprojectIds)))
      .orderBy(desc(projectGoals.createdAt)),
  ]);

  const workspacesBySubproject = new Map<string, WorkspaceRow[]>();
  for (const workspace of workspaceRows) {
    const list = workspacesBySubproject.get(workspace.subprojectId) ?? [];
    list.push(workspace);
    workspacesBySubproject.set(workspace.subprojectId, list);
  }

  const goalsBySubproject = new Map<string, Array<{ goalId: string; title: string }>>();
  for (const goal of goalRows) {
    const list = goalsBySubproject.get(goal.subprojectId) ?? [];
    list.push({ goalId: goal.goalId, title: goal.title });
    goalsBySubproject.set(goal.subprojectId, list);
  }

  return baseRows.map((row) => enrichSubproject(row, workspacesBySubproject.get(row.id) ?? [], goalsBySubproject.get(row.id) ?? []));
}

function normalizeGoalIds(body: Record<string, unknown>): string[] {
  const raw = Array.isArray(body.goalIds)
    ? body.goalIds
    : Array.isArray(body.milestoneIds)
      ? body.milestoneIds
      : body.goalId
        ? [body.goalId]
        : body.milestoneId
          ? [body.milestoneId]
          : [];
  return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
}

async function syncSubprojectGoals(db: Db, projectId: string, subprojectId: string, goalIds: string[]) {
  await db.delete(projectGoals).where(and(eq(projectGoals.projectId, projectId), eq(projectGoals.subprojectId, subprojectId)));
  if (goalIds.length === 0) return;

  await db.insert(projectGoals).values(
    goalIds.map((goalId) => ({
      projectId,
      subprojectId,
      goalId,
    })),
  );
}

export function subprojectRoutes(db: Db) {
  const router = Router();

  router.get("/projects/:projectId/subprojects", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    res.json(await loadSubprojectBundle(db, projectId));
  });

  router.post("/projects/:projectId/subprojects", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    const goalIds = normalizeGoalIds(req.body as Record<string, unknown>);
    const [created] = await db
      .insert(subprojects)
      .values({
        projectId,
        goalId: goalIds[0] ?? null,
        name: String((req.body as Record<string, unknown>).name ?? "").trim(),
        description: (req.body as Record<string, unknown>).description ? String((req.body as Record<string, unknown>).description) : null,
        status: String((req.body as Record<string, unknown>).status ?? "backlog"),
        leadAgentId: (req.body as Record<string, unknown>).leadAgentId ? String((req.body as Record<string, unknown>).leadAgentId) : null,
        targetDate: (req.body as Record<string, unknown>).targetDate ? String((req.body as Record<string, unknown>).targetDate) : null,
        color: (req.body as Record<string, unknown>).color ? String((req.body as Record<string, unknown>).color) : null,
      })
      .returning();

    await syncSubprojectGoals(db, projectId, created.id, goalIds);

    const [bundle] = await loadSubprojectBundle(db, projectId, [created.id]);
    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "subproject.created",
      entityType: "subproject",
      entityId: created.id,
      details: { name: created.name },
    });
    res.status(201).json(bundle ?? created);
  });

  router.get("/subprojects/:id", async (req, res) => {
    const projectId = String(req.query.projectId ?? "");
    const id = req.params.id as string;
    const row = await findSubprojectByRouteRef(db, id, projectId || null);
    if (!row) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }
    const resolvedProjectId = projectId || row.projectId;
    assertProjectAccess(req, resolvedProjectId);
    // Use DB UUID — `id` param may be a urlKey/slug such as `main`; inArray(uuid, 'main') throws 22P02.
    const [bundle] = await loadSubprojectBundle(db, resolvedProjectId, [row.id]);
    res.json(bundle ?? enrichSubproject(row));
  });

  router.patch("/subprojects/:id", async (req, res) => {
    const id = req.params.id as string;
    const queryProjectId = String(req.query.projectId ?? "").trim() || undefined;
    const existing = await findSubprojectByRouteRef(db, id, queryProjectId ?? null);
    if (!existing) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }

    const projectId = String(req.query.projectId ?? existing.projectId);
    assertProjectAccess(req, projectId);
    const body = req.body as Record<string, unknown>;
    const goalIds = normalizeGoalIds(body);
    const [updated] = await db
      .update(subprojects)
      .set({
        name: body.name !== undefined ? String(body.name) : existing.name,
        description: body.description !== undefined ? (body.description ? String(body.description) : null) : existing.description,
        status: body.status !== undefined ? String(body.status) : existing.status,
        leadAgentId: body.leadAgentId !== undefined ? (body.leadAgentId ? String(body.leadAgentId) : null) : existing.leadAgentId,
        targetDate: body.targetDate !== undefined ? (body.targetDate ? String(body.targetDate) : null) : existing.targetDate,
        color: body.color !== undefined ? (body.color ? String(body.color) : null) : existing.color,
        updatedAt: new Date(),
      })
      .where(eq(subprojects.id, existing.id))
      .returning();

    if (goalIds.length > 0 || body.goalIds !== undefined || body.milestoneIds !== undefined || body.goalId !== undefined || body.milestoneId !== undefined) {
      await syncSubprojectGoals(db, projectId, existing.id, goalIds);
    }

    const [bundle] = await loadSubprojectBundle(db, projectId, [existing.id]);
    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "subproject.updated",
      entityType: "subproject",
      entityId: existing.id,
      details: body,
    });
    res.json(bundle ?? updated);
  });

  router.delete("/subprojects/:id", async (req, res) => {
    const id = req.params.id as string;
    const queryProjectId = String(req.query.projectId ?? "").trim() || undefined;
    const existing = await findSubprojectByRouteRef(db, id, queryProjectId ?? null);
    if (!existing) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }
    const projectId = String(req.query.projectId ?? existing.projectId);
    assertProjectAccess(req, projectId);
    await db.delete(subprojects).where(eq(subprojects.id, existing.id));
    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "subproject.deleted",
      entityType: "subproject",
      entityId: existing.id,
    });
    res.json(existing);
  });

  router.get("/subprojects/:id/workspaces", async (req, res) => {
    const id = req.params.id as string;
    const projectId = String(req.query.projectId ?? "");
    const queryProjectId = projectId.trim() || undefined;
    const existing = await findSubprojectByRouteRef(db, id, queryProjectId ?? null);
    if (!existing) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }
    const resolvedProjectId = projectId || existing.projectId;
    assertProjectAccess(req, resolvedProjectId);
    const workspaces = await db.select().from(projectWorkspaces).where(eq(projectWorkspaces.subprojectId, existing.id));
    res.json(workspaces);
  });

  router.post("/subprojects/:id/workspaces", async (req, res) => {
    const id = req.params.id as string;
    const projectId = String(req.query.projectId ?? "");
    const queryProjectId = projectId.trim() || undefined;
    const existing = await findSubprojectByRouteRef(db, id, queryProjectId ?? null);
    if (!existing) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }
    const resolvedProjectId = projectId || existing.projectId;
    assertProjectAccess(req, resolvedProjectId);
    const body = req.body as Record<string, unknown>;
    const [created] = await db
      .insert(projectWorkspaces)
      .values({
        projectId: resolvedProjectId,
        subprojectId: existing.id,
        name: String(body.name ?? "workspace").trim(),
        cwd: body.cwd ? String(body.cwd) : null,
        repoUrl: body.repoUrl ? String(body.repoUrl) : null,
        repoRef: body.repoRef ? String(body.repoRef) : null,
        metadata: (body.metadata && typeof body.metadata === "object") ? (body.metadata as Record<string, unknown>) : null,
        isPrimary: Boolean(body.isPrimary),
      })
      .returning();

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: resolvedProjectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "workspace.created",
      entityType: "workspace",
      entityId: created.id,
      details: { subprojectId: existing.id, name: created.name },
    });

    res.status(201).json(created);
  });

  router.patch("/subprojects/:id/workspaces/:workspaceId", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const projectId = String(req.query.projectId ?? "");
    const queryProjectId = projectId.trim() || undefined;
    const existing = await findSubprojectByRouteRef(db, id, queryProjectId ?? null);
    if (!existing) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }
    const resolvedProjectId = projectId || existing.projectId;
    assertProjectAccess(req, resolvedProjectId);
    const body = req.body as Record<string, unknown>;
    const [updated] = await db
      .update(projectWorkspaces)
      .set({
        name: body.name !== undefined ? String(body.name) : undefined,
        cwd: body.cwd !== undefined ? (body.cwd ? String(body.cwd) : null) : undefined,
        repoUrl: body.repoUrl !== undefined ? (body.repoUrl ? String(body.repoUrl) : null) : undefined,
        repoRef: body.repoRef !== undefined ? (body.repoRef ? String(body.repoRef) : null) : undefined,
        metadata: body.metadata !== undefined ? (body.metadata as Record<string, unknown> | null) : undefined,
        isPrimary: body.isPrimary !== undefined ? Boolean(body.isPrimary) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(projectWorkspaces.subprojectId, existing.id), eq(projectWorkspaces.id, workspaceId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: resolvedProjectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "workspace.updated",
      entityType: "workspace",
      entityId: updated.id,
      details: { subprojectId: existing.id },
    });

    res.json(updated);
  });

  router.delete("/subprojects/:id/workspaces/:workspaceId", async (req, res) => {
    const id = req.params.id as string;
    const workspaceId = req.params.workspaceId as string;
    const projectId = String(req.query.projectId ?? "");
    const queryProjectId = projectId.trim() || undefined;
    const existing = await findSubprojectByRouteRef(db, id, queryProjectId ?? null);
    if (!existing) {
      res.status(404).json({ error: "Subproject not found" });
      return;
    }
    const resolvedProjectId = projectId || existing.projectId;
    assertProjectAccess(req, resolvedProjectId);
    const [deleted] = await db
      .delete(projectWorkspaces)
      .where(and(eq(projectWorkspaces.subprojectId, existing.id), eq(projectWorkspaces.id, workspaceId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: resolvedProjectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "workspace.deleted",
      entityType: "workspace",
      entityId: deleted.id,
      details: { subprojectId: existing.id, name: deleted.name },
    });

    res.json(deleted);
  });

  return router;
}