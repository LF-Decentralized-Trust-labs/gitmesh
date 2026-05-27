import { describe, it, expect } from "vitest";
import { queryKeys } from "../lib/queryKeys";

describe("queryKeys", () => {
  it("projects keys are correct", () => {
    expect(queryKeys.projects.all).toEqual(["projects"]);
    expect(queryKeys.projects.detail("123")).toEqual(["projects", "123"]);
    expect(queryKeys.projects.stats).toEqual(["projects", "stats"]);
  });

  it("agents keys are correct", () => {
    expect(queryKeys.agents.list("p1")).toEqual(["agents", "p1"]);
    expect(queryKeys.agents.detail("a1")).toEqual(["agents", "detail", "a1"]);
  });

  it("issues keys are correct", () => {
    expect(queryKeys.issues.list("p1")).toEqual(["issues", "p1"]);
    expect(queryKeys.issues.search("p1", "query", "s1")).toEqual(["issues", "p1", "search", "query", "s1"]);
    expect(queryKeys.issues.search("p1", "query")).toEqual(["issues", "p1", "search", "query", "__all-subprojects__"]);
  });

  it("approvals keys are correct", () => {
    expect(queryKeys.approvals.list("p1", "pending")).toEqual(["approvals", "p1", "pending"]);
    expect(queryKeys.approvals.detail("app1")).toEqual(["approvals", "detail", "app1"]);
  });
});
