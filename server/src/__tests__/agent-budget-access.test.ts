import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { costRoutes } from "../api/costs.js";
import { errorHandler } from "../infra/middleware/index.js";

// ── Mock services ──────────────────────────────────────────────────────────

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  getChainOfCommand: vi.fn(),
}));

const mockCostService = vi.hoisted(() => ({
  createEvent: vi.fn(),
  summary: vi.fn(),
  byAgent: vi.fn(),
  byProject: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  update: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../core/index.js", () => ({
  agentService: () => mockAgentService,
  costService: () => mockCostService,
  projectService: () => mockProjectService,
  logActivity: mockLogActivity,
}));

// ── Test fixtures ──────────────────────────────────────────────────────────

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const AGENT_ID = "agent-1";
const MANAGER_AGENT_ID = "agent-manager";
const PEER_AGENT_ID = "agent-peer";

const targetAgent = {
  id: AGENT_ID,
  projectId: PROJECT_A,
  name: "worker",
  role: "general",
  budgetMonthlyCents: 5000,
};

const validBody = { budgetMonthlyCents: 10000 };

// ── App factory ────────────────────────────────────────────────────────────

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", costRoutes({} as any));
  app.use(errorHandler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("PATCH /agents/:agentId/budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockResolvedValue(targetAgent);
    mockAgentService.update.mockResolvedValue({ ...targetAgent, ...validBody });
    mockAgentService.getChainOfCommand.mockResolvedValue([]);
    mockLogActivity.mockResolvedValue(undefined);
  });

  // ── 1. Unauthenticated → 401 ──────────────────────────────────────────

  it("returns 401 for unauthenticated requests", async () => {
    const app = createApp({ type: "none" });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(401);
  });

  // ── 2. Operator without project membership → 403 ──────────────────────

  it("returns 403 when operator lacks access to the agent's project", async () => {
    const app = createApp({
      type: "operator",
      userId: "user-1",
      projectIds: [PROJECT_B], // only has access to project B
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not have access");
  });

  // ── 3. Operator with project membership → 200 ─────────────────────────

  it("allows operator with project access to update agent budget", async () => {
    const app = createApp({
      type: "operator",
      userId: "user-1",
      projectIds: [PROJECT_A],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.budgetMonthlyCents).toBe(10000);
    expect(mockAgentService.update).toHaveBeenCalledWith(AGENT_ID, validBody);
  });

  // ── 4. Agent updating own budget → 200 ────────────────────────────────

  it("allows agent to update its own budget", async () => {
    const app = createApp({
      type: "agent",
      agentId: AGENT_ID,
      projectId: PROJECT_A,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.budgetMonthlyCents).toBe(10000);
  });

  // ── 5. Manager agent updating subordinate → 200 ───────────────────────

  it("allows manager agent to update subordinate budget", async () => {
    // Chain of command for target agent includes the manager
    mockAgentService.getChainOfCommand.mockResolvedValue([
      { id: MANAGER_AGENT_ID, name: "manager", role: "admin", title: null },
    ]);

    const app = createApp({
      type: "agent",
      agentId: MANAGER_AGENT_ID,
      projectId: PROJECT_A,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(mockAgentService.getChainOfCommand).toHaveBeenCalledWith(AGENT_ID);
  });

  // ── 6. Non-manager agent updating peer → 403 ──────────────────────────

  it("returns 403 when agent tries to update a peer's budget", async () => {
    // Chain of command does NOT include the peer agent
    mockAgentService.getChainOfCommand.mockResolvedValue([]);

    const app = createApp({
      type: "agent",
      agentId: PEER_AGENT_ID,
      projectId: PROJECT_A,
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("subordinate subtree");
  });

  // ── 7. Agent from different project → 403 ─────────────────────────────

  it("returns 403 when agent belongs to a different project", async () => {
    const app = createApp({
      type: "agent",
      agentId: "agent-other",
      projectId: PROJECT_B, // different project
      source: "agent_key",
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("cannot access another project");
  });

  // ── 8. Agent not found → 404 ──────────────────────────────────────────

  it("returns 404 when the target agent does not exist", async () => {
    mockAgentService.getById.mockResolvedValue(null);

    const app = createApp({
      type: "operator",
      userId: "user-1",
      projectIds: [PROJECT_A],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/agents/nonexistent/budgets`)
      .send(validBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Agent not found");
  });

  // ── 9. Local implicit operator bypasses project check → 200 ───────────

  it("allows local implicit operator to update any agent budget", async () => {
    const app = createApp({
      type: "operator",
      userId: "operator",
      source: "local_implicit",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .patch(`/api/agents/${AGENT_ID}/budgets`)
      .send(validBody);

    expect(res.status).toBe(200);
  });
});
