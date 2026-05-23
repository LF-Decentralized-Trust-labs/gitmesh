import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalRoutes } from "../api/approvals.js";
import { errorHandler } from "../infra/middleware/index.js";

// ── Mock services ──────────────────────────────────────────────────────────

const mockApprovalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  requestRevision: vi.fn(),
  resubmit: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  listIssuesForApproval: vi.fn(),
  linkManyForApproval: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeHireApprovalPayloadForPersistence: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../core/index.js", () => ({
  approvalService: () => mockApprovalService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  secretService: () => mockSecretService,
  logActivity: mockLogActivity,
}));

// ── Test fixtures ──────────────────────────────────────────────────────────

const APPROVAL_ID = "approval-1";
const PROJECT_ID = "project-1";
const REAL_USER_ID = "real-session-user";
const FORGED_USER_ID = "forged-impersonated-user";

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: APPROVAL_ID,
    projectId: PROJECT_ID,
    type: "enable_agent",
    status: "pending",
    payload: {},
    requestedByAgentId: null,
    requestedByUserId: null,
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date("2026-05-20T00:00:00Z"),
    updatedAt: new Date("2026-05-20T00:00:00Z"),
    ...overrides,
  };
}

// ── App factory ────────────────────────────────────────────────────────────

function createApp(userId: string = REAL_USER_ID) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "operator",
      userId,
      projectIds: [PROJECT_ID],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("approval decision endpoints derive decidedByUserId from session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([]);
  });

  // ── POST /approvals/:id/approve ────────────────────────────────────────

  describe("POST /approvals/:id/approve", () => {
    it("uses session userId, ignoring any forged decidedByUserId in body", async () => {
      const approvedApproval = makeApproval({
        status: "approved",
        decidedByUserId: REAL_USER_ID,
      });
      mockApprovalService.approve.mockResolvedValue(approvedApproval);
      const app = createApp(REAL_USER_ID);

      const res = await request(app)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .send({
          decisionNote: "Looks good",
          // Attacker tries to forge another user's identity
          decidedByUserId: FORGED_USER_ID,
        });

      expect(res.status).toBe(200);
      // The service MUST have been called with the session userId, not the forged one
      expect(mockApprovalService.approve).toHaveBeenCalledWith(
        APPROVAL_ID,
        REAL_USER_ID,
        "Looks good",
      );
      // Confirm the forged userId was never passed
      expect(mockApprovalService.approve).not.toHaveBeenCalledWith(
        APPROVAL_ID,
        FORGED_USER_ID,
        expect.anything(),
      );
    });

    it("falls back to 'operator' when userId is undefined", async () => {
      const approvedApproval = makeApproval({
        status: "approved",
        decidedByUserId: "operator",
      });
      mockApprovalService.approve.mockResolvedValue(approvedApproval);

      // Build a custom app where the operator actor has no userId set
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).actor = {
          type: "operator",
          source: "local_implicit",
          isInstanceAdmin: false,
          // userId intentionally omitted
        };
        next();
      });
      app.use("/api", approvalRoutes({} as any));
      app.use(errorHandler);

      const res = await request(app)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .send({ decisionNote: null });

      expect(res.status).toBe(200);
      expect(mockApprovalService.approve).toHaveBeenCalledWith(
        APPROVAL_ID,
        "operator",
        null,
      );
    });
  });

  // ── POST /approvals/:id/reject ─────────────────────────────────────────

  describe("POST /approvals/:id/reject", () => {
    it("uses session userId, ignoring any forged decidedByUserId in body", async () => {
      const rejectedApproval = makeApproval({
        status: "rejected",
        decidedByUserId: REAL_USER_ID,
      });
      mockApprovalService.reject.mockResolvedValue(rejectedApproval);
      const app = createApp(REAL_USER_ID);

      const res = await request(app)
        .post(`/api/approvals/${APPROVAL_ID}/reject`)
        .send({
          decisionNote: "Not ready",
          decidedByUserId: FORGED_USER_ID,
        });

      expect(res.status).toBe(200);
      expect(mockApprovalService.reject).toHaveBeenCalledWith(
        APPROVAL_ID,
        REAL_USER_ID,
        "Not ready",
      );
      expect(mockApprovalService.reject).not.toHaveBeenCalledWith(
        APPROVAL_ID,
        FORGED_USER_ID,
        expect.anything(),
      );
    });
  });

  // ── POST /approvals/:id/request-revision ───────────────────────────────

  describe("POST /approvals/:id/request-revision", () => {
    it("uses session userId, ignoring any forged decidedByUserId in body", async () => {
      const revisionApproval = makeApproval({
        status: "revision_requested",
        decidedByUserId: REAL_USER_ID,
      });
      mockApprovalService.requestRevision.mockResolvedValue(revisionApproval);
      const app = createApp(REAL_USER_ID);

      const res = await request(app)
        .post(`/api/approvals/${APPROVAL_ID}/request-revision`)
        .send({
          decisionNote: "Please revise the config",
          decidedByUserId: FORGED_USER_ID,
        });

      expect(res.status).toBe(200);
      expect(mockApprovalService.requestRevision).toHaveBeenCalledWith(
        APPROVAL_ID,
        REAL_USER_ID,
        "Please revise the config",
      );
      expect(mockApprovalService.requestRevision).not.toHaveBeenCalledWith(
        APPROVAL_ID,
        FORGED_USER_ID,
        expect.anything(),
      );
    });
  });

  // ── Non-operator actor is rejected ─────────────────────────────────────

  describe("authorization", () => {
    it("rejects agent actors from decision endpoints", async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).actor = {
          type: "agent",
          agentId: "agent-1",
          projectId: PROJECT_ID,
          source: "agent_key",
        };
        next();
      });
      app.use("/api", approvalRoutes({} as any));
      app.use(errorHandler);

      const res = await request(app)
        .post(`/api/approvals/${APPROVAL_ID}/approve`)
        .send({ decisionNote: null });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Maintainer access required");
    });
  });
});
