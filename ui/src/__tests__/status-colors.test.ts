import { describe, it, expect } from "vitest";
import { getStatusTokens, getPriorityTokens, statusBadge, priorityColor } from "../lib/status-colors";

describe("getStatusTokens", () => {
  it("returns tokens for a known status", () => {
    const tokens = getStatusTokens("done");
    expect(tokens.badge).toContain("bg-green-100");
    expect(tokens.text).toContain("text-green-600");
  });

  it("returns fallback tokens for an unknown status", () => {
    const tokens = getStatusTokens("unknown-status");
    expect(tokens.badge).toContain("bg-muted");
  });

  it("returns fallback tokens for null or undefined", () => {
    expect(getStatusTokens(null).badge).toContain("bg-muted");
    expect(getStatusTokens(undefined).badge).toContain("bg-muted");
  });
});

describe("getPriorityTokens", () => {
  it("returns tokens for a known priority", () => {
    const tokens = getPriorityTokens("critical");
    expect(tokens.icon).toContain("text-red-600");
  });

  it("returns fallback tokens for an unknown priority", () => {
    const tokens = getPriorityTokens("unknown-priority");
    expect(tokens.icon).toContain("text-yellow-600");
  });
});

describe("legacy exports", () => {
  it("statusBadge record contains known statuses", () => {
    expect(statusBadge["done"]).toContain("bg-green-100");
    expect(statusBadge["todo"]).toContain("bg-blue-100");
  });

  it("priorityColor record contains known priorities", () => {
    expect(priorityColor["critical"]).toContain("text-red-600");
    expect(priorityColor["low"]).toContain("text-blue-600");
  });
});
