import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../core/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

const { policyEngineService } = await import("../core/policy-engine.js");

function createSelectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createPolicyEngineDb(policyRows: unknown[], agentRows: unknown[]) {
  return {
    select: vi
      .fn()
      .mockReturnValueOnce(createSelectBuilder(policyRows))
      .mockReturnValueOnce(createSelectBuilder(agentRows)),
  };
}

describe("policyEngineService audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes policy evaluation entries through logActivity with policy metadata", async () => {
    const policy = {
      id: "policy-1",
      projectId: "project-1",
      name: "Require approval for merges",
      actionPattern: "merge_pr",
      conditions: null,
      effect: "require_approval",
      effectConfig: { approverRoles: ["maintainer"] },
      priority: 10,
      enabled: true,
      version: 3,
    };
    const db = createPolicyEngineDb([policy], [{ id: "agent-1", role: "release" }]);

    const result = await policyEngineService(db as never).evaluate({
      projectId: "project-1",
      agentId: "agent-1",
      action: "merge_pr",
      context: { targetBranch: "main" },
    });

    expect(result).toMatchObject({
      effect: "require_approval",
      policyId: "policy-1",
      policyVersion: 3,
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(db, {
      projectId: "project-1",
      actorType: "agent",
      actorId: "agent-1",
      action: "merge_pr",
      entityType: "policy_evaluation",
      entityId: "policy-1",
      agentId: "agent-1",
      details: {
        effect: "require_approval",
        policyName: "Require approval for merges",
        policyVersion: 3,
        reason: 'Matched policy "Require approval for merges" (v3)',
        context: { targetBranch: "main" },
      },
      policyVersion: 3,
      policyOutcome: "require_approval",
    });
  });
});
