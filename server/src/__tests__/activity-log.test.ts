import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQueueSign = vi.hoisted(() => vi.fn());
const mockPublishLiveEvent = vi.hoisted(() => vi.fn());

vi.mock("../core/attestation.js", () => ({
  attestationService: () => ({
    queueSign: mockQueueSign,
  }),
}));

vi.mock("../core/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
}));

const { logActivity } = await import("../core/activity-log.js");

function createInsertDb() {
  const returning = vi.fn().mockResolvedValue([{ id: "activity-1" }]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return {
    db: { insert },
    values,
    returning,
  };
}

describe("logActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes policy metadata from details into attested activity columns", async () => {
    const { db, values } = createInsertDb();

    await logActivity(db as never, {
      projectId: "project-1",
      actorType: "agent",
      actorId: "agent-1",
      action: "acp.register",
      entityType: "agent",
      entityId: "agent-1",
      agentId: "agent-1",
      details: {
        policyVersion: 7,
        policyOutcome: "allow",
      },
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      policyVersion: 7,
      policyOutcome: "allow",
    }));
    expect(mockQueueSign).toHaveBeenCalledWith({
      activityId: "activity-1",
      projectId: "project-1",
    });
    expect(mockPublishLiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        policyVersion: 7,
        policyOutcome: "allow",
      }),
    }));
  });
});
