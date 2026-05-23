import { Router } from "express";
import type { Db } from "@gitmesh/data";
import { createCostEventSchema, updateBudgetSchema } from "@gitmesh/core";
import { validate } from "../infra/middleware/validate.js";
import { costService, projectService, agentService, logActivity } from "../core/index.js";
import { assertBoard, assertProjectAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";

export function costRoutes(db: Db) {
  const router = Router();
  const costs = costService(db);
  const projects = projectService(db);
  const agents = agentService(db);

  router.post("/projects/:projectId/cost-events", validate(createCostEventSchema), async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only report its own costs" });
      return;
    }

    const event = await costs.createEvent(projectId, {
      ...req.body,
      occurredAt: new Date(req.body.occurredAt),
    });

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "cost.reported",
      entityType: "cost_event",
      entityId: event.id,
      details: { costCents: event.costCents, model: event.model },
    });

    res.status(201).json(event);
  });

  function parseDateRange(query: Record<string, unknown>) {
    const from = query.from ? new Date(query.from as string) : undefined;
    const to = query.to ? new Date(query.to as string) : undefined;
    return (from || to) ? { from, to } : undefined;
  }

  router.get("/projects/:projectId/costs/summary", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const range = parseDateRange(req.query);
    const summary = await costs.summary(projectId, range);
    res.json(summary);
  });

  router.get("/projects/:projectId/costs/by-agent", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const range = parseDateRange(req.query);
    const rows = await costs.byAgent(projectId, range);
    res.json(rows);
  });

  router.get("/projects/:projectId/costs/by-project", async (req, res) => {
    const projectId = req.params.projectId as string;
    assertProjectAccess(req, projectId);
    const range = parseDateRange(req.query);
    const rows = await costs.byProject(projectId, range);
    res.json(rows);
  });

  router.patch("/projects/:projectId/budgets", validate(updateBudgetSchema), async (req, res) => {
    assertBoard(req);
    const projectId = req.params.projectId as string;
    const project = await projects.update(projectId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await logActivity(db, {
      projectId,
      actorType: "user",
      actorId: req.actor.userId ?? "operator",
      action: "project.budget_updated",
      entityType: "project",
      entityId: projectId,
      details: { budgetMonthlyCents: req.body.budgetMonthlyCents },
    });

    res.json(project);
  });

  router.patch("/agents/:agentId/budgets", validate(updateBudgetSchema), async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await agents.getById(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    // Gate 1: Enforce project boundary for all actor types.
    // This is the primary cross-project isolation guard: without it, an authenticated
    // operator (or any other actor with project-scoped access) could target agents in
    // another project. For agent actors, this limits access to their own project; Gate 2
    // further restricts them to themselves or agents in their subordinate subtree.
    assertProjectAccess(req, agent.projectId);

    // Gate 2: Spec §9.3 — "Set subordinate budget: yes (manager subtree only)" for agents.
    // An agent actor may only set the budget of:
    //   (a) itself, OR
    //   (b) an agent it directly or transitively manages (is in the chain-of-command).
    // Operators bypass this sub-check (Gate 1 is sufficient).
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden("Agent authentication required");

      if (req.actor.agentId !== agentId) {
        // getChainOfCommand(targetId) walks UP from target → root manager.
        // If actorAgentId appears in that chain, actor is a manager of target.
        const chainOfCommand = await agents.getChainOfCommand(agentId);
        const isManager = chainOfCommand.some((m) => m.id === req.actor.agentId);
        if (!isManager) {
          throw forbidden(
            "Agent can only set the budget of itself or agents in its subordinate subtree",
          );
        }
      }
    }

    const updated = await agents.update(agentId, { budgetMonthlyCents: req.body.budgetMonthlyCents });
    if (!updated) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      projectId: updated.projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "agent.budget_updated",
      entityType: "agent",
      entityId: updated.id,
      details: { budgetMonthlyCents: updated.budgetMonthlyCents },
    });

    res.json(updated);
  });

  return router;
}
