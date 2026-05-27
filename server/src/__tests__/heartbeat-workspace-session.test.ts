import { beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import {
  resolveRuntimeSessionParamsForWorkspace,
  shouldResetTaskSessionForWake,
  type ResolvedWorkspaceForRun,
} from "../core/heartbeat.js";
import {
  makePreviousSession,
  makeResolvedWorkspace,
  resetFactoryCounters,
} from "./_helpers/factories.js";

beforeEach(() => {
  resetFactoryCounters();
});

// The factory shape is structurally identical to `ResolvedWorkspaceForRun`;
// this thin wrapper exists purely for documentation.
function asResolved(workspace: ReturnType<typeof makeResolvedWorkspace>): ResolvedWorkspaceForRun {
  return workspace;
}

function toSessionParams(
  session: ReturnType<typeof makePreviousSession>
): Record<string, unknown> {
  return session as unknown as Record<string, unknown>;
}

describe("resolveRuntimeSessionParamsForWorkspace", () => {
  it("migrates fallback workspace sessions to project workspace when project cwd becomes available", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: toSessionParams(
        makePreviousSession({ cwd: fallbackCwd }),
      ),
      resolvedWorkspace: asResolved(
        makeResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
      ),
    });

    expect(result.sessionParams).toMatchObject({
      sessionId: "session-1",
      cwd: "/tmp/new-project-cwd",
      workspaceId: "workspace-1",
    });
    expect(result.warning).toContain("Attempting to resume session");
  });

  it("does not migrate when previous session cwd is not the fallback workspace", () => {
    const previous = makePreviousSession({ cwd: "/tmp/some-other-cwd" });
    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId: "agent-123",
      previousSessionParams: previous as unknown as Record<string, unknown>,
      resolvedWorkspace: asResolved(
        makeResolvedWorkspace({ cwd: "/tmp/new-project-cwd" }),
      ),
    });

    expect(result.sessionParams).toEqual(previous);
    expect(result.warning).toBeNull();
  });

  it("does not migrate when resolved workspace id differs from previous session workspace id", () => {
    const agentId = "agent-123";
    const fallbackCwd = resolveDefaultAgentWorkspaceDir(agentId);
    const previous = makePreviousSession({ cwd: fallbackCwd });

    const result = resolveRuntimeSessionParamsForWorkspace({
      agentId,
      previousSessionParams: previous as unknown as Record<string, unknown>,
      resolvedWorkspace: asResolved(
        makeResolvedWorkspace({
          cwd: "/tmp/new-project-cwd",
          workspaceId: "workspace-2",
        }),
      ),
    });

    expect(result.sessionParams).toEqual(previous);
    expect(result.warning).toBeNull();
  });
});

describe("shouldResetTaskSessionForWake", () => {
  // Drive each scenario from a small table so the spec reads as a list of
  // conditions rather than a wall of nearly-identical it() blocks.
  const wakeCases: Array<{ desc: string; input: Parameters<typeof shouldResetTaskSessionForWake>[0]; expected: boolean }> = [
    { desc: "resets on assignment wake", input: { wakeReason: "issue_assigned" }, expected: true },
    { desc: "resets on timer heartbeats", input: { wakeSource: "timer" }, expected: true },
    {
      desc: "resets on manual on-demand invokes",
      input: { wakeSource: "on_demand", wakeTriggerDetail: "manual" },
      expected: true,
    },
    {
      desc: "does not reset on mention wake comment",
      input: { wakeReason: "issue_comment_mentioned", wakeCommentId: "comment-1" },
      expected: false,
    },
    {
      desc: "does not reset when commentId is present",
      input: { wakeReason: "issue_commented", commentId: "comment-2" },
      expected: false,
    },
    { desc: "does not reset for plain comment wakes", input: { wakeReason: "issue_commented" }, expected: false },
    { desc: "does not reset when wake reason is missing", input: {}, expected: false },
    {
      desc: "does not reset on callback on-demand invokes",
      input: { wakeSource: "on_demand", wakeTriggerDetail: "callback" },
      expected: false,
    },
  ];

  for (const c of wakeCases) {
    it(c.desc, () => {
      expect(shouldResetTaskSessionForWake(c.input)).toBe(c.expected);
    });
  }
});
