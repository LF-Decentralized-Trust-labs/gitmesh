import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subprojectRoutes } from "../api/subprojects.js";
import { errorHandler } from "../infra/middleware/index.js";

// ── Fake DB layer ──────────────────────────────────────────────────────────
// subprojectRoutes queries the DB directly via Drizzle, so we build a minimal
// chainable stub that resolves the values each test needs.

function chain(resolvedValue: unknown) {
  const self: Record<string, unknown> = {};
  const noop = () => self;
  for (const m of ["select", "from", "where", "insert", "values", "update", "set", "delete", "returning", "innerJoin", "orderBy"]) {
    self[m] = noop;
  }
  // The terminal `.returning()` or `.where()` call must resolve to the value.
  self.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
  return self;
}

const PROJECT_ID = "proj-1";
const SUBPROJECT_ID = "sub-1";
const WORKSPACE_ID = "ws-1";

const fakeSubproject = {
  id: SUBPROJECT_ID,
  projectId: PROJECT_ID,
  name: "backend",
  description: null,
  status: "active",
  goalId: null,
  leadAgentId: null,
  targetDate: null,
  color: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakeWorkspace = {
  id: WORKSPACE_ID,
  projectId: PROJECT_ID,
  subprojectId: SUBPROJECT_ID,
  name: "main-ws",
  cwd: "/opt/project",
  repoUrl: null,
  repoRef: null,
  metadata: null,
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Mock core services ─────────────────────────────────────────────────────
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../core/index.js", () => ({
  logActivity: mockLogActivity,
}));

// ── App factory ────────────────────────────────────────────────────────────
function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "operator",
      userId: "user-42",
      projectIds: [PROJECT_ID],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });

  // Build a DB stub that knows about our fakeSubproject and fakeWorkspace
  const fakeDb = {
    select: () => ({
      from: (table: any) => ({
        where: () => {
          // subprojects query returns our fake subproject
          return Promise.resolve([fakeSubproject]);
        },
        innerJoin: () => ({
          where: () => ({
            orderBy: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([fakeWorkspace]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([fakeWorkspace]),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([fakeWorkspace]),
      }),
    }),
  };

  app.use("/api", subprojectRoutes(fakeDb as any));
  app.use(errorHandler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("workspace mutation activity logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("logs workspace.created on POST /subprojects/:id/workspaces", async () => {
    const app = createApp();

    const res = await request(app)
      .post(`/api/subprojects/${SUBPROJECT_ID}/workspaces?projectId=${PROJECT_ID}`)
      .send({ name: "new-workspace", cwd: "/tmp" });

    expect(res.status).toBe(201);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "workspace.created",
        entityType: "workspace",
        entityId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      }),
    );
  });

  it("logs workspace.updated on PATCH /subprojects/:id/workspaces/:workspaceId", async () => {
    const app = createApp();

    const res = await request(app)
      .patch(`/api/subprojects/${SUBPROJECT_ID}/workspaces/${WORKSPACE_ID}?projectId=${PROJECT_ID}`)
      .send({ name: "renamed" });

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "workspace.updated",
        entityType: "workspace",
        entityId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      }),
    );
  });

  it("logs workspace.deleted on DELETE /subprojects/:id/workspaces/:workspaceId", async () => {
    const app = createApp();

    const res = await request(app)
      .delete(`/api/subprojects/${SUBPROJECT_ID}/workspaces/${WORKSPACE_ID}?projectId=${PROJECT_ID}`);

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "workspace.deleted",
        entityType: "workspace",
        entityId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      }),
    );
  });

  it("includes actor info from session in all audit entries", async () => {
    const app = createApp();

    await request(app)
      .post(`/api/subprojects/${SUBPROJECT_ID}/workspaces?projectId=${PROJECT_ID}`)
      .send({ name: "ws" });

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "user",
        actorId: "user-42",
      }),
    );
  });
});
