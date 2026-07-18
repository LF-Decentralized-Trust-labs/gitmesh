import { describe, expect, it } from "vitest";
import { shouldLoadWorkspaceEnv } from "../config-env.js";

describe("shouldLoadWorkspaceEnv", () => {
  it("loads workspace env files by default", () => {
    expect(shouldLoadWorkspaceEnv({})).toBe(true);
  });

  it("disables workspace env files only for an explicit true value", () => {
    expect(shouldLoadWorkspaceEnv({ GITMESH_DISABLE_WORKSPACE_ENV: "true" })).toBe(false);
    expect(shouldLoadWorkspaceEnv({ GITMESH_DISABLE_WORKSPACE_ENV: "false" })).toBe(true);
  });
});