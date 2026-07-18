import { describe, expect, it } from "vitest";
import { shouldLoadWorkspaceEnv } from "../lib/workspace-env";

describe("shouldLoadWorkspaceEnv", () => {
  it("loads repository env files by default", () => {
    expect(shouldLoadWorkspaceEnv({})).toBe(true);
  });

  it("disables repository env files only for an explicit true value", () => {
    expect(shouldLoadWorkspaceEnv({ GITMESH_DISABLE_WORKSPACE_ENV: "true" })).toBe(false);
    expect(shouldLoadWorkspaceEnv({ GITMESH_DISABLE_WORKSPACE_ENV: "false" })).toBe(true);
  });
});