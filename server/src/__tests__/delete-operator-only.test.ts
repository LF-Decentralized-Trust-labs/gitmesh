import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../api/issues.js";
import { errorHandler } from "../infra/middleware/index.js";

// ── Mock services ──────────────────────────────────────────────────────────

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getLabelById: vi.fn(),
  remove: vi.fn(),
  deleteLabel: vi.fn(),
  listAttachments: vi.fn(),
  getAttachmentById: vi.fn(),
  removeAttachment: vi.fn(),
  getByIdentifier: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockAccessService = vi.hoisted(() => ({ canUser: vi.fn(), hasPermission: vi.fn() }));
const mockHeartbeatService = vi.hoisted(() => ({ wakeup: vi.fn() }));
const mockAgentService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockProjectService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockGoalService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockIssueApprovalService = vi.hoisted(() => ({ listApprovalsForIssue: vi.fn() }));

vi.mock("../core/index.js", () => ({
  issueService: () => mockIssueService,
  accessService: () => mockAccessService,
  heartbeatService: () => mockHeartbeatService,
  agentService: () => mockAgentService,
  projectService: () => mockProjectService,
  goalService: () => mockGoalService,
  issueApprovalService: () => mockIssueApprovalService,
  logActivity: mockLogActivity,
}));

vi.mock("../infra/middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const PROJECT_ID = "proj-1";
const ISSUE_ID = "issue-1";
const LABEL_ID = "label-1";

const fakeIssue = {
  id: ISSUE_ID,
  projectId: PROJECT_ID,
  title: "Test issue",
  identifier: "TST-1",
  status: "todo",
  assigneeAgentId: null,
  assigneeUserId: null,
};

const fakeLabel = {
  id: LABEL_ID,
  projectId: PROJECT_ID,
  name: "bug",
  color: "#ff0000",
};

// ── App helpers ────────────────────────────────────────────────────────────

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  const fakeStorage = {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    putObject: vi.fn(),
    getObject: vi.fn(),
  };
  app.use("/api", issueRoutes({} as any, fakeStorage as any));
  app.use(errorHandler);
  return app;
}

function operatorActor() {
  return {
    type: "operator",
    userId: "user-1",
    projectIds: [PROJECT_ID],
    source: "local_implicit",
    isInstanceAdmin: false,
  };
}

function agentActor() {
  return {
    type: "agent",
    agentId: "agent-1",
    projectId: PROJECT_ID,
    source: "agent_key",
    runId: "run-1",
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DELETE /issues/:id operator-only guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
    mockIssueService.getByIdentifier.mockResolvedValue(null);
  });

  it("allows operators to delete issues", async () => {
    mockIssueService.getById.mockResolvedValue(fakeIssue);
    mockIssueService.listAttachments.mockResolvedValue([]);
    mockIssueService.remove.mockResolvedValue(fakeIssue);

    const app = createApp(operatorActor());
    const res = await request(app).delete(`/api/issues/${ISSUE_ID}`);

    expect(res.status).toBe(200);
    expect(mockIssueService.remove).toHaveBeenCalledWith(ISSUE_ID);
  });

  it("rejects agents from deleting issues with 403", async () => {
    mockIssueService.getById.mockResolvedValue(fakeIssue);

    const app = createApp(agentActor());
    const res = await request(app).delete(`/api/issues/${ISSUE_ID}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Maintainer access required");
    expect(mockIssueService.remove).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue doesn't exist", async () => {
    mockIssueService.getById.mockResolvedValue(null);

    const app = createApp(operatorActor());
    const res = await request(app).delete(`/api/issues/nonexistent`);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /labels/:labelId operator-only guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
    mockIssueService.getByIdentifier.mockResolvedValue(null);
  });

  it("allows operators to delete labels", async () => {
    mockIssueService.getLabelById.mockResolvedValue(fakeLabel);
    mockIssueService.deleteLabel.mockResolvedValue(fakeLabel);

    const app = createApp(operatorActor());
    const res = await request(app).delete(`/api/labels/${LABEL_ID}`);

    expect(res.status).toBe(200);
    expect(mockIssueService.deleteLabel).toHaveBeenCalledWith(LABEL_ID);
  });

  it("rejects agents from deleting labels with 403", async () => {
    mockIssueService.getLabelById.mockResolvedValue(fakeLabel);

    const app = createApp(agentActor());
    const res = await request(app).delete(`/api/labels/${LABEL_ID}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Maintainer access required");
    expect(mockIssueService.deleteLabel).not.toHaveBeenCalled();
  });

  it("returns 404 when the label doesn't exist", async () => {
    mockIssueService.getLabelById.mockResolvedValue(null);

    const app = createApp(operatorActor());
    const res = await request(app).delete(`/api/labels/nonexistent`);

    expect(res.status).toBe(404);
  });
});
